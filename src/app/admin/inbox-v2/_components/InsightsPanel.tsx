"use client";

import { useEffect, useState } from "react";
import { ConvSummary } from "./ConversationList";

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

export default function InsightsPanel({
  conversationId,
  selectedSummary,
}: {
  conversationId: string | null;
  selectedSummary: ConvSummary | null;
}) {
  const [insight, setInsight] = useState<Insight>(null);
  const [risk, setRisk] = useState<RiskResp | null>(null);
  const [loadingInsight, setLoadingInsight] = useState(false);

  const [summary, setSummary] = useState<string>("");
  const [summaryStreaming, setSummaryStreaming] = useState(false);
  const [summaryErr, setSummaryErr] = useState<string | null>(null);

  const [reply, setReply] = useState<string>("");
  const [replyStreaming, setReplyStreaming] = useState(false);
  const [replyErr, setReplyErr] = useState<string | null>(null);

  // load insight + risk al cambiar conversación
  useEffect(() => {
    setInsight(null);
    setRisk(null);
    setSummary("");
    setSummaryErr(null);
    setReply("");
    setReplyErr(null);
    if (!conversationId) return;
    setLoadingInsight(true);
    Promise.all([
      fetch(`/api/admin/inbox-v2/conversations/${encodeURIComponent(conversationId)}?messages=false`, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`)))
        .then((d) => setInsight(d.insight ?? null))
        .catch(() => {}),
      fetch(`/api/admin/inbox-v2/conversations/${encodeURIComponent(conversationId)}/risk-flags`, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`)))
        .then((d) => setRisk(d))
        .catch(() => {}),
    ]).finally(() => setLoadingInsight(false));
  }, [conversationId]);

  async function runSummary() {
    if (!conversationId || summaryStreaming) return;
    setSummary("");
    setSummaryErr(null);
    setSummaryStreaming(true);
    try {
      const r = await fetch(`/api/admin/inbox-v2/conversations/${encodeURIComponent(conversationId)}/summary`, {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok || !r.body) {
        const txt = await r.text();
        throw new Error(`HTTP ${r.status}: ${txt.slice(0, 200)}`);
      }
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
      const r = await fetch(`/api/admin/inbox-v2/conversations/${encodeURIComponent(conversationId)}/suggested-reply`, {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok || !r.body) {
        const txt = await r.text();
        throw new Error(`HTTP ${r.status}: ${txt.slice(0, 200)}`);
      }
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

  if (!conversationId) {
    return <div style={panelStyle}><div style={{ color: "#aaa", fontSize: 12, padding: 20, textAlign: "center" }}>Selecciona una conversación para ver insights, riesgo y sugerencia de respuesta.</div></div>;
  }

  return (
    <div style={panelStyle}>
      <div style={{ overflowY: "auto", flex: 1, padding: 14 }}>
        {risk && risk.flag_count > 0 && <RiskBanner risk={risk} />}

        <Section title="🧠 Insight Claude" subtitle={loadingInsight ? "cargando…" : insight ? null : "Aún no procesado por el extractor"}>
          {insight && (
            <div style={{ display: "grid", gap: 10, fontSize: 12 }}>
              {insight.dolor_principal && (
                <Field label="Dolor principal">{insight.dolor_principal}</Field>
              )}
              {insight.objeciones && insight.objeciones.length > 0 && (
                <Field label="Objeciones">
                  <Pills items={insight.objeciones} />
                </Field>
              )}
              {insight.triggers_compra && insight.triggers_compra.length > 0 && (
                <Field label="Triggers">
                  <Pills items={insight.triggers_compra} color={PURPLE} />
                </Field>
              )}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {insight.sentimiento && <Mini label="Sentimiento" v={insight.sentimiento} />}
                {insight.precio_sensibilidad && <Mini label="Precio" v={insight.precio_sensibilidad} />}
                {insight.canal_descubrimiento && <Mini label="Canal" v={insight.canal_descubrimiento} />}
              </div>
              {insight.momento_vital && <Field label="Momento vital">{insight.momento_vital}</Field>}
              {insight.quote_marketing && (
                <Field label="Quote">
                  <em style={{ color: "#1a1a2e", fontSize: 12 }}>&ldquo;{insight.quote_marketing}&rdquo;</em>
                </Field>
              )}
              {insight.resumen && <Field label="Resumen">{insight.resumen}</Field>}
            </div>
          )}
        </Section>

        <Section
          title="📝 Resumen de la conversación"
          subtitle="Generado al vuelo por Claude Haiku"
          action={
            <button onClick={runSummary} disabled={summaryStreaming} style={btnStyle(summaryStreaming)}>
              {summaryStreaming ? "Generando…" : summary ? "Regenerar" : "Generar"}
            </button>
          }
        >
          {summaryErr && <div style={errBox}>{summaryErr}</div>}
          {summary ? (
            <Markdown text={summary} />
          ) : !summaryStreaming && (
            <div style={{ color: "#aaa", fontSize: 12 }}>Pulsa &ldquo;Generar&rdquo; para resumir la conversación.</div>
          )}
        </Section>

        <Section
          title="💡 Respuesta sugerida (RAG)"
          subtitle="Cruza conversaciones similares que SÍ pagaron"
          action={
            <button onClick={runReply} disabled={replyStreaming} style={btnStyle(replyStreaming)}>
              {replyStreaming ? "Pensando…" : reply ? "Regenerar" : "Sugerir"}
            </button>
          }
        >
          {replyErr && <div style={errBox}>{replyErr}</div>}
          {reply ? (
            <Markdown text={reply} />
          ) : !replyStreaming && (
            <div style={{ color: "#aaa", fontSize: 12 }}>Pulsa &ldquo;Sugerir&rdquo; — requiere que la conversación tenga insight extraído.</div>
          )}
        </Section>
      </div>
    </div>
  );
}

function RiskBanner({ risk }: { risk: RiskResp }) {
  const color = risk.max_level === "critico" ? "#dc2626" : risk.max_level === "alto" ? "#f59e0b" : "#3b82f6";
  return (
    <div style={{ background: `${color}1a`, border: `1px solid ${color}55`, borderRadius: 10, padding: 10, marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color, textTransform: "uppercase", marginBottom: 6 }}>
        ⚠️ {risk.flag_count} flag{risk.flag_count === 1 ? "" : "s"} de riesgo · nivel {risk.max_level}
      </div>
      <div style={{ display: "grid", gap: 4 }}>
        {risk.flags.slice(0, 5).map((f, i) => (
          <div key={i} style={{ fontSize: 11, color: "#333" }}>
            <strong style={{ color }}>{f.label}:</strong> <em>&ldquo;{f.match}&rdquo;</em>
          </div>
        ))}
      </div>
    </div>
  );
}

function Section({ title, subtitle, children, action }: { title: string; subtitle?: string | null; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
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
  // Render muy básico de **bold** y saltos de línea. Suficiente para summaries y suggested-reply.
  const html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br/>");
  return <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "#1a1a2e" }} dangerouslySetInnerHTML={{ __html: html }} />;
}

const panelStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 12,
  border: "1px solid rgba(0,0,0,0.06)",
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  overflow: "hidden",
};

const errBox: React.CSSProperties = { fontSize: 11, color: "#900", background: "#fee", border: "1px solid #fcc", padding: 6, borderRadius: 6, marginBottom: 6 };

const btnStyle = (disabled: boolean): React.CSSProperties => ({
  padding: "5px 12px",
  fontSize: 11,
  fontWeight: 600,
  borderRadius: 6,
  border: "none",
  cursor: disabled ? "default" : "pointer",
  background: disabled ? "rgba(0,0,0,0.06)" : PURPLE,
  color: disabled ? "#888" : "#fff",
});
