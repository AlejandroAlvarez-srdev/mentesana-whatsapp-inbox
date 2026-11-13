// Linter de cumplimiento para plantillas de WhatsApp. `wa-template-builder` comprueba que Meta
// ACEPTE la plantilla (longitudes, variables, ejemplos); esto comprueba que DEBAMOS enviarla:
// reglas de Meta sobre categoría y contenido, LSSI (identificar al remitente y dar la baja),
// RGPD art. 9 (no suponer datos de salud del destinatario) y publicidad sanitaria (no prometer
// resultados). Nació del post-mortem de noviembre de 2026: cada regla corresponde a algo que se envió.
//
// Todo son funciones puras sobre el mismo `WaTemplateInput` del constructor, para poder pasarlo
// en el panel (antes de crear), en CI (sobre el catálogo) y en el envío (antes de programar un lote).

import type { WaTemplateInput } from "./wa-template-builder";

export type Severity = "error" | "warning";
export type Finding = { rule: string; severity: Severity; message: string };

export type PolicyOptions = {
  /** Nombre comercial que debe aparecer en el cuerpo de toda plantilla de marketing. */
  brand: string;
  /** Dominios a los que puede apuntar un botón de enlace (el propio y la pasarela de pago). */
  allowedHosts: string[];
  /** Palabra que el destinatario responde para darse de baja; debe estar en el pie. */
  optOutKeyword?: string;
  /** Texto del botón de respuesta rápida que dispara la baja nativa. */
  optOutButton?: string;
};

const DEFAULTS = { optOutKeyword: "BAJA", optOutButton: "Darme de baja" };

const VAR = /\{\{\s*\d+\s*\}\}/;
const EMOJI = /\p{Extended_Pictographic}/u;

// Condiciones que no se pueden atribuir al destinatario. El producto se nombra ("diagnóstico
// inicial", "terapia de pareja"); lo que no se hace es afirmar que la persona tiene algo.
const CONDITIONS = "ansiedad|depresi[oó]n|estr[eé]s|insomnio|p[aá]nico|trastorno|duelo|adicci[oó]n|tartamudez|sobrepeso|obesidad|trauma";
const HEALTH_ASSUMPTION = new RegExp(
  `\\b(?:tu|tus|sigues con|sigues teniendo|sufres(?: de)?|padeces|tienes|superar (?:tu|la))\\s+(?:\\S+\\s+){0,2}?(?:${CONDITIONS})`,
  "i",
);
const RESULT_GUARANTEE = /garantiza|garant[ií]a de|te curar|curamos|100\s?%|resultados asegurados|sin reca[ií]das|cambiar[áa]?\s+(?:por completo\s+)?tu vida|adelgaza|pierde \d+ ?kilos|sin pasar hambre/i;
const PROMO = /descuento|oferta|promoci[oó]n|rebaja|precio especial|aprovecha|regalo|\d+\s?% de|cup[oó]n|[uú]ltima oportunidad|solo hoy/i;
const PRESSURE = /[uú]ltima oportunidad|solo hoy|[uú]ltimas plazas|no te lo pierdas|date prisa|ahora o nunca/i;
const FREE = /\bgratis\b|\bgratuit[oa]s?\b/i;

/** Revisa una plantilla. Los `error` impiden crearla o enviarla; los `warning` se muestran. */
export function lintTemplate(t: WaTemplateInput, options: PolicyOptions): Finding[] {
  const o = { ...DEFAULTS, ...options };
  const out: Finding[] = [];
  const add = (rule: string, severity: Severity, message: string) => out.push({ rule, severity, message });
  const body = t.body_text.trim();
  const everything = [t.header_text, body, t.footer_text, ...(t.buttons ?? []).map(b => b.text)].filter(Boolean).join("\n");
  const marketing = t.category === "MARKETING";

  // ── Quién escribe y cómo se sale ──────────────────────────────────────────
  if (marketing && !body.toLowerCase().includes(o.brand.toLowerCase()))
    add("brand-named", "error", `El cuerpo no nombra a ${o.brand}: una comunicación comercial debe identificar al remitente.`);
  if (!(t.footer_text ?? "").includes(o.optOutKeyword))
    add("opt-out-footer", "error", `El pie no explica la baja (falta «${o.optOutKeyword}»).`);
  if (marketing && !(t.buttons ?? []).some(b => b.type === "QUICK_REPLY" && b.text === o.optOutButton))
    add("opt-out-button", "error", `Falta el botón «${o.optOutButton}»: es el que registra la baja sin que nadie tenga que leer el chat.`);

  // ── Categoría ─────────────────────────────────────────────────────────────
  if (!marketing && PROMO.test(everything))
    add("utility-with-promo", "error", "Una plantilla de utilidad no puede llevar contenido promocional: Meta la reclasifica y lo cuenta como mala clasificación.");

  // ── Contenido ─────────────────────────────────────────────────────────────
  if (HEALTH_ASSUMPTION.test(everything))
    add("health-assumption", "error", "El texto atribuye una condición de salud al destinatario. Nombra el servicio, no la condición.");
  if (RESULT_GUARANTEE.test(everything))
    add("result-guarantee", "error", "El texto promete un resultado. En servicios sanitarios no se garantizan resultados.");
  if (FREE.test(everything))
    add("no-free", "error", "No se usa «gratis» en copy público («cita de cortesía», «cita de bienvenida»).");
  if (PRESSURE.test(everything))
    add("pressure", "warning", "Lenguaje de urgencia: es lo que más bloqueos y denuncias genera.");
  const shouting = body.match(/\b[A-ZÁÉÍÓÚÑ]{5,}\b/g)?.filter(w => w !== o.optOutKeyword) ?? [];
  if (shouting.length >= 2)
    add("shouting", "warning", `Varias palabras en mayúsculas (${shouting.slice(0, 3).join(", ")}).`);

  // ── Forma ─────────────────────────────────────────────────────────────────
  if (new RegExp(`^${VAR.source}`).test(body) || new RegExp(`${VAR.source}$`).test(body))
    add("variable-at-edge", "error", "El cuerpo empieza o termina con una variable; Meta lo rechaza.");
  if (t.header_text && EMOJI.test(t.header_text))
    add("emoji-in-header", "error", "El encabezado lleva un emoji.");
  for (const b of t.buttons ?? []) {
    if (EMOJI.test(b.text)) add("emoji-in-button", "error", `El botón «${b.text}» lleva un emoji.`);
    if (b.type !== "URL" || !b.url) continue;
    const host = hostOf(b.url);
    if (!host || !o.allowedHosts.some(h => host === h || host.endsWith("." + h)))
      add("foreign-url", "error", `El botón «${b.text}» apunta a ${host ?? "una URL no válida"}, fuera de los dominios permitidos.`);
  }
  return out;
}

export const hasErrors = (findings: Finding[]) => findings.some(f => f.severity === "error");

function hostOf(url: string): string | null {
  try { return new URL(url.replace(VAR, "x")).hostname.replace(/^www\./, ""); } catch { return null; }
}

// ── Catálogo: variaciones que de verdad sean distintas ──────────────────────
// Rotar cinco redacciones del mismo mensaje solo sirve si son cinco redacciones. Meta rechaza
// las plantillas duplicadas, y dos textos que solo cambian un saludo cuentan como el mismo.

/** Palabras con contenido (sin variables, signos ni palabras vacías), en minúsculas y sin acentos. */
export function contentWords(text: string): string[] {
  const STOP = new Set(["de", "la", "el", "en", "y", "a", "que", "tu", "tus", "te", "con", "para", "por", "un", "una", "los", "las", "si", "lo", "es", "al", "del", "se", "o"]);
  return text
    .replace(/\{\{\s*\d+\s*\}\}/g, " ")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(w => w.length > 1 && !STOP.has(w));
}

/** Parecido entre dos cuerpos: Jaccard sobre pares de palabras consecutivas (0 = nada, 1 = idénticos). */
export function similarity(a: string, b: string): number {
  const shingles = (t: string) => { const w = contentWords(t); return new Set(w.slice(1).map((x, i) => w[i] + " " + x)); };
  const A = shingles(a), B = shingles(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const s of A) if (B.has(s)) shared++;
  return shared / (A.size + B.size - shared);
}

/** Pares de plantillas demasiado parecidas entre sí dentro de un catálogo. */
export function findNearDuplicates(catalog: Array<Pick<WaTemplateInput, "name" | "body_text">>, threshold = 0.6) {
  const pairs: Array<{ a: string; b: string; similarity: number }> = [];
  for (let i = 0; i < catalog.length; i++)
    for (let j = i + 1; j < catalog.length; j++) {
      const s = similarity(catalog[i].body_text, catalog[j].body_text);
      if (s >= threshold) pairs.push({ a: catalog[i].name, b: catalog[j].name, similarity: Math.round(s * 100) / 100 });
    }
  return pairs.sort((x, y) => y.similarity - x.similarity);
}
