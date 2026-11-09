import { describe, expect, it } from "vitest";
import { dailyCap, dropOptedOut, madridMidnightIso, optoutKey, qualityBlock, recipientCount, templateBlock, tomorrowMadrid10Iso } from "./wa-send-guard";

describe("bajas por BSUID", () => {
  it("optoutKey: teléfonos por dígitos, BSUID tal cual en mayúsculas", () => {
    expect(optoutKey("+34 600 111 222")).toBe("34600111222");
    expect(optoutKey(" us.1349 ")).toBe("US.1349");
    expect(optoutKey(null)).toBe("");
  });
  it("quita destinatarios guardados con BSUID y no cruza sus dígitos con un teléfono", () => {
    const out = new Set(["US.1349", "34600111222"]);
    const r = dropOptedOut({ recipients: [{ phone: "US.1349" }, { phone: "1349" }, { phone: "+34600111222" }] }, out);
    expect(r.recipients).toEqual([{ phone: "1349" }]);
    expect(r.removed).toBe(2);
  });
});

describe("templateBlock", () => {
  const h = [
    { template_name: "renov", language: "es", quality: "GREEN", status: "APPROVED" },
    { template_name: "renov", language: "en", quality: "RED", status: "APPROVED" },
    { template_name: "promo", language: "es", quality: "YELLOW", status: "paused" },
  ];
  it("frena PAUSED/DISABLED/FLAGGED y RED", () => {
    expect(templateBlock(h, "promo", "es")).toBe("plantilla PAUSED");
    expect(templateBlock(h, "renov", "en")).toBe("plantilla RED");
    expect(templateBlock([{ template_name: "x", status: "FLAGGED" }], "x")).toBe("plantilla FLAGGED");
  });
  it("con filas del mismo idioma ignora las de otros idiomas", () => {
    expect(templateBlock(h, "renov", "es")).toBeNull();
  });
  it("sin idioma coincidente mira todas; sin datos no frena", () => {
    expect(templateBlock(h, "renov", "pt_BR")).toBe("plantilla RED");
    expect(templateBlock(h, "otra", "es")).toBeNull();
    expect(templateBlock([], "renov")).toBeNull();
    expect(templateBlock([{ template_name: "y", quality: "YELLOW" }], "y")).toBeNull();
  });
});

describe("qualityBlock", () => {
  it("deja salir GREEN y UNKNOWN", () => {
    expect(qualityBlock({ current_quality: "GREEN" })).toBeNull();
    expect(qualityBlock({ current_quality: "UNKNOWN" })).toBeNull();
    expect(qualityBlock(null)).toBeNull();
  });
  it("frena YELLOW, RED y marketing_paused", () => {
    expect(qualityBlock({ current_quality: "YELLOW" })).toBe("quality_yellow");
    expect(qualityBlock({ current_quality: "RED" })).toBe("quality_red");
    expect(qualityBlock({ current_quality: "GREEN", marketing_paused: true })).toBe("marketing_paused");
  });
});

describe("dropOptedOut", () => {
  const out = new Set(["34600111222"]);
  it("quita bajas de recipients comparando solo dígitos y vacía phones", () => {
    const r = dropOptedOut({ recipients: [{ phone: "+34 600 111 222" }, { phone: "34600999888" }], phones: ["34600111222"] }, out);
    expect(r.removed).toBe(1);
    expect(r.recipients).toEqual([{ phone: "34600999888" }]);
    expect(r.phones).toEqual([]);
  });
  it("si todos los recipients son baja no cae a phones", () => {
    const row = { recipients: [{ phone: "34600111222" }], phones: ["34600999888"] };
    const r = dropOptedOut(row, out);
    expect(recipientCount({ recipients: r.recipients, phones: r.phones })).toBe(0);
  });
  it("quita bajas de phones", () => {
    const r = dropOptedOut({ phones: ["34600111222", "34600999888"] }, out);
    expect(r.phones).toEqual(["34600999888"]);
  });
});

describe("tope y fechas", () => {
  it("tope por defecto 200 y respeta daily_cap_normal", () => {
    expect(dailyCap(null)).toBe(200);
    expect(dailyCap({ daily_cap_normal: 80 })).toBe(80);
  });
  it("medianoche y mañana 10:00 en Madrid (CET)", () => {
    const now = new Date("2026-11-05T15:00:00Z");
    expect(madridMidnightIso(now)).toBe("2026-11-04T23:00:00.000Z");
    expect(tomorrowMadrid10Iso(now)).toBe("2026-11-06T09:00:00.000Z");
  });
  it("verano (CEST)", () => {
    expect(madridMidnightIso(new Date("2026-07-10T12:00:00Z"))).toBe("2026-07-09T22:00:00.000Z");
  });
});
