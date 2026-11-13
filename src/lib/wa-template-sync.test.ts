import { describe, expect, it } from "vitest";
import { buildComponents, type WaTemplateInput } from "./wa-template-builder";
import { fingerprint, nextVersionName, planSync, summarize, type RemoteTemplate } from "./wa-template-sync";

const policy = { brand: "Mente Sana", allowedHosts: ["mentesanapsicologia.com"] };
const footer = "Responde BAJA para no recibir más mensajes";
const t = (name: string, body_text: string, extra: Partial<WaTemplateInput> = {}): WaTemplateInput => ({
  name, category: "MARKETING", language: "es_ES", body_text, body_examples: ["Lucía"], footer_text: footer,
  buttons: [{ type: "QUICK_REPLY", text: "Quiero retomar" }, { type: "QUICK_REPLY", text: "Darme de baja" }], ...extra,
});
const asRemote = (x: WaTemplateInput, status = "APPROVED"): RemoteTemplate => ({ name: x.name, language: x.language, category: x.category, status, components: buildComponents(x) });

const retomar = t("retomar_1", "Hola {{1}}, te escribimos del equipo de Mente Sana. Si te apetece volver a tus sesiones, aquí seguimos.");
const renovar = t("renovacion_1", "Hola {{1}}, te escribimos de Mente Sana. Has completado las sesiones de tu bono y podemos preparar el siguiente.");

describe("planSync", () => {
  it("en una cuenta vacía lo crea todo", () => {
    const plan = planSync([retomar, renovar], [], policy);
    expect(plan.map(a => a.kind)).toEqual(["create", "create"]);
    expect(summarize(plan)).toBe("2 create · 0 unchanged · 0 drift · 0 blocked · 0 orphan");
  });

  it("no vuelve a crear lo que ya existe, aunque Meta devuelva los botones en otro orden o con otros espacios", () => {
    const remote = asRemote(retomar, "PENDING");
    remote.components = remote.components.map(c => c.type === "BUTTONS" ? { ...c, buttons: [...c.buttons!].reverse() } : c.type === "BODY" ? { ...c, text: c.text!.replace(". ", ".  ") } : c);
    expect(planSync([retomar], [remote], policy)).toEqual([{ kind: "unchanged", name: "retomar_1", status: "PENDING" }]);
  });

  it("si el texto cambió propone un nombre versionado en vez de editar", () => {
    const edited = { ...retomar, body_text: retomar.body_text + " Escríbenos cuando quieras." };
    const plan = planSync([edited], [asRemote(retomar), asRemote({ ...retomar, name: "retomar_1_v2" })], policy);
    expect(plan[0]).toEqual({ kind: "drift", name: "retomar_1", status: "APPROVED", suggestedName: "retomar_1_v3", changed: ["BODY"] });
  });

  it("un cambio de categoría también es deriva", () => {
    const remote = { ...asRemote(retomar), category: "UTILITY" };
    expect(planSync([retomar], [remote], policy)[0]).toMatchObject({ kind: "drift", changed: ["CATEGORY"] });
  });

  it("no crea lo que el linter rechaza y dice por qué", () => {
    const bad = t("oferta_1", "Hola {{1}}, tu primera sesión es gratis esta semana.");
    const [action] = planSync([bad], [], policy);
    expect(action.kind).toBe("blocked");
    expect(action.kind === "blocked" && action.findings.map(f => f.rule)).toEqual(expect.arrayContaining(["brand-named", "no-free"]));
  });

  it("señala las plantillas creadas a mano que no están en el catálogo", () => {
    const manual: RemoteTemplate = { name: "hello", language: "en", category: "MARKETING", status: "APPROVED", components: [{ type: "BODY", text: "Hello" }] };
    expect(planSync([retomar], [asRemote(retomar), manual], policy)).toContainEqual({ kind: "orphan", name: "hello", status: "APPROVED" });
  });

  it("el mismo nombre en otro idioma es otra plantilla", () => {
    const plan = planSync([retomar], [{ ...asRemote(retomar), language: "es_MX" }], policy);
    expect(plan.map(a => a.kind)).toEqual(["create", "orphan"]);
  });
});

describe("utilidades", () => {
  it("la huella ignora los ejemplos", () => {
    expect(fingerprint(buildComponents(retomar))).toEqual(fingerprint(buildComponents({ ...retomar, body_examples: ["Marta"] })));
  });
  it("versiona sin pisar nombres existentes", () => {
    expect(nextVersionName("aviso", new Set())).toBe("aviso_v2");
    expect(nextVersionName("aviso_v2", new Set(["aviso_v3"]))).toBe("aviso_v4");
  });
});
