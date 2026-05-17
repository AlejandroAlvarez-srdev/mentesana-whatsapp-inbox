"use client";

import { useEffect, useRef, useState } from "react";

const PURPLE = "#6A178C";

type Message = {
  id: string;
  sender: string;
  sender_name: string | null;
  content: string | null;
  type: string | null;
  is_template: boolean | null;
  template_name: string | null;
  timestamp: string;
  status: string | null;
  media_url: string | null;
  media_type: string | null;
  media_caption: string | null;
  is_lead: boolean;
  is_agent: boolean;
  is_psychologist: boolean;
};

type ConvDetail = {
  conversation: {
    id: string;
    phone: string;
    lead_name: string | null;
    status: string | null;
    purchase_status: string | null;
    purchase_amount: number | null;
    paid_at: string | null;
    assigned_psychologist_name: string | null;
    pipeline_type: string | null;
    source: string | null;
    created_at: string;
  };
  insight: any;
  messages: Message[];
};

export default function ChatPanel({ conversationId }: { conversationId: string | null }) {
  const [data, setData] = useState<ConvDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!conversationId) {
      setData(null);
      return;
    }
    setLoading(true);
    setErr(null);
    fetch(`/api/admin/inbox-v2/conversations/${encodeURIComponent(conversationId)}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`)))
      .then((d) => setData(d))
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [conversationId]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [data]);

  if (!conversationId) {
    return (
      <div style={emptyStyle}>
        <div style={{ textAlign: "center", color: "#aaa" }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>💬</div>
          <div style={{ fontSize: 14 }}>Selecciona una conversación</div>
        </div>
      </div>
    );
  }

  if (loading) return <div style={emptyStyle}><span style={{ color: "#aaa" }}>Cargando…</span></div>;
  if (err) return <div style={emptyStyle}><span style={{ color: "#900" }}>Error: {err}</span></div>;
  if (!data) return null;

  const c = data.conversation;

  return (
    <div style={{ background: "#fff", borderRadius: 12, border: "1px solid rgba(0,0,0,0.06)", display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
      {/* header */}
      <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(0,0,0,0.06)", display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 700, fontSize: 15, color: "#1a1a2e" }}>
          {c.lead_name?.trim() || "(sin nombre)"}
        </span>
        <span style={{ fontSize: 12, color: "#888" }}>{c.phone}</span>
        {c.assigned_psychologist_name && (
          <span style={{ fontSize: 11, color: PURPLE, fontWeight: 600 }}>· {c.assigned_psychologist_name}</span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {c.status && <Tag label={c.status} color="#666" />}
          {c.pipeline_type && <Tag label={c.pipeline_type} color="#666" />}
          {(c.purchase_status === "pagado" || c.paid_at) && <Tag label={`PAGÓ ${c.purchase_amount ?? ""}€`} color={PURPLE} solid />}
        </div>
      </div>

      {/* messages */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "16px 14px", background: "#FAFAFA" }}>
        {data.messages.length === 0 && (
          <div style={{ textAlign: "center", color: "#aaa", fontSize: 12, padding: 30 }}>Sin mensajes.</div>
        )}
        {data.messages.map((m) => (
          <Bubble key={m.id} m={m} />
        ))}
      </div>

      {/* footer info */}
      <div style={{ padding: "8px 14px", borderTop: "1px solid rgba(0,0,0,0.06)", fontSize: 11, color: "#aaa", textAlign: "center" }}>
        Read-only · {data.messages.length} mensajes · enviar disponible en Sprint 6
      </div>
    </div>
  );
}

function Bubble({ m }: { m: Message }) {
  const isLead = m.is_lead;
  const align = isLead ? "flex-start" : "flex-end";
  const bg = isLead ? "#fff" : m.is_psychologist ? "rgba(106,23,140,0.08)" : "rgba(37,99,235,0.06)";
  const border = isLead ? "1px solid rgba(0,0,0,0.06)" : "none";

  return (
    <div style={{ display: "flex", justifyContent: align, marginBottom: 8 }}>
      <div style={{ maxWidth: "78%", background: bg, border, borderRadius: 12, padding: "8px 12px" }}>
        {!isLead && (
          <div style={{ fontSize: 10, color: "#888", fontWeight: 600, marginBottom: 2 }}>
            {m.is_psychologist ? "PSIC" : m.sender_name || m.sender || "AGENTE"}
            {m.is_template && m.template_name && (
              <span style={{ marginLeft: 6, color: "#aaa", fontWeight: 400 }}>· template: {m.template_name}</span>
            )}
          </div>
        )}
        <div style={{ fontSize: 13, color: "#1a1a2e", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.content || (m.media_url ? `[media: ${m.media_type}]` : "—")}</div>
        {m.media_url && m.media_type?.startsWith("image") && (
          <img src={m.media_url} alt="media" style={{ marginTop: 6, maxWidth: 240, borderRadius: 6 }} />
        )}
        <div style={{ fontSize: 10, color: "#bbb", marginTop: 4, textAlign: "right" }}>
          {fmtTime(m.timestamp)}
          {m.status && <span> · {m.status}</span>}
        </div>
      </div>
    </div>
  );
}

function Tag({ label, color, solid }: { label: string; color: string; solid?: boolean }) {
  return (
    <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 6, fontWeight: 700, background: solid ? color : `${color}1a`, color: solid ? "#fff" : color, textTransform: "uppercase" }}>{label}</span>
  );
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

const emptyStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 12,
  border: "1px solid rgba(0,0,0,0.06)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};
