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
  if ("name" in body) patch.name = String(body.name).trim();
  if ("color" in body) patch.color = String(body.color).trim();
  if ("description" in body) patch.description = body.description ? String(body.description).trim() : null;
  const { data, error } = await sb.from("tags_mentesana").update(patch).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, tag: data });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await requireAdmin(req); if (u) return u;
  const { id } = await ctx.params;
  await sb.from("contact_tags_mentesana").delete().eq("tag_id", id);
  const { error } = await sb.from("tags_mentesana").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
