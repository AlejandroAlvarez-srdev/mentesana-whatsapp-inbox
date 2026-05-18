import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/admin-auth";

const sb = createClient(process.env.NEXT_PUBLIC_BLOG_SUPABASE_URL!, process.env.BLOG_SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } });

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const u = await requireAdmin(req); if (u) return u;
  const { data, error } = await sb.from("quick_replies_v2").select("*").order("usage_count", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ quick_replies: data ?? [] });
}

export async function POST(req: NextRequest) {
  const u = await requireAdmin(req); if (u) return u;
  let body: any = {}; try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const title = String(body.title ?? "").trim();
  const content = String(body.content ?? "").trim();
  const shortcut = body.shortcut ? String(body.shortcut).trim() : null;
  const category = body.category ? String(body.category).trim() : "general";
  if (!title || !content) return NextResponse.json({ error: "title y content son requeridos" }, { status: 400 });
  const id = `qr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const nowIso = new Date().toISOString();
  const { data, error } = await sb.from("quick_replies_v2").insert({ id, title, content, shortcut, category, is_active: true, usage_count: 0, created_at: nowIso, updated_at: nowIso }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, quick_reply: data });
}
