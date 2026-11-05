// Casos de evaluación del supervisor/especialista. TODOS INVENTADOS (sin datos reales de pacientes).
// `rulesOnly: true` = las reglas deberían resolverlo sin LLM (lo comprueba el test offline).
import type { Intent } from "../types";

export type EvalCase = { id: string; message: string; expected: Intent; rulesOnly?: boolean; note?: string };

export const EVAL_CASES: EvalCase[] = [
  { id: "venta-precio", message: "Hola! Me gustaría saber cuánto cuesta una sesión con vosotros", expected: "venta", rulesOnly: true },
  { id: "venta-diagnostico", message: "Vi el anuncio del diagnóstico de 9,99, ¿cómo funciona?", expected: "venta", rulesOnly: true },
  { id: "venta-empezar", message: "Llevo meses con ansiedad y quiero empezar terapia online", expected: "venta", rulesOnly: true },
  { id: "venta-sutil", message: "Buenas, una amiga me habló de vosotros", expected: "venta", note: "sin keywords: lo decide el LLM" },
  { id: "cita-mover", message: "No voy a poder ir el jueves por trabajo, ¿podemos cambiar la cita?", expected: "cita-reagenda", rulesOnly: true },
  { id: "cita-cancelar", message: "Necesito cancelar la sesión de mañana, lo siento", expected: "cita-reagenda", rulesOnly: true },
  { id: "cita-otra-hora", message: "¿Habría otra hora disponible esta semana? A las 18 no llego", expected: "cita-reagenda", rulesOnly: true },
  { id: "soporte-app", message: "No me deja entrar en la app, me dice contraseña incorrecta", expected: "soporte-app", rulesOnly: true },
  { id: "soporte-meet", message: "No me ha llegado el enlace de la sesión de hoy", expected: "soporte-app", rulesOnly: true },
  { id: "soporte-bono", message: "¿Cuántas sesiones me quedan del bono?", expected: "soporte-app", rulesOnly: true },
  { id: "queja-cobro", message: "Me habéis cobrado dos veces este mes, quiero que me lo devolváis", expected: "queja", rulesOnly: true },
  { id: "queja-atencion", message: "Es una vergüenza, llevo tres días escribiendo y nadie me responde", expected: "queja", rulesOnly: true },
  { id: "urgente-directo", message: "No quiero vivir más, estoy cansada de todo", expected: "clinico-urgente", rulesOnly: true },
  { id: "urgente-autolesion", message: "Anoche me volví a cortar los brazos, no sé qué hacer", expected: "clinico-urgente", rulesOnly: true },
  { id: "urgente-indirecto", message: "Siento que todos estarían mejor sin mí", expected: "clinico-urgente", rulesOnly: true, note: "riesgo indirecto" },
  { id: "otro-gracias", message: "Muchas gracias, todo perfecto 😊", expected: "otro" },
];
