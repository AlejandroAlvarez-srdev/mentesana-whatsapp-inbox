// PATCH → cancelar / cambiar scheduled_for
// DELETE → borrar (solo pending)
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/admin-auth";

const sb = createClient(process.env.NEXT_PUBLIC_BLOG_SUPABASE_URL!, process.env.BLOG_SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } });
export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireAdmin(req); if (u) return u;
  const { id } = await params;
  let body: any = {}; try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const patch: any = { updated_at: new Date().toISOString() };
  if (body.cancel === true) patch.status = "canceled";
  if (typeof body.scheduled_for === "string") patch.scheduled_for = new Date(body.scheduled_for).toISOString();
  if (typeof body.notes === "string") patch.notes = body.notes.slice(0, 500);
  const { data, error } = await sb.from("whatsapp_scheduled_templates_v2").update(patch).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, scheduled: data });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireAdmin(req); if (u) return u;
  const { id } = await params;
  const { error } = await sb.from("whatsapp_scheduled_templates_v2").delete().eq("id", id).eq("status", "pending");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
