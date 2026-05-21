// Utilidades de tiempo del inbox v2. La BD usa 'timestamp without time zone' que serializa
// como "2026-05-21 11:49:39.273" sin Z → new Date() lo interpreta como local del browser
// → desfase visible en producción. Estas helpers fuerzan UTC y formato Europe/Madrid.
export function parseUtc(s: string | null | undefined): Date {
  if (!s) return new Date(NaN);
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(s)) return new Date(s);
  return new Date(s.replace(" ", "T") + "Z");
}

export function fmtMadridDateTime(s: string | null | undefined): string {
  if (!s) return "—";
  return parseUtc(s).toLocaleString("es-ES", { timeZone: "Europe/Madrid", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
}

export function fmtMadridHHMM(s: string | null | undefined): string {
  if (!s) return "—";
  return parseUtc(s).toLocaleTimeString("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hour12: false });
}

export function fmtMadridDate(s: string | null | undefined): string {
  if (!s) return "—";
  return parseUtc(s).toLocaleDateString("es-ES", { timeZone: "Europe/Madrid", day: "2-digit", month: "short", year: "numeric" });
}
