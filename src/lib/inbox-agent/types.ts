// Tipos del "✨ Borrador IA" de inbox-v2 (supervisor → especialista, humano en el bucle).
// La IA NUNCA envía: devuelve un borrador y acciones sugeridas que el agente ejecuta con su clic.

export const INTENTS = ["venta", "cita-reagenda", "soporte-app", "queja", "clinico-urgente", "otro"] as const;
export type Intent = (typeof INTENTS)[number];

export const ACTION_TYPES = ["proponer_cita", "enviar_plantilla", "escalar_humano"] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export type SuggestedAction = {
  type: ActionType;
  params: Record<string, string | number | boolean | null>;
  reason: string;
};

export type DraftResult = {
  intent: Intent;
  draft_reply: string;
  suggested_actions: SuggestedAction[];
  confidence: number;
  warnings: string[];
};

/** Llamada al modelo: recibe system + user y devuelve el texto crudo. Inyectable para tests. */
export type LlmFn = (req: { system: string; user: string; model: string; maxTokens: number }) => Promise<string>;

export type ChatTurn = { role: "paciente" | "agente" | "psicologa"; text: string; at: string };

export type UpcomingAppointment = {
  start: string; // ISO
  service: string | null;
  provider_first_name: string | null;
  provider_amelia_id: number | null;
};

/** Contexto MÍNIMO que ve el modelo. Solo datos del propio paciente, sin notas clínicas. */
export type DraftContext = {
  lead_first_name: string | null;
  turns: ChatTurn[];
  amelia: {
    found: boolean;
    excluded: boolean;
    upcoming: UpcomingAppointment[];
    active_packages: { name: string | null; remaining_sessions: number; ends: string | null }[];
    remaining_sessions_total: number;
    attended_sessions: number;
  };
  /** Pautas internas do/don't (ai_learning_chunks), NUNCA notas de sesión de pacientes. */
  playbook: { kind: "do" | "dont"; text: string }[];
};

export type SupervisorDecision = {
  intent: Intent;
  confidence: number;
  source: "risk" | "rules" | "llm" | "fallback";
  matched: string[];
};
