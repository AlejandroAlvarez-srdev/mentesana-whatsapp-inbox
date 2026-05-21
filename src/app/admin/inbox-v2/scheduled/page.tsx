"use client";

// Lista de plantillas Meta programadas (pending/sent/failed/canceled).
// Permite cancelar pendientes.
import { useEffect, useState } from "react";
import Link from "next/link";
import { fmtMadridDateTime } from "../_components/_time";

const PURPLE = "#6A178C";

type Row = {
  id: string;
  template_name: string;
  language: string;
  from_number: string;
  scope: "single" | "bulk";
  conversation_id: string | null;
  phones: string[] | null;
  recipients: any[] | null;
  scheduled_for: string;
  status: "pending" | "sent" | "failed" | "canceled";
  sent_at: string | null;
  attempts: number;
  last_error: string | null;
  result: any;
  notes: string | null;
  created_at: string;
};

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  pending: { bg: "#fef3c7", fg: "#92400e", label: "⏳ Pendiente" },
  sent: { bg: "#dcfce7", fg: "#065f46", label: "✅ Enviada" },
  failed: { bg: "#fee2e2", fg: "#991b1b", label: "❌ Fallida" },
  canceled: { bg: "#e5e7eb", fg: "#374151", label: "⊘ Cancelada" },
};

export default function ScheduledTemplatesPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "pending" | "sent" | "failed" | "canceled">("pending");

  async function load() {
    setLoading(true);
    const qs = filter === "all" ? "" : `?status=${filter}`;
    const r = await fetch(`/api/admin/inbox-v2/scheduled-templates${qs}`, { credentials: "include" });
    const j = await r.json().catch(() => ({ scheduled: [] }));
    setRows(j.scheduled ?? []);
    setLoading(false);
  }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filter]);

  async function cancel(id: string) {
    if (!confirm("¿Cancelar este envío programado?")) return;
    await fetch(`/api/admin/inbox-v2/scheduled-templates/${id}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cancel: true }) });
    void load();
  }
  async function remove(id: string) {
    if (!confirm("¿Borrar definitivamente?")) return;
    await fetch(`/api/admin/inbox-v2/scheduled-templates/${id}`, { method: "DELETE", credentials: "include" });
    void load();
  }

  return (
    <div style={{ padding: "20px 24px", maxWidth: 1280, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <Link href="/admin/inbox-v2" style={{ fontSize: 13, color: PURPLE, textDecoration: "none", fontWeight: 700 }}>← Inbox</Link>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#1a1a2e" }}>📅 Plantillas programadas</h1>
        <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          {(["pending", "sent", "failed", "canceled", "all"] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              padding: "6px 12px", borderRadius: 999, border: "none",
              background: filter === f ? PURPLE : "rgba(0,0,0,0.05)",
              color: filter === f ? "#fff" : "#666",
              fontSize: 12, fontWeight: 700, cursor: "pointer", textTransform: "capitalize",
            }}>{f === "all" ? "Todas" : STATUS_STYLE[f]?.label ?? f}</button>
          ))}
        </div>
      </header>

      {loading && <p style={{ color: "#666" }}>Cargando…</p>}
      {!loading && rows.length === 0 && <p style={{ color: "#666", padding: 30, textAlign: "center", background: "#fff", borderRadius: 12 }}>Nada programado en este filtro.</p>}

      <div style={{ display: "grid", gap: 10 }}>
        {rows.map(r => {
          const s = STATUS_STYLE[r.status] ?? { bg: "#eee", fg: "#666", label: r.status };
          const targetCount = r.scope === "single" ? 1 : (r.recipients?.length ?? r.phones?.length ?? 0);
          return (
            <div key={r.id} style={{ padding: 14, background: "#fff", borderRadius: 12, border: "1px solid rgba(0,0,0,0.06)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
                <span style={{ padding: "3px 9px", borderRadius: 6, background: s.bg, color: s.fg, fontSize: 11, fontWeight: 800 }}>{s.label}</span>
                <strong style={{ fontSize: 14 }}>{r.template_name}</strong>
                <span style={{ fontSize: 11, color: "#666" }}>· {r.language}</span>
                <span style={{ fontSize: 11, color: "#666" }}>· {r.scope === "single" ? "1 conversación" : `${targetCount} contactos`}</span>
                <span style={{ marginLeft: "auto", fontSize: 12, color: "#1a1a2e", fontWeight: 700 }}>
                  ⏰ {fmtMadridDateTime(r.scheduled_for)}
                </span>
              </div>
              <div style={{ fontSize: 11, color: "#888", display: "flex", gap: 12, flexWrap: "wrap" }}>
                <span>📱 desde {r.from_number}</span>
                {r.attempts > 0 && <span>↻ {r.attempts} intento{r.attempts === 1 ? "" : "s"}</span>}
                {r.sent_at && <span>✓ enviada {fmtMadridDateTime(r.sent_at)}</span>}
                {r.last_error && <span style={{ color: "#991b1b" }} title={r.last_error}>⚠ {r.last_error.slice(0, 60)}</span>}
                {r.notes && <span style={{ fontStyle: "italic" }}>📝 {r.notes}</span>}
              </div>
              {r.status === "pending" && (
                <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
                  <button onClick={() => cancel(r.id)} style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #fde68a", background: "#fef3c7", color: "#92400e", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Cancelar</button>
                  <button onClick={() => remove(r.id)} style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #fecaca", background: "#fee2e2", color: "#991b1b", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Borrar</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
