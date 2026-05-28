// /admin/inbox-v2/pipelines — lista de familias detectadas con conteos.
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Family = {
  family: string;
  display_name: string;
  total_phases: number;
  template_by_phase: Record<string, string>;
  category: string;
  is_active: boolean;
  stats: { total: number; assigned: number; unassigned: number; phases: Record<string, number> };
};

export default function PipelinesIndex() {
  const [families, setFamilies] = useState<Family[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/inbox-v2/pipelines/families")
      .then((r) => r.json())
      .then((j) => { setFamilies(j.families ?? []); setLoading(false); })
      .catch((e) => { setErr(String(e)); setLoading(false); });
  }, []);

  return (
    <div style={{ padding: "24px", maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 4 }}>Pipelines por plantilla</h1>
        <p style={{ fontSize: 13, color: "#64748b" }}>
          Detectados automáticamente a partir de las fases en los nombres de plantilla. Al mover una card a una nueva fase,
          se dispara el envío de la plantilla correspondiente.
        </p>
      </div>

      {err && <div style={{ padding: 12, background: "#fef2f2", color: "#991b1b", borderRadius: 8 }}>{err}</div>}
      {loading && <div style={{ color: "#94a3b8" }}>Cargando…</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
        {families.map((f) => {
          const phaseEntries = Array.from({ length: f.total_phases }, (_, i) => {
            const p = String(i + 1);
            return [p, f.stats.phases[p] ?? 0] as [string, number];
          });
          const respondedCount = f.stats.phases["-1"] ?? 0;
          const wonCount = f.stats.phases["-2"] ?? 0;
          const lostCount = f.stats.phases["-3"] ?? 0;
          return (
            <Link
              key={f.family}
              href={`/admin/inbox-v2/pipelines/${f.family}`}
              style={{
                display: "block",
                padding: 16,
                background: "#fff",
                border: "1px solid #e2e8f0",
                borderRadius: 12,
                textDecoration: "none",
                color: "inherit",
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#6A178C"; e.currentTarget.style.transform = "translateY(-2px)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#e2e8f0"; e.currentTarget.style.transform = "translateY(0)"; }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: "#6A178C" }}>{f.display_name}</h3>
                <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>{f.total_phases} fases</span>
              </div>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 12 }}>{f.stats.total} contactos</div>

              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 10 }}>
                {phaseEntries.map(([p, n]) => (
                  <div
                    key={p}
                    style={{
                      flex: "1 1 auto",
                      minWidth: 32,
                      textAlign: "center",
                      padding: "4px 6px",
                      background: n > 0 ? "rgba(106,23,140,0.08)" : "#f8fafc",
                      borderRadius: 6,
                      fontSize: 11,
                    }}
                  >
                    <div style={{ fontWeight: 700, color: n > 0 ? "#6A178C" : "#cbd5e1" }}>{n}</div>
                    <div style={{ fontSize: 9, color: "#94a3b8", textTransform: "uppercase" }}>F{p}</div>
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", gap: 8, fontSize: 11, color: "#64748b" }}>
                {respondedCount > 0 && <span>💬 {respondedCount}</span>}
                {wonCount > 0 && <span style={{ color: "#16a34a" }}>✅ {wonCount}</span>}
                {lostCount > 0 && <span style={{ color: "#dc2626" }}>❌ {lostCount}</span>}
                {f.stats.unassigned > 0 && <span style={{ marginLeft: "auto" }}>👤 sin asignar: {f.stats.unassigned}</span>}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
