import { describe, expect, it } from "vitest";
import { crisisResult, detectRisk, extractJson, parseModelOutput, redactSecrets, replaceGratis, sanitizeDraft } from "./guardrails";

describe("detectRisk", () => {
  it.each([
    "a veces pienso en suicidarme",
    "Ya no quiero vivir así",
    "tengo ganas de morir",
    "me he vuelto a hacer daño",
    "he pensado en quitarme la vida",
    "creo que lo mejor es acabar con todo",
    "me corto los brazos cuando estoy mal",
    "mi pareja me pega",
    "pensamientos SUICIDAS desde hace semanas",
  ])("detecta riesgo en «%s»", (t) => {
    expect(detectRisk(t).risk).toBe(true);
  });

  it.each([
    "me muero de ganas de empezar",
    "quiero cancelar la cita del jueves",
    "me corto el pelo mañana, ¿podemos mover la sesión?",
    "estoy muerta de risa con el vídeo",
    "¿cuánto cuesta el bono?",
  ])("no salta en «%s»", (t) => {
    expect(detectRisk(t).risk).toBe(false);
  });

  it("clasifica violencia aparte", () => {
    const r = detectRisk("me maltrata y tengo miedo");
    expect(r.kinds).toContain("violencia");
    expect(crisisResult(r.kinds, r.matched).draft_reply).toBe("");
  });

  it("el resultado de crisis no lleva venta y escala a humano", () => {
    const res = crisisResult(["suicidio"], ["suicid"]);
    expect(res.intent).toBe("clinico-urgente");
    expect(res.draft_reply).toBe("");
    expect(res.suggested_actions).toEqual([expect.objectContaining({ type: "escalar_humano" })]);
    expect(res.suggested_actions[0].reason).toMatch(/persona/);
  });
});

describe("gratis", () => {
  it("nunca deja «gratis» ni «gratuito»", () => {
    expect(replaceGratis("Tu primera sesión gratis").text).toBe("Tu cita de bienvenida");
    expect(replaceGratis("Es GRATUITA").text).not.toMatch(/gratu/i);
    expect(replaceGratis("es totalmente gratis").text).toBe("es totalmente de cortesía");
    const s = sanitizeDraft("¡Hola! La consulta gratuita es el martes.");
    expect(s.text).not.toMatch(/gratis|gratu/i);
    expect(s.warnings.join(" ")).toMatch(/cortesía/);
  });
});

describe("sanitizeDraft", () => {
  it("quita promesas de reembolso/descuento y deja el resto", () => {
    const s = sanitizeDraft("Siento mucho lo ocurrido. Te devolvemos el dinero hoy mismo. Lo paso a coordinación.");
    expect(s.text).toBe("Siento mucho lo ocurrido. Lo paso a coordinación.");
    expect(s.warnings.join(" ")).toMatch(/reembolso/);
    expect(sanitizeDraft("Te hago un 20% de descuento.").text).toBe("");
    expect(sanitizeDraft("Te regalamos una sesión.").text).toBe("");
  });

  it("quita consejo clínico o de medicación", () => {
    const s = sanitizeDraft("Gracias por contarlo. Por lo que dices tienes depresión. Deberías tomar un ansiolítico. Tu psicóloga lo verá contigo.");
    expect(s.text).toBe("Gracias por contarlo. Tu psicóloga lo verá contigo.");
    expect(s.warnings.join(" ")).toMatch(/clínico/);
  });

  it("oculta emails y teléfonos que no son del paciente", () => {
    const s = sanitizeDraft("Escribe a laura@gmail.com o al +34 600 111 222. Tu número es +34 611 222 333. hola@mentesanapsicologia.com.", { patientPhone: "+34611222333" });
    expect(s.text).toContain("[email oculto]");
    expect(s.text).toContain("[teléfono oculto]");
    expect(s.text).toContain("+34 611 222 333");
    expect(s.text).toContain("hola@mentesanapsicologia.com");
  });

  it("oculta secretos", () => {
    const r = redactSecrets("clave sk-ant-api03-abcdefghijklmnop y token: abc123 y eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U");
    expect(r.redacted).toBe(true);
    expect(r.text).not.toMatch(/sk-ant|abc123|eyJhbGci/);
    expect(redactSecrets("https://mentesanapsicologia.com/test-diagnostico").redacted).toBe(false);
  });

  it("recorta borradores larguísimos", () => {
    const s = sanitizeDraft("hola ".repeat(400));
    expect(s.text.length).toBeLessThanOrEqual(1001);
  });
});

describe("parseo de la salida del modelo", () => {
  it("acepta JSON envuelto en ```json", () => {
    const raw = "```json\n{\"intent\":\"venta\",\"draft_reply\":\"Hola\",\"suggested_actions\":[{\"type\":\"proponer_cita\",\"params\":{\"provider_amelia_id\":5},\"reason\":\"x\"}],\"confidence\":0.8,\"warnings\":[]}\n```";
    const p = parseModelOutput(raw, "otro");
    expect(p.ok).toBe(true);
    expect(p.value.intent).toBe("venta");
    expect(p.value.suggested_actions[0].params.provider_amelia_id).toBe(5);
  });

  it("descarta acciones desconocidas, intents inventados y clampa confidence", () => {
    const p = parseModelOutput(JSON.stringify({ intent: "reembolsar", draft_reply: "ok", suggested_actions: [{ type: "enviar_dinero" }, { type: "escalar_humano", params: { "a b": 1, a: "coordinacion" } }], confidence: 7 }), "queja");
    expect(p.value.intent).toBe("queja");
    expect(p.value.suggested_actions).toHaveLength(1);
    expect(p.value.suggested_actions[0].params).toEqual({ a: "coordinacion" });
    expect(p.value.confidence).toBe(1);
  });

  it("fallback sin borrador si no es JSON", () => {
    expect(extractJson("lo siento, no puedo")).toBeNull();
    const p = parseModelOutput("lo siento, no puedo", "soporte-app");
    expect(p.ok).toBe(false);
    expect(p.value).toMatchObject({ intent: "soporte-app", draft_reply: "", suggested_actions: [], confidence: 0 });
    expect(parseModelOutput("{roto", "otro").ok).toBe(false);
    expect(parseModelOutput("{\"intent\":\"venta\"}", "otro").ok).toBe(false);
  });
});
