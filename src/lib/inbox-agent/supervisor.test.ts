import { describe, expect, it, vi } from "vitest";
import { classifyByRules, classifyIntent, lastInboundTurn } from "./supervisor";
import { draftFromContext, postProcess } from "./specialist";
import type { ChatTurn, DraftContext, LlmFn } from "./types";

const t = (role: ChatTurn["role"], text: string, at = new Date().toISOString()): ChatTurn => ({ role, text, at });
const ctxOf = (turns: ChatTurn[], over: Partial<DraftContext["amelia"]> = {}): DraftContext => ({
  lead_first_name: "Ana",
  turns,
  amelia: { found: true, excluded: false, upcoming: [], active_packages: [], remaining_sessions_total: 0, attended_sessions: 0, ...over },
  playbook: [],
});

describe("lastInboundTurn", () => {
  it("junta los mensajes del paciente desde la última respuesta nuestra", () => {
    const turns = [t("paciente", "hola"), t("agente", "¡hola!"), t("paciente", "quería saber"), t("paciente", "el precio")];
    expect(lastInboundTurn(turns)).toBe("quería saber\nel precio");
  });
});

describe("reglas del supervisor", () => {
  it.each([
    ["¿Cuánto cuesta la primera sesión?", "venta"],
    ["No voy a poder ir el jueves, ¿podemos cambiar la cita?", "cita-reagenda"],
    ["No me deja entrar en la app", "soporte-app"],
    ["Me habéis cobrado dos veces, quiero el reembolso ya", "queja"],
  ])("«%s» → %s", (text, intent) => {
    expect(classifyByRules(text)?.intent).toBe(intent);
  });

  it("devuelve null cuando no hay señal", () => {
    expect(classifyByRules("vale, gracias")).toBeNull();
  });
});

describe("classifyIntent con LLM mockeado", () => {
  it("riesgo gana a todo y NO llama al LLM", async () => {
    const llm = vi.fn<LlmFn>();
    const d = await classifyIntent([t("paciente", "¿cuánto cuesta? la verdad es que no quiero vivir")], { llm });
    expect(d.intent).toBe("clinico-urgente");
    expect(d.source).toBe("risk");
    expect(llm).not.toHaveBeenCalled();
  });

  it("riesgo en un mensaje anterior del paciente también cuenta", async () => {
    const turns = [t("paciente", "pienso en hacerme daño"), t("agente", "te leemos"), t("paciente", "¿tenéis hueco mañana?")];
    expect((await classifyIntent(turns)).intent).toBe("clinico-urgente");
  });

  it("reglas claras no gastan LLM", async () => {
    const llm = vi.fn<LlmFn>();
    const d = await classifyIntent([t("paciente", "quiero cancelar mi cita")], { llm });
    expect(d).toMatchObject({ intent: "cita-reagenda", source: "rules" });
    expect(llm).not.toHaveBeenCalled();
  });

  it("ambiguo → pregunta al LLM", async () => {
    const llm = vi.fn<LlmFn>().mockResolvedValue('{"intent":"venta","confidence":0.7}');
    const d = await classifyIntent([t("paciente", "buenas, os vi en instagram")], { llm });
    expect(llm).toHaveBeenCalledOnce();
    expect(d).toMatchObject({ intent: "venta", source: "llm", confidence: 0.7 });
  });

  it("LLM con basura o caído → otro", async () => {
    expect((await classifyIntent([t("paciente", "ok")], { llm: async () => "no sé" })).intent).toBe("otro");
    expect((await classifyIntent([t("paciente", "ok")], { llm: async () => { throw new Error("500"); } })).source).toBe("fallback");
    expect((await classifyIntent([t("paciente", "ok")])).intent).toBe("otro");
  });
});

describe("pipeline supervisor → especialista (LLM mockeado)", () => {
  it("riesgo: sin borrador, escala a persona y el especialista no se llama", async () => {
    const llm = vi.fn<LlmFn>();
    const { result } = await draftFromContext(ctxOf([t("paciente", "quiero quitarme la vida")]), { llm });
    expect(result.intent).toBe("clinico-urgente");
    expect(result.draft_reply).toBe("");
    expect(result.suggested_actions[0].type).toBe("escalar_humano");
    expect(llm).not.toHaveBeenCalled();
  });

  it("si el especialista marca clinico-urgente se fuerza el protocolo", async () => {
    const llm: LlmFn = async () => '{"intent":"clinico-urgente","draft_reply":"Compra el bono","suggested_actions":[],"confidence":0.9}';
    const { result } = await draftFromContext(ctxOf([t("paciente", "¿cuánto cuesta?")]), { llm });
    expect(result.intent).toBe("clinico-urgente");
    expect(result.draft_reply).not.toMatch(/bono/);
  });

  it("aplica guardrails al borrador del modelo y fija el provider a uno del contexto", async () => {
    const llm: LlmFn = async () => JSON.stringify({
      intent: "cita-reagenda",
      draft_reply: "¡Claro Ana! Te la muevo sin problema. Además te regalamos una sesión gratis.",
      suggested_actions: [{ type: "proponer_cita", params: { provider_amelia_id: 999 }, reason: "reagendar" }],
      confidence: 0.9,
    });
    const ctx = ctxOf([t("paciente", "¿puedo cambiar la cita del martes?")], {
      upcoming: [{ start: new Date(Date.now() + 86400000).toISOString(), service: "Sesión", provider_first_name: "Marta", provider_amelia_id: 42 }],
    });
    const { result } = await draftFromContext(ctx, { llm });
    expect(result.intent).toBe("cita-reagenda");
    expect(result.draft_reply).toBe("¡Claro Ana! Te la muevo sin problema.");
    expect(result.draft_reply).not.toMatch(/gratis/);
    expect(result.suggested_actions[0]).toMatchObject({ type: "proponer_cita", params: { provider_amelia_id: 42 } });
  });

  it("queja siempre sugiere escalar a humano", async () => {
    const llm: LlmFn = async () => '{"intent":"queja","draft_reply":"Sentimos mucho la experiencia.","suggested_actions":[],"confidence":0.8}';
    const { result } = await draftFromContext(ctxOf([t("paciente", "Es una vergüenza, nadie me responde")]), { llm });
    expect(result.intent).toBe("queja");
    expect(result.suggested_actions.some((a) => a.type === "escalar_humano")).toBe(true);
  });

  it("fuera de la ventana de 24 h sugiere plantilla", () => {
    const old = new Date(Date.now() - 3 * 86400000).toISOString();
    const ctx = ctxOf([t("paciente", "hola, ¿precio?", old)]);
    const r = postProcess({ intent: "venta", draft_reply: "Hola", suggested_actions: [], confidence: 0.8, warnings: [] }, { intent: "venta", confidence: 0.8, source: "rules", matched: [] }, ctx);
    expect(r.suggested_actions[0].type).toBe("enviar_plantilla");
    expect(r.warnings.join(" ")).toMatch(/24 h/);
  });

  it("JSON inválido → sin borrador y con aviso", async () => {
    const { result, meta } = await draftFromContext(ctxOf([t("paciente", "¿cuánto cuesta?")]), { llm: async () => "Claro, aquí va: hola" });
    expect(meta.parsed_ok).toBe(false);
    expect(result.draft_reply).toBe("");
    expect(result.intent).toBe("venta");
  });

  it("paciente excluido: no se llama a la IA", async () => {
    const llm = vi.fn<LlmFn>();
    const { result } = await draftFromContext(ctxOf([t("paciente", "hola")], { excluded: true }), { llm });
    expect(result.draft_reply).toBe("");
    expect(llm).not.toHaveBeenCalled();
  });
});
