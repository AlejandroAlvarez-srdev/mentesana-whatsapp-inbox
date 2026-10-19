// Constructor y validador de plantillas de WhatsApp (Meta message_templates) para el panel
// de inbox-v2 (/admin/inbox-v2/templates) y su API (/api/agent/inbox/template-builder).
// Reglas de Meta que aplicamos antes de enviar: nombre snake_case; encabezado ≤60 sin saltos y con
// una variable como mucho; cuerpo ≤1024 con variables {{1}}…{{n}} consecutivas y un ejemplo por
// variable; pie ≤60 sin variables; hasta 3 botones (respuesta rápida ≤25, enlace, llamar).
// Regla de la casa: nunca "gratis" en copy público (se usa "cortesía" / "cita de bienvenida").

export type WaButtonInput = { type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER"; text: string; url?: string; phone_number?: string };
export type WaTemplateInput = {
  name: string;
  category: "MARKETING" | "UTILITY";
  language: string;
  header_text?: string;
  header_example?: string;
  body_text: string;
  body_examples?: string[];
  footer_text?: string;
  buttons?: WaButtonInput[];
};
export type WaComponent = {
  type: "HEADER" | "BODY" | "FOOTER" | "BUTTONS";
  format?: "TEXT";
  text?: string;
  example?: { header_text?: string[]; body_text?: string[][] };
  buttons?: Array<{ type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER"; text: string; url?: string; phone_number?: string }>;
};

export const WA_LIMITS = { name: 512, header: 60, body: 1024, footer: 60, buttonText: 25, buttons: 3, url: 2000 } as const;
export const WA_LANGUAGES: Array<{ code: string; label: string }> = [
  { code: "es_ES", label: "Español (España)" },
  { code: "es", label: "Español" },
  { code: "es_MX", label: "Español (México)" },
  { code: "en_US", label: "English (US)" },
];
export const DEFAULT_EXAMPLES = ["Laura", "Marta", "lunes a las 10:00", "Bono Felicidad", "3"];

const VAR_RE = /\{\{\s*(\d+)\s*\}\}/g;

/** Nombre interno válido para Meta: minúsculas, dígitos y guiones bajos. */
export function normalizeTemplateName(raw: string): string {
  return raw
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_")
    .slice(0, WA_LIMITS.name);
}

/** Números de variable que aparecen en el texto, en orden de aparición (con repeticiones). */
export function listVariables(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(VAR_RE)) out.push(Number(m[1]));
  return out;
}

/** Cantidad de variables distintas que debe llevar el ejemplo (máximo índice usado). */
export function variableCount(text: string): number {
  const vars = listVariables(text);
  return vars.length ? Math.max(...vars) : 0;
}

/** Sustituye {{n}} por el ejemplo n (para la vista previa). */
export function fillExamples(text: string, examples: string[]): string {
  return text.replace(VAR_RE, (_, n) => examples[Number(n) - 1] || `{{${n}}}`);
}

export function validateTemplate(input: WaTemplateInput): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const name = input.name ?? "";
  if (!name) errors.push("Falta el nombre interno de la plantilla.");
  else if (!/^[a-z0-9_]+$/.test(name)) errors.push("El nombre solo puede llevar minúsculas, números y guiones bajos.");
  else if (name.length > WA_LIMITS.name) errors.push(`El nombre no puede pasar de ${WA_LIMITS.name} caracteres.`);
  if (!["MARKETING", "UTILITY"].includes(input.category)) errors.push("Elige la categoría (Marketing o Utilidad).");
  if (!input.language) errors.push("Elige el idioma.");

  const body = (input.body_text ?? "").trim();
  const bodyVars = listVariables(body);
  const bodyN = variableCount(body);
  if (!body) errors.push("Escribe el cuerpo del mensaje.");
  else {
    if (body.length > WA_LIMITS.body) errors.push(`El cuerpo no puede pasar de ${WA_LIMITS.body} caracteres (lleva ${body.length}).`);
    if (body.length < 20) warnings.push("Un cuerpo tan corto suele rechazarse: cuenta quién escribe y para qué.");
    const distinct = [...new Set(bodyVars)].sort((a, b) => a - b);
    if (distinct.some((v, i) => v !== i + 1)) errors.push("Las variables del cuerpo tienen que ser consecutivas: {{1}}, {{2}}, {{3}}… sin saltos.");
    const ex = (input.body_examples ?? []).map((s) => (s ?? "").trim());
    if (bodyN > 0 && (ex.length < bodyN || ex.slice(0, bodyN).some((s) => !s))) errors.push(`Pon un ejemplo para cada variable del cuerpo (${bodyN}).`);
    if (/^\s*\{\{\s*\d+\s*\}\}/.test(body) || /\{\{\s*\d+\s*\}\}\s*[.!?]?\s*$/.test(body)) warnings.push("Meta suele rechazar cuerpos que empiezan o terminan con una variable: añade texto antes y después.");
    if (bodyN > 0 && body.replace(VAR_RE, "").trim().length < bodyN * 15) warnings.push("Demasiadas variables para tan poco texto: Meta lo rechaza por formato.");
    if (/\bgratis\b/i.test(body)) errors.push("Nada de «gratis» en el copy público: usa «cortesía» o «cita de bienvenida».");
    if (/\b(100 ?%|garantizad[oa]|gana dinero|última oportunidad|urgente!!)/i.test(body)) warnings.push("Evita promesas absolutas o urgencia agresiva: Meta lo marca como spam.");
  }

  const header = (input.header_text ?? "").trim();
  if (header) {
    if (header.length > WA_LIMITS.header) errors.push(`El encabezado no puede pasar de ${WA_LIMITS.header} caracteres.`);
    if (/\n/.test(header)) errors.push("El encabezado no admite saltos de línea.");
    const hv = [...new Set(listVariables(header))];
    if (hv.length > 1 || (hv.length === 1 && hv[0] !== 1)) errors.push("El encabezado admite una sola variable y tiene que ser {{1}}.");
    if (hv.length === 1 && !(input.header_example ?? "").trim()) errors.push("Pon un ejemplo para la variable del encabezado.");
    if (/\bgratis\b/i.test(header)) errors.push("Nada de «gratis» en el encabezado.");
  }

  const footer = (input.footer_text ?? "").trim();
  if (footer) {
    if (footer.length > WA_LIMITS.footer) errors.push(`El pie no puede pasar de ${WA_LIMITS.footer} caracteres.`);
    if (/\n/.test(footer)) errors.push("El pie no admite saltos de línea.");
    if (listVariables(footer).length) errors.push("El pie no admite variables.");
  }

  const buttons = (input.buttons ?? []).filter((b) => (b.text ?? "").trim());
  if (buttons.length > WA_LIMITS.buttons) errors.push(`Como mucho ${WA_LIMITS.buttons} botones.`);
  buttons.forEach((b, i) => {
    const t = b.text.trim();
    if (t.length > WA_LIMITS.buttonText) errors.push(`El texto del botón ${i + 1} no puede pasar de ${WA_LIMITS.buttonText} caracteres.`);
    if (b.type === "URL") {
      const u = (b.url ?? "").trim();
      if (!/^https?:\/\/\S+$/i.test(u)) errors.push(`El botón «${t}» necesita un enlace que empiece por https://`);
      else if (u.length > WA_LIMITS.url) errors.push(`El enlace del botón «${t}» es demasiado largo.`);
    }
    if (b.type === "PHONE_NUMBER" && !/^\+\d{8,15}$/.test((b.phone_number ?? "").replace(/[\s-]/g, ""))) errors.push(`El botón «${t}» necesita un teléfono con prefijo, p. ej. +34 XXX XXX XXX.`);
  });

  return { errors, warnings };
}

/** Componentes en el formato que espera POST /{waba}/message_templates. */
export function buildComponents(input: WaTemplateInput): WaComponent[] {
  const components: WaComponent[] = [];
  const header = (input.header_text ?? "").trim();
  if (header) {
    const h: WaComponent = { type: "HEADER", format: "TEXT", text: header };
    if (listVariables(header).length) h.example = { header_text: [(input.header_example ?? "").trim()] };
    components.push(h);
  }
  const body = (input.body_text ?? "").trim();
  const b: WaComponent = { type: "BODY", text: body };
  const n = variableCount(body);
  if (n > 0) b.example = { body_text: [(input.body_examples ?? []).slice(0, n).map((s) => (s ?? "").trim())] };
  components.push(b);
  const footer = (input.footer_text ?? "").trim();
  if (footer) components.push({ type: "FOOTER", text: footer });
  const buttons = (input.buttons ?? []).filter((x) => (x.text ?? "").trim()).slice(0, WA_LIMITS.buttons);
  if (buttons.length) {
    // Meta exige que las respuestas rápidas vayan agrupadas: primero las QUICK_REPLY, luego enlace/llamada.
    const ordered = [...buttons.filter((x) => x.type === "QUICK_REPLY"), ...buttons.filter((x) => x.type !== "QUICK_REPLY")];
    components.push({
      type: "BUTTONS",
      buttons: ordered.map((x) => {
        const text = x.text.trim().slice(0, WA_LIMITS.buttonText);
        if (x.type === "URL") return { type: "URL", text, url: (x.url ?? "").trim() };
        if (x.type === "PHONE_NUMBER") return { type: "PHONE_NUMBER", text, phone_number: (x.phone_number ?? "").replace(/[\s-]/g, "") };
        return { type: "QUICK_REPLY", text };
      }),
    });
  }
  return components;
}

/** Cuerpo del POST a Meta. allow_category_change evita el rechazo por categoría mal elegida. */
export function buildMetaPayload(input: WaTemplateInput) {
  return { name: input.name, language: input.language, category: input.category, allow_category_change: true, components: buildComponents(input) };
}

/** Mensaje entendible a partir del error que devuelve Graph. */
export function friendlyMetaError(err: unknown): string {
  const e = (err ?? {}) as { code?: number; error_subcode?: number; message?: string; error_user_msg?: string; error_user_title?: string };
  const user = e.error_user_msg || "";
  if (e.code === 190) return "El token del número ha caducado o no es válido: hay que re-onboardear el número (CTO).";
  if (e.error_subcode === 2388023 || /already exists|ya existe/i.test(e.message ?? "") || /name/i.test(e.message ?? "") && /exist/i.test(e.message ?? "")) return "Ya hay una plantilla con ese nombre en este número: cambia el nombre.";
  if (e.error_subcode === 2388042 || /example/i.test(user) || /example/i.test(e.message ?? "")) return "Faltan o sobran ejemplos para las variables: pon uno por cada {{n}}.";
  if (e.error_subcode === 2388043 || /invalid parameter|format/i.test(user)) return `Formato no válido para Meta: ${user || e.message || ""}`.trim();
  if (e.code === 100 && /category/i.test(user + (e.message ?? ""))) return "Meta no acepta esa categoría para este contenido: prueba con Marketing.";
  if (e.code === 368 || e.code === 80008) return "Meta ha bloqueado temporalmente la creación de plantillas en este número; prueba más tarde.";
  return user || e.message || "Meta ha rechazado la petición sin dar detalle.";
}

/** Motivo de rechazo de Meta en lenguaje de la casa. */
export function rejectedReasonLabel(reason: string | null | undefined): string {
  switch ((reason ?? "").toUpperCase()) {
    case "ABUSIVE_CONTENT": return "Contenido que Meta considera abusivo o engañoso";
    case "INCORRECT_CATEGORY": return "Categoría incorrecta para el contenido";
    case "INVALID_FORMAT": return "Formato no válido (variables, ejemplos o longitud)";
    case "SCAM": return "Meta lo ha marcado como posible estafa";
    case "TAG_CONTENT_MISMATCH": return "El contenido no encaja con la categoría";
    case "NONE": case "": return "Sin motivo indicado por Meta";
    default: return reason ?? "";
  }
}
