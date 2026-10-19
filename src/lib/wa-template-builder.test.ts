import { describe, expect, it } from "vitest";
import { buildComponents, buildMetaPayload, fillExamples, friendlyMetaError, normalizeTemplateName, validateTemplate, variableCount } from "./wa-template-builder";

const base = { name: "renovacion_suave_1", category: "MARKETING" as const, language: "es_ES", body_text: "Hola {{1}}, soy del equipo de Mente Sana. Tu {{2}} está a punto de terminarse y quería saber si seguimos.", body_examples: ["Laura", "Bono Felicidad"] };

describe("normalizeTemplateName", () => {
  it("pasa títulos con acentos y espacios a snake_case", () => {
    expect(normalizeTemplateName("Renovación suave · 1")).toBe("renovacion_suave_1");
    expect(normalizeTemplateName("  Hola!! Mundo ")).toBe("hola_mundo");
  });
});

describe("validateTemplate", () => {
  it("acepta una plantilla correcta", () => {
    const r = validateTemplate(base);
    expect(r.errors).toEqual([]);
  });
  it("exige ejemplos por variable y variables consecutivas", () => {
    expect(validateTemplate({ ...base, body_examples: ["Laura"] }).errors.join(" ")).toMatch(/ejemplo/);
    expect(validateTemplate({ ...base, body_text: "Hola {{1}} y {{3}} texto suficiente para pasar." , body_examples: ["a", "b", "c"] }).errors.join(" ")).toMatch(/consecutivas/);
  });
  it("veta «gratis» y controla encabezado, pie y botones", () => {
    const r = validateTemplate({ ...base, body_text: "Tu primera sesión es gratis {{1}} y la segunda también lo será.", header_text: "Hola {{1}}", footer_text: "Pie con {{1}}", buttons: [{ type: "URL", text: "Un texto de botón demasiado largo para Meta", url: "mentesana" }] });
    const all = r.errors.join(" | ");
    expect(all).toMatch(/gratis/);
    expect(all).toMatch(/ejemplo para la variable del encabezado/);
    expect(all).toMatch(/pie no admite variables/);
    expect(all).toMatch(/25 caracteres/);
    expect(all).toMatch(/https:\/\//);
  });
  it("avisa (sin bloquear) si el cuerpo termina con variable", () => {
    const r = validateTemplate({ ...base, body_text: "Hola, soy del equipo de Mente Sana y te escribo por tu {{1}}", body_examples: ["bono"] });
    expect(r.errors).toEqual([]);
    expect(r.warnings.join(" ")).toMatch(/terminan con una variable/);
  });
});

describe("buildComponents / buildMetaPayload", () => {
  it("monta HEADER con ejemplo, BODY con ejemplos y botones con las respuestas rápidas primero", () => {
    const c = buildComponents({ ...base, header_text: "Hola {{1}} 💜", header_example: "Laura", footer_text: "Responde STOP para no recibir más", buttons: [{ type: "URL", text: "Ver bonos", url: "https://mentesanapsicologia.com/bonos" }, { type: "QUICK_REPLY", text: "Me interesa" }] });
    expect(c[0]).toEqual({ type: "HEADER", format: "TEXT", text: "Hola {{1}} 💜", example: { header_text: ["Laura"] } });
    expect(c[1]).toEqual({ type: "BODY", text: base.body_text, example: { body_text: [["Laura", "Bono Felicidad"]] } });
    expect(c[2]).toEqual({ type: "FOOTER", text: "Responde STOP para no recibir más" });
    expect(c[3].buttons?.map((b) => b.type)).toEqual(["QUICK_REPLY", "URL"]);
    const p = buildMetaPayload(base);
    expect(p.allow_category_change).toBe(true);
    expect(p.components.find((x) => x.type === "BODY")?.example?.body_text).toEqual([["Laura", "Bono Felicidad"]]);
  });
  it("no añade example si el cuerpo no tiene variables", () => {
    const c = buildComponents({ ...base, body_text: "Hola, soy del equipo de Mente Sana. ¿Seguimos con tus sesiones?", body_examples: [] });
    expect(c[0].example).toBeUndefined();
    expect(variableCount("sin variables")).toBe(0);
  });
});

describe("helpers", () => {
  it("rellena la vista previa y traduce errores de Meta", () => {
    expect(fillExamples("Hola {{1}}, tu {{2}}", ["Laura", "bono"])).toBe("Hola Laura, tu bono");
    expect(friendlyMetaError({ code: 190, message: "token expired" })).toMatch(/token/);
    expect(friendlyMetaError({ code: 100, error_subcode: 2388042, message: "x" })).toMatch(/ejemplos/);
  });
});
