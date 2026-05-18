import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/admin-auth";

const sb = createClient(process.env.NEXT_PUBLIC_BLOG_SUPABASE_URL!, process.env.BLOG_SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } });

export const dynamic = "force-dynamic";

// POST { phone_number_id } → upsert conversation_routing + escribe a kv_store
// para que el monolito tambien lo vea
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const unauth = await requireAdmin(req);
  if (unauth) return unauth;

  const { id: convId } = await ctx.params;
  let body: any = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const phoneNumberId = String(body.phone_number_id ?? "").trim();
  if (!phoneNumberId) return NextResponse.json({ error: "phone_number_id required" }, { status: 400 });

  // Validar que el número existe y esta activo
  const { data: num, error: numErr } = await sb.from("whatsapp_numbers").select("phone_number_id, name").eq("phone_number_id", phoneNumberId).maybeSingle();
  if (numErr || !num) return NextResponse.json({ error: "número no existe o inactivo" }, { status: 400 });

  // 1) Upsert en conversation_routing
  const { error: rErr } = await sb.from("conversation_routing").upsert(
    { conversation_id: convId, phone_number_id: phoneNumberId, updated_at: new Date().toISOString() },
    { onConflict: "conversation_id" },
  );
  if (rErr) return NextResponse.json({ error: "routing_upsert: " + rErr.message }, { status: 500 });

  // 2) Mirror a kv_store_226b0b0d para que el monolito tambien lo vea
  await sb.from("kv_store_226b0b0d").upsert(
    { key: `conversation_whatsapp_number:${convId}`, value: phoneNumberId },
  );

  return NextResponse.json({ ok: true, assigned: { conversation_id: convId, phone_number_id: phoneNumberId, name: num.name } });
}
