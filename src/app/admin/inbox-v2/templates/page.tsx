"use client";

// 📝 Plantillas de WhatsApp — creador para las agentes del CRM, dentro de inbox-v2.
//   · Formulario con las reglas de Meta aplicadas en vivo (src/lib/wa-template-builder): nombre interno
//     automático, categoría, encabezado/cuerpo/pie, variables {{1}}… con ejemplos y hasta 3 botones;
//     vista previa tal y como lo verá la paciente; se envía a revisión de Meta (1 min – 24 h).
//   · Lista de todas las plantillas de los números activos con estado, motivo de rechazo y calidad;
//     «Usar como base» precarga el formulario (para sacar variantes) y las rechazadas/pendientes se
//     pueden borrar. API: /api/agent/inbox/template-builder. También se muestra en /agent/plantillas.
import { useCallback, useEffect, useState } from "react";
import { rejectedReasonLabel } from "@/lib/wa-template-builder";
import { TemplateForm, emptySeed, seedFromTemplate, TEMPLATE_BUILDER_API as API, btnSec, card, errBox, inp, pill, type Seed, type TplInfo as Tpl, type WaNumberInfo as WaNumber } from "../_components/TemplateCreator";

const PURPLE = "#6A178C";



export default function TemplatesAdminPage() {
  const [numbers, setNumbers] = useState<WaNumber[]>([]);
  const [templates, setTemplates] = useState<Tpl[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [seed, setSeed] = useState<Seed>(emptySeed);
  const [seedKey, setSeedKey] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(API, { credentials: "include", cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setNumbers(d.numbers ?? []);
      setTemplates(d.templates ?? []);
      setErrors(d.errors ?? []);
      setLoadErr(null);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { queueMicrotask(() => { void load(); }); }, [load]);

  const useAsBase = (t: Tpl) => {
    setSeed(seedFromTemplate(t));
    setSeedKey((k) => k + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const pending = templates.filter((t) => t.status === "PENDING").length;
  const rejected = templates.filter((t) => t.status === "REJECTED").length;

  return (
    <div style={{ padding: "20px 24px", maxWidth: 1400, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <h1 style={{ margin: 0, fontSize: 22, color: "#1a1a2e", fontWeight: 900 }}>📝 Plantillas de WhatsApp</h1>
          <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "#64748b", lineHeight: 1.5 }}>
            Escribe la plantilla, mírala en la vista previa y envíala a Meta. La revisan entre 1 minuto y 24 horas; cuando pase a <strong>aprobada</strong> ya se puede enviar desde 📋 Plantillas.
          </p>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {pending > 0 && <span style={pill("#d97706")}>⏳ {pending} pendiente{pending === 1 ? "" : "s"}</span>}
          {rejected > 0 && <span style={pill("#dc2626")}>❌ {rejected} rechazada{rejected === 1 ? "" : "s"}</span>}
          <button type="button" onClick={() => void load()} disabled={loading} style={btnSec}>{loading ? "Cargando…" : "🔄 Actualizar estados"}</button>
          <a href="/admin/inbox-v2" style={{ ...btnSec, textDecoration: "none" }}>← Inbox</a>
        </div>
      </header>

      {flash && <div style={{ padding: "10px 14px", background: "rgba(16,185,129,0.1)", color: "#065f46", borderRadius: 10, fontSize: 13, fontWeight: 700, marginBottom: 12 }}>✓ {flash}</div>}
      {loadErr && <div style={errBox}>⚠️ No se pudo cargar: {loadErr}</div>}
      {errors.length > 0 && <div style={{ ...errBox, background: "#fffbeb", borderColor: "#fde68a", color: "#92400e" }}>⚠️ {errors.join(" · ")}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 18, alignItems: "start" }}>
        <TemplateForm key={seedKey} numbers={numbers} seed={seed} existing={templates} onCreated={(msg) => { setFlash(msg); window.setTimeout(() => setFlash(null), 6000); setSeed(emptySeed()); setSeedKey((k) => k + 1); void load(); }} />
        <TemplateList templates={templates} numbers={numbers} loading={loading} onUseAsBase={useAsBase} onDeleted={(name) => { setFlash(`Plantilla «${name}» eliminada en Meta.`); window.setTimeout(() => setFlash(null), 5000); void load(); }} />
      </div>
    </div>
  );
}

// ─── Lista ───────────────────────────────────────────────────────────────────
function TemplateList({ templates, numbers, loading, onUseAsBase, onDeleted }: { templates: Tpl[]; numbers: WaNumber[]; loading: boolean; onUseAsBase: (t: Tpl) => void; onDeleted: (name: string) => void }) {
  const [waba, setWaba] = useState("all");
  const [status, setStatus] = useState<"all" | "PENDING" | "APPROVED" | "REJECTED">("all");
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const wabas = [...new Map(numbers.map((x) => [x.waba_id, x])).values()];
  const q = search.trim().toLowerCase();
  const filtered = templates.filter((t) =>
    (waba === "all" || t.waba_id === waba) && (status === "all" || t.status === status) && (category === "all" || t.category === category)
    && (!q || t.name.toLowerCase().includes(q) || ((t.components ?? []).find((c) => c.type === "BODY")?.text ?? "").toLowerCase().includes(q)),
  );

  const remove = async (t: Tpl) => {
    const num = numbers.find((x) => x.waba_id === t.waba_id && x.ok);
    if (!num) { setErr("No hay un número con token válido en esa cuenta para borrarla."); return; }
    setBusy(t.name + t.waba_id); setErr(null);
    try {
      const r = await fetch(`${API}?${new URLSearchParams({ phone_number_id: num.phone_number_id, name: t.name })}`, { method: "DELETE", credentials: "include" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setConfirm(null);
      onDeleted(t.name);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section style={card}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: "#1a1a2e", marginRight: "auto" }}>Plantillas existentes <span style={{ color: "#94a3b8", fontWeight: 600, fontSize: 13 }}>· {filtered.length}/{templates.length}</span></h2>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        <select value={waba} onChange={(e) => setWaba(e.target.value)} style={{ ...inp, width: "auto", maxWidth: 240 }}>
          <option value="all">Todas las cuentas</option>
          {wabas.map((x) => <option key={x.waba_id} value={x.waba_id}>{numbers.filter((y) => y.waba_id === x.waba_id).map((y) => y.name).join(" / ")}</option>)}
        </select>
        {([["all", "Todas"], ["PENDING", "⏳ Pendientes"], ["APPROVED", "✅ Aprobadas"], ["REJECTED", "❌ Rechazadas"]] as const).map(([v, l]) => (
          <button key={v} type="button" onClick={() => setStatus(v)} style={{ ...btnSec, borderColor: status === v ? PURPLE : "rgba(0,0,0,0.12)", color: status === v ? PURPLE : "#475569" }}>{l}</button>
        ))}
        <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ ...inp, width: "auto" }}>
          <option value="all">Marketing y utilidad</option>
          <option value="MARKETING">Marketing</option>
          <option value="UTILITY">Utilidad</option>
          <option value="AUTHENTICATION">Autenticación</option>
        </select>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre o texto…" style={{ ...inp, flex: 1, minWidth: 180 }} />
      </div>
      {err && <div style={{ ...errBox, marginBottom: 10 }}>⚠️ {err}</div>}
      {loading && templates.length === 0 && <div style={{ padding: 30, textAlign: "center", color: "#888" }}>Cargando plantillas de Meta…</div>}
      {!loading && filtered.length === 0 && <div style={{ padding: 30, textAlign: "center", color: "#888", fontSize: 13 }}>No hay plantillas con esos filtros.</div>}
      <div style={{ display: "grid", gap: 8, maxHeight: "calc(100vh - 260px)", overflowY: "auto", paddingRight: 2 }}>
        {filtered.map((t) => {
          const comps = t.components ?? [];
          const header = comps.find((c) => c.type === "HEADER");
          const body = comps.find((c) => c.type === "BODY")?.text ?? "";
          const footer = comps.find((c) => c.type === "FOOTER")?.text;
          const btns = comps.find((c) => c.type === "BUTTONS")?.buttons ?? [];
          const stColor = t.status === "APPROVED" ? "#16a34a" : t.status === "REJECTED" ? "#dc2626" : t.status === "PENDING" ? "#d97706" : "#64748b";
          const stLabel = t.status === "APPROVED" ? "aprobada" : t.status === "REJECTED" ? "rechazada" : t.status === "PENDING" ? "pendiente" : t.status.toLowerCase();
          const key = t.name + t.waba_id;
          return (
            <article key={key} style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.06)", borderRadius: 12, padding: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                <strong style={{ fontSize: 13.5, color: "#1a1a2e", fontFamily: "ui-monospace, monospace" }}>{t.name}</strong>
                <span style={pill(stColor)}>{stLabel}</span>
                <span style={pill(t.category === "MARKETING" ? PURPLE : "#0891b2")}>{t.category === "MARKETING" ? "marketing" : t.category === "UTILITY" ? "utilidad" : t.category.toLowerCase()}</span>
                <span style={{ fontSize: 10.5, color: "#94a3b8" }}>{t.language}{t.quality_score?.score && t.quality_score.score !== "UNKNOWN" ? ` · calidad ${t.quality_score.score.toLowerCase()}` : ""}</span>
                <span style={{ marginLeft: "auto", fontSize: 10.5, color: "#94a3b8" }}>{t.numbers.join(" / ")}</span>
              </div>
              {header?.text && <div style={{ fontSize: 12.5, fontWeight: 700, color: "#334155", marginBottom: 3 }}>{header.text}</div>}
              {header && !header.text && <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 3 }}>📎 encabezado {header.format?.toLowerCase()}</div>}
              <div style={{ fontSize: 12.5, color: "#334155", lineHeight: 1.5, whiteSpace: "pre-wrap", display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{body}</div>
              {footer && <div style={{ fontSize: 11, color: "#94a3b8", fontStyle: "italic", marginTop: 3 }}>{footer}</div>}
              {btns.length > 0 && <div style={{ marginTop: 6, display: "flex", gap: 5, flexWrap: "wrap" }}>{btns.map((b, i) => <span key={i} style={{ fontSize: 10.5, padding: "2px 8px", borderRadius: 999, background: "#f1f5f9", color: "#475569", fontWeight: 700 }}>{b.type === "URL" ? "🔗" : b.type === "PHONE_NUMBER" ? "📞" : "💬"} {b.text}</span>)}</div>}
              {t.status === "REJECTED" && <div style={{ marginTop: 6, fontSize: 12, color: "#b91c1c" }}>Motivo de Meta: {rejectedReasonLabel(t.rejected_reason)}</div>}
              <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                <button type="button" onClick={() => onUseAsBase(t)} style={btnSec}>📄 Usar como base</button>
                {t.status !== "APPROVED" && confirm !== key && <button type="button" onClick={() => setConfirm(key)} style={{ ...btnSec, color: "#b91c1c" }}>🗑 Eliminar</button>}
                {t.status !== "APPROVED" && confirm === key && (
                  <>
                    <button type="button" disabled={busy === key} onClick={() => remove(t)} style={{ ...btnSec, background: "#b91c1c", color: "#fff", border: "none" }}>{busy === key ? "Eliminando…" : "Sí, eliminar en Meta"}</button>
                    <button type="button" onClick={() => setConfirm(null)} style={btnSec}>No</button>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

