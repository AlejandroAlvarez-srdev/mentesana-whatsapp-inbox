"use client";

import { useEffect, useRef, useState } from "react";

const PURPLE = "#6A178C";

export default function ChatExtrasMenu({ conversationId, leadName, phone }: { conversationId: string; leadName: string | null; phone: string | null }) {
  const [open, setOpen] = useState(false);
  const [addingList, setAddingList] = useState(false);
  const [assigningTask, setAssigningTask] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0, alignSelf: "flex-end" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Más acciones (lista, tarea…)"
        style={{ padding: "5px 9px", fontSize: 14, fontWeight: 700, borderRadius: 8, border: "1px solid rgba(0,0,0,0.08)", background: "#fff", color: "#475569", cursor: "pointer" }}
      >⋯</button>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", right: 0, minWidth: 220, background: "#fff", borderRadius: 10, boxShadow: "0 12px 32px rgba(0,0,0,0.15)", border: "1px solid rgba(0,0,0,0.06)", zIndex: 20, overflow: "hidden" }}>
          <button onClick={() => { setOpen(false); setAddingList(true); }} style={menuItem}>
            ⭐ Añadir a lista de seguimiento
          </button>
          <button onClick={() => { setOpen(false); setAssigningTask(true); }} style={menuItem}>
            📋 Asignar tarea a un agente
          </button>
        </div>
      )}
      {addingList && (
        <AddToListModal conversationId={conversationId} leadName={leadName} phone={phone} onClose={() => setAddingList(false)} />
      )}
      {assigningTask && (
        <AssignTaskModal conversationId={conversationId} leadName={leadName} phone={phone} onClose={() => setAssigningTask(false)} />
      )}
    </div>
  );
}

function AddToListModal({ conversationId, leadName, phone, onClose }: { conversationId: string; leadName: string | null; phone: string | null; onClose: () => void }) {
  const [lists, setLists] = useState<{ id: string; name: string; emoji: string; color: string }[]>([]);
  const [pickedList, setPickedList] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [deadline, setDeadline] = useState("");
  const [priority, setPriority] = useState<"alta" | "media" | "baja" | "">("");
  const [saving, setSaving] = useState(false);
  const [creatingNew, setCreatingNew] = useState(false);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    fetch("/api/agent/follow-lists", { credentials: "include" })
      .then((r) => r.ok ? r.json() : { lists: [] })
      .then((d) => setLists(d.lists ?? []));
  }, []);

  async function createNewListAndPick() {
    if (!newName.trim()) return;
    const r = await fetch("/api/agent/follow-lists", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName, emoji: "📋", color: PURPLE }),
    });
    if (r.ok) {
      const d = await r.json();
      setLists((prev) => [d.list, ...prev]);
      setPickedList(d.list.id);
      setCreatingNew(false);
      setNewName("");
    }
  }

  async function go() {
    if (!pickedList) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/agent/follow-lists/${pickedList}/items`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversationId,
          phone, lead_name: leadName,
          notes: notes || null,
          deadline: deadline ? new Date(deadline).toISOString() : null,
          priority: priority || null,
        }),
      });
      if (r.ok) { alert("✅ Añadido a la lista"); onClose(); }
      else { const d = await r.json(); alert("Error: " + (d.error ?? r.status)); }
    } finally { setSaving(false); }
  }

  return (
    <Shell title={`⭐ Añadir a lista de seguimiento`} subtitle={leadName || phone || ""} onClose={onClose}>
      <Field label="Elegir lista">
        {creatingNew ? (
          <div style={{ display: "flex", gap: 6 }}>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nombre de la lista nueva" style={input} autoFocus />
            <button onClick={() => void createNewListAndPick()} disabled={!newName.trim()} style={btnPrimary}>+</button>
            <button onClick={() => setCreatingNew(false)} style={btnSecondary}>×</button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 6 }}>
            <select value={pickedList} onChange={(e) => setPickedList(e.target.value)} style={input}>
              <option value="">— Selecciona —</option>
              {lists.map((l) => <option key={l.id} value={l.id}>{l.emoji} {l.name}</option>)}
            </select>
            <button onClick={() => setCreatingNew(true)} style={btnSecondary}>+ nueva</button>
          </div>
        )}
      </Field>
      <Field label="Notas (opcional)"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Ej: prometió pagar hoy a las 18h" style={{ ...input, resize: "vertical" }} /></Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <Field label="Deadline"><input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} style={input} /></Field>
        <Field label="Prioridad">
          <select value={priority} onChange={(e) => setPriority(e.target.value as any)} style={input}>
            <option value="">— sin —</option>
            <option value="alta">🔥 Alta</option>
            <option value="media">🟡 Media</option>
            <option value="baja">❄️ Baja</option>
          </select>
        </Field>
      </div>
      <Footer>
        <button onClick={onClose} style={btnSecondary}>Cancelar</button>
        <button onClick={go} disabled={!pickedList || saving} style={{ ...btnPrimary, opacity: !pickedList || saving ? 0.5 : 1 }}>{saving ? "Añadiendo…" : "Añadir"}</button>
      </Footer>
    </Shell>
  );
}

function AssignTaskModal({ conversationId, leadName, phone, onClose }: { conversationId: string; leadName: string | null; phone: string | null; onClose: () => void }) {
  const [agents, setAgents] = useState<{ id: string; name: string; agent_type: string | null }[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assignTo, setAssignTo] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [priority, setPriority] = useState<"alta" | "media" | "baja">("media");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/agent/team", { credentials: "include" })
      .then((r) => r.ok ? r.json() : { agents: [] })
      .then((d) => setAgents(d.agents ?? []));
    setTitle(`Seguimiento con ${leadName?.trim() || phone || "este lead"}`);
  }, [leadName, phone]);

  async function go() {
    if (!title.trim() || !assignTo || saving) return;
    setSaving(true);
    try {
      const r = await fetch("/api/agent/inter-tasks", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title, description: description || null,
          assigned_to_agent_id: assignTo,
          related_conversation_id: conversationId,
          due_at: dueAt ? new Date(dueAt).toISOString() : null,
          priority,
        }),
      });
      if (r.ok) { alert("✅ Tarea asignada"); onClose(); }
      else { const d = await r.json(); alert("Error: " + (d.error ?? r.status)); }
    } finally { setSaving(false); }
  }

  return (
    <Shell title="📋 Asignar tarea relacionada con este lead" subtitle={leadName || phone || ""} onClose={onClose}>
      <Field label="Tarea"><input value={title} onChange={(e) => setTitle(e.target.value)} style={input} /></Field>
      <Field label="Descripción"><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} style={{ ...input, resize: "vertical" }} /></Field>
      <Field label="Asignar a">
        <select value={assignTo} onChange={(e) => setAssignTo(e.target.value)} style={input}>
          <option value="">— Selecciona agente —</option>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.name?.trim()} {a.agent_type ? `· ${a.agent_type}` : ""}</option>)}
        </select>
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <Field label="Deadline"><input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} style={input} /></Field>
        <Field label="Prioridad">
          <select value={priority} onChange={(e) => setPriority(e.target.value as any)} style={input}>
            <option value="baja">❄️ Baja</option>
            <option value="media">🟡 Media</option>
            <option value="alta">🔥 Alta</option>
          </select>
        </Field>
      </div>
      <Footer>
        <button onClick={onClose} style={btnSecondary}>Cancelar</button>
        <button onClick={go} disabled={!title.trim() || !assignTo || saving} style={{ ...btnPrimary, opacity: !title.trim() || !assignTo || saving ? 0.5 : 1 }}>{saving ? "Asignando…" : "Asignar tarea"}</button>
      </Footer>
    </Shell>
  );
}

function Shell({ title, subtitle, children, onClose }: { title: string; subtitle?: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 200 }} />
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: "min(520px,95vw)", maxHeight: "90vh", background: "#fff", borderRadius: 14, zIndex: 201, boxShadow: "0 30px 80px rgba(0,0,0,0.3)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <header style={{ padding: "12px 16px", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong style={{ fontSize: 14, color: "#1a1a2e" }}>{title}</strong>
            <button onClick={onClose} style={{ background: "transparent", border: "none", fontSize: 22, cursor: "pointer", color: "#666" }}>×</button>
          </div>
          {subtitle && <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{subtitle}</div>}
        </header>
        <div style={{ flex: 1, overflow: "auto", padding: 16 }}>{children}</div>
      </div>
    </>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div style={{ marginBottom: 10 }}><label style={{ display: "block", fontSize: 10, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>{label}</label>{children}</div>;
}
function Footer({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14, paddingTop: 12, borderTop: "1px solid rgba(0,0,0,0.06)" }}>{children}</div>;
}

const menuItem: React.CSSProperties = { display: "block", width: "100%", padding: "10px 12px", textAlign: "left", background: "#fff", border: "none", borderBottom: "1px solid rgba(0,0,0,0.04)", fontSize: 12.5, color: "#1a1a2e", cursor: "pointer", fontFamily: "inherit" };
const input: React.CSSProperties = { width: "100%", padding: "8px 10px", fontSize: 12.5, border: "1px solid rgba(0,0,0,0.1)", borderRadius: 8, fontFamily: "inherit", boxSizing: "border-box" };
const btnPrimary: React.CSSProperties = { padding: "8px 14px", fontSize: 12, fontWeight: 800, borderRadius: 8, border: "none", cursor: "pointer", background: "linear-gradient(135deg, #6A178C, #8B2FB5)", color: "#fff", fontFamily: "inherit" };
const btnSecondary: React.CSSProperties = { padding: "8px 12px", fontSize: 12, fontWeight: 700, borderRadius: 8, border: "1px solid rgba(0,0,0,0.1)", background: "#fff", color: "#475569", cursor: "pointer", fontFamily: "inherit" };
