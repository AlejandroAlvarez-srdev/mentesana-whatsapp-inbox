"use client";

// 📝 Plantillas de WhatsApp — creador para las agentes del CRM, dentro de inbox-v2.
//   · Formulario con las reglas de Meta aplicadas en vivo (src/lib/wa-template-builder): nombre interno
//     automático, categoría, encabezado/cuerpo/pie, variables {{1}}… con ejemplos y hasta 3 botones;
//     vista previa tal y como lo verá la paciente; se envía a revisión de Meta (1 min – 24 h).
//   · Lista de todas las plantillas de los números activos con estado, motivo de rechazo y calidad;
//     «Usar como base» precarga el formulario (para sacar variantes) y las rechazadas/pendientes se
//     pueden borrar. API: /api/agent/inbox/template-builder. También se muestra en /agent/plantillas.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_EXAMPLES, WA_LANGUAGES, WA_LIMITS, fillExamples, listVariables, normalizeTemplateName, rejectedReasonLabel,
  validateTemplate, variableCount, type WaButtonInput, type WaTemplateInput,
} from "@/lib/wa-template-builder";

const PURPLE = "#6A178C";
const API = "/api/agent/inbox/template-builder";

type WaNumber = { phone_number_id: string; name: string; phone_number: string | null; waba_id: string; is_default: boolean; ok: boolean };
type Component = { type: string; format?: string; text?: string; example?: { header_text?: string[]; body_text?: string[][] }; buttons?: Array<{ type: string; text: string; url?: string; phone_number?: string }> };
type Tpl = { id?: string; name: string; status: string; category: string; language: string; rejected_reason?: string; quality_score?: { score?: string }; components?: Component[]; waba_id: string; numbers: string[] };
type Seed = { title: string; name: string; category: "MARKETING" | "UTILITY"; language: string; header_text: string; header_example: string; body_text: string; body_examples: string[]; footer_text: string; buttons: WaButtonInput[]; waba_id?: string };

const emptySeed = (): Seed => ({ title: "", name: "", category: "MARKETING", language: "es_ES", header_text: "", header_example: "Laura", body_text: "", body_examples: [], footer_text: "", buttons: [] });

export default function TemplatesAdminPage() {
  const [numbers, setNumbers] = useState<WaNumber[]>([]);
  const [templates, setTemplates] = useState<Tpl[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [seed, setSeed] = useState<Seed>(emptySeed);
  const [seedKey, setSeedKey] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(API, { credentials: "include", cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setNumbers(d.numbers ?? []);
      setTemplates(d.templates ?? []);
      setErrors(d.errors ?? []);
      setLoadErr(null);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { queueMicrotask(() => { void load(); }); }, [load]);

  const useAsBase = (t: Tpl) => {
    const comps = t.components ?? [];
    const header = comps.find((c) => c.type === "HEADER" && (c.format ?? "TEXT") === "TEXT");
    const body = comps.find((c) => c.type === "BODY");
    const footer = comps.find((c) => c.type === "FOOTER");
    const buttons = (comps.find((c) => c.type === "BUTTONS")?.buttons ?? []).map((b) => ({ type: (b.type === "URL" ? "URL" : b.type === "PHONE_NUMBER" ? "PHONE_NUMBER" : "QUICK_REPLY") as WaButtonInput["type"], text: b.text, url: b.url, phone_number: b.phone_number }));
    const n = variableCount(body?.text ?? "");
    const ex = body?.example?.body_text?.[0] ?? [];
    setSeed({
      title: `${t.name} v2`, name: `${t.name}_v2`, category: t.category === "UTILITY" ? "UTILITY" : "MARKETING", language: t.language || "es_ES",
      header_text: header?.text ?? "", header_example: header?.example?.header_text?.[0] ?? "Laura",
      body_text: body?.text ?? "", body_examples: Array.from({ length: n }, (_, i) => ex[i] || DEFAULT_EXAMPLES[i] || `ejemplo ${i + 1}`),
      footer_text: footer?.text ?? "", buttons, waba_id: t.waba_id,
    });
    setSeedKey((k) => k + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const pending = templates.filter((t) => t.status === "PENDING").length;
  const rejected = templates.filter((t) => t.status === "REJECTED").length;

  return (
    <div style={{ padding: "20px 24px", maxWidth: 1400, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <h1 style={{ margin: 0, fontSize: 22, color: "#1a1a2e", fontWeight: 900 }}>📝 Plantillas de WhatsApp</h1>
          <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "#64748b", lineHeight: 1.5 }}>
            Escribe la plantilla, mírala en la vista previa y envíala a Meta. La revisan entre 1 minuto y 24 horas; cuando pase a <strong>aprobada</strong> ya se puede enviar desde 📋 Plantillas.
          </p>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {pending > 0 && <span style={pill("#d97706")}>⏳ {pending} pendiente{pending === 1 ? "" : "s"}</span>}
          {rejected > 0 && <span style={pill("#dc2626")}>❌ {rejected} rechazada{rejected === 1 ? "" : "s"}</span>}
          <button type="button" onClick={() => void load()} disabled={loading} style={btnSec}>{loading ? "Cargando…" : "🔄 Actualizar estados"}</button>
          <a href="/admin/inbox-v2" style={{ ...btnSec, textDecoration: "none" }}>← Inbox</a>
        </div>
      </header>

      {flash && <div style={{ padding: "10px 14px", background: "rgba(16,185,129,0.1)", color: "#065f46", borderRadius: 10, fontSize: 13, fontWeight: 700, marginBottom: 12 }}>✓ {flash}</div>}
      {loadErr && <div style={errBox}>⚠️ No se pudo cargar: {loadErr}</div>}
      {errors.length > 0 && <div style={{ ...errBox, background: "#fffbeb", borderColor: "#fde68a", color: "#92400e" }}>⚠️ {errors.join(" · ")}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 18, alignItems: "start" }}>
        <TemplateForm key={seedKey} numbers={numbers} seed={seed} existing={templates} onCreated={(msg) => { setFlash(msg); window.setTimeout(() => setFlash(null), 6000); setSeed(emptySeed()); setSeedKey((k) => k + 1); void load(); }} />
        <TemplateList templates={templates} numbers={numbers} loading={loading} onUseAsBase={useAsBase} onDeleted={(name) => { setFlash(`Plantilla «${name}» eliminada en Meta.`); window.setTimeout(() => setFlash(null), 5000); void load(); }} />
      </div>
    </div>
  );
}

// ─── Formulario ──────────────────────────────────────────────────────────────
function TemplateForm({ numbers, seed, existing, onCreated }: { numbers: WaNumber[]; seed: Seed; existing: Tpl[]; onCreated: (msg: string) => void }) {
  const usable = numbers.filter((n) => n.ok);
  const [phoneNumberId, setPhoneNumberId] = useState(() => (seed.waba_id && usable.find((n) => n.waba_id === seed.waba_id)?.phone_number_id) || usable.find((n) => n.is_default)?.phone_number_id || usable[0]?.phone_number_id || "");
  const [title, setTitle] = useState(seed.title);
  const [name, setName] = useState(seed.name);
  const [nameTouched, setNameTouched] = useState(!!seed.name);
  const [category, setCategory] = useState<"MARKETING" | "UTILITY">(seed.category);
  const [language, setLanguage] = useState(seed.language);
  const [headerText, setHeaderText] = useState(seed.header_text);
  const [headerExample, setHeaderExample] = useState(seed.header_example);
  const [bodyText, setBodyText] = useState(seed.body_text);
  const [bodyExamples, setBodyExamples] = useState<string[]>(seed.body_examples);
  const [footerText, setFooterText] = useState(seed.footer_text);
  const [buttons, setButtons] = useState<WaButtonInput[]>(seed.buttons);
  const [busy, setBusy] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // Si el número activo cambia (p. ej. al cargar), elegir uno usable.
  useEffect(() => {
    if (!phoneNumberId && usable.length) queueMicrotask(() => setPhoneNumberId(usable.find((n) => n.is_default)?.phone_number_id || usable[0].phone_number_id));
  }, [usable, phoneNumberId]);

  const selectedNumber = numbers.find((n) => n.phone_number_id === phoneNumberId);
  const n = variableCount(bodyText);
  const examples = Array.from({ length: n }, (_, i) => bodyExamples[i] ?? DEFAULT_EXAMPLES[i] ?? "");
  const headerHasVar = listVariables(headerText).length > 0;
  const input: WaTemplateInput = { name, category, language, header_text: headerText, header_example: headerExample, body_text: bodyText, body_examples: examples, footer_text: footerText, buttons };
  const { errors, warnings } = validateTemplate(input);
  const nameTaken = !!selectedNumber && existing.some((t) => t.waba_id === selectedNumber.waba_id && t.name === name);
  const allErrors = [...(nameTaken ? [`Ya existe «${name}» en ${selectedNumber?.name}: cambia el nombre.`] : []), ...errors];
  const canSubmit = !busy && !!phoneNumberId && allErrors.length === 0;

  const onTitle = (v: string) => { setTitle(v); if (!nameTouched) setName(normalizeTemplateName(v)); };
  const insertVariable = () => {
    const next = `{{${n + 1}}}`;
    const el = bodyRef.current;
    const start = el?.selectionStart ?? bodyText.length;
    const end = el?.selectionEnd ?? bodyText.length;
    const before = bodyText.slice(0, start), after = bodyText.slice(end);
    const sep = before && !/\s$/.test(before) ? " " : "";
    const value = `${before}${sep}${next}${after}`;
    setBodyText(value);
    requestAnimationFrame(() => { if (el) { el.focus(); const pos = (before + sep + next).length; el.setSelectionRange(pos, pos); } });
  };

  const submit = async () => {
    setTouched(true);
    if (!canSubmit) return;
    setBusy(true); setSubmitErr(null);
    try {
      const r = await fetch(API, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone_number_id: phoneNumberId, ...input }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (r.status === 409 && d.suggestion) { setName(d.suggestion); setNameTouched(true); }
        throw new Error(d.error || `HTTP ${r.status}`);
      }
      onCreated(`Plantilla «${d.template?.name}» enviada a Meta desde ${d.number?.name}. Estado: ${d.template?.status === "APPROVED" ? "aprobada" : "pendiente de revisión"}.`);
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section style={card}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: PURPLE }}>+ Nueva plantilla</h2>
        {seed.body_text && <span style={pill(PURPLE)}>basada en otra</span>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={lbl}>Número desde el que se crea *</label>
          <select value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} style={inp}>
            {numbers.length === 0 && <option value="">(cargando números…)</option>}
            {numbers.map((x) => <option key={x.phone_number_id} value={x.phone_number_id} disabled={!x.ok}>{x.name}{x.phone_number ? ` · ${x.phone_number}` : ""}{x.ok ? "" : " · ⚠️ token caducado"}</option>)}
          </select>
          {selectedNumber && <div style={hint}>La plantilla queda disponible para todos los números de la misma cuenta (WABA) que {selectedNumber.name}.</div>}
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={lbl}>Título (para entenderla) *</label>
          <input value={title} onChange={(e) => onTitle(e.target.value)} placeholder="Ej: Renovación suave, versión 3" style={inp} />
        </div>
        <div>
          <label style={lbl}>Nombre interno en Meta *</label>
          <input value={name} onChange={(e) => { setNameTouched(true); setName(normalizeTemplateName(e.target.value) || e.target.value.toLowerCase()); }} placeholder="renovacion_suave_3" style={{ ...inp, fontFamily: "ui-monospace, monospace", fontSize: 12.5 }} />
          <div style={hint}>Solo minúsculas, números y _ . Único por cuenta.</div>
        </div>
        <div>
          <label style={lbl}>Idioma</label>
          <select value={language} onChange={(e) => setLanguage(e.target.value)} style={inp}>
            {WA_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={lbl}>Categoría *</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {([["MARKETING", "Marketing", "Renovaciones, reactivación, ofertas, saludos comerciales"], ["UTILITY", "Utilidad", "Confirmaciones, recordatorios de cita, avisos de cuenta"]] as const).map(([v, l, d]) => (
              <button key={v} type="button" onClick={() => setCategory(v)} style={{ ...btnSec, textAlign: "left", padding: "9px 12px", borderColor: category === v ? PURPLE : "rgba(0,0,0,0.12)", background: category === v ? "rgba(106,23,140,0.06)" : "#fff" }}>
                <div style={{ fontWeight: 800, color: category === v ? PURPLE : "#1a1a2e" }}>{l}</div>
                <div style={{ fontSize: 11, color: "#64748b", fontWeight: 500, marginTop: 2 }}>{d}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <label style={{ ...lbl, marginTop: 12 }}>Encabezado <span style={soft}>(opcional · máx {WA_LIMITS.header} · {headerText.length})</span></label>
      <input value={headerText} onChange={(e) => setHeaderText(e.target.value.replace(/\n/g, " "))} maxLength={WA_LIMITS.header} placeholder="Ej: Hola {{1}} 💜" style={inp} />
      {headerHasVar && (
        <div style={{ marginTop: 6 }}>
          <label style={lbl}>Ejemplo para {"{{1}}"} del encabezado *</label>
          <input value={headerExample} onChange={(e) => setHeaderExample(e.target.value)} style={inp} />
        </div>
      )}

      <label style={{ ...lbl, marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
        Cuerpo del mensaje *
        <button type="button" onClick={insertVariable} style={{ ...btnSec, padding: "2px 8px", fontSize: 11, textTransform: "none", letterSpacing: 0 }}>+ variable {"{{"}{n + 1}{"}}"}</button>
        <span style={soft}>{bodyText.length} / {WA_LIMITS.body}</span>
      </label>
      <textarea ref={bodyRef} value={bodyText} onChange={(e) => setBodyText(e.target.value)} rows={7} maxLength={WA_LIMITS.body} placeholder={"Hola {{1}} 💜 Soy del equipo de Mente Sana. Tu {{2}} está a punto de terminarse y no quiero que pierdas el ritmo con tu psicóloga. Si te apetece seguir, te preparo la renovación con las mismas condiciones. ¿Te la envío por aquí?"} style={{ ...inp, resize: "vertical", lineHeight: 1.5 }} />
      {n > 0 && (
        <div style={{ marginTop: 8, padding: 10, background: "#faf7fc", borderRadius: 10 }}>
          <div style={{ ...lbl, marginBottom: 6 }}>Ejemplos para las variables (Meta los exige) *</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 6 }}>
            {examples.map((ex, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <code style={{ fontSize: 11.5, color: PURPLE, fontWeight: 800 }}>{"{{"}{i + 1}{"}}"}</code>
                <input value={ex} onChange={(e) => setBodyExamples((arr) => { const next = [...examples]; next[i] = e.target.value; return next.length >= arr.length ? next : [...next, ...arr.slice(next.length)]; })} placeholder={DEFAULT_EXAMPLES[i] ?? "ejemplo"} style={{ ...inp, padding: "6px 9px", fontSize: 12.5 }} />
              </div>
            ))}
          </div>
          <div style={hint}>Normalmente {"{{1}}"} es el nombre de pila: al enviar se rellena solo.</div>
        </div>
      )}

      <label style={{ ...lbl, marginTop: 12 }}>Pie <span style={soft}>(opcional · máx {WA_LIMITS.footer})</span></label>
      <div style={{ display: "flex", gap: 6 }}>
        <input value={footerText} onChange={(e) => setFooterText(e.target.value.replace(/\n/g, " "))} maxLength={WA_LIMITS.footer} placeholder="Ej: Responde STOP si no quieres recibir más mensajes" style={{ ...inp, flex: 1 }} />
        {!footerText && category === "MARKETING" && <button type="button" onClick={() => setFooterText("Responde STOP si no quieres recibir más mensajes")} style={{ ...btnSec, whiteSpace: "nowrap" }}>Poner «STOP»</button>}
      </div>

      <label style={{ ...lbl, marginTop: 12 }}>Botones <span style={soft}>(opcional · máx {WA_LIMITS.buttons})</span></label>
      <div style={{ display: "grid", gap: 6 }}>
        {buttons.map((b, i) => (
          <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <select value={b.type} onChange={(e) => setButtons((bs) => bs.map((x, k) => (k === i ? { ...x, type: e.target.value as WaButtonInput["type"] } : x)))} style={{ ...inp, width: 150 }}>
              <option value="QUICK_REPLY">💬 Respuesta rápida</option>
              <option value="URL">🔗 Enlace</option>
              <option value="PHONE_NUMBER">📞 Llamar</option>
            </select>
            <input value={b.text} onChange={(e) => setButtons((bs) => bs.map((x, k) => (k === i ? { ...x, text: e.target.value } : x)))} maxLength={WA_LIMITS.buttonText} placeholder="Texto del botón (máx 25)" style={{ ...inp, flex: 1, minWidth: 140 }} />
            {b.type === "URL" && <input value={b.url ?? ""} onChange={(e) => setButtons((bs) => bs.map((x, k) => (k === i ? { ...x, url: e.target.value } : x)))} placeholder="https://mentesanapsicologia.com/…" style={{ ...inp, flex: 2, minWidth: 180 }} />}
            {b.type === "PHONE_NUMBER" && <input value={b.phone_number ?? ""} onChange={(e) => setButtons((bs) => bs.map((x, k) => (k === i ? { ...x, phone_number: e.target.value } : x)))} placeholder="+34 XXX XXX XXX" style={{ ...inp, flex: 1, minWidth: 140 }} />}
            <button type="button" onClick={() => setButtons((bs) => bs.filter((_, k) => k !== i))} style={btnSec} aria-label="Quitar botón">✕</button>
          </div>
        ))}
        {buttons.length < WA_LIMITS.buttons && <button type="button" onClick={() => setButtons((bs) => [...bs, { type: "QUICK_REPLY", text: "" }])} style={{ ...btnSec, justifySelf: "start" }}>+ Añadir botón</button>}
      </div>

      {/* Vista previa */}
      <div style={{ marginTop: 14, padding: 14, background: "#e5ddd5", borderRadius: 14 }}>
        <div style={{ fontSize: 10, color: "#5b6b5a", fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Así lo verá la paciente</div>
        <div style={{ background: "#fff", borderRadius: "4px 12px 12px 12px", padding: "8px 10px", maxWidth: 360, boxShadow: "0 1px 1px rgba(0,0,0,0.08)" }}>
          {headerText && <div style={{ fontSize: 13.5, fontWeight: 700, color: "#111", marginBottom: 4 }}>{fillExamples(headerText, [headerExample])}</div>}
          <div style={{ fontSize: 13.5, color: "#111", lineHeight: 1.45, whiteSpace: "pre-wrap" }}>{bodyText ? fillExamples(bodyText, examples) : <em style={{ color: "#999" }}>(escribe el cuerpo del mensaje)</em>}</div>
          {footerText && <div style={{ fontSize: 11.5, color: "#8696a0", marginTop: 6 }}>{footerText}</div>}
          <div style={{ fontSize: 10.5, color: "#8696a0", textAlign: "right", marginTop: 4 }}>10:02</div>
        </div>
        {buttons.filter((b) => b.text.trim()).length > 0 && (
          <div style={{ maxWidth: 360, marginTop: 4, display: "grid", gap: 3 }}>
            {buttons.filter((b) => b.text.trim()).map((b, i) => <div key={i} style={{ background: "#fff", borderRadius: 8, textAlign: "center", padding: "8px 10px", fontSize: 13.5, color: "#00a5f4", fontWeight: 600 }}>{b.type === "URL" ? "🔗 " : b.type === "PHONE_NUMBER" ? "📞 " : ""}{b.text}</div>)}
          </div>
        )}
      </div>

      {(touched || bodyText) && allErrors.length > 0 && (
        <ul style={{ margin: "12px 0 0", padding: "10px 14px 10px 28px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, fontSize: 12.5, color: "#991b1b", lineHeight: 1.5 }}>
          {allErrors.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      )}
      {warnings.length > 0 && (
        <ul style={{ margin: "10px 0 0", padding: "10px 14px 10px 28px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, fontSize: 12.5, color: "#92400e", lineHeight: 1.5 }}>
          {warnings.map((w, i) => <li key={i}>{w}</li>)}
        </ul>
      )}
      {submitErr && <div style={{ ...errBox, marginTop: 10 }}>⚠️ {submitErr}</div>}

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
        <button type="button" onClick={submit} disabled={!canSubmit} style={{ ...btnPrimary, opacity: canSubmit ? 1 : 0.5 }}>{busy ? "Enviando a Meta…" : "Enviar a Meta para aprobación"}</button>
        <span style={{ fontSize: 11.5, color: "#64748b" }}>Meta responde entre 1 minuto y 24 h. Mientras, la plantilla aparece como pendiente.</span>
      </div>
    </section>
  );
}

// ─── Lista ───────────────────────────────────────────────────────────────────
function TemplateList({ templates, numbers, loading, onUseAsBase, onDeleted }: { templates: Tpl[]; numbers: WaNumber[]; loading: boolean; onUseAsBase: (t: Tpl) => void; onDeleted: (name: string) => void }) {
  const [waba, setWaba] = useState("all");
  const [status, setStatus] = useState<"all" | "PENDING" | "APPROVED" | "REJECTED">("all");
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const wabas = [...new Map(numbers.map((x) => [x.waba_id, x])).values()];
  const q = search.trim().toLowerCase();
  const filtered = templates.filter((t) =>
    (waba === "all" || t.waba_id === waba) && (status === "all" || t.status === status) && (category === "all" || t.category === category)
    && (!q || t.name.toLowerCase().includes(q) || ((t.components ?? []).find((c) => c.type === "BODY")?.text ?? "").toLowerCase().includes(q)),
  );

  const remove = async (t: Tpl) => {
    const num = numbers.find((x) => x.waba_id === t.waba_id && x.ok);
    if (!num) { setErr("No hay un número con token válido en esa cuenta para borrarla."); return; }
    setBusy(t.name + t.waba_id); setErr(null);
    try {
      const r = await fetch(`${API}?${new URLSearchParams({ phone_number_id: num.phone_number_id, name: t.name })}`, { method: "DELETE", credentials: "include" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setConfirm(null);
      onDeleted(t.name);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section style={card}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: "#1a1a2e", marginRight: "auto" }}>Plantillas existentes <span style={{ color: "#94a3b8", fontWeight: 600, fontSize: 13 }}>· {filtered.length}/{templates.length}</span></h2>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        <select value={waba} onChange={(e) => setWaba(e.target.value)} style={{ ...inp, width: "auto", maxWidth: 240 }}>
          <option value="all">Todas las cuentas</option>
          {wabas.map((x) => <option key={x.waba_id} value={x.waba_id}>{numbers.filter((y) => y.waba_id === x.waba_id).map((y) => y.name).join(" / ")}</option>)}
        </select>
        {([["all", "Todas"], ["PENDING", "⏳ Pendientes"], ["APPROVED", "✅ Aprobadas"], ["REJECTED", "❌ Rechazadas"]] as const).map(([v, l]) => (
          <button key={v} type="button" onClick={() => setStatus(v)} style={{ ...btnSec, borderColor: status === v ? PURPLE : "rgba(0,0,0,0.12)", color: status === v ? PURPLE : "#475569" }}>{l}</button>
        ))}
        <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ ...inp, width: "auto" }}>
          <option value="all">Marketing y utilidad</option>
          <option value="MARKETING">Marketing</option>
          <option value="UTILITY">Utilidad</option>
          <option value="AUTHENTICATION">Autenticación</option>
        </select>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre o texto…" style={{ ...inp, flex: 1, minWidth: 180 }} />
      </div>
      {err && <div style={{ ...errBox, marginBottom: 10 }}>⚠️ {err}</div>}
      {loading && templates.length === 0 && <div style={{ padding: 30, textAlign: "center", color: "#888" }}>Cargando plantillas de Meta…</div>}
      {!loading && filtered.length === 0 && <div style={{ padding: 30, textAlign: "center", color: "#888", fontSize: 13 }}>No hay plantillas con esos filtros.</div>}
      <div style={{ display: "grid", gap: 8, maxHeight: "calc(100vh - 260px)", overflowY: "auto", paddingRight: 2 }}>
        {filtered.map((t) => {
          const comps = t.components ?? [];
          const header = comps.find((c) => c.type === "HEADER");
          const body = comps.find((c) => c.type === "BODY")?.text ?? "";
          const footer = comps.find((c) => c.type === "FOOTER")?.text;
          const btns = comps.find((c) => c.type === "BUTTONS")?.buttons ?? [];
          const stColor = t.status === "APPROVED" ? "#16a34a" : t.status === "REJECTED" ? "#dc2626" : t.status === "PENDING" ? "#d97706" : "#64748b";
          const stLabel = t.status === "APPROVED" ? "aprobada" : t.status === "REJECTED" ? "rechazada" : t.status === "PENDING" ? "pendiente" : t.status.toLowerCase();
          const key = t.name + t.waba_id;
          return (
            <article key={key} style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.06)", borderRadius: 12, padding: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                <strong style={{ fontSize: 13.5, color: "#1a1a2e", fontFamily: "ui-monospace, monospace" }}>{t.name}</strong>
                <span style={pill(stColor)}>{stLabel}</span>
                <span style={pill(t.category === "MARKETING" ? PURPLE : "#0891b2")}>{t.category === "MARKETING" ? "marketing" : t.category === "UTILITY" ? "utilidad" : t.category.toLowerCase()}</span>
                <span style={{ fontSize: 10.5, color: "#94a3b8" }}>{t.language}{t.quality_score?.score && t.quality_score.score !== "UNKNOWN" ? ` · calidad ${t.quality_score.score.toLowerCase()}` : ""}</span>
                <span style={{ marginLeft: "auto", fontSize: 10.5, color: "#94a3b8" }}>{t.numbers.join(" / ")}</span>
              </div>
              {header?.text && <div style={{ fontSize: 12.5, fontWeight: 700, color: "#334155", marginBottom: 3 }}>{header.text}</div>}
              {header && !header.text && <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 3 }}>📎 encabezado {header.format?.toLowerCase()}</div>}
              <div style={{ fontSize: 12.5, color: "#334155", lineHeight: 1.5, whiteSpace: "pre-wrap", display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{body}</div>
              {footer && <div style={{ fontSize: 11, color: "#94a3b8", fontStyle: "italic", marginTop: 3 }}>{footer}</div>}
              {btns.length > 0 && <div style={{ marginTop: 6, display: "flex", gap: 5, flexWrap: "wrap" }}>{btns.map((b, i) => <span key={i} style={{ fontSize: 10.5, padding: "2px 8px", borderRadius: 999, background: "#f1f5f9", color: "#475569", fontWeight: 700 }}>{b.type === "URL" ? "🔗" : b.type === "PHONE_NUMBER" ? "📞" : "💬"} {b.text}</span>)}</div>}
              {t.status === "REJECTED" && <div style={{ marginTop: 6, fontSize: 12, color: "#b91c1c" }}>Motivo de Meta: {rejectedReasonLabel(t.rejected_reason)}</div>}
              <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                <button type="button" onClick={() => onUseAsBase(t)} style={btnSec}>📄 Usar como base</button>
                {t.status !== "APPROVED" && confirm !== key && <button type="button" onClick={() => setConfirm(key)} style={{ ...btnSec, color: "#b91c1c" }}>🗑 Eliminar</button>}
                {t.status !== "APPROVED" && confirm === key && (
                  <>
                    <button type="button" disabled={busy === key} onClick={() => remove(t)} style={{ ...btnSec, background: "#b91c1c", color: "#fff", border: "none" }}>{busy === key ? "Eliminando…" : "Sí, eliminar en Meta"}</button>
                    <button type="button" onClick={() => setConfirm(null)} style={btnSec}>No</button>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

const card: React.CSSProperties = { background: "#faf7fc", border: "1px solid rgba(106,23,140,0.12)", borderRadius: 14, padding: 16 };
const lbl: React.CSSProperties = { display: "block", fontSize: 10.5, fontWeight: 800, color: "#475569", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 };
const soft: React.CSSProperties = { fontWeight: 500, color: "#94a3b8", textTransform: "none", letterSpacing: 0 };
const hint: React.CSSProperties = { fontSize: 11, color: "#94a3b8", marginTop: 4 };
const inp: React.CSSProperties = { width: "100%", padding: "9px 12px", fontSize: 13, border: "1px solid rgba(0,0,0,0.12)", borderRadius: 8, background: "#fff", color: "#1a1a2e", boxSizing: "border-box", fontFamily: "inherit" };
const btnPrimary: React.CSSProperties = { padding: "11px 18px", fontSize: 13.5, fontWeight: 800, color: "#fff", background: `linear-gradient(135deg, ${PURPLE}, #8B2FB5)`, border: "none", borderRadius: 10, cursor: "pointer", boxShadow: "0 4px 14px rgba(106,23,140,0.28)", fontFamily: "inherit" };
const btnSec: React.CSSProperties = { padding: "7px 12px", fontSize: 12, fontWeight: 700, color: "#475569", background: "#fff", border: "1px solid rgba(0,0,0,0.12)", borderRadius: 8, cursor: "pointer", fontFamily: "inherit" };
const errBox: React.CSSProperties = { padding: "10px 14px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, fontSize: 12.5, color: "#991b1b", marginBottom: 12 };
const pill = (color: string): React.CSSProperties => ({ fontSize: 10, padding: "2px 8px", borderRadius: 999, background: `${color}18`, color, fontWeight: 800 });
