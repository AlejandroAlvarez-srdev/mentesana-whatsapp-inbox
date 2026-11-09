// Cron: cada minuto procesa plantillas Meta programadas vencidas.
// Llama al edge function inbox-v2-server (send-template / broadcast/template).
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { dailyCap, dropOptedOut, madridMidnightIso, optoutKey, qualityBlock, recipientCount, templateBlock, tomorrowMadrid10Iso, type QualityState, type TemplateHealth } from "@/lib/wa-send-guard";

const sb = createClient(process.env.NEXT_PUBLIC_BLOG_SUPABASE_URL!, process.env.BLOG_SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } });
const EDGE_BASE = `${process.env.NEXT_PUBLIC_BLOG_SUPABASE_URL}/functions/v1/inbox-v2-server`;
const ANON_KEY = process.env.NEXT_PUBLIC_BLOG_SUPABASE_ANON_KEY!;
const INBOX_SECRET = process.env.INBOX_SECRET ?? process.env.INSIGHTS_SECRET ?? "REDACTED_SECRET";
const CRON_SECRET = process.env.CRON_SECRET;

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  // Vercel cron envía Authorization: Bearer CRON_SECRET
  const auth = req.headers.get("authorization");
  if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: due, error } = await sb
    .from("whatsapp_scheduled_templates_v2")
    .select("*")
    .eq("status", "pending")
    .lte("scheduled_for", new Date().toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(20);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!due || due.length === 0) return NextResponse.json({ ok: true, processed: 0 });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${ANON_KEY}`,
    "x-inbox-secret": INBOX_SECRET,
  };

  // Freno de lotes (ver lib/wa-send-guard): calidad del número, tope diario y bajas.
  const bulkFroms = [...new Set(due.filter((r) => r.scope !== "single" && r.from_number).map((r) => String(r.from_number)))];
  const quality = new Map<string, QualityState>();
  const sentToday = new Map<string, number>();
  let optedOut = new Set<string>();
  let templateHealth: TemplateHealth[] = [];
  if (bulkFroms.length > 0) {
    const { data: states } = await sb.from("wa_quality_state").select("phone_number_id, current_quality, marketing_paused, daily_cap_normal").in("phone_number_id", bulkFroms);
    for (const s of states ?? []) quality.set(String(s.phone_number_id), s);
    const { data: today } = await sb.from("whatsapp_scheduled_templates_v2").select("from_number, recipients, phones")
      .eq("status", "sent").neq("scope", "single").in("from_number", bulkFroms).gte("sent_at", madridMidnightIso());
    for (const t of today ?? []) sentToday.set(String(t.from_number), (sentToday.get(String(t.from_number)) ?? 0) + recipientCount(t));
    const phones: string[] = [];
    for (let from = 0; ; from += 1000) {
      const { data: opt } = await sb.from("app_outreach_optout").select("phone").not("phone", "is", null).range(from, from + 999);
      for (const o of opt ?? []) phones.push(optoutKey(o.phone));
      if (!opt || opt.length < 1000) break;
    }
    optedOut = new Set(phones.filter(Boolean));
    // Salud de plantillas (webhooks de Meta → /api/whatsapp/meta-events). Si la tabla aún no existe, se ignora.
    const names = [...new Set(due.filter((r) => r.scope !== "single" && r.template_name).map((r) => String(r.template_name)))];
    if (names.length > 0) {
      const { data: th, error: thErr } = await sb.from("wa_template_health").select("template_name, language, quality, status").in("template_name", names);
      if (!thErr) templateHealth = th ?? [];
    }
  }

  const results = [];
  for (const row of due) {
    if (row.scope !== "single") {
      const fromKey = String(row.from_number ?? "");
      const block = qualityBlock(quality.get(fromKey));
      if (block) {
        await sb.from("whatsapp_scheduled_templates_v2").update({ status: "canceled", last_error: `freno: ${block}`, updated_at: new Date().toISOString() }).eq("id", row.id);
        results.push({ id: row.id, ok: false, canceled: block });
        continue;
      }
      const tBlock = templateBlock(templateHealth, row.template_name, row.language);
      if (tBlock) {
        await sb.from("whatsapp_scheduled_templates_v2").update({ status: "canceled", last_error: `freno: ${tBlock}`, updated_at: new Date().toISOString() }).eq("id", row.id);
        results.push({ id: row.id, ok: false, canceled: tBlock });
        continue;
      }
      const filtered = dropOptedOut(row, optedOut);
      if (filtered.removed > 0) {
        row.recipients = filtered.recipients ?? row.recipients;
        row.phones = filtered.phones ?? row.phones;
        await sb.from("whatsapp_scheduled_templates_v2").update({ recipients: row.recipients, phones: row.phones, updated_at: new Date().toISOString() }).eq("id", row.id);
      }
      const n = recipientCount(row);
      if (n === 0) {
        await sb.from("whatsapp_scheduled_templates_v2").update({ status: "canceled", last_error: "freno: todos dados de baja", updated_at: new Date().toISOString() }).eq("id", row.id);
        results.push({ id: row.id, ok: false, canceled: "all_opted_out" });
        continue;
      }
      const used = sentToday.get(fromKey) ?? 0;
      const cap = dailyCap(quality.get(fromKey));
      if (used + n > cap) {
        await sb.from("whatsapp_scheduled_templates_v2").update({ scheduled_for: tomorrowMadrid10Iso(), last_error: `freno: tope diario ${used}+${n}>${cap}, aplazado a mañana 10:00`, updated_at: new Date().toISOString() }).eq("id", row.id);
        results.push({ id: row.id, ok: false, postponed: "daily_cap" });
        continue;
      }
      sentToday.set(fromKey, used + n);
    }

    // marcar attempt antes de intentar (idempotencia básica)
    await sb.from("whatsapp_scheduled_templates_v2").update({ attempts: (row.attempts ?? 0) + 1, updated_at: new Date().toISOString() }).eq("id", row.id);

    try {
      let url: string;
      let body: any;
      if (row.scope === "single") {
        url = `${EDGE_BASE}/conversations/${encodeURIComponent(row.conversation_id)}/send-template`;
        body = {
          template_name: row.template_name,
          language: row.language,
          from_number: row.from_number,
          components: row.components ?? [],
          agent_name: "scheduler",
        };
      } else {
        url = `${EDGE_BASE}/broadcast/template`;
        body = {
          template_name: row.template_name,
          language: row.language,
          from_number: row.from_number,
          agent_name: "scheduler",
        };
        if (Array.isArray(row.recipients) && row.recipients.length > 0) body.recipients = row.recipients;
        else if (Array.isArray(row.phones) && row.phones.length > 0) {
          body.phones = row.phones;
          body.components = row.components ?? [];
        }
        // PRE-FLIGHT: ensure-conversation por cada phone (Edge Function broadcast solo
        // guarda msg en messages_mentesana si la conv YA existe; sin esto el mensaje
        // se entrega a Meta pero desaparece del CRM).
        const phonesToEnsure: string[] = Array.isArray(body.recipients)
          ? body.recipients.map((r: any) => String(r.phone ?? "").trim()).filter(Boolean)
          : Array.isArray(body.phones) ? body.phones : [];
        for (const phone of phonesToEnsure) {
          try {
            const exists = await sb.from("conversations_mentesana").select("id").eq("phone", phone).limit(1).maybeSingle();
            if (!exists.data) {
              const newId = `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
              await sb.from("conversations_mentesana").insert({
                id: newId, phone,
                status: "sin_contactar",
                client_type: "ventas",
                pipeline_type: "ventas",
                source: "manual",
                notes: `Creada por scheduler al enviar plantilla programada (cron)`,
              });
            }
          } catch (e) { console.warn("[scheduler] ensure-conv fail for", phone, e); }
        }
      }

      const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        await sb.from("whatsapp_scheduled_templates_v2").update({
          status: "sent",
          sent_at: new Date().toISOString(),
          result: j,
          last_error: null,
          updated_at: new Date().toISOString(),
        }).eq("id", row.id);
        results.push({ id: row.id, ok: true });
      } else {
        // Reintento hasta 3 veces; al 4º intento → failed
        const next = row.attempts ?? 0;
        const finalStatus = next >= 3 ? "failed" : "pending";
        await sb.from("whatsapp_scheduled_templates_v2").update({
          status: finalStatus,
          last_error: `${r.status} ${j?.error ?? "error"}`,
          result: j,
          updated_at: new Date().toISOString(),
        }).eq("id", row.id);
        results.push({ id: row.id, ok: false, http: r.status, error: j?.error });
      }
    } catch (e: any) {
      const next = row.attempts ?? 0;
      const finalStatus = next >= 3 ? "failed" : "pending";
      await sb.from("whatsapp_scheduled_templates_v2").update({
        status: finalStatus,
        last_error: String(e?.message ?? e).slice(0, 500),
        updated_at: new Date().toISOString(),
      }).eq("id", row.id);
      results.push({ id: row.id, ok: false, exception: String(e?.message ?? e) });
    }
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}
