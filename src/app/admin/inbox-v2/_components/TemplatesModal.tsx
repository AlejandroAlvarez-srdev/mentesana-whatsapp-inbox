"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const PURPLE = "#6A178C";

type Template = { name: string; count: number };
type WaNumber = { phone_number_id: string; name: string; phone_number: string | null; is_default: boolean; status: string; is_pdf_number: boolean };

type ConversationLite = {
  id: string;
  phone: string;
  lead_name: string | null;
};

type Mode = "single" | "bulk";

type BulkResult = {
  ok: boolean;
  sent_from: { name: string; phone_number_id: string };
  total: number;
  success: number;
  failed: number;
  results: { phone: string; ok: boolean; wamid?: string; error?: string; conversation_id?: string }[];
};

export default function TemplatesModal({
  open,
  onClose,
  conversation,
  defaultFromNumberId,
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  conversation: ConversationLite | null;
  defaultFromNumberId?: string | null;
  onSent?: () => void;
}) {
  const [mode, setMode] = useState<Mode>("single");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [numbers, setNumbers] = useState<WaNumber[]>([]);
  const [selectedTpl, setSelectedTpl] = useState<string>("");
  const [language, setLanguage] = useState("es");
  const [fromNumberId, setFromNumberId] = useState<string>("");
  const [searchTpl, setSearchTpl] = useState("");
  const [bulkInput, setBulkInput] = useState("");
  const [sending, setSending] = useState(false);
  const [singleResult, setSingleResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const phonesTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    setSingleResult(null);
    setBulkResult(null);
    setLoadErr(null);
    Promise.all([
      fetch("/api/admin/inbox-v2/templates", { credentials: "include" }).then((r) => (r.ok ? r.json() : Promise.reject(`templates ${r.status}`))),
      fetch("/api/admin/inbox-v2/whatsapp-numbers", { credentials: "include" }).then((r) => (r.ok ? r.json() : Promise.reject(`numbers ${r.status}`))),
    ])
      .then(([t, n]) => {
        setTemplates(t.templates ?? []);
        const nums: WaNumber[] = (n.numbers ?? []).filter((x: WaNumber) => x.status === "active" && !x.is_pdf_number);
        setNumbers(nums);
        if (!fromNumberId) {
          const initial = defaultFromNumberId && nums.find((x) => x.phone_number_id === defaultFromNumberId) ? defaultFromNumberId : nums.find((x) => x.is_default)?.phone_number_id ?? nums[0]?.phone_number_id ?? "";
          setFromNumberId(initial);
        }
      })
      .catch((e) => setLoadErr(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultFromNumberId]);

  const filteredTpls = useMemo(() => {
    const q = searchTpl.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter((t) => t.name.toLowerCase().includes(q));
  }, [templates, searchTpl]);

  const parsedPhones = useMemo(() => parsePhones(bulkInput), [bulkInput]);

  if (!open) return null;

  async function sendSingle() {
    if (!conversation || !selectedTpl) return;
    setSending(true);
    setSingleResult(null);
    try {
      const r = await fetch(`/api/admin/inbox-v2/conversations/${encodeURIComponent(conversation.id)}/send-template`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template_name: selectedTpl,
          language,
          from_number: fromNumberId || undefined,
          agent_name: "agente",
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        setSingleResult({ ok: true, msg: `Enviado a ${conversation.lead_name?.trim() || conversation.phone} desde ${j.sent_from?.name ?? "?"}` });
        onSent?.();
      } else {
        setSingleResult({ ok: false, msg: `${r.status} · ${j.error ?? "error"}${j.detail ? " · " + j.detail.slice(0, 160) : ""}` });
      }
    } catch (e: any) {
      setSingleResult({ ok: false, msg: String(e.message ?? e) });
    } finally {
      setSending(false);
    }
  }

  async function sendBulk() {
    if (!selectedTpl) return;
    if (parsedPhones.length === 0) return;
    if (parsedPhones.length > 500) {
      setBulkResult({ ok: false, sent_from: { name: "", phone_number_id: "" }, total: parsedPhones.length, success: 0, failed: parsedPhones.length, results: [] });
      return;
    }
    if (!confirm(`Vas a enviar la plantilla "${selectedTpl}" a ${parsedPhones.length} contactos desde "${numbers.find((n) => n.phone_number_id === fromNumberId)?.name ?? "?"}". ¿Continuar?`)) return;
    setSending(true);
    setBulkResult(null);
    try {
      const r = await fetch("/api/admin/inbox-v2/broadcast/template", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template_name: selectedTpl,
          language,
          from_number: fromNumberId,
          phones: parsedPhones,
          agent_name: "agente",
        }),
      });
      const j = await r.json();
      setBulkResult(j as BulkResult);
      if (j.ok) onSent?.();
    } catch (e: any) {
      setBulkResult({ ok: false, sent_from: { name: "", phone_number_id: fromNumberId }, total: parsedPhones.length, success: 0, failed: parsedPhones.length, results: [{ phone: "—", ok: false, error: String(e.message ?? e) }] });
    } finally {
      setSending(false);
    }
  }

  return (
    <div onClick={onClose} style={overlayStyle}>
      <div onClick={(e) => e.stopPropagation()} style={modalStyle}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, padding: "16px 20px", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#1a1a2e" }}>📋 Plantillas Meta WhatsApp</h2>
          <span style={{ fontSize: 12, color: "#888" }}>{templates.length} plantillas · {numbers.length} números disponibles</span>
          <button onClick={onClose} style={{ marginLeft: "auto", border: "none", background: "transparent", fontSize: 22, cursor: "pointer", color: "#888" }}>×</button>
        </div>

        {/* Tabs mode */}
        <div style={{ display: "flex", gap: 4, padding: "10px 20px 0", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
          <TabBtn cur={mode} v="single" set={setMode} label={conversation ? `Esta conversación · ${conversation.lead_name?.trim() || conversation.phone}` : "Una conversación"} disabled={!conversation} />
          <TabBtn cur={mode} v="bulk" set={setMode} label="📣 Envío masivo (bulk)" />
        </div>

        {loadErr && <div style={errBox}>{loadErr}</div>}

        {/* Body 2 columns: left = template chooser, right = send controls + result */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, flex: 1, minHeight: 0 }}>
          {/* LEFT — pick template */}
          <div style={{ borderRight: "1px solid rgba(0,0,0,0.06)", padding: 16, overflowY: "auto", minHeight: 0 }}>
            <div style={{ fontSize: 11, color: "#888", fontWeight: 700, letterSpacing: 0.5, marginBottom: 8 }}>1. ELEGIR PLANTILLA</div>
            <input
              type="text"
              value={searchTpl}
              onChange={(e) => setSearchTpl(e.target.value)}
              placeholder="Buscar plantilla…"
              style={{ width: "100%", padding: "8px 12px", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 8, fontSize: 13, marginBottom: 10, boxSizing: "border-box" }}
            />
            <div style={{ display: "grid", gap: 4 }}>
              {filteredTpls.length === 0 && <div style={{ fontSize: 12, color: "#aaa", padding: 12 }}>Sin resultados.</div>}
              {filteredTpls.map((t) => (
                <button
                  key={t.name}
                  onClick={() => setSelectedTpl(t.name)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "10px 12px",
                    fontSize: 12.5,
                    background: selectedTpl === t.name ? "rgba(106,23,140,0.08)" : "#fff",
                    border: `1px solid ${selectedTpl === t.name ? PURPLE : "rgba(0,0,0,0.06)"}`,
                    borderRadius: 8,
                    cursor: "pointer",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span style={{ fontFamily: "ui-monospace, monospace", color: "#1a1a2e", overflow: "hidden", textOverflow: "ellipsis" }}>{t.name}</span>
                  <span style={{ fontSize: 10, color: "#888", marginLeft: 8, flexShrink: 0 }}>×{t.count}</span>
                </button>
              ))}
            </div>
          </div>

          {/* RIGHT — send controls + result */}
          <div style={{ padding: 16, display: "flex", flexDirection: "column", minHeight: 0, overflowY: "auto" }}>
            {/* Send from number */}
            <div style={{ fontSize: 11, color: "#888", fontWeight: 700, letterSpacing: 0.5, marginBottom: 8 }}>2. ENVIAR DESDE</div>
            <select
              value={fromNumberId}
              onChange={(e) => setFromNumberId(e.target.value)}
              style={{ padding: "8px 12px", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 8, fontSize: 13, marginBottom: 12, background: "#fff" }}
            >
              {numbers.length === 0 && <option value="">(sin números cargados)</option>}
              {numbers.map((n) => (
                <option key={n.phone_number_id} value={n.phone_number_id}>
                  {n.name?.trim()}{n.phone_number ? ` · ${n.phone_number}` : ""}{n.is_default ? " · default" : ""}
                </option>
              ))}
            </select>

            {/* Language */}
            <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 14 }}>
              <span style={{ fontSize: 11, color: "#888", fontWeight: 600 }}>Idioma:</span>
              <select value={language} onChange={(e) => setLanguage(e.target.value)} style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid rgba(0,0,0,0.1)", fontSize: 12 }}>
                <option value="es">es</option>
                <option value="es_MX">es_MX</option>
                <option value="es_ES">es_ES</option>
                <option value="en">en</option>
              </select>
            </div>

            {/* Per-mode actions */}
            {mode === "single" && (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
                <div style={{ fontSize: 11, color: "#888", fontWeight: 700, letterSpacing: 0.5, marginBottom: 8 }}>3. ENVIAR</div>
                {conversation ? (
                  <div style={{ padding: 12, background: "rgba(106,23,140,0.04)", borderRadius: 8, marginBottom: 10, fontSize: 13 }}>
                    Destinatario: <strong>{conversation.lead_name?.trim() || "(sin nombre)"}</strong>{" "}
                    <span style={{ color: "#888" }}>· {conversation.phone}</span>
                  </div>
                ) : (
                  <div style={{ padding: 12, background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 8, marginBottom: 10, fontSize: 12, color: "#92400e" }}>
                    No hay conversación abierta. Cambia a la pestaña &ldquo;Envío masivo&rdquo;.
                  </div>
                )}
                <button
                  onClick={sendSingle}
                  disabled={!conversation || !selectedTpl || sending}
                  style={primaryBtn(!conversation || !selectedTpl || sending)}
                >
                  {sending ? "Enviando…" : `Enviar plantilla a ${conversation?.lead_name?.trim() || conversation?.phone || "lead"}`}
                </button>
                {singleResult && (
                  <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: singleResult.ok ? "#ecfdf5" : "#fef2f2", color: singleResult.ok ? "#065f46" : "#991b1b", fontSize: 12, border: `1px solid ${singleResult.ok ? "#a7f3d0" : "#fecaca"}` }}>
                    {singleResult.ok ? "✅ " : "❌ "}
                    {singleResult.msg}
                  </div>
                )}
              </div>
            )}

            {mode === "bulk" && (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
                <div style={{ fontSize: 11, color: "#888", fontWeight: 700, letterSpacing: 0.5, marginBottom: 8 }}>3. PEGAR TELÉFONOS (separados por comas, espacios o saltos de línea)</div>
                <textarea
                  ref={phonesTextareaRef}
                  value={bulkInput}
                  onChange={(e) => setBulkInput(e.target.value)}
                  rows={6}
                  placeholder="34XXXXXXXXX, 34XXXXXXXXX&#10;34XXXXXXXXX&#10;34XXXXXXXXX"
                  style={{ width: "100%", padding: 10, fontSize: 12, fontFamily: "ui-monospace, monospace", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 8, resize: "vertical", boxSizing: "border-box", minHeight: 110 }}
                />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6, marginBottom: 10, fontSize: 11 }}>
                  <span style={{ color: parsedPhones.length > 500 ? "#dc2626" : "#666" }}>
                    {parsedPhones.length} teléfono{parsedPhones.length === 1 ? "" : "s"} válidos {parsedPhones.length > 500 && "(máx 500)"}
                  </span>
                  <button onClick={() => setBulkInput("")} style={{ background: "transparent", border: "none", color: "#888", cursor: "pointer", fontSize: 11 }}>Limpiar</button>
                </div>
                <button
                  onClick={sendBulk}
                  disabled={!selectedTpl || parsedPhones.length === 0 || parsedPhones.length > 500 || sending}
                  style={primaryBtn(!selectedTpl || parsedPhones.length === 0 || parsedPhones.length > 500 || sending)}
                >
                  {sending ? `Enviando a ${parsedPhones.length}…` : `📤 Enviar a ${parsedPhones.length} contacto${parsedPhones.length === 1 ? "" : "s"}`}
                </button>

                {bulkResult && (
                  <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: bulkResult.success === bulkResult.total ? "#ecfdf5" : bulkResult.success === 0 ? "#fef2f2" : "#fffbeb", border: `1px solid ${bulkResult.success === bulkResult.total ? "#a7f3d0" : bulkResult.success === 0 ? "#fecaca" : "#fde68a"}`, fontSize: 12 }}>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>
                      {bulkResult.success === bulkResult.total ? "✅" : "⚠️"} {bulkResult.success} / {bulkResult.total} enviados desde {bulkResult.sent_from?.name ?? "?"}
                    </div>
                    {bulkResult.failed > 0 && (
                      <details>
                        <summary style={{ cursor: "pointer", color: "#92400e", fontSize: 11 }}>{bulkResult.failed} fallidos · ver detalle</summary>
                        <div style={{ marginTop: 6, maxHeight: 200, overflowY: "auto", fontSize: 11, fontFamily: "ui-monospace, monospace" }}>
                          {bulkResult.results.filter((r) => !r.ok).map((r, i) => (
                            <div key={i} style={{ padding: "3px 0", borderBottom: "1px dashed rgba(0,0,0,0.05)" }}>
                              <strong>{r.phone}</strong>: {r.error}
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function parsePhones(input: string): string[] {
  const raw = input.split(/[\s,;]+/).map((s) => s.trim().replace(/[^\d+]/g, "").replace(/^\+/, ""));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of raw) {
    if (!p) continue;
    if (p.length < 8 || p.length > 16) continue;
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

function TabBtn({ cur, v, set, label, disabled }: { cur: Mode; v: Mode; set: (v: Mode) => void; label: string; disabled?: boolean }) {
  const active = cur === v;
  return (
    <button
      onClick={() => !disabled && set(v)}
      disabled={disabled}
      style={{
        padding: "10px 16px",
        fontSize: 13,
        fontWeight: 600,
        background: active ? "#fff" : "transparent",
        color: disabled ? "#bbb" : active ? PURPLE : "#666",
        border: "none",
        borderBottom: active ? `2px solid ${PURPLE}` : "2px solid transparent",
        marginBottom: -1,
        cursor: disabled ? "default" : "pointer",
      }}
    >
      {label}
    </button>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 100,
  padding: 20,
};
const modalStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 16,
  width: "min(900px, 100%)",
  height: "min(700px, 95vh)",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  boxShadow: "0 24px 80px rgba(0,0,0,0.25)",
};
const errBox: React.CSSProperties = { padding: 10, margin: "10px 20px", background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", fontSize: 12, borderRadius: 8 };
const primaryBtn = (disabled: boolean): React.CSSProperties => ({
  padding: "11px 18px",
  borderRadius: 8,
  border: "none",
  background: disabled ? "rgba(0,0,0,0.06)" : PURPLE,
  color: disabled ? "#888" : "#fff",
  fontSize: 13,
  fontWeight: 700,
  cursor: disabled ? "default" : "pointer",
});
