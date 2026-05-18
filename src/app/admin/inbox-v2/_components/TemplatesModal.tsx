"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const PURPLE = "#6A178C";

type Component = {
  type: "HEADER" | "BODY" | "FOOTER" | "BUTTONS";
  format?: "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT" | "LOCATION";
  text?: string;
  example?: { header_text?: string[]; body_text?: string[][]; header_handle?: string[] };
  buttons?: { type: string; text?: string; url?: string }[];
};
type MetaTemplate = {
  name: string;
  language: string;
  status: string;
  category: string;
  components: Component[];
  available_from: { phone_number_id: string; name: string }[];
  usage_count: number;
};

type WaNumber = { phone_number_id: string; name: string; phone_number: string | null; is_default: boolean; status: string; is_pdf_number: boolean; business_account_id?: string | null };
type ConversationLite = { id: string; phone: string; lead_name: string | null };
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
  apiBase = "/api/admin/inbox-v2",
}: {
  open: boolean;
  onClose: () => void;
  conversation: ConversationLite | null;
  defaultFromNumberId?: string | null;
  onSent?: () => void;
  apiBase?: string;
}) {
  const [mode, setMode] = useState<Mode>("single");
  const [templates, setTemplates] = useState<MetaTemplate[]>([]);
  const [templateErrors, setTemplateErrors] = useState<string[]>([]);
  const [numbers, setNumbers] = useState<WaNumber[]>([]);
  const [selected, setSelected] = useState<MetaTemplate | null>(null);
  const [fromNumberId, setFromNumberId] = useState<string>("");
  const [searchTpl, setSearchTpl] = useState("");
  const [bulkInput, setBulkInput] = useState("");
  const [personalize, setPersonalize] = useState(false);
  const [sending, setSending] = useState(false);
  const [singleResult, setSingleResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  // Variables fill state (modo no-personalizado: mismos valores para todos)
  const [bodyVars, setBodyVars] = useState<string[]>([]);
  const [headerVars, setHeaderVars] = useState<string[]>([]);
  const [headerMediaUrl, setHeaderMediaUrl] = useState("");

  useEffect(() => {
    if (!open) return;
    setSingleResult(null);
    setBulkResult(null);
    setLoadErr(null);
    Promise.all([
      fetch(`${apiBase}/meta-templates`, { credentials: "include" }).then((r) => (r.ok ? r.json() : Promise.reject(`meta-templates ${r.status}`))),
      fetch(`${apiBase}/whatsapp-numbers`, { credentials: "include" }).then((r) => (r.ok ? r.json() : Promise.reject(`numbers ${r.status}`))),
    ])
      .then(([t, n]) => {
        setTemplates(t.templates ?? []);
        setTemplateErrors(t.errors ?? []);
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

  // Filtra por número origen (solo plantillas disponibles desde el WABA seleccionado)
  const filteredTpls = useMemo(() => {
    const q = searchTpl.trim().toLowerCase();
    return templates
      .filter((t) => t.status === "APPROVED")
      .filter((t) => !fromNumberId || t.available_from.some((x) => x.phone_number_id === fromNumberId))
      .filter((t) => !q || t.name.toLowerCase().includes(q) || (componentText(t, "BODY") ?? "").toLowerCase().includes(q));
  }, [templates, searchTpl, fromNumberId]);

  // Cuando se elige una plantilla, reinicia los inputs de variables
  useEffect(() => {
    if (!selected) {
      setBodyVars([]);
      setHeaderVars([]);
      setHeaderMediaUrl("");
      return;
    }
    const body = componentText(selected, "BODY") ?? "";
    const header = componentText(selected, "HEADER") ?? "";
    setBodyVars(Array(countVars(body)).fill(""));
    setHeaderVars(Array(countVars(header)).fill(""));
    setHeaderMediaUrl("");
  }, [selected?.name, selected?.language]);

  const parsedPhones = useMemo(() => parsePhones(bulkInput), [bulkInput]);

  // Para modo personalizado: cuántas variables esperar por línea (header text + body), si header es media no entra como variable
  const expectedVarsPerLine = useMemo(() => {
    if (!selected) return 0;
    const headerComp = selected.components.find((c) => c.type === "HEADER");
    const headerTextVars = headerComp?.format === "TEXT" ? countVars(headerComp.text ?? "") : 0;
    const bodyComp = selected.components.find((c) => c.type === "BODY");
    const bodyTextVars = countVars(bodyComp?.text ?? "");
    return headerTextVars + bodyTextVars;
  }, [selected]);

  const parsedRecipients = useMemo(() => {
    if (!personalize || !selected) return [] as { phone: string; headerVars: string[]; bodyVars: string[]; lineNumber: number; lineRaw: string; ok: boolean; reason?: string }[];
    const headerComp = selected.components.find((c) => c.type === "HEADER");
    const headerTextVars = headerComp?.format === "TEXT" ? countVars(headerComp.text ?? "") : 0;
    const bodyComp = selected.components.find((c) => c.type === "BODY");
    const bodyTextVars = countVars(bodyComp?.text ?? "");
    return parsePersonalized(bulkInput, headerTextVars, bodyTextVars);
  }, [bulkInput, personalize, selected]);

  const validRecipientsCount = personalize ? parsedRecipients.filter((r) => r.ok).length : parsedPhones.length;
  const invalidRecipientsCount = personalize ? parsedRecipients.filter((r) => !r.ok).length : 0;

  if (!open) return null;

  const headerComp = selected?.components.find((c) => c.type === "HEADER");
  const bodyComp = selected?.components.find((c) => c.type === "BODY");
  const footerComp = selected?.components.find((c) => c.type === "FOOTER");
  const buttonsComp = selected?.components.find((c) => c.type === "BUTTONS");
  const needsMediaHeader = headerComp && ["IMAGE", "VIDEO", "DOCUMENT"].includes(headerComp.format ?? "");

  function buildComponents(): any[] {
    if (!selected) return [];
    const out: any[] = [];
    if (headerComp) {
      if (needsMediaHeader) {
        if (!headerMediaUrl.trim()) return out; // se filtra fuera (botón disabled)
        const fmt = (headerComp.format ?? "").toLowerCase();
        const param: any = { type: fmt };
        if (fmt === "image") param.image = { link: headerMediaUrl.trim() };
        else if (fmt === "video") param.video = { link: headerMediaUrl.trim() };
        else if (fmt === "document") param.document = { link: headerMediaUrl.trim(), filename: headerMediaUrl.split("/").slice(-1)[0] || "doc.pdf" };
        out.push({ type: "header", parameters: [param] });
      } else if (headerComp.format === "TEXT" && headerVars.length > 0) {
        out.push({ type: "header", parameters: headerVars.map((v) => ({ type: "text", text: v })) });
      }
    }
    if (bodyComp && bodyVars.length > 0) {
      out.push({ type: "body", parameters: bodyVars.map((v) => ({ type: "text", text: v })) });
    }
    return out;
  }

  function readyToSend(): { ok: boolean; reason?: string } {
    if (!selected) return { ok: false, reason: "Selecciona una plantilla" };
    if (!fromNumberId) return { ok: false, reason: "Elige número de origen" };
    // Media del header (URL) sigue siendo compartida también en personalized mode
    if (needsMediaHeader && !headerMediaUrl.trim()) return { ok: false, reason: "Falta URL del media del header" };
    if (mode === "bulk" && personalize) {
      // En personalizado, los textos de variables vienen por línea, no de los inputs globales
      if (validRecipientsCount === 0) return { ok: false, reason: "No hay líneas válidas" };
      if (invalidRecipientsCount > 0) return { ok: false, reason: `${invalidRecipientsCount} líneas con error` };
      return { ok: true };
    }
    if (headerVars.some((v) => !v.trim())) return { ok: false, reason: "Faltan variables del header" };
    if (bodyVars.some((v) => !v.trim())) return { ok: false, reason: "Faltan variables del body" };
    return { ok: true };
  }

  function buildRecipientsForBulk(): { phone: string; components: any[] }[] {
    // Genera el array recipients[] para el broadcast personalizado
    if (!personalize || !selected) return [];
    const headerComp = selected.components.find((c) => c.type === "HEADER");
    const headerIsText = headerComp?.format === "TEXT" && countVars(headerComp.text ?? "") > 0;
    return parsedRecipients.filter((r) => r.ok).map((r) => {
      const components: any[] = [];
      if (needsMediaHeader && headerMediaUrl.trim()) {
        const fmt = (headerComp!.format ?? "").toLowerCase();
        const param: any = { type: fmt };
        if (fmt === "image") param.image = { link: headerMediaUrl.trim() };
        else if (fmt === "video") param.video = { link: headerMediaUrl.trim() };
        else if (fmt === "document") param.document = { link: headerMediaUrl.trim(), filename: headerMediaUrl.split("/").slice(-1)[0] || "doc.pdf" };
        components.push({ type: "header", parameters: [param] });
      } else if (headerIsText) {
        components.push({ type: "header", parameters: r.headerVars.map((v) => ({ type: "text", text: v })) });
      }
      if (r.bodyVars.length > 0) {
        components.push({ type: "body", parameters: r.bodyVars.map((v) => ({ type: "text", text: v })) });
      }
      return { phone: r.phone, components };
    });
  }

  async function sendSingle() {
    if (!conversation || !selected) return;
    const ready = readyToSend();
    if (!ready.ok) { setSingleResult({ ok: false, msg: ready.reason ?? "no listo" }); return; }
    setSending(true);
    setSingleResult(null);
    try {
      const r = await fetch(`${apiBase}/conversations/${encodeURIComponent(conversation.id)}/send-template`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template_name: selected.name, language: selected.language, from_number: fromNumberId, components: buildComponents(), agent_name: "agente" }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        setSingleResult({ ok: true, msg: `Enviado a ${conversation.lead_name?.trim() || conversation.phone} desde ${j.sent_from?.name ?? "?"}` });
        onSent?.();
      } else {
        setSingleResult({ ok: false, msg: `${r.status} · ${j.error ?? "error"}${j.detail ? " · " + j.detail.slice(0, 200) : ""}` });
      }
    } catch (e: any) {
      setSingleResult({ ok: false, msg: String(e.message ?? e) });
    } finally { setSending(false); }
  }

  async function sendBulk() {
    if (!selected) return;
    const ready = readyToSend();
    const total = personalize ? validRecipientsCount : parsedPhones.length;
    if (!ready.ok) { setBulkResult({ ok: false, sent_from: { name: "", phone_number_id: "" }, total, success: 0, failed: total, results: [{ phone: "—", ok: false, error: ready.reason }] }); return; }
    if (total === 0 || total > 500) return;
    if (!confirm(`Enviar plantilla "${selected.name}" a ${total} contactos desde "${numbers.find((n) => n.phone_number_id === fromNumberId)?.name ?? "?"}"${personalize ? " · variables personalizadas por destinatario" : ""}. ¿Continuar?`)) return;
    setSending(true);
    setBulkResult(null);
    try {
      const reqBody: any = { template_name: selected.name, language: selected.language, from_number: fromNumberId, agent_name: "agente" };
      if (personalize) {
        reqBody.recipients = buildRecipientsForBulk();
      } else {
        reqBody.phones = parsedPhones;
        reqBody.components = buildComponents();
      }
      const r = await fetch(`${apiBase}/broadcast/template`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody),
      });
      const j = await r.json();
      setBulkResult(j as BulkResult);
      if (j.ok) onSent?.();
    } catch (e: any) {
      setBulkResult({ ok: false, sent_from: { name: "", phone_number_id: fromNumberId }, total, success: 0, failed: total, results: [{ phone: "—", ok: false, error: String(e.message ?? e) }] });
    } finally { setSending(false); }
  }

  return (
    <div onClick={onClose} style={overlayStyle}>
      <div onClick={(e) => e.stopPropagation()} style={modalStyle}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, padding: "16px 20px", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#1a1a2e" }}>📋 Plantillas WhatsApp</h2>
          <span style={{ fontSize: 12, color: "#888" }}>{templates.filter((t) => t.status === "APPROVED").length} aprobadas · {numbers.length} números</span>
          <button onClick={onClose} style={{ marginLeft: "auto", border: "none", background: "transparent", fontSize: 22, cursor: "pointer", color: "#888" }}>×</button>
        </div>

        <div style={{ display: "flex", gap: 4, padding: "10px 20px 0", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
          <TabBtn cur={mode} v="single" set={setMode} label={conversation ? `Esta conversación · ${conversation.lead_name?.trim() || conversation.phone}` : "Una conversación"} disabled={!conversation} />
          <TabBtn cur={mode} v="bulk" set={setMode} label="📣 Envío masivo (bulk)" />
        </div>

        {/* Número origen + idioma + errores */}
        <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 20px", borderBottom: "1px solid rgba(0,0,0,0.04)", background: "#fafafa", flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: "#888", fontWeight: 700 }}>ENVIAR DESDE:</span>
          <select value={fromNumberId} onChange={(e) => { setFromNumberId(e.target.value); setSelected(null); }} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid rgba(0,0,0,0.1)", fontSize: 12.5, background: "#fff", minWidth: 280 }}>
            {numbers.length === 0 && <option value="">(sin números)</option>}
            {numbers.map((n) => (
              <option key={n.phone_number_id} value={n.phone_number_id}>
                {n.name?.trim()}{n.phone_number ? ` · ${n.phone_number}` : ""}{n.is_default ? " · default" : ""}
              </option>
            ))}
          </select>
          {templateErrors.length > 0 && (
            <span title={templateErrors.join("\n")} style={{ fontSize: 11, color: "#dc2626", fontWeight: 600, cursor: "help" }}>
              ⚠️ {templateErrors.length} WABA{templateErrors.length === 1 ? "" : "s"} con token expirado
            </span>
          )}
        </div>

        {loadErr && <div style={errBox}>{loadErr}</div>}

        {/* Body 3 columns: left = list, middle = preview, right = actions */}
        <div style={{ display: "grid", gridTemplateColumns: "320px 1fr 360px", gap: 0, flex: 1, minHeight: 0 }}>
          {/* LEFT — list */}
          <div style={{ borderRight: "1px solid rgba(0,0,0,0.06)", padding: 14, overflowY: "auto", minHeight: 0 }}>
            <div style={{ fontSize: 11, color: "#888", fontWeight: 700, marginBottom: 8 }}>1. ELEGIR PLANTILLA</div>
            <input type="text" value={searchTpl} onChange={(e) => setSearchTpl(e.target.value)} placeholder="Buscar nombre o texto…" style={{ width: "100%", padding: "7px 10px", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 8, fontSize: 12, marginBottom: 10, boxSizing: "border-box" }} />
            <div style={{ fontSize: 10, color: "#aaa", marginBottom: 8 }}>{filteredTpls.length} plantilla{filteredTpls.length === 1 ? "" : "s"} disponibles para este número</div>
            <div style={{ display: "grid", gap: 4 }}>
              {filteredTpls.length === 0 && <div style={{ fontSize: 12, color: "#aaa", padding: 12 }}>Sin resultados.</div>}
              {filteredTpls.map((t) => (
                <button key={`${t.name}-${t.language}`} onClick={() => setSelected(t)} style={{
                  width: "100%", textAlign: "left", padding: "9px 11px", fontSize: 12, background: selected?.name === t.name && selected?.language === t.language ? "rgba(106,23,140,0.08)" : "#fff",
                  border: `1px solid ${selected?.name === t.name && selected?.language === t.language ? PURPLE : "rgba(0,0,0,0.06)"}`,
                  borderRadius: 8, cursor: "pointer",
                }}>
                  <div style={{ fontFamily: "ui-monospace, monospace", color: "#1a1a2e", fontWeight: 600 }}>{t.name}</div>
                  <div style={{ fontSize: 10, color: "#888", marginTop: 2, display: "flex", justifyContent: "space-between", gap: 6 }}>
                    <span>{t.category?.toLowerCase() ?? "?"} · {t.language}</span>
                    {t.usage_count > 0 && <span style={{ color: PURPLE }}>×{t.usage_count} uso</span>}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* MIDDLE — preview */}
          <div style={{ padding: 14, borderRight: "1px solid rgba(0,0,0,0.06)", overflowY: "auto", minHeight: 0, background: "#FAFAFA" }}>
            <div style={{ fontSize: 11, color: "#888", fontWeight: 700, marginBottom: 8 }}>2. PREVIEW</div>
            {!selected ? (
              <div style={{ padding: 20, textAlign: "center", color: "#aaa", fontSize: 12 }}>Elige una plantilla para verla.</div>
            ) : (
              <div style={{ background: "#fff", borderRadius: 14, border: "1px solid rgba(0,0,0,0.06)", overflow: "hidden", boxShadow: "0 2px 12px rgba(0,0,0,0.04)" }}>
                {headerComp && (
                  <div style={{ borderBottom: "1px solid rgba(0,0,0,0.04)", padding: headerComp.format === "TEXT" ? "10px 14px" : 0, background: headerComp.format === "TEXT" ? "rgba(106,23,140,0.04)" : "transparent" }}>
                    {headerComp.format === "TEXT" && (
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#1a1a2e" }}>{renderWithVars(headerComp.text ?? "", headerVars)}</div>
                    )}
                    {headerComp.format === "IMAGE" && (
                      <div style={{ height: 180, background: "linear-gradient(135deg,#f0e8ff,#e6d3f5)", display: "flex", alignItems: "center", justifyContent: "center", color: "#888", fontSize: 12 }}>
                        {headerMediaUrl ? <img src={headerMediaUrl} alt="header" style={{ maxWidth: "100%", maxHeight: 180 }} /> : "🖼️ Header IMAGE — añade URL"}
                      </div>
                    )}
                    {headerComp.format === "VIDEO" && (
                      <div style={{ height: 180, background: "#000", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>🎬 Header VIDEO — añade URL</div>
                    )}
                    {headerComp.format === "DOCUMENT" && (
                      <div style={{ height: 100, background: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center", color: "#666", fontSize: 12 }}>📄 Header DOCUMENT — añade URL</div>
                    )}
                  </div>
                )}
                {bodyComp && (
                  <div style={{ padding: "14px 16px", fontSize: 13, color: "#1a1a2e", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                    {renderWithVars(bodyComp.text ?? "", bodyVars)}
                  </div>
                )}
                {footerComp && (
                  <div style={{ padding: "8px 16px", fontSize: 11, color: "#888", borderTop: "1px solid rgba(0,0,0,0.04)", background: "rgba(0,0,0,0.01)" }}>
                    {footerComp.text}
                  </div>
                )}
                {buttonsComp && buttonsComp.buttons && buttonsComp.buttons.length > 0 && (
                  <div style={{ display: "grid", gap: 1, background: "rgba(0,0,0,0.04)" }}>
                    {buttonsComp.buttons.map((b, i) => (
                      <div key={i} style={{ padding: "10px 14px", background: "#fff", textAlign: "center", color: "#1e90ff", fontSize: 13, fontWeight: 600 }}>
                        {b.type === "URL" ? "🔗" : b.type === "PHONE_NUMBER" ? "📞" : "▶"} {b.text}
                        {b.url && <div style={{ fontSize: 10, color: "#aaa", marginTop: 2 }}>{b.url}</div>}
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ padding: "6px 12px", fontSize: 10, color: "#bbb", background: "#fafafa", display: "flex", justifyContent: "space-between" }}>
                  <span>📋 {selected.name}</span>
                  <span>{selected.language} · {selected.category?.toLowerCase()}</span>
                </div>
              </div>
            )}
          </div>

          {/* RIGHT — actions */}
          <div style={{ padding: 14, display: "flex", flexDirection: "column", minHeight: 0, overflowY: "auto" }}>
            <div style={{ fontSize: 11, color: "#888", fontWeight: 700, marginBottom: 8 }}>3. RELLENAR Y ENVIAR</div>

            {!selected && <div style={{ fontSize: 12, color: "#aaa", padding: 10 }}>Selecciona una plantilla.</div>}

            {selected && needsMediaHeader && (
              <div style={{ marginBottom: 12 }}>
                <label style={lblStyle}>Header {headerComp?.format}</label>
                <input type="url" value={headerMediaUrl} onChange={(e) => setHeaderMediaUrl(e.target.value)} placeholder="https://… URL pública del media" style={inputStyle} />
                <div style={{ fontSize: 10, color: "#aaa", marginTop: 2 }}>Debe ser HTTPS pública. Meta descargará el media.</div>
              </div>
            )}

            {selected && headerComp?.format === "TEXT" && headerVars.map((v, i) => (
              <div key={`hv-${i}`} style={{ marginBottom: 8 }}>
                <label style={lblStyle}>Header · variable {`{{${i + 1}}}`}</label>
                <input type="text" value={v} onChange={(e) => { const nv = [...headerVars]; nv[i] = e.target.value; setHeaderVars(nv); }} placeholder={selected.components.find((c) => c.type === "HEADER")?.example?.header_text?.[i] || "valor"} style={inputStyle} />
              </div>
            ))}

            {selected && bodyVars.map((v, i) => (
              <div key={`bv-${i}`} style={{ marginBottom: 8 }}>
                <label style={lblStyle}>Body · variable {`{{${i + 1}}}`}</label>
                <input type="text" value={v} onChange={(e) => { const nv = [...bodyVars]; nv[i] = e.target.value; setBodyVars(nv); }} placeholder={selected.components.find((c) => c.type === "BODY")?.example?.body_text?.[0]?.[i] || "valor"} style={inputStyle} />
              </div>
            ))}

            {selected && bodyVars.length === 0 && !needsMediaHeader && headerVars.length === 0 && (
              <div style={{ fontSize: 11, color: "#888", padding: 8, background: "rgba(0,0,0,0.02)", borderRadius: 6, marginBottom: 10 }}>
                Esta plantilla no requiere variables. Lista para enviar.
              </div>
            )}

            {/* Per-mode action */}
            {mode === "single" && (
              <>
                {!conversation ? (
                  <div style={{ padding: 10, background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 8, fontSize: 11, color: "#92400e", marginBottom: 10 }}>
                    No hay conversación abierta. Usa &ldquo;Envío masivo&rdquo;.
                  </div>
                ) : selected ? (
                  <div style={{ padding: 10, background: "rgba(106,23,140,0.04)", borderRadius: 8, marginBottom: 10, fontSize: 12 }}>
                    A: <strong>{conversation.lead_name?.trim() || "(sin nombre)"}</strong> <span style={{ color: "#888" }}>· {conversation.phone}</span>
                  </div>
                ) : null}
                <button onClick={sendSingle} disabled={!conversation || !readyToSend().ok || sending} style={primaryBtn(!conversation || !readyToSend().ok || sending)}>
                  {sending ? "Enviando…" : `Enviar plantilla`}
                </button>
                {!readyToSend().ok && selected && conversation && <div style={{ fontSize: 10, color: "#dc2626", marginTop: 4 }}>{readyToSend().reason}</div>}
                {singleResult && <div style={{ marginTop: 10, padding: 9, borderRadius: 8, background: singleResult.ok ? "#ecfdf5" : "#fef2f2", color: singleResult.ok ? "#065f46" : "#991b1b", fontSize: 12, border: `1px solid ${singleResult.ok ? "#a7f3d0" : "#fecaca"}` }}>{singleResult.ok ? "✅ " : "❌ "}{singleResult.msg}</div>}
              </>
            )}

            {mode === "bulk" && (
              <>
                {expectedVarsPerLine > 0 && (
                  <div style={{ marginBottom: 10, padding: 8, background: personalize ? "rgba(106,23,140,0.06)" : "rgba(0,0,0,0.03)", borderRadius: 8, border: `1px solid ${personalize ? PURPLE + "55" : "rgba(0,0,0,0.06)"}` }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12, color: "#1a1a2e", fontWeight: 600 }}>
                      <input type="checkbox" checked={personalize} onChange={(e) => setPersonalize(e.target.checked)} />
                      Personalizar variables por destinatario
                    </label>
                    <div style={{ fontSize: 10, color: "#888", marginTop: 4, lineHeight: 1.4 }}>
                      {personalize
                        ? `Cada línea: teléfono y luego ${expectedVarsPerLine} valor${expectedVarsPerLine === 1 ? "" : "es"} separados por comas (en orden: ${describeVarOrder(selected!)})`
                        : "Las mismas variables se envían a todos los destinatarios."}
                    </div>
                  </div>
                )}

                <label style={lblStyle}>{personalize ? "Líneas: teléfono, var1, var2…" : "Teléfonos (comas, espacios o saltos de línea)"}</label>
                <textarea
                  value={bulkInput}
                  onChange={(e) => setBulkInput(e.target.value)}
                  rows={6}
                  placeholder={personalize ? bulkPersonalizedPlaceholder(expectedVarsPerLine) : "34XXXXXXXXX, 34XXXXXXXXX\n34611111111"}
                  style={{ ...inputStyle, fontFamily: "ui-monospace, monospace", resize: "vertical", minHeight: 110 }}
                />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4, marginBottom: 8, fontSize: 11 }}>
                  <span style={{ color: validRecipientsCount > 500 ? "#dc2626" : "#666" }}>
                    <strong style={{ color: validRecipientsCount > 500 ? "#dc2626" : "#059669" }}>{validRecipientsCount}</strong> válid{validRecipientsCount === 1 ? "o" : "os"}
                    {invalidRecipientsCount > 0 && <span style={{ color: "#dc2626" }}> · {invalidRecipientsCount} con error</span>}
                    {validRecipientsCount > 500 && " (máx 500)"}
                  </span>
                  <button onClick={() => setBulkInput("")} style={{ background: "transparent", border: "none", color: "#888", cursor: "pointer", fontSize: 11 }}>Limpiar</button>
                </div>

                {personalize && invalidRecipientsCount > 0 && (
                  <details style={{ marginBottom: 8 }}>
                    <summary style={{ fontSize: 11, color: "#dc2626", cursor: "pointer", fontWeight: 600 }}>{invalidRecipientsCount} líneas con error · ver</summary>
                    <div style={{ marginTop: 6, maxHeight: 120, overflowY: "auto", fontSize: 11, fontFamily: "ui-monospace, monospace", background: "#fef2f2", padding: 6, borderRadius: 6 }}>
                      {parsedRecipients.filter((r) => !r.ok).slice(0, 20).map((r, i) => (
                        <div key={i} style={{ marginBottom: 2 }}>
                          <strong>L{r.lineNumber}:</strong> {r.reason} <em style={{ color: "#aaa" }}>{r.lineRaw.slice(0, 60)}</em>
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                <button onClick={sendBulk} disabled={!readyToSend().ok || validRecipientsCount === 0 || validRecipientsCount > 500 || sending} style={primaryBtn(!readyToSend().ok || validRecipientsCount === 0 || validRecipientsCount > 500 || sending)}>
                  {sending ? `Enviando a ${validRecipientsCount}…` : `📤 Enviar a ${validRecipientsCount} contacto${validRecipientsCount === 1 ? "" : "s"}`}
                </button>
                {!readyToSend().ok && selected && <div style={{ fontSize: 10, color: "#dc2626", marginTop: 4 }}>{readyToSend().reason}</div>}
                {bulkResult && (
                  <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: bulkResult.success === bulkResult.total ? "#ecfdf5" : bulkResult.success === 0 ? "#fef2f2" : "#fffbeb", border: `1px solid ${bulkResult.success === bulkResult.total ? "#a7f3d0" : bulkResult.success === 0 ? "#fecaca" : "#fde68a"}`, fontSize: 12 }}>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>
                      {bulkResult.success === bulkResult.total ? "✅" : "⚠️"} {bulkResult.success} / {bulkResult.total} enviados desde {bulkResult.sent_from?.name ?? "?"}
                    </div>
                    {bulkResult.failed > 0 && (
                      <details>
                        <summary style={{ cursor: "pointer", color: "#92400e", fontSize: 11 }}>{bulkResult.failed} fallidos · detalle</summary>
                        <div style={{ marginTop: 6, maxHeight: 180, overflowY: "auto", fontSize: 11, fontFamily: "ui-monospace, monospace" }}>
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
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function componentText(t: MetaTemplate, type: "HEADER" | "BODY" | "FOOTER"): string | undefined {
  return t.components.find((c) => c.type === type)?.text;
}
function countVars(text: string): number {
  const matches = text.matchAll(/\{\{(\d+)\}\}/g);
  let max = 0;
  for (const m of matches) {
    const n = Number(m[1]);
    if (n > max) max = n;
  }
  return max;
}
function renderWithVars(text: string, vars: string[]): React.ReactNode {
  const parts = text.split(/(\{\{\d+\}\})/g);
  return parts.map((p, i) => {
    const m = p.match(/^\{\{(\d+)\}\}$/);
    if (m) {
      const idx = Number(m[1]) - 1;
      const val = vars[idx];
      if (val) return <strong key={i} style={{ color: PURPLE }}>{val}</strong>;
      return <span key={i} style={{ background: "rgba(245,158,11,0.18)", color: "#92400e", padding: "1px 5px", borderRadius: 4, fontFamily: "ui-monospace, monospace", fontSize: 11 }}>{p}</span>;
    }
    return <span key={i}>{p}</span>;
  });
}

function parsePersonalized(input: string, headerTextVars: number, bodyTextVars: number): { phone: string; headerVars: string[]; bodyVars: string[]; lineNumber: number; lineRaw: string; ok: boolean; reason?: string }[] {
  const totalVars = headerTextVars + bodyTextVars;
  const seenPhones = new Set<string>();
  const lines = input.split(/\r?\n/);
  const out: { phone: string; headerVars: string[]; bodyVars: string[]; lineNumber: number; lineRaw: string; ok: boolean; reason?: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    // Separa por comas, tabs o "|" — más permisivo
    const cols = raw.split(/\s*[,\t|]\s*/).map((s) => s.trim()).filter((s) => s !== "");
    const lineNumber = i + 1;
    if (cols.length < 1) continue;
    const rawPhone = cols[0].replace(/[^\d+]/g, "").replace(/^\+/, "");
    if (rawPhone.length < 8 || rawPhone.length > 16) {
      out.push({ phone: rawPhone, headerVars: [], bodyVars: [], lineNumber, lineRaw: raw, ok: false, reason: "teléfono inválido" });
      continue;
    }
    if (seenPhones.has(rawPhone)) {
      out.push({ phone: rawPhone, headerVars: [], bodyVars: [], lineNumber, lineRaw: raw, ok: false, reason: "duplicado" });
      continue;
    }
    const vars = cols.slice(1);
    if (vars.length < totalVars) {
      out.push({ phone: rawPhone, headerVars: [], bodyVars: [], lineNumber, lineRaw: raw, ok: false, reason: `faltan variables: ${vars.length}/${totalVars}` });
      continue;
    }
    if (vars.some((v) => !v)) {
      out.push({ phone: rawPhone, headerVars: [], bodyVars: [], lineNumber, lineRaw: raw, ok: false, reason: "alguna variable vacía" });
      continue;
    }
    seenPhones.add(rawPhone);
    out.push({
      phone: rawPhone,
      headerVars: vars.slice(0, headerTextVars),
      bodyVars: vars.slice(headerTextVars, headerTextVars + bodyTextVars),
      lineNumber,
      lineRaw: raw,
      ok: true,
    });
  }
  return out;
}

function describeVarOrder(t: MetaTemplate): string {
  const headerComp = t.components.find((c) => c.type === "HEADER");
  const headerTextVars = headerComp?.format === "TEXT" ? countVars(headerComp.text ?? "") : 0;
  const bodyComp = t.components.find((c) => c.type === "BODY");
  const bodyTextVars = countVars(bodyComp?.text ?? "");
  const parts: string[] = [];
  for (let i = 1; i <= headerTextVars; i++) parts.push(`header {{${i}}}`);
  for (let i = 1; i <= bodyTextVars; i++) parts.push(`body {{${i}}}`);
  return parts.join(", ");
}

function bulkPersonalizedPlaceholder(varsCount: number): string {
  const sample1 = ["34XXXXXXXXX"].concat(Array.from({ length: varsCount }, (_, i) => i === 0 ? "Pilar" : i === 1 ? "viernes" : `valor${i + 1}`)).join(", ");
  const sample2 = ["34XXXXXXXXX"].concat(Array.from({ length: varsCount }, (_, i) => i === 0 ? "Sonia" : i === 1 ? "sábado" : `valor${i + 1}`)).join(", ");
  return `${sample1}\n${sample2}`;
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
    <button onClick={() => !disabled && set(v)} disabled={disabled} style={{ padding: "10px 16px", fontSize: 13, fontWeight: 600, background: active ? "#fff" : "transparent", color: disabled ? "#bbb" : active ? PURPLE : "#666", border: "none", borderBottom: active ? `2px solid ${PURPLE}` : "2px solid transparent", marginBottom: -1, cursor: disabled ? "default" : "pointer" }}>{label}</button>
  );
}

const overlayStyle: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 };
const modalStyle: React.CSSProperties = { background: "#fff", borderRadius: 16, width: "min(1180px, 100%)", height: "min(760px, 95vh)", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 24px 80px rgba(0,0,0,0.25)" };
const errBox: React.CSSProperties = { padding: 10, margin: "10px 20px", background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", fontSize: 12, borderRadius: 8 };
const lblStyle: React.CSSProperties = { fontSize: 10, color: "#888", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 3, display: "block" };
const inputStyle: React.CSSProperties = { width: "100%", padding: "7px 10px", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 6, fontSize: 12, boxSizing: "border-box" };
const primaryBtn = (disabled: boolean): React.CSSProperties => ({ padding: "11px 18px", borderRadius: 8, border: "none", background: disabled ? "rgba(0,0,0,0.06)" : PURPLE, color: disabled ? "#888" : "#fff", fontSize: 13, fontWeight: 700, cursor: disabled ? "default" : "pointer" });
