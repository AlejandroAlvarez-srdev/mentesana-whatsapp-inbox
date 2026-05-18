"use client";

import { useEffect, useState } from "react";

const PURPLE = "#6A178C";

type Tag = { id: string; name: string; color: string; description: string | null; created_at?: string; updated_at?: string };
type QR = { id: string; title: string; content: string; shortcut: string | null; category: string | null; is_active: boolean; usage_count: number; created_at?: string; updated_at?: string };

type Tab = "tags" | "quick-replies";

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("quick-replies");

  return (
    <div style={{ maxWidth: 1100 }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "#1a1a2e", margin: 0 }}>⚙️ Ajustes del inbox</h1>
        <p style={{ color: "#888", fontSize: 13, marginTop: 6 }}>Gestiona las plantillas rápidas y las etiquetas que aparecen en el inbox.</p>
      </header>

      <div style={{ display: "flex", gap: 4, marginBottom: 14, borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
        <TabBtn cur={tab} v="quick-replies" set={setTab} label="⚡ Quick replies" />
        <TabBtn cur={tab} v="tags" set={setTab} label="🏷️ Tags" />
      </div>

      {tab === "quick-replies" && <QuickRepliesSection />}
      {tab === "tags" && <TagsSection />}
    </div>
  );
}

function TabBtn({ cur, v, set, label }: { cur: Tab; v: Tab; set: (v: Tab) => void; label: string }) {
  const active = cur === v;
  return (
    <button onClick={() => set(v)} style={{ padding: "10px 16px", fontSize: 13, fontWeight: 600, background: active ? "#fff" : "transparent", color: active ? PURPLE : "#666", border: "none", borderBottom: active ? `2px solid ${PURPLE}` : "2px solid transparent", marginBottom: -1, cursor: "pointer" }}>{label}</button>
  );
}

// ============================================
// QUICK REPLIES
// ============================================
function QuickRepliesSection() {
  const [items, setItems] = useState<QR[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<QR | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ title: "", content: "", shortcut: "", category: "general", is_active: true });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const r = await fetch("/api/admin/inbox-v2/quick-replies-crud", { credentials: "include" });
    const d = await r.json();
    setItems(d.quick_replies ?? []);
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);

  function openCreate() {
    setEditing(null);
    setForm({ title: "", content: "", shortcut: "", category: "general", is_active: true });
    setErr(null);
    setModalOpen(true);
  }
  function openEdit(qr: QR) {
    setEditing(qr);
    setForm({ title: qr.title, content: qr.content, shortcut: qr.shortcut ?? "", category: qr.category ?? "general", is_active: qr.is_active });
    setErr(null);
    setModalOpen(true);
  }
  async function save() {
    setSubmitting(true);
    setErr(null);
    try {
      const url = editing ? `/api/admin/inbox-v2/quick-replies-crud/${encodeURIComponent(editing.id)}` : "/api/admin/inbox-v2/quick-replies-crud";
      const method = editing ? "PATCH" : "POST";
      const r = await fetch(url, { method, credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      if (!r.ok) { setErr((await r.text()).slice(0, 200)); return; }
      setModalOpen(false);
      await load();
    } finally { setSubmitting(false); }
  }
  async function remove(qr: QR) {
    if (!confirm(`Borrar quick reply "${qr.title}"?`)) return;
    await fetch(`/api/admin/inbox-v2/quick-replies-crud/${encodeURIComponent(qr.id)}`, { method: "DELETE", credentials: "include" });
    await load();
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: "#888" }}>{items.length} respuestas rápidas</span>
        <button onClick={openCreate} style={{ marginLeft: "auto", padding: "8px 14px", background: PURPLE, color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>➕ Nueva</button>
      </div>

      {loading ? <div style={{ color: "#888" }}>Cargando…</div> : (
        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid rgba(0,0,0,0.06)", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead style={{ background: "rgba(0,0,0,0.02)" }}>
              <tr>
                <Th>Shortcut</Th>
                <Th>Título</Th>
                <Th>Preview</Th>
                <Th right>Uso</Th>
                <Th>Activo</Th>
                <Th>Acciones</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((qr) => (
                <tr key={qr.id} style={{ borderBottom: "1px solid rgba(0,0,0,0.04)", opacity: qr.is_active ? 1 : 0.5 }}>
                  <Td><code style={{ background: "rgba(106,23,140,0.06)", color: PURPLE, padding: "2px 8px", borderRadius: 4, fontSize: 11 }}>{qr.shortcut ?? "—"}</code></Td>
                  <Td><strong>{qr.title}</strong></Td>
                  <Td><span style={{ color: "#888", fontSize: 12 }}>{qr.content.slice(0, 80)}{qr.content.length > 80 ? "…" : ""}</span></Td>
                  <Td right><strong style={{ color: PURPLE }}>×{qr.usage_count}</strong></Td>
                  <Td>{qr.is_active ? "✅" : "—"}</Td>
                  <Td>
                    <button onClick={() => openEdit(qr)} style={miniBtn}>✏️</button>
                    <button onClick={() => remove(qr)} style={{ ...miniBtn, color: "#dc2626" }}>🗑</button>
                  </Td>
                </tr>
              ))}
              {items.length === 0 && <tr><td colSpan={6} style={{ padding: 30, textAlign: "center", color: "#aaa" }}>Sin quick replies</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <Modal title={editing ? "Editar quick reply" : "Nueva quick reply"} onClose={() => setModalOpen(false)} onSubmit={save} submitting={submitting} err={err}>
          <Field label="Shortcut" hint="ej. /pagos · si lo dejas vacío no aparece con /">
            <input type="text" value={form.shortcut} onChange={(e) => setForm({ ...form, shortcut: e.target.value })} placeholder="/algo" style={input} />
          </Field>
          <Field label="Título" required>
            <input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="ej. Pagos a plazos" style={input} autoFocus />
          </Field>
          <Field label="Contenido" required hint="texto que se inserta en el composer">
            <textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} rows={8} style={{ ...input, fontFamily: "inherit", resize: "vertical", minHeight: 140 }} />
          </Field>
          <Field label="Categoría">
            <input type="text" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="general" style={input} />
          </Field>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> Activa (aparece en el dropdown)
          </label>
        </Modal>
      )}
    </div>
  );
}

// ============================================
// TAGS
// ============================================
function TagsSection() {
  const [items, setItems] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Tag | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ name: "", color: "#888888", description: "" });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const r = await fetch("/api/admin/inbox-v2/tags-crud", { credentials: "include" });
    const d = await r.json();
    setItems(d.tags ?? []);
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);

  function openCreate() {
    setEditing(null);
    setForm({ name: "", color: "#888888", description: "" });
    setErr(null);
    setModalOpen(true);
  }
  function openEdit(t: Tag) {
    setEditing(t);
    setForm({ name: t.name, color: t.color, description: t.description ?? "" });
    setErr(null);
    setModalOpen(true);
  }
  async function save() {
    setSubmitting(true);
    setErr(null);
    try {
      const url = editing ? `/api/admin/inbox-v2/tags-crud/${encodeURIComponent(editing.id)}` : "/api/admin/inbox-v2/tags-crud";
      const method = editing ? "PATCH" : "POST";
      const r = await fetch(url, { method, credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      if (!r.ok) { setErr((await r.text()).slice(0, 200)); return; }
      setModalOpen(false);
      await load();
    } finally { setSubmitting(false); }
  }
  async function remove(t: Tag) {
    if (!confirm(`Borrar tag "${t.name}"?\n\nSe quitará de TODOS los leads que la tengan asignada.`)) return;
    await fetch(`/api/admin/inbox-v2/tags-crud/${encodeURIComponent(t.id)}`, { method: "DELETE", credentials: "include" });
    await load();
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: "#888" }}>{items.length} tags</span>
        <button onClick={openCreate} style={{ marginLeft: "auto", padding: "8px 14px", background: PURPLE, color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>➕ Nuevo</button>
      </div>

      {loading ? <div style={{ color: "#888" }}>Cargando…</div> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 10 }}>
          {items.map((t) => (
            <div key={t.id} style={{ background: "#fff", borderRadius: 10, padding: 14, border: `1px solid ${t.color}55`, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 16, height: 16, borderRadius: 4, background: t.color }} />
                <strong style={{ fontSize: 14, color: "#1a1a2e", flex: 1 }}>{t.name}</strong>
              </div>
              {t.description && <p style={{ fontSize: 11, color: "#888", margin: 0 }}>{t.description}</p>}
              <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                <button onClick={() => openEdit(t)} style={miniBtn}>✏️ Editar</button>
                <button onClick={() => remove(t)} style={{ ...miniBtn, color: "#dc2626" }}>🗑 Borrar</button>
              </div>
            </div>
          ))}
          {items.length === 0 && <div style={{ color: "#aaa", padding: 20, gridColumn: "1 / -1", textAlign: "center" }}>Sin tags</div>}
        </div>
      )}

      {modalOpen && (
        <Modal title={editing ? "Editar tag" : "Nuevo tag"} onClose={() => setModalOpen(false)} onSubmit={save} submitting={submitting} err={err}>
          <Field label="Nombre" required>
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="ej. VIP" style={input} autoFocus />
          </Field>
          <Field label="Color" required>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} style={{ width: 60, height: 38, border: "1px solid rgba(0,0,0,0.1)", borderRadius: 6 }} />
              <input type="text" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} style={{ ...input, fontFamily: "ui-monospace, monospace" }} />
            </div>
          </Field>
          <Field label="Descripción">
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} style={{ ...input, resize: "vertical", fontFamily: "inherit" }} />
          </Field>
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, onClose, onSubmit, submitting, err, children }: { title: string; onClose: () => void; onSubmit: () => void; submitting: boolean; err: string | null; children: React.ReactNode }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 14, padding: 22, width: "min(540px, 100%)", maxHeight: "90vh", overflowY: "auto" }}>
        <h3 style={{ margin: "0 0 14px", fontSize: 17, fontWeight: 700, color: "#1a1a2e" }}>{title}</h3>
        <div style={{ display: "grid", gap: 10 }}>{children}</div>
        {err && <div style={{ marginTop: 12, padding: 9, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, color: "#991b1b", fontSize: 12 }}>{err}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button onClick={onClose} disabled={submitting} style={{ padding: "10px 16px", background: "transparent", color: "#666", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>Cancelar</button>
          <button onClick={onSubmit} disabled={submitting} style={{ flex: 1, padding: "10px 16px", background: PURPLE, color: "#fff", border: "none", borderRadius: 8, cursor: submitting ? "default" : "pointer", fontSize: 13, fontWeight: 700, opacity: submitting ? 0.6 : 1 }}>
            {submitting ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "grid", gap: 4 }}>
      <span style={{ fontSize: 11, color: "#888", fontWeight: 700, letterSpacing: 0.3, textTransform: "uppercase" }}>{label}{required && <span style={{ color: "#dc2626" }}> *</span>}</span>
      {children}
      {hint && <span style={{ fontSize: 10, color: "#aaa" }}>{hint}</span>}
    </label>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th style={{ textAlign: right ? "right" : "left", padding: "10px 14px", fontWeight: 700, color: "#666", fontSize: 10, letterSpacing: 0.3, textTransform: "uppercase" }}>{children}</th>;
}
function Td({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <td style={{ padding: "10px 14px", textAlign: right ? "right" : "left" }}>{children}</td>;
}

const input: React.CSSProperties = { width: "100%", padding: "8px 12px", border: "1px solid rgba(0,0,0,0.12)", borderRadius: 8, fontSize: 13, outline: "none", boxSizing: "border-box" };
const miniBtn: React.CSSProperties = { padding: "4px 8px", fontSize: 11, background: "transparent", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 5, cursor: "pointer", marginRight: 4 };
