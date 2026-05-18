import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/admin-auth";

const sb = createClient(process.env.NEXT_PUBLIC_BLOG_SUPABASE_URL!, process.env.BLOG_SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } });

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const u = await requireAdmin(req); if (u) return u;
  const { data, error } = await sb.from("tags_mentesana").select("*").order("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tags: data ?? [] });
}

export async function POST(req: NextRequest) {
  const u = await requireAdmin(req); if (u) return u;
  let body: any = {}; try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const name = String(body.name ?? "").trim();
  const color = String(body.color ?? "#888888").trim();
  const description = body.description ? String(body.description).trim() : null;
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  const id = `tag_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const nowIso = new Date().toISOString();
  const { data, error } = await sb.from("tags_mentesana").insert({ id, name, color, description, created_at: nowIso, updated_at: nowIso }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, tag: data });
}
