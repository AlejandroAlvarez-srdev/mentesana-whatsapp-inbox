"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useConversationsRealtime } from "../_hooks/useInboxRealtime";

const PURPLE = "#6A178C";

export type ConvSummary = {
  id: string;
  phone: string;
  lead_name: string | null;
  source: string | null;
  pipeline_type: string | null;
  status: string | null;
  purchase_status: string | null;
  paid_at: string | null;
  purchase_amount: number | null;
  assigned_psychologist_name: string | null;
  last_message_time: string | null;
  last_message: string | null;
  unread_count: number | null;
  created_at: string | null;
};

type Mode = "list" | "search";

export default function ConversationList({
  selectedId,
  onSelect,
  apiBase = "/api/admin/inbox-v2",
}: {
  selectedId: string | null;
  onSelect: (c: ConvSummary) => void;
  apiBase?: string;
}) {
  const PAGE_SIZE = 30;
  const [mode, setMode] = useState<Mode>("list");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<ConvSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pipelineFilter, setPipelineFilter] = useState<"" | "ventas" | "soporte">("");
  const [numberFilter, setNumberFilter] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [waNumbers, setWaNumbers] = useState<{ phone_number_id: string; name: string; phone_number: string | null }[]>([]);
  const debounceRef = useRef<number | null>(null);
  const reqIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const preserveScrollRef = useRef<number | null>(null);

  useEffect(() => {
    fetch(`${apiBase}/whatsapp-numbers`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { numbers: [] }))
      .then((d) => setWaNumbers((d.numbers ?? []).filter((n: any) => !n.is_pdf_number)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadList(q: string, opts?: { append?: boolean; silent?: boolean }) {
    const append = opts?.append === true;
    const silent = opts?.silent === true;
    // Capturar scroll antes de cualquier update (para restaurar en polling/append)
    if ((silent || append) && scrollRef.current) {
      preserveScrollRef.current = scrollRef.current.scrollTop;
    }
    if (abortRef.current) abortRef.current.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const myReqId = ++reqIdRef.current;
    if (!silent) setLoading(true);
    setErr(null);
    try {
      // Búsqueda semántica solo en primera página, no se pagina
      if (q.trim().startsWith("?")) {
        setMode("search");
        const url = `${apiBase}/search?q=${encodeURIComponent(q.slice(1).trim())}&topK=25`;
        const r = await fetch(url, { credentials: "include", signal: ac.signal });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        if (reqIdRef.current !== myReqId) return;
        const mapped: ConvSummary[] = (d.results ?? []).map((x: any) => ({
          id: x.conversation_id, phone: x.phone ?? "", lead_name: x.lead_name ?? null,
          source: null, pipeline_type: null, status: null,
          purchase_status: x.purchase_status ?? null, paid_at: x.paid_at ?? null,
          purchase_amount: null, assigned_psychologist_name: null,
          last_message_time: x.last_message_time ?? null,
          last_message: x.similarity ? `🔍 similitud ${(x.similarity * 100).toFixed(0)}%` : null,
          unread_count: null, created_at: null,
        }));
        setItems(mapped); setTotal(mapped.length);
        return;
      }

      setMode("list");
      const offset = append ? items.length : 0;
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (q.trim()) params.set("search", q.trim());
      if (pipelineFilter) params.set("pipeline", pipelineFilter);
      if (numberFilter) params.set("phone_number_id", numberFilter);
      if (unreadOnly) params.set("unread", "true");
      const r = await fetch(`${apiBase}/conversations?${params}`, { credentials: "include", signal: ac.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      if (reqIdRef.current !== myReqId) return;
      if (append) {
        const existing = new Set(items.map((c) => c.id));
        const newOnes = (d.conversations ?? []).filter((c: any) => !existing.has(c.id));
        setItems([...items, ...newOnes]);
      } else {
        setItems(d.conversations ?? []);
      }
      setTotal(d.total ?? 0);
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      if (reqIdRef.current === myReqId) setErr(String(e.message ?? e));
    } finally {
      if (reqIdRef.current === myReqId && !silent) setLoading(false);
    }
  }

  // Debounced search / filter changes — reset y primera página
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => { void loadList(query); }, 250);
    return () => { if (debounceRef.current) window.clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, pipelineFilter, numberFilter, unreadOnly]);

  // Infinite scroll: cuando el sentinel entra en viewport, carga la siguiente página
  useEffect(() => {
    if (!sentinelRef.current) return;
    if (items.length === 0 || items.length >= total || loading || mode === "search") return;
    const io = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) void loadList(query, { append: true, silent: true }); },
      { rootMargin: "200px 0px" },
    );
    io.observe(sentinelRef.current);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length, total, loading, mode]);

  // Restaurar scroll después de re-render si fue marcado para preservar
  useLayoutEffect(() => {
    if (preserveScrollRef.current != null && scrollRef.current) {
      scrollRef.current.scrollTop = preserveScrollRef.current;
      preserveScrollRef.current = null;
    }
  }, [items]);

  // Polling silent — refresca actualizando IN PLACE (preserva scroll, no reordena items existentes).
  // Solo añade conversaciones nuevas que no estaban y actualiza unread_count / last_message de las existentes.
  async function silentRefresh() {
    if (mode === "search") return;
    if (abortRef.current) abortRef.current.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      // Pedimos tantos items como ya tenemos cargados (para que conserve toda la lista visible)
      const lim = Math.max(PAGE_SIZE, items.length);
      const params = new URLSearchParams({ limit: String(lim), offset: "0" });
      if (query.trim() && !query.startsWith("?")) params.set("search", query.trim());
      if (pipelineFilter) params.set("pipeline", pipelineFilter);
      if (numberFilter) params.set("phone_number_id", numberFilter);
      if (unreadOnly) params.set("unread", "true");
      const r = await fetch(`${apiBase}/conversations?${params}`, { credentials: "include", signal: ac.signal });
      if (!r.ok) return;
      const d = await r.json();
      const fresh: ConvSummary[] = d.conversations ?? [];
      const total: number = d.total ?? fresh.length;
      // Merge in place: conservar orden actual, actualizar unread_count / last_message si cambió, añadir nuevos al inicio
      setItems((prev) => {
        const freshById = new Map(fresh.map((c) => [c.id, c]));
        const prevIds = new Set(prev.map((c) => c.id));
        // Actualizar in place los que ya estaban
        const merged = prev.map((c) => freshById.get(c.id) ?? c);
        // Añadir los nuevos (que no estaban) al principio en el orden que vienen
        const newOnes = fresh.filter((c) => !prevIds.has(c.id));
        return newOnes.length > 0 ? [...newOnes, ...merged] : merged;
      });
      setTotal(total);
    } catch { /* ignore */ }
  }

  useEffect(() => {
    if (mode === "search") return;
    let interval = 6000;
    let iv: any = setInterval(silentRefresh, interval);
    const onVis = () => {
      const ni = document.hidden ? 20000 : 6000;
      if (ni !== interval) { interval = ni; clearInterval(iv); iv = setInterval(silentRefresh, ni); if (!document.hidden) void silentRefresh(); }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(iv); document.removeEventListener("visibilitychange", onVis); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, pipelineFilter, numberFilter, unreadOnly, mode, items.length]);

  // Realtime: cuando una conversación cambia (nuevo mensaje del lead, status,
  // unread_count, asignación), refrescamos la lista actual sin recargar todo
  // el panel. Para evitar storms cuando llega un burst, debounce 500 ms.
  const realtimeDebounceRef = useRef<number | null>(null);
  useConversationsRealtime({
    onChange: () => {
      if (mode === "search") return;
      if (realtimeDebounceRef.current) window.clearTimeout(realtimeDebounceRef.current);
      realtimeDebounceRef.current = window.setTimeout(() => {
        void loadList(query);
      }, 500);
    },
  });

  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 14,
        border: "1px solid rgba(0,0,0,0.06)",
        boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        overflow: "hidden",
        width: "100%",
      }}
    >
      <style>{`
        .ms-conv-row:hover { background: rgba(106,23,140,0.04) !important; }
      `}</style>
      <div style={{ padding: 12, borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder='Buscar por nombre/tel/texto · "?" para búsqueda semántica'
          style={{
            width: "100%",
            padding: "8px 12px",
            border: "1px solid #e5e5e5",
            borderRadius: 8,
            fontSize: 13,
            outline: "none",
            boxSizing: "border-box",
          }}
        />
        <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
          <PipelinePill v="" cur={pipelineFilter} set={setPipelineFilter} label="Todas" />
          <PipelinePill v="ventas" cur={pipelineFilter} set={setPipelineFilter} label="Ventas" />
          <PipelinePill v="soporte" cur={pipelineFilter} set={setPipelineFilter} label="Soporte" />
          <button
            type="button"
            onClick={() => setUnreadOnly((v) => !v)}
            style={{
              padding: "3px 10px", fontSize: 11, fontWeight: 700, borderRadius: 6, border: "none", cursor: "pointer",
              background: unreadOnly ? "#dc2626" : "rgba(220,38,38,0.1)",
              color: unreadOnly ? "#fff" : "#991b1b",
            }}
            title="Solo conversaciones sin responder"
          >
            🔴 Sin responder
          </button>
          <span style={{ marginLeft: "auto", fontSize: 11, color: "#888" }}>
            {loading && items.length === 0 ? "…" : `${items.length}${total ? ` / ${total.toLocaleString()}` : ""}`}
          </span>
        </div>
        {waNumbers.length > 1 && (
          <select
            value={numberFilter}
            onChange={(e) => setNumberFilter(e.target.value)}
            style={{ width: "100%", marginTop: 6, padding: "5px 8px", fontSize: 11, border: "1px solid rgba(0,0,0,0.1)", borderRadius: 6, background: numberFilter ? "rgba(106,23,140,0.06)" : "#fff" }}
          >
            <option value="">📱 Todos los números</option>
            {waNumbers.map((n) => (
              <option key={n.phone_number_id} value={n.phone_number_id}>{n.name?.trim()} {n.phone_number ? `· ${n.phone_number}` : ""}</option>
            ))}
          </select>
        )}
      </div>
      {err && (
        <div style={{ padding: 10, fontSize: 12, color: "#900", background: "#fee", borderBottom: "1px solid #fcc" }}>{err}</div>
      )}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto" }}>
        {items.length === 0 && !loading && (
          <div style={{ padding: 24, textAlign: "center", color: "#aaa", fontSize: 12 }}>Sin resultados</div>
        )}
        {items.length === 0 && loading && (
          <div style={{ padding: "20px 14px", display: "grid", gap: 6 }}>
            {Array.from({ length: 8 }).map((_, i) => <div key={i} className="skel" style={{ height: 56, borderRadius: 8 }} />)}
          </div>
        )}
        {items.map((c) => (
          <ConvRow key={c.id} c={c} selected={c.id === selectedId} onClick={() => onSelect(c)} />
        ))}
        {items.length > 0 && items.length < total && mode === "list" && (
          <div ref={sentinelRef} style={{ padding: "12px 14px", textAlign: "center", color: "#aaa", fontSize: 11 }}>
            {loading ? "Cargando más…" : `Cargando ${(total - items.length).toLocaleString("es-ES")} más…`}
          </div>
        )}
        {items.length > 0 && items.length >= total && mode === "list" && (
          <div style={{ padding: "12px 14px", textAlign: "center", color: "#bbb", fontSize: 10, fontStyle: "italic" }}>
            ✓ Todas las conversaciones cargadas
          </div>
        )}
      </div>
    </div>
  );
}

function PipelinePill({
  v,
  cur,
  set,
  label,
}: {
  v: "" | "ventas" | "soporte";
  cur: string;
  set: (v: "" | "ventas" | "soporte") => void;
  label: string;
}) {
  const active = v === cur;
  return (
    <button
      type="button"
      onClick={() => set(v)}
      style={{
        padding: "3px 10px",
        fontSize: 11,
        fontWeight: 600,
        borderRadius: 6,
        border: "none",
        cursor: "pointer",
        background: active ? PURPLE : "rgba(0,0,0,0.04)",
        color: active ? "#fff" : "#666",
      }}
    >
      {label}
    </button>
  );
}

function ConvRow({ c, selected, onClick }: { c: ConvSummary; selected: boolean; onClick: () => void }) {
  const isPaid = c.purchase_status === "pagado" || c.paid_at != null || c.status === "pagado";
  const hasUnread = (c.unread_count ?? 0) > 0;
  const initials = getInitials(c.lead_name || c.phone || "?");
  const avatarBg = colorFromString(c.lead_name || c.phone || "");
  return (
    <button
      onClick={onClick}
      className="ms-conv-row"
      style={{
        width: "100%",
        textAlign: "left",
        padding: "12px 14px",
        background: selected ? "rgba(106,23,140,0.07)" : "transparent",
        borderLeft: selected ? `3px solid ${PURPLE}` : "3px solid transparent",
        border: "none",
        borderBottom: "1px solid rgba(0,0,0,0.04)",
        cursor: "pointer",
        display: "flex",
        gap: 11,
        alignItems: "flex-start",
        transition: "background 0.12s",
      }}
    >
      <div
        style={{
          width: 38,
          height: 38,
          borderRadius: "50%",
          background: avatarBg,
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 13,
          fontWeight: 700,
          flexShrink: 0,
          letterSpacing: 0.3,
        }}
      >
        {initials}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
          <span
            style={{
              fontWeight: hasUnread ? 700 : 600,
              fontSize: 13.5,
              color: "#1a1a2e",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
              letterSpacing: -0.1,
            }}
          >
            {c.lead_name?.trim() || c.phone || "(sin nombre)"}
          </span>
          {c.last_message_time && (
            <span style={{ fontSize: 10, color: hasUnread ? PURPLE : "#aaa", fontWeight: hasUnread ? 700 : 500, flexShrink: 0 }}>
              {fmtRel(c.last_message_time)}
            </span>
          )}
        </div>
        <div
          style={{
            fontSize: 11.5,
            color: hasUnread ? "#444" : "#888",
            fontWeight: hasUnread ? 600 : 400,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            marginBottom: 3,
          }}
        >
          {c.last_message ?? "—"}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {isPaid && <Chip color={PURPLE} solid>€ PAGÓ</Chip>}
          {c.status === "nuevo" && <Chip color="#2563eb">NUEVO</Chip>}
          {hasUnread && <Chip color={PURPLE} solid>{c.unread_count}</Chip>}
          {!isPaid && c.status && c.status !== "nuevo" && <Chip color="#64748b">{c.status}</Chip>}
        </div>
      </div>
    </button>
  );
}

function Chip({ color, solid, children }: { color: string; solid?: boolean; children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 9.5,
        padding: "1px 7px",
        borderRadius: 4,
        fontWeight: 700,
        background: solid ? color : `${color}1a`,
        color: solid ? "#fff" : color,
        textTransform: "uppercase",
        letterSpacing: 0.3,
      }}
    >
      {children}
    </span>
  );
}

function getInitials(name: string): string {
  const cleaned = name.trim().replace(/^\+?\d+/, "?");
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function colorFromString(s: string): string {
  const palette = ["#6A178C", "#2563eb", "#0891b2", "#059669", "#d97706", "#dc2626", "#7c3aed", "#0284c7", "#65a30d", "#c026d3"];
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return palette[Math.abs(h) % palette.length];
}

// Hora siempre en horario España (Europe/Madrid) — nunca "ahora" / "now"
function fmtRel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const tz = "Europe/Madrid";
  const sameDay = d.toLocaleDateString("es-ES", { timeZone: tz }) === now.toLocaleDateString("es-ES", { timeZone: tz });
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const isYesterday = d.toLocaleDateString("es-ES", { timeZone: tz }) === yesterday.toLocaleDateString("es-ES", { timeZone: tz });
  const hhmm = d.toLocaleTimeString("es-ES", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
  if (sameDay) return hhmm;
  if (isYesterday) return `ayer ${hhmm}`;
  const diffDays = Math.floor((now.getTime() - d.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays < 7) {
    const dow = d.toLocaleDateString("es-ES", { timeZone: tz, weekday: "short" }).replace(".", "");
    return `${dow} ${hhmm}`;
  }
  return d.toLocaleDateString("es-ES", { timeZone: tz, day: "2-digit", month: "short" }) + ` ${hhmm}`;
}
