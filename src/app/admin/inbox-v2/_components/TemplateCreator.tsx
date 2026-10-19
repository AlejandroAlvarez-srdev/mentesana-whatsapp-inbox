"use client";

// Creador de plantillas de WhatsApp (formulario con reglas de Meta + vista previa), compartido por
// el panel /admin/inbox-v2/templates y la pestaña "✏️ Crear nueva" del modal 📋 de envío (TemplatesModal),
// para que las agentes creen plantillas ahí mismo, con su sesión, sin saltar a otro panel.
// API: /api/agent/inbox/template-builder (sesión de agente). Reglas: src/lib/wa-template-builder.ts.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_EXAMPLES, WA_LANGUAGES, WA_LIMITS, fillExamples, listVariables, normalizeTemplateName,
  validateTemplate, variableCount, type WaButtonInput, type WaTemplateInput,
} from "@/lib/wa-template-builder";

const PURPLE = "#6A178C";
export const TEMPLATE_BUILDER_API = "/api/agent/inbox/template-builder";

export type WaNumberInfo = { phone_number_id: string; name: string; phone_number: string | null; waba_id: string; is_default: boolean; ok: boolean };
export type TplComponent = { type: string; format?: string; text?: string; example?: { header_text?: string[]; body_text?: string[][] }; buttons?: Array<{ type: string; text: string; url?: string; phone_number?: string }> };
export type TplInfo = { id?: string; name: string; status: string; category: string; language: string; rejected_reason?: string; quality_score?: { score?: string }; components?: TplComponent[]; waba_id: string; numbers: string[] };
export type Seed = { title: string; name: string; category: "MARKETING" | "UTILITY"; language: string; header_text: string; header_example: string; body_text: string; body_examples: string[]; footer_text: string; buttons: WaButtonInput[]; waba_id?: string };

export const emptySeed = (): Seed => ({ title: "", name: "", category: "MARKETING", language: "es_ES", header_text: "", header_example: "Laura", body_text: "", body_examples: [], footer_text: "", buttons: [] });

/** Precarga el formulario con una plantilla existente (para sacar variantes). */
export function seedFromTemplate(t: TplInfo): Seed {
  const comps = t.components ?? [];
  const header = comps.find((c) => c.type === "HEADER" && (c.format ?? "TEXT") === "TEXT");
  const body = comps.find((c) => c.type === "BODY");
  const footer = comps.find((c) => c.type === "FOOTER");
  const buttons = (comps.find((c) => c.type === "BUTTONS")?.buttons ?? []).map((b) => ({ type: (b.type === "URL" ? "URL" : b.type === "PHONE_NUMBER" ? "PHONE_NUMBER" : "QUICK_REPLY") as WaButtonInput["type"], text: b.text, url: b.url, phone_number: b.phone_number }));
  const n = variableCount(body?.text ?? "");
  const ex = body?.example?.body_text?.[0] ?? [];
  return {
    title: `${t.name} v2`, name: `${t.name}_v2`, category: t.category === "UTILITY" ? "UTILITY" : "MARKETING", language: t.language || "es_ES",
    header_text: header?.text ?? "", header_example: header?.example?.header_text?.[0] ?? "Laura",
    body_text: body?.text ?? "", body_examples: Array.from({ length: n }, (_, i) => ex[i] || DEFAULT_EXAMPLES[i] || `ejemplo ${i + 1}`),
    footer_text: footer?.text ?? "", buttons, waba_id: t.waba_id,
  };
}

/** Versión autónoma: carga números y plantillas y muestra solo el formulario (para el modal 📋). */
export default function TemplateCreator({ defaultPhoneNumberId, onCreated }: { defaultPhoneNumberId?: string | null; onCreated?: (name: string) => void }) {
  const [numbers, setNumbers] = useState<WaNumberInfo[]>([]);
  const [templates, setTemplates] = useState<TplInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(TEMPLATE_BUILDER_API, { credentials: "include", cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setNumbers(d.numbers ?? []);
      setTemplates(d.templates ?? []);
      setLoadErr(null);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { queueMicrotask(() => { void load(); }); }, [load]);

  const pending = templates.filter((t) => t.status === "PENDING");
  const seed = emptySeed();
  if (defaultPhoneNumberId) seed.waba_id = numbers.find((n) => n.phone_number_id === defaultPhoneNumberId)?.waba_id;

  if (loading && numbers.length === 0) return <div style={{ padding: 30, textAlign: "center", color: "#888", fontSize: 13 }}>Cargando números y plantillas de Meta…</div>;
  if (loadErr) return <div style={errBox}>⚠️ No se pudo cargar: {loadErr}</div>;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {done && (
        <div style={{ padding: "12px 14px", background: "rgba(16,185,129,0.1)", color: "#065f46", borderRadius: 10, fontSize: 13, lineHeight: 1.5 }}>
          <strong>✓ {done}</strong><br />
          Meta la revisa entre 1 minuto y 24 h. Cuando esté aprobada aparecerá en la lista de la izquierda al reabrir el modal.
          <div style={{ marginTop: 8 }}><button type="button" onClick={() => { setDone(null); setFormKey((k) => k + 1); }} style={btnSec}>Crear otra</button></div>
        </div>
      )}
      {pending.length > 0 && !done && (
        <div style={{ fontSize: 12, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: "8px 12px" }}>
          ⏳ {pending.length} plantilla{pending.length === 1 ? "" : "s"} pendiente{pending.length === 1 ? "" : "s"} de Meta: {pending.slice(0, 5).map((t) => t.name).join(", ")}{pending.length > 5 ? "…" : ""}
        </div>
      )}
      {!done && <TemplateForm key={formKey} numbers={numbers} seed={seed} existing={templates} onCreated={(msg, name) => { setDone(msg); onCreated?.(name); void load(); }} />}
      <div style={{ fontSize: 11.5, color: "#94a3b8" }}>Para ver todas las plantillas con su estado, sacar variantes o borrar rechazadas: <a href="/agent/plantillas?tab=whatsapp" style={{ color: PURPLE, fontWeight: 700 }}>📝 Plantillas</a>.</div>
    </div>
  );
}

// ─── Formulario ──────────────────────────────────────────────────────────────
export function TemplateForm({ numbers, seed, existing, onCreated }: { numbers: WaNumberInfo[]; seed: Seed; existing: TplInfo[]; onCreated: (msg: string, name: string) => void }) {
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
      const r = await fetch(TEMPLATE_BUILDER_API, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone_number_id: phoneNumberId, ...input }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (r.status === 409 && d.suggestion) { setName(d.suggestion); setNameTouched(true); }
        throw new Error(d.error || `HTTP ${r.status}`);
      }
      onCreated(`Plantilla «${d.template?.name}» enviada a Meta desde ${d.number?.name}. Estado: ${d.template?.status === "APPROVED" ? "aprobada" : "pendiente de revisión"}.`, String(d.template?.name ?? name));
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

export const card: React.CSSProperties = { background: "#faf7fc", border: "1px solid rgba(106,23,140,0.12)", borderRadius: 14, padding: 16 };
export const lbl: React.CSSProperties = { display: "block", fontSize: 10.5, fontWeight: 800, color: "#475569", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 };
export const soft: React.CSSProperties = { fontWeight: 500, color: "#94a3b8", textTransform: "none", letterSpacing: 0 };
export const hint: React.CSSProperties = { fontSize: 11, color: "#94a3b8", marginTop: 4 };
export const inp: React.CSSProperties = { width: "100%", padding: "9px 12px", fontSize: 13, border: "1px solid rgba(0,0,0,0.12)", borderRadius: 8, background: "#fff", color: "#1a1a2e", boxSizing: "border-box", fontFamily: "inherit" };
export const btnPrimary: React.CSSProperties = { padding: "11px 18px", fontSize: 13.5, fontWeight: 800, color: "#fff", background: `linear-gradient(135deg, ${PURPLE}, #8B2FB5)`, border: "none", borderRadius: 10, cursor: "pointer", boxShadow: "0 4px 14px rgba(106,23,140,0.28)", fontFamily: "inherit" };
export const btnSec: React.CSSProperties = { padding: "7px 12px", fontSize: 12, fontWeight: 700, color: "#475569", background: "#fff", border: "1px solid rgba(0,0,0,0.12)", borderRadius: 8, cursor: "pointer", fontFamily: "inherit" };
export const errBox: React.CSSProperties = { padding: "10px 14px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, fontSize: 12.5, color: "#991b1b", marginBottom: 12 };
export const pill = (color: string): React.CSSProperties => ({ fontSize: 10, padding: "2px 8px", borderRadius: 999, background: `${color}18`, color, fontWeight: 800 });
