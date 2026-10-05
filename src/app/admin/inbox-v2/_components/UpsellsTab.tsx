"use client";

// Pestaña "Upsells" del side panel del inbox: qué ha comprado ya el lead (Stripe)
// y qué ofrecerle ahora, con el link de pago listo para copiar al chat.
// Datos: /api/agent/upsells-status (payments BLOG + upsell_paid + bono Amelia).
import { useEffect, useState } from "react";

const PURPLE = "#6A178C";

type Compra = { id: string; fecha: string; importe: number; key: string | null; nombre: string; grupo: string; email: string | null; source: string | null };
type Oferta = { key: string; nombre: string; precioTexto: string; link: string | null; descripcion: string; grupo: string; prioridad?: number };
type Resp = {
  ok: boolean;
  lead: { email: string | null; phone: string | null; emails_pago: string[] };
  situacion: "sin_compras" | "solo_diagnostico" | "bono_activo" | "bono_agotandose" | "sin_bono_activo";
  motivo: string;
  bono: { nombre: string; total: number; usadas: number; restantes: number; caduca: string | null } | null;
  amelia_ok: boolean;
  compras: Compra[];
  total_gastado: number;
  ofrecer: Oferta[];
  resto: Oferta[];
};

const SITUACION: Record<Resp["situacion"], { label: string; bg: string; fg: string }> = {
  sin_compras: { label: "Sin compras", bg: "rgba(0,0,0,0.05)", fg: "#475569" },
  solo_diagnostico: { label: "Solo diagnóstico · cerrar bono", bg: "rgba(106,23,140,0.1)", fg: PURPLE },
  bono_activo: { label: "Bono activo", bg: "rgba(16,185,129,0.12)", fg: "#047857" },
  bono_agotandose: { label: "Bono agotándose · renovar", bg: "rgba(245,158,11,0.14)", fg: "#92400e" },
  sin_bono_activo: { label: "Sin bono activo · reenganchar", bg: "rgba(239,68,68,0.1)", fg: "#991b1b" },
};
const GRUPO_EMOJI: Record<string, string> = { bono: "🎫", sesion: "💬", documento: "📄", otro: "⏳" };
const eur = (n: number) => n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "€";
const fecha = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" }) : "—");

export default function UpsellsTab({ phone, email }: { phone: string | null; email: string | null }) {
  // Un único estado por lead (clave phone|email): mientras la clave no coincide con
  // lo cargado, se muestra "cargando" sin setState síncrono en el efecto.
  const leadKey = `${phone ?? ""}|${email ?? ""}`;
  const [state, setState] = useState<{ key: string; data: Resp | null; err: string | null }>({ key: "", data: null, err: null });
  const [verResto, setVerResto] = useState(false);

  useEffect(() => {
    if (!phone && !email) return;
    let cancelled = false;
    const qs = new URLSearchParams();
    if (phone) qs.set("phone", phone);
    if (email) qs.set("email", email);
    fetch(`/api/agent/upsells-status?${qs}`, { credentials: "include" })
      .then(async (r) => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`); return r.json() as Promise<Resp>; })
      .then((data) => { if (!cancelled) setState({ key: leadKey, data, err: null }); })
      .catch((e) => { if (!cancelled) setState({ key: leadKey, data: null, err: String(e.message ?? e) }); });
    return () => { cancelled = true; };
  }, [phone, email, leadKey]);

  if (!phone && !email) return <Empty>Selecciona una conversación.</Empty>;
  if (state.key !== leadKey) return <Empty>Cargando compras…</Empty>;
  if (state.err) return <div style={{ padding: 10, background: "#fef2f2", color: "#991b1b", borderRadius: 8, fontSize: 11.5 }}>⚠️ {state.err}</div>;
  const data = state.data;
  if (!data) return null;

  const sit = SITUACION[data.situacion];
  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* Situación */}
      <section style={{ padding: 10, background: sit.bg, borderRadius: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <strong style={{ fontSize: 12.5, color: sit.fg }}>{sit.label}</strong>
          <span style={{ fontSize: 11, color: "#666" }}>Gastado: <strong style={{ color: "#1a1a2e" }}>{eur(data.total_gastado)}</strong> · {data.compras.length} pago{data.compras.length === 1 ? "" : "s"}</span>
        </div>
        <p style={{ margin: "6px 0 0", fontSize: 11.5, color: "#444", lineHeight: 1.45 }}>{data.motivo}</p>
        {data.bono && (
          <div style={{ marginTop: 8, fontSize: 11.5, color: "#1a1a2e" }}>
            🎫 <strong>{data.bono.nombre}</strong> · {data.bono.restantes} de {data.bono.total} sesiones restantes{data.bono.caduca ? ` · caduca ${fecha(data.bono.caduca)}` : ""}
          </div>
        )}
        {!data.amelia_ok && <div style={{ marginTop: 6, fontSize: 10.5, color: "#92400e" }}>⚠️ Amelia no respondió: el bono puede no estar reflejado.</div>}
      </section>

      {/* Qué ofrecer */}
      <Section title="💡 Qué ofrecerle ahora" subtitle="en orden de prioridad">
        {data.ofrecer.length === 0 ? <div style={{ fontSize: 11, color: "#aaa" }}>Ya lo tiene todo comprado.</div> : (
          <div style={{ display: "grid", gap: 6 }}>
            {data.ofrecer.map((o) => <OfertaCard key={o.key} o={o} destacada={o.prioridad === 1} />)}
          </div>
        )}
        {data.resto.length > 0 && (
          <button type="button" onClick={() => setVerResto((v) => !v)} style={{ marginTop: 8, background: "transparent", border: "none", color: PURPLE, fontSize: 11, fontWeight: 700, cursor: "pointer", padding: 0 }}>
            {verResto ? "Ocultar" : `Ver ${data.resto.length} más`} {verResto ? "▴" : "▾"}
          </button>
        )}
        {verResto && <div style={{ display: "grid", gap: 6, marginTop: 6 }}>{data.resto.map((o) => <OfertaCard key={o.key} o={o} />)}</div>}
      </Section>

      {/* Ya compró */}
      <Section title={`✅ Ya ha comprado · ${data.compras.length}`} subtitle="Stripe · pagos completados">
        {data.compras.length === 0 ? <div style={{ fontSize: 11, color: "#aaa" }}>Sin pagos registrados con este email/teléfono.</div> : (
          <div style={{ display: "grid", gap: 4 }}>
            {data.compras.map((c) => (
              <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", background: "#fff", borderRadius: 8, border: "1px solid rgba(0,0,0,0.06)" }}>
                <span style={{ fontSize: 14 }} aria-hidden>{GRUPO_EMOJI[c.grupo] ?? "💳"}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#1a1a2e", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.nombre}{!c.key && <span style={{ fontSize: 9.5, color: "#92400e", marginLeft: 6 }}>sin clasificar</span>}</div>
                  <div style={{ fontSize: 10.5, color: "#888" }}>{fecha(c.fecha)}{c.email && data.lead.email && c.email !== data.lead.email ? ` · ${c.email}` : ""}</div>
                </div>
                <strong style={{ fontSize: 12, color: PURPLE, fontVariantNumeric: "tabular-nums" }}>{eur(c.importe)}</strong>
              </div>
            ))}
          </div>
        )}
        {data.lead.emails_pago.length > 1 && <div style={{ marginTop: 6, fontSize: 10, color: "#888" }}>Emails con pagos: {data.lead.emails_pago.join(" · ")}</div>}
      </Section>
    </div>
  );
}

function OfertaCard({ o, destacada }: { o: Oferta; destacada?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copiar = async () => {
    if (!o.link) return;
    try { await navigator.clipboard.writeText(o.link); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };
  return (
    <div style={{ padding: 9, background: "#fff", borderRadius: 10, border: `1px solid ${destacada ? PURPLE + "66" : "rgba(0,0,0,0.07)"}`, boxShadow: destacada ? `0 2px 10px ${PURPLE}1a` : "none" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <strong style={{ fontSize: 12.5, color: "#1a1a2e" }}>{GRUPO_EMOJI[o.grupo] ?? "💳"} {o.nombre}</strong>
        <span style={{ fontSize: 12, fontWeight: 800, color: PURPLE, whiteSpace: "nowrap" }}>{o.precioTexto}</span>
      </div>
      <p style={{ margin: "4px 0 0", fontSize: 11, color: "#555", lineHeight: 1.4 }}>{o.descripcion}</p>
      <div style={{ display: "flex", gap: 6, marginTop: 7 }}>
        {o.link ? (
          <>
            <button type="button" onClick={copiar} style={{ padding: "5px 10px", fontSize: 11, fontWeight: 700, borderRadius: 6, border: "none", background: copied ? "#16a34a" : PURPLE, color: "#fff", cursor: "pointer", fontFamily: "inherit" }}>{copied ? "Copiado ✓" : "Copiar link"}</button>
            <a href={o.link} target="_blank" rel="noopener noreferrer" style={{ padding: "5px 10px", fontSize: 11, fontWeight: 700, borderRadius: 6, border: "1px solid rgba(0,0,0,0.1)", color: "#475569", textDecoration: "none" }}>Abrir ↗</a>
          </>
        ) : (
          <span style={{ fontSize: 10.5, color: "#888" }}>Sin link fijo: usa 💳 “Generar link de pago” del chat con este importe.</span>
        )}
      </div>
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
function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: 24, color: "#aaa", fontSize: 12, textAlign: "center" }}>{children}</div>;
}
