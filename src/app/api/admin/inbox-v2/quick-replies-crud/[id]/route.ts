import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/admin-auth";

const sb = createClient(process.env.NEXT_PUBLIC_BLOG_SUPABASE_URL!, process.env.BLOG_SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } });

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await requireAdmin(req); if (u) return u;
  const { id } = await ctx.params;
  let body: any = {}; try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const patch: any = { updated_at: new Date().toISOString() };
  if ("title" in body) patch.title = String(body.title).trim();
  if ("content" in body) patch.content = String(body.content).trim();
  if ("shortcut" in body) patch.shortcut = body.shortcut ? String(body.shortcut).trim() : null;
  if ("category" in body) patch.category = String(body.category).trim();
  if ("is_active" in body) patch.is_active = !!body.is_active;
  const { data, error } = await sb.from("quick_replies_v2").update(patch).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, quick_reply: data });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await requireAdmin(req); if (u) return u;
  const { id } = await ctx.params;
  const { error } = await sb.from("quick_replies_v2").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
