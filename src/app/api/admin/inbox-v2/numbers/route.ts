import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/admin-auth";

const SUPABASE_URL = process.env.NEXT_PUBLIC_BLOG_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.BLOG_SUPABASE_SERVICE_KEY!;
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

export const dynamic = "force-dynamic";

// GET = lista (igual que /whatsapp-numbers pero devuelve tokens enmascarados para admin)
export async function GET(req: NextRequest) {
  const unauth = await requireAdmin(req);
  if (unauth) return unauth;
  const { data, error } = await sb.from("whatsapp_numbers").select("*").order("is_default", { ascending: false }).order("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // Enmascara los tokens: primeros 8 + últimos 4
  const safe = (data ?? []).map((n: any) => ({
    ...n,
    access_token_preview: n.access_token ? `${n.access_token.slice(0, 8)}…${n.access_token.slice(-4)}` : null,
    access_token: undefined,
  }));
  return NextResponse.json({ numbers: safe });
}

// POST = crear nuevo número WhatsApp
export async function POST(req: NextRequest) {
  const unauth = await requireAdmin(req);
  if (unauth) return unauth;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const name = String(body.name ?? "").trim();
  const phone_number_id = String(body.phone_number_id ?? "").trim();
  const access_token = String(body.access_token ?? "").trim();
  const business_account_id = body.business_account_id ? String(body.business_account_id).trim() : null;
  const phone_number = body.phone_number ? String(body.phone_number).trim() : null;
  const is_default = !!body.is_default;
  const is_pdf_number = !!body.is_pdf_number;

  if (!name || !phone_number_id || !access_token) {
    return NextResponse.json({ error: "name, phone_number_id y access_token son obligatorios" }, { status: 400 });
  }

  // Si ya existe, error
  const { data: existing } = await sb.from("whatsapp_numbers").select("phone_number_id").eq("phone_number_id", phone_number_id).maybeSingle();
  if (existing) return NextResponse.json({ error: `Ya existe un número con phone_number_id ${phone_number_id}` }, { status: 409 });

  const wa_number_id = `wanum_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  const nowIso = new Date().toISOString();

  // Si marcamos default, limpiar los demás
  if (is_default) {
    await sb.from("whatsapp_numbers").update({ is_default: false }).neq("phone_number_id", phone_number_id);
  }

  // 1) Insert en whatsapp_numbers
  const { data: inserted, error: insErr } = await sb.from("whatsapp_numbers").insert({
    phone_number_id,
    wa_number_id,
    name,
    access_token,
    business_account_id,
    phone_number,
    is_default,
    is_pdf_number,
    status: "active",
    capabilities: { canSendMessages: true, canSendTemplates: true, canReceiveMessages: true },
    limits: { messagesPerDay: 1000, currentUsage: 0, lastReset: nowIso },
    metadata: { createdAt: nowIso, createdBy: "inbox-v2-admin", updatedAt: nowIso },
    created_at: nowIso,
    updated_at: nowIso,
    imported_from_kv: `whatsapp:number:${wa_number_id}`,
  }).select().single();
  if (insErr) return NextResponse.json({ error: "table_insert: " + insErr.message }, { status: 500 });

  // 2) Insert en kv_store_226b0b0d para que el monolito lo vea
  const kvValue = {
    id: wa_number_id,
    name,
    phoneNumberId: phone_number_id,
    accessToken: access_token,
    businessAccountId: business_account_id,
    phoneNumber: phone_number,
    isDefault: is_default,
    isPdfNumber: is_pdf_number,
    status: "active",
    capabilities: { canSendMessages: true, canSendTemplates: true, canReceiveMessages: true },
    limits: { messagesPerDay: 1000, currentUsage: 0, lastReset: nowIso },
    metadata: { createdAt: nowIso, createdBy: "inbox-v2-admin", updatedAt: nowIso },
  };
  const { error: kvErr } = await sb.from("kv_store_226b0b0d").upsert({
    key: `whatsapp:number:${wa_number_id}`,
    value: kvValue,
  });
  if (kvErr) {
    // rollback la tabla si falla el kv (mantener consistencia)
    await sb.from("whatsapp_numbers").delete().eq("phone_number_id", phone_number_id);
    return NextResponse.json({ error: "kv_insert: " + kvErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, number: inserted });
}
