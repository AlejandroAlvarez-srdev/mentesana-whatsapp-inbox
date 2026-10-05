"use client";

import { useEffect, useState } from "react";
import { ConvSummary } from "./ConversationList";
import PipelinePanel from "@/app/agent/_components/PipelinePanel";
import EmailSuggestModal from "./EmailSuggestModal";
import AmeliaToolsTab from "./AmeliaToolsTab";
import UpsellsTab from "./UpsellsTab";
import LeadScoreBadge from "./LeadScoreBadge";
import { fmtMadridDate } from "./_time";

const PURPLE = "#6A178C";

type RiskFlag = { level: "critico" | "alto" | "medio" | string; label: string; match: string };
type RiskResp = { conversation_id: string; lead_name: string | null; flag_count: number; flags: RiskFlag[]; max_level: string };

type Insight = {
  conversation_id: string;
  dolor_principal: string | null;
  objeciones: string[] | null;
  triggers_compra: string[] | null;
  precio_sensibilidad: string | null;
  sentimiento: string | null;
  canal_descubrimiento: string | null;
  momento_vital: string | null;
  motivo_compra: string | null;
  motivo_no_compra: string | null;
  temas_terapia: string[] | null;
  quote_marketing: string | null;
  resumen: string | null;
} | null;

type LeadProfile = {
  conversation: any;
  contact: any | null;
  payments: { id: string; amount_cents: number | null; currency: string | null; status: string | null; psychologist: string | null; source: string | null; stripe_session_id: string | null; created_at: string; metadata: any }[];
  tags: { id: string; name: string; color: string }[];
  total_messages: number;
};

type TagMaster = { id: string; name: string; color: string; description: string | null };

type Tab = "pipeline" | "insights" | "perfil" | "amelia" | "upsells";

export default function InsightsPanel({
  conversationId,
  selectedSummary,
  apiBase = "/api/admin/inbox-v2",
}: {
  conversationId: string | null;
  selectedSummary: ConvSummary | null;
  apiBase?: string;
}) {
  const [tab, setTab] = useState<Tab>("pipeline");
  const [insight, setInsight] = useState<Insight>(null);
  const [risk, setRisk] = useState<RiskResp | null>(null);
  const [profile, setProfile] = useState<LeadProfile | null>(null);
  const [tagMaster, setTagMaster] = useState<TagMaster[]>([]);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<string>("");
  const [summaryStreaming, setSummaryStreaming] = useState(false);
  const [summaryErr, setSummaryErr] = useState<string | null>(null);
  const [reply, setReply] = useState<string>("");
  const [replyStreaming, setReplyStreaming] = useState(false);
  const [replyErr, setReplyErr] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${apiBase}/tags`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { tags: [] }))
      .then((d) => setTagMaster(d.tags ?? []));
  }, []);

  useEffect(() => {
    setInsight(null);
    setRisk(null);
    setProfile(null);
    setSummary("");
    setSummaryErr(null);
    setReply("");
    setReplyErr(null);
    if (!conversationId) return;
    setLoading(true);
    Promise.all([
      fetch(`${apiBase}/conversations/${encodeURIComponent(conversationId)}?messages=false`, { credentials: "include" }).then((r) => (r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))).then((d) => setInsight(d.insight ?? null)).catch(() => {}),
      fetch(`${apiBase}/conversations/${encodeURIComponent(conversationId)}/risk-flags`, { credentials: "include" }).then((r) => (r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))).then((d) => setRisk(d)).catch(() => {}),
      fetch(`${apiBase}/conversations/${encodeURIComponent(conversationId)}/lead-profile`, { credentials: "include" }).then((r) => (r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))).then((d) => setProfile(d)).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [conversationId]);

  async function runSummary() {
    if (!conversationId || summaryStreaming) return;
    setSummary("");
    setSummaryErr(null);
    setSummaryStreaming(true);
    try {
      const r = await fetch(`${apiBase}/conversations/${encodeURIComponent(conversationId)}/summary`, { method: "POST", credentials: "include" });
      if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setSummary(acc);
      }
    } catch (e: any) {
      setSummaryErr(String(e.message ?? e));
    } finally {
      setSummaryStreaming(false);
    }
  }

  async function runReply() {
    if (!conversationId || replyStreaming) return;
    setReply("");
    setReplyErr(null);
    setReplyStreaming(true);
    try {
      const r = await fetch(`${apiBase}/conversations/${encodeURIComponent(conversationId)}/suggested-reply`, { method: "POST", credentials: "include" });
      if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setReply(acc);
      }
    } catch (e: any) {
      setReplyErr(String(e.message ?? e));
    } finally {
      setReplyStreaming(false);
    }
  }

  async function attachTag(tagId: string) {
    if (!conversationId) return;
    await fetch(`${apiBase}/conversations/${encodeURIComponent(conversationId)}/tags`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag_id: tagId }),
    });
    refreshProfile();
  }
  async function detachTag(tagId: string) {
    if (!conversationId) return;
    await fetch(`${apiBase}/conversations/${encodeURIComponent(conversationId)}/tags/${encodeURIComponent(tagId)}`, {
      method: "DELETE",
      credentials: "include",
    });
    refreshProfile();
  }

  function refreshProfile() {
    if (!conversationId) return;
    fetch(`${apiBase}/conversations/${encodeURIComponent(conversationId)}/lead-profile`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setProfile(d));
  }

  async function patchField(field: string, value: string | null) {
    if (!conversationId) return;
    await fetch(`${apiBase}/conversations/${encodeURIComponent(conversationId)}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    refreshProfile();
  }

  async function saveNotes(notes: string) {
    if (!conversationId) return;
    await fetch(`${apiBase}/conversations/${encodeURIComponent(conversationId)}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes }),
    });
    refreshProfile();
  }

  const [emailModalOpen, setEmailModalOpen] = useState(false);

  if (!conversationId) {
    return <div style={panelStyle}><div style={{ color: "#aaa", fontSize: 12, padding: 20, textAlign: "center" }}>Selecciona una conversación.</div></div>;
  }

  return (
    <div style={panelStyle}>
      {/* Link al Customer 360 */}
      {(profile?.conversation?.phone || selectedSummary?.phone) && (
        <a
          href={`/agent/customers/${encodeURIComponent(profile?.conversation?.phone ?? selectedSummary?.phone ?? "")}`}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            padding: "9px 12px",
            background: "linear-gradient(135deg, rgba(106,23,140,0.08) 0%, rgba(250,128,114,0.06) 100%)",
            color: PURPLE, fontSize: 12, fontWeight: 700, textDecoration: "none",
            borderBottom: "1px solid rgba(106,23,140,0.12)",
            flexShrink: 0,
          }}
        >
          🔍 Ver perfil 360° completo →
        </a>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", padding: 8, gap: 4, borderBottom: "1px solid rgba(0,0,0,0.06)", flexShrink: 0 }}>
        <TabBtn cur={tab} v="pipeline" set={setTab} label="📋 Plan de trabajo" />
        <TabBtn cur={tab} v="insights" set={setTab} label="🧠 Insights" />
        <TabBtn cur={tab} v="perfil" set={setTab} label="👤 Perfil" />
        <TabBtn cur={tab} v="amelia" set={setTab} label="🛠️ Amelia" />
        <TabBtn cur={tab} v="upsells" set={setTab} label="💶 Upsells" />
      </div>

      <div style={{ overflowY: "auto", flex: 1, padding: 14 }}>
        {tab === "pipeline" && (
          <>
            {conversationId && <div style={{ marginBottom: 12 }}><LeadScoreBadge conversationId={conversationId} /></div>}
            {(profile?.conversation?.phone || selectedSummary?.phone) ? (
              <PipelinePanel
                phone={(profile?.conversation?.phone ?? selectedSummary?.phone)!}
                conversationId={conversationId}
              />
            ) : (
              <div style={{ padding: 24, color: "#aaa", fontSize: 12, textAlign: "center" }}>
                Selecciona una conversación para ver su pipeline.
              </div>
            )}
          </>
        )}

        {tab === "insights" && (
          <>
            {risk && risk.flag_count > 0 && <RiskBanner risk={risk} />}
            <Section title="🧠 Insight Claude" subtitle={loading ? "cargando…" : insight ? null : "Aún no procesado por el extractor"}>
              {insight && <InsightFields i={insight} />}
            </Section>
            <Section
              title="📝 Resumen"
              subtitle="Claude Haiku al vuelo"
              action={<button onClick={runSummary} disabled={summaryStreaming} style={btnStyle(summaryStreaming)}>{summaryStreaming ? "Generando…" : summary ? "Regenerar" : "Generar"}</button>}
            >
              {summaryErr && <div style={errBox}>{summaryErr}</div>}
              {summary ? <Markdown text={summary} /> : !summaryStreaming && <div style={{ color: "#aaa", fontSize: 12 }}>Pulsa &ldquo;Generar&rdquo;.</div>}
            </Section>
            <Section
              title="💡 Estrategia sugerida (RAG)"
              subtitle="Ángulos basados en casos pagados · tú redactas el mensaje"
              action={<button onClick={runReply} disabled={replyStreaming} style={btnStyle(replyStreaming)}>{replyStreaming ? "Pensando…" : reply ? "Regenerar" : "Sugerir"}</button>}
            >
              {replyErr && <div style={errBox}>{replyErr}</div>}
              {reply ? <Markdown text={reply} /> : !replyStreaming && <div style={{ color: "#aaa", fontSize: 12 }}>Requiere insight extraído.</div>}
            </Section>
          </>
        )}

        {tab === "perfil" && (
          <ProfileTab
            profile={profile}
            tagMaster={tagMaster}
            onAttachTag={attachTag}
            onDetachTag={detachTag}
            onSaveNotes={saveNotes}
            onPatchField={patchField}
            loading={loading}
            onOpenEmailModal={() => setEmailModalOpen(true)}
          />
        )}

        {tab === "upsells" && (
          <UpsellsTab
            phone={profile?.conversation?.phone ?? selectedSummary?.phone ?? null}
            email={profile?.contact?.email ?? profile?.conversation?.email ?? null}
          />
        )}

        {tab === "amelia" && (
          <AmeliaToolsTab
            phone={profile?.conversation?.phone ?? selectedSummary?.phone ?? null}
            email={profile?.contact?.email ?? profile?.conversation?.email ?? null}
            conversationId={conversationId}
          />
        )}
      </div>
      {emailModalOpen && (
        <EmailSuggestModal
          conversationId={conversationId}
          initialEmail={profile?.contact?.email ?? profile?.conversation?.email ?? null}
          initialName={profile?.contact?.lead_name ?? profile?.conversation?.lead_name ?? null}
          onClose={() => setEmailModalOpen(false)}
          onSent={() => { /* podríamos refrescar timeline */ }}
        />
      )}
    </div>
  );
}

function ProfileTab({
  profile,
  tagMaster,
  onAttachTag,
  onDetachTag,
  onSaveNotes,
  onPatchField,
  loading,
  onOpenEmailModal,
}: {
  profile: LeadProfile | null;
  tagMaster: TagMaster[];
  onAttachTag: (id: string) => void;
  onDetachTag: (id: string) => void;
  onSaveNotes: (notes: string) => void;
  onPatchField: (field: string, value: string | null) => Promise<void>;
  loading: boolean;
  onOpenEmailModal?: () => void;
}) {
  const [notes, setNotes] = useState("");
  const [notesDirty, setNotesDirty] = useState(false);

  useEffect(() => {
    setNotes(profile?.conversation?.notes ?? profile?.contact?.notes ?? "");
    setNotesDirty(false);
  }, [profile?.conversation?.id]);

  if (loading && !profile) return <div style={{ color: "#aaa", fontSize: 12 }}>Cargando perfil…</div>;
  if (!profile) return <div style={{ color: "#aaa", fontSize: 12 }}>Sin perfil.</div>;

  const c = profile.contact ?? profile.conversation;
  const currentTagIds = new Set(profile.tags.map((t) => t.id));
  const availableTags = tagMaster.filter((t) => !currentTagIds.has(t.id));

  return (
    <>
      <Section title="👤 Contacto" subtitle="click en un valor para editar">
        <div style={{ display: "grid", gap: 6, fontSize: 12 }}>
          <EditableRow k="Nombre" v={c?.lead_name ?? ""} onSave={(val) => onPatchField("lead_name", val || null)} />
          <Row k="Teléfono" v={profile.conversation.phone} />
          <EditableRow k="Email" v={c?.email ?? ""} type="email" onSave={(val) => onPatchField("email", val || null)} />
          <EditableSelectRow
            k="Cliente"
            v={c?.client_type ?? ""}
            options={[{ v: "", l: "— sin tipo —" }, { v: "ventas", l: "💼 Ventas" }, { v: "soporte", l: "🛟 Soporte" }]}
            onSave={(val) => onPatchField("client_type", val || null)}
          />
          <EditableSelectRow
            k="Prioridad"
            v={c?.priority ?? ""}
            options={[{ v: "", l: "— sin prioridad —" }, { v: "alta", l: "🔥 alta" }, { v: "media", l: "🟡 media" }, { v: "baja", l: "❄️ baja" }]}
            onSave={(val) => onPatchField("priority", val || null)}
          />
          <Row k="Origen" v={c?.source ?? "—"} />
          <Row k="UTM" v={[c?.utm_source, c?.utm_medium, c?.utm_campaign].filter(Boolean).join(" / ") || "—"} />
          <Row k="Test score" v={c?.test_score ?? "—"} />
          <Row k="Total mensajes" v={profile.total_messages} />
        </div>
      </Section>

      <Section title="🏷️ Tags">
        {profile.tags.length === 0 && <div style={{ fontSize: 11, color: "#aaa", marginBottom: 8 }}>Sin etiquetas asignadas.</div>}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {profile.tags.map((t) => (
            <button key={t.id} onClick={() => onDetachTag(t.id)} title="Quitar tag" style={{ background: t.color, color: "#fff", padding: "3px 9px", borderRadius: 6, fontSize: 11, fontWeight: 700, border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
              {t.name} ✕
            </button>
          ))}
        </div>
        {availableTags.length > 0 && (
          <details>
            <summary style={{ fontSize: 11, color: "#888", cursor: "pointer", marginBottom: 6 }}>+ Añadir tag ({availableTags.length} disponibles)</summary>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {availableTags.map((t) => (
                <button key={t.id} onClick={() => onAttachTag(t.id)} style={{ background: `${t.color}22`, color: t.color, padding: "3px 9px", borderRadius: 6, fontSize: 11, fontWeight: 600, border: `1px solid ${t.color}55`, cursor: "pointer" }}>
                  + {t.name}
                </button>
              ))}
            </div>
          </details>
        )}
      </Section>

      <Section title="✉️ Acciones rápidas">
        <div style={{ display: "flex", gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => onOpenEmailModal?.()}
            disabled={!c?.email}
            title={c?.email ? `Sugerir email a ${c.email}` : "Añade un email al perfil primero"}
            style={{
              padding: "7px 12px", fontSize: 11.5, fontWeight: 800, borderRadius: 8, border: "none",
              cursor: c?.email ? "pointer" : "not-allowed",
              background: c?.email ? "linear-gradient(135deg, #6A178C 0%, #8B2FB5 100%)" : "rgba(0,0,0,0.08)",
              color: c?.email ? "#fff" : "#888",
              letterSpacing: 0.3,
              boxShadow: c?.email ? "0 2px 8px rgba(106,23,140,0.3)" : "none",
            }}
          >✉️ Sugerir email con IA</button>
        </div>
        {!c?.email && <div style={{ fontSize: 10.5, color: "#aaa", marginBottom: 4 }}>Añade un email arriba para habilitar.</div>}
      </Section>

      <Section title="💳 Pagos / Cobrar">
        <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => {
              if (typeof window !== "undefined" && profile.conversation.id) {
                window.dispatchEvent(new CustomEvent("inbox:open-payment", { detail: { conversationId: profile.conversation.id } }));
              }
            }}
            style={{
              padding: "7px 12px", fontSize: 11.5, fontWeight: 800, borderRadius: 8, border: "none", cursor: "pointer",
              background: "linear-gradient(135deg, #635bff 0%, #4f46e5 100%)", color: "#fff", letterSpacing: 0.3,
              boxShadow: "0 2px 8px rgba(99,91,255,0.3)",
            }}
          >💳 Generar link de pago</button>
          {!(profile.conversation.purchase_status === "pagado" || (profile.conversation as any).paid_at) && (
            <button
              type="button"
              onClick={() => {
                if (typeof window !== "undefined" && profile.conversation.id) {
                  window.dispatchEvent(new CustomEvent("inbox:mark-sold", { detail: { conversationId: profile.conversation.id } }));
                }
              }}
              style={{
                padding: "7px 12px", fontSize: 11.5, fontWeight: 800, borderRadius: 8, border: "none", cursor: "pointer",
                background: "linear-gradient(135deg, #16a34a 0%, #22c55e 100%)", color: "#fff", letterSpacing: 0.3,
                boxShadow: "0 2px 8px rgba(22,163,74,0.3)",
              }}
            >💰 Marcar vendida</button>
          )}
        </div>
        {profile.payments.length === 0 ? (
          <div style={{ fontSize: 11, color: "#aaa" }}>Sin pagos registrados.</div>
        ) : (
          <div style={{ display: "grid", gap: 6 }}>
            {profile.payments.map((p) => (
              <div key={p.id} style={{ padding: "8px 10px", background: "rgba(0,0,0,0.02)", borderRadius: 8, fontSize: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <strong style={{ color: PURPLE }}>{((p.amount_cents ?? 0) / 100).toFixed(2)} {(p.currency ?? "EUR").toUpperCase()}</strong>
                  <span style={{ color: p.status === "succeeded" || p.status === "paid" ? "#059669" : "#888", fontWeight: 600, fontSize: 11 }}>{p.status ?? "—"}</span>
                </div>
                <div style={{ color: "#888", fontSize: 11, marginTop: 2 }}>
                  {p.psychologist && <span>👩‍⚕️ {p.psychologist} · </span>}
                  {p.source && <span>{p.source} · </span>}
                  {fmtMadridDate(p.created_at)}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section
        title="📓 Notas internas"
        action={
          notesDirty ? (
            <button
              onClick={() => {
                onSaveNotes(notes);
                setNotesDirty(false);
              }}
              style={btnStyle(false)}
            >
              Guardar
            </button>
          ) : undefined
        }
      >
        <textarea
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            setNotesDirty(true);
          }}
          rows={5}
          placeholder="Notas internas sobre el lead…"
          style={{ width: "100%", padding: 8, fontSize: 12, border: "1px solid rgba(0,0,0,0.1)", borderRadius: 8, resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" }}
        />
      </Section>
    </>
  );
}

function InsightFields({ i }: { i: NonNullable<Insight> }) {
  return (
    <div style={{ display: "grid", gap: 10, fontSize: 12 }}>
      {i.dolor_principal && <Field label="Dolor principal">{i.dolor_principal}</Field>}
      {i.objeciones && i.objeciones.length > 0 && <Field label="Objeciones"><Pills items={i.objeciones} /></Field>}
      {i.triggers_compra && i.triggers_compra.length > 0 && <Field label="Triggers"><Pills items={i.triggers_compra} color={PURPLE} /></Field>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {i.sentimiento && <Mini label="Sent." v={i.sentimiento} />}
        {i.precio_sensibilidad && <Mini label="Precio" v={i.precio_sensibilidad} />}
        {i.canal_descubrimiento && <Mini label="Canal" v={i.canal_descubrimiento} />}
      </div>
      {i.momento_vital && <Field label="Momento vital">{i.momento_vital}</Field>}
      {i.quote_marketing && <Field label="Quote"><em>&ldquo;{i.quote_marketing}&rdquo;</em></Field>}
      {i.resumen && <Field label="Resumen">{i.resumen}</Field>}
    </div>
  );
}

function RiskBanner({ risk }: { risk: RiskResp }) {
  const color = risk.max_level === "critico" ? "#dc2626" : risk.max_level === "alto" ? "#f59e0b" : "#3b82f6";
  return (
    <div style={{ background: `${color}1a`, border: `1px solid ${color}55`, borderRadius: 10, padding: 10, marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color, textTransform: "uppercase", marginBottom: 6 }}>⚠️ {risk.flag_count} flag{risk.flag_count === 1 ? "" : "s"} de riesgo · nivel {risk.max_level}</div>
      {risk.flags.slice(0, 5).map((f, i) => (
        <div key={i} style={{ fontSize: 11, color: "#333" }}>
          <strong style={{ color }}>{f.label}:</strong> <em>&ldquo;{f.match}&rdquo;</em>
        </div>
      ))}
    </div>
  );
}

function TabBtn({ cur, v, set, label }: { cur: Tab; v: Tab; set: (v: Tab) => void; label: string }) {
  const active = cur === v;
  return (
    <button onClick={() => set(v)} style={{ flex: 1, padding: "8px 12px", fontSize: 12, fontWeight: 600, borderRadius: 6, border: "none", cursor: "pointer", background: active ? "rgba(106,23,140,0.08)" : "transparent", color: active ? PURPLE : "#666" }}>
      {label}
    </button>
  );
}

function Section({ title, subtitle, children, action }: { title: string; subtitle?: string | null; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#1a1a2e" }}>{title}</div>
          {subtitle && <div style={{ fontSize: 10, color: "#888" }}>{subtitle}</div>}
        </div>
        {action}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "#888", fontWeight: 600, letterSpacing: 0.3, textTransform: "uppercase", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 12, color: "#1a1a2e" }}>{children}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: any }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12 }}>
      <span style={{ color: "#888", flexShrink: 0 }}>{k}</span>
      <span style={{ color: "#1a1a2e", textAlign: "right", wordBreak: "break-word" }}>{v ?? "—"}</span>
    </div>
  );
}

function EditableRow({ k, v, type, onSave }: { k: string; v: string; type?: "text" | "email"; onSave: (val: string) => void | Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(v);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setDraft(v); }, [v]);

  if (editing) {
    return (
      <div style={{ display: "flex", justifyContent: "space-between", gap: 6, fontSize: 12, alignItems: "center" }}>
        <span style={{ color: "#888", flexShrink: 0 }}>{k}</span>
        <input
          autoFocus
          type={type === "email" ? "email" : "text"}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") { setDraft(v); setEditing(false); }
          }}
          onBlur={async () => {
            if (draft !== v) {
              setSaving(true);
              await onSave(draft);
              setSaving(false);
            }
            setEditing(false);
          }}
          style={{ flex: 1, maxWidth: 220, padding: "3px 8px", border: `1px solid ${PURPLE}`, borderRadius: 6, fontSize: 12, outline: "none", fontFamily: "inherit" }}
        />
      </div>
    );
  }
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12 }}>
      <span style={{ color: "#888", flexShrink: 0 }}>{k}</span>
      <button
        onClick={() => setEditing(true)}
        title="Click para editar"
        style={{
          color: v?.trim() ? "#1a1a2e" : "#bbb",
          textAlign: "right", wordBreak: "break-word",
          background: "transparent", border: "none", cursor: "pointer",
          padding: "1px 6px", borderRadius: 4, borderBottom: "1px dashed transparent",
          transition: "all 0.12s", fontFamily: "inherit", fontSize: 12,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(106,23,140,0.05)"; e.currentTarget.style.borderBottomColor = `${PURPLE}66`; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderBottomColor = "transparent"; }}
      >
        {saving ? "⏳ guardando…" : (v?.trim() || "+ añadir")}
      </button>
    </div>
  );
}

function EditableSelectRow({ k, v, options, onSave }: { k: string; v: string; options: { v: string; l: string }[]; onSave: (val: string) => void | Promise<void> }) {
  const [saving, setSaving] = useState(false);
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, alignItems: "center" }}>
      <span style={{ color: "#888", flexShrink: 0 }}>{k}</span>
      <select
        value={v}
        disabled={saving}
        onChange={async (e) => {
          setSaving(true);
          await onSave(e.target.value);
          setSaving(false);
        }}
        style={{
          padding: "2px 22px 2px 8px",
          fontSize: 12,
          border: "1px solid rgba(0,0,0,0.1)",
          borderRadius: 6,
          background: "#fff",
          color: v ? "#1a1a2e" : "#888",
          cursor: "pointer",
          fontFamily: "inherit",
          appearance: "none",
          backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath fill='%236A178C' d='M5 6L0 0h10z'/%3E%3C/svg%3E\")",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right 8px center",
        }}
      >
        {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </div>
  );
}

function Pills({ items, color }: { items: string[]; color?: string }) {
  const c = color ?? "#555";
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      {items.map((it, i) => (
        <span key={i} style={{ fontSize: 11, padding: "2px 7px", borderRadius: 4, background: `${c}1a`, color: c }}>{it}</span>
      ))}
    </div>
  );
}

function Mini({ label, v }: { label: string; v: string }) {
  return (
    <div style={{ background: "rgba(0,0,0,0.03)", borderRadius: 6, padding: "4px 8px", fontSize: 11 }}>
      <span style={{ color: "#888" }}>{label}: </span>
      <strong style={{ color: "#1a1a2e" }}>{v}</strong>
    </div>
  );
}

function Markdown({ text }: { text: string }) {
  const html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br/>");
  return <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "#1a1a2e" }} dangerouslySetInnerHTML={{ __html: html }} />;
}

const panelStyle: React.CSSProperties = { background: "#fff", borderRadius: 14, border: "1px solid rgba(0,0,0,0.06)", boxShadow: "0 1px 3px rgba(0,0,0,0.02)", display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden", width: "100%" };
const errBox: React.CSSProperties = { fontSize: 11, color: "#900", background: "#fee", border: "1px solid #fcc", padding: 6, borderRadius: 6, marginBottom: 6 };
const btnStyle = (disabled: boolean): React.CSSProperties => ({ padding: "5px 12px", fontSize: 11, fontWeight: 600, borderRadius: 6, border: "none", cursor: disabled ? "default" : "pointer", background: disabled ? "rgba(0,0,0,0.06)" : PURPLE, color: disabled ? "#888" : "#fff" });
