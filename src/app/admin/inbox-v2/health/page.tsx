"use client";

import { useEffect, useRef, useState } from "react";
import { useConversationsRealtime } from "../_hooks/useInboxRealtime";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const PURPLE = "#6A178C";

type NumberHealth = {
  phone_number_id: string;
  name: string;
  phone_number: string | null;
  is_default: boolean;
  status: string;
  last_inbound_at: string | null;
  msgs_inbound_1h: number;
  msgs_inbound_24h: number;
  msgs_outbound_24h: number;
  conversations_active_7d: number;
};

type RecentMsg = {
  id: string;
  conversation_id: string;
  sender: string;
  sender_name: string | null;
  content: string | null;
  timestamp: string;
  is_template: boolean | null;
  template_name: string | null;
  lead_name: string | null;
  lead_phone: string | null;
  is_inbound: boolean;
};

type HealthData = {
  generated_at: string;
  numbers: NumberHealth[];
  stats: { conv_total: number; routing_active: number; conv_unrouted: number; msgs_total: number; msgs_1h: number; msgs_24h: number };
  realtime_enabled: boolean;
  recent: RecentMsg[];
};

let _rtClient: SupabaseClient | null = null;
function getRtClient(): SupabaseClient {
  if (!_rtClient) {
    _rtClient = createClient(process.env.NEXT_PUBLIC_BLOG_SUPABASE_URL!, process.env.NEXT_PUBLIC_BLOG_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  }
  return _rtClient;
}

export default function HealthPage() {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [liveFeed, setLiveFeed] = useState<RecentMsg[]>([]);
  const [rtConnected, setRtConnected] = useState(false);
  const lastRefreshRef = useRef<number>(0);

  async function refresh() {
    try {
      const r = await fetch("/api/admin/inbox-v2/health-extended", { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setData(d);
      lastRefreshRef.current = Date.now();
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    const iv = setInterval(refresh, 30000);
    return () => clearInterval(iv);
  }, []);

  // Realtime: cuando llega un mensaje nuevo, lo pintamos arriba del feed en vivo
  useEffect(() => {
    const sb = getRtClient();
    const ch = sb
      .channel("health-feed")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages_mentesana" }, (payload) => {
        const m: any = payload.new;
        setLiveFeed((prev) => [{
          id: m.id,
          conversation_id: m.conversation_id,
          sender: m.sender,
          sender_name: m.sender_name,
          content: m.content,
          timestamp: m.timestamp,
          is_template: m.is_template,
          template_name: m.template_name,
          lead_name: null,
          lead_phone: null,
          is_inbound: false,
        }, ...prev].slice(0, 30));
      })
      .subscribe((status) => {
        setRtConnected(status === "SUBSCRIBED");
      });
    return () => {
      void sb.removeChannel(ch);
    };
  }, []);

  useConversationsRealtime({ onChange: () => { /* señal: hay actividad */ } });

  if (loading && !data) return <div style={{ padding: 30, color: "#888" }}>Cargando salud…</div>;
  if (err && !data) return <div style={{ padding: 20, background: "#fee", borderRadius: 10, color: "#900" }}>{err}</div>;
  if (!data) return null;

  return (
    <div style={{ maxWidth: 1280 }}>
      <header style={{ marginBottom: 20, display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "#1a1a2e", margin: 0 }}>🩺 Salud del inbox</h1>
        <span style={{ fontSize: 12, color: "#888" }}>actualizado {new Date(data.generated_at).toLocaleTimeString("es-ES")}</span>
        <span style={{ marginLeft: "auto", fontSize: 11, padding: "4px 10px", borderRadius: 6, background: rtConnected ? "rgba(16,185,129,0.12)" : "rgba(245,158,11,0.12)", color: rtConnected ? "#065f46" : "#92400e", fontWeight: 700 }}>
          {rtConnected ? "● REALTIME CONECTADO" : "○ Realtime conectando…"}
        </span>
        {data.realtime_enabled ? (
          <span style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, background: "rgba(16,185,129,0.12)", color: "#065f46", fontWeight: 700 }}>
            ● PUBLICATION ACTIVA
          </span>
        ) : (
          <span style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, background: "rgba(239,68,68,0.12)", color: "#991b1b", fontWeight: 700 }}>
            ⚠ PUBLICATION INACTIVA
          </span>
        )}
      </header>

      {/* Top stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 24 }}>
        <Stat label="Conversaciones" value={data.stats.conv_total.toLocaleString("es-ES")} sub={`${data.stats.conv_unrouted} sin número asignado`} warn={data.stats.conv_unrouted > 200} />
        <Stat label="Mensajes totales" value={data.stats.msgs_total.toLocaleString("es-ES")} />
        <Stat label="Última hora" value={data.stats.msgs_1h.toLocaleString("es-ES")} sub="mensajes" />
        <Stat label="Últimas 24h" value={data.stats.msgs_24h.toLocaleString("es-ES")} sub="mensajes" />
      </div>

      {/* Per number */}
      <div style={{ background: "#fff", borderRadius: 14, border: "1px solid rgba(0,0,0,0.06)", padding: 16, marginBottom: 24 }}>
        <h2 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 700, color: "#1a1a2e" }}>Por número WhatsApp</h2>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
              <Th>Número</Th>
              <Th>Phone</Th>
              <Th right>1h ↓</Th>
              <Th right>24h ↓</Th>
              <Th right>24h ↑</Th>
              <Th right>Conv 7d</Th>
              <Th>Última recibida</Th>
              <Th>Salud</Th>
            </tr>
          </thead>
          <tbody>
            {data.numbers.map((n) => {
              const lastAgeMin = n.last_inbound_at ? (Date.now() - new Date(n.last_inbound_at).getTime()) / 60000 : Infinity;
              const isHealthy = lastAgeMin < 24 * 60; // activo hoy
              const isStale = lastAgeMin > 7 * 24 * 60; // sin nada en 7 días
              return (
                <tr key={n.phone_number_id} style={{ borderBottom: "1px solid rgba(0,0,0,0.04)" }}>
                  <Td>
                    <strong style={{ color: "#1a1a2e" }}>{n.name?.trim()}</strong>
                    {n.is_default && <span style={{ fontSize: 9, marginLeft: 6, padding: "1px 5px", background: PURPLE, color: "#fff", borderRadius: 3, fontWeight: 700 }}>DEFAULT</span>}
                  </Td>
                  <Td><span style={{ fontSize: 11, color: "#888" }}>{n.phone_number ?? "—"}</span><br /><span style={{ fontSize: 10, fontFamily: "ui-monospace, monospace", color: "#aaa" }}>{n.phone_number_id}</span></Td>
                  <Td right><strong>{n.msgs_inbound_1h}</strong></Td>
                  <Td right><strong>{n.msgs_inbound_24h}</strong></Td>
                  <Td right>{n.msgs_outbound_24h}</Td>
                  <Td right>{n.conversations_active_7d}</Td>
                  <Td>{n.last_inbound_at ? <span style={{ fontSize: 11 }}>{new Date(n.last_inbound_at).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span> : <span style={{ color: "#aaa" }}>—</span>}</Td>
                  <Td>
                    {isStale ? <Tag color="#dc2626" label="🔴 inactivo > 7d" /> : isHealthy ? <Tag color="#10b981" label="🟢 sano" /> : <Tag color="#f59e0b" label="🟡 lento" />}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Live feed */}
      <div style={{ background: "#0a0814", borderRadius: 14, padding: 18, color: "#e2e8f0" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#f1f5f9" }}>🔴 Live · últimos {liveFeed.length > 0 ? liveFeed.length : data.recent.length} mensajes</h2>
          <span style={{ fontSize: 11, color: "#94a3b8" }}>{liveFeed.length > 0 ? "via Realtime WebSocket" : "snapshot (refrescando cada 30s)"}</span>
        </div>
        <div style={{ display: "grid", gap: 6, fontFamily: "ui-monospace, monospace", fontSize: 11.5 }}>
          {(liveFeed.length > 0 ? liveFeed : data.recent).map((m) => {
            const isInbound = m.is_inbound === true || (m.lead_phone && m.sender === m.lead_phone);
            return (
              <div key={m.id} style={{ display: "grid", gridTemplateColumns: "80px 40px 200px 1fr", gap: 10, padding: "6px 10px", borderRadius: 6, background: "rgba(241,245,249,0.04)" }}>
                <span style={{ color: "#64748b" }}>{new Date(m.timestamp).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                <span style={{ color: isInbound ? "#22d3ee" : "#fbbf24", fontWeight: 700 }}>{isInbound ? "← IN" : "→ OUT"}</span>
                <span style={{ color: "#cbd5e1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.lead_name ?? m.sender_name ?? m.sender}</span>
                <span style={{ color: "#f1f5f9", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {m.is_template && <span style={{ color: "#a855f7" }}>[{m.template_name}] </span>}
                  {(m.content ?? "—").slice(0, 120)}
                </span>
              </div>
            );
          })}
          {liveFeed.length === 0 && data.recent.length === 0 && <div style={{ color: "#64748b", padding: 14 }}>Sin actividad.</div>}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div style={{ background: "#fff", borderRadius: 12, padding: "14px 16px", border: `1px solid ${warn ? "#fde68a" : "rgba(0,0,0,0.05)"}` }}>
      <p style={{ color: "#aaa", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, margin: 0 }}>{label}</p>
      <p style={{ color: warn ? "#92400e" : PURPLE, fontSize: 26, fontWeight: 700, margin: "4px 0 0", lineHeight: 1.1 }}>{value}</p>
      {sub && <p style={{ color: "#bbb", fontSize: 11, margin: "4px 0 0" }}>{sub}</p>}
    </div>
  );
}
function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th style={{ textAlign: right ? "right" : "left", padding: "8px 10px", fontWeight: 700, color: "#666", fontSize: 10, letterSpacing: 0.3, textTransform: "uppercase" }}>{children}</th>;
}
function Td({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <td style={{ padding: "10px", textAlign: right ? "right" : "left" }}>{children}</td>;
}
function Tag({ color, label }: { color: string; label: string }) {
  return <span style={{ background: `${color}1f`, color, padding: "3px 8px", borderRadius: 6, fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>{label}</span>;
}
