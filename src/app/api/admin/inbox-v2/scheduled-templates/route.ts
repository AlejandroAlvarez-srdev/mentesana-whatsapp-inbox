// CRUD de plantillas Meta programadas (whatsapp_scheduled_templates_v2).
// GET ?status=&scope=&limit=  → lista
// POST → crea (admin)
// El cron /api/cron/send-scheduled-templates dispara los envíos cuando scheduled_for <= NOW().
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/admin-auth";

const sb = createClient(process.env.NEXT_PUBLIC_BLOG_SUPABASE_URL!, process.env.BLOG_SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } });
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const u = await requireAdmin(req); if (u) return u;
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const scope = url.searchParams.get("scope");
  const limit = Math.min(200, Number(url.searchParams.get("limit") ?? 100));
  let q = sb.from("whatsapp_scheduled_templates_v2").select("*").order("scheduled_for", { ascending: true }).limit(limit);
  if (status) q = q.eq("status", status);
  if (scope) q = q.eq("scope", scope);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ scheduled: data ?? [] });
}

export async function POST(req: NextRequest) {
  const u = await requireAdmin(req); if (u) return u;
  let body: any = {}; try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const template_name = String(body.template_name ?? "").trim();
  const language = String(body.language ?? "es").trim();
  const from_number = String(body.from_number ?? "").trim();
  const scope = body.scope === "bulk" ? "bulk" : "single";
  const scheduled_for_raw = body.scheduled_for;
  const components = Array.isArray(body.components) ? body.components : [];
  const conversation_id = body.conversation_id ? String(body.conversation_id) : null;
  const phones = Array.isArray(body.phones) ? body.phones.map(String) : null;
  const recipients = Array.isArray(body.recipients) ? body.recipients : null;
  const notes = body.notes ? String(body.notes).slice(0, 500) : null;

  if (!template_name) return NextResponse.json({ error: "template_name requerido" }, { status: 400 });
  if (!from_number) return NextResponse.json({ error: "from_number requerido" }, { status: 400 });
  if (!scheduled_for_raw) return NextResponse.json({ error: "scheduled_for requerido (ISO o YYYY-MM-DDTHH:mm)" }, { status: 400 });

  // scheduled_for puede llegar como local Europe/Madrid o ISO. Lo normalizamos a UTC.
  const scheduled_for = parseScheduledFor(scheduled_for_raw);
  if (!scheduled_for || Number.isNaN(scheduled_for.getTime())) return NextResponse.json({ error: "scheduled_for inválido" }, { status: 400 });
  if (scheduled_for.getTime() < Date.now() - 60_000) return NextResponse.json({ error: "scheduled_for debe ser en el futuro" }, { status: 400 });

  if (scope === "single" && !conversation_id) return NextResponse.json({ error: "scope=single requiere conversation_id" }, { status: 400 });
  if (scope === "bulk" && (!phones || phones.length === 0) && (!recipients || recipients.length === 0)) {
    return NextResponse.json({ error: "scope=bulk requiere phones[] o recipients[]" }, { status: 400 });
  }

  const { data, error } = await sb.from("whatsapp_scheduled_templates_v2").insert({
    created_by: "admin",
    template_name,
    language,
    from_number,
    components,
    scope,
    conversation_id,
    phones,
    recipients,
    scheduled_for: scheduled_for.toISOString(),
    notes,
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, scheduled: data });
}

// "2026-05-21T15:30" del datetime-local picker → asumir Europe/Madrid.
// ISO completos con Z u offset se respetan.
function parseScheduledFor(v: string): Date | null {
  const s = String(v).trim();
  if (!s) return null;
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(s)) return new Date(s);
  // datetime-local sin zona → tratarlo como Europe/Madrid
  // Calcular offset Madrid en esa fecha (CET=+1, CEST=+2)
  const local = new Date(s);
  if (Number.isNaN(local.getTime())) return null;
  // Trick: format esa fecha con Intl y obtener el offset real
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Madrid", timeZoneName: "shortOffset" });
  const parts = fmt.formatToParts(local);
  const off = parts.find(p => p.type === "timeZoneName")?.value ?? "GMT+1";
  const m = off.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!m) return new Date(s + "Z");
  const sign = m[1] === "-" ? -1 : 1;
  const hh = parseInt(m[2], 10);
  const mm = m[3] ? parseInt(m[3], 10) : 0;
  const offsetMin = sign * (hh * 60 + mm);
  // local construido como si fuera UTC → restar offset Madrid para obtener UTC real
  const utcMs = Date.UTC(local.getFullYear(), local.getMonth(), local.getDate(), local.getHours(), local.getMinutes(), local.getSeconds()) - offsetMin * 60_000;
  return new Date(utcMs);
}
