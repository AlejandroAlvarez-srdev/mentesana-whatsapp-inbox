import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/admin-auth";

const SUPABASE_URL = process.env.NEXT_PUBLIC_BLOG_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.BLOG_SUPABASE_SERVICE_KEY!;
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

export const dynamic = "force-dynamic";

// Helper: replicar cambios a TODAS las entradas del kv_store con el mismo phoneNumberId
async function mirrorToKvStore(phoneNumberId: string, fullPatch: Record<string, any>) {
  const { data: kvRows } = await sb.from("kv_store_226b0b0d").select("key, value").like("key", "whatsapp:number:%");
  const matching = (kvRows ?? []).filter((r: any) => {
    let v: any = r.value;
    if (typeof v === "string") { try { v = JSON.parse(v); } catch { return false; } }
    return v?.phoneNumberId === phoneNumberId;
  });
  for (const r of matching) {
    let v: any = r.value;
    if (typeof v === "string") v = JSON.parse(v);
    const merged = { ...v, ...fullPatch, metadata: { ...(v.metadata ?? {}), ...(fullPatch.metadata ?? {}), updatedAt: new Date().toISOString() } };
    await sb.from("kv_store_226b0b0d").update({ value: merged }).eq("key", r.key);
  }
  return matching.length;
}

// PATCH: editar campos del número
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const unauth = await requireAdmin(req);
  if (unauth) return unauth;
  const { id: phoneNumberId } = await ctx.params;
  let body: any = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const patch: any = {};
  const kvPatch: any = {};
  if ("is_default" in body) { patch.is_default = !!body.is_default; kvPatch.isDefault = !!body.is_default; }
  if ("status" in body) { patch.status = body.status; kvPatch.status = body.status; }
  if ("name" in body) { patch.name = String(body.name).slice(0, 100); kvPatch.name = patch.name; }
  if ("access_token" in body && String(body.access_token).trim()) { patch.access_token = String(body.access_token).trim(); kvPatch.accessToken = patch.access_token; }
  if ("phone_number" in body) { patch.phone_number = body.phone_number ? String(body.phone_number).trim() : null; kvPatch.phoneNumber = patch.phone_number; }
  if ("business_account_id" in body) { patch.business_account_id = body.business_account_id ? String(body.business_account_id).trim() : null; kvPatch.businessAccountId = patch.business_account_id; }
  if ("is_pdf_number" in body) { patch.is_pdf_number = !!body.is_pdf_number; kvPatch.isPdfNumber = patch.is_pdf_number; }
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "no_fields" }, { status: 400 });

  // Si lo marcamos como default → desmarcar los demás (tabla y kv_store)
  if (patch.is_default === true) {
    const { data: others } = await sb.from("whatsapp_numbers").select("phone_number_id").neq("phone_number_id", phoneNumberId).eq("is_default", true);
    await sb.from("whatsapp_numbers").update({ is_default: false }).neq("phone_number_id", phoneNumberId);
    for (const o of others ?? []) {
      await mirrorToKvStore(o.phone_number_id, { isDefault: false });
    }
  }

  patch.updated_at = new Date().toISOString();
  const { data, error } = await sb.from("whatsapp_numbers").update(patch).eq("phone_number_id", phoneNumberId).select().single();
  if (error) return NextResponse.json({ error: "table_update: " + error.message }, { status: 500 });

  const synced = await mirrorToKvStore(phoneNumberId, kvPatch);

  return NextResponse.json({ ok: true, number: { ...data, access_token: undefined, access_token_preview: data.access_token ? `${data.access_token.slice(0, 8)}…${data.access_token.slice(-4)}` : null }, kv_rows_synced: synced });
}

// DELETE: borrar número (tabla + kv_store)
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const unauth = await requireAdmin(req);
  if (unauth) return unauth;
  const { id: phoneNumberId } = await ctx.params;

  // 1) borrar de whatsapp_numbers
  const { error: delErr } = await sb.from("whatsapp_numbers").delete().eq("phone_number_id", phoneNumberId);
  if (delErr) return NextResponse.json({ error: "table_delete: " + delErr.message }, { status: 500 });

  // 2) borrar de kv_store todas las entradas con ese phoneNumberId
  const { data: kvRows } = await sb.from("kv_store_226b0b0d").select("key, value").like("key", "whatsapp:number:%");
  const toDelete = (kvRows ?? []).filter((r: any) => {
    let v: any = r.value;
    if (typeof v === "string") { try { v = JSON.parse(v); } catch { return false; } }
    return v?.phoneNumberId === phoneNumberId;
  });
  for (const r of toDelete) {
    await sb.from("kv_store_226b0b0d").delete().eq("key", r.key);
  }

  return NextResponse.json({ ok: true, deleted_kv_rows: toDelete.length });
}
