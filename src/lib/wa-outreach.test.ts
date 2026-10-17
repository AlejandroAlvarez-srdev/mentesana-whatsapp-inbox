import { describe, expect, it } from "vitest";
import { buildComponents, pickTemplate, type MetaTemplateMeta, type WaTemplateMap } from "./wa-outreach";

const meta = (name: string, over: Partial<MetaTemplateMeta> = {}): MetaTemplateMeta => ({ name, language: "es", status: "APPROVED", category: "MARKETING", quality: "UNKNOWN", headerParam: true, bodyParams: 0, bodyText: `Cuerpo de ${name}`, ...over });
const row = (template_name: string, over: Partial<WaTemplateMap> = {}): WaTemplateMap => ({ id: Math.floor(Math.random() * 1e6), rule: "renovacion", step: null, restantes: null, waba_id: "W1", template_name, language: "es", active: true, ...over });
const approved = (...ms: MetaTemplateMeta[]) => new Map(ms.map((m) => [`${m.name}|${m.language}`, m]));

describe("pickTemplate · rotación de versiones", () => {
  it("elige la versión menos usada en 7 días", () => {
    const rows = [row("renovacion_a"), row("renovacion_b"), row("renovacion_c")];
    const usage = new Map([["W1|renovacion_a", 10], ["W1|renovacion_b", 2], ["W1|renovacion_c", 7]]);
    const pick = pickTemplate({ rows, approved: approved(meta("renovacion_a"), meta("renovacion_b"), meta("renovacion_c")), usage, rule: "renovacion", step: null, restantes: null });
    expect(pick?.row.template_name).toBe("renovacion_b");
  });
  it("ignora las no aprobadas, las inactivas, las RED y las de más de un parámetro de cuerpo", () => {
    const rows = [row("x_pausada"), row("x_inactiva", { active: false }), row("x_red"), row("x_dos_params"), row("x_ok")];
    const ap = approved(meta("x_pausada", { status: "PAUSED" }), meta("x_inactiva"), meta("x_red", { quality: "RED" }), meta("x_dos_params", { bodyParams: 2 }), meta("x_ok"));
    const pick = pickTemplate({ rows, approved: ap, usage: new Map(), rule: "renovacion", step: null, restantes: null });
    expect(pick?.row.template_name).toBe("x_ok");
  });
  it("prefiere las versiones específicas de las sesiones restantes y respeta el paso del remark", () => {
    const rows = [row("gen_1"), row("cero_1", { restantes: 0 }), row("una_1", { restantes: 1 })];
    const ap = approved(meta("gen_1"), meta("cero_1"), meta("una_1"));
    expect(pickTemplate({ rows, approved: ap, usage: new Map(), rule: "renovacion", step: null, restantes: 0 })?.row.template_name).toBe("cero_1");
    expect(pickTemplate({ rows, approved: ap, usage: new Map(), rule: "renovacion", step: null, restantes: 2 })?.row.template_name).toBe("gen_1");
    const remarks = [row("remark_1", { rule: "remark", step: 1 }), row("remark_2", { rule: "remark", step: 2 })];
    expect(pickTemplate({ rows: remarks, approved: approved(meta("remark_1"), meta("remark_2")), usage: new Map(), rule: "remark", step: 2, restantes: null })?.row.template_name).toBe("remark_2");
    expect(pickTemplate({ rows: remarks, approved: approved(meta("remark_1"), meta("remark_2")), usage: new Map(), rule: "remark", step: 3, restantes: null })).toBeNull();
  });
});

describe("buildComponents", () => {
  it("rellena cabecera y cuerpo con el nombre de pila (o 'Hola' si no lo sabemos)", () => {
    expect(buildComponents(meta("t", { headerParam: true, bodyParams: 0 }), "María")).toEqual([{ type: "header", parameters: [{ type: "text", text: "María" }] }]);
    expect(buildComponents(meta("t", { headerParam: false, bodyParams: 1 }), null)).toEqual([{ type: "body", parameters: [{ type: "text", text: "Hola" }] }]);
    expect(buildComponents(meta("t", { headerParam: false, bodyParams: 0 }), "Ana")).toEqual([]);
  });
});
