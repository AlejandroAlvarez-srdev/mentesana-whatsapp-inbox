"use client";

import { useEffect, useState } from "react";
import { fmtMadridDateTime } from "./_time";

const PURPLE = "#6A178C";

type Tier = "HOT" | "WARM" | "COLD" | "FROZEN";
type Resp = {
  score: number; tier: Tier; explanation: string;
  features: { similar_paid_count: number; avg_paid_similarity: number; similar_lost_count: number; avg_lost_similarity: number; sentiment: string | null };
  scored_at: string; cached?: boolean;
};

const TIER: Record<Tier, { emoji: string; label: string; color: string; bg: string }> = {
  HOT:    { emoji: "🔥", label: "HOT",    color: "#991b1b", bg: "rgba(220,38,38,0.12)" },
  WARM:   { emoji: "🌡️", label: "WARM",  color: "#92400e", bg: "rgba(245,158,11,0.14)" },
  COLD:   { emoji: "❄️", label: "COLD",   color: "#0e7490", bg: "rgba(8,145,178,0.12)" },
  FROZEN: { emoji: "🧊", label: "FROZEN", color: "#475569", bg: "rgba(100,116,139,0.10)" },
};

export default function LeadScoreBadge({ conversationId, compact = false }: { conversationId: string; compact?: boolean }) {
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState(false);

  async function load(refresh = false) {
    if (refresh) setRefreshing(true); else setLoading(true);
    try {
      const r = await fetch(`/api/agent/lead-score/${conversationId}${refresh ? "?refresh=1" : ""}`, { credentials: "include" });
      if (r.ok) setData(await r.json());
    } finally { setLoading(false); setRefreshing(false); }
  }
  useEffect(() => { void load(); }, [conversationId]);

  if (loading) return <div style={{ height: compact ? 22 : 56, background: "rgba(0,0,0,0.04)", borderRadius: 8, display: "inline-block", width: compact ? 80 : 200 }} />;
  if (!data) return null;
  const t = TIER[data.tier];

  if (compact) {
    return (
      <span title={`${data.tier} · ${data.score}/100\n${data.explanation}`} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 8px", borderRadius: 999, background: t.bg, color: t.color, fontSize: 11, fontWeight: 800 }}>
        {t.emoji} {data.score}
      </span>
    );
  }

  return (
    <div style={{ padding: 12, background: t.bg, borderRadius: 12, border: `1px solid ${t.color}33` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 22 }}>{t.emoji}</span>
          <span style={{ fontSize: 26, fontWeight: 800, color: t.color, lineHeight: 1 }}>{data.score}<span style={{ fontSize: 12, opacity: 0.6 }}>/100</span></span>
          <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 8px", borderRadius: 4, background: t.color, color: "#fff", letterSpacing: 0.4 }}>{t.label}</span>
        </div>
        <button onClick={() => void load(true)} disabled={refreshing} title="Recalcular ahora" style={{ background: "transparent", border: "none", color: t.color, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
          {refreshing ? "…" : "🔄"}
        </button>
      </div>
      <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.5, color: "#1a1a2e" }}>{data.explanation}</p>
      <button onClick={() => setExpanded((e) => !e)} style={{ marginTop: 6, background: "transparent", border: "none", color: t.color, cursor: "pointer", fontSize: 10.5, fontWeight: 700, padding: 0 }}>
        {expanded ? "▾ Ocultar features" : "▸ Ver features"}
      </button>
      {expanded && (
        <div style={{ marginTop: 6, fontSize: 10.5, color: "#666", fontFamily: "ui-monospace, monospace", lineHeight: 1.5 }}>
          ✅ {data.features.similar_paid_count} pagados similares (sim {data.features.avg_paid_similarity})<br />
          ❌ {data.features.similar_lost_count} perdidos similares (sim {data.features.avg_lost_similarity})<br />
          {data.features.sentiment && <>🎭 sentimiento: {data.features.sentiment}<br /></>}
          🕒 {fmtMadridDateTime(data.scored_at)} {data.cached ? "· cache" : "· fresh"}
        </div>
      )}
    </div>
  );
}
