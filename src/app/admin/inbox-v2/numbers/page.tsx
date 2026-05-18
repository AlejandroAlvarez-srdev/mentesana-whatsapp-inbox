"use client";

import { useEffect, useState } from "react";

const PURPLE = "#6A178C";

type NumberHealth = {
  phone_number_id: string;
  msgs_inbound_24h: number;
  msgs_outbound_24h: number;
  conversations_active_7d: number;
  last_inbound_at: string | null;
};

type WaNumber = {
  phone_number_id: string;
  wa_number_id: string;
  name: string;
  phone_number: string | null;
  is_default: boolean;
  status: string;
  is_pdf_number: boolean;
  business_account_id: string | null;
  access_token_preview?: string | null;
};

type FormState = {
  name: string;
  phone_number_id: string;
  access_token: string;
  business_account_id: string;
  phone_number: string;
  is_default: boolean;
  is_pdf_number: boolean;
};

const EMPTY_FORM: FormState = { name: "", phone_number_id: "", access_token: "", business_account_id: "", phone_number: "", is_default: false, is_pdf_number: false };

export default function NumbersAdminPage() {
  const [numbers, setNumbers] = useState<WaNumber[]>([]);
  const [health, setHealth] = useState<NumberHealth[]>([]);
  const [tokenErrors, setTokenErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<WaNumber | null>(null); // null = creando
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [modalErr, setModalErr] = useState<string | null>(null);

  async function loadAll() {
    setLoading(true);
    try {
      const [nRes, hRes, mtRes] = await Promise.all([
        fetch("/api/admin/inbox-v2/numbers", { credentials: "include" }),
        fetch("/api/admin/inbox-v2/health-extended", { credentials: "include" }),
        fetch("/api/admin/inbox-v2/meta-templates", { credentials: "include" }),
      ]);
      const nJ = nRes.ok ? await nRes.json() : { numbers: [] };
      const hJ = hRes.ok ? await hRes.json() : { numbers: [] };
      const mtJ = mtRes.ok ? await mtRes.json() : { errors: [] };
      setNumbers(nJ.numbers ?? []);
      setHealth(hJ.numbers ?? []);
      setTokenErrors(mtJ.errors ?? []);
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadAll(); }, []);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setModalErr(null);
    setModalOpen(true);
  }

  function openEdit(n: WaNumber) {
    setEditing(n);
    setForm({
      name: n.name ?? "",
      phone_number_id: n.phone_number_id,
      access_token: "",
      business_account_id: n.business_account_id ?? "",
      phone_number: n.phone_number ?? "",
      is_default: n.is_default,
      is_pdf_number: n.is_pdf_number,
    });
    setModalErr(null);
    setModalOpen(true);
  }

  async function submitForm() {
    setModalErr(null);
    setSubmitting(true);
    try {
      if (editing) {
        const payload: any = {
          name: form.name,
          business_account_id: form.business_account_id || null,
          phone_number: form.phone_number || null,
          is_default: form.is_default,
          is_pdf_number: form.is_pdf_number,
        };
        if (form.access_token.trim()) payload.access_token = form.access_token.trim();
        const r = await fetch(`/api/admin/inbox-v2/numbers/${encodeURIComponent(editing.phone_number_id)}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!r.ok) {
          const t = await r.text();
          setModalErr(t.slice(0, 300));
          return;
        }
      } else {
        if (!form.name || !form.phone_number_id || !form.access_token) {
          setModalErr("name, phone_number_id y access_token son obligatorios");
          return;
        }
        const r = await fetch("/api/admin/inbox-v2/numbers", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        if (!r.ok) {
          const t = await r.text();
          setModalErr(t.slice(0, 300));
          return;
        }
      }
      setModalOpen(false);
      await loadAll();
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteNumber(n: WaNumber) {
    if (!confirm(`Borrar el número "${n.name}" (${n.phone_number_id})?\n\nSe eliminará de la tabla whatsapp_numbers y de TODAS las entradas en kv_store_226b0b0d. El monolito dejará de poder enviar desde este número.`)) return;
    setSavingId(n.phone_number_id);
    try {
      const r = await fetch(`/api/admin/inbox-v2/numbers/${encodeURIComponent(n.phone_number_id)}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) {
        const t = await r.text();
        alert(`Error: ${t.slice(0, 200)}`);
        return;
      }
      await loadAll();
    } finally {
      setSavingId(null);
    }
  }

  async function patchNumber(phoneNumberId: string, patch: any) {
    setSavingId(phoneNumberId);
    try {
      const r = await fetch(`/api/admin/inbox-v2/numbers/${encodeURIComponent(phoneNumberId)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!r.ok) {
        const t = await r.text();
        alert(`Error: ${t.slice(0, 200)}`);
        return;
      }
      await loadAll();
    } finally {
      setSavingId(null);
    }
  }

  const healthById = new Map(health.map((h) => [h.phone_number_id, h]));
  const expiredWabas = new Set<string>();
  for (const e of tokenErrors) { const m = e.match(/WABA\s+(\d+)/); if (m) expiredWabas.add(m[1]); }

  if (loading && numbers.length === 0) return <div style={{ padding: 30, color: "#888" }}>Cargando números…</div>;
  if (err) return <div style={{ padding: 20, background: "#fee", borderRadius: 10, color: "#900" }}>{err}</div>;

  return (
    <div style={{ maxWidth: 1280 }}>
      <header style={{ marginBottom: 18, display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "#1a1a2e", margin: 0 }}>📱 Números WhatsApp</h1>
        <span style={{ fontSize: 12, color: "#888" }}>{numbers.length} configurados</span>
        <button onClick={openCreate} style={{ marginLeft: "auto", padding: "8px 16px", background: PURPLE, color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
          ➕ Nuevo número
        </button>
      </header>

      {expiredWabas.size > 0 && (
        <div style={{ background: "#fef3c7", border: "1px solid #fde68a", padding: 12, borderRadius: 10, marginBottom: 14, fontSize: 13, color: "#92400e" }}>
          ⚠️ <strong>{expiredWabas.size} WABA{expiredWabas.size === 1 ? "" : "s"} con token expirado</strong>: {Array.from(expiredWabas).join(", ")} · regenera el token en Meta Business Manager y edita el número desde aquí.
        </div>
      )}

      <div style={{ background: "#fff", borderRadius: 14, border: "1px solid rgba(0,0,0,0.06)", overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 980 }}>
          <thead style={{ background: "rgba(0,0,0,0.02)" }}>
            <tr>
              <Th>Número</Th>
              <Th>WABA</Th>
              <Th right>24h ↓</Th>
              <Th right>24h ↑</Th>
              <Th right>Conv 7d</Th>
              <Th>Última recibida</Th>
              <Th>Default</Th>
              <Th>Activo</Th>
              <Th>Token</Th>
              <Th>Acciones</Th>
            </tr>
          </thead>
          <tbody>
            {numbers.map((n) => {
              const h = healthById.get(n.phone_number_id);
              const lastAgeMin = h?.last_inbound_at ? (Date.now() - new Date(h.last_inbound_at).getTime()) / 60000 : Infinity;
              const stale = lastAgeMin > 7 * 24 * 60;
              const tokenExpired = n.business_account_id && expiredWabas.has(n.business_account_id);
              const saving = savingId === n.phone_number_id;
              return (
                <tr key={n.phone_number_id} style={{ borderBottom: "1px solid rgba(0,0,0,0.04)", opacity: saving ? 0.5 : 1 }}>
                  <Td>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <strong style={{ color: "#1a1a2e" }}>{n.name?.trim()}</strong>
                      {n.is_pdf_number && <span style={{ fontSize: 9, padding: "1px 5px", background: "#e0e7ff", color: "#3730a3", borderRadius: 3, fontWeight: 700 }}>PDF</span>}
                    </div>
                    <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{n.phone_number ?? "—"}</div>
                    <div style={{ fontSize: 10, fontFamily: "ui-monospace, monospace", color: "#aaa" }}>{n.phone_number_id}</div>
                  </Td>
                  <Td><span style={{ fontSize: 10, fontFamily: "ui-monospace, monospace", color: "#888" }}>{n.business_account_id ?? "—"}</span></Td>
                  <Td right><strong style={{ color: (h?.msgs_inbound_24h ?? 0) > 0 ? "#10b981" : "#888" }}>{h?.msgs_inbound_24h ?? 0}</strong></Td>
                  <Td right>{h?.msgs_outbound_24h ?? 0}</Td>
                  <Td right>{h?.conversations_active_7d ?? 0}</Td>
                  <Td>
                    {h?.last_inbound_at ? (
                      <div>
                        <div style={{ fontSize: 11 }}>{new Date(h.last_inbound_at).toLocaleDateString("es-ES", { day: "2-digit", month: "short" })}</div>
                        <div style={{ fontSize: 10, color: stale ? "#dc2626" : "#888" }}>{relativeAge(h.last_inbound_at)}</div>
                      </div>
                    ) : <span style={{ color: "#aaa" }}>—</span>}
                  </Td>
                  <Td>
                    {n.is_default ? (
                      <span style={{ fontSize: 11, padding: "3px 9px", borderRadius: 6, background: PURPLE, color: "#fff", fontWeight: 700 }}>DEFAULT ★</span>
                    ) : (
                      <button onClick={() => patchNumber(n.phone_number_id, { is_default: true })} disabled={saving} style={btnSecondary}>Marcar</button>
                    )}
                  </Td>
                  <Td>
                    <Toggle checked={n.status === "active"} onChange={(v) => patchNumber(n.phone_number_id, { status: v ? "active" : "inactive" })} disabled={saving} />
                  </Td>
                  <Td>
                    {tokenExpired ? (
                      <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 6, background: "#fef2f2", color: "#991b1b", fontWeight: 700 }}>⚠️ EXPIRADO</span>
                    ) : (
                      <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 6, background: "rgba(16,185,129,0.12)", color: "#065f46", fontWeight: 700 }}>✓ válido</span>
                    )}
                    <div style={{ fontSize: 9, fontFamily: "ui-monospace, monospace", color: "#bbb", marginTop: 3 }}>{n.access_token_preview ?? "—"}</div>
                  </Td>
                  <Td>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => openEdit(n)} disabled={saving} style={btnSecondary}>✏️ Editar</button>
                      <button onClick={() => deleteNumber(n)} disabled={saving} style={{ ...btnSecondary, borderColor: "#fecaca", color: "#991b1b" }}>🗑</button>
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 18, padding: 14, background: "#f9fafb", borderRadius: 10, border: "1px solid rgba(0,0,0,0.04)", fontSize: 12, color: "#666" }}>
        <strong>📝 Cambios sincronizados:</strong> crear/editar/borrar afecta a la tabla <code>whatsapp_numbers</code> Y a <code>kv_store_226b0b0d</code> (donde lee el monolito). Si el monolito tiene varias entradas para el mismo phoneNumberId, todas se actualizan en bloque.
      </div>

      {modalOpen && (
        <NumberFormModal
          editing={!!editing}
          form={form}
          setForm={setForm}
          onClose={() => setModalOpen(false)}
          onSubmit={submitForm}
          submitting={submitting}
          err={modalErr}
        />
      )}
    </div>
  );
}

function NumberFormModal({
  editing,
  form,
  setForm,
  onClose,
  onSubmit,
  submitting,
  err,
}: {
  editing: boolean;
  form: FormState;
  setForm: (f: FormState) => void;
  onClose: () => void;
  onSubmit: () => void;
  submitting: boolean;
  err: string | null;
}) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 14, padding: 24, width: "min(560px, 100%)", maxHeight: "90vh", overflowY: "auto" }}>
        <h2 style={{ margin: "0 0 16px", fontSize: 18, fontWeight: 700, color: "#1a1a2e" }}>
          {editing ? "✏️ Editar número WhatsApp" : "➕ Nuevo número WhatsApp"}
        </h2>

        <div style={{ display: "grid", gap: 12 }}>
          <Field label="Nombre interno" required>
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="ej. VENTAS ESPAÑA" style={input} autoFocus />
          </Field>
          <Field label="Phone Number ID (Meta)" required hint={editing ? "no se puede cambiar tras crear" : "ej. REDACTED_ID (lo encuentras en Meta Business Manager)"}>
            <input type="text" value={form.phone_number_id} onChange={(e) => setForm({ ...form, phone_number_id: e.target.value })} disabled={editing} style={{ ...input, fontFamily: "ui-monospace, monospace", background: editing ? "#f3f4f6" : "#fff" }} placeholder="REDACTED_ID" />
          </Field>
          <Field label="Access Token (Bearer)" required={!editing} hint={editing ? "déjalo vacío para mantener el actual · pega uno nuevo para reemplazar" : "EAAUn6fx07P0BQ… (token largo de Meta, no expira si es System User)"}>
            <textarea value={form.access_token} onChange={(e) => setForm({ ...form, access_token: e.target.value })} placeholder={editing ? "(sin cambios)" : "EAAUn6fx07P0BQ…"} rows={3} style={{ ...input, fontFamily: "ui-monospace, monospace", fontSize: 11, resize: "vertical" }} />
          </Field>
          <Field label="Business Account ID (WABA)" hint="ej. REDACTED_ID — necesario para que el catálogo de plantillas funcione">
            <input type="text" value={form.business_account_id} onChange={(e) => setForm({ ...form, business_account_id: e.target.value })} style={{ ...input, fontFamily: "ui-monospace, monospace" }} placeholder="REDACTED_ID" />
          </Field>
          <Field label="Número de teléfono visible" hint="ej. +34 XXX XXX XXX (solo para mostrar en el UI)">
            <input type="text" value={form.phone_number} onChange={(e) => setForm({ ...form, phone_number: e.target.value })} style={input} placeholder="+34 …" />
          </Field>

          <div style={{ display: "flex", gap: 16, marginTop: 4 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
              <input type="checkbox" checked={form.is_default} onChange={(e) => setForm({ ...form, is_default: e.target.checked })} />
              Marcar como <strong>default</strong>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
              <input type="checkbox" checked={form.is_pdf_number} onChange={(e) => setForm({ ...form, is_pdf_number: e.target.checked })} />
              Número de <strong>PDF</strong>
            </label>
          </div>

          {err && <div style={{ padding: 10, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, color: "#991b1b", fontSize: 12 }}>{err}</div>}

          <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
            <button onClick={onClose} disabled={submitting} style={{ padding: "10px 18px", background: "transparent", color: "#666", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>
              Cancelar
            </button>
            <button onClick={onSubmit} disabled={submitting} style={{ flex: 1, padding: "10px 18px", background: PURPLE, color: "#fff", border: "none", borderRadius: 8, cursor: submitting ? "default" : "pointer", fontSize: 13, fontWeight: 700, opacity: submitting ? 0.6 : 1 }}>
              {submitting ? "Guardando…" : editing ? "Guardar cambios" : "Crear número"}
            </button>
          </div>
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
  return <td style={{ padding: "12px 14px", textAlign: right ? "right" : "left", verticalAlign: "top" }}>{children}</td>;
}
function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button onClick={() => onChange(!checked)} disabled={disabled} style={{ width: 44, height: 24, borderRadius: 12, border: "none", background: checked ? PURPLE : "#cbd5e1", position: "relative", cursor: disabled ? "default" : "pointer", padding: 0 }}>
      <span style={{ position: "absolute", top: 2, left: checked ? 22 : 2, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left 0.15s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
    </button>
  );
}
function relativeAge(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `hace ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h}h`;
  const d = Math.floor(h / 24);
  if (d < 60) return `hace ${d}d`;
  return `hace ${Math.floor(d / 30)} meses`;
}

const input: React.CSSProperties = { width: "100%", padding: "8px 12px", border: "1px solid rgba(0,0,0,0.12)", borderRadius: 8, fontSize: 13, outline: "none", boxSizing: "border-box", fontFamily: "inherit" };
const btnSecondary: React.CSSProperties = { padding: "4px 10px", fontSize: 11, fontWeight: 600, background: "transparent", border: `1px solid ${PURPLE}55`, color: PURPLE, borderRadius: 6, cursor: "pointer" };
