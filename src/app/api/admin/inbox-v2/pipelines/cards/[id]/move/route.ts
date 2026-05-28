// POST /api/admin/inbox-v2/pipelines/cards/:id/move
// Body: { to_phase: number, note?: string, dry_run?: boolean }
//
// Reglas:
// - to_phase > highest_phase_sent → dispara envío de la plantilla
//   correspondiente vía edge function inbox-v2-server /conversations/:id/send-template
//   (o broadcast/template si no hay conversation_id). Idempotente: si ya se mandó
//   esa fase no la reenvía.
// - to_phase ≤ highest_phase_sent → solo mueve visualmente.
// - to_phase ∈ {-1: respondió, -2: cerró/won, -3: perdido/lost} → marca estado
//   y NO dispara envío.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAgent } from "@/lib/agent-auth";

const sb = createClient(
  process.env.NEXT_PUBLIC_BLOG_SUPABASE_URL!,
  process.env.BLOG_SUPABASE_SERVICE_KEY!,
  { auth: { persistSession: false } },
);

const EDGE_BASE = `${process.env.NEXT_PUBLIC_BLOG_SUPABASE_URL}/functions/v1/inbox-v2-server`;
const ANON_KEY = process.env.NEXT_PUBLIC_BLOG_SUPABASE_ANON_KEY!;
const INBOX_SECRET = process.env.INBOX_SECRET ?? process.env.INSIGHTS_SECRET ?? "REDACTED_SECRET";

export const dynamic = "force-dynamic";

const STATE_RESPONDED = -1;
const STATE_WON = -2;
const STATE_LOST = -3;

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireAgent(req);
  if ("status" in auth) return auth;
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({})) as { to_phase?: number; note?: string; dry_run?: boolean };
  const toPhase = Number(body.to_phase);
  if (!Number.isInteger(toPhase)) return NextResponse.json({ error: "to_phase_required" }, { status: 400 });

  const { data: card } = await sb.from("pipeline_cards_v2").select("*").eq("id", id).maybeSingle();
  if (!card) return NextResponse.json({ error: "card_not_found" }, { status: 404 });

  const { data: fam } = await sb.from("pipeline_families_v2").select("*").eq("family", card.family).maybeSingle();
  if (!fam) return NextResponse.json({ error: "family_not_found" }, { status: 404 });

  const fromPhase = card.current_phase;

  // Estados especiales: solo marcamos, no enviamos
  if (toPhase < 0) {
    const patch: Record<string, unknown> = { current_phase: toPhase };
    if (toPhase === STATE_RESPONDED) patch.responded_at = new Date().toISOString();
    if (toPhase === STATE_WON || toPhase === STATE_LOST) patch.closed_at = new Date().toISOString();
    if (!body.dry_run) {
      await sb.from("pipeline_cards_v2").update(patch).eq("id", id);
      await sb.from("pipeline_events_v2").insert({
        card_id: id, from_phase: fromPhase, to_phase: toPhase,
        agent_email: auth.agent.email, note: body.note ?? null,
      });
    }
    return NextResponse.json({ ok: true, fired_template: false, to_phase: toPhase });
  }

  // Validar fase dentro del rango
  if (toPhase < 1 || toPhase > fam.total_phases) {
    return NextResponse.json({ error: `phase_out_of_range`, allowed: [1, fam.total_phases] }, { status: 400 });
  }

  // ¿Esta fase ya se envió antes? Si sí, solo movemos.
  const needSend = toPhase > card.highest_phase_sent;
  const templateName = (fam.template_by_phase as Record<string, string>)[String(toPhase)];

  if (needSend && !templateName) {
    return NextResponse.json({ error: "no_template_for_phase", phase: toPhase }, { status: 422 });
  }

  if (body.dry_run) {
    return NextResponse.json({ ok: true, would_send: needSend, template: needSend ? templateName : null });
  }

  let wamid: string | null = null;
  let sendError: string | null = null;

  if (needSend) {
    // Resolver número origen — usamos el default de whatsapp_numbers (is_default=true)
    const { data: defaultNum } = await sb
      .from("whatsapp_numbers")
      .select("phone_number, phone_number_id")
      .eq("status", "active")
      .eq("is_default", true)
      .limit(1)
      .maybeSingle();

    const fromNumber = defaultNum?.phone_number_id ?? defaultNum?.phone_number ?? null;

    try {
      let url: string;
      let payload: Record<string, unknown>;
      if (card.conversation_id) {
        url = `${EDGE_BASE}/conversations/${encodeURIComponent(card.conversation_id)}/send-template`;
        payload = {
          template_name: templateName,
          language: "es_ES",
          from_number: fromNumber,
          components: [],
          agent_name: auth.agent.email,
        };
      } else {
        url = `${EDGE_BASE}/broadcast/template`;
        payload = {
          template_name: templateName,
          language: "es_ES",
          from_number: fromNumber,
          phones: [card.whatsapp],
          components: [],
          agent_name: auth.agent.email,
        };
      }

      const r = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ANON_KEY}`,
          "x-inbox-secret": INBOX_SECRET,
        },
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        sendError = `${r.status} ${JSON.stringify(j).slice(0, 300)}`;
      } else {
        wamid = j?.messages?.[0]?.id ?? j?.wamid ?? null;
      }
    } catch (e) {
      sendError = e instanceof Error ? e.message : String(e);
    }

    if (sendError) {
      // No actualizamos la card si el envío falló — el agente verá el error y reintenta
      return NextResponse.json({ error: "send_failed", detail: sendError, template: templateName }, { status: 502 });
    }
  }

  // Aplicar movimiento
  const newHighest = Math.max(card.highest_phase_sent ?? 1, toPhase);
  await sb.from("pipeline_cards_v2").update({
    current_phase: toPhase,
    highest_phase_sent: newHighest,
    last_template_sent: needSend ? templateName : card.last_template_sent,
    last_template_sent_at: needSend ? new Date().toISOString() : card.last_template_sent_at,
  }).eq("id", id);

  await sb.from("pipeline_events_v2").insert({
    card_id: id, from_phase: fromPhase, to_phase: toPhase,
    agent_email: auth.agent.email,
    template_sent: needSend ? templateName : null,
    wamid,
    note: body.note ?? null,
  });

  return NextResponse.json({ ok: true, fired_template: needSend, template: needSend ? templateName : null, wamid });
}
