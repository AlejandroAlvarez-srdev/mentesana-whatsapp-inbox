"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import TemplatesModal from "./TemplatesModal";
import { useMessagesRealtime } from "../_hooks/useInboxRealtime";

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

type Conversation = {
  id: string;
  phone: string;
  lead_name: string | null;
  status: string | null;
  purchase_status: string | null;
  purchase_amount: number | null;
  paid_at: string | null;
  assigned_to: string | null;
  assigned_psychologist_name: string | null;
  pipeline_type: string | null;
  source: string | null;
  notes: string | null;
  created_at: string;
};

type Agent = { id: string; name: string; email: string; agent_type: string | null };
type TagItem = { id: string; name: string; color: string };
type Psychologist = { id: string; name: string; specialty: string | null; years_experience: number | null; current_patients: number | null; max_patients: number | null; is_accepting_patients: boolean };
type QuickReply = { id: string; title: string; content: string; shortcut: string | null; usage_count: number };

const STATUSES = ["nuevo", "contactado", "asignado", "pagado", "cerrado"] as const;

export default function ChatPanel({ conversationId, onChanged, apiBase = "/api/admin/inbox-v2" }: { conversationId: string | null; onChanged?: () => void; apiBase?: string }) {
  const [conv, setConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tags, setTags] = useState<TagItem[]>([]);
  const [psychologists, setPsychologists] = useState<Psychologist[]>([]);
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [tplOpen, setTplOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastMsgTsRef = useRef<string | null>(null);

  const loadFull = useCallback(async () => {
    if (!conversationId) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`${apiBase}/conversations/${encodeURIComponent(conversationId)}`, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setConv(d.conversation);
      setMessages(d.messages ?? []);
      const last = (d.messages ?? []).slice(-1)[0]?.timestamp ?? null;
      lastMsgTsRef.current = last;
      // No marcamos como leído al abrir. Por regla del equipo, una conversación
      // solo deja de estar "unread" cuando el AGENTE responde — ver no cuenta.
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    setConv(null);
    setMessages([]);
    lastMsgTsRef.current = null;
    void loadFull();
  }, [conversationId, loadFull]);

  // Load auxiliaries once
  useEffect(() => {
    Promise.all([
      fetch(`${apiBase}/agents`, { credentials: "include" }).then((r) => (r.ok ? r.json() : { agents: [] })),
      fetch(`${apiBase}/tags`, { credentials: "include" }).then((r) => (r.ok ? r.json() : { tags: [] })),
      fetch(`${apiBase}/psychologists`, { credentials: "include" }).then((r) => (r.ok ? r.json() : { psychologists: [] })),
      fetch(`${apiBase}/quick-replies`, { credentials: "include" }).then((r) => (r.ok ? r.json() : { quick_replies: [] })),
    ]).then(([a, g, p, q]) => {
      setAgents(a.agents ?? []);
      setTags(g.tags ?? []);
      setPsychologists(p.psychologists ?? []);
      setQuickReplies(q.quick_replies ?? []);
    });
  }, []);

  // Realtime: WebSocket a Supabase, INSERT/UPDATE en messages_mentesana filtrado por conversation_id
  useMessagesRealtime(conversationId, {
    onInsert: (row) => {
      if (!conv) return;
      const enriched: Message = {
        ...(row as Message),
        is_lead: row.sender === conv.phone,
        is_agent: row.sender !== conv.phone && row.sender !== "psicologo" && !/^\d+$/.test(row.sender ?? ""),
        is_psychologist: row.sender === "psicologo",
      };
      setMessages((prev) => {
        if (prev.find((p) => p.id === enriched.id)) return prev;
        return [...prev, enriched];
      });
      lastMsgTsRef.current = row.timestamp;
    },
    onUpdate: (row) => {
      setMessages((prev) => prev.map((m) => (m.id === row.id ? { ...m, ...row } : m)));
    },
  });

  // Fallback polling cada 30 s por si Realtime se cae (Vercel cold start, red, etc).
  useEffect(() => {
    if (!conversationId) return;
    const iv = setInterval(async () => {
      if (!lastMsgTsRef.current) return;
      try {
        const r = await fetch(
          `${apiBase}/conversations/${encodeURIComponent(conversationId)}/poll?since=${encodeURIComponent(lastMsgTsRef.current)}`,
          { credentials: "include" },
        );
        if (!r.ok) return;
        const d = await r.json();
        const newMsgs: Message[] = d.messages ?? [];
        if (newMsgs.length > 0) {
          setMessages((prev) => [...prev, ...newMsgs.filter((m) => !prev.find((p) => p.id === m.id))]);
          lastMsgTsRef.current = newMsgs[newMsgs.length - 1].timestamp;
        }
      } catch {
        /* ignore */
      }
    }, 30000);
    return () => clearInterval(iv);
  }, [conversationId]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length]);

  async function patchConv(patch: Partial<Conversation>) {
    if (!conversationId) return;
    const r = await fetch(`${apiBase}/conversations/${encodeURIComponent(conversationId)}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (r.ok) {
      const d = await r.json();
      setConv((c) => (c ? { ...c, ...d.conversation } : c));
      onChanged?.();
    } else {
      setErr(`PATCH ${r.status}`);
    }
  }

  async function send(text: string) {
    if (!conversationId || !text.trim()) return;
    const r = await fetch(`${apiBase}/conversations/${encodeURIComponent(conversationId)}/send-text`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, agent_name: "agente" }),
    });
    if (r.ok) {
      // refetch para que aparezca el mensaje real
      await loadFull();
    } else {
      const t = await r.text();
      setErr(t.slice(0, 200));
    }
  }

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
  if (loading && !conv) return <div style={emptyStyle}><span style={{ color: "#aaa" }}>Cargando…</span></div>;
  if (err && !conv) return <div style={emptyStyle}><span style={{ color: "#900" }}>Error: {err}</span></div>;
  if (!conv) return null;

  return (
    <div style={{ background: "#fff", borderRadius: 12, border: "1px solid rgba(0,0,0,0.06)", display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "10px 14px", borderBottom: "1px solid rgba(0,0,0,0.06)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontWeight: 700, fontSize: 15, color: "#1a1a2e" }}>{conv.lead_name?.trim() || "(sin nombre)"}</span>
            <span style={{ fontSize: 12, color: "#888" }}>{conv.phone}</span>
            {(conv.purchase_status === "pagado" || conv.paid_at || conv.status === "pagado") && (
              <Tag label={`PAGÓ ${conv.purchase_amount ?? ""}€`} color={PURPLE} solid />
            )}
          </div>
          {conv.assigned_psychologist_name && (
            <span style={{ fontSize: 11, color: PURPLE, fontWeight: 600 }}>👩‍⚕️ {conv.assigned_psychologist_name}</span>
          )}
        </div>

        {/* Status */}
        <select
          value={conv.status ?? ""}
          onChange={(e) => patchConv({ status: e.target.value })}
          style={selectStyle}
          title="Estado"
        >
          <option value="">— estado —</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        {/* Assigned agent */}
        <select
          value={conv.assigned_to ?? ""}
          onChange={(e) => patchConv({ assigned_to: e.target.value || null })}
          style={selectStyle}
          title="Asignado a agente"
        >
          <option value="">— agente —</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name?.trim()} {a.agent_type ? `· ${a.agent_type}` : ""}
            </option>
          ))}
        </select>

        {/* Assigned psychologist */}
        <select
          value={(conv as any).assigned_psychologist ?? ""}
          onChange={(e) => {
            const psyId = e.target.value || null;
            const psy = psychologists.find((p) => p.id === psyId);
            patchConv({ assigned_psychologist: psyId, assigned_psychologist_name: psy?.name ?? null } as any);
          }}
          style={selectStyle}
          title="Psicóloga asignada"
        >
          <option value="">— psicóloga —</option>
          {psychologists.map((p) => {
            const full = p.current_patients != null && p.max_patients != null && p.current_patients >= p.max_patients;
            return (
              <option key={p.id} value={p.id} disabled={!p.is_accepting_patients}>
                {p.name?.trim()}{p.specialty ? ` · ${p.specialty}` : ""}{p.current_patients != null && p.max_patients != null ? ` (${p.current_patients}/${p.max_patients})` : ""}{full ? " ⚠️" : ""}
              </option>
            );
          })}
        </select>
      </div>

      {/* messages */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "16px 14px", background: "#FAFAFA" }}>
        {messages.length === 0 && <div style={{ textAlign: "center", color: "#aaa", fontSize: 12, padding: 30 }}>Sin mensajes.</div>}
        {messages.map((m) => <Bubble key={m.id} m={m} />)}
      </div>

      {/* Compose */}
      <Composer onSend={send} onOpenTemplates={() => setTplOpen(true)} quickReplies={quickReplies} />
      {err && <div style={{ padding: "6px 14px", fontSize: 11, color: "#900", background: "#fee" }}>{err}</div>}

      <TemplatesModal
        open={tplOpen}
        onClose={() => setTplOpen(false)}
        conversation={conv ? { id: conv.id, phone: conv.phone, lead_name: conv.lead_name } : null}
        apiBase={apiBase}
        onSent={() => {
          setTplOpen(false);
          void loadFull();
        }}
      />
    </div>
  );
}

function Composer({ onSend, onOpenTemplates, quickReplies }: { onSend: (text: string) => Promise<void>; onOpenTemplates: () => void; quickReplies: QuickReply[] }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrQuery, setQrQuery] = useState("");
  const [qrIdx, setQrIdx] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Filtra quick replies por shortcut o título
  const matches = (() => {
    const q = qrQuery.toLowerCase();
    if (!q) return quickReplies.slice(0, 10);
    return quickReplies.filter((qr) => (qr.shortcut ?? "").toLowerCase().includes(q) || (qr.title ?? "").toLowerCase().includes(q)).slice(0, 10);
  })();

  function applyQuickReply(qr: QuickReply) {
    setText(qr.content);
    setQrOpen(false);
    setQrQuery("");
    inputRef.current?.focus();
  }

  async function handleSend() {
    if (!text.trim() || sending) return;
    setSending(true);
    await onSend(text.trim());
    setText("");
    setSending(false);
    inputRef.current?.focus();
  }

  // Detecta cuando el textarea contiene solo "/xxx" → abre popup de quick replies
  function onTextChange(v: string) {
    setText(v);
    const trimmed = v.trim();
    if (trimmed.startsWith("/") && !trimmed.includes("\n") && trimmed.length < 50) {
      setQrOpen(true);
      setQrQuery(trimmed.slice(1));
      setQrIdx(0);
    } else if (qrOpen && !trimmed.startsWith("/")) {
      setQrOpen(false);
    }
  }

  return (
    <div style={{ borderTop: "1px solid rgba(0,0,0,0.06)", padding: "10px 12px", background: "#fff", position: "relative" }}>
      {qrOpen && matches.length > 0 && (
        <div style={{ position: "absolute", bottom: 78, left: 12, right: 12, background: "#fff", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 10, boxShadow: "0 8px 30px rgba(0,0,0,0.12)", maxHeight: 320, overflowY: "auto", zIndex: 10 }}>
          <div style={{ padding: "6px 12px", fontSize: 10, color: "#888", fontWeight: 700, letterSpacing: 0.5, borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
            {matches.length} respuesta{matches.length === 1 ? "" : "s"} rápida{matches.length === 1 ? "" : "s"} · Enter para insertar
          </div>
          {matches.map((qr, i) => (
            <button
              key={qr.id}
              onClick={() => applyQuickReply(qr)}
              onMouseEnter={() => setQrIdx(i)}
              style={{ width: "100%", textAlign: "left", padding: "10px 12px", background: i === qrIdx ? "rgba(106,23,140,0.06)" : "transparent", border: "none", borderBottom: "1px solid rgba(0,0,0,0.03)", cursor: "pointer", display: "flex", flexDirection: "column", gap: 3 }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontFamily: "ui-monospace, monospace", color: PURPLE, fontSize: 11, fontWeight: 700 }}>{qr.shortcut ?? "—"}</span>
                <strong style={{ fontSize: 12.5, color: "#1a1a2e" }}>{qr.title}</strong>
                <span style={{ marginLeft: "auto", fontSize: 10, color: "#aaa" }}>×{qr.usage_count}</span>
              </div>
              <div style={{ fontSize: 11, color: "#666", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>{qr.content.slice(0, 110)}</div>
            </button>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <button
          onClick={onOpenTemplates}
          title="Plantillas Meta · individual o bulk"
          style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${PURPLE}55`, background: `${PURPLE}0d`, color: PURPLE, cursor: "pointer", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}
        >
          📋 Plantillas
        </button>
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          onKeyDown={(e) => {
            if (qrOpen && matches.length > 0) {
              if (e.key === "ArrowDown") { e.preventDefault(); setQrIdx((i) => Math.min(i + 1, matches.length - 1)); return; }
              if (e.key === "ArrowUp") { e.preventDefault(); setQrIdx((i) => Math.max(i - 1, 0)); return; }
              if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) { e.preventDefault(); applyQuickReply(matches[qrIdx]); return; }
              if (e.key === "Escape") { e.preventDefault(); setQrOpen(false); return; }
            }
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void handleSend();
            }
          }}
          placeholder="Escribe el mensaje… (Cmd/Ctrl+Enter para enviar · '/' para respuestas rápidas)"
          rows={2}
          style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.1)", fontSize: 13, resize: "none", outline: "none", fontFamily: "inherit" }}
        />
        <button
          onClick={handleSend}
          disabled={sending || !text.trim()}
          style={{ padding: "10px 20px", borderRadius: 8, border: "none", cursor: sending || !text.trim() ? "default" : "pointer", background: sending || !text.trim() ? "rgba(0,0,0,0.06)" : PURPLE, color: sending || !text.trim() ? "#888" : "#fff", fontSize: 13, fontWeight: 600 }}
        >
          {sending ? "Enviando…" : "Enviar"}
        </button>
      </div>
      <div style={{ marginTop: 4, fontSize: 10, color: "#bbb" }}>WhatsApp Cloud API · inbox-v2-server v7</div>
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
            {m.is_template && m.template_name && <span style={{ marginLeft: 6, color: "#aaa", fontWeight: 400 }}>· template: {m.template_name}</span>}
          </div>
        )}
        <div style={{ fontSize: 13, color: "#1a1a2e", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.content || (m.media_url ? `[media: ${m.media_type}]` : "—")}</div>
        {m.media_url && m.media_type?.startsWith("image") && <img src={m.media_url} alt="media" style={{ marginTop: 6, maxWidth: 240, borderRadius: 6 }} />}
        <div style={{ fontSize: 10, color: "#bbb", marginTop: 4, textAlign: "right" }}>
          {fmtTime(m.timestamp)}
          {m.status && <span> · {m.status}</span>}
        </div>
      </div>
    </div>
  );
}

function Tag({ label, color, solid }: { label: string; color: string; solid?: boolean }) {
  return <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 6, fontWeight: 700, background: solid ? color : `${color}1a`, color: solid ? "#fff" : color, textTransform: "uppercase" }}>{label}</span>;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

const emptyStyle: React.CSSProperties = { background: "#fff", borderRadius: 12, border: "1px solid rgba(0,0,0,0.06)", display: "flex", alignItems: "center", justifyContent: "center" };
const selectStyle: React.CSSProperties = {
  padding: "5px 8px",
  fontSize: 12,
  borderRadius: 6,
  border: "1px solid rgba(0,0,0,0.1)",
  background: "#fff",
  cursor: "pointer",
};
