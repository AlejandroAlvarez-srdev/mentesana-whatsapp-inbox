// /admin/inbox-v2/pipelines — lista de familias detectadas con conteos.
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Family = {
  family: string;
  display_name: string;
  total_phases: number;
  template_by_phase: Record<string, string>;
  category: string;
  is_active: boolean;
  stats: { total: number; assigned: number; unassigned: number; phases: Record<string, number> };
};

type TaskCounts = { open: number; in_progress: number; done: number; from_ceo_open: number; total: number };
type AssignedCounts = { total: number; open: number; in_progress: number; done: number; by_type: Record<string, number> };

export default function PipelinesIndex() {
  const [families, setFamilies] = useState<Family[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [taskCounts, setTaskCounts] = useState<TaskCounts | null>(null);
  const [assignedByMe, setAssignedByMe] = useState<AssignedCounts | null>(null);

  useEffect(() => {
    fetch("/api/admin/inbox-v2/pipelines/families")
      .then((r) => r.json())
      .then((j) => { setFamilies(j.families ?? []); setLoading(false); })
      .catch((e) => { setErr(String(e)); setLoading(false); });

    fetch("/api/agent/my-tasks", { credentials: "include" })
      .then((r) => r.json())
      .then((j) => {
        const tasks = (j.tasks ?? []) as Array<{ status: string; from_ceo?: boolean }>;
        const c: TaskCounts = { open: 0, in_progress: 0, done: 0, from_ceo_open: 0, total: tasks.length };
        for (const t of tasks) {
          if (t.status === "open") c.open += 1;
          else if (t.status === "in_progress") c.in_progress += 1;
          else if (t.status === "done") c.done += 1;
          if (t.from_ceo && t.status !== "done" && t.status !== "cancelled") c.from_ceo_open += 1;
        }
        setTaskCounts(c);
      })
      .catch(() => { /* sin tareas o sin sesión, no rompe el índice */ });

    // Solo admin/CEO/CTO recibe 200; el resto recibe 403 y este tile no se monta.
    fetch("/api/ceo/all-tasks?limit=500", { credentials: "include" })
      .then(async (r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j) return;
        const tasks = (j.tasks ?? []) as Array<{ status: string; assignee_type: string }>;
        const c: AssignedCounts = { total: tasks.length, open: 0, in_progress: 0, done: 0, by_type: {} };
        for (const t of tasks) {
          if (t.status === "open") c.open += 1;
          else if (t.status === "in_progress") c.in_progress += 1;
          else if (t.status === "done") c.done += 1;
          if (t.status !== "done" && t.status !== "cancelled") {
            c.by_type[t.assignee_type] = (c.by_type[t.assignee_type] ?? 0) + 1;
          }
        }
        setAssignedByMe(c);
      })
      .catch(() => { /* no admin, no tile */ });
  }, []);

  const TYPE_LABEL: Record<string, string> = {
    agent: "🤝 Agentes",
    psicologa: "🧠 Psicólogas",
    videomaker: "🎬 Video",
    jefe: "👩‍💼 Jefe psi",
    traficker: "📊 Traficker",
  };

  return (
    <div style={{ padding: "24px", maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 4 }}>Pipelines por plantilla</h1>
        <p style={{ fontSize: 13, color: "#64748b" }}>
          Detectados automáticamente a partir de las fases en los nombres de plantilla. Al mover una card a una nueva fase,
          se dispara el envío de la plantilla correspondiente.
        </p>
      </div>

      {err && <div style={{ padding: 12, background: "#fef2f2", color: "#991b1b", borderRadius: 8 }}>{err}</div>}
      {loading && <div style={{ color: "#94a3b8" }}>Cargando…</div>}

      {/* Tile destacado: tareas asignadas (CEO + cualquier panel) */}
      {taskCounts && taskCounts.total > 0 && (
        <Link
          href="/admin/inbox-v2/pipelines/tasks"
          style={{
            display: "block",
            padding: 18,
            background: taskCounts.from_ceo_open > 0
              ? "linear-gradient(135deg, #6A178C, #8B2FB5)"
              : "linear-gradient(135deg, #1e293b, #334155)",
            borderRadius: 14,
            textDecoration: "none",
            color: "#fff",
            marginBottom: 18,
            boxShadow: "0 6px 18px rgba(106,23,140,0.25)",
            transition: "transform 0.15s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, opacity: 0.85, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700 }}>
                {taskCounts.from_ceo_open > 0 ? "👑 Tareas del CEO pendientes" : "📋 Tus tareas"}
              </div>
              <h3 style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}>
                {taskCounts.open + taskCounts.in_progress} pendientes
                {taskCounts.from_ceo_open > 0 && (
                  <span style={{ fontSize: 14, marginLeft: 10, opacity: 0.85 }}>
                    · {taskCounts.from_ceo_open} del CEO
                  </span>
                )}
              </h3>
            </div>
            <div style={{ display: "flex", gap: 16, fontSize: 12, fontWeight: 600 }}>
              <div style={{ textAlign: "center" }}><div style={{ fontSize: 18, fontWeight: 800 }}>{taskCounts.open}</div><div style={{ opacity: 0.7, fontSize: 10 }}>PENDIENTES</div></div>
              <div style={{ textAlign: "center" }}><div style={{ fontSize: 18, fontWeight: 800 }}>{taskCounts.in_progress}</div><div style={{ opacity: 0.7, fontSize: 10 }}>EN CURSO</div></div>
              <div style={{ textAlign: "center" }}><div style={{ fontSize: 18, fontWeight: 800 }}>{taskCounts.done}</div><div style={{ opacity: 0.7, fontSize: 10 }}>COMPLETADAS</div></div>
            </div>
          </div>
        </Link>
      )}

      {/* Tile CEO: tareas que él asignó (vista de control) */}
      {assignedByMe && assignedByMe.total > 0 && (
        <Link
          href="/ceo/board"
          style={{
            display: "block",
            padding: 18,
            background: "linear-gradient(135deg, #4a0e63, #6A178C)",
            borderRadius: 14,
            textDecoration: "none",
            color: "#fff",
            marginBottom: 18,
            boxShadow: "0 6px 18px rgba(74,14,99,0.3)",
            transition: "transform 0.15s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, opacity: 0.85, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700 }}>
                👑 Tareas que asigné
              </div>
              <h3 style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}>
                {assignedByMe.open + assignedByMe.in_progress} en marcha
                <span style={{ fontSize: 14, marginLeft: 10, opacity: 0.85 }}>
                  · {assignedByMe.done} cerradas
                </span>
              </h3>
              <div style={{ display: "flex", gap: 14, marginTop: 8, fontSize: 12, flexWrap: "wrap" }}>
                {Object.entries(assignedByMe.by_type)
                  .sort(([, a], [, b]) => b - a)
                  .map(([k, v]) => (
                    <span key={k} style={{ background: "rgba(255,255,255,0.18)", padding: "3px 10px", borderRadius: 999, fontWeight: 600 }}>
                      {TYPE_LABEL[k] ?? k}: {v}
                    </span>
                  ))}
              </div>
            </div>
            <div style={{ display: "flex", gap: 16, fontSize: 12, fontWeight: 600 }}>
              <div style={{ textAlign: "center" }}><div style={{ fontSize: 18, fontWeight: 800 }}>{assignedByMe.open}</div><div style={{ opacity: 0.7, fontSize: 10 }}>PENDIENTES</div></div>
              <div style={{ textAlign: "center" }}><div style={{ fontSize: 18, fontWeight: 800 }}>{assignedByMe.in_progress}</div><div style={{ opacity: 0.7, fontSize: 10 }}>EN CURSO</div></div>
              <div style={{ textAlign: "center" }}><div style={{ fontSize: 18, fontWeight: 800 }}>{assignedByMe.done}</div><div style={{ opacity: 0.7, fontSize: 10 }}>COMPLETADAS</div></div>
            </div>
          </div>
        </Link>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
        {families.map((f) => {
          const phaseEntries = Array.from({ length: f.total_phases }, (_, i) => {
            const p = String(i + 1);
            return [p, f.stats.phases[p] ?? 0] as [string, number];
          });
          const respondedCount = f.stats.phases["-1"] ?? 0;
          const wonCount = f.stats.phases["-2"] ?? 0;
          const lostCount = f.stats.phases["-3"] ?? 0;
          return (
            <Link
              key={f.family}
              href={`/admin/inbox-v2/pipelines/${f.family}`}
              style={{
                display: "block",
                padding: 16,
                background: "#fff",
                border: "1px solid #e2e8f0",
                borderRadius: 12,
                textDecoration: "none",
                color: "inherit",
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#6A178C"; e.currentTarget.style.transform = "translateY(-2px)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#e2e8f0"; e.currentTarget.style.transform = "translateY(0)"; }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: "#6A178C" }}>{f.display_name}</h3>
                <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>{f.total_phases} fases</span>
              </div>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 12 }}>{f.stats.total} contactos</div>

              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 10 }}>
                {phaseEntries.map(([p, n]) => (
                  <div
                    key={p}
                    style={{
                      flex: "1 1 auto",
                      minWidth: 32,
                      textAlign: "center",
                      padding: "4px 6px",
                      background: n > 0 ? "rgba(106,23,140,0.08)" : "#f8fafc",
                      borderRadius: 6,
                      fontSize: 11,
                    }}
                  >
                    <div style={{ fontWeight: 700, color: n > 0 ? "#6A178C" : "#cbd5e1" }}>{n}</div>
                    <div style={{ fontSize: 9, color: "#94a3b8", textTransform: "uppercase" }}>F{p}</div>
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", gap: 8, fontSize: 11, color: "#64748b" }}>
                {respondedCount > 0 && <span>💬 {respondedCount}</span>}
                {wonCount > 0 && <span style={{ color: "#16a34a" }}>✅ {wonCount}</span>}
                {lostCount > 0 && <span style={{ color: "#dc2626" }}>❌ {lostCount}</span>}
                {f.stats.unassigned > 0 && <span style={{ marginLeft: "auto" }}>👤 sin asignar: {f.stats.unassigned}</span>}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
