"use client";

// "✨ Borrador IA" (humano en el bucle). Pide un borrador a /api/agent/inbox-draft, lo mete en
// el composer (mismo evento que usa ProposeAppointmentModal) y enseña las acciones sugeridas
// como chips. La IA NUNCA envía: nada se ejecuta sin el clic del agente y el envío es manual.
// Solo se monta si NEXT_PUBLIC_INBOX_AI_DRAFT === "1".
import { useState } from "react";

const PURPLE = "#6A178C";

export const AI_DRAFT_ENABLED = process.env.NEXT_PUBLIC_INBOX_AI_DRAFT === "1";

type Action = { type: "proponer_cita" | "enviar_plantilla" | "escalar_humano"; params: Record<string, string | number | boolean | null>; reason: string };
type Draft = { intent: string; draft_reply: string; suggested_actions: Action[]; confidence: number; warnings: string[] };

const INTENT_META: Record<string, { label: string; bg: string; fg: string }> = {
  venta: { label: "💸 Venta", bg: "rgba(22,163,74,0.12)", fg: "#065f46" },
  "cita-reagenda": { label: "📅 Cita / reagenda", bg: "rgba(8,145,178,0.12)", fg: "#0e7490" },
  "soporte-app": { label: "🛠️ Soporte", bg: "rgba(106,23,140,0.1)", fg: PURPLE },
  queja: { label: "😤 Queja", bg: "rgba(245,158,11,0.16)", fg: "#92400e" },
  "clinico-urgente": { label: "🚨 Clínico urgente", bg: "rgba(220,38,38,0.14)", fg: "#991b1b" },
  otro: { label: "💬 Otro", bg: "rgba(0,0,0,0.06)", fg: "#444" },
};

const ACTION_LABEL: Record<Action["type"], string> = {
  proponer_cita: "📅 Proponer cita",
  enviar_plantilla: "📋 Enviar plantilla",
  escalar_humano: "🙋 Escalar a coordinación",
};

export default function AiDraftBar({
  conversationId,
  onProposeCita,
  onOpenTemplates,
}: {
  conversationId: string;
  onProposeCita: (providerAmeliaId: number | null) => void;
  onOpenTemplates: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [openReason, setOpenReason] = useState<number | null>(null);

  async function generate() {
    if (loading) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch("/api/agent/inbox-draft", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversation_id: conversationId }),
      });
      if (!r.ok) throw new Error(r.status === 401 ? "Sesión caducada" : `HTTP ${r.status}`);
      const d = (await r.json()) as Draft;
      setDraft(d);
      setOpenReason(d.intent === "clinico-urgente" ? 0 : null);
      // Rellena el composer (si el agente ya había escrito algo, el composer pregunta antes de reemplazar).
      if (d.draft_reply) {
        window.dispatchEvent(new CustomEvent("inbox:insert-composer", { detail: { text: d.draft_reply, replace: true } }));
      }
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    } finally {
      setLoading(false);
    }
  }

  function onAction(a: Action, i: number) {
    if (a.type === "proponer_cita") {
      const pid = typeof a.params.provider_amelia_id === "number" ? a.params.provider_amelia_id : null;
      onProposeCita(pid);
    } else if (a.type === "enviar_plantilla") {
      onOpenTemplates();
    } else {
      // Escalar: no ejecuta nada, solo muestra la nota/protocolo para que el agente actúe.
      setOpenReason((cur) => (cur === i ? null : i));
    }
  }

  const im = draft ? INTENT_META[draft.intent] ?? INTENT_META.otro : null;
  const urgent = draft?.intent === "clinico-urgente";

  return (
    <div style={{ padding: "6px 14px", borderTop: "1px solid rgba(0,0,0,0.06)", background: urgent ? "#fef2f2" : "#fff" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <button
          onClick={generate}
          disabled={loading}
          title="Genera un borrador con IA. Revísalo y envíalo tú: la IA nunca envía."
          style={{ padding: "5px 10px", borderRadius: 7, border: `1px solid ${PURPLE}55`, background: loading ? "rgba(0,0,0,0.04)" : `${PURPLE}0d`, color: PURPLE, cursor: loading ? "default" : "pointer", fontSize: 11.5, fontWeight: 700 }}
        >
          {loading ? "⏳ Pensando…" : draft ? "✨ Otro borrador" : "✨ Borrador IA"}
        </button>
        {im && (
          <span style={{ padding: "3px 8px", borderRadius: 999, background: im.bg, color: im.fg, fontSize: 11, fontWeight: 700 }}>
            {im.label} · {Math.round((draft?.confidence ?? 0) * 100)}%
          </span>
        )}
        {draft?.suggested_actions.map((a, i) => (
          <button
            key={`${a.type}-${i}`}
            onClick={() => onAction(a, i)}
            title={a.reason}
            style={{ padding: "4px 9px", borderRadius: 999, border: `1px solid ${a.type === "escalar_humano" ? "#fca5a5" : `${PURPLE}44`}`, background: a.type === "escalar_humano" ? "#fff1f2" : "#fff", color: a.type === "escalar_humano" ? "#991b1b" : PURPLE, cursor: "pointer", fontSize: 11, fontWeight: 700 }}
          >
            {ACTION_LABEL[a.type]}
          </button>
        ))}
        {draft && (
          <button onClick={() => { setDraft(null); setOpenReason(null); }} title="Cerrar sugerencias" style={{ marginLeft: "auto", background: "transparent", border: "none", color: "#999", cursor: "pointer", fontSize: 14 }}>×</button>
        )}
      </div>
      {openReason != null && draft?.suggested_actions[openReason] && (
        <div style={{ marginTop: 6, fontSize: 11.5, color: urgent ? "#7f1d1d" : "#444", lineHeight: 1.45, fontWeight: urgent ? 700 : 400 }}>
          {draft.suggested_actions[openReason].reason}
        </div>
      )}
      {draft && draft.warnings.length > 0 && (
        <ul style={{ margin: "6px 0 0", paddingLeft: 16, fontSize: 11, color: "#92400e", lineHeight: 1.4 }}>
          {draft.warnings.map((w, i) => <li key={i}>{w}</li>)}
        </ul>
      )}
      {draft && <div style={{ marginTop: 4, fontSize: 10, color: "#aaa" }}>Borrador de IA: revísalo antes de enviar. Nada se envía solo.</div>}
      {err && <div style={{ marginTop: 4, fontSize: 11, color: "#991b1b" }}>No se pudo generar el borrador: {err}</div>}
    </div>
  );
}
