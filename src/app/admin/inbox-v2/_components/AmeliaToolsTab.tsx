"use client";

import { useEffect, useMemo, useState } from "react";

const PURPLE = "#6A178C";

type PackageService = { id: number; service_id: number; service_name: string; provider_id: number; provider_name: string | null; sessions_in_package: number; used: number; remaining: number };
type Package = { package_customer_id: number; package_id: number; name: string; status: string; start: string | null; end: string | null; bookings_count: number; services: PackageService[]; is_expired: boolean };
type Appt = { appointment_id: number; booking_id: number; booking_start_utc: string; service_id: number | null; service_name: string | null; provider_id: number | null; provider_name: string | null; google_meet_url: string | null; booking_status: string; from_package: boolean; amelia_admin_url: string; reschedule_count: number };
type Past = { appointment_id: number; booking_id: number; booking_start_utc: string; service_name: string | null; provider_name: string | null; booking_status: string };
type Resp = {
  customer: { id: number; name: string; email: string | null; phone: string | null } | null;
  packages: Package[];
  has_bono: boolean;
  can_adjust_sessions?: boolean;
  upcoming: Appt[];
  past: Past[];
  amelia_admin_url: string;
};

function fmtMadrid(iso: string) {
  return new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

// Semántica Mente Sana sobre customer_bookings.status (reference_amelia_attendance.md).
// isPast=true → cita ya pasó; isPast=false → cita futura.
function statusBadgeAmelia(status: string, isPast: boolean): { label: string; bg: string; fg: string } {
  const s = (status || "").toLowerCase();
  if (s === "approved") {
    return isPast
      ? { label: "✓ Asistió", bg: "rgba(16,185,129,0.14)", fg: "#065f46" }
      : { label: "📅 Confirmada", bg: "rgba(8,145,178,0.14)", fg: "#075985" };
  }
  if (s === "pending") {
    return isPast
      ? { label: "✓ Asistió", bg: "rgba(16,185,129,0.14)", fg: "#065f46" }
      : { label: "📅 Reservada", bg: "rgba(8,145,178,0.14)", fg: "#075985" };
  }
  if (s === "no-show") return { label: "👻 No asistió", bg: "rgba(239,68,68,0.14)", fg: "#991b1b" };
  if (s === "rejected") return { label: "👻 No asistió", bg: "rgba(239,68,68,0.14)", fg: "#991b1b" };
  if (s === "canceled" || s === "cancelled") return { label: "🚫 Cancelada", bg: "rgba(148,163,184,0.18)", fg: "#475569" };
  return { label: s.toUpperCase() || "—", bg: "rgba(0,0,0,0.05)", fg: "#666" };
}

type Provider = { id: number; name: string; email: string | null };

export default function AmeliaToolsTab({ phone, email, conversationId }: { phone: string | null; email: string | null; conversationId: string | null }) {
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState<{ service: PackageService } | null>(null);
  const [rescheduling, setRescheduling] = useState<Appt | null>(null);
  const [changingProvider, setChangingProvider] = useState<Appt | null>(null);
  const [adjusting, setAdjusting] = useState<{ p: Package; s: PackageService; sign: 1 | -1 } | null>(null);
  const [expiryEditing, setExpiryEditing] = useState<Package | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);

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

  useEffect(() => {
    fetch("/api/agent/amelia/providers", { credentials: "include" })
      .then((r) => r.ok ? r.json() : { providers: [] })
      .then((d) => setProviders(d.providers ?? []));
  }, []);

  if (loading && !data) return <div style={{ padding: 12, color: "#888", fontSize: 12 }}>Cargando bonos y citas Amelia…</div>;
  if (err) return <div style={{ padding: 10, background: "#fef2f2", color: "#991b1b", borderRadius: 8, fontSize: 12 }}>⚠️ {err}</div>;
  if (!data?.customer) {
    return (
      <div style={{ padding: 24, textAlign: "center", background: "linear-gradient(135deg, rgba(245,158,11,0.04), rgba(245,158,11,0.02))", border: "1px solid rgba(245,158,11,0.25)", borderRadius: 12 }}>
        <div style={{ fontSize: 36, marginBottom: 8 }}>🚫</div>
        <strong style={{ fontSize: 14, color: "#92400e", display: "block", marginBottom: 6 }}>No es cliente de Amelia</strong>
        <p style={{ fontSize: 12, color: "#92400e", margin: "0 0 4px", lineHeight: 1.5 }}>
          Este lead no aparece en la base de Amelia ni por teléfono ni por email.
        </p>
        <p style={{ fontSize: 11, color: "#a16207", margin: 0, lineHeight: 1.5 }}>
          Las herramientas (bonos · agendar · cancelar · Meet) solo están disponibles para clientes que hayan comprado por la web.
        </p>
      </div>
    );
  }

  // Si es cliente pero NO tiene bonos NI citas próximas NI pasadas, también es un caso limitado
  const hasAnyData = data.packages.length > 0 || data.upcoming.length > 0 || data.past.length > 0;

  const c = data.customer;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {!hasAnyData && (
        <div style={{ padding: 10, background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 8, fontSize: 11.5, color: "#92400e" }}>
          ℹ️ Cliente registrado en Amelia pero sin bonos ni citas. No hay nada que gestionar todavía.
        </div>
      )}

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
            {data.packages.map((p) => <PackageCard key={p.package_customer_id} p={p} canAdjust={!!data.can_adjust_sessions} onSchedule={(svc) => setScheduling({ service: svc })} onAdjust={(pp, svc, sign) => setAdjusting({ p: pp, s: svc, sign })} onAdjustExpiry={(pp) => setExpiryEditing(pp)} />)}
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
                conversationId={conversationId}
                onReschedule={() => setRescheduling(a)}
                onChangeProvider={() => setChangingProvider(a)}
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
            {data.past.map((a) => {
              const b = statusBadgeAmelia(a.booking_status, true);
              return (
                <div key={a.appointment_id} style={{ padding: "7px 9px", background: "#fff", borderRadius: 8, border: "1px solid rgba(0,0,0,0.05)", fontSize: 11.5 }}>
                  <span style={{ color: "#888", fontFamily: "ui-monospace, monospace" }}>{fmtMadrid(a.booking_start_utc)}</span>
                  {a.provider_name && <span style={{ marginLeft: 6, color: "#666" }}>· {a.provider_name}</span>}
                  <span title={`Status crudo: ${a.booking_status}`} style={{ marginLeft: 6, fontSize: 9, padding: "1px 6px", borderRadius: 4, background: b.bg, color: b.fg, fontWeight: 800 }}>
                    {b.label}
                  </span>
                </div>
              );
            })}
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
      {changingProvider && (
        <ChangeProviderModal
          appt={changingProvider}
          providers={providers}
          conversationId={conversationId}
          onClose={() => setChangingProvider(null)}
          onChanged={() => { setChangingProvider(null); void load(); }}
        />
      )}
      {adjusting && (
        <AdjustSessionsModal
          p={adjusting.p}
          s={adjusting.s}
          sign={adjusting.sign}
          customerName={c.name}
          conversationId={conversationId}
          onClose={() => setAdjusting(null)}
          onDone={() => { setAdjusting(null); void load(); }}
        />
      )}
      {expiryEditing && (
        <ExpiryModal
          p={expiryEditing}
          customerName={c.name}
          conversationId={conversationId}
          onClose={() => setExpiryEditing(null)}
          onDone={() => { setExpiryEditing(null); void load(); }}
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

function PackageCard({ p, canAdjust, onSchedule, onAdjust, onAdjustExpiry }: { p: Package; canAdjust: boolean; onSchedule: (svc: PackageService) => void; onAdjust: (p: Package, svc: PackageService, sign: 1 | -1) => void; onAdjustExpiry: (p: Package) => void }) {
  const expired = p.is_expired;
  return (
    <div style={{ padding: 10, background: "#fff", borderRadius: 10, border: `1px solid ${expired ? "rgba(0,0,0,0.08)" : "rgba(16,185,129,0.25)"}`, opacity: expired ? 0.6 : 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 13, color: "#1a1a2e" }}>{p.name}</strong>
        {expired && <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 4, background: "rgba(239,68,68,0.1)", color: "#991b1b", fontWeight: 700 }}>VENCIDO</span>}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
        <div style={{ fontSize: 10, color: "#888" }}>
          {p.start && <span>desde {new Date(p.start).toLocaleDateString("es-ES", { timeZone: "Europe/Madrid" })}</span>}
          {p.end ? <span> · hasta {new Date(p.end).toLocaleDateString("es-ES", { timeZone: "Europe/Madrid" })}</span> : <span> · sin caducidad</span>}
        </div>
        {canAdjust && (
          <button
            onClick={() => onAdjustExpiry(p)}
            title="Cambiar la fecha de caducidad del bono (pide motivo, queda registrado)"
            style={expiryBtn}
          >
            📅 {p.end ? "Caducidad" : "Poner caducidad"}
          </button>
        )}
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
                    <span style={{ color: "#1a1a2e" }}>{s.used}/{s.sessions_in_package} usadas</span>
                    <span style={{ color: "#888", fontWeight: 600 }}> · {s.remaining} libres</span>
                  </span>
                  {!expired && canAdjust && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }} title="Sumar o quitar sesiones del bono (pide motivo)">
                      <button
                        onClick={() => onAdjust(p, s, -1)}
                        disabled={s.sessions_in_package <= s.used}
                        title={s.sessions_in_package <= s.used ? "No se puede bajar de las sesiones ya usadas" : "Quitar sesiones"}
                        style={{ ...adjustBtn, opacity: s.sessions_in_package <= s.used ? 0.4 : 1, cursor: s.sessions_in_package <= s.used ? "not-allowed" : "pointer" }}
                      >−</button>
                      <button
                        onClick={() => onAdjust(p, s, +1)}
                        title="Añadir sesiones"
                        style={adjustBtn}
                      >+</button>
                    </span>
                  )}
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

// Diagnóstico 9,99€ = servicios 8/11. Solo se puede reprogramar 1 vez.
const DIAG_SERVICE_IDS = [8, 11];

function ApptRow({ a, conversationId, onReschedule, onChangeProvider, onCancel }: { a: Appt; conversationId: string | null; onReschedule: () => void; onChangeProvider: () => void; onCancel: () => Promise<void> }) {
  const [sendingMeet, setSendingMeet] = useState(false);
  const isDiag = a.service_id != null && DIAG_SERVICE_IDS.includes(a.service_id);
  const rescheduleLocked = isDiag && (a.reschedule_count ?? 0) >= 1;

  async function sendMeetToChat() {
    if (!conversationId || !a.google_meet_url) return;
    if (!confirm(`¿Enviar el link de Meet por WhatsApp en esta conversación?`)) return;
    setSendingMeet(true);
    try {
      const r = await fetch("/api/agent/amelia/send-meet-whatsapp", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: conversationId, appointment_id: a.appointment_id }),
      });
      const d = await r.json();
      if (r.ok) alert("✅ Meet enviado por WhatsApp");
      else alert("❌ " + (d.message ?? d.error ?? "Error enviando"));
    } finally { setSendingMeet(false); }
  }

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
      {rescheduleLocked && (
        <div style={{ fontSize: 10.5, color: "#991b1b", fontWeight: 800, background: "rgba(153,27,27,0.08)", border: "1px solid rgba(153,27,27,0.18)", padding: "4px 7px", borderRadius: 6 }}>
          🔒 Diagnóstico 9,99€ ya reprogramado 1 vez · no se puede reprogramar más
        </div>
      )}
      <div style={{ display: "flex", gap: 5, marginTop: 4, flexWrap: "wrap" }}>
        {a.google_meet_url && conversationId && (
          <button onClick={() => void sendMeetToChat()} disabled={sendingMeet} style={{ ...smallBtn(true), opacity: sendingMeet ? 0.5 : 1 }}>
            {sendingMeet ? "Enviando…" : "📨 Reenviar Meet"}
          </button>
        )}
        {rescheduleLocked ? (
          <span title="Las citas de diagnóstico 9,99€ solo se pueden reprogramar una vez" style={{ ...smallBtn(false), cursor: "not-allowed", opacity: 0.5, background: "rgba(0,0,0,0.04)", color: "#999" }}>
            🔒 No se puede reprogramar
          </span>
        ) : (
          <button onClick={onReschedule} style={smallBtn(false)}>🔄 Reagendar</button>
        )}
        <button onClick={onChangeProvider} style={smallBtn(false)}>👩‍⚕️ Cambiar psi</button>
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
                  {d.toLocaleDateString("es-ES", { timeZone: "Europe/Madrid", weekday: "long", day: "numeric", month: "long" })}
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
                  {d.toLocaleDateString("es-ES", { timeZone: "Europe/Madrid", weekday: "long", day: "numeric", month: "long" })}
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

function ChangeProviderModal({ appt, providers, conversationId, onClose, onChanged }: { appt: Appt; providers: Provider[]; conversationId: string | null; onClose: () => void; onChanged: () => void }) {
  const [picked, setPicked] = useState<number | null>(null);
  const [filter, setFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const filtered = useMemo(() => {
    const q = filter.toLowerCase();
    return providers
      .filter((p) => p.id !== appt.provider_id)
      .filter((p) => q ? p.name.toLowerCase().includes(q) || (p.email ?? "").toLowerCase().includes(q) : true);
  }, [providers, filter, appt.provider_id]);

  async function go() {
    if (!picked) return;
    setSaving(true);
    try {
      const r = await fetch("/api/agent/amelia/booking-action", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "change_provider", appointment_id: appt.appointment_id, new_provider_id: picked, conversation_id: conversationId }),
      });
      const d = await r.json();
      if (r.ok) {
        const meetMsg = d.result?.google_meet_url
          ? `\n📹 Nuevo Meet: ${d.result.google_meet_url}`
          : d.result?.meet_warnings?.length ? `\n⚠️ Meet no se pudo crear (${d.result.meet_warnings[0].slice(0,100)})` : "";
        alert(`✅ Psicóloga cambiada${meetMsg}`);
        onChanged();
      } else alert("❌ " + (d.friendly ?? d.error ?? "Error cambiando psicóloga"));
    } finally { setSaving(false); }
  }

  return (
    <ModalShell title="👩‍⚕️ Cambiar psicóloga de la cita" subtitle={`Cita ${fmtMadrid(appt.booking_start_utc)} actualmente con ${appt.provider_name ?? "—"}`} onClose={onClose}>
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Buscar por nombre o email…"
        style={{ width: "100%", padding: "7px 10px", fontSize: 12, border: "1px solid rgba(0,0,0,0.12)", borderRadius: 8, fontFamily: "inherit", marginBottom: 10, boxSizing: "border-box" }}
      />
      <div style={{ maxHeight: 320, overflow: "auto", display: "grid", gap: 4 }}>
        {filtered.length === 0 && <div style={{ color: "#aaa", fontSize: 12, padding: 16, textAlign: "center" }}>Sin resultados.</div>}
        {filtered.map((p) => (
          <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: 8, background: picked === p.id ? "rgba(106,23,140,0.08)" : "#fff", border: `1px solid ${picked === p.id ? PURPLE : "rgba(0,0,0,0.06)"}`, borderRadius: 8, cursor: "pointer" }}>
            <input type="radio" checked={picked === p.id} onChange={() => setPicked(p.id)} style={{ accentColor: PURPLE }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#1a1a2e" }}>{p.name}</div>
              {p.email && <div style={{ fontSize: 10.5, color: "#888" }}>{p.email}</div>}
            </div>
          </label>
        ))}
      </div>
      <div style={{ marginTop: 10, padding: 10, background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.25)", borderRadius: 8, fontSize: 11, color: "#92400e" }}>
        ⚠️ Se borrará el Meet de la psicóloga anterior y se creará uno nuevo con la nueva. La hora y el bono se mantienen.
      </div>
      <ModalFooter>
        <button onClick={onClose} style={smallBtn(false)}>Cancelar</button>
        <button onClick={go} disabled={!picked || saving} style={{ ...primaryBtn, opacity: !picked || saving ? 0.5 : 1, cursor: !picked || saving ? "default" : "pointer" }}>
          {saving ? "Cambiando…" : "✅ Confirmar cambio"}
        </button>
      </ModalFooter>
    </ModalShell>
  );
}

function AdjustSessionsModal({ p, s, sign, customerName, conversationId, onClose, onDone }: { p: Package; s: PackageService; sign: 1 | -1; customerName: string; conversationId: string | null; onClose: () => void; onDone: () => void }) {
  const add = sign > 0;
  const maxRemovable = Math.max(0, s.sessions_in_package - s.used); // no se puede bajar de lo ya usado
  const [qty, setQty] = useState(1);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const qtyValid = add ? qty >= 1 : qty >= 1 && qty <= maxRemovable;
  const reasonValid = reason.trim().length >= 3;
  const canSubmit = qtyValid && reasonValid && !saving;
  const newTotal = s.sessions_in_package + sign * qty;

  async function submit() {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const r = await fetch("/api/agent/amelia/booking-action", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "adjust_sessions", package_customer_service_id: s.id, delta: sign * qty, reason: reason.trim(), conversation_id: conversationId }),
      });
      const d = await r.json();
      if (r.ok) {
        alert(`✅ Bono actualizado · ahora ${d.result.new_total} sesiones (${d.result.remaining} libres)`);
        onDone();
      } else {
        alert("❌ " + (d.friendly ?? d.error ?? "Error ajustando sesiones"));
      }
    } finally { setSaving(false); }
  }

  return (
    <ModalShell
      title={add ? "➕ Añadir sesiones al bono" : "➖ Quitar sesiones del bono"}
      subtitle={`${customerName} · ${p.name} · ${s.service_name ?? "servicio"} · ${s.used}/${s.sessions_in_package} usadas`}
      onClose={onClose}
    >
      <div style={{ display: "grid", gap: 14 }}>
        <div>
          <label style={{ display: "block", fontSize: 11, fontWeight: 800, color: "#475569", marginBottom: 5 }}>
            {add ? "¿Cuántas sesiones añadir?" : "¿Cuántas sesiones quitar?"}
          </label>
          <input
            type="number" min={1} max={add ? undefined : maxRemovable} value={qty}
            onChange={(e) => setQty(Math.max(1, Math.trunc(Number(e.target.value) || 1)))}
            style={{ width: 100, padding: "7px 10px", fontSize: 13, border: "1px solid rgba(0,0,0,0.12)", borderRadius: 8, fontFamily: "inherit" }}
          />
          <div style={{ fontSize: 11, color: "#888", marginTop: 5 }}>
            Total: <strong>{s.sessions_in_package}</strong> → <strong style={{ color: PURPLE }}>{newTotal}</strong> sesiones
            {!add && <span> · máx. a quitar: {maxRemovable}</span>}
          </div>
          {!qtyValid && !add && <div style={{ fontSize: 11, color: "#991b1b", marginTop: 4 }}>No puedes quitar más de {maxRemovable} (las demás ya están usadas/reservadas).</div>}
        </div>

        <div>
          <label style={{ display: "block", fontSize: 11, fontWeight: 800, color: "#475569", marginBottom: 5 }}>
            Motivo <span style={{ color: "#dc2626" }}>*</span> <span style={{ fontWeight: 500, color: "#888" }}>(obligatorio · queda registrado)</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={add ? "Ej: sesión de cortesía por incidencia con la psicóloga…" : "Ej: el paciente no compró todas las sesiones del plan…"}
            rows={3}
            style={{ width: "100%", padding: "8px 10px", fontSize: 12.5, border: `1px solid ${reason && !reasonValid ? "#fca5a5" : "rgba(0,0,0,0.12)"}`, borderRadius: 8, fontFamily: "inherit", boxSizing: "border-box", resize: "vertical" }}
          />
          {reason && !reasonValid && <div style={{ fontSize: 11, color: "#991b1b", marginTop: 4 }}>Escribe un motivo (mínimo 3 caracteres).</div>}
        </div>
      </div>
      <ModalFooter>
        <button onClick={onClose} style={smallBtn(false)}>Cancelar</button>
        <button onClick={() => void submit()} disabled={!canSubmit} style={{ ...primaryBtn, opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? "pointer" : "default" }}>
          {saving ? "Guardando…" : add ? `✅ Añadir ${qty} sesión(es)` : `✅ Quitar ${qty} sesión(es)`}
        </button>
      </ModalFooter>
    </ModalShell>
  );
}

function ExpiryModal({ p, customerName, conversationId, onClose, onDone }: { p: Package; customerName: string; conversationId: string | null; onClose: () => void; onDone: () => void }) {
  const currentEndYMD = p.end ? new Date(p.end).toLocaleDateString("en-CA", { timeZone: "Europe/Madrid" }) : null;
  const todayYMD = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Madrid" });
  const [date, setDate] = useState<string>(currentEndYMD ?? "");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(date) && date > todayYMD;
  const reasonValid = reason.trim().length >= 3;
  const canSubmit = dateValid && reasonValid && !saving;
  const isShortening = !!(currentEndYMD && dateValid && date < currentEndYMD);
  const fmtEnd = p.end ? new Date(p.end).toLocaleDateString("es-ES", { timeZone: "Europe/Madrid" }) : null;

  async function submit() {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const r = await fetch("/api/agent/amelia/booking-action", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "adjust_expiry", package_customer_id: p.package_customer_id, new_end_date: date, reason: reason.trim(), conversation_id: conversationId }),
      });
      const d = await r.json();
      if (r.ok) {
        alert(`✅ Caducidad actualizada · ahora vence el ${new Date(d.result.new_end).toLocaleDateString("es-ES", { timeZone: "Europe/Madrid" })}`);
        onDone();
      } else {
        alert("❌ " + (d.friendly ?? d.error ?? "Error cambiando la caducidad"));
      }
    } finally { setSaving(false); }
  }

  return (
    <ModalShell
      title="📅 Cambiar caducidad del bono"
      subtitle={`${customerName} · ${p.name} · ${fmtEnd ? `vence ${fmtEnd}` : "sin caducidad"}`}
      onClose={onClose}
    >
      <div style={{ display: "grid", gap: 14 }}>
        <div>
          <label style={{ display: "block", fontSize: 11, fontWeight: 800, color: "#475569", marginBottom: 5 }}>
            Nueva fecha de caducidad
          </label>
          <input
            type="date" value={date} min={todayYMD}
            onChange={(e) => setDate(e.target.value)}
            style={{ padding: "7px 10px", fontSize: 13, border: "1px solid rgba(0,0,0,0.12)", borderRadius: 8, fontFamily: "inherit" }}
          />
          {date && !dateValid && <div style={{ fontSize: 11, color: "#991b1b", marginTop: 4 }}>La fecha debe ser futura (posterior a hoy).</div>}
          {isShortening && fmtEnd && <div style={{ fontSize: 11, color: "#b45309", marginTop: 4 }}>⚠️ Estás ACORTANDO la caducidad (antes vencía el {fmtEnd}).</div>}
          {p.is_expired && dateValid && <div style={{ fontSize: 11, color: "#065f46", marginTop: 4 }}>♻️ Este bono está vencido — al guardar volverá a estar activo.</div>}
        </div>

        <div>
          <label style={{ display: "block", fontSize: 11, fontWeight: 800, color: "#475569", marginBottom: 5 }}>
            Motivo <span style={{ color: "#dc2626" }}>*</span> <span style={{ fontWeight: 500, color: "#888" }}>(obligatorio · queda registrado)</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ej: ampliamos 1 mes porque la paciente estuvo de baja médica…"
            rows={3}
            style={{ width: "100%", padding: "8px 10px", fontSize: 12.5, border: `1px solid ${reason && !reasonValid ? "#fca5a5" : "rgba(0,0,0,0.12)"}`, borderRadius: 8, fontFamily: "inherit", boxSizing: "border-box", resize: "vertical" }}
          />
          {reason && !reasonValid && <div style={{ fontSize: 11, color: "#991b1b", marginTop: 4 }}>Escribe un motivo (mínimo 3 caracteres).</div>}
        </div>
      </div>
      <ModalFooter>
        <button onClick={onClose} style={smallBtn(false)}>Cancelar</button>
        <button onClick={() => void submit()} disabled={!canSubmit} style={{ ...primaryBtn, opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? "pointer" : "default" }}>
          {saving ? "Guardando…" : "✅ Guardar caducidad"}
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
const adjustBtn: React.CSSProperties = { width: 22, height: 22, lineHeight: "20px", textAlign: "center", padding: 0, fontSize: 14, fontWeight: 900, borderRadius: 6, border: `1px solid ${PURPLE}55`, background: "#fff", color: PURPLE, fontFamily: "inherit" };
const expiryBtn: React.CSSProperties = { padding: "3px 9px", fontSize: 10.5, fontWeight: 800, borderRadius: 999, border: `1px solid ${PURPLE}55`, background: "#fff", color: PURPLE, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" };
const primaryBtn: React.CSSProperties = { padding: "7px 14px", fontSize: 12, fontWeight: 800, borderRadius: 8, border: "none", background: "linear-gradient(135deg, #6A178C 0%, #8B2FB5 100%)", color: "#fff", cursor: "pointer", fontFamily: "inherit" };
