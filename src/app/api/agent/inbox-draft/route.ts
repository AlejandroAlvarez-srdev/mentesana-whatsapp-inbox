// POST /api/agent/inbox-draft  { conversation_id?: string, phone?: string }
// "✨ Borrador IA" de inbox-v2: supervisor → especialista con contexto de solo lectura.
// Devuelve { intent, draft_reply, suggested_actions, confidence, warnings, draft_id }.
// La IA NUNCA envía nada: el agente edita el borrador en el composer y envía a mano.
// Auth: cookie de agente (/agent/conversations) o de admin (/admin/inbox-v2).
// Apagado salvo NEXT_PUBLIC_INBOX_AI_DRAFT === "1".
import { NextRequest, NextResponse } from "next/server";
import { getAgent } from "@/lib/agent-auth";
import { isAdmin } from "@/lib/admin-auth";
import { buildDraftContext, loadConversation, logDraft } from "@/lib/inbox-agent/context";
import { makeAnthropicLlm } from "@/lib/inbox-agent/llm";
import { draftFromContext } from "@/lib/inbox-agent/specialist";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 45;

export async function POST(req: NextRequest) {
  if (process.env.NEXT_PUBLIC_INBOX_AI_DRAFT !== "1") {
    return NextResponse.json({ error: "disabled" }, { status: 404 });
  }
  const agent = await getAgent(req);
  if (!agent && !(await isAdmin(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { conversation_id?: unknown; phone?: unknown };
  const conversationId = typeof body.conversation_id === "string" ? body.conversation_id.trim().slice(0, 100) : null;
  const phone = typeof body.phone === "string" ? body.phone.replace(/[^\d+]/g, "").slice(0, 20) : null;
  if (!conversationId && !phone) return NextResponse.json({ error: "conversation_id o phone requerido" }, { status: 400 });

  const conv = await loadConversation({ conversationId, phone });
  if (!conv) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const t0 = Date.now();
  const { ctx, patientEmail } = await buildDraftContext(conv);
  if (ctx.turns.length === 0) return NextResponse.json({ error: "sin_mensajes" }, { status: 400 });

  const { result, meta } = await draftFromContext(ctx, {
    llm: makeAnthropicLlm(),
    patientPhone: conv.phone,
    patientEmail,
  });
  const latency = Date.now() - t0;

  const draftId = await logDraft({
    conversation_id: conv.id,
    agent_id: agent?.id ?? null,
    agent_email: agent?.email ?? "admin",
    intent: result.intent,
    confidence: result.confidence,
    draft_reply: result.draft_reply,
    suggested_actions: result.suggested_actions,
    warnings: result.warnings,
    supervisor_source: meta.decision.source,
    model: meta.model,
    parsed_ok: meta.parsed_ok,
    latency_ms: latency,
  });

  return NextResponse.json({ ...result, draft_id: draftId, supervisor_source: meta.decision.source });
}
