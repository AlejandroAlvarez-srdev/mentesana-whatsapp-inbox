// Freno de los envíos masivos de plantillas (whatsapp_scheduled_templates_v2, scope bulk).
// Tras el ban de las WABA el 5-nov-2026: el monitor de calidad (cron wa-quality-monitor) solo
// bajaba el tope del monolito, y los lotes del programador v2 seguían saliendo con el número en
// YELLOW/RED. Aquí se aplican, antes de llamar a Meta:
//   · calidad: solo se envía en GREEN (o UNKNOWN, número sin valoración aún) y sin marketing_paused;
//   · tope diario por número (destinatarios de lotes enviados desde la medianoche de Madrid);
//   · bajas: se quitan los teléfonos de app_outreach_optout.
// Los envíos 'single' (una plantilla a una conversación) no pasan por aquí.

export type QualityState = {
  current_quality?: string | null;
  marketing_paused?: boolean | null;
  daily_cap_normal?: number | null;
};

export const DEFAULT_DAILY_CAP = 200;

export const digits = (p: unknown) => String(p ?? "").replace(/\D/g, "");

/** Motivo para no enviar un lote desde este número, o null si puede salir. */
export function qualityBlock(state: QualityState | null | undefined): string | null {
  if (!state) return null;
  if (state.marketing_paused) return "marketing_paused";
  const q = String(state.current_quality ?? "UNKNOWN").toUpperCase();
  if (q === "GREEN" || q === "UNKNOWN") return null;
  return `quality_${q.toLowerCase()}`;
}

export function dailyCap(state: QualityState | null | undefined): number {
  const n = Number(state?.daily_cap_normal);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DAILY_CAP;
}

type Recipient = { phone?: unknown } & Record<string, unknown>;

/** Nº de destinatarios de una fila bulk (recipients tiene prioridad sobre phones, como en el envío). */
export function recipientCount(row: { recipients?: unknown; phones?: unknown }): number {
  if (Array.isArray(row.recipients) && row.recipients.length > 0) return row.recipients.length;
  if (Array.isArray(row.phones)) return row.phones.length;
  return 0;
}

/** Quita de recipients/phones los teléfonos dados de baja. Devuelve la lista filtrada y cuántos se quitaron. */
export function dropOptedOut<T extends { recipients?: unknown; phones?: unknown }>(
  row: T,
  optedOut: ReadonlySet<string>,
): { recipients: Recipient[] | null; phones: string[] | null; removed: number } {
  // Con recipients se vacía phones: si los recipients quedan en 0 no debe caer al envío por phones.
  const out = (p: unknown) => {
    const d = digits(p);
    return d !== "" && optedOut.has(d);
  };
  if (Array.isArray(row.recipients) && row.recipients.length > 0) {
    const kept = (row.recipients as Recipient[]).filter((r) => !out(r?.phone));
    return { recipients: kept, phones: [], removed: row.recipients.length - kept.length };
  }
  if (Array.isArray(row.phones)) {
    const kept = (row.phones as unknown[]).map(String).filter((p) => !out(p));
    return { recipients: null, phones: kept, removed: row.phones.length - kept.length };
  }
  return { recipients: null, phones: null, removed: 0 };
}

/** Medianoche de hoy en Madrid, en ISO UTC. */
export function madridMidnightIso(now = new Date()): string {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(now);
  // offset de Madrid en ese instante (CET +1 / CEST +2)
  const hm = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", hour12: false }).format(now);
  const offsetH = (Number(hm) - now.getUTCHours() + 24) % 24;
  return new Date(`${day}T00:00:00+0${offsetH}:00`).toISOString();
}

/** Mañana a las 10:00 de Madrid, en ISO UTC (para aplazar lo que excede el tope). */
export function tomorrowMadrid10Iso(now = new Date()): string {
  const midnight = new Date(madridMidnightIso(now));
  return new Date(midnight.getTime() + 34 * 3600 * 1000).toISOString();
}
