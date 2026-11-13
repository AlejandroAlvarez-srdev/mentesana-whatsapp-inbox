import { describe, expect, it } from "vitest";
import type { WaTemplateInput } from "./wa-template-builder";
import { findNearDuplicates, hasErrors, lintTemplate, similarity } from "./wa-template-policy";

const policy = { brand: "Mente Sana", allowedHosts: ["mentesanapsicologia.com", "buy.stripe.com"] };
const rules = (t: WaTemplateInput) => lintTemplate(t, policy).map(f => f.rule);

const marketing: WaTemplateInput = {
  name: "retomar_1", category: "MARKETING", language: "es_ES",
  body_text: "Hola {{1}}, te escribimos del equipo de Mente Sana. Si te apetece volver a tus sesiones, aquí seguimos para organizarlo contigo.",
  body_examples: ["Lucía"],
  footer_text: "Responde BAJA para no recibir más mensajes",
  buttons: [{ type: "QUICK_REPLY", text: "Quiero retomar" }, { type: "QUICK_REPLY", text: "Darme de baja" }],
};
const utility: WaTemplateInput = {
  name: "recordatorio_30_minutos", category: "UTILITY", language: "es_ES",
  body_text: "Te escribimos de Mente Sana para recordarte que faltan 30 minutos para tu sesión.",
  footer_text: "Si no quieres recibir mensajes, responde BAJA",
  buttons: [{ type: "QUICK_REPLY", text: "Envíame el link" }],
};

describe("lintTemplate", () => {
  it("deja pasar una plantilla de marketing y una de utilidad bien hechas", () => {
    expect(lintTemplate(marketing, policy)).toEqual([]);
    expect(lintTemplate(utility, policy)).toEqual([]);
  });

  it("exige identificar al remitente y dar la baja en marketing", () => {
    const r = rules({ ...marketing, body_text: "Hola {{1}}, tienes una novedad esperándote en tu cuenta.", footer_text: "Equipo de atención", buttons: [{ type: "QUICK_REPLY", text: "No me interesa" }] });
    expect(r).toEqual(expect.arrayContaining(["brand-named", "opt-out-footer", "opt-out-button"]));
  });

  it("a una de utilidad le pide el pie de baja pero no el botón ni la marca", () => {
    expect(rules({ ...utility, body_text: "Tu cita de mañana a las 10:00 está confirmada.", footer_text: undefined })).toEqual(["opt-out-footer"]);
  });

  it("no acepta promoción dentro de una plantilla de utilidad", () => {
    expect(rules({ ...utility, body_text: "Mente Sana: tu sesión es mañana. Aprovecha el 20 % de descuento en tu próximo bono." })).toContain("utility-with-promo");
  });

  it("detecta que el texto le atribuye una condición de salud al destinatario", () => {
    for (const body_text of [
      "Hola {{1}}, en Mente Sana queremos saber si sigues con ansiedad estas semanas.",
      "Hola {{1}}, desde Mente Sana te ayudamos a superar tu depresión paso a paso.",
      "Hola {{1}}, en Mente Sana sabemos que tienes mucho estrés últimamente.",
    ]) expect(rules({ ...marketing, body_text })).toContain("health-assumption");
  });

  it("nombrar el servicio no es suponer nada del destinatario", () => {
    for (const body_text of [
      "Hola {{1}}, en Mente Sana puedes empezar con un diagnóstico inicial con una psicóloga colegiada. Precio final: 9,99 €.",
      "Hola {{1}}, en Mente Sana también tenemos terapia de pareja online y talleres sobre ansiedad en grupo.",
    ]) expect(rules({ ...marketing, body_text })).not.toContain("health-assumption");
  });

  it("veta promesas de resultado y la palabra «gratis»", () => {
    expect(rules({ ...marketing, body_text: "Hola {{1}}, esta cita con Mente Sana puede cambiar por completo tu vida. ¡Te esperamos!" })).toContain("result-guarantee");
    expect(rules({ ...marketing, body_text: "Hola {{1}}, en Mente Sana tu primera sesión es gratis esta semana." })).toContain("no-free");
  });

  it("avisa, sin bloquear, del lenguaje de urgencia y de los gritos", () => {
    const f = lintTemplate({ ...marketing, body_text: "Hola {{1}}, ÚLTIMA oportunidad en Mente Sana: tu bono vence MAÑANA y no queremos que lo pierdas." }, policy);
    expect(f.map(x => x.rule)).toEqual(expect.arrayContaining(["pressure", "shouting"]));
    expect(hasErrors(f)).toBe(false);
  });

  it("revisa la forma: variables en los extremos, emojis y destino de los enlaces", () => {
    expect(rules({ ...marketing, body_text: "{{1}}, te escribimos de Mente Sana para saludarte." })).toContain("variable-at-edge");
    expect(rules({ ...marketing, body_text: "Te escribimos de Mente Sana, {{1}}" })).toContain("variable-at-edge");
    expect(rules({ ...marketing, header_text: "Vuelve 💜" })).toContain("emoji-in-header");
    const withLinks = (url: string) => rules({ ...marketing, buttons: [{ type: "URL", text: "Reservar", url }, { type: "QUICK_REPLY", text: "Darme de baja" }] });
    expect(withLinks("https://bit.ly/abc")).toContain("foreign-url");
    expect(withLinks("https://www.mentesanapsicologia.com/test-diagnostico?utm_source=whatsapp")).not.toContain("foreign-url");
    expect(withLinks("https://buy.stripe.com/{{1}}")).not.toContain("foreign-url");
    expect(withLinks("https://mentesanapsicologia.com.evil.example/pago")).toContain("foreign-url");
  });
});

describe("variaciones que de verdad sean distintas", () => {
  const a = "Hola {{1}}, te escribimos del equipo de Mente Sana. Si te apetece volver a tus sesiones, aquí seguimos para organizarlo contigo.";
  it("un cambio de saludo sigue siendo la misma plantilla", () => {
    const b = "¡Buenas, {{1}}! Te escribimos del equipo de Mente Sana. Si te apetece volver a tus sesiones, aquí seguimos para organizarlo contigo. 💜";
    expect(similarity(a, b)).toBeGreaterThan(0.8);
    expect(findNearDuplicates([{ name: "retomar_1", body_text: a }, { name: "retomar_2", body_text: b }])).toEqual([{ a: "retomar_1", b: "retomar_2", similarity: expect.any(Number) }]);
  });
  it("otra redacción del mismo mensaje no se marca", () => {
    const c = "Hola {{1}}, ¿qué tal todo? Somos Mente Sana. Cuando quieras reservar otra cita, respóndenos y te buscamos un hueco que encaje con tu horario.";
    expect(similarity(a, c)).toBeLessThan(0.2);
    expect(findNearDuplicates([{ name: "retomar_1", body_text: a }, { name: "retomar_4", body_text: c }])).toEqual([]);
  });
});
