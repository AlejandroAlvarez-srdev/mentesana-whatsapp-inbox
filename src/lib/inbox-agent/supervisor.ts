// Supervisor del borrador IA: decide la intención del ÚLTIMO turno del paciente.
//
// Orden (de más a menos determinista):
//   1. Riesgo (guardrails.detectRisk) → clinico-urgente. Nada lo puede rebajar.
//   2. Reglas por keywords (reutiliza las de auto-route para venta/soporte y añade
//      queja / cita-reagenda / soporte-app). Ganador claro → sin LLM.
//   3. Ambiguo (empate o sin keywords) → LLM barato (Haiku, igual que auto-route) si hay;
//      si no, "otro".
// Puro salvo la llamada al LLM, que es inyectable (tests con mock).
import { SOPORTE_KW, VENTAS_KW } from "@/lib/auto-route-keywords";
import { detectRisk, extractJson, normalize } from "./guardrails";
import { INTENTS, type ChatTurn, type Intent, type LlmFn, type SupervisorDecision } from "./types";

export const SUPERVISOR_MODEL = process.env.INBOX_AI_SUPERVISOR_MODEL || "claude-haiku-4-5-20251001";

type RuleIntent = Exclude<Intent, "clinico-urgente" | "otro">;

const kw = (words: string[]) => words.map((w) => normalize(w));

const RULES: Record<RuleIntent, RegExp[]> = {
  queja: [
    /\bqueja/, /reclamacion/, /\breclamar\b/, /\bdenunci/, /\bconsumo\b/, /\bestafa/, /\btimo\b/, /verguenza/,
    /indignad/, /\bpesim[oa]/, /fatal (servicio|atencion|experiencia)/, /muy mal (servicio|atendid)/, /\bhart[oa]\b/,
    /nadie me (responde|contesta|escribe)/, /no me (contestais|respondeis|habeis contestado)/,
    /(quiero|exijo) (mi dinero|que me devolvais|la devolucion|el reembolso)/, /\breembols/, /\bdevolucion\b/, /devolverme el dinero/,
    /cobrado (dos veces|de mas|sin)/, /(me habeis|me han) cobrado/, /cargo (indebido|que no reconozco)/,
  ],
  "cita-reagenda": [
    /\bcancelar\b/, /\banular\b/, /reagend/, /reprogram/, /\baplazar\b/, /\bposponer\b/,
    /cambiar (la|mi|de) (cita|sesion|hora|dia)/, /mover (la|mi) (cita|sesion)/,
    /no (puedo|podre|voy a poder) (ir|asistir|conectarme|acudir|a la sesion|a la cita)/,
    /(otra|otro) (hora|dia|horario)/, /\bllego tarde\b/, /\bretrasar\b/, /\bcambio de (hora|cita|dia)\b/,
  ],
  "soporte-app": [
    /\bapp\b/, /\baplicacion\b/, /contrasena/, /iniciar sesion/, /\blogin\b/, /no me deja (entrar|acceder|iniciar)/,
    /no (puedo|consigo) (entrar|acceder)/, /\bdescarg/, /play store|app store/, /\bmeet\b/, /videollamada/,
    /no me (llega|llego|ha llegado) (el |la )?(enlace|link|email|correo|codigo|factura)/, /\b(enlace|link) de la (cita|sesion)\b/,
    /\bfactura/, /\brecibo\b/, /cuantas sesiones me quedan/, /sesiones (me quedan|restantes|pendientes)/,
    /cambiar de psicolog/, /\bmi psicolog/,
  ],
  venta: [
    /\bprecios?\b/, /cuanto (cuesta|vale|sale|es)/, /\btarifa/, /\binfo(rmacion)?\b/, /primera (sesion|cita|consulta)/,
    /\b(empezar|comenzar)\b/, /\bdiagnostic/, /\bvaloracion\b/, /9[.,\s]99/, /\bme interesa/, /como funciona/,
    /quiero (saber|empezar|pedir cita|terapia|reservar)/, /queria preguntar/, /\b(comprar|contratar)\b/, /cita de bienvenida/,
  ],
};

// Reutiliza las keywords de auto-route como señal extra (no sustituyen a las reglas).
const AUTO_SOPORTE = kw(SOPORTE_KW);
const AUTO_VENTAS = kw(VENTAS_KW);

const PRIORITY: RuleIntent[] = ["queja", "cita-reagenda", "soporte-app", "venta"];

/** Último turno del paciente = mensajes del paciente desde la última respuesta nuestra. */
export function lastInboundTurn(turns: ChatTurn[]): string {
  const out: string[] = [];
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if (t.role !== "paciente") { if (out.length) break; continue; }
    out.unshift(t.text);
  }
  return out.join("\n").trim();
}

export function scoreRules(text: string): { scores: Record<RuleIntent, number>; matched: string[] } {
  const n = normalize(text);
  const scores: Record<RuleIntent, number> = { queja: 0, "cita-reagenda": 0, "soporte-app": 0, venta: 0 };
  const matched: string[] = [];
  for (const intent of PRIORITY) {
    for (const re of RULES[intent]) {
      const m = n.match(re);
      if (m) { scores[intent]++; matched.push(`${intent}:${m[0]}`); }
    }
  }
  // Señal débil de auto-route: solo desempata si las reglas no dicen nada.
  if (PRIORITY.every((i) => scores[i] === 0)) {
    const s = AUTO_SOPORTE.filter((k) => n.includes(k));
    const v = AUTO_VENTAS.filter((k) => n.includes(k));
    if (v.length > s.length) { scores.venta += 0.5; matched.push(...v.map((k) => `auto-route:ventas:${k}`)); }
    else if (s.length > v.length) { scores["soporte-app"] += 0.5; matched.push(...s.map((k) => `auto-route:soporte:${k}`)); }
  }
  return { scores, matched };
}

/** Solo reglas (sin LLM). null = ambiguo. */
export function classifyByRules(text: string): SupervisorDecision | null {
  const { scores, matched } = scoreRules(text);
  const max = Math.max(...PRIORITY.map((i) => scores[i]));
  if (max <= 0) return null;
  const top = PRIORITY.filter((i) => scores[i] === max);
  if (top.length > 1) {
    // Empate: la queja manda siempre (mejor que la vea un humano con cuidado).
    if (top.includes("queja")) return { intent: "queja", confidence: 0.6, source: "rules", matched };
    return null;
  }
  return { intent: top[0], confidence: Math.min(0.95, 0.6 + 0.1 * max), source: "rules", matched };
}

const SUPERVISOR_SYSTEM = `Eres el supervisor de la bandeja de WhatsApp de Mente Sana Psicología (psicología online, España).
Clasificas el ÚLTIMO mensaje del paciente en UNA intención:
- venta: lead que pregunta precios, cómo empezar, primera sesión, diagnóstico 9,99 €, cita de bienvenida, bonos para comprar.
- cita-reagenda: cancelar, mover, reagendar o confirmar hora de una cita ya reservada.
- soporte-app: problemas con la app, el enlace de Meet, facturas, sesiones que le quedan del bono, cambio de psicóloga.
- queja: enfado, reclamación, petición de devolución o reembolso, cobro no reconocido.
- clinico-urgente: cualquier indicio de riesgo para su vida o la de otros, autolesión o violencia, aunque sea indirecto.
- otro: saludo suelto, agradecimiento, mensaje sin intención clara.
Devuelve SOLO JSON: {"intent": "...", "confidence": 0.0-1.0}`;

export async function classifyIntent(
  turns: ChatTurn[],
  opts: { llm?: LlmFn | null } = {},
): Promise<SupervisorDecision> {
  const last = lastInboundTurn(turns);
  const recentInbound = turns.filter((t) => t.role === "paciente").slice(-3).map((t) => t.text);

  // 1) Riesgo: en el último turno y en los 3 últimos mensajes del paciente.
  const risk = detectRisk(last, ...recentInbound);
  if (risk.risk) return { intent: "clinico-urgente", confidence: 1, source: "risk", matched: risk.matched };

  if (!last) return { intent: "otro", confidence: 0.3, source: "fallback", matched: [] };

  // 2) Reglas
  const byRules = classifyByRules(last);
  if (byRules) return byRules;

  // 3) LLM
  if (opts.llm) {
    try {
      const raw = await opts.llm({
        system: SUPERVISOR_SYSTEM,
        user: `Último mensaje del paciente:\n"""\n${last.slice(0, 1500)}\n"""`,
        model: SUPERVISOR_MODEL,
        maxTokens: 80,
      });
      const j = extractJson(raw) as { intent?: unknown; confidence?: unknown } | null;
      if (j && typeof j.intent === "string" && (INTENTS as readonly string[]).includes(j.intent)) {
        const c = Number(j.confidence);
        return { intent: j.intent as Intent, confidence: Number.isFinite(c) ? Math.max(0, Math.min(1, c)) : 0.5, source: "llm", matched: [] };
      }
    } catch { /* cae al fallback */ }
  }
  return { intent: "otro", confidence: 0.3, source: "fallback", matched: [] };
}
