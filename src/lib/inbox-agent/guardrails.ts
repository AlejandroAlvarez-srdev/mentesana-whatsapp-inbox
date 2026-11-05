// Guardrails del borrador IA — se aplican EN CÓDIGO, no solo en el prompt.
// Puro (sin I/O) para poder testearlo con vitest.
//
// 1) Riesgo vital / autolesión / violencia → intent clinico-urgente, sin texto comercial,
//    sin borrador: acción escalar_humano para que lo atienda una persona ya.
// 2) Nunca consejo clínico ni diagnóstico (se quitan las frases que lo parezcan).
// 3) Nunca prometer reembolsos, descuentos ni sesiones regaladas (se quitan esas frases).
// 4) Nunca "gratis"/"gratuito" en copy (memoria feedback_nunca_gratis_bienvenida) → "de cortesía".
// 5) Sin datos de otros pacientes: emails/teléfonos que no sean del propio paciente → ocultos.
// 6) Nada que parezca un secreto (API keys, JWT, tokens, PIN, contraseñas) ni en la entrada
//    al modelo ni en el borrador.
import { ACTION_TYPES, INTENTS, type ActionType, type DraftResult, type Intent, type SuggestedAction } from "./types";

export function normalize(text: string): string {
  return (text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── 1) Riesgo ────────────────────────────────────────────────────────────────
export type RiskKind ="suicidio" | "autolesion" | "violencia";
const RISK_PATTERNS: { kind: RiskKind; re: RegExp }[] = [
  { kind: "suicidio", re: /suicid/ },
  { kind: "suicidio", re: /quitar(me|se|te)? la vida/ },
  { kind: "suicidio", re: /\b(matarme|me voy a matar|me quiero matar|quiero matarme)\b/ },
  { kind: "suicidio", re: /no quiero (seguir )?(vivir|viviendo|estar vivo|estar viva|seguir aqui)/ },
  { kind: "suicidio", re: /(ganas de morir|quiero morir|me quiero morir|deseo morir|prefiero (estar )?muert[oa]|mejor (estaria |estar )?muert[oa])/ },
  { kind: "suicidio", re: /(acabar con (todo|mi vida)|terminar con mi vida|desaparecer para siempre|no despertar(me)? (nunca|mas)|dormirme y no despertar)/ },
  { kind: "suicidio", re: /(sobredosis|tomarme todas las pastillas|tomarme el bote)/ },
  { kind: "suicidio", re: /tirarme (por la ventana|por el balcon|del puente|desde|a las vias|al tren|al metro)/ },
  { kind: "autolesion", re: /autolesi/ },
  // Conservador a propósito: "me he hecho daño en el tobillo" también salta; lo revisa un humano.
  { kind: "autolesion", re: /(hacerme dano|hacerse dano|me hago dano|me he hecho dano|(vuelto|volver|ganas) (a |de )?hacer(me)? dano)/ },
  { kind: "autolesion", re: /(cortar(me)?|me corto|me he cortado|me volvi a cortar|me he vuelto a cortar) (las venas|los brazos|el brazo|las munecas|la muneca|las piernas)/ },
  { kind: "suicidio", re: /(estarian|estaria|estarias|estaran) mejor sin mi\b/ },
  { kind: "violencia", re: /(violencia de genero|me pega\b|me maltrata|me ha pegado|me amenaza con matarme|tengo miedo de que me mate)/ },
];

export type RiskResult = { risk: boolean; kinds: RiskKind[]; matched: string[] };

export function detectRisk(...texts: (string | null | undefined)[]): RiskResult {
  const t = normalize(texts.filter(Boolean).join(" \n "));
  const kinds = new Set<RiskKind>();
  const matched: string[] = [];
  for (const p of RISK_PATTERNS) {
    const m = t.match(p.re);
    if (m) { kinds.add(p.kind); matched.push(m[0]); }
  }
  return { risk: kinds.size > 0, kinds: [...kinds], matched };
}

export const CRISIS_PROTOCOL_NOTE =
  "Posible riesgo: NO enviar texto comercial ni respuesta automática. Que lo atienda ya una persona " +
  "y avisar a coordinación clínica (jefas de psicólogas).";

export function crisisResult(kinds: RiskKind[], matched: string[]): DraftResult {
  return {
    intent: "clinico-urgente",
    draft_reply: "", // sin borrador: lo escribe una persona
    suggested_actions: [{ type: "escalar_humano", params: { prioridad: "urgente", protocolo: "crisis" }, reason: CRISIS_PROTOCOL_NOTE }],
    confidence: 1,
    warnings: [`⚠️ Riesgo detectado (${kinds.join(", ") || "indicado por la IA"}): ${matched.slice(0, 3).join(" · ")}. Responde tú y avisa a coordinación clínica.`],
  };
}

// ─── 6) Secretos ──────────────────────────────────────────────────────────────
const SECRET_PATTERNS: RegExp[] = [
  /\bsk-ant-[A-Za-z0-9_-]{8,}/g,
  /\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{8,}/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, // JWT
  /\b(EAA|ya29\.|ghp_|gho_|xox[bap]-)[A-Za-z0-9._-]{10,}/g, // Meta, Google, GitHub, Slack
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /\b(password|contrase(ñ|n)a|passwd|pin|token|secret|secreto|api[ _-]?key|clave)\s*[:=]\s*\S+/gi,
  /\b[A-Fa-f0-9]{32,}\b/g,
  // Cadena larga tipo base64 con mayúsculas, minúsculas y dígitos (sin "/" para no comerse rutas de URL)
  /\b(?=[A-Za-z0-9+]*\d)(?=[A-Za-z0-9+]*[A-Z])(?=[A-Za-z0-9+]*[a-z])[A-Za-z0-9+]{32,}={0,2}/g,
];

export function redactSecrets(text: string): { text: string; redacted: boolean } {
  let out = text ?? "";
  let redacted = false;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, () => { redacted = true; return "[oculto]"; });
  }
  return { text: out, redacted };
}

// ─── 2/3) Frases prohibidas (consejo clínico, promesas económicas) ─────────────
const CLINICAL_PATTERNS: RegExp[] = [
  /\b(te|le|os) diagnostic/,
  /\b(tienes|tiene|padeces|sufres) (una? |un cuadro de |un trastorno de )?(depresion|ansiedad generalizada|trastorno|tlp|toc|tdah|bipolar|estres postraumatico|un cuadro)/,
  /\b(medicacion|pastillas|dosis|ansiolitico|antidepresivo|benzodiacepina|lorazepam|diazepam|alprazolam|sertralina|escitalopram|fluoxetina|orfidal|trankimazin|miligramos|\d+\s?mg)\b/,
  /\b(deberias|debes|te recomiendo|te aconsejo) (dejar de tomar|tomar|aumentar|reducir|bajar)\b/,
];
const PROMISE_PATTERNS: RegExp[] = [
  /\b(te|le|os|les) (devolvemos|devolveremos|devuelvo|devolvere|reembolsamos|reembolsaremos|abonamos|abonaremos)\b/,
  /\b(reembolso|devolucion) (completa?|total|integra?|del dinero|garantizad[oa])/,
  /\b(haremos|hacemos|tramitamos|tramitaremos) (el|un|tu) (reembolso|abono|devolucion)/,
  /\d+\s*%\s*(de )?(descuento|dto)/,
  /\b(descuento|cupon|codigo promocional|rebaja)\b/,
  /\b(te|le|os) regal(amos|aremos|o)\b/,
  /\bsesion(es)? (de regalo|regalada|sin coste|sin costo|extra sin coste)/,
  /\b(sin coste|sin costo|a coste cero|no te costara nada|no te cobramos|no te cobraremos)\b/,
];

function splitSentences(text: string): string[][] {
  return text.split(/\n/).map((line) => line.split(/(?<=[.!?…])\s+/).filter((s) => s.length > 0));
}

/** Reemplaza gratis/gratuito por formas permitidas. */
export function replaceGratis(text: string): { text: string; changed: boolean } {
  let changed = false;
  const out = text
    .replace(/\b(sesi[oó]n|cita|consulta|primera sesi[oó]n|valoraci[oó]n)\s+(gratis|gratuita)\b/gi, () => { changed = true; return "cita de bienvenida"; })
    .replace(/\bgratuitamente\b/gi, () => { changed = true; return "de cortesía"; })
    .replace(/\b(gratis|gratuit[oa]s?)\b/gi, () => { changed = true; return "de cortesía"; })
    .replace(/\bfree\b/gi, () => { changed = true; return "de cortesía"; });
  return { text: out, changed };
}

export type SanitizeOpts = { patientPhone?: string | null; patientEmail?: string | null };
const ALLOWED_EMAILS = new Set(["hola@mentesanapsicologia.com"]);
const ALLOWED_SHORT_NUMBERS = new Set<string>();
export const MAX_DRAFT_CHARS = 1000;

export function sanitizeDraft(raw: string, opts: SanitizeOpts = {}): { text: string; warnings: string[] } {
  const warnings: string[] = [];
  let text = String(raw ?? "").replace(/\r/g, "").trim();

  // 6) secretos
  const sec = redactSecrets(text);
  text = sec.text;
  if (sec.redacted) warnings.push("Se ocultó algo que parecía una clave o token.");

  // 2/3) quitar frases con consejo clínico o promesas económicas
  let droppedClinical = 0;
  let droppedPromise = 0;
  const kept = splitSentences(text).map((sentences) => sentences.filter((s) => {
    const n = normalize(s);
    if (CLINICAL_PATTERNS.some((re) => re.test(n))) { droppedClinical++; return false; }
    if (PROMISE_PATTERNS.some((re) => re.test(n))) { droppedPromise++; return false; }
    return true;
  }).join(" "));
  text = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (droppedClinical) warnings.push(`Se quitaron ${droppedClinical} frase(s) con tono de consejo clínico/medicación. Eso lo valora siempre una psicóloga.`);
  if (droppedPromise) warnings.push(`Se quitaron ${droppedPromise} frase(s) que prometían reembolso, descuento o sesiones regaladas. No prometas nada sin coordinación.`);

  // 4) gratis
  const g = replaceGratis(text);
  text = g.text;
  if (g.changed) warnings.push("Se cambió «gratis/gratuito» por «de cortesía»/«cita de bienvenida». Revisa que tenga sentido.");

  // 5) datos de terceros
  const patientEmail = (opts.patientEmail ?? "").trim().toLowerCase();
  const patientDigits = (opts.patientPhone ?? "").replace(/\D/g, "");
  let hidPii = false;
  text = text.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (m) => {
    const e = m.toLowerCase();
    if (ALLOWED_EMAILS.has(e) || (patientEmail && e === patientEmail)) return m;
    hidPii = true;
    return "[email oculto]";
  });
  text = text.replace(/\+?\d[\d\s.-]{7,}\d/g, (m) => {
    const d = m.replace(/\D/g, "");
    if (d.length < 9) return m;
    if (ALLOWED_SHORT_NUMBERS.has(d)) return m;
    if (patientDigits && (d.endsWith(patientDigits.slice(-9)) || patientDigits.endsWith(d.slice(-9)))) return m;
    hidPii = true;
    return "[teléfono oculto]";
  });
  if (hidPii) warnings.push("Se ocultaron emails/teléfonos que no son del paciente.");

  if (text.length > MAX_DRAFT_CHARS) {
    text = text.slice(0, MAX_DRAFT_CHARS).replace(/\s+\S*$/, "") + "…";
    warnings.push("Borrador recortado: en WhatsApp mejor corto.");
  }
  return { text, warnings };
}

// ─── Parseo/validación de la salida del modelo ────────────────────────────────
function isIntent(x: unknown): x is Intent {
  return typeof x === "string" && (INTENTS as readonly string[]).includes(x);
}
function isActionType(x: unknown): x is ActionType {
  return typeof x === "string" && (ACTION_TYPES as readonly string[]).includes(x);
}

function cleanParams(p: unknown): SuggestedAction["params"] {
  const out: SuggestedAction["params"] = {};
  if (!p || typeof p !== "object" || Array.isArray(p)) return out;
  for (const [k, v] of Object.entries(p as Record<string, unknown>).slice(0, 8)) {
    if (!/^[a-z_][a-z0-9_]{0,40}$/i.test(k)) continue;
    if (typeof v === "string") out[k] = redactSecrets(v.slice(0, 200)).text;
    else if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "boolean" || v === null) out[k] = v;
  }
  return out;
}

/** Extrae el primer objeto JSON del texto (tolera ```json …``` y prosa alrededor). */
export function extractJson(raw: string): unknown | null {
  const text = String(raw ?? "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

/**
 * Valida la salida del modelo. Nunca lanza: si no es válida devuelve un resultado vacío
 * (sin borrador) con aviso, para que el agente escriba a mano.
 */
export function parseModelOutput(raw: string, fallbackIntent: Intent): { ok: boolean; value: DraftResult } {
  const j = extractJson(raw) as Record<string, unknown> | null;
  if (!j || typeof j !== "object" || typeof j.draft_reply !== "string") {
    return {
      ok: false,
      value: { intent: fallbackIntent, draft_reply: "", suggested_actions: [], confidence: 0, warnings: ["La IA no devolvió un formato válido. Escribe la respuesta a mano."] },
    };
  }
  const actions: SuggestedAction[] = Array.isArray(j.suggested_actions)
    ? (j.suggested_actions as unknown[])
        .filter((a): a is Record<string, unknown> => !!a && typeof a === "object" && isActionType((a as Record<string, unknown>).type))
        .slice(0, 3)
        .map((a) => ({ type: a.type as ActionType, params: cleanParams(a.params), reason: String(a.reason ?? "").slice(0, 240) }))
    : [];
  const conf = Number(j.confidence);
  return {
    ok: true,
    value: {
      intent: isIntent(j.intent) ? j.intent : fallbackIntent,
      draft_reply: j.draft_reply,
      suggested_actions: actions,
      confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0.5,
      warnings: Array.isArray(j.warnings) ? (j.warnings as unknown[]).filter((w) => typeof w === "string").slice(0, 5).map((w) => (w as string).slice(0, 240)) : [],
    },
  };
}
