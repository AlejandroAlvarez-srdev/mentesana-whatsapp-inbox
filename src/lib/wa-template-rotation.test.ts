import { describe, expect, it } from "vitest";
import { familyOf, groupFamilies, pickVariant, type SentRecord, type Variant } from "./wa-template-rotation";

const now = new Date("2026-11-12T10:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
const family = (prefix: string, n: number, category: Variant["category"] = "MARKETING"): Variant[] =>
  Array.from({ length: n }, (_, i) => ({ name: `${prefix}_${i + 1}`, category, status: "APPROVED", quality: "GREEN" }));
const sent = (template: string, days: number, category: SentRecord["category"] = "MARKETING"): SentRecord => ({ template, category, at: daysAgo(days) });
const base = { contact: "c-1001", variants: family("renovacion", 5), history: [] as SentRecord[], optedOut: false, now };

describe("pickVariant", () => {
  it("no propone nada a quien se dio de baja", () => {
    expect(pickVariant({ ...base, optedOut: true })).toEqual({ ok: false, skip: "opted-out" });
  });

  it("respeta el descanso entre dos mensajes de marketing y dice cuándo se puede", () => {
    const r = pickVariant({ ...base, history: [sent("descuento_2", 3)] });
    expect(r).toEqual({ ok: false, skip: "cooldown", retryAt: daysAgo(3 - 14) });
    expect(pickVariant({ ...base, history: [sent("descuento_2", 15)] }).ok).toBe(true);
  });

  it("el descanso no frena un recordatorio de cita", () => {
    const r = pickVariant({ ...base, variants: family("recordatorio_30_minutos", 3, "UTILITY"), history: [sent("descuento_2", 1)] });
    expect(r.ok).toBe(true);
  });

  it("propone primero una variación que el contacto no haya visto", () => {
    const history = [sent("renovacion_1", 90), sent("renovacion_3", 60), sent("renovacion_4", 30)];
    const r = pickVariant({ ...base, history });
    expect(r).toMatchObject({ ok: true, reason: "unseen" });
    expect(["renovacion_2", "renovacion_5"]).toContain(r.ok && r.variant);
  });

  it("cuando las ha visto todas, la que hace más tiempo que no recibe (nunca la última)", () => {
    const history = [sent("renovacion_1", 40), sent("renovacion_2", 120), sent("renovacion_3", 80), sent("renovacion_4", 60), sent("renovacion_5", 20), sent("renovacion_2", 200)];
    expect(pickVariant({ ...base, history })).toEqual({ ok: true, variant: "renovacion_2", reason: "least-recent" });
  });

  it("deja fuera las variaciones sin aprobar, pausadas o con mala calidad", () => {
    const variants: Variant[] = [
      { name: "renovacion_1", category: "MARKETING", status: "PENDING" },
      { name: "renovacion_2", category: "MARKETING", status: "APPROVED", quality: "RED" },
      { name: "renovacion_3", category: "MARKETING", status: "PAUSED", quality: "GREEN" },
      { name: "renovacion_4", category: "MARKETING", status: "APPROVED", quality: "UNKNOWN" },
    ];
    expect(pickVariant({ ...base, variants })).toEqual({ ok: true, variant: "renovacion_4", reason: "unseen" });
    expect(pickVariant({ ...base, variants: variants.slice(0, 3) })).toEqual({ ok: false, skip: "no-healthy-variant" });
  });

  it("es determinista y reparte parejo entre las cinco", () => {
    expect(pickVariant(base)).toEqual(pickVariant({ ...base, variants: [...base.variants].reverse() }));
    const counts = new Map<string, number>();
    for (let i = 0; i < 5000; i++) {
      const r = pickVariant({ ...base, contact: `c-${i}` });
      if (r.ok) counts.set(r.variant, (counts.get(r.variant) ?? 0) + 1);
    }
    expect(counts.size).toBe(5);
    for (const n of counts.values()) { expect(n).toBeGreaterThan(850); expect(n).toBeLessThan(1150); }
  });
});

describe("familias", () => {
  it("reconoce el sufijo numérico y no confunde nombres que acaban en otra cosa", () => {
    expect(familyOf("renovacion_3")).toBe("renovacion");
    expect(familyOf("diagnostico_999_5")).toBe("diagnostico_999");
    expect(familyOf("recordatorio_sesion_24h")).toBeNull();
    expect(familyOf("bienvenida_confirmar_v3")).toBeNull();
  });
  it("agrupa solo cuando hay al menos dos variaciones", () => {
    const g = groupFamilies(["retomar_1", "retomar_2", "retomar_3", "cita_cancelada", "aviso_1"].map(name => ({ name })));
    expect([...g.keys()]).toEqual(["retomar"]);
    expect(g.get("retomar")).toHaveLength(3);
  });
});
