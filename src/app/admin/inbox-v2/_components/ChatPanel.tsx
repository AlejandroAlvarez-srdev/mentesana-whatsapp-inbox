"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import TemplatesModal from "./TemplatesModal";
import WindowBadge, { WindowInfo, fmtMinutesLeft, colorFor } from "./WindowBadge";
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
  const [waNumbers, setWaNumbers] = useState<{ phone_number_id: string; name: string; phone_number: string | null; is_default: boolean; is_pdf_number: boolean }[]>([]);
  const [assignedNumber, setAssignedNumber] = useState<{ name: string; phone_number_id: string; phone_number: string | null } | null>(null);
  const [windowInfo, setWindowInfo] = useState<WindowInfo | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastMsgTsRef = useRef<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMoreOlder, setHasMoreOlder] = useState(true);
  const [savingSale, setSavingSale] = useState(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);

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
    lastScrollHeightRef.current = 0; // reset → fuerza scroll al fondo al cargar la nueva conv
    setHasMoreOlder(true);
    void loadFull();
  }, [conversationId, loadFull]);

  // Listener para que ProfileTab (en InsightsPanel) pueda disparar acciones del header
  useEffect(() => {
    if (!conversationId) return;
    const onOpenPayment = (e: Event) => {
      const ev = e as CustomEvent<{ conversationId: string }>;
      if (ev.detail?.conversationId === conversationId) setPaymentModalOpen(true);
    };
    const onMarkSold = (e: Event) => {
      const ev = e as CustomEvent<{ conversationId: string }>;
      if (ev.detail?.conversationId === conversationId) void markAsSold();
    };
    window.addEventListener("inbox:open-payment", onOpenPayment as EventListener);
    window.addEventListener("inbox:mark-sold", onMarkSold as EventListener);
    return () => {
      window.removeEventListener("inbox:open-payment", onOpenPayment as EventListener);
      window.removeEventListener("inbox:mark-sold", onMarkSold as EventListener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  // Load auxiliaries once
  useEffect(() => {
    Promise.all([
      fetch(`${apiBase}/agents`, { credentials: "include" }).then((r) => (r.ok ? r.json() : { agents: [] })),
      fetch(`${apiBase}/tags`, { credentials: "include" }).then((r) => (r.ok ? r.json() : { tags: [] })),
      fetch(`${apiBase}/psychologists`, { credentials: "include" }).then((r) => (r.ok ? r.json() : { psychologists: [] })),
      fetch(`${apiBase}/quick-replies`, { credentials: "include" }).then((r) => (r.ok ? r.json() : { quick_replies: [] })),
      fetch(`${apiBase}/whatsapp-numbers`, { credentials: "include" }).then((r) => (r.ok ? r.json() : { numbers: [] })),
    ]).then(([a, g, p, q, n]) => {
      setAgents(a.agents ?? []);
      setTags(g.tags ?? []);
      setPsychologists(p.psychologists ?? []);
      setQuickReplies(q.quick_replies ?? []);
      setWaNumbers((n.numbers ?? []).filter((x: any) => !x.is_pdf_number));
    });
  }, []);

  // Cuando cambia la conversación, leer el número asignado (vía lead-profile) + ventana 24h
  useEffect(() => {
    if (!conversationId) { setAssignedNumber(null); setWindowInfo(null); return; }
    fetch(`${apiBase}/conversations/${encodeURIComponent(conversationId)}/lead-profile`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setAssignedNumber(d?.assigned_wa_number ?? null));
    fetch(`${apiBase}/conversations/${encodeURIComponent(conversationId)}/window`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setWindowInfo(d ?? null));
  }, [conversationId, apiBase, messages.length]);

  async function assignNumber(phoneNumberId: string) {
    if (!conversationId) return;
    const r = await fetch(`${apiBase}/conversations/${encodeURIComponent(conversationId)}/assign-number`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone_number_id: phoneNumberId }),
    });
    if (r.ok) {
      const d = await r.json();
      const n = waNumbers.find((x) => x.phone_number_id === phoneNumberId);
      setAssignedNumber({ name: n?.name ?? d.assigned?.name ?? "?", phone_number_id: phoneNumberId, phone_number: n?.phone_number ?? null });
    } else {
      const t = await r.text();
      setErr(`Asignar número: ${t.slice(0, 200)}`);
    }
  }

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

  // Polling activo cada 4s (backup fiable si el WebSocket de Realtime no engancha).
  // Si la pestaña está oculta, sube a 15s para ahorrar batería.
  useEffect(() => {
    if (!conversationId) return;
    let interval = 4000;
    const tick = async () => {
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
    };
    let iv: any = setInterval(tick, interval);
    const onVis = () => {
      const newInterval = document.hidden ? 15000 : 4000;
      if (newInterval !== interval) {
        interval = newInterval;
        clearInterval(iv);
        iv = setInterval(tick, interval);
        if (!document.hidden) void tick(); // refresca al volver a la pestaña
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(iv); document.removeEventListener("visibilitychange", onVis); };
  }, [conversationId, apiBase]);

  // Older messages endpoint: deriva de apiBase
  // /api/admin/inbox-v2  → /api/admin/inbox-v2-messages-older
  // /api/agent/inbox     → /api/agent/inbox-messages-older
  const olderEndpoint = apiBase.includes("/agent/")
    ? "/api/agent/inbox-messages-older"
    : "/api/admin/inbox-v2-messages-older";

  async function loadOlderMessages() {
    if (!conversationId || loadingOlder || !hasMoreOlder || messages.length === 0) return;
    const before = messages[0].timestamp;
    const el = scrollRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    const prevTop = el?.scrollTop ?? 0;
    setLoadingOlder(true);
    try {
      const r = await fetch(`${olderEndpoint}?conv=${encodeURIComponent(conversationId)}&before=${encodeURIComponent(before)}&limit=80`, { credentials: "include" });
      if (!r.ok) return;
      const d = await r.json();
      const older: Message[] = d.messages ?? [];
      if (older.length === 0) { setHasMoreOlder(false); return; }
      setMessages((prev) => {
        const existing = new Set(prev.map((m) => m.id));
        const fresh = older.filter((m) => !existing.has(m.id));
        return [...fresh, ...prev];
      });
      setHasMoreOlder(d.has_more === true);
      // Preservar posición de scroll: tras el re-render, scrollTop = nuevaAltura - oldHeight + oldTop
      requestAnimationFrame(() => {
        if (!el) return;
        el.scrollTop = el.scrollHeight - prevHeight + prevTop;
      });
    } finally {
      setLoadingOlder(false);
    }
  }

  // Reset hasMoreOlder cuando cambia conv
  useEffect(() => { setHasMoreOlder(true); }, [conversationId]);

  // Marcar como vendida — pide importe y guarda
  async function markAsSold() {
    if (!conversationId || savingSale) return;
    const input = window.prompt("Importe de la venta en € (deja vacío si no lo sabes):", "");
    if (input === null) return; // canceló
    const amount = input.trim() ? Number(input.trim().replace(",", ".")) : null;
    if (amount != null && (isNaN(amount) || amount < 0)) {
      alert("Importe inválido");
      return;
    }
    setSavingSale(true);
    try {
      await patchConv({
        status: "pagado",
        purchase_status: "pagado",
        purchase_amount: amount,
        paid_at: new Date().toISOString(),
      } as any);
    } finally {
      setSavingSale(false);
    }
  }

  // Auto-scroll al fondo del chat — SOLO si el usuario ya estaba cerca del fondo (no rompe lectura).
  const lastScrollHeightRef = useRef(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    // Si estaba cerca del fondo (<120px) o es la carga inicial, hace scroll al fondo
    if (distanceFromBottom < 120 || lastScrollHeightRef.current === 0) {
      el.scrollTop = el.scrollHeight;
    }
    lastScrollHeightRef.current = el.scrollHeight;
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
    <div style={{ background: "#fff", borderRadius: 14, border: "1px solid rgba(0,0,0,0.06)", boxShadow: "0 1px 3px rgba(0,0,0,0.02)", display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden", width: "100%" }}>
      {/* Header compacto — solo cliente / psicólogo / agente. Resto (nombre, email, status, cobrar, vendida) viven en el tab Perfil del panel derecho */}
      <div style={{ padding: "10px 14px", borderBottom: "1px solid rgba(0,0,0,0.06)", display: "flex", alignItems: "center", gap: 10, flexWrap: "nowrap", overflowX: "auto" }}>
        {/* Tipo cliente · toggle ventas / soporte */}
        <div style={{ display: "flex", flexDirection: "column", gap: 3, flexShrink: 0 }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 0.4 }}>Tipo</span>
          <div style={{ display: "flex", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 8, overflow: "hidden" }} title="Tipo de conversación">
            <button
              type="button"
              onClick={() => patchConv({ client_type: "ventas" } as any)}
              style={{
                padding: "5px 9px",
                fontSize: 11,
                fontWeight: 700,
                border: "none",
                cursor: "pointer",
                background: (conv as any).client_type === "ventas" ? PURPLE : "#fff",
                color: (conv as any).client_type === "ventas" ? "#fff" : "#475569",
              }}
            >💼 Ventas</button>
            <button
              type="button"
              onClick={() => patchConv({ client_type: "soporte" } as any)}
              style={{
                padding: "5px 9px",
                fontSize: 11,
                fontWeight: 700,
                border: "none",
                borderLeft: "1px solid rgba(0,0,0,0.08)",
                cursor: "pointer",
                background: (conv as any).client_type === "soporte" ? "#0891b2" : "#fff",
                color: (conv as any).client_type === "soporte" ? "#fff" : "#475569",
              }}
            >🛟 Soporte</button>
          </div>
        </div>

        {/* Psicóloga */}
        <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: "1 1 200px", minWidth: 160 }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 0.4 }}>Psicóloga</span>
          <select
            value={(conv as any).assigned_psychologist ?? ""}
            onChange={(e) => {
              const psyId = e.target.value || null;
              const psy = psychologists.find((p) => p.id === psyId);
              patchConv({ assigned_psychologist: psyId, assigned_psychologist_name: psy?.name ?? null } as any);
            }}
            style={{ ...selectStyle, width: "100%" }}
            title="Psicóloga asignada"
          >
            <option value="">— sin asignar —</option>
            {psychologists.map((p) => {
              const full = p.current_patients != null && p.max_patients != null && p.current_patients >= p.max_patients;
              return (
                <option key={p.id} value={p.id} disabled={!p.is_accepting_patients}>
                  {p.name?.trim()}{p.specialty ? ` · ${p.specialty}` : ""}{full ? " ⚠️" : ""}
                </option>
              );
            })}
          </select>
        </div>

        {/* Agente */}
        <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: "1 1 180px", minWidth: 140 }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 0.4 }}>Agente</span>
          <select
            value={conv.assigned_to ?? ""}
            onChange={(e) => patchConv({ assigned_to: e.target.value || null })}
            style={{ ...selectStyle, width: "100%" }}
            title="Agente asignado"
          >
            <option value="">— sin asignar —</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name?.trim()} {a.agent_type ? `· ${a.agent_type}` : ""}
              </option>
            ))}
          </select>
        </div>

        {/* Indicador pagó (read-only, sutil) */}
        {(conv.purchase_status === "pagado" || conv.paid_at || conv.status === "pagado") && (
          <span
            style={{
              padding: "5px 9px",
              fontSize: 10.5,
              fontWeight: 800,
              borderRadius: 6,
              background: "rgba(16,185,129,0.14)",
              color: "#065f46",
              letterSpacing: 0.4,
              flexShrink: 0,
              alignSelf: "flex-end",
            }}
            title={`Pagó ${conv.purchase_amount ?? ""}€ ${conv.paid_at ? `el ${new Date(conv.paid_at).toLocaleDateString("es-ES")}` : ""}`}
          >
            ✅ {conv.purchase_amount ? `${conv.purchase_amount}€` : "PAGÓ"}
          </span>
        )}
      </div>

      {/* Banner del número asignado — memoria persistente del routing */}
      <div style={{ padding: "6px 14px", background: assignedNumber ? "rgba(16,185,129,0.06)" : "#fef3c7", borderBottom: "1px solid rgba(0,0,0,0.04)", display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
        {assignedNumber ? (
          <>
            <span style={{ color: "#065f46", fontWeight: 700 }}>📲 Enviando y recibiendo en:</span>
            <strong style={{ color: "#065f46" }}>{assignedNumber.name?.trim()}</strong>
            {assignedNumber.phone_number && <span style={{ color: "#888" }}>· {assignedNumber.phone_number}</span>}
            <span style={{ marginLeft: 4, fontSize: 9, fontFamily: "ui-monospace, monospace", color: "#aaa" }}>{assignedNumber.phone_number_id}</span>
          </>
        ) : (
          <>
            <span style={{ color: "#92400e", fontWeight: 700 }}>⚠️ Esta conversación no tiene número asignado</span>
            <span style={{ color: "#92400e" }}>· se enviará desde el default · asígnalo →</span>
          </>
        )}
        <select
          value={assignedNumber?.phone_number_id ?? ""}
          onChange={(e) => { const v = e.target.value; if (v && v !== assignedNumber?.phone_number_id) void assignNumber(v); }}
          style={{ marginLeft: "auto", padding: "3px 8px", fontSize: 11, border: "1px solid rgba(0,0,0,0.1)", borderRadius: 5, background: "#fff", cursor: "pointer" }}
          title="Cambiar número (queda guardado en conversation_routing + kv_store)"
        >
          <option value="">— cambiar número —</option>
          {waNumbers.map((n) => (
            <option key={n.phone_number_id} value={n.phone_number_id}>
              {n.name?.trim()}{n.phone_number ? ` · ${n.phone_number}` : ""}{n.is_default ? " · default" : ""}
            </option>
          ))}
        </select>
      </div>

      {/* Banner ventana 24h */}
      {windowInfo && (
        <WindowBanner info={windowInfo} />
      )}

      {/* messages */}
      <div
        ref={scrollRef}
        onScroll={(e) => {
          // Si el usuario se acerca al top (<60px) y aún quedan mensajes viejos → cargar más
          if (e.currentTarget.scrollTop < 60 && hasMoreOlder && !loadingOlder && messages.length > 0) {
            void loadOlderMessages();
          }
        }}
        style={{ flex: 1, overflowY: "auto", padding: "16px 14px", background: "#FAFAFA" }}
      >
        {hasMoreOlder && messages.length > 0 && (
          <div style={{ textAlign: "center", padding: "6px 0", fontSize: 11, color: "#888" }}>
            {loadingOlder ? "⏳ Cargando mensajes anteriores…" : "⬆ Scrollea arriba para ver más"}
          </div>
        )}
        {!hasMoreOlder && messages.length > 20 && (
          <div style={{ textAlign: "center", padding: "6px 0", fontSize: 10, color: "#bbb", fontStyle: "italic" }}>
            ✓ Inicio de la conversación
          </div>
        )}
        {messages.length === 0 && <div style={{ textAlign: "center", color: "#aaa", fontSize: 12, padding: 30 }}>Sin mensajes.</div>}
        {messages.map((m) => <Bubble key={m.id} m={m} apiBase={apiBase} />)}
      </div>

      {/* Compose */}
      <Composer
        onSend={send}
        onOpenTemplates={() => setTplOpen(true)}
        quickReplies={quickReplies}
        onSendMedia={async (file, caption) => {
          if (!conversationId) return;
          const fd = new FormData();
          fd.append("file", file);
          if (caption) fd.append("caption", caption);
          const r = await fetch(`${apiBase}/conversations/${encodeURIComponent(conversationId)}/send-media`, {
            method: "POST",
            credentials: "include",
            body: fd,
          });
          if (!r.ok) {
            const txt = await r.text();
            setErr(`Error: ${txt.slice(0, 200)}`);
            return;
          }
          await loadFull();
        }}
      />
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

      {paymentModalOpen && conversationId && (
        <PaymentLinkModal
          conversationId={conversationId}
          leadName={conv.lead_name}
          onClose={() => setPaymentModalOpen(false)}
          onSent={() => { setPaymentModalOpen(false); void loadFull(); }}
        />
      )}

    </div>
  );
}

function Composer({ onSend, onOpenTemplates, quickReplies, onSendMedia }: { onSend: (text: string) => Promise<void>; onOpenTemplates: () => void; quickReplies: QuickReply[]; onSendMedia: (file: File, caption: string | null) => Promise<void> }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrQuery, setQrQuery] = useState("");
  const [qrIdx, setQrIdx] = useState(0);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleAttach(file: File) {
    setPendingFile(file);
  }
  async function sendPendingMedia() {
    if (!pendingFile || uploadingMedia) return;
    setUploadingMedia(true);
    try {
      await onSendMedia(pendingFile, text.trim() || null);
      setPendingFile(null);
      setText("");
    } finally {
      setUploadingMedia(false);
    }
  }

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
      {pendingFile && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", marginBottom: 8, background: `${PURPLE}0d`, border: `1px solid ${PURPLE}33`, borderRadius: 8 }}>
          <span style={{ fontSize: 22 }}>{pendingFile.type.startsWith("image/") ? "🖼️" : pendingFile.type.startsWith("video/") ? "🎬" : pendingFile.type.startsWith("audio/") ? "🎙️" : "📄"}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#1a1a2e", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pendingFile.name}</div>
            <div style={{ fontSize: 10, color: "#888" }}>{(pendingFile.size / 1024).toFixed(0)} KB · {pendingFile.type}</div>
          </div>
          <button onClick={() => setPendingFile(null)} style={{ background: "transparent", border: "none", color: "#888", cursor: "pointer", fontSize: 16 }}>×</button>
          <button onClick={sendPendingMedia} disabled={uploadingMedia} style={{ padding: "6px 14px", background: PURPLE, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
            {uploadingMedia ? "Enviando…" : "Enviar archivo"}
          </button>
        </div>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*,audio/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleAttach(f);
            if (e.target) e.target.value = "";
          }}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          title="Adjuntar imagen, vídeo, audio o documento"
          style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.1)", background: "#fff", cursor: "pointer", fontSize: 16 }}
        >
          📎
        </button>
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

function resolveMediaUrl(rawUrl: string | null, apiBase: string): string | null {
  if (!rawUrl) return null;
  if (rawUrl.startsWith("storage://")) {
    // Detecta si es admin o agent path
    const resolver = apiBase.includes("/agent/")
      ? "/api/agent/inbox-media-resolver"
      : "/api/admin/inbox-v2-media-resolver";
    return `${resolver}?url=${encodeURIComponent(rawUrl)}`;
  }
  return rawUrl;
}

function Bubble({ m, apiBase }: { m: Message; apiBase: string }) {
  const isLead = m.is_lead;
  const align = isLead ? "flex-start" : "flex-end";
  const bg = isLead ? "#fff" : m.is_psychologist ? "rgba(106,23,140,0.12)" : "linear-gradient(135deg, #6A178C 0%, #8b2dad 100%)";
  const border = isLead ? "1px solid rgba(0,0,0,0.06)" : "none";
  const textColor = !isLead && !m.is_psychologist ? "#fff" : "#1a1a2e";
  const radius = isLead ? "14px 14px 14px 4px" : "14px 14px 4px 14px";
  const mediaSrc = resolveMediaUrl(m.media_url, apiBase);

  return (
    <div style={{ display: "flex", justifyContent: align, marginBottom: 10 }}>
      <div
        style={{
          maxWidth: "min(78%, 520px)",
          background: bg,
          border,
          borderRadius: radius,
          padding: "9px 13px",
          boxShadow: isLead ? "0 1px 2px rgba(0,0,0,0.04)" : "0 2px 8px rgba(106,23,140,0.15)",
          color: textColor,
        }}
      >
        {!isLead && (
          <div style={{ fontSize: 9.5, color: m.is_psychologist ? PURPLE : "rgba(255,255,255,0.85)", fontWeight: 700, marginBottom: 3, letterSpacing: 0.4, textTransform: "uppercase" }}>
            {m.is_psychologist ? "Psicóloga" : m.sender_name || m.sender || "Agente"}
            {m.is_template && m.template_name && <span style={{ marginLeft: 6, opacity: 0.8, fontWeight: 500, textTransform: "none" }}>· template: {m.template_name}</span>}
          </div>
        )}
        {mediaSrc && (m.media_type === "image" || m.media_type === "sticker") && <img src={mediaSrc} alt="media" style={{ marginBottom: 6, maxWidth: 280, borderRadius: 6, display: "block" }} />}
        {mediaSrc && m.media_type === "video" && <video src={mediaSrc} controls style={{ marginBottom: 6, maxWidth: 280, borderRadius: 6, display: "block" }} />}
        {mediaSrc && m.media_type === "audio" && <audio src={mediaSrc} controls style={{ marginBottom: 6, maxWidth: 280, display: "block" }} />}
        {mediaSrc && m.media_type === "document" && (
          <a href={mediaSrc} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", marginBottom: 6, background: "rgba(0,0,0,0.04)", borderRadius: 6, textDecoration: "none", color: "#1a1a2e" }}>
            <span style={{ fontSize: 20 }}>📄</span>
            <span style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(m as any).media_filename ?? "Documento"}</span>
            <span style={{ marginLeft: "auto", fontSize: 10, color: "#888" }}>↓</span>
          </a>
        )}
        {/* Mostrar content solo si NO es un placeholder de media ([image] / [video] / [audio] / [sticker] / [document] / "📎 ...") */}
        {(() => {
          const content = m.content?.trim() ?? "";
          const isPlaceholder = /^(\[image\]|\[video\]|\[audio\]|\[sticker\]|\[document\]|📎\s)/i.test(content);
          if (mediaSrc && isPlaceholder) return null; // media ya renderizado, no duplicar texto
          if (!content && !mediaSrc) return <div style={{ fontSize: 13.5, color: textColor, opacity: 0.5 }}>—</div>;
          return content ? <div style={{ fontSize: 13.5, lineHeight: 1.45, color: textColor, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{content}</div> : null;
        })()}
        <div style={{ fontSize: 9.5, color: isLead || m.is_psychologist ? "#aaa" : "rgba(255,255,255,0.7)", marginTop: 4, textAlign: "right", fontWeight: 500 }}>
          {fmtTime(m.timestamp)}
          {m.status && <span> · {m.status}</span>}
        </div>
      </div>
    </div>
  );
}

function PaymentLinkModal({
  conversationId,
  leadName,
  onClose,
  onSent,
}: {
  conversationId: string;
  leadName: string | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const [amount, setAmount] = useState("9.99");
  const [description, setDescription] = useState(`Sesión MenteSana${leadName ? ` · ${leadName.trim()}` : ""}`);
  const [sendByWhatsapp, setSendByWhatsapp] = useState(true);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  async function create() {
    const eur = Number(amount.replace(",", "."));
    if (!eur || isNaN(eur) || eur < 1) { setErr("Importe inválido (mínimo 1€)"); return; }
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch("/api/agent/inbox-payment-link", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount_eur: eur,
          description,
          conversation_id: conversationId,
          send: sendByWhatsapp,
        }),
      });
      const d = await r.json();
      if (!r.ok) { setErr(d.detail || d.error || `HTTP ${r.status}`); return; }
      setResult(d);
      if (sendByWhatsapp) setTimeout(onSent, 1500);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(26,26,46,0.5)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#FFFAF2", borderRadius: 16, width: "min(440px, 100%)", maxHeight: "90vh", overflow: "auto", boxShadow: "0 24px 80px rgba(0,0,0,0.25)" }}>
        <header style={{ padding: "16px 20px", background: "linear-gradient(135deg, #635bff 0%, #4f46e5 100%)", color: "#fff", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 22 }}>💳</span>
          <strong style={{ fontSize: 16 }}>Generar link de pago</strong>
          <button onClick={onClose} style={{ marginLeft: "auto", background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", width: 30, height: 30, borderRadius: 8, fontSize: 18, cursor: "pointer" }}>×</button>
        </header>

        {result ? (
          <div style={{ padding: 20 }}>
            <div style={{ padding: 14, background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 10, fontSize: 13, color: "#065f46", marginBottom: 14 }}>
              ✅ Link creado{result.sent?.ok ? " y enviado por WhatsApp" : ""}
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", marginBottom: 4 }}>Link público:</div>
            <a href={result.payment_link.url} target="_blank" rel="noopener noreferrer" style={{ display: "block", padding: 10, background: "#fff", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 8, fontSize: 11, fontFamily: "ui-monospace, monospace", color: "#635bff", wordBreak: "break-all", textDecoration: "none", marginBottom: 14 }}>
              {result.payment_link.url}
            </a>
            <button
              onClick={() => navigator.clipboard.writeText(result.payment_link.url)}
              style={{ width: "100%", padding: "10px 14px", background: "#1a1a2e", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
            >📋 Copiar link</button>
          </div>
        ) : (
          <div style={{ padding: 20, display: "grid", gap: 14 }}>
            <label style={{ display: "grid", gap: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 0.5 }}>Importe (€)</span>
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                style={{ padding: "12px 14px", fontSize: 22, fontWeight: 700, color: "#1a1a2e", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 10, fontFamily: "inherit", outline: "none", background: "#fff" }}
              />
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 0.5 }}>Descripción</span>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                style={{ padding: "10px 12px", fontSize: 13, border: "1px solid rgba(0,0,0,0.1)", borderRadius: 8, fontFamily: "inherit", outline: "none", background: "#fff" }}
              />
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer", padding: 10, background: "rgba(106,23,140,0.04)", borderRadius: 8 }}>
              <input type="checkbox" checked={sendByWhatsapp} onChange={(e) => setSendByWhatsapp(e.target.checked)} style={{ accentColor: "#6A178C" }} />
              <span style={{ fontSize: 12.5 }}>Enviar el link por WhatsApp al lead automáticamente</span>
            </label>
            {err && <div style={{ padding: 10, background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", fontSize: 12, borderRadius: 8 }}>{err}</div>}
            <button
              onClick={create}
              disabled={loading}
              style={{
                padding: "12px 20px",
                background: loading ? "rgba(0,0,0,0.1)" : "linear-gradient(135deg, #635bff 0%, #4f46e5 100%)",
                color: "#fff",
                border: "none",
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 800,
                cursor: loading ? "default" : "pointer",
                fontFamily: "inherit",
                boxShadow: loading ? "none" : "0 4px 14px rgba(99,91,255,0.35)",
                letterSpacing: 0.3,
              }}
            >
              {loading ? "⏳ Generando link…" : `💳 Crear link${sendByWhatsapp ? " + enviar" : ""}`}
            </button>
            <div style={{ fontSize: 10.5, color: "#aaa", textAlign: "center" }}>
              Link Stripe Checkout · pago seguro · queda registrado en eventos de la conv
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function EditableField({
  value,
  placeholder,
  fontSize,
  weight,
  color,
  prefix,
  onSave,
}: {
  value: string;
  placeholder: string;
  fontSize: number;
  weight: number;
  color: string;
  prefix?: string;
  onSave: (v: string) => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { setEditing(false); if (draft !== value) void onSave(draft); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
          if (e.key === "Escape") { setDraft(value); setEditing(false); }
        }}
        placeholder={placeholder}
        style={{
          fontSize,
          fontWeight: weight,
          color,
          padding: "1px 6px",
          border: `1px solid ${PURPLE}`,
          borderRadius: 6,
          outline: "none",
          background: "#fff",
          fontFamily: "inherit",
          minWidth: 80,
          maxWidth: 280,
        }}
      />
    );
  }

  const display = value.trim() || placeholder;
  const isPlaceholder = !value.trim();
  return (
    <span
      onClick={() => setEditing(true)}
      title="Click para editar"
      style={{
        fontSize,
        fontWeight: weight,
        color: isPlaceholder ? "#bbb" : color,
        cursor: "pointer",
        padding: "1px 5px",
        borderRadius: 4,
        borderBottom: "1px dashed transparent",
        transition: "all 0.12s",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(106,23,140,0.05)"; e.currentTarget.style.borderBottomColor = `${PURPLE}66`; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderBottomColor = "transparent"; }}
    >
      {prefix ? `${prefix} ` : ""}{display}
    </span>
  );
}

function Tag({ label, color, solid }: { label: string; color: string; solid?: boolean }) {
  return <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 6, fontWeight: 700, background: solid ? color : `${color}1a`, color: solid ? "#fff" : color, textTransform: "uppercase" }}>{label}</span>;
}

// Siempre hora España (Europe/Madrid)
function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("es-ES", { timeZone: "Europe/Madrid", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
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

function WindowBanner({ info }: { info: WindowInfo }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (info.window_status === "open" || info.window_status === "expiring_soon") {
      const iv = setInterval(() => setTick((t) => t + 1), 30000);
      return () => clearInterval(iv);
    }
  }, [info.window_status]);

  const live = info.expires_at ? Math.max(0, Math.floor((new Date(info.expires_at).getTime() - Date.now()) / 60000)) : null;
  const c = colorFor(info.window_status);

  let cta: React.ReactNode = null;
  if (info.window_status === "expiring_soon") {
    cta = <span style={{ marginLeft: 8, fontSize: 11, color: c.fg, fontWeight: 600 }}>💡 Generá la estrategia urgente abajo (tú redactás el mensaje) →</span>;
  } else if (info.window_status === "expired") {
    cta = <span style={{ marginLeft: 8, fontSize: 11, color: c.fg, fontWeight: 600 }}>📋 Solo plantillas Meta pueden reactivar esta conversación</span>;
  }

  return (
    <div style={{ padding: "6px 14px", background: c.bg, borderBottom: `1px solid ${c.border}`, display: "flex", alignItems: "center", gap: 10, fontSize: 11.5 }}>
      <span style={{ color: c.fg, fontWeight: 700 }}>{c.label}</span>
      {info.expires_at && info.window_status !== "expired" && info.window_status !== "never_inbound" && (
        <>
          <span style={{ color: c.fg }}>· quedan <strong>{fmtMinutesLeft(live)}</strong></span>
          <span style={{ color: c.fg, opacity: 0.7 }}>· expira {new Date(info.expires_at).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
        </>
      )}
      {info.window_status === "expired" && info.last_inbound_at && (
        <span style={{ color: c.fg, opacity: 0.7 }}>· última inbound {new Date(info.last_inbound_at).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
      )}
      {cta}
    </div>
  );
}
