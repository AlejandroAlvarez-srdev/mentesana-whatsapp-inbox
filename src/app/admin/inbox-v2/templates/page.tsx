"use client";

import { useEffect, useMemo, useState } from "react";

const PURPLE = "#6A178C";

type Template = {
  name: string;
  status: string;
  category: string;
  language: string;
  components?: { type: string; text?: string; format?: string; buttons?: { type: string; text: string; url?: string }[] }[];
  quality_score?: { score?: string };
  rejected_reason?: string;
  available_from: { phone_number_id: string; name: string }[];
};

type WaNumber = { phone_number_id: string; name: string; phone_number: string | null };

export default function TemplatesAdminPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [numbers, setNumbers] = useState<WaNumber[]>([]);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<"all" | "MARKETING" | "UTILITY" | "AUTHENTICATION">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "APPROVED" | "PENDING" | "REJECTED">("all");
  const [search, setSearch] = useState("");

  const load = () => {
    setLoading(true);
    Promise.all([
      fetch("/api/admin/whatsapp/templates", { credentials: "include", cache: "no-store" }).then((r) => r.json()),
      fetch("/api/agent/inbox/whatsapp-numbers", { credentials: "include", cache: "no-store" }).then((r) => r.json()).catch(() => ({ numbers: [] })),
    ]).then(([t, n]) => {
      setTemplates(t.templates ?? []);
      setErrors(t.errors ?? []);
      setNumbers((n.numbers ?? []) as WaNumber[]);
    }).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const filtered = useMemo(() => {
    return templates.filter((t) => {
      if (filter !== "all" && t.category !== filter) return false;
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      if (search && !t.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [templates, filter, statusFilter, search]);

  return (
    <div style={{ padding: "20px 24px", maxWidth: 1280, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, color: "#1a1a2e", fontWeight: 900 }}>📝 Plantillas de WhatsApp</h1>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "#666" }}>
            Crea y revisa las plantillas Meta. <strong style={{ color: PURPLE }}>MARKETING</strong> se enruta automáticamente vía MM Lite. Aprobación de Meta tarda 1-24h.
          </p>
        </div>
        <button onClick={() => setCreating(true)} style={btnPrimary}>+ Nueva plantilla</button>
      </header>

      {errors.length > 0 && (
        <div style={{ padding: 10, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, fontSize: 12, color: "#991b1b", marginBottom: 12 }}>
          ⚠️ {errors.join(" · ")}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14, padding: 12, background: "#faf7fc", borderRadius: 10 }}>
        <select value={filter} onChange={(e) => setFilter(e.target.value as "all" | "MARKETING" | "UTILITY" | "AUTHENTICATION")} style={inp}>
          <option value="all">Todas las categorías</option>
          <option value="MARKETING">MARKETING (MM Lite)</option>
          <option value="UTILITY">UTILITY</option>
          <option value="AUTHENTICATION">AUTHENTICATION</option>
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "all" | "APPROVED" | "PENDING" | "REJECTED")} style={inp}>
          <option value="all">Todos los estados</option>
          <option value="APPROVED">✅ Aprobadas</option>
          <option value="PENDING">⏳ Pendientes</option>
          <option value="REJECTED">❌ Rechazadas</option>
        </select>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre…" style={{ ...inp, flex: 1, minWidth: 220 }} />
        <span style={{ padding: "8px 12px", fontSize: 12, color: "#666", marginLeft: "auto" }}>
          {filtered.length}/{templates.length} plantillas
        </span>
      </div>

      {loading && <div style={{ padding: 30, textAlign: "center", color: "#888" }}>Cargando…</div>}

      <div style={{ display: "grid", gap: 8 }}>
        {filtered.map((t) => <TemplateCard key={`${t.name}_${t.language}`} t={t} />)}
      </div>

      {creating && <CreateModal numbers={numbers} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); load(); }} />}
    </div>
  );
}

function TemplateCard({ t }: { t: Template }) {
  const body = (t.components ?? []).find((c) => c.type === "BODY")?.text ?? "";
  const header = (t.components ?? []).find((c) => c.type === "HEADER");
  const footer = (t.components ?? []).find((c) => c.type === "FOOTER")?.text;
  const buttons = (t.components ?? []).find((c) => c.type === "BUTTONS")?.buttons ?? [];
  const stColor = t.status === "APPROVED" ? "#16a34a" : t.status === "REJECTED" ? "#dc2626" : "#d97706";
  const catColor = t.category === "MARKETING" ? PURPLE : t.category === "UTILITY" ? "#0891b2" : "#475569";

  return (
    <div style={{ background: "#fff", padding: 14, borderRadius: 10, border: "1px solid rgba(0,0,0,0.06)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 14, color: "#1a1a2e" }}>{t.name}</strong>
        <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 4, background: `${catColor}18`, color: catColor, fontWeight: 800, textTransform: "uppercase" }}>{t.category}</span>
        <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 4, background: `${stColor}18`, color: stColor, fontWeight: 800 }}>{t.status}</span>
        <span style={{ fontSize: 10, color: "#888" }}>· {t.language}</span>
        {t.quality_score?.score && <span style={{ fontSize: 10, color: "#888" }}>· quality {t.quality_score.score}</span>}
        {t.rejected_reason && <span style={{ fontSize: 10, color: "#dc2626" }}>· motivo: {t.rejected_reason}</span>}
        <span style={{ marginLeft: "auto", fontSize: 10, color: "#888" }}>
          desde {t.available_from.map((n) => n.name).join(", ")}
        </span>
      </div>
      {header?.text && <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 4 }}>📌 {header.text}</div>}
      {body && <div style={{ fontSize: 12.5, color: "#1a1a2e", lineHeight: 1.55, whiteSpace: "pre-line" }}>{body}</div>}
      {footer && <div style={{ fontSize: 11, color: "#888", fontStyle: "italic", marginTop: 4 }}>{footer}</div>}
      {buttons.length > 0 && (
        <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
          {buttons.map((b, i) => (
            <span key={i} style={{ fontSize: 10.5, padding: "3px 8px", borderRadius: 999, background: "#f1f5f9", color: "#475569", fontWeight: 700 }}>
              {b.type === "URL" ? "🔗" : "💬"} {b.text}{b.url && ` → ${b.url.slice(0, 30)}`}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function CreateModal({ numbers, onClose, onCreated }: { numbers: WaNumber[]; onClose: () => void; onCreated: () => void }) {
  const [phoneNumberId, setPhoneNumberId] = useState(numbers[0]?.phone_number_id ?? "");
  const [name, setName] = useState("");
  const [category, setCategory] = useState<"MARKETING" | "UTILITY" | "AUTHENTICATION">("MARKETING");
  const [language, setLanguage] = useState("es_ES");
  const [headerText, setHeaderText] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [footerText, setFooterText] = useState("");
  const [bodyExamples, setBodyExamples] = useState("");
  const [buttons, setButtons] = useState<{ type: "URL" | "QUICK_REPLY"; text: string; url?: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!phoneNumberId && numbers[0]) setPhoneNumberId(numbers[0].phone_number_id);
  }, [numbers, phoneNumberId]);

  const placeholders = (bodyText.match(/\{\{\d+\}\}/g) || []).length;

  async function submit() {
    setBusy(true); setErr(null);
    try {
      const body_examples = bodyExamples.split("\n").map((s) => s.trim()).filter(Boolean);
      if (placeholders > 0 && body_examples.length !== placeholders) {
        setErr(`Tu body tiene ${placeholders} variables {{1}}, {{2}}... pero diste ${body_examples.length} ejemplos. Necesitas exactamente ${placeholders}.`);
        return;
      }
      const r = await fetch("/api/admin/whatsapp/templates", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone_number_id: phoneNumberId,
          name: name.trim(),
          category,
          language,
          header_text: headerText.trim() || undefined,
          body_text: bodyText.trim(),
          footer_text: footerText.trim() || undefined,
          body_examples,
          buttons: buttons.filter((b) => b.text.trim()),
        }),
      });
      const d = await r.json();
      if (!r.ok) { setErr(d.meta_error?.error_user_msg || d.meta_error?.message || d.error || "Error desconocido"); return; }
      alert(`✅ Plantilla creada. ID: ${d.template?.id}. Meta la revisará en 1-24h.`);
      onCreated();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 20, maxWidth: 680, width: "100%", maxHeight: "90vh", overflow: "auto" }}>
        <h2 style={{ margin: "0 0 6px", fontSize: 19, color: PURPLE, fontWeight: 900 }}>+ Nueva plantilla WhatsApp</h2>
        <p style={{ margin: "0 0 14px", fontSize: 12, color: "#666" }}>
          Meta revisa cada plantilla. Suele tardar entre 1 minuto y 24 horas. Para MARKETING evita lenguaje agresivo, promos engañosas o spam — riesgo de rechazo.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <label style={lbl}>Número origen *</label>
            <select value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} style={inp}>
              {numbers.map((n) => <option key={n.phone_number_id} value={n.phone_number_id}>{n.name} ({n.phone_number})</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Categoría *</label>
            <select value={category} onChange={(e) => setCategory(e.target.value as "MARKETING" | "UTILITY" | "AUTHENTICATION")} style={inp}>
              <option value="MARKETING">MARKETING (MM Lite)</option>
              <option value="UTILITY">UTILITY (notificaciones, recordatorios)</option>
              <option value="AUTHENTICATION">AUTHENTICATION (códigos OTP)</option>
            </select>
          </div>
          <div>
            <label style={lbl}>Nombre (snake_case) *</label>
            <input value={name} onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))} placeholder="ej: reactivacion_bono_caduca" style={inp} />
          </div>
          <div>
            <label style={lbl}>Idioma</label>
            <select value={language} onChange={(e) => setLanguage(e.target.value)} style={inp}>
              <option value="es_ES">Español (España)</option>
              <option value="es">Español</option>
              <option value="es_MX">Español (México)</option>
              <option value="en_US">English (US)</option>
            </select>
          </div>
        </div>

        <label style={{ ...lbl, marginTop: 12 }}>Encabezado (opcional, máx 60 chars)</label>
        <input value={headerText} onChange={(e) => setHeaderText(e.target.value)} placeholder="Ej: Hola {{1}} 💜" maxLength={60} style={inp} />

        <label style={{ ...lbl, marginTop: 12 }}>Cuerpo del mensaje * <span style={{ fontWeight: 500, color: "#888" }}>(usa {`{{1}}, {{2}}`} para variables)</span></label>
        <textarea value={bodyText} onChange={(e) => setBodyText(e.target.value)} rows={6} placeholder="Hola {{1}}, ya hace 3 meses desde tu última sesión. Tu psicóloga {{2}} sigue esperándote — recarga tu bono con 10% de descuento esta semana. {{3}}" style={{ ...inp, fontFamily: "inherit", resize: "vertical" }} />
        <div style={{ fontSize: 10.5, color: "#888", marginTop: 4 }}>{bodyText.length} chars · {placeholders} variable{placeholders !== 1 ? "s" : ""}</div>

        {placeholders > 0 && (
          <>
            <label style={{ ...lbl, marginTop: 12 }}>Ejemplos para variables ({placeholders} líneas, una por {`{{n}}`}) *</label>
            <textarea value={bodyExamples} onChange={(e) => setBodyExamples(e.target.value)} rows={placeholders} placeholder={Array.from({ length: placeholders }, (_, i) => `Ejemplo para {{${i + 1}}}`).join("\n")} style={{ ...inp, fontFamily: "inherit" }} />
          </>
        )}

        <label style={{ ...lbl, marginTop: 12 }}>Pie de mensaje (opcional, máx 60 chars)</label>
        <input value={footerText} onChange={(e) => setFooterText(e.target.value)} placeholder="Ej: Para dejar de recibir, responde STOP" maxLength={60} style={inp} />

        <label style={{ ...lbl, marginTop: 12 }}>Botones (máx 3)</label>
        <div style={{ display: "grid", gap: 6 }}>
          {buttons.map((b, i) => (
            <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <select value={b.type} onChange={(e) => setButtons((bs) => bs.map((x, k) => k === i ? { ...x, type: e.target.value as "URL" | "QUICK_REPLY" } : x))} style={{ ...inp, width: 130 }}>
                <option value="URL">🔗 URL</option>
                <option value="QUICK_REPLY">💬 Respuesta rápida</option>
              </select>
              <input value={b.text} onChange={(e) => setButtons((bs) => bs.map((x, k) => k === i ? { ...x, text: e.target.value } : x))} placeholder="Texto botón (máx 20)" maxLength={20} style={{ ...inp, flex: 1 }} />
              {b.type === "URL" && <input value={b.url ?? ""} onChange={(e) => setButtons((bs) => bs.map((x, k) => k === i ? { ...x, url: e.target.value } : x))} placeholder="https://..." style={{ ...inp, flex: 2 }} />}
              <button onClick={() => setButtons((bs) => bs.filter((_, k) => k !== i))} style={btnSec}>✕</button>
            </div>
          ))}
          {buttons.length < 3 && <button onClick={() => setButtons((bs) => [...bs, { type: "URL", text: "", url: "" }])} style={{ ...btnSec, alignSelf: "flex-start" }}>+ Añadir botón</button>}
        </div>

        {/* Preview */}
        <div style={{ marginTop: 16, padding: 12, background: "#dcf8c6", borderRadius: 12, border: "1px solid rgba(0,0,0,0.06)" }}>
          <div style={{ fontSize: 10, color: "#5a7c4d", fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Preview WhatsApp</div>
          {headerText && <div style={{ fontSize: 13, fontWeight: 700, color: "#1a1a2e", marginBottom: 4 }}>{headerText}</div>}
          <div style={{ fontSize: 13, color: "#1a1a2e", lineHeight: 1.5, whiteSpace: "pre-line" }}>{bodyText || <em style={{ color: "#888" }}>(escribe el cuerpo del mensaje)</em>}</div>
          {footerText && <div style={{ fontSize: 11, color: "#5a7c4d", fontStyle: "italic", marginTop: 6 }}>{footerText}</div>}
          {buttons.length > 0 && (
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(0,0,0,0.08)", display: "grid", gap: 4 }}>
              {buttons.map((b, i) => b.text && (
                <div key={i} style={{ textAlign: "center", fontSize: 13, fontWeight: 700, color: "#0073ff", padding: 6, background: "#fff", borderRadius: 6 }}>
                  {b.type === "URL" ? "🔗" : "💬"} {b.text}
                </div>
              ))}
            </div>
          )}
        </div>

        {err && <div style={{ marginTop: 12, padding: 10, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, fontSize: 12, color: "#991b1b" }}>⚠️ {err}</div>}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={btnSec}>Cancelar</button>
          <button onClick={submit} disabled={busy || !name || !bodyText} style={{ ...btnPrimary, opacity: (busy || !name || !bodyText) ? 0.5 : 1 }}>
            {busy ? "Creando…" : "Crear y enviar a Meta"}
          </button>
        </div>
      </div>
    </div>
  );
}

const lbl: React.CSSProperties = { display: "block", fontSize: 10.5, fontWeight: 800, color: "#475569", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 };
const inp: React.CSSProperties = { width: "100%", padding: "9px 12px", fontSize: 13, border: "1px solid rgba(0,0,0,0.12)", borderRadius: 8, background: "#fff", color: "#1a1a2e", boxSizing: "border-box" };
const btnPrimary: React.CSSProperties = { padding: "10px 16px", fontSize: 13, fontWeight: 800, color: "#fff", background: `linear-gradient(135deg, ${PURPLE}, #8B2FB5)`, border: "none", borderRadius: 10, cursor: "pointer", boxShadow: `0 4px 12px ${PURPLE}40` };
const btnSec: React.CSSProperties = { padding: "8px 12px", fontSize: 12, fontWeight: 700, color: "#475569", background: "#fff", border: "1px solid rgba(0,0,0,0.12)", borderRadius: 8, cursor: "pointer" };
