import { describe, expect, it } from "vitest";
import { alertAlreadySent, optoutRow, parsePreferences, parseTemplateEvent, templateAlertKey } from "./wa-meta-events";

const pref = (items: unknown[]) => ({ messaging_product: "whatsapp", metadata: { phone_number_id: "1" }, user_preferences: items });

describe("parsePreferences", () => {
  it("stop con teléfono y BSUID guarda ambas claves", () => {
    const ops = parsePreferences(pref([{ wa_id: "+1 650 555 1234", user_id: "US.1349", category: "marketing_messages", value: "stop", timestamp: 1731705721 }]));
    expect(ops).toHaveLength(1);
    expect(ops[0].action).toBe("stop");
    expect(ops[0].keys).toEqual(["US.1349", "16505551234"]);
    expect(ops[0].timestamp).toBe(1731705721);
  });
  it("solo BSUID o solo teléfono", () => {
    expect(parsePreferences(pref([{ user_id: "co.ent.99", value: "resume", category: "marketing_messages" }]))[0].keys).toEqual(["CO.ENT.99"]);
    expect(parsePreferences(pref([{ wa_id: "34600111222", value: "STOP" }]))[0].keys).toEqual(["34600111222"]);
  });
  it("ignora otras categorías, valores raros y items sin id", () => {
    expect(parsePreferences(pref([
      { wa_id: "1", value: "stop", category: "other" },
      { wa_id: "1", value: "maybe", category: "marketing_messages" },
      { value: "stop", category: "marketing_messages" },
    ]))).toEqual([]);
    expect(parsePreferences(null)).toEqual([]);
  });
  it("fila de baja con convención wa:", () => {
    expect(optoutRow("34600111222")).toMatchObject({ email: "wa:34600111222", phone: "34600111222", source: "wa_pref", created_by: "meta-webhook" });
    expect(optoutRow("US.1349").email).toBe("wa:US.1349");
  });
});

describe("plantillas", () => {
  const base = { message_template_id: 123, message_template_name: "renov_1", message_template_language: "es" };
  it("quality update", () => {
    const e = parseTemplateEvent("message_template_quality_update", { ...base, previous_quality_score: "GREEN", new_quality_score: "YELLOW" });
    expect(e).toMatchObject({ template_name: "renov_1", language: "es", template_id: "123", patch: { quality: "YELLOW" } });
    expect(templateAlertKey("message_template_quality_update", { new_quality_score: "yellow" })).toBe("quality:YELLOW");
    expect(templateAlertKey("message_template_quality_update", { new_quality_score: "GREEN" })).toBeNull();
  });
  it("status update (sin distinguir mayúsculas) con motivo", () => {
    const v = { ...base, event: "paused", reason: "NONE", message_template_category: "MARKETING", other_info: { title: "FIRST_PAUSE", description: "baja calidad" } };
    const e = parseTemplateEvent("message_template_status_update", v)!;
    expect(e.patch.status).toBe("PAUSED");
    expect(e.patch.category).toBe("MARKETING");
    expect(e.patch.last_reason).toBe("FIRST_PAUSE · baja calidad");
    expect(templateAlertKey("message_template_status_update", v)).toBe("status:PAUSED");
    expect(templateAlertKey("message_template_status_update", { event: "APPROVED" })).toBeNull();
    expect(templateAlertKey("message_template_status_update", { event: "Rejected" })).toBe("status:REJECTED");
  });
  it("category update: aviso solo si hay recategorización inminente", () => {
    expect(templateAlertKey("template_category_update", { ...base, new_category: "UTILITY" })).toBeNull();
    const v = { ...base, new_category: "UTILITY", correct_category: "MARKETING" };
    expect(templateAlertKey("template_category_update", v)).toBe("category:MARKETING");
    expect(parseTemplateEvent("template_category_update", v)!.patch.category).toBe("UTILITY");
  });
  it("sin nombre → null", () => {
    expect(parseTemplateEvent("message_template_status_update", { event: "PAUSED" })).toBeNull();
  });
  it("dedupe 24 h", () => {
    const now = Date.parse("2026-11-06T12:00:00Z");
    expect(alertAlreadySent({ last_alert_key: "quality:RED", last_alert_at: "2026-11-06T00:00:00Z" }, "quality:RED", now)).toBe(true);
    expect(alertAlreadySent({ last_alert_key: "quality:RED", last_alert_at: "2026-11-05T11:00:00Z" }, "quality:RED", now)).toBe(false);
    expect(alertAlreadySent({ last_alert_key: "quality:YELLOW", last_alert_at: "2026-11-06T11:00:00Z" }, "quality:RED", now)).toBe(false);
    expect(alertAlreadySent(null, "quality:RED", now)).toBe(false);
  });
});
