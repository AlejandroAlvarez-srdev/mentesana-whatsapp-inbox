"use client";

import { useEffect, useState } from "react";

const PURPLE = "#6A178C";

type Suggestion = {
  subject: string;
  preheader?: string;
  greeting?: string;
  paragraphs: string[];
  cta_label?: string;
  cta_url?: string;
  sign_off?: string;
  reason?: string;
};

const INTENTS: { id: string; label: string; emoji: string }[] = [
  { id: "seguimiento", label: "Seguimiento", emoji: "💬" },
  { id: "reactivacion", label: "Reactivación", emoji: "🔄" },
  { id: "diagnostico", label: "Diagnóstico 9,99€", emoji: "🧠" },
  { id: "paquete", label: "Paquete sesiones", emoji: "📦" },
  { id: "app", label: "App móvil", emoji: "📱" },
  { id: "bienvenida", label: "Bienvenida", emoji: "👋" },
];

export default function EmailSuggestModal({
  conversationId,
  initialEmail,
  initialName,
  onClose,
  onSent,
}: {
  conversationId: string;
  initialEmail: string | null;
  initialName: string | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const [intent, setIntent] = useState("seguimiento");
  const [note, setNote] = useState("");
  const [to, setTo] = useState(initialEmail ?? "");
  const [toName, setToName] = useState(initialName ?? "");
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function suggest() {
    setLoading(true);
    setErr(null);
    setSuggestion(null);
    setPreviewHtml("");
    try {
      const r = await fetch("/api/agent/email/suggest", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: conversationId, intent, note: note.trim() || undefined }),
      });
      if (!r.ok) {
        const t = await r.text();
        throw new Error(`${r.status} · ${t.slice(0, 200)}`);
      }
      const d = await r.json();
      const s: Suggestion = d.suggestion;
      setSuggestion(s);
      setReason(s.reason ?? "");
      if (!to && d.context?.email) setTo(d.context.email);
      if (!toName && d.context?.lead_name) setToName(d.context.lead_name);
      await renderPreview(s);
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  async function renderPreview(s: Suggestion) {
    try {
      const r = await fetch("/api/agent/email/preview", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suggestion: s }),
      });
      if (r.ok) {
        const d = await r.json();
        setPreviewHtml(d.html);
      }
    } catch { /* ignore */ }
  }

  function updateField<K extends keyof Suggestion>(key: K, val: Suggestion[K]) {
    if (!suggestion) return;
    const next = { ...suggestion, [key]: val };
    setSuggestion(next);
    void renderPreview(next);
  }

  function updateParagraph(i: number, val: string) {
    if (!suggestion) return;
    const paragraphs = [...suggestion.paragraphs];
    paragraphs[i] = val;
    const next = { ...suggestion, paragraphs };
    setSuggestion(next);
    void renderPreview(next);
  }

  async function send() {
    if (!suggestion || !to) return;
    setSending(true);
    setErr(null);
    try {
      const r = await fetch("/api/agent/email/send", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversationId,
          to,
          to_name: toName || null,
          suggestion,
        }),
      });
      if (!r.ok) {
        const t = await r.text();
        throw new Error(`${r.status} · ${t.slice(0, 200)}`);
      }
      setSent(true);
      setTimeout(() => { onSent(); onClose(); }, 1200);
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setSending(false);
    }
  }

  // Genera de inmediato la primera sugerencia al abrir
  useEffect(() => { void suggest(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, animation: "ms-fade-in 0.18s" }} />
      <div
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(1100px, 95vw)",
          height: "min(90vh, 800px)",
          background: "#fff",
          borderRadius: 16,
          zIndex: 101,
          boxShadow: "0 30px 80px rgba(0,0,0,0.3)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <header style={{ padding: "14px 18px", borderBottom: "1px solid rgba(0,0,0,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <strong style={{ fontSize: 15, color: "#1a1a2e" }}>✉️ Sugerir email con IA</strong>
            <span style={{ fontSize: 11, color: "#888" }}>· Brevo</span>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", fontSize: 22, cursor: "pointer", color: "#666" }}>×</button>
        </header>

        {/* Intent + nota */}
        <div style={{ padding: "10px 18px", borderBottom: "1px solid rgba(0,0,0,0.04)", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", background: "rgba(106,23,140,0.02)" }}>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {INTENTS.map((it) => (
              <button
                key={it.id}
                type="button"
                onClick={() => setIntent(it.id)}
                style={{
                  padding: "5px 10px",
                  fontSize: 11,
                  fontWeight: 700,
                  borderRadius: 999,
                  border: intent === it.id ? `2px solid ${PURPLE}` : "1px solid rgba(0,0,0,0.1)",
                  background: intent === it.id ? PURPLE : "#fff",
                  color: intent === it.id ? "#fff" : "#475569",
                  cursor: "pointer",
                }}
              >
                {it.emoji} {it.label}
              </button>
            ))}
          </div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Nota opcional para la IA (ej: 'no menciones precio', 'incluir referencia a su última sesión')"
            style={{ flex: 1, minWidth: 280, padding: "6px 10px", fontSize: 12, border: "1px solid rgba(0,0,0,0.1)", borderRadius: 8, fontFamily: "inherit" }}
          />
          <button
            onClick={suggest}
            disabled={loading}
            style={{
              padding: "6px 14px",
              fontSize: 12,
              fontWeight: 800,
              borderRadius: 8,
              border: "none",
              cursor: loading ? "default" : "pointer",
              background: loading ? "rgba(0,0,0,0.08)" : PURPLE,
              color: loading ? "#888" : "#fff",
            }}
          >
            {loading ? "Pensando…" : suggestion ? "🔄 Regenerar" : "✨ Generar"}
          </button>
        </div>

        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.1fr)", minHeight: 0 }}>
          {/* Edit pane */}
          <div style={{ padding: 18, overflow: "auto", borderRight: "1px solid rgba(0,0,0,0.06)", background: "#fafafa" }}>
            {err && (
              <div style={{ padding: 10, background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", borderRadius: 8, fontSize: 12, marginBottom: 12 }}>
                ⚠️ {err}
              </div>
            )}
            {loading && !suggestion && <div style={{ color: "#888", fontSize: 13 }}>Generando copy…</div>}
            {suggestion && (
              <>
                {reason && (
                  <div style={{ padding: 10, background: "rgba(106,23,140,0.05)", borderRadius: 8, fontSize: 11.5, color: PURPLE, marginBottom: 14, lineHeight: 1.5 }}>
                    💡 <strong>Razón IA:</strong> {reason}
                  </div>
                )}
                <Field label="Destinatario">
                  <div style={{ display: "flex", gap: 6 }}>
                    <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="email@..." style={inputStyle} />
                    <input value={toName} onChange={(e) => setToName(e.target.value)} placeholder="Nombre" style={{ ...inputStyle, maxWidth: 140 }} />
                  </div>
                </Field>
                <Field label="Asunto">
                  <input value={suggestion.subject} onChange={(e) => updateField("subject", e.target.value)} style={inputStyle} />
                </Field>
                <Field label="Preheader">
                  <input value={suggestion.preheader ?? ""} onChange={(e) => updateField("preheader", e.target.value)} style={inputStyle} />
                </Field>
                <Field label="Saludo">
                  <input value={suggestion.greeting ?? ""} onChange={(e) => updateField("greeting", e.target.value)} style={inputStyle} />
                </Field>
                {suggestion.paragraphs.map((p, i) => (
                  <Field key={i} label={`Párrafo ${i + 1}`}>
                    <textarea value={p} onChange={(e) => updateParagraph(i, e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }} />
                  </Field>
                ))}
                <Field label="Botón (texto)">
                  <input value={suggestion.cta_label ?? ""} onChange={(e) => updateField("cta_label", e.target.value)} style={inputStyle} />
                </Field>
                <Field label="Botón (URL)">
                  <input value={suggestion.cta_url ?? ""} onChange={(e) => updateField("cta_url", e.target.value)} style={inputStyle} />
                </Field>
                <Field label="Cierre">
                  <textarea value={suggestion.sign_off ?? ""} onChange={(e) => updateField("sign_off", e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }} />
                </Field>
              </>
            )}
          </div>

          {/* Preview pane */}
          <div style={{ display: "flex", flexDirection: "column", minHeight: 0, background: "#FFFAF2" }}>
            <div style={{ padding: "8px 14px", borderBottom: "1px solid rgba(0,0,0,0.04)", fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 0.5, background: "#fff" }}>
              👀 Preview (así lo verá el cliente)
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: "hidden", background: "#FFFAF2" }}>
              {previewHtml ? (
                <iframe srcDoc={previewHtml} sandbox="allow-same-origin" title="Email preview" style={{ width: "100%", height: "100%", border: "none", background: "transparent" }} />
              ) : (
                <div style={{ padding: 40, textAlign: "center", color: "#aaa", fontSize: 13 }}>{loading ? "Generando…" : "El preview aparecerá aquí"}</div>
              )}
            </div>
          </div>
        </div>

        <footer style={{ padding: "12px 18px", borderTop: "1px solid rgba(0,0,0,0.06)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, background: "#fff" }}>
          <span style={{ fontSize: 11.5, color: "#888" }}>
            {sent ? "✅ Email enviado correctamente" : suggestion && to ? `Listo para enviar a ${to}` : "Genera y revisa antes de enviar"}
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose} disabled={sending} style={btnGhost}>Cancelar</button>
            <button
              onClick={send}
              disabled={!suggestion || !to || sending || sent}
              style={{
                padding: "8px 18px",
                fontSize: 12,
                fontWeight: 800,
                borderRadius: 8,
                border: "none",
                cursor: !suggestion || !to || sending || sent ? "default" : "pointer",
                background: !suggestion || !to || sending || sent ? "rgba(0,0,0,0.08)" : "linear-gradient(135deg, #6A178C 0%, #8B2FB5 100%)",
                color: !suggestion || !to || sending || sent ? "#888" : "#fff",
                letterSpacing: 0.3,
                boxShadow: !suggestion || !to || sending || sent ? "none" : "0 2px 10px rgba(106,23,140,0.3)",
              }}
            >
              {sent ? "✅ Enviado" : sending ? "Enviando…" : "📤 Enviar vía Brevo"}
            </button>
          </div>
        </footer>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "7px 10px",
  fontSize: 13,
  border: "1px solid rgba(0,0,0,0.12)",
  borderRadius: 8,
  background: "#fff",
  boxSizing: "border-box",
  fontFamily: "inherit",
  color: "#1a1a2e",
};

const btnGhost: React.CSSProperties = {
  padding: "8px 14px",
  fontSize: 12,
  fontWeight: 700,
  borderRadius: 8,
  border: "1px solid rgba(0,0,0,0.1)",
  background: "#fff",
  color: "#475569",
  cursor: "pointer",
};
