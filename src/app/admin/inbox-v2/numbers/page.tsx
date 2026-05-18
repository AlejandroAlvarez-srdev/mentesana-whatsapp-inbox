"use client";

import { useEffect, useState } from "react";

const PURPLE = "#6A178C";

type NumberHealth = {
  phone_number_id: string;
  name: string;
  phone_number: string | null;
  is_default: boolean;
  status: string;
  last_inbound_at: string | null;
  msgs_inbound_1h: number;
  msgs_inbound_24h: number;
  msgs_outbound_24h: number;
  conversations_active_7d: number;
};

type WaNumber = {
  phone_number_id: string;
  name: string;
  phone_number: string | null;
  is_default: boolean;
  status: string;
  is_pdf_number: boolean;
  business_account_id: string | null;
};

type MetaTplResp = { templates: any[]; errors: string[] };

export default function NumbersAdminPage() {
  const [numbers, setNumbers] = useState<WaNumber[]>([]);
  const [health, setHealth] = useState<NumberHealth[]>([]);
  const [tokenErrors, setTokenErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  async function loadAll() {
    setLoading(true);
    try {
      const [nRes, hRes, mtRes] = await Promise.all([
        fetch("/api/admin/inbox-v2/whatsapp-numbers", { credentials: "include" }),
        fetch("/api/admin/inbox-v2/health-extended", { credentials: "include" }),
        fetch("/api/admin/inbox-v2/meta-templates", { credentials: "include" }),
      ]);
      const nJ = nRes.ok ? await nRes.json() : { numbers: [] };
      const hJ = hRes.ok ? await hRes.json() : { numbers: [] };
      const mtJ: MetaTplResp = mtRes.ok ? await mtRes.json() : { templates: [], errors: [] };
      setNumbers(nJ.numbers ?? []);
      setHealth(hJ.numbers ?? []);
      setTokenErrors(mtJ.errors ?? []);
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  async function patchNumber(phoneNumberId: string, patch: Partial<WaNumber>) {
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
  // Detectar qué WABA tienen token expirado a partir del texto de errores
  const expiredWabas = new Set<string>();
  for (const e of tokenErrors) {
    const m = e.match(/WABA\s+(\d+)/);
    if (m) expiredWabas.add(m[1]);
  }

  if (loading) return <div style={{ padding: 30, color: "#888" }}>Cargando números…</div>;
  if (err) return <div style={{ padding: 20, background: "#fee", borderRadius: 10, color: "#900" }}>{err}</div>;

  return (
    <div style={{ maxWidth: 1280 }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "#1a1a2e", margin: 0 }}>📱 Números WhatsApp</h1>
        <p style={{ color: "#888", fontSize: 13, marginTop: 6 }}>
          {numbers.length} números configurados · cambia el default, activa o desactiva. <strong>Para añadir números nuevos</strong>, sigue usando el panel del monolito (los cambios sincronizan en la próxima recarga).
        </p>
      </header>

      {expiredWabas.size > 0 && (
        <div style={{ background: "#fef3c7", border: "1px solid #fde68a", padding: 12, borderRadius: 10, marginBottom: 16, fontSize: 13, color: "#92400e" }}>
          ⚠️ <strong>{expiredWabas.size} WABA{expiredWabas.size === 1 ? "" : "s"} con token expirado</strong>: {Array.from(expiredWabas).join(", ")} · las plantillas no se cargan y los webhooks pueden estar suspendidos. Regenera el token desde Meta Business Manager.
        </div>
      )}

      <div style={{ background: "#fff", borderRadius: 14, border: "1px solid rgba(0,0,0,0.06)", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
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
              <Th>Token WABA</Th>
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
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <strong style={{ color: "#1a1a2e" }}>{n.name?.trim()}</strong>
                      {n.is_pdf_number && <span style={{ fontSize: 9, padding: "1px 5px", background: "#e0e7ff", color: "#3730a3", borderRadius: 3, fontWeight: 700 }}>PDF</span>}
                    </div>
                    <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{n.phone_number ?? "—"}</div>
                    <div style={{ fontSize: 10, fontFamily: "ui-monospace, monospace", color: "#aaa" }}>{n.phone_number_id}</div>
                  </Td>
                  <Td>
                    <span style={{ fontSize: 10, fontFamily: "ui-monospace, monospace", color: "#888" }}>{n.business_account_id ?? "—"}</span>
                  </Td>
                  <Td right>
                    <strong style={{ color: (h?.msgs_inbound_24h ?? 0) > 0 ? "#10b981" : "#888" }}>{h?.msgs_inbound_24h ?? 0}</strong>
                  </Td>
                  <Td right>{h?.msgs_outbound_24h ?? 0}</Td>
                  <Td right>{h?.conversations_active_7d ?? 0}</Td>
                  <Td>
                    {h?.last_inbound_at ? (
                      <div>
                        <div style={{ fontSize: 11 }}>{new Date(h.last_inbound_at).toLocaleDateString("es-ES", { day: "2-digit", month: "short" })}</div>
                        <div style={{ fontSize: 10, color: stale ? "#dc2626" : "#888" }}>{relativeAge(h.last_inbound_at)}</div>
                      </div>
                    ) : (
                      <span style={{ color: "#aaa" }}>—</span>
                    )}
                  </Td>
                  <Td>
                    {n.is_default ? (
                      <span style={{ fontSize: 11, padding: "3px 9px", borderRadius: 6, background: PURPLE, color: "#fff", fontWeight: 700 }}>DEFAULT ★</span>
                    ) : (
                      <button onClick={() => patchNumber(n.phone_number_id, { is_default: true })} disabled={saving} style={btnSecondary}>
                        Marcar default
                      </button>
                    )}
                  </Td>
                  <Td>
                    <Toggle
                      checked={n.status === "active"}
                      onChange={(v) => patchNumber(n.phone_number_id, { status: v ? "active" : "inactive" })}
                      disabled={saving}
                    />
                  </Td>
                  <Td>
                    {tokenExpired ? (
                      <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 6, background: "#fef2f2", color: "#991b1b", fontWeight: 700 }}>⚠️ EXPIRADO</span>
                    ) : (
                      <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 6, background: "rgba(16,185,129,0.12)", color: "#065f46", fontWeight: 700 }}>✓ válido</span>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Bottom info */}
      <div style={{ marginTop: 18, padding: 14, background: "#f9fafb", borderRadius: 10, border: "1px solid rgba(0,0,0,0.04)", fontSize: 12, color: "#666" }}>
        <strong>📝 Cómo se gestionan los números aquí:</strong>
        <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
          <li>El <strong>default</strong> se usa para enviar cuando una conversación no tiene número asignado en <code>conversation_routing</code>.</li>
          <li><strong>Inactivo</strong> = no se ofrece en el dropdown del modal de plantillas ni en el composer del chat. El webhook entrante sigue procesándolo (lo decide el monolito).</li>
          <li>El <strong>token WABA</strong> se renueva en Meta Business Manager → System Users → tu app → genera nuevo token de larga duración, después actualízalo en el panel del monolito (`whatsapp:number:wanum_*` en kv_store).</li>
          <li>Para <strong>añadir un número nuevo</strong>: hazlo desde el panel del monolito (escribe a <code>kv_store_226b0b0d</code>); se sincroniza a la tabla <code>whatsapp_numbers</code> la próxima vez que la inbox-v2 cachea (TTL 30 s).</li>
        </ul>
      </div>
    </div>
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

const btnSecondary: React.CSSProperties = { padding: "4px 10px", fontSize: 11, fontWeight: 600, background: "transparent", border: `1px solid ${PURPLE}55`, color: PURPLE, borderRadius: 6, cursor: "pointer" };
