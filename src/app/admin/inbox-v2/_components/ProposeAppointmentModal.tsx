"use client";

import { useEffect, useState } from "react";

const PURPLE = "#6A178C";

type Slot = { day: string; weekday: string; hour: number; iso: string };

export default function ProposeAppointmentModal({
  providerAmeliaId,
  psychologistName,
  leadName,
  leadPhone,
  leadEmail,
  onClose,
  onInsertText,
}: {
  providerAmeliaId: number | null;
  psychologistName: string | null;
  leadName: string | null;
  leadPhone: string | null;
  leadEmail: string | null;
  onClose: () => void;
  onInsertText: (text: string) => void;
}) {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [bookingUrl, setBookingUrl] = useState("https://mentesanapsicologia.com/reservar");
  const [upcomingMeets, setUpcomingMeets] = useState<{ id: number; booking_start: string; google_meet_url: string | null; provider_name: string; service_name: string | null }[]>([]);

  useEffect(() => {
    if (!providerAmeliaId) { setLoading(false); return; }
    setLoading(true);
    fetch(`/api/agent/amelia/free-slots?provider_id=${providerAmeliaId}`, { credentials: "include" })
      .then((r) => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then((d) => { setSlots(d.slots ?? []); })
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [providerAmeliaId]);

  // Carga citas próximas YA reservadas (con googleMeetUrl) para este lead
  useEffect(() => {
    if (!leadPhone && !leadEmail) return;
    const qs = new URLSearchParams();
    if (leadPhone) qs.set("phone", leadPhone);
    if (leadEmail) qs.set("email", leadEmail);
    fetch(`/api/agent/amelia/upcoming-meet?${qs}`, { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => setUpcomingMeets((d?.appointments ?? []).filter((a: any) => a.google_meet_url)))
      .catch(() => {});
  }, [leadPhone, leadEmail]);

  function toggle(iso: string) {
    setPicked((p) => p.includes(iso) ? p.filter((x) => x !== iso) : [...p, iso].slice(0, 3));
  }

  const text = (() => {
    if (picked.length === 0) return "";
    const labels = picked
      .sort()
      .map((iso) => {
        const d = new Date(iso);
        const weekday = d.toLocaleDateString("es-ES", { timeZone: "Europe/Madrid", weekday: "long" });
        const dayNum = d.toLocaleDateString("es-ES", { timeZone: "Europe/Madrid", day: "numeric", month: "long" });
        const hour = d.toLocaleTimeString("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hour12: false });
        return `${weekday} ${dayNum} a las ${hour}`;
      });
    const name = leadName?.trim().split(" ")[0] ?? "";
    const greeting = name ? `Hola ${name},` : "Hola,";
    const psyLine = psychologistName ? ` con ${psychologistName.trim()}` : "";
    const choices = labels.length === 1
      ? `tendría disponible ${labels[0]}`
      : `tendría estos huecos${psyLine}:\n${labels.map((l) => `• ${l}`).join("\n")}`;
    return `${greeting} ${choices}.\n\n¿Cuál te viene mejor? Confírmame y reservamos la sesión 💜`;
  })();

  // Agrupar slots por dia
  const byDay = new Map<string, Slot[]>();
  for (const s of slots) {
    if (!byDay.has(s.day)) byDay.set(s.day, []);
    byDay.get(s.day)!.push(s);
  }

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100 }} />
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: "min(720px, 95vw)", maxHeight: "90vh", background: "#fff", borderRadius: 14, zIndex: 101, boxShadow: "0 30px 80px rgba(0,0,0,0.3)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <header style={{ padding: "12px 16px", borderBottom: "1px solid rgba(0,0,0,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <strong style={{ fontSize: 14, color: "#1a1a2e" }}>📅 Proponer horario de sesión</strong>
            {psychologistName && <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{psychologistName}</div>}
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", fontSize: 22, cursor: "pointer", color: "#666" }}>×</button>
        </header>

        <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
          {!providerAmeliaId && (
            <div style={{ padding: 16, background: "#fef3c7", border: "1px solid #fbbf24", borderRadius: 8, fontSize: 12, color: "#92400e", marginBottom: 12 }}>
              ⚠️ La conversación no tiene psicóloga asignada. Asígnale una en el header del chat.
            </div>
          )}
          {upcomingMeets.length > 0 && (
            <div style={{ padding: 12, background: "linear-gradient(135deg, rgba(16,185,129,0.08) 0%, rgba(16,185,129,0.04) 100%)", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 10, marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: "#065f46", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>
                📹 {upcomingMeets.length === 1 ? "Cita reservada con Google Meet" : `${upcomingMeets.length} citas próximas con Meet`}
              </div>
              {upcomingMeets.slice(0, 5).map((a) => {
                const d = new Date(a.booking_start);
                const dayLbl = d.toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Madrid" });
                const hourLbl = d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Madrid" });
                const meetMsg = `Te confirmo nuestra cita ${dayLbl} a las ${hourLbl}${a.provider_name ? ` con ${a.provider_name}` : ""}.\n\nÉste es el enlace de Google Meet para conectarnos:\n${a.google_meet_url}\n\nNos vemos pronto 💜`;
                return (
                  <div key={a.id} style={{ padding: 8, background: "#fff", borderRadius: 8, marginBottom: 6, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#1a1a2e" }}>{dayLbl} · {hourLbl}</div>
                      <div style={{ fontSize: 11, color: "#666" }}>{a.provider_name}{a.service_name ? ` · ${a.service_name}` : ""}</div>
                      <a href={a.google_meet_url!} target="_blank" rel="noreferrer" style={{ fontSize: 10.5, color: "#065f46", fontWeight: 600, textDecoration: "none", wordBreak: "break-all" }}>{a.google_meet_url}</a>
                    </div>
                    <button
                      onClick={() => { onInsertText(meetMsg); onClose(); }}
                      style={{ padding: "5px 10px", fontSize: 10.5, fontWeight: 800, borderRadius: 6, border: "none", background: "linear-gradient(135deg, #16a34a 0%, #22c55e 100%)", color: "#fff", cursor: "pointer", letterSpacing: 0.3 }}
                    >📨 Enviar Meet al chat</button>
                  </div>
                );
              })}
            </div>
          )}
          {err && <div style={{ padding: 10, background: "#fef2f2", color: "#991b1b", borderRadius: 8, fontSize: 12, marginBottom: 12 }}>⚠️ {err}</div>}
          {loading && <div style={{ color: "#888", fontSize: 13 }}>Cargando huecos…</div>}
          {!loading && slots.length > 0 && (
            <>
              <p style={{ fontSize: 12, color: "#475569", margin: "0 0 10px" }}>
                Selecciona hasta <strong>3 huecos</strong> que ofrecerás al cliente. Mostramos los próximos 7 días en horas habituales.
              </p>
              {Array.from(byDay.entries()).map(([day, ss]) => {
                const d = new Date(day);
                const weekday = d.toLocaleDateString("es-ES", { weekday: "long" });
                const dayLabel = d.toLocaleDateString("es-ES", { day: "numeric", month: "long" });
                return (
                  <div key={day} style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
                      {weekday} {dayLabel}
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {ss.map((s) => {
                        const sel = picked.includes(s.iso);
                        return (
                          <button
                            key={s.iso}
                            onClick={() => toggle(s.iso)}
                            style={{
                              padding: "6px 12px",
                              fontSize: 12,
                              fontWeight: 700,
                              borderRadius: 999,
                              border: sel ? `2px solid ${PURPLE}` : "1px solid rgba(0,0,0,0.1)",
                              background: sel ? PURPLE : "#fff",
                              color: sel ? "#fff" : "#475569",
                              cursor: "pointer",
                            }}
                          >
                            {sel ? "✓ " : ""}{String(s.hour).padStart(2, "0")}:00
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </>
          )}
          {!loading && !err && slots.length === 0 && providerAmeliaId && (
            <div style={{ color: "#888", fontSize: 12 }}>Sin huecos disponibles los próximos días (todos ocupados o sin agenda).</div>
          )}

          {text && (
            <div style={{ marginTop: 16, padding: 12, background: "rgba(106,23,140,0.04)", borderRadius: 10, border: `1px solid rgba(106,23,140,0.15)` }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: PURPLE, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Mensaje a enviar</div>
              <pre style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: "#1a1a2e", whiteSpace: "pre-wrap", fontFamily: "inherit" }}>{text}</pre>
            </div>
          )}

          <div style={{ marginTop: 16 }}>
            <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Link de reserva (opcional)</label>
            <input value={bookingUrl} onChange={(e) => setBookingUrl(e.target.value)} style={{ width: "100%", padding: "7px 10px", fontSize: 12, border: "1px solid rgba(0,0,0,0.12)", borderRadius: 8, fontFamily: "inherit" }} />
          </div>
        </div>

        <footer style={{ padding: "10px 16px", borderTop: "1px solid rgba(0,0,0,0.06)", display: "flex", justifyContent: "space-between", gap: 10 }}>
          <button onClick={onClose} style={{ padding: "8px 14px", fontSize: 12, fontWeight: 700, borderRadius: 8, border: "1px solid rgba(0,0,0,0.1)", background: "#fff", color: "#475569", cursor: "pointer" }}>Cancelar</button>
          <button
            onClick={() => {
              if (!text) return;
              const finalText = bookingUrl ? `${text}\n\n${bookingUrl}` : text;
              onInsertText(finalText);
              onClose();
            }}
            disabled={!text}
            style={{
              padding: "8px 16px",
              fontSize: 12,
              fontWeight: 800,
              borderRadius: 8,
              border: "none",
              cursor: !text ? "default" : "pointer",
              background: !text ? "rgba(0,0,0,0.08)" : "linear-gradient(135deg, #6A178C 0%, #8B2FB5 100%)",
              color: !text ? "#888" : "#fff",
            }}
          >
            📝 Insertar en composer
          </button>
        </footer>
      </div>
    </>
  );
}
