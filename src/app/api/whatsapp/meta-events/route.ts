// Webhooks de Meta (WhatsApp) que no son mensajes, reenviados por el monolito
// (make-server-226b0b0d/whatsapp/webhook) con body { waba_id, field, value } — un change por llamada.
//   · user_preferences → baja/alta de marketing en app_outreach_optout (source 'wa_pref').
//   · message_template_{quality,status}_update, template_category_update → wa_template_health,
//     log en wa_template_events y email al CTO si la plantilla se degrada (máx. 1 por estado y 24 h).
// Idempotente: Meta reintenta hasta 7 días. Si las tablas nuevas aún no existen, la baja sigue
// funcionando (app_outreach_optout ya existe) y lo demás se salta sin romper.
import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/emails/send";
import { emailLayout } from "@/lib/emails/layout";
import {
  OPTOUT_SOURCE,
  PREF_FIELD,
  TEMPLATE_FIELDS,
  alertAlreadySent,
  optoutRow,
  parsePreferences,
  parseTemplateEvent,
  templateAlertKey,
} from "@/lib/wa-meta-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const SECRET = process.env.META_EVENTS_SECRET ?? process.env.INSIGHTS_SECRET ?? "REDACTED_SECRET";
const ALERT_EMAILS = (process.env.WA_TEMPLATE_ALERT_EMAILS ?? "alerts@example.com")
  .split(",").map((e) => e.trim()).filter(Boolean);

const sb = createClient(process.env.NEXT_PUBLIC_BLOG_SUPABASE_URL!, process.env.BLOG_SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } });

const sha = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export async function POST(req: NextRequest) {
  if (req.headers.get("x-meta-events-secret") !== SECRET) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { waba_id?: unknown; field?: unknown; value?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_json" }, { status: 400 }); }
  const wabaId = String(body.waba_id ?? "");
  const field = String(body.field ?? "");
  const value = body.value;
  if (!field || !value || typeof value !== "object") return NextResponse.json({ error: "missing field/value" }, { status: 400 });

  try {
    if (field === PREF_FIELD) return NextResponse.json(await handlePreferences(wabaId, value));
    if (TEMPLATE_FIELDS.has(field)) return NextResponse.json(await handleTemplate(wabaId, field, value));
    return NextResponse.json({ ok: true, ignored: field });
  } catch (e) {
    console.error("[meta-events]", field, e);
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e) }, { status: 500 });
  }
}

async function handlePreferences(wabaId: string, value: unknown) {
  const phoneNumberId = String((value as { metadata?: { phone_number_id?: unknown } })?.metadata?.phone_number_id ?? "") || null;
  const results: Array<Record<string, unknown>> = [];
  for (const op of parsePreferences(value)) {
    const eventKey = sha({ wabaId, ...op });

    // Reintentos fuera de orden: si ya hay un evento más nuevo para estas claves, este no manda.
    let stale = false;
    if (op.timestamp) {
      const { data: newer, error } = await sb.from("wa_pref_events").select("id").in("pref_key", op.keys)
        .gt("event_ts", new Date(op.timestamp * 1000).toISOString()).limit(1);
      stale = !error && (newer?.length ?? 0) > 0;
    }

    if (!stale && op.action === "stop") {
      for (const key of op.keys) {
        const { data: existing } = await sb.from("app_outreach_optout").select("email").eq("phone", key).eq("source", OPTOUT_SOURCE).limit(1);
        if (existing?.length) continue;
        // email es PK: si ya hay baja con 'wa:'+clave (p. ej. manual) se respeta tal cual.
        const { error } = await sb.from("app_outreach_optout").upsert(optoutRow(key), { onConflict: "email", ignoreDuplicates: true });
        if (error) throw new Error(`optout upsert: ${error.message}`);
      }
    } else if (!stale && op.action === "resume") {
      // Solo se quita la baja que puso este webhook; las manuales/BAJA nunca.
      const { error } = await sb.from("app_outreach_optout").delete().eq("source", OPTOUT_SOURCE).in("phone", op.keys);
      if (error) throw new Error(`optout delete: ${error.message}`);
    }

    const rows = op.keys.map((key) => ({
      event_key: `${eventKey}:${key}`,
      waba_id: wabaId || null,
      phone_number_id: phoneNumberId,
      pref_key: key,
      wa_id: op.wa_id,
      user_id: op.user_id,
      action: op.action,
      category: op.category,
      event_ts: op.timestamp ? new Date(op.timestamp * 1000).toISOString() : null,
      applied: !stale,
      payload: value,
    }));
    const { error: logErr } = await sb.from("wa_pref_events").upsert(rows, { onConflict: "event_key", ignoreDuplicates: true });
    if (logErr) console.warn("[meta-events] wa_pref_events:", logErr.message);
    results.push({ action: op.action, keys: op.keys, applied: !stale });
  }
  return { ok: true, field: PREF_FIELD, results };
}

async function handleTemplate(wabaId: string, field: string, value: unknown) {
  const ev = parseTemplateEvent(field, value);

  const { error: logErr } = await sb.from("wa_template_events").upsert({
    event_key: sha({ wabaId, field, value }),
    waba_id: wabaId || null,
    field,
    template_name: ev?.template_name ?? null,
    language: ev?.language ?? null,
    payload: value,
  }, { onConflict: "event_key", ignoreDuplicates: true });
  if (logErr) console.warn("[meta-events] wa_template_events:", logErr.message);

  if (!ev) return { ok: true, field, skipped: "sin nombre de plantilla" };

  const pk = { waba_id: wabaId, template_name: ev.template_name, language: ev.language };
  const { data: prev, error: prevErr } = await sb.from("wa_template_health")
    .select("last_alert_key, last_alert_at").match(pk).maybeSingle();
  const healthTable = !prevErr;

  if (healthTable && field !== "message_template_components_update") {
    const { error } = await sb.from("wa_template_health").upsert({
      ...pk,
      ...(ev.template_id ? { template_id: ev.template_id } : {}),
      ...ev.patch,
      updated_at: new Date().toISOString(),
    }, { onConflict: "waba_id,template_name,language" });
    if (error) console.warn("[meta-events] wa_template_health:", error.message);
  }

  const alertKey = templateAlertKey(field, value);
  let alerted = false;
  if (alertKey && !alertAlreadySent(prev, alertKey)) {
    // Se marca antes de enviar: con reintentos concurrentes de Meta, mejor un email de menos que repetido.
    if (healthTable) {
      await sb.from("wa_template_health").upsert({ ...pk, last_alert_key: alertKey, last_alert_at: new Date().toISOString() }, { onConflict: "waba_id,template_name,language" });
    }
    await notify(wabaId, ev.template_name, ev.language, alertKey, ev.patch.last_event, ev.patch.last_reason, value);
    alerted = true;
  }
  return { ok: true, field, template: ev.template_name, alert: alertKey, alerted };
}

async function notify(wabaId: string, name: string, lang: string, key: string, event: string, reason: string | null, value: unknown) {
  const red = /RED|PAUSED|DISABLED|FLAGGED|REJECTED/.test(key);
  const subject = `${red ? "🚨" : "⚠️"} Plantilla WhatsApp ${name} (${lang || "?"}): ${key}`;
  const content = `
    <h2 style="color:${red ? "#dc2626" : "#d97706"};margin-top:0">${red ? "🚨" : "⚠️"} Plantilla degradada en Meta</h2>
    <table style="font-size:14px;border-collapse:collapse;width:100%;margin:14px 0">
      <tr><td style="padding:4px 8px;color:#666">Plantilla</td><td style="padding:4px 8px"><b>${esc(name)}</b> · ${esc(lang)}</td></tr>
      <tr><td style="padding:4px 8px;color:#666">WABA</td><td style="padding:4px 8px">${esc(wabaId)}</td></tr>
      <tr><td style="padding:4px 8px;color:#666">Evento</td><td style="padding:4px 8px">${esc(event)}</td></tr>
      ${reason ? `<tr><td style="padding:4px 8px;color:#666">Motivo</td><td style="padding:4px 8px">${esc(reason)}</td></tr>` : ""}
    </table>
    <p style="font-size:13px;color:#666">Los lotes programados con esta plantilla se cancelan solos si queda en RED, PAUSED, DISABLED o FLAGGED (cron send-scheduled-templates).</p>
    <pre style="font-size:11px;background:#f5f5f5;padding:10px;white-space:pre-wrap">${esc(JSON.stringify(value, null, 2))}</pre>`;
  for (const to of ALERT_EMAILS) {
    try { await sendEmail({ to, subject, html: emailLayout({ title: subject, content }), tags: ["wa-template-health"] }); }
    catch (e) { console.warn(`[meta-events] email a ${to} falló:`, e); }
  }
}
