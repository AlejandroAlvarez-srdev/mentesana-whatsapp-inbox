// /admin/inbox-v2/pipelines/[family] — kanban con drag-and-drop nativo.
// Al soltar una card en una nueva fase, confirma envío de plantilla y
// llama a /api/admin/inbox-v2/pipelines/cards/:id/move.
"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

type Card = {
  id: string;
  family: string;
  whatsapp: string;
  contact_name: string | null;
  conversation_id: string | null;
  current_phase: number;
  highest_phase_sent: number;
  assigned_to_email: string | null;
  last_template_sent: string | null;
  last_template_sent_at: string | null;
};

type Family = {
  family: string;
  display_name: string;
  total_phases: number;
  template_by_phase: Record<string, string>;
};

const PURPLE = "#6A178C";

const SPECIAL_COLUMNS = [
  { phase: -1, label: "💬 Respondió", color: "#0891b2" },
  { phase: -2, label: "✅ Cerró", color: "#16a34a" },
  { phase: -3, label: "❌ Perdido", color: "#94a3b8" },
];

export default function PipelineKanban() {
  const params = useParams<{ family: string }>();
  const router = useRouter();
  const family = params.family;

  const [data, setData] = useState<{ family: Family; cards: Card[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "mine" | "unassigned">("all");
  const [dragging, setDragging] = useState<Card | null>(null);
  const [confirm, setConfirm] = useState<{ card: Card; to_phase: number; template: string } | null>(null);
  const [moving, setMoving] = useState(false);

  const load = async () => {
    setLoading(true);
    const q = filter === "all" ? "" : `?filter=${filter}`;
    const r = await fetch(`/api/admin/inbox-v2/pipelines/${family}/cards${q}`);
    const j = await r.json();
    if (j.error) { alert(j.error); setLoading(false); return; }
    setData(j);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [family, filter]);

  const grouped = useMemo(() => {
    const g: Record<string, Card[]> = {};
    for (const c of data?.cards ?? []) {
      const k = String(c.current_phase);
      (g[k] ??= []).push(c);
    }
    return g;
  }, [data]);

  if (loading || !data) return <div style={{ padding: 24 }}>Cargando…</div>;

  const f = data.family;
  const phases = Array.from({ length: f.total_phases }, (_, i) => i + 1);

  async function attemptMove(card: Card, toPhase: number) {
    setMoving(true);
    try {
      const r = await fetch(`/api/admin/inbox-v2/pipelines/cards/${card.id}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to_phase: toPhase }),
      });
      const j = await r.json();
      if (!r.ok) { alert(`Error: ${j.error}\n${j.detail ?? ""}`); return; }
      if (j.fired_template) alert(`✅ Plantilla "${j.template}" enviada`);
      await load();
    } finally {
      setMoving(false);
      setConfirm(null);
    }
  }

  function onDropOnPhase(toPhase: number) {
    const card = dragging;
    setDragging(null);
    if (!card || card.current_phase === toPhase) return;

    if (toPhase < 0) {
      attemptMove(card, toPhase);
      return;
    }
    const needSend = toPhase > card.highest_phase_sent;
    if (!needSend) { attemptMove(card, toPhase); return; }
    const tpl = f.template_by_phase[String(toPhase)];
    if (!tpl) { alert(`No hay plantilla configurada para fase ${toPhase}`); return; }
    setConfirm({ card, to_phase: toPhase, template: tpl });
  }

  async function assign(card: Card, email: string | null) {
    const r = await fetch(`/api/admin/inbox-v2/pipelines/cards/${card.id}/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (!r.ok) { alert("Error al asignar"); return; }
    await load();
  }

  return (
    <div style={{ padding: "16px 20px", height: "calc(100vh - 60px)", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <Link href="/admin/inbox-v2/pipelines" style={{ fontSize: 12, color: "#94a3b8", textDecoration: "none" }}>← todos los pipelines</Link>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: PURPLE, marginTop: 2 }}>{f.display_name}</h1>
          <div style={{ fontSize: 12, color: "#64748b" }}>{data.cards.length} contactos · {f.total_phases} fases</div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {(["all", "mine", "unassigned"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              style={{
                padding: "6px 14px",
                fontSize: 12,
                fontWeight: 600,
                border: "1px solid #e2e8f0",
                background: filter === k ? PURPLE : "#fff",
                color: filter === k ? "#fff" : "#475569",
                borderRadius: 999,
                cursor: "pointer",
              }}
            >
              {k === "all" ? "Todos" : k === "mine" ? "Míos" : "Sin asignar"}
            </button>
          ))}
        </div>
      </div>

      {/* Kanban */}
      <div style={{ flex: 1, overflowX: "auto", display: "flex", gap: 10, paddingBottom: 8 }}>
        {phases.map((p) => (
          <Column
            key={p}
            label={`Fase ${p}`}
            sub={f.template_by_phase[String(p)]}
            color={PURPLE}
            cards={grouped[String(p)] ?? []}
            onDragStart={setDragging}
            onDrop={() => onDropOnPhase(p)}
            isDragOver={dragging != null && dragging.current_phase !== p}
            onAssign={assign}
          />
        ))}
        {SPECIAL_COLUMNS.map((sc) => (
          <Column
            key={sc.phase}
            label={sc.label}
            color={sc.color}
            cards={grouped[String(sc.phase)] ?? []}
            onDragStart={setDragging}
            onDrop={() => onDropOnPhase(sc.phase)}
            isDragOver={dragging != null}
            onAssign={assign}
          />
        ))}
      </div>

      {/* Modal confirmación envío */}
      {confirm && (
        <div
          onClick={() => !moving && setConfirm(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 14, padding: 24, maxWidth: 440, width: "100%" }}>
            <h3 style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>¿Enviar plantilla?</h3>
            <p style={{ fontSize: 13, color: "#475569", marginBottom: 14 }}>
              Vas a enviar <strong style={{ color: PURPLE }}>{confirm.template}</strong> a <strong>{confirm.card.contact_name ?? confirm.card.whatsapp}</strong>.
            </p>
            <div style={{ background: "#f8fafc", padding: 12, borderRadius: 8, marginBottom: 18, fontSize: 12, color: "#64748b" }}>
              📞 {confirm.card.whatsapp}<br />
              ↗️ Fase {confirm.card.current_phase} → Fase {confirm.to_phase}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setConfirm(null)} disabled={moving} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", cursor: moving ? "not-allowed" : "pointer", fontSize: 13 }}>Cancelar</button>
              <button onClick={() => attemptMove(confirm.card, confirm.to_phase)} disabled={moving} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: PURPLE, color: "#fff", cursor: moving ? "wait" : "pointer", fontSize: 13, fontWeight: 700 }}>
                {moving ? "Enviando…" : "Enviar plantilla"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Column({ label, sub, color, cards, onDragStart, onDrop, isDragOver, onAssign }: {
  label: string;
  sub?: string;
  color: string;
  cards: Card[];
  onDragStart: (c: Card) => void;
  onDrop: () => void;
  isDragOver: boolean;
  onAssign: (c: Card, email: string | null) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => { if (isDragOver) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={() => { setOver(false); onDrop(); }}
      style={{
        flex: "0 0 280px",
        background: over ? "rgba(106,23,140,0.07)" : "#f8fafc",
        border: over ? `2px dashed ${color}` : "2px dashed transparent",
        borderRadius: 12,
        padding: 10,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        maxHeight: "100%",
      }}
    >
      <div style={{ borderBottom: `2px solid ${color}`, paddingBottom: 8, marginBottom: 4 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color, display: "flex", justifyContent: "space-between" }}>
          <span>{label}</span>
          <span style={{ background: color, color: "#fff", borderRadius: 999, padding: "1px 8px", fontSize: 11 }}>{cards.length}</span>
        </div>
        {sub && <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2, fontFamily: "monospace" }}>{sub}</div>}
      </div>
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
        {cards.map((c) => <CardView key={c.id} card={c} onDragStart={onDragStart} onAssign={onAssign} />)}
      </div>
    </div>
  );
}

function CardView({ card, onDragStart, onAssign }: { card: Card; onDragStart: (c: Card) => void; onAssign: (c: Card, email: string | null) => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div
      draggable
      onDragStart={() => onDragStart(card)}
      style={{
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 8,
        padding: 10,
        cursor: "grab",
        fontSize: 12,
        boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
        position: "relative",
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 2 }}>{card.contact_name ?? "—"}</div>
      <div style={{ color: "#64748b", fontSize: 11, marginBottom: 4 }}>📞 {card.whatsapp}</div>
      {card.last_template_sent && (
        <div style={{ fontSize: 10, color: "#94a3b8", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          ↳ {card.last_template_sent}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
        <span style={{ fontSize: 10, color: card.assigned_to_email ? "#0891b2" : "#cbd5e1" }}>
          {card.assigned_to_email ? `👤 ${card.assigned_to_email.split("@")[0]}` : "sin asignar"}
        </span>
        <button onClick={() => setMenuOpen((v) => !v)} style={{ background: "none", border: "none", cursor: "pointer", color: "#94a3b8", fontSize: 14 }}>⋯</button>
      </div>
      {menuOpen && (
        <div style={{ position: "absolute", top: "100%", right: 0, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 6, zIndex: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", minWidth: 140 }}>
          <button onClick={() => { setMenuOpen(false); const e = prompt("Email a asignar (vacío = liberar)", card.assigned_to_email ?? ""); if (e !== null) onAssign(card, e || null); }} style={{ width: "100%", textAlign: "left", padding: "6px 8px", background: "none", border: "none", cursor: "pointer", fontSize: 12 }}>
            Asignar a…
          </button>
          {card.conversation_id && (
            <a href={`/admin/inbox-v2/conversations/${card.conversation_id}`} target="_blank" rel="noreferrer" style={{ display: "block", padding: "6px 8px", fontSize: 12, color: "#475569", textDecoration: "none" }}>
              Abrir conversación
            </a>
          )}
        </div>
      )}
    </div>
  );
}
