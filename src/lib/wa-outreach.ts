// Plantillas AUTOMÁTICAS por WhatsApp: las mismas reglas que el chat de la app (decideRule de
// src/lib/app-outreach.ts) enviadas con las plantillas APROBADAS en Meta.
//   • Mapeo regla/paso → plantillas por WABA en BLOG wa_outreach_templates (varias versiones por regla).
//   • Rotación: para cada envío se elige la versión MENOS usada en los últimos 7 días (+ lo ya planificado
//     en esta pasada) entre las activas y aprobadas de la WABA del número elegido, para repartir volumen
//     y no quemar una plantilla ni un número.
//   • Número: si el paciente ya tiene conversación enrutada a un número habilitado, se usa ese (hilo
//     continuo en el inbox); si no, el habilitado con menos envíos hoy. Tope diario por número (config).
//   • Envío: se PROGRAMA en whatsapp_scheduled_templates_v2 (scope bulk, una fila por número+plantilla,
//     recipients con los parámetros de cada uno, scheduled_for = ahora + N min) y lo manda el cron
//     /api/cron/send-scheduled-templates vía la edge inbox-v2-server. El equipo puede cancelarlo en
//     /agent/templates/scheduled antes de que salga.
//   • Exclusiones extra de WhatsApp: patrones en sus mensajes, bloqueos de Meta ("stop receiving") y
//     throttling reciente ("healthy ecosystem" / "spam rate limit" en 7 días). El cooldown de 3 días y
//     el remark son compartidos con la app (log app_outreach_log, channel 'wa').

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyAppSignals, applyWaSignals, CHANNEL_LABEL, decideRule, fetchAll, fmtFecha, isDecision, lastOutreachLabel,
  loadBaseSnapshots, OUTREACH_CONFIG, RULE_LABEL, RULE_ORDER, skipKey,
  type BaseData, type OutreachConfig, type OutreachRule, type OutreachSkipped, type PatientSnapshot, type WaSignals,
} from "@/lib/app-outreach";

const DAY = 86_400_000;
const GRAPH = "https://graph.facebook.com/v22.0";

export type WaConfig = { enabled_numbers: string[]; daily_limit_per_number: number; delay_minutes: number; updated_at?: string; updated_by?: string | null };
export type WaNumber = { phone_number_id: string; name: string; phone_number: string | null; waba_id: string; token: string; can_send: boolean; status: string };
export type MetaTemplateMeta = { name: string; language: string; status: string; category: string; quality: string; headerParam: boolean; bodyParams: number; bodyText: string };
export type WaTemplateMap = { id: number; rule: OutreachRule; step: number | null; restantes: number | null; waba_id: string; template_name: string; language: string; active: boolean };

export async function loadWaConfig(blog: SupabaseClient): Promise<WaConfig> {
  const { data } = await blog.from("wa_outreach_config").select("enabled_numbers, daily_limit_per_number, delay_minutes, updated_at, updated_by").eq("id", 1).maybeSingle();
  return {
    enabled_numbers: (data?.enabled_numbers as string[] | null) ?? [],
    daily_limit_per_number: Math.max(1, Math.min(1000, Number(data?.daily_limit_per_number ?? 100) || 100)),
    delay_minutes: Math.max(0, Math.min(1440, Number(data?.delay_minutes ?? 5) || 0)),
    updated_at: data?.updated_at ?? undefined, updated_by: data?.updated_by ?? null,
  };
}

export async function loadWaNumbers(blog: SupabaseClient): Promise<WaNumber[]> {
  const { data, error } = await blog.from("whatsapp_numbers").select("phone_number_id, name, phone_number, business_account_id, access_token, status, capabilities").eq("status", "active");
  if (error) throw new Error("whatsapp_numbers: " + error.message);
  return (data ?? []).map((n) => {
    const caps = (n.capabilities ?? {}) as Record<string, unknown>;
    return { phone_number_id: String(n.phone_number_id), name: String(n.name ?? ""), phone_number: n.phone_number ?? null, waba_id: String(n.business_account_id ?? ""), token: String(n.access_token ?? ""), can_send: caps.canSendTemplates !== false, status: String(n.status ?? "") };
  }).filter((n) => n.waba_id && n.token);
}

export async function loadWaTemplateMap(blog: SupabaseClient): Promise<WaTemplateMap[]> {
  const { data, error } = await blog.from("wa_outreach_templates").select("id, rule, step, restantes, waba_id, template_name, language, active").order("rule").order("step").order("template_name");
  if (error) throw new Error("wa_outreach_templates: " + error.message);
  return (data ?? []) as WaTemplateMap[];
}

// Plantillas aprobadas por WABA (Graph), con sus parámetros, para construir components y filtrar las no válidas.
export async function fetchWabaTemplates(numbers: WaNumber[]): Promise<{ byWaba: Map<string, Map<string, MetaTemplateMeta>>; errors: string[] }> {
  const byWaba = new Map<string, Map<string, MetaTemplateMeta>>();
  const errors: string[] = [];
  const tokens = new Map<string, string>();
  for (const n of numbers) if (!tokens.has(n.waba_id)) tokens.set(n.waba_id, n.token);
  await Promise.all([...tokens.entries()].map(async ([waba, token]) => {
    const map = new Map<string, MetaTemplateMeta>();
    byWaba.set(waba, map);
    let url: string | null = `${GRAPH}/${waba}/message_templates?fields=name,language,status,category,quality_score,components&limit=200`;
    try {
      for (let i = 0; url && i < 10; i++) {
        const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        const j = (await r.json()) as { data?: Array<Record<string, unknown>>; paging?: { next?: string }; error?: { message?: string } };
        if (j.error) { errors.push(`WABA ${waba}: ${j.error.message ?? "error Graph"}`); break; }
        for (const t of j.data ?? []) {
          const comps = (t.components as Array<Record<string, unknown>> | undefined) ?? [];
          const body = comps.find((c) => c.type === "BODY");
          const header = comps.find((c) => c.type === "HEADER");
          const bodyText = String(body?.text ?? "");
          const headerText = String(header?.text ?? "");
          map.set(`${t.name}|${t.language}`, {
            name: String(t.name), language: String(t.language), status: String(t.status), category: String(t.category ?? ""),
            quality: String((t.quality_score as { score?: string } | undefined)?.score ?? "UNKNOWN"),
            headerParam: header?.format === "TEXT" && /\{\{\d+\}\}/.test(headerText),
            bodyParams: new Set(bodyText.match(/\{\{\d+\}\}/g) ?? []).size,
            bodyText,
          });
        }
        url = j.paging?.next ?? null;
      }
    } catch (e) { errors.push(`WABA ${waba}: ${e instanceof Error ? e.message : String(e)}`); }
  }));
  return { byWaba, errors };
}

export type WaCandidate = {
  phone: string;
  email: string;
  nombre: string | null;
  rule: OutreachRule;
  rule_label: string;
  step: number | null;
  template_name: string;
  language: string;
  from_number_id: string;
  from_number_name: string;
  waba_id: string;
  components: Array<{ type: string; parameters: Array<{ type: string; text: string }> }>;
  preview: string;
  reason: string;
  context: { bono: string | null; sesiones: number | null; caduca: string | null; psicologa: string | null; diag_pagado: string | null; ultimo_envio: string | null; ultima_plantilla_wa: string | null; amelia_customer_id: number | null; conversation_id: string | null };
};
export type WaPlan = {
  ok: boolean;
  generated_at: string;
  amelia_ok: boolean;
  warnings: string[];
  config: WaConfig;
  numbers: Array<{ phone_number_id: string; name: string; phone_number: string | null; waba_id: string; enabled: boolean; can_send: boolean; sent_today: number; planned: number; templates_ok: number; templates_missing: string[] }>;
  template_usage_7d: Record<string, number>;
  counts: Record<string, number>;
  candidates: WaCandidate[];
  skipped: OutreachSkipped[];
  skipped_counts: Record<string, number>;
};

// Elige la versión menos usada (7 días + planificado en esta pasada) entre las activas/aprobadas.
export function pickTemplate(opts: { rows: WaTemplateMap[]; approved: Map<string, MetaTemplateMeta>; usage: Map<string, number>; rule: OutreachRule; step: number | null; restantes: number | null }): { row: WaTemplateMap; meta: MetaTemplateMeta } | null {
  const { rows, approved, usage, rule, step, restantes } = opts;
  const eligible = rows.filter((r) => r.active && r.rule === rule && (rule !== "remark" || r.step === step) && (r.restantes == null || r.restantes === restantes));
  // Si hay versiones específicas para esas sesiones restantes, se prefieren a las genéricas.
  const specific = eligible.filter((r) => r.restantes != null);
  const pool = specific.length ? specific : eligible;
  let best: { row: WaTemplateMap; meta: MetaTemplateMeta; n: number } | null = null;
  for (const row of pool) {
    const meta = approved.get(`${row.template_name}|${row.language}`);
    if (!meta || meta.status !== "APPROVED" || meta.quality === "RED") continue;
    if (meta.bodyParams > 1) continue; // no sabemos qué va en {{2}}…
    const n = usage.get(`${row.waba_id}|${row.template_name}`) ?? 0;
    if (!best || n < best.n || (n === best.n && Math.random() < 0.5)) best = { row, meta, n };
  }
  return best ? { row: best.row, meta: best.meta } : null;
}

export function buildComponents(meta: MetaTemplateMeta, firstName: string | null): WaCandidate["components"] {
  const name = (firstName ?? "").trim() || "Hola";
  const comps: WaCandidate["components"] = [];
  if (meta.headerParam) comps.push({ type: "header", parameters: [{ type: "text", text: name }] });
  if (meta.bodyParams >= 1) comps.push({ type: "body", parameters: Array.from({ length: meta.bodyParams }, () => ({ type: "text", text: name })) });
  return comps;
}

export async function buildWaOutreachPlan(opts: { blog: SupabaseClient; app?: SupabaseClient | null; nowMs?: number; cfg?: OutreachConfig }): Promise<WaPlan> {
  const { blog } = opts;
  const cfg = opts.cfg ?? OUTREACH_CONFIG;
  const nowMs = opts.nowMs ?? Date.now();
  const [config, numbersAll, mapRows, base] = await Promise.all([loadWaConfig(blog), loadWaNumbers(blog), loadWaTemplateMap(blog), loadBaseSnapshots({ blog, nowMs, cfg })]);
  const warnings = [...base.warnings];
  const enabled = numbersAll.filter((n) => config.enabled_numbers.includes(n.phone_number_id) && n.can_send);
  if (enabled.length === 0) warnings.push("No hay ningún número habilitado (ajustes del modal 🤖 WhatsApp).");
  const { byWaba, errors } = await fetchWabaTemplates(enabled);
  warnings.push(...errors);

  let sig: WaSignals = { throttled: new Map(), metaOptOut: new Set(), lastOutTemplate: new Map() };
  if (base.ameliaOk) {
    if (opts.app) { try { await applyAppSignals({ base, app: opts.app, nowMs, cfg }); } catch (e) { warnings.push("App (cooldown cruzado) no disponible: " + (e instanceof Error ? e.message : String(e))); } }
    sig = await applyWaSignals({ base, blog, nowMs, cfg, full: true });
  }

  // Uso de plantillas 7 días (rotación) y envíos de hoy por número (tope), ambos de nuestro log + messages_mentesana.
  const todayKey = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(nowMs));
  const [usageRows, todayRows, routing] = await Promise.all([
    fetchAll<{ template_name: string | null }>((a, b) => blog.from("messages_mentesana").select("template_name").eq("is_template", true).neq("status", "failed").gte("timestamp", new Date(nowMs - 7 * DAY).toISOString().slice(0, 19)).range(a, b), 1000, 10),
    fetchAll<{ context: { from_number?: string } | null; sent_at: string }>((a, b) => blog.from("app_outreach_log").select("context, sent_at").eq("channel", "wa").eq("ok", true).gte("sent_at", new Date(nowMs - 2 * DAY).toISOString()).range(a, b), 1000, 5),
    base.byPhone.size ? loadRouting(blog, [...base.byPhone.keys()]) : Promise.resolve(new Map<string, { conversation_id: string; phone_number_id: string | null }>()),
  ]);
  const usage = new Map<string, number>();
  for (const r of usageRows) { if (!r.template_name) continue; for (const n of enabled) { const k = `${n.waba_id}|${r.template_name}`; usage.set(k, (usage.get(k) ?? 0) + 1); } }
  const sentToday = new Map<string, number>();
  for (const r of todayRows) { const fn = r.context?.from_number; if (!fn) continue; if (new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(r.sent_at)) !== todayKey) continue; sentToday.set(fn, (sentToday.get(fn) ?? 0) + 1); }
  const planned = new Map<string, number>();
  const load = (id: string) => (sentToday.get(id) ?? 0) + (planned.get(id) ?? 0);

  const candidates: WaCandidate[] = [];
  const skipped: OutreachSkipped[] = [];
  const counts: Record<string, number> = {};
  const skippedCounts: Record<string, number> = {};
  const skip = (s: PatientSnapshot, reason: string, rule?: OutreachRule) => { skipped.push({ email: s.email, nombre: s.nombre, reason, rule }); skippedCounts[skipKey(reason)] = (skippedCounts[skipKey(reason)] ?? 0) + 1; };

  if (base.ameliaOk && enabled.length) {
    const seenPhones = new Set<string>();
    const ordered = [...base.snaps.values()].sort((a, b) => a.email.localeCompare(b.email));
    for (const s of ordered) {
      if (!s.phone) { skip(s, "sin teléfono"); continue; }
      if (seenPhones.has(s.phone)) { skip(s, "mismo teléfono que otro paciente ya planificado"); continue; }
      const thr = sig.throttled.get(s.phone);
      if (thr != null) { skip(s, `Meta limitó los mensajes a este número hace ${Math.floor((nowMs - thr) / DAY)} días (healthy ecosystem / spam rate)`); continue; }
      const d = decideRule(s, nowMs, cfg, "wa");
      if (!isDecision(d)) { skip(s, d.skip, d.rule); continue; }
      const restantes = d.rule === "renovacion" ? Math.min(2, d.bono?.remaining ?? 0) : null;
      // Número: conversación ya enrutada a un habilitado → ese; si no, el menos cargado hoy. Debe tener plantilla.
      const route = routing.get(s.phone);
      const ordenNumeros = [...enabled].sort((a, b) => load(a.phone_number_id) - load(b.phone_number_id));
      if (route?.phone_number_id) { const i = ordenNumeros.findIndex((n) => n.phone_number_id === route.phone_number_id); if (i > 0) ordenNumeros.unshift(...ordenNumeros.splice(i, 1)); }
      let chosen: { n: WaNumber; pick: NonNullable<ReturnType<typeof pickTemplate>> } | null = null;
      let topeAlcanzado = false;
      for (const n of ordenNumeros) {
        if (load(n.phone_number_id) >= config.daily_limit_per_number) { topeAlcanzado = true; continue; }
        const pick = pickTemplate({ rows: mapRows.filter((r) => r.waba_id === n.waba_id), approved: byWaba.get(n.waba_id) ?? new Map(), usage, rule: d.rule, step: d.step, restantes });
        if (pick) { chosen = { n, pick }; break; }
      }
      if (!chosen) { skip(s, topeAlcanzado ? "tope diario de los números habilitados alcanzado" : `sin plantilla aprobada/activa para "${RULE_LABEL[d.rule]}${d.step ? " " + d.step : ""}" en los números habilitados`, d.rule); continue; }
      const first = s.nombre?.split(/\s+/)[0] ?? null;
      const { n, pick } = chosen;
      planned.set(n.phone_number_id, (planned.get(n.phone_number_id) ?? 0) + 1);
      usage.set(`${n.waba_id}|${pick.row.template_name}`, (usage.get(`${n.waba_id}|${pick.row.template_name}`) ?? 0) + 1);
      seenPhones.add(s.phone);
      const lastWa = sig.lastOutTemplate.get(s.phone);
      candidates.push({
        phone: s.phone, email: s.email, nombre: s.nombre, rule: d.rule, rule_label: RULE_LABEL[d.rule], step: d.step,
        template_name: pick.row.template_name, language: pick.row.language, from_number_id: n.phone_number_id, from_number_name: n.name, waba_id: n.waba_id,
        components: buildComponents(pick.meta, first),
        preview: (pick.meta.headerParam ? `${first || "Hola"} · ` : "") + pick.meta.bodyText.replace(/\{\{\d+\}\}/g, first || "Hola"),
        reason: d.reason,
        context: {
          bono: d.bono?.packageName ?? null, sesiones: d.bono ? d.bono.remaining : null, caduca: d.bono?.endMs ? fmtFecha(d.bono.endMs) : null,
          psicologa: d.bono?.providerName || null, diag_pagado: s.diagPaidMs ? fmtFecha(s.diagPaidMs) : null,
          ultimo_envio: lastOutreachLabel(s), ultima_plantilla_wa: lastWa ? `${lastWa.name ?? "plantilla"} · ${fmtFecha(lastWa.ms)}` : null,
          amelia_customer_id: d.bono?.customerId ?? null, conversation_id: route?.conversation_id ?? null,
        },
      });
      counts[d.rule] = (counts[d.rule] ?? 0) + 1;
    }
  }
  candidates.sort((a, b) => RULE_ORDER[a.rule] - RULE_ORDER[b.rule] || (a.step ?? 0) - (b.step ?? 0) || a.email.localeCompare(b.email));

  const numbers = numbersAll.map((n) => {
    const rowsWaba = mapRows.filter((r) => r.waba_id === n.waba_id && r.active);
    const approved = byWaba.get(n.waba_id);
    const missing = approved ? rowsWaba.filter((r) => { const m = approved.get(`${r.template_name}|${r.language}`); return !m || m.status !== "APPROVED"; }).map((r) => r.template_name) : [];
    return { phone_number_id: n.phone_number_id, name: n.name, phone_number: n.phone_number, waba_id: n.waba_id, enabled: config.enabled_numbers.includes(n.phone_number_id), can_send: n.can_send, sent_today: sentToday.get(n.phone_number_id) ?? 0, planned: planned.get(n.phone_number_id) ?? 0, templates_ok: approved ? rowsWaba.length - missing.length : 0, templates_missing: [...new Set(missing)] };
  });
  const usageOut: Record<string, number> = {};
  for (const [k, v] of usage) usageOut[k] = v;
  return { ok: true, generated_at: new Date(nowMs).toISOString(), amelia_ok: base.ameliaOk, warnings, config, numbers, template_usage_7d: usageOut, counts, candidates, skipped, skipped_counts: skippedCounts };
}

async function loadRouting(blog: SupabaseClient, phones: string[]): Promise<Map<string, { conversation_id: string; phone_number_id: string | null }>> {
  const out = new Map<string, { conversation_id: string; phone_number_id: string | null }>();
  const convs = await fetchAll<{ id: string; phone: string | null }>((a, b) => blog.from("conversations_mentesana").select("id, phone").range(a, b), 1000, 20);
  const wanted = new Set(phones);
  const convByPhone = new Map<string, string>();
  for (const c of convs) { const ph = (c.phone ?? "").replace(/\D/g, ""); if (wanted.has(ph) && !convByPhone.has(ph)) convByPhone.set(ph, c.id); }
  const routes = await fetchAll<{ conversation_id: string; phone_number_id: string | null }>((a, b) => blog.from("conversation_routing").select("conversation_id, phone_number_id").range(a, b), 1000, 20);
  const routeByConv = new Map(routes.map((r) => [r.conversation_id, r.phone_number_id]));
  for (const [ph, id] of convByPhone) out.set(ph, { conversation_id: id, phone_number_id: routeByConv.get(id) ?? null });
  return out;
}

// ─── Envío: programar en whatsapp_scheduled_templates_v2 y registrar en el log ─

export type WaRunResult = { batch_id: string; total: number; scheduled: number; failed: number; scheduled_for: string; rows: Array<{ from_number: string; template_name: string; recipients: number; scheduled_id: string | null; error?: string }> };

export async function runWaOutreach(opts: { candidates: WaCandidate[]; blog: SupabaseClient; createdBy: string; source: "panel" | "cron"; delayMinutes?: number; batchId?: string }): Promise<WaRunResult> {
  const { candidates, blog } = opts;
  const batchId = opts.batchId ?? `wa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const delay = opts.delayMinutes ?? 5;
  const scheduledFor = new Date(Date.now() + delay * 60_000).toISOString();
  const groups = new Map<string, WaCandidate[]>();
  for (const c of candidates) { const k = `${c.from_number_id}|${c.template_name}|${c.language}`; const l = groups.get(k) ?? []; l.push(c); groups.set(k, l); }
  const rows: WaRunResult["rows"] = [];
  const logRows: Array<Record<string, unknown>> = [];
  let scheduled = 0, failed = 0;
  for (const [, list] of groups) {
    const first = list[0];
    const porRegla = Object.entries(list.reduce<Record<string, number>>((acc, c) => { const k = c.rule_label + (c.step ? ` ${c.step}` : ""); acc[k] = (acc[k] ?? 0) + 1; return acc; }, {})).map(([k, n]) => `${k}: ${n}`).join(" · ");
    const { data, error } = await blog.from("whatsapp_scheduled_templates_v2").insert({
      created_by: opts.createdBy,
      template_name: first.template_name,
      language: first.language,
      from_number: first.from_number_id,
      components: [],
      scope: "bulk",
      conversation_id: null,
      phones: null,
      recipients: list.map((c) => ({ phone: c.phone, components: c.components })),
      scheduled_for: scheduledFor,
      notes: `🤖 Automático WhatsApp (${opts.source}) · ${porRegla} · lote ${batchId}`.slice(0, 500),
    }).select("id").single();
    const scheduledId = data?.id != null ? String(data.id) : null;
    rows.push({ from_number: first.from_number_name, template_name: first.template_name, recipients: list.length, scheduled_id: scheduledId, error: error?.message });
    if (error) failed += list.length; else scheduled += list.length;
    for (const c of list) {
      logRows.push({
        email: c.email, phone: c.phone, channel: "wa", amelia_customer_id: c.context.amelia_customer_id, rule: c.rule, step: c.step,
        template_slug: c.template_name, template_title: `${c.template_name} (${c.language})`, body: c.preview,
        batch_id: batchId, wa_conversation_id: c.context.conversation_id, scheduled_id: scheduledId, ok: !error, error: error?.message ?? null,
        agent_email: opts.createdBy, agent_name: opts.createdBy, source: opts.source,
        context: { reason: c.reason, ...c.context, from_number: c.from_number_id, from_number_name: c.from_number_name, waba_id: c.waba_id, scheduled_for: scheduledFor },
      });
    }
  }
  if (logRows.length) {
    const { error } = await blog.from("app_outreach_log").insert(logRows);
    if (error) console.warn("[wa-outreach] log failed:", error.message);
  }
  return { batch_id: batchId, total: candidates.length, scheduled, failed, scheduled_for: scheduledFor, rows };
}

export const waChannelLabel = CHANNEL_LABEL.wa;
