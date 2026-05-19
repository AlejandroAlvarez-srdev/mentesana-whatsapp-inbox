"use client";

import { useEffect, useMemo, useState } from "react";

const PURPLE = "#6A178C";

type PackageService = { id: number; service_id: number; service_name: string; provider_id: number; provider_name: string | null; sessions_in_package: number; used: number; remaining: number };
type Package = { package_customer_id: number; package_id: number; name: string; status: string; start: string | null; end: string | null; bookings_count: number; services: PackageService[]; is_expired: boolean };
type Appt = { appointment_id: number; booking_id: number; booking_start_utc: string; service_name: string | null; provider_id: number | null; provider_name: string | null; google_meet_url: string | null; booking_status: string; from_package: boolean; amelia_admin_url: string };
type Past = { appointment_id: number; booking_id: number; booking_start_utc: string; service_name: string | null; provider_name: string | null; booking_status: string };
type Resp = {
  customer: { id: number; name: string; email: string | null; phone: string | null } | null;
  packages: Package[];
  has_bono: boolean;
  upcoming: Appt[];
  past: Past[];
  amelia_admin_url: string;
};

function fmtMadrid(iso: string) {
  return new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

export default function AmeliaToolsTab({ phone, email, conversationId }: { phone: string | null; email: string | null; conversationId: string | null }) {
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState<{ service: PackageService } | null>(null);
  const [rescheduling, setRescheduling] = useState<Appt | null>(null);

  async function load() {
    if (!phone && !email) { setLoading(false); return; }
    setLoading(true); setErr(null);
    try {
      const qs = new URLSearchParams();
      if (phone) qs.set("phone", phone);
      if (email) qs.set("email", email);
      const r = await fetch(`/api/agent/amelia/customer-tools?${qs}`, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [phone, email]);

  if (loading && !data) return <div style={{ padding: 12, color: "#888", fontSize: 12 }}>Cargando bonos y citas Amelia…</div>;
  if (err) return <div style={{ padding: 10, background: "#fef2f2", color: "#991b1b", borderRadius: 8, fontSize: 12 }}>⚠️ {err}</div>;
  if (!data?.customer) {
    return (
      <div style={{ padding: 12, background: "#fef3c7", border: "1px solid #fbbf24", borderRadius: 8, fontSize: 12, color: "#92400e" }}>
        ⚠️ Este lead no aparece en Amelia (busqué por phone y email). Si compró por la web, debería estar — verifica que phone/email del perfil coincida.
      </div>
    );
  }

  const c = data.customer;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* Resumen cliente */}
      <section style={{ padding: 10, background: "rgba(106,23,140,0.04)", borderRadius: 10, border: `1px solid ${PURPLE}22` }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: PURPLE }}>👤 {c.name} <span style={{ fontSize: 10, color: "#888", marginLeft: 6, fontWeight: 600 }}>Amelia ID {c.id}</span></div>
        <div style={{ fontSize: 11, color: "#666", marginTop: 3 }}>{c.email} · {c.phone}</div>
        <a href={data.amelia_admin_url + `#/customers/${c.id}`} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: 6, fontSize: 11, color: PURPLE, fontWeight: 700, textDecoration: "none" }}>
          🔗 Abrir en Amelia admin →
        </a>
      </section>

      {/* Bonos */}
      <Section title={`🎫 Bonos · ${data.packages.length}`} subtitle={data.has_bono ? "Tiene sesiones disponibles" : "Sin sesiones restantes"}>
        {data.packages.length === 0 ? (
          <div style={{ fontSize: 11, color: "#aaa" }}>Sin bonos comprados.</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {data.packages.map((p) => <PackageCard key={p.package_customer_id} p={p} onSchedule={(svc) => setScheduling({ service: svc })} />)}
          </div>
        )}
      </Section>

      {/* Citas próximas */}
      <Section title={`📅 Citas próximas · ${data.upcoming.length}`}>
        {data.upcoming.length === 0 ? (
          <div style={{ fontSize: 11, color: "#aaa" }}>Sin citas próximas.</div>
        ) : (
          <div style={{ display: "grid", gap: 6 }}>
            {data.upcoming.map((a) => (
              <ApptRow
                key={a.appointment_id}
                a={a}
                onReschedule={() => setRescheduling(a)}
                onCancel={async () => {
                  if (!confirm(`Cancelar cita del ${fmtMadrid(a.booking_start_utc)} con ${a.provider_name}?`)) return;
                  const r = await fetch("/api/agent/amelia/booking-action", {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "cancel", appointment_id: a.appointment_id, booking_id: a.booking_id, conversation_id: conversationId }),
                  });
                  const d = await r.json();
                  if (r.ok) {
                    const w = d.result?.meet_warnings?.[0];
                    alert(`✅ Cita cancelada${w ? `\n⚠️ Google Calendar: ${w.slice(0,100)}` : ""}`);
                    void load();
                  } else alert("❌ " + (d.friendly ?? d.error ?? "Error cancelando"));
                }}
              />
            ))}
          </div>
        )}
      </Section>

      {/* Pasadas */}
      {data.past.length > 0 && (
        <Section title={`🕒 Últimas 5 sesiones`}>
          <div style={{ display: "grid", gap: 4 }}>
            {data.past.map((a) => (
              <div key={a.appointment_id} style={{ padding: "7px 9px", background: "#fff", borderRadius: 8, border: "1px solid rgba(0,0,0,0.05)", fontSize: 11.5 }}>
                <span style={{ color: "#888", fontFamily: "ui-monospace, monospace" }}>{fmtMadrid(a.booking_start_utc)}</span>
                {a.provider_name && <span style={{ marginLeft: 6, color: "#666" }}>· {a.provider_name}</span>}
                <span style={{ marginLeft: 6, fontSize: 9, padding: "1px 5px", borderRadius: 4, background: a.booking_status === "approved" ? "rgba(16,185,129,0.14)" : a.booking_status === "canceled" ? "rgba(239,68,68,0.14)" : "rgba(0,0,0,0.05)", color: a.booking_status === "approved" ? "#065f46" : a.booking_status === "canceled" ? "#991b1b" : "#666", fontWeight: 700, textTransform: "uppercase" }}>
                  {a.booking_status}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {scheduling && (
        <ScheduleModal
          customerId={c.id}
          customerName={c.name}
          service={scheduling.service}
          conversationId={conversationId}
          onClose={() => setScheduling(null)}
          onScheduled={() => { setScheduling(null); void load(); }}
        />
      )}
      {rescheduling && (
        <RescheduleModal
          appt={rescheduling}
          conversationId={conversationId}
          onClose={() => setRescheduling(null)}
          onRescheduled={() => { setRescheduling(null); void load(); }}
        />
      )}
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
        <strong style={{ fontSize: 12, color: "#1a1a2e" }}>{title}</strong>
        {subtitle && <span style={{ fontSize: 10, color: "#888" }}>{subtitle}</span>}
      </div>
      {children}
    </div>
  );
}

function PackageCard({ p, onSchedule }: { p: Package; onSchedule: (svc: PackageService) => void }) {
  const expired = p.is_expired;
  return (
    <div style={{ padding: 10, background: "#fff", borderRadius: 10, border: `1px solid ${expired ? "rgba(0,0,0,0.08)" : "rgba(16,185,129,0.25)"}`, opacity: expired ? 0.6 : 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 13, color: "#1a1a2e" }}>{p.name}</strong>
        {expired && <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 4, background: "rgba(239,68,68,0.1)", color: "#991b1b", fontWeight: 700 }}>VENCIDO</span>}
      </div>
      <div style={{ fontSize: 10, color: "#888", marginTop: 2 }}>
        {p.start && <span>desde {new Date(p.start).toLocaleDateString("es-ES")}</span>}
        {p.end && <span> · hasta {new Date(p.end).toLocaleDateString("es-ES")}</span>}
      </div>
      {p.services.length > 0 && (
        <div style={{ marginTop: 8, display: "grid", gap: 5 }}>
          {p.services.map((s) => {
            const pctUsed = s.sessions_in_package > 0 ? (s.used / s.sessions_in_package) * 100 : 0;
            return (
              <div key={s.id} style={{ padding: 7, background: "rgba(0,0,0,0.02)", borderRadius: 6 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, flexWrap: "wrap" }}>
                  <div style={{ fontSize: 11.5, color: "#1a1a2e", flex: 1, minWidth: 100 }}>
                    {s.service_name ?? "(servicio)"}
                    {s.provider_name && <span style={{ color: "#888", fontWeight: 500 }}> · {s.provider_name}</span>}
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 800, color: s.remaining > 0 ? "#065f46" : "#888" }}>
                    {s.remaining}/{s.sessions_in_package} restantes
                  </span>
                </div>
                <div style={{ height: 4, background: "rgba(0,0,0,0.06)", borderRadius: 2, marginTop: 4, overflow: "hidden" }}>
                  <div style={{ width: `${pctUsed}%`, height: "100%", background: pctUsed === 100 ? "#dc2626" : pctUsed >= 70 ? "#f59e0b" : "#16a34a", transition: "width 0.3s" }} />
                </div>
                {!expired && s.remaining > 0 && (
                  <button
                    onClick={() => onSchedule(s)}
                    style={{ marginTop: 6, padding: "5px 10px", fontSize: 11, fontWeight: 800, borderRadius: 6, border: "none", cursor: "pointer", background: PURPLE, color: "#fff" }}
                  >
                    📅 Agendar con bono
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ApptRow({ a, onReschedule, onCancel }: { a: Appt; onReschedule: () => void; onCancel: () => Promise<void> }) {
  return (
    <div style={{ padding: 9, background: "#fff", borderRadius: 8, border: "1px solid rgba(0,0,0,0.06)", display: "grid", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 12, color: PURPLE }}>{fmtMadrid(a.booking_start_utc)}</strong>
        {a.from_package && <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 3, background: "rgba(16,185,129,0.14)", color: "#065f46", fontWeight: 800 }}>🎫 BONO</span>}
      </div>
      <div style={{ fontSize: 11, color: "#1a1a2e" }}>
        {a.provider_name && <span>👩‍⚕️ {a.provider_name}</span>}
        {a.service_name && <span style={{ color: "#888" }}> · {a.service_name}</span>}
      </div>
      {a.google_meet_url && (
        <a href={a.google_meet_url} target="_blank" rel="noreferrer" style={{ fontSize: 10.5, color: "#065f46", fontWeight: 700, textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          📹 {a.google_meet_url}
        </a>
      )}
      <div style={{ display: "flex", gap: 5, marginTop: 4 }}>
        <button onClick={onReschedule} style={smallBtn(false)}>🔄 Reagendar</button>
        <button onClick={() => void onCancel()} style={smallBtnDanger}>❌ Cancelar</button>
        <a href={a.amelia_admin_url} target="_blank" rel="noreferrer" style={{ ...smallBtn(false), textDecoration: "none", marginLeft: "auto" }}>🔗 Admin</a>
      </div>
    </div>
  );
}

function ScheduleModal({ customerId, customerName, service, conversationId, onClose, onScheduled }: { customerId: number; customerName: string; service: PackageService; conversationId: string | null; onClose: () => void; onScheduled: () => void }) {
  const [slots, setSlots] = useState<{ day: string; weekday: string; hour: number; iso: string }[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/agent/amelia/free-slots?provider_id=${service.provider_id}`, { credentials: "include" })
      .then((r) => r.ok ? r.json() : { slots: [] })
      .then((d) => setSlots(d.slots ?? []))
      .finally(() => setLoading(false));
  }, [service.provider_id]);

  async function schedule() {
    if (!picked) return;
    setSaving(true);
    try {
      const r = await fetch("/api/agent/amelia/booking-action", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "schedule",
          customer_id: customerId,
          provider_id: service.provider_id,
          service_id: service.service_id,
          new_start_utc: picked,
          package_customer_service_id: service.id, // vincula al bono
          conversation_id: conversationId,
        }),
      });
      const d = await r.json();
      if (r.ok) {
        const meetMsg = d.result?.google_meet_url
          ? `\n📹 Meet: ${d.result.google_meet_url}`
          : d.result?.meet_warnings?.length
            ? `\n⚠️ Cita creada SIN Meet (${d.result.meet_warnings[0].slice(0,100)})`
            : "";
        alert(`✅ Cita agendada para ${customerName} (descontada del bono)${meetMsg}`);
        onScheduled();
      } else alert("❌ " + (d.friendly ?? d.error ?? "Error agendando"));
    } finally { setSaving(false); }
  }

  const byDay = useMemo(() => {
    const m = new Map<string, typeof slots>();
    for (const s of slots) { if (!m.has(s.day)) m.set(s.day, []); m.get(s.day)!.push(s); }
    return m;
  }, [slots]);

  return (
    <ModalShell title={`📅 Agendar con bono · ${service.service_name}`} subtitle={`Cliente ${customerName} · ${service.provider_name} · ${service.remaining} sesiones restantes`} onClose={onClose}>
      {loading ? <div style={{ color: "#888", fontSize: 12 }}>Cargando huecos…</div> : (
        slots.length === 0 ? <div style={{ color: "#aaa", fontSize: 12 }}>Sin huecos disponibles los próximos 7 días.</div> :
        <div>
          {Array.from(byDay.entries()).map(([day, ss]) => {
            const d = new Date(day);
            return (
              <div key={day} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", marginBottom: 5 }}>
                  {d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })}
                </div>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {ss.map((s) => {
                    const sel = picked === s.iso;
                    return (
                      <button key={s.iso} onClick={() => setPicked(s.iso)} style={{ padding: "5px 11px", fontSize: 11.5, fontWeight: 700, borderRadius: 999, border: sel ? `2px solid ${PURPLE}` : "1px solid rgba(0,0,0,0.1)", background: sel ? PURPLE : "#fff", color: sel ? "#fff" : "#475569", cursor: "pointer" }}>
                        {String(s.hour).padStart(2, "0")}:00
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <ModalFooter>
        <button onClick={onClose} style={smallBtn(false)}>Cancelar</button>
        <button onClick={schedule} disabled={!picked || saving} style={{ ...primaryBtn, opacity: !picked || saving ? 0.5 : 1, cursor: !picked || saving ? "default" : "pointer" }}>
          {saving ? "Agendando…" : "✅ Confirmar cita"}
        </button>
      </ModalFooter>
    </ModalShell>
  );
}

function RescheduleModal({ appt, conversationId, onClose, onRescheduled }: { appt: Appt; conversationId: string | null; onClose: () => void; onRescheduled: () => void }) {
  const [slots, setSlots] = useState<{ day: string; weekday: string; hour: number; iso: string }[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!appt.provider_id) { setLoading(false); return; }
    fetch(`/api/agent/amelia/free-slots?provider_id=${appt.provider_id}`, { credentials: "include" })
      .then((r) => r.ok ? r.json() : { slots: [] })
      .then((d) => setSlots(d.slots ?? []))
      .finally(() => setLoading(false));
  }, [appt.provider_id]);

  async function doIt() {
    if (!picked) return;
    setSaving(true);
    try {
      const r = await fetch("/api/agent/amelia/booking-action", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reschedule", appointment_id: appt.appointment_id, booking_id: appt.booking_id, new_start_utc: picked, conversation_id: conversationId }),
      });
      const d = await r.json();
      if (r.ok) {
        const w = d.result?.meet_warnings?.[0];
        alert(`✅ Cita reagendada${w ? `\n⚠️ Google Calendar: ${w.slice(0,100)}` : ""}`);
        onRescheduled();
      } else alert("❌ " + (d.friendly ?? d.error ?? "Error reagendando"));
    } finally { setSaving(false); }
  }

  const byDay = useMemo(() => {
    const m = new Map<string, typeof slots>();
    for (const s of slots) { if (!m.has(s.day)) m.set(s.day, []); m.get(s.day)!.push(s); }
    return m;
  }, [slots]);

  return (
    <ModalShell title="🔄 Reagendar cita" subtitle={`De ${fmtMadrid(appt.booking_start_utc)} con ${appt.provider_name}`} onClose={onClose}>
      {loading ? <div style={{ color: "#888", fontSize: 12 }}>Cargando huecos…</div> :
        slots.length === 0 ? <div style={{ color: "#aaa", fontSize: 12 }}>Sin huecos disponibles los próximos 7 días.</div> :
        <div>
          {Array.from(byDay.entries()).map(([day, ss]) => {
            const d = new Date(day);
            return (
              <div key={day} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", marginBottom: 5 }}>
                  {d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })}
                </div>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {ss.map((s) => {
                    const sel = picked === s.iso;
                    return (
                      <button key={s.iso} onClick={() => setPicked(s.iso)} style={{ padding: "5px 11px", fontSize: 11.5, fontWeight: 700, borderRadius: 999, border: sel ? `2px solid ${PURPLE}` : "1px solid rgba(0,0,0,0.1)", background: sel ? PURPLE : "#fff", color: sel ? "#fff" : "#475569", cursor: "pointer" }}>
                        {String(s.hour).padStart(2, "0")}:00
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      }
      <ModalFooter>
        <button onClick={onClose} style={smallBtn(false)}>Cancelar</button>
        <button onClick={doIt} disabled={!picked || saving} style={{ ...primaryBtn, opacity: !picked || saving ? 0.5 : 1, cursor: !picked || saving ? "default" : "pointer" }}>
          {saving ? "Reagendando…" : "✅ Confirmar nuevo horario"}
        </button>
      </ModalFooter>
    </ModalShell>
  );
}

function ModalShell({ title, subtitle, children, onClose }: { title: string; subtitle?: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100 }} />
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: "min(640px, 95vw)", maxHeight: "85vh", background: "#fff", borderRadius: 14, zIndex: 101, boxShadow: "0 30px 80px rgba(0,0,0,0.3)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
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

function ModalFooter({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16, paddingTop: 12, borderTop: "1px solid rgba(0,0,0,0.06)" }}>{children}</div>;
}

const smallBtn = (primary: boolean): React.CSSProperties => ({
  padding: "5px 10px", fontSize: 11, fontWeight: 700, borderRadius: 6, border: primary ? "none" : "1px solid rgba(0,0,0,0.1)", background: primary ? PURPLE : "#fff", color: primary ? "#fff" : "#475569", cursor: "pointer", fontFamily: "inherit",
});
const smallBtnDanger: React.CSSProperties = { padding: "5px 10px", fontSize: 11, fontWeight: 700, borderRadius: 6, border: "1px solid #fecaca", background: "#fee", color: "#991b1b", cursor: "pointer", fontFamily: "inherit" };
const primaryBtn: React.CSSProperties = { padding: "7px 14px", fontSize: 12, fontWeight: 800, borderRadius: 8, border: "none", background: "linear-gradient(135deg, #6A178C 0%, #8B2FB5 100%)", color: "#fff", cursor: "pointer", fontFamily: "inherit" };
