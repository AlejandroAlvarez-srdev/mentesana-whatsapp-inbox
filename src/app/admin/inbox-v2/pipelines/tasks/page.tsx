// /admin/inbox-v2/pipelines/tasks — kanban de tareas del agente logueado.
// Las tareas del CEO (from_ceo=true) salen primero — el endpoint /api/agent/my-tasks
// las ordena así. Reusa MyTasksKanban (mismo componente que el panel agente normal).
"use client";

import Link from "next/link";
import MyTasksKanban from "@/components/MyTasksKanban";

export default function PipelineTasksPage() {
  return (
    <div style={{ padding: "16px 20px", maxWidth: 1400, margin: "0 auto" }}>
      <div style={{ marginBottom: 14 }}>
        <Link href="/admin/inbox-v2/pipelines" style={{ fontSize: 12, color: "#94a3b8", textDecoration: "none" }}>
          ← todos los pipelines
        </Link>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: "#6A178C", marginTop: 2 }}>
          📋 Mis tareas
        </h1>
        <p style={{ fontSize: 12, color: "#64748b" }}>
          Tareas asignadas por el CEO o por cualquier panel del CRM. Las del CEO aparecen primero.
        </p>
      </div>
      <MyTasksKanban api="/api/agent/my-tasks" title="Tareas pendientes" />
    </div>
  );
}
