import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/admin-auth";

const SUPABASE_URL = process.env.NEXT_PUBLIC_BLOG_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.BLOG_SUPABASE_SERVICE_KEY!;
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

export const dynamic = "force-dynamic";

// PATCH: actualizar is_default, status, name del número
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const unauth = await requireAdmin(req);
  if (unauth) return unauth;
  const { id: phoneNumberId } = await ctx.params;
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const patch: any = {};
  if ("is_default" in body) patch.is_default = !!body.is_default;
  if ("status" in body) patch.status = body.status; // 'active' | 'inactive'
  if ("name" in body) patch.name = String(body.name).slice(0, 100);
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "no_fields" }, { status: 400 });

  // Si marcamos uno como default, desmarcar los demás
  if (patch.is_default === true) {
    const { error: clearErr } = await sb.from("whatsapp_numbers").update({ is_default: false }).neq("phone_number_id", phoneNumberId);
    if (clearErr) return NextResponse.json({ error: "clear_default_failed", detail: clearErr.message }, { status: 500 });
  }
  patch.updated_at = new Date().toISOString();

  const { data, error } = await sb.from("whatsapp_numbers").update(patch).eq("phone_number_id", phoneNumberId).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, number: data });
}
