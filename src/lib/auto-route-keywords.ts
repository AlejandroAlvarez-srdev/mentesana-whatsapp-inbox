// Keywords inequívocas del auto-router (ventas vs soporte). Viven aparte de auto-route.ts
// para poder reutilizarlas sin arrastrar el cliente de Supabase ni Amelia (p. ej. el
// supervisor del borrador IA de inbox-v2 y sus tests).
export const SOPORTE_KW = [
  "cancelar", "reagendar", "reagendo", "cambiar mi cita", "mover cita",
  "factura", "factur", "recibo",
  "bono", "paquete", "sesion", "sesión", "sessio",
  "psicóloga", "psicologa", "psicologo", "psicólogo", "mi psi",
  "meet", "enlace", "link de la cita", "link cita",
  "no me llegó", "no me llego", "no recibí", "no recibi",
  "cobro", "cargo", "devolución", "devolucion", "reembolso",
];
export const VENTAS_KW = [
  "precio", "cuánto cuesta", "cuanto cuesta", "tarifa",
  "info", "informacion", "información",
  "primera sesión", "primera sesion", "empezar", "comenzar",
  "diagnostic", "test", "valoración", "valoracion",
  "9.99", "9,99", "9 99",
  "hola, me interesa", "quería preguntar", "quiero saber",
];

export function countMatches(text: string, kws: string[]): string[] {
  const t = text.toLowerCase();
  return kws.filter((k) => t.includes(k));
}
