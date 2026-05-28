// /admin/inbox-v2/wa-risk — dashboard anti-baneo de WhatsApp.
// 4 secciones: salud por número, volumen 24h vs tier, plantillas con read-rate
// bajo, plantillas con keywords spammy.
"use client";

import { useEffect, useState } from "react";

type NumberHealth = {
  name: string; phone_number: string; phone_number_id: string;
  business_account_id: string; is_default: boolean;
  quality_rating: string; name_status: string; tier: string; tier_limit: number;
  status: string; risk_score: number; flags: string[]; graph_error: string | null;
};
type TemplateHealth = { name: string; sent: number; delivered: number; read: number; failed: number; total: number; read_rate: number; fail_rate: number };
type SpammyTpl = { name: string; waba: string; body: string; hits: string[]; allCapsRatio: number; exclamationStreak: number; emojiCount: number; score: number };
type Data = {
  numbers: NumberHealth[];
  volume_24h: { total: number; by_status: Record<string, number> };
  templates_low_read_rate: TemplateHealth[];
  spammy_templates: SpammyTpl[];
  generated_at: string;
};

const PURPLE = "#6A178C";
function qColor(q: string) {
  if (q === "GREEN") return "#16a34a";
  if (q === "YELLOW") return "#d97706";
  if (q === "RED") return "#dc2626";
  return "#94a3b8";
}
function scoreColor(s: number) {
  if (s >= 60) return "#dc2626";
  if (s >= 30) return "#d97706";
  if (s >= 10) return "#ca8a04";
  return "#16a34a";
}
function pct(x: number) { return `${Math.round(x * 100)}%`; }

export default function WARiskPage() {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true); setErr(null);
    try {
      const r = await fetch("/api/admin/inbox-v2/health/wa-risk", { credentials: "include" });
      const j = await r.json();
      if (!r.ok) { setErr(j.error ?? "error"); return; }
      setD(j);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <div style={{ padding: "20px", maxWidth: 1400, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 18, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: PURPLE }}>🛡️ Riesgo de baneo WhatsApp</h1>
          <p style={{ fontSize: 12, color: "#64748b" }}>
            Detección proactiva de patrones que correlacionan con baneos de Meta. 3 de los 4 baneos previos estaban GREEN justo antes — no esperes solo al quality_rating.
          </p>
        </div>
        <button onClick={load} disabled={loading} style={{ padding: "8px 14px", background: PURPLE, color: "#fff", border: "none", borderRadius: 8, cursor: loading ? "wait" : "pointer", fontSize: 12, fontWeight: 700 }}>
          ↻ Refrescar
        </button>
      </div>

      {err && <div style={{ padding: 12, background: "#fef2f2", color: "#991b1b", borderRadius: 8, marginBottom: 14 }}>{err}</div>}
      {loading && !d && <div style={{ color: "#94a3b8" }}>Cargando…</div>}

      {d && (
        <>
          {/* 1 · Números */}
          <h2 style={{ fontSize: 14, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>📞 Salud por número</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))", gap: 12, marginBottom: 24 }}>
            {d.numbers.map((n) => (
              <div key={n.phone_number_id} style={{ padding: 14, border: "1px solid #e2e8f0", borderRadius: 12, background: "#fff", borderLeftWidth: 4, borderLeftColor: scoreColor(n.risk_score), borderLeftStyle: "solid" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{n.name} {n.is_default && <span style={{ color: PURPLE, fontSize: 10 }}>★ DEFAULT</span>}</div>
                    <div style={{ fontSize: 11, color: "#64748b", fontFamily: "monospace" }}>{n.phone_number}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 22, fontWeight: 900, color: scoreColor(n.risk_score), lineHeight: 1 }}>{n.risk_score}</div>
                    <div style={{ fontSize: 9, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5 }}>Riesgo</div>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12, fontSize: 11 }}>
                  <div>
                    <div style={{ color: "#94a3b8", textTransform: "uppercase", fontSize: 9, letterSpacing: 0.5 }}>Quality</div>
                    <div style={{ fontWeight: 700, color: qColor(n.quality_rating) }}>● {n.quality_rating}</div>
                  </div>
                  <div>
                    <div style={{ color: "#94a3b8", textTransform: "uppercase", fontSize: 9, letterSpacing: 0.5 }}>Tier</div>
                    <div style={{ fontWeight: 700 }}>{n.tier.replace("TIER_", "")} <span style={{ color: "#94a3b8", fontWeight: 500 }}>/24h</span></div>
                  </div>
                  <div>
                    <div style={{ color: "#94a3b8", textTransform: "uppercase", fontSize: 9, letterSpacing: 0.5 }}>Name</div>
                    <div style={{ fontWeight: 700, color: n.name_status === "DECLINED" ? "#dc2626" : "#475569" }}>{n.name_status}</div>
                  </div>
                  <div>
                    <div style={{ color: "#94a3b8", textTransform: "uppercase", fontSize: 9, letterSpacing: 0.5 }}>Estado</div>
                    <div style={{ fontWeight: 700, color: n.status === "CONNECTED" ? "#16a34a" : "#dc2626" }}>{n.status}</div>
                  </div>
                </div>
                {n.flags.length > 0 && (
                  <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {n.flags.map((f) => <span key={f} style={{ background: "rgba(220,38,38,0.1)", color: "#991b1b", padding: "2px 7px", borderRadius: 999, fontSize: 10, fontWeight: 600 }}>{f}</span>)}
                  </div>
                )}
                {n.graph_error && <div style={{ marginTop: 6, fontSize: 10, color: "#dc2626" }}>⚠ {n.graph_error}</div>}
              </div>
            ))}
          </div>

          {/* 2 · Volumen 24h */}
          <h2 style={{ fontSize: 14, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>📊 Volumen últimas 24h</h2>
          <div style={{ padding: 14, border: "1px solid #e2e8f0", borderRadius: 12, background: "#fff", marginBottom: 24, display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 26, fontWeight: 900, color: PURPLE }}>{d.volume_24h.total}</div>
              <div style={{ fontSize: 10, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5 }}>Templates enviadas 24h</div>
            </div>
            <div style={{ flex: 1, display: "flex", gap: 12, flexWrap: "wrap" }}>
              {Object.entries(d.volume_24h.by_status).sort(([, a], [, b]) => b - a).map(([k, v]) => (
                <div key={k} style={{ background: "#f8fafc", padding: "6px 12px", borderRadius: 8, minWidth: 80 }}>
                  <div style={{ fontSize: 15, fontWeight: 800 }}>{v}</div>
                  <div style={{ fontSize: 10, color: "#94a3b8", textTransform: "uppercase" }}>{k}</div>
                </div>
              ))}
            </div>
          </div>

          {/* 3 · Read-rate */}
          <h2 style={{ fontSize: 14, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>📉 Plantillas con read-rate bajo (7d)</h2>
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden", marginBottom: 24 }}>
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#f8fafc", textAlign: "left" }}>
                  <th style={{ padding: 10 }}>Plantilla</th>
                  <th style={{ padding: 10, textAlign: "right" }}>Enviadas</th>
                  <th style={{ padding: 10, textAlign: "right" }}>Read-rate</th>
                  <th style={{ padding: 10, textAlign: "right" }}>Fail-rate</th>
                </tr>
              </thead>
              <tbody>
                {d.templates_low_read_rate.length === 0 && (
                  <tr><td colSpan={4} style={{ padding: 16, color: "#94a3b8", textAlign: "center" }}>Sin volumen suficiente.</td></tr>
                )}
                {d.templates_low_read_rate.map((t) => (
                  <tr key={t.name} style={{ borderTop: "1px solid #f1f5f9" }}>
                    <td style={{ padding: 10, fontFamily: "monospace" }}>{t.name}</td>
                    <td style={{ padding: 10, textAlign: "right" }}>{t.total}</td>
                    <td style={{ padding: 10, textAlign: "right", color: t.read_rate < 0.3 ? "#dc2626" : t.read_rate < 0.5 ? "#d97706" : "#16a34a", fontWeight: 700 }}>{pct(t.read_rate)}</td>
                    <td style={{ padding: 10, textAlign: "right", color: t.fail_rate > 0.15 ? "#dc2626" : "#64748b" }}>{pct(t.fail_rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 4 · Spammy */}
          <h2 style={{ fontSize: 14, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>⚠️ Plantillas con keywords/patrones spammy</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 12 }}>
            {d.spammy_templates.length === 0 && (
              <div style={{ padding: 16, color: "#16a34a", fontSize: 13 }}>✅ Ninguna plantilla activa supera umbral de riesgo de contenido.</div>
            )}
            {d.spammy_templates.map((t) => (
              <div key={`${t.waba}::${t.name}`} style={{ padding: 12, background: "#fff", border: "1px solid #fecaca", borderRadius: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                  <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700 }}>{t.name}</span>
                  <span style={{ background: scoreColor(t.score), color: "#fff", padding: "1px 8px", borderRadius: 999, fontSize: 10, fontWeight: 800 }}>{t.score}</span>
                </div>
                <div style={{ fontSize: 11, color: "#475569", marginBottom: 8, fontStyle: "italic" }}>&ldquo;{t.body}&rdquo;</div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {t.hits.map((h) => <span key={h} style={{ background: "#fef2f2", color: "#991b1b", padding: "2px 7px", borderRadius: 4, fontSize: 10 }}>{h}</span>)}
                  {t.allCapsRatio > 0.3 && <span style={{ background: "#fef3c7", color: "#854d0e", padding: "2px 7px", borderRadius: 4, fontSize: 10 }}>{pct(t.allCapsRatio)} MAYÚS</span>}
                  {t.exclamationStreak >= 2 && <span style={{ background: "#fef3c7", color: "#854d0e", padding: "2px 7px", borderRadius: 4, fontSize: 10 }}>{t.exclamationStreak}× !!</span>}
                  {t.emojiCount > 4 && <span style={{ background: "#fef3c7", color: "#854d0e", padding: "2px 7px", borderRadius: 4, fontSize: 10 }}>{t.emojiCount} emojis</span>}
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 24, fontSize: 11, color: "#94a3b8", textAlign: "center" }}>
            Generado {new Date(d.generated_at).toLocaleString("es-ES")}
          </div>
        </>
      )}
    </div>
  );
}
