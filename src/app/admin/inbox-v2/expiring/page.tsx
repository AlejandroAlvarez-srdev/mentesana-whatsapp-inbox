"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import WindowBadge, { fmtMinutesLeft, colorFor } from "../_components/WindowBadge";

const PURPLE = "#6A178C";

type Row = {
  conversation_id: string;
  phone: string;
  lead_name: string | null;
  status: string | null;
  client_type: string | null;
  assigned_to: string | null;
  last_inbound_at: string;
  expires_at: string;
  minutes_left: number;
  window_status: "open" | "expiring_soon" | "expired" | string;
  unread_count: number | null;
  last_message: string | null;
};

export default function ExpiringPage() {
  const [hours, setHours] = useState(6);
  const [clientType, setClientType] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [counts, setCounts] = useState({ open: 0, expiring_soon: 0, expired: 0 } as Record<string, number>);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "expiring_soon" | "expired" | "open">("expiring_soon");

  const [suggestionFor, setSuggestionFor] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState("");
  const [suggestionStreaming, setSuggestionStreaming] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ hours: String(hours) });
      if (clientType) params.set("client_type", clientType);
      const r = await fetch(`/api/admin/inbox-v2/conversations-expiring?${params}`, { credentials: "include" });
      const d = await r.json();
      setRows(d.conversations ?? []);
      setCounts(d.counts ?? {});
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); const iv = setInterval(load, 60000); return () => clearInterval(iv); }, [hours, clientType]);

  async function generateSuggestion(convId: string) {
    setSuggestionFor(convId);
    setSuggestion("");
    setSuggestionStreaming(true);
    try {
      const r = await fetch(`/api/admin/inbox-v2/conversations/${encodeURIComponent(convId)}/suggested-reply`, {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok || !r.body) {
        setSuggestion(`Error: ${(await r.text()).slice(0, 200)}`);
        return;
      }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setSuggestion(acc);
      }
    } finally {
      setSuggestionStreaming(false);
    }
  }

  const filtered = rows.filter((r) => filter === "all" || r.window_status === filter);

  return (
    <div style={{ maxWidth: 1280 }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "#1a1a2e", margin: 0 }}>⏰ Conversaciones por cerrar</h1>
        <p style={{ color: "#888", fontSize: 13, marginTop: 6 }}>
          Meta tiene una ventana de 24h tras el último mensaje del lead. Después de eso solo puedes enviar plantillas aprobadas. Aquí ves lo que está a punto de cerrarse para que respondas a tiempo.
        </p>
      </header>

      {/* Stats top */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 18 }}>
        <StatCard label="🟢 Abiertas" value={counts.open ?? 0} color="#10b981" onClick={() => setFilter("open")} active={filter === "open"} />
        <StatCard label="🟡 Expiran < 2h" value={counts.expiring_soon ?? 0} color="#f59e0b" onClick={() => setFilter("expiring_soon")} active={filter === "expiring_soon"} />
        <StatCard label="🔴 Ya cerradas" value={counts.expired ?? 0} color="#ef4444" onClick={() => setFilter("expired")} active={filter === "expired"} />
        <StatCard label="Todas" value={rows.length} color="#64748b" onClick={() => setFilter("all")} active={filter === "all"} />
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ fontSize: 11, color: "#888", fontWeight: 700 }}>VENTANA ±</label>
        <select value={hours} onChange={(e) => setHours(Number(e.target.value))} style={selectStyle}>
          <option value={3}>3h</option>
          <option value={6}>6h</option>
          <option value={12}>12h</option>
          <option value={24}>24h</option>
          <option value={48}>48h</option>
        </select>
        <label style={{ fontSize: 11, color: "#888", fontWeight: 700, marginLeft: 8 }}>TIPO</label>
        <select value={clientType} onChange={(e) => setClientType(e.target.value)} style={selectStyle}>
          <option value="">Todos</option>
          <option value="ventas">Ventas</option>
          <option value="soporte">Soporte</option>
        </select>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "#888" }}>
          {loading ? "Actualizando…" : `${filtered.length} conversaciones`}
          {" · "}auto-refresh 60s
        </span>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        {filtered.length === 0 && <div style={{ padding: 30, color: "#aaa", textAlign: "center", background: "#fff", borderRadius: 12, border: "1px solid rgba(0,0,0,0.05)" }}>Nada en este filtro 🎉</div>}
        {filtered.map((r) => {
          const c = colorFor(r.window_status);
          return (
            <div key={r.conversation_id} style={{ background: "#fff", borderRadius: 12, border: `1px solid ${c.border}`, borderLeft: `4px solid ${c.fg}`, padding: 14, display: "grid", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <strong style={{ fontSize: 14, color: "#1a1a2e" }}>{r.lead_name?.trim() || "(sin nombre)"}</strong>
                <span style={{ fontSize: 11, color: "#888", fontFamily: "ui-monospace, monospace" }}>{r.phone}</span>
                <WindowBadge info={{ last_inbound_at: r.last_inbound_at, expires_at: r.expires_at, minutes_left: r.minutes_left, window_status: r.window_status }} withCountdown />
                {r.status && <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 4, background: "rgba(0,0,0,0.05)", color: "#555", fontWeight: 600 }}>{r.status}</span>}
                {(r.unread_count ?? 0) > 0 && <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 4, background: PURPLE, color: "#fff", fontWeight: 700 }}>{r.unread_count} sin responder</span>}
                <Link href={`/admin/inbox-v2#${r.conversation_id}`} style={{ marginLeft: "auto", fontSize: 11, color: PURPLE, textDecoration: "none", fontWeight: 600 }}>Abrir chat →</Link>
              </div>

              {r.last_message && (
                <div style={{ fontSize: 12, color: "#666", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  💬 {r.last_message}
                </div>
              )}

              {r.window_status !== "expired" && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                  <button
                    onClick={() => generateSuggestion(r.conversation_id)}
                    disabled={suggestionStreaming && suggestionFor === r.conversation_id}
                    style={{ padding: "5px 12px", fontSize: 11.5, fontWeight: 700, background: `${PURPLE}0d`, color: PURPLE, border: `1px solid ${PURPLE}55`, borderRadius: 6, cursor: "pointer" }}
                  >
                    {suggestionStreaming && suggestionFor === r.conversation_id ? "✨ Generando…" : "✨ Sugerir estrategia (Voyage + Claude)"}
                  </button>
                </div>
              )}

              {suggestionFor === r.conversation_id && suggestion && (
                <div style={{ marginTop: 4, padding: 12, background: "rgba(106,23,140,0.04)", border: "1px solid rgba(106,23,140,0.15)", borderRadius: 8, fontSize: 12.5, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: PURPLE, marginBottom: 6, letterSpacing: 0.5 }}>ESTRATEGIA BASADA EN CASOS PAGADOS · TÚ REDACTAS EL MENSAJE</div>
                  <Markdown text={suggestion} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatCard({ label, value, color, onClick, active }: { label: string; value: number; color: string; onClick: () => void; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? color + "1f" : "#fff",
        border: `2px solid ${active ? color : "rgba(0,0,0,0.06)"}`,
        borderRadius: 12,
        padding: "14px 16px",
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      <p style={{ color: "#888", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, margin: 0 }}>{label}</p>
      <p style={{ color, fontSize: 32, fontWeight: 700, margin: "2px 0 0", lineHeight: 1.1 }}>{value}</p>
    </button>
  );
}

function Markdown({ text }: { text: string }) {
  const html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br/>");
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

const selectStyle: React.CSSProperties = { padding: "6px 10px", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 6, fontSize: 12.5, background: "#fff" };
