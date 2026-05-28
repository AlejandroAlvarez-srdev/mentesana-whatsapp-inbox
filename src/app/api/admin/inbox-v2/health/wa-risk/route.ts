// GET /api/admin/inbox-v2/health/wa-risk
// Devuelve, para cada número activo:
//   · quality_rating, name_status, messaging_limit_tier (Graph API en vivo)
//   · volumen marketing/utility últimas 24h
//   · read-rate por plantilla 7d (top 20 con más volumen y peor read-rate)
//   · keywords spammy detectadas en plantillas recientes
//   · score de riesgo 0-100 (suma ponderada)
//
// Las 4 señales son las que mejor correlacionaron con los 4 baneos previos
// (3 de 4 estaban GREEN justo antes — Meta no avisa por quality_rating, por
// eso miramos volumen + content + read-rate).
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAgent } from "@/lib/agent-auth";

const sb = createClient(
  process.env.NEXT_PUBLIC_BLOG_SUPABASE_URL!,
  process.env.BLOG_SUPABASE_SERVICE_KEY!,
  { auth: { persistSession: false } },
);

const GRAPH = "https://graph.facebook.com/v22.0";

// Tiers: TIER_50 / TIER_250 / TIER_1K / TIER_10K / TIER_100K / TIER_UNLIMITED
const TIER_LIMIT: Record<string, number> = {
  TIER_50: 50, TIER_250: 250, TIER_1K: 1000, TIER_10K: 10000, TIER_100K: 100000, TIER_UNLIMITED: 1_000_000,
};

// Keywords que Meta penaliza en MARKETING (lista basada en sus public guidelines)
const SPAM_KEYWORDS = [
  "urgente", "última oportunidad", "ultima oportunidad", "no te lo pierdas",
  "gratis", "oferta limitada", "promoción exclusiva", "promocion exclusiva",
  "click aquí", "click aqui", "haz click", "compra ya", "actúa ya", "actua ya",
  "garantizado", "100% efectivo", "milagroso", "secreto", "increíble",
  "increible", "$$$", "€€€", "📢📢", "🚨🚨",
];

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function detectSpamSignals(text: string): { hits: string[]; allCapsRatio: number; exclamationStreak: number; emojiCount: number } {
  const lc = text.toLowerCase();
  const hits = SPAM_KEYWORDS.filter((kw) => lc.includes(kw));
  // ratio MAYÚSCULAS (sin contar espacios/puntuación)
  const letters = text.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, "");
  const upper = text.replace(/[^A-ZÁÉÍÓÚÑ]/g, "");
  const allCapsRatio = letters.length > 0 ? upper.length / letters.length : 0;
  // máxima racha de exclamaciones consecutivas
  const exMatch = text.match(/!{2,}|¡{2,}/g) ?? [];
  const exclamationStreak = exMatch.reduce((m, s) => Math.max(m, s.length), 0);
  // emojis (rango aproximado)
  const emojiCount = (text.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) ?? []).length;
  return { hits, allCapsRatio, exclamationStreak, emojiCount };
}

export async function GET(req: NextRequest) {
  const auth = await requireAgent(req);
  if ("status" in auth) return auth;
  if (auth.agent.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // 1) Números activos + tokens
  const { data: nums } = await sb
    .from("whatsapp_numbers")
    .select("name, phone_number, phone_number_id, business_account_id, access_token, is_default")
    .eq("status", "active");

  // 2) Para cada número: Graph API (quality, tier, name_status)
  const numbersHealth = await Promise.all(
    (nums ?? []).map(async (n) => {
      try {
        const r = await fetch(
          `${GRAPH}/${n.phone_number_id}?fields=quality_rating,name_status,messaging_limit_tier,throughput,status`,
          { headers: { Authorization: `Bearer ${n.access_token}` } },
        );
        const meta = await r.json();
        return {
          name: n.name, phone_number: n.phone_number, phone_number_id: n.phone_number_id,
          business_account_id: n.business_account_id, is_default: n.is_default,
          quality_rating: meta.quality_rating ?? "UNKNOWN",
          name_status: meta.name_status ?? "UNKNOWN",
          tier: meta.messaging_limit_tier ?? "TIER_50",
          tier_limit: TIER_LIMIT[meta.messaging_limit_tier ?? "TIER_50"] ?? 50,
          status: meta.status ?? "UNKNOWN",
          graph_error: meta.error?.message ?? null,
        };
      } catch (e) {
        return {
          name: n.name, phone_number: n.phone_number, phone_number_id: n.phone_number_id,
          business_account_id: n.business_account_id, is_default: n.is_default,
          quality_rating: "UNKNOWN", name_status: "UNKNOWN", tier: "TIER_50", tier_limit: 50, status: "UNKNOWN",
          graph_error: e instanceof Error ? e.message : String(e),
        };
      }
    }),
  );

  // 3) Volumen últimas 24h por número (messages_mentesana no tiene phone_number_id,
  // pero tiene phone que es el destinatario y agent_name/sender_name. Usamos conversation_routing
  // para mapear conversation_id → phone_number_id, y joint con messages.)
  // Simpler: contamos templates enviados últimas 24h sin distinguir por número (a nivel global)
  // PLUS por categoría inferida (mapeo de family).
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: lastDay } = await sb
    .from("messages_mentesana")
    .select("template_name, timestamp, status, phone")
    .eq("is_template", true)
    .gte("timestamp", since24h)
    .limit(5000);

  const volume24h_total = lastDay?.length ?? 0;

  // 4) Read-rate por plantilla últimos 7 días
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: last7d } = await sb
    .from("messages_mentesana")
    .select("template_name, status")
    .eq("is_template", true)
    .gte("timestamp", since7d)
    .limit(20000);

  type Bucket = { sent: number; delivered: number; read: number; failed: number; total: number };
  const byTpl = new Map<string, Bucket>();
  for (const m of last7d ?? []) {
    if (!m.template_name) continue;
    const b = byTpl.get(m.template_name) ?? { sent: 0, delivered: 0, read: 0, failed: 0, total: 0 };
    if (m.status === "sent") b.sent += 1;
    else if (m.status === "delivered") b.delivered += 1;
    else if (m.status === "read") b.read += 1;
    else if (m.status === "failed") b.failed += 1;
    b.total += 1;
    byTpl.set(m.template_name, b);
  }
  // Top 20 plantillas con volumen >= 10 y peor read-rate
  const templates_health = Array.from(byTpl.entries())
    .filter(([, b]) => b.total >= 10)
    .map(([name, b]) => {
      const reachable = b.delivered + b.read; // descontamos failed y sent (sin confirmar)
      const readRate = reachable > 0 ? b.read / reachable : 0;
      const failRate = b.total > 0 ? b.failed / b.total : 0;
      return { name, ...b, read_rate: readRate, fail_rate: failRate };
    })
    .sort((a, b) => a.read_rate - b.read_rate)
    .slice(0, 20);

  // 5) Plantillas con keywords spammy — leemos las plantillas APROBADAS via Graph
  // para tener el body real. Lo hacemos por WABA (agrupa todas las plantillas).
  const wabaTokens = new Map<string, string>();
  for (const n of nums ?? []) wabaTokens.set(n.business_account_id, n.access_token);

  const spammy_templates: Array<{ name: string; waba: string; body: string; hits: string[]; allCapsRatio: number; exclamationStreak: number; emojiCount: number; score: number }> = [];
  await Promise.all(Array.from(wabaTokens.entries()).map(async ([waba, token]) => {
    try {
      const r = await fetch(`${GRAPH}/${waba}/message_templates?fields=name,status,components&limit=200`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await r.json();
      for (const t of j.data ?? []) {
        if (t.status !== "APPROVED") continue;
        const body = (t.components ?? []).find((c: { type: string; text?: string }) => c.type === "BODY")?.text ?? "";
        if (!body) continue;
        const sig = detectSpamSignals(body);
        // score 0-100
        const score = Math.min(100,
          sig.hits.length * 20 +
          (sig.allCapsRatio > 0.5 ? 25 : sig.allCapsRatio > 0.3 ? 12 : 0) +
          (sig.exclamationStreak >= 3 ? 15 : sig.exclamationStreak >= 2 ? 7 : 0) +
          (sig.emojiCount > 8 ? 20 : sig.emojiCount > 4 ? 10 : 0)
        );
        if (score >= 20) spammy_templates.push({ name: t.name, waba, body: body.slice(0, 280), ...sig, score });
      }
    } catch { /* ignora WABA con token caído */ }
  }));
  spammy_templates.sort((a, b) => b.score - a.score);

  // 6) Score de riesgo por número
  const numbers = numbersHealth.map((n) => {
    let score = 0;
    const flags: string[] = [];
    if (n.quality_rating === "RED") { score += 60; flags.push("quality_RED"); }
    else if (n.quality_rating === "YELLOW") { score += 30; flags.push("quality_YELLOW"); }
    if (n.name_status === "DECLINED" || n.name_status === "FLAGGED") { score += 25; flags.push("name_" + n.name_status); }
    if (n.status === "BANNED") { score += 100; flags.push("BANNED"); }
    // Volumen como % del tier — usamos el total global como aproximación si no hay split por número
    const pctTier = Math.min(1, volume24h_total / Math.max(1, n.tier_limit));
    if (pctTier > 0.8) { score += 20; flags.push(`vol_${Math.round(pctTier * 100)}%_tier`); }
    else if (pctTier > 0.5) { score += 10; flags.push(`vol_${Math.round(pctTier * 100)}%_tier`); }
    return { ...n, risk_score: Math.min(100, score), flags };
  });

  return NextResponse.json({
    numbers,
    volume_24h: { total: volume24h_total, by_status: bucketByStatus(lastDay ?? []) },
    templates_low_read_rate: templates_health,
    spammy_templates: spammy_templates.slice(0, 15),
    generated_at: new Date().toISOString(),
  });
}

function bucketByStatus(rows: Array<{ status: string | null }>) {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.status ?? "unknown"] = (out[r.status ?? "unknown"] ?? 0) + 1;
  return out;
}
