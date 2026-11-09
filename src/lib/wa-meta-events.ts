// Webhooks de Meta (WhatsApp) que el monolito reenvía a /api/whatsapp/meta-events:
//   · user_preferences: el usuario desactiva/reactiva el marketing desde WhatsApp → baja en
//     app_outreach_optout (source 'wa_pref') o se quita esa baja (solo la de wa_pref).
//   · message_template_quality_update / message_template_status_update / template_category_update:
//     salud de cada plantilla → wa_template_health (+ log en wa_template_events) y aviso al CTO.
// Aquí solo helpers puros (testeados en wa-meta-events.test.ts); la E/S vive en la ruta.
import { digits, isBsuid, optoutKey } from "./wa-send-guard";

export const PREF_FIELD = "user_preferences";
export const TEMPLATE_FIELDS = new Set([
  "message_template_quality_update",
  "message_template_status_update",
  "template_category_update",
  "message_template_components_update",
]);

export const OPTOUT_SOURCE = "wa_pref";
export const OPTOUT_REASON = "Desactivó el marketing desde WhatsApp";
export const OPTOUT_CREATED_BY = "meta-webhook";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown) => (v == null ? "" : String(v).trim());

export type PrefOp = {
  action: "stop" | "resume";
  /** Claves de baja (teléfono en dígitos y/o BSUID). Con ambos se guardan las dos: el freno compara
   *  el destinatario tal como esté guardado (teléfono o BSUID). */
  keys: string[];
  wa_id: string | null;
  user_id: string | null;
  category: string;
  timestamp: number | null;
};

/** Convierte value.user_preferences en operaciones de baja/alta. Ignora lo que no sea marketing_messages. */
export function parsePreferences(value: unknown): PrefOp[] {
  const v = obj(value);
  const items = Array.isArray(v.user_preferences) ? v.user_preferences : [];
  const ops: PrefOp[] = [];
  for (const raw of items) {
    const it = obj(raw);
    const action = str(it.value).toLowerCase();
    if (action !== "stop" && action !== "resume") continue;
    const category = str(it.category) || "marketing_messages";
    if (category !== "marketing_messages") continue;
    const userId = str(it.user_id);
    const waDigits = digits(it.wa_id);
    const keys: string[] = [];
    if (userId && isBsuid(userId)) keys.push(optoutKey(userId));
    if (waDigits) keys.push(waDigits);
    if (keys.length === 0) continue;
    const ts = Number(it.timestamp);
    ops.push({
      action,
      keys,
      wa_id: waDigits || null,
      user_id: userId || null,
      category,
      timestamp: Number.isFinite(ts) && ts > 0 ? ts : null,
    });
  }
  return ops;
}

/** Fila de app_outreach_optout para una clave (email es PK: 'wa:'+dígitos o 'wa:'+BSUID). */
export function optoutRow(key: string) {
  return { email: `wa:${key}`, phone: key, reason: OPTOUT_REASON, source: OPTOUT_SOURCE, created_by: OPTOUT_CREATED_BY };
}

export type TemplateEvent = {
  template_name: string;
  language: string;
  template_id: string | null;
  /** Columnas a actualizar en wa_template_health (solo las que trae el evento). */
  patch: { quality?: string; status?: string; category?: string; last_event: string; last_reason: string | null };
};

/** Normaliza un cambio de plantilla. null si falta el nombre. */
export function parseTemplateEvent(field: string, value: unknown): TemplateEvent | null {
  const v = obj(value);
  const name = str(v.message_template_name);
  if (!name) return null;
  const language = str(v.message_template_language);
  const id = str(v.message_template_id) || null;
  const patch: TemplateEvent["patch"] = { last_event: field, last_reason: null };
  if (field === "message_template_quality_update") {
    const q = str(v.new_quality_score).toUpperCase();
    if (q) patch.quality = q;
    patch.last_event = `quality:${str(v.previous_quality_score).toUpperCase() || "?"}→${q || "?"}`;
  } else if (field === "message_template_status_update") {
    const ev = str(v.event).toUpperCase();
    if (ev) patch.status = ev;
    const cat = str(v.message_template_category).toUpperCase();
    if (cat) patch.category = cat;
    patch.last_event = `status:${ev || "?"}`;
    const other = obj(v.other_info);
    const reason = [str(v.reason), str(other.title), str(other.description)].filter((x) => x && x.toUpperCase() !== "NONE").join(" · ");
    patch.last_reason = reason || null;
  } else if (field === "template_category_update") {
    const nc = str(v.new_category).toUpperCase();
    const cc = str(v.correct_category).toUpperCase();
    if (nc) patch.category = nc;
    patch.last_event = cc ? `category:${nc || "?"}→${cc} (pendiente)` : `category:${str(v.previous_category).toUpperCase() || "?"}→${nc || "?"}`;
    patch.last_reason = cc ? `Meta recategorizará a ${cc}` : null;
  } else {
    patch.last_event = field;
  }
  return { template_name: name, language, template_id: id, patch };
}

const ALERT_STATUSES = new Set(["PAUSED", "DISABLED", "FLAGGED", "REJECTED"]);

/**
 * ¿Hay que avisar al CTO? Devuelve la clave de estado (para no repetir el mismo aviso en 24 h) o null.
 * Avisa con calidad YELLOW/RED, estado PAUSED/DISABLED/FLAGGED/REJECTED o recategorización inminente.
 */
export function templateAlertKey(field: string, value: unknown): string | null {
  const v = obj(value);
  if (field === "message_template_quality_update") {
    const q = str(v.new_quality_score).toUpperCase();
    return q === "YELLOW" || q === "RED" ? `quality:${q}` : null;
  }
  if (field === "message_template_status_update") {
    const ev = str(v.event).toUpperCase();
    return ALERT_STATUSES.has(ev) ? `status:${ev}` : null;
  }
  if (field === "template_category_update") {
    const cc = str(v.correct_category).toUpperCase();
    return cc ? `category:${cc}` : null;
  }
  return null;
}

export const ALERT_DEDUPE_MS = 24 * 3600 * 1000;

/** ¿Ya se avisó de este mismo estado en las últimas 24 h? */
export function alertAlreadySent(prev: { last_alert_key?: string | null; last_alert_at?: string | null } | null | undefined, key: string, now = Date.now()): boolean {
  if (!prev?.last_alert_key || prev.last_alert_key !== key || !prev.last_alert_at) return false;
  const t = Date.parse(prev.last_alert_at);
  return Number.isFinite(t) && now - t < ALERT_DEDUPE_MS;
}
