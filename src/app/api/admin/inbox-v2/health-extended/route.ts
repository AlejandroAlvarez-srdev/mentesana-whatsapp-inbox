import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/admin-auth";

const SUPABASE_URL = process.env.NEXT_PUBLIC_BLOG_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.BLOG_SUPABASE_SERVICE_KEY!;
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const unauth = await requireAdmin(req);
  if (unauth) return unauth;

  const [{ data: numbers }, convTotal, routingActive, msgs1h, msgs24h, msgsTotal, { data: recentMsgs }, { data: realtimeCheck }] = await Promise.all([
    sb.rpc("inbox_health_per_number"),
    sb.from("conversations_mentesana").select("id", { count: "exact", head: true }).then((r) => r.count ?? 0),
    sb.from("conversation_routing").select("conversation_id", { count: "exact", head: true }).not("phone_number_id", "is", null).then((r) => r.count ?? 0),
    sb.from("messages_mentesana").select("id", { count: "exact", head: true }).gte("timestamp", new Date(Date.now() - 3600_000).toISOString()).then((r) => r.count ?? 0),
    sb.from("messages_mentesana").select("id", { count: "exact", head: true }).gte("timestamp", new Date(Date.now() - 86400_000).toISOString()).then((r) => r.count ?? 0),
    sb.from("messages_mentesana").select("id", { count: "exact", head: true }).then((r) => r.count ?? 0),
    sb
      .from("messages_mentesana")
      .select("id, conversation_id, sender, sender_name, content, timestamp, is_template, template_name")
      .order("timestamp", { ascending: false })
      .limit(15),
    sb.from("pg_publication_tables").select("tablename").eq("pubname", "supabase_realtime").in("tablename", ["messages_mentesana", "conversations_mentesana"]) as any,
  ]);

  // Hidratar mensajes recientes con nombre del lead + phone de la conversación
  let recentEnriched: any[] = [];
  if (recentMsgs && recentMsgs.length > 0) {
    const convIds = Array.from(new Set(recentMsgs.map((m: any) => m.conversation_id)));
    const { data: convs } = await sb.from("conversations_mentesana").select("id, phone, lead_name").in("id", convIds);
    const byId = new Map((convs ?? []).map((c: any) => [c.id, c]));
    recentEnriched = recentMsgs.map((m: any) => {
      const c = byId.get(m.conversation_id);
      return {
        ...m,
        lead_name: c?.lead_name ?? null,
        lead_phone: c?.phone ?? null,
        is_inbound: c?.phone === m.sender,
      };
    });
  }

  return NextResponse.json({
    generated_at: new Date().toISOString(),
    numbers: numbers ?? [],
    stats: {
      conv_total: convTotal,
      routing_active: routingActive,
      conv_unrouted: convTotal - routingActive,
      msgs_total: msgsTotal,
      msgs_1h: msgs1h,
      msgs_24h: msgs24h,
    },
    realtime_enabled: (realtimeCheck ?? []).length === 2,
    recent: recentEnriched,
  });
}
