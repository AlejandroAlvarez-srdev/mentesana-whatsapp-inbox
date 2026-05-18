import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/admin-auth";

const SUPABASE_URL = process.env.NEXT_PUBLIC_BLOG_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.BLOG_SUPABASE_SERVICE_KEY!;
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

const WHATSAPP_API = "https://graph.facebook.com/v21.0";
const BUCKET = "inbox-media";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function mimeToMetaType(mime: string): "image" | "video" | "audio" | "document" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const unauth = await requireAdmin(req);
  if (unauth) return unauth;
  const { id: convId } = await ctx.params;

  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("multipart/form-data")) return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 });

  const fd = await req.formData();
  const file = fd.get("file") as File | null;
  const caption = (fd.get("caption") as string | null) ?? null;
  const fromOverride = (fd.get("from_number") as string | null) ?? null;
  const agentId = (fd.get("agent_id") as string | null) ?? null;
  const agentName = (fd.get("agent_name") as string | null) ?? "agente";
  if (!file) return NextResponse.json({ error: "file is required" }, { status: 400 });

  // 1) Conv + número
  const { data: conv, error: convErr } = await sb.from("conversations_mentesana").select("id, phone, lead_name").eq("id", convId).single();
  if (convErr || !conv) return NextResponse.json({ error: "conversation not_found" }, { status: 404 });

  const { data: routing } = await sb.from("conversation_routing").select("phone_number_id").eq("conversation_id", convId).maybeSingle();
  let { data: nums } = await sb.from("whatsapp_numbers").select("phone_number_id, name, phone_number, access_token, business_account_id, is_default, status").eq("status", "active");
  nums = nums ?? [];
  let chosen = fromOverride ? nums.find((n: any) => n.phone_number_id === fromOverride) : null;
  if (!chosen && routing?.phone_number_id) chosen = nums.find((n: any) => n.phone_number_id === routing.phone_number_id) ?? null;
  if (!chosen) chosen = nums.find((n: any) => n.is_default) ?? nums[0];
  if (!chosen) return NextResponse.json({ error: "no_whatsapp_number_configured" }, { status: 500 });

  // 2) Upload a Supabase Storage
  const mime = file.type || "application/octet-stream";
  const safeName = (file.name || "media").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  const objectKey = `${convId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeName}`;
  const fileBuf = await file.arrayBuffer();
  const { error: upErr } = await sb.storage.from(BUCKET).upload(objectKey, fileBuf, { contentType: mime, upsert: false });
  if (upErr) return NextResponse.json({ error: "storage_upload: " + upErr.message }, { status: 500 });
  const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(objectKey);
  const mediaUrl = pub.publicUrl;

  // 3) Send to Meta via URL
  const metaType = mimeToMetaType(mime);
  const payload: any = { messaging_product: "whatsapp", to: conv.phone, type: metaType };
  payload[metaType] = { link: mediaUrl };
  if (caption && (metaType === "image" || metaType === "video" || metaType === "document")) payload[metaType].caption = caption;
  if (metaType === "document" && safeName) payload[metaType].filename = safeName;

  const metaRes = await fetch(`${WHATSAPP_API}/${chosen.phone_number_id}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${chosen.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!metaRes.ok) {
    const txt = await metaRes.text();
    return NextResponse.json({ error: "meta_send_failed", detail: txt.slice(0, 400), media_url: mediaUrl, used_number: { name: chosen.name, phone_number_id: chosen.phone_number_id } }, { status: 502 });
  }
  const metaJ = await metaRes.json();
  const wamid = metaJ.messages?.[0]?.id ?? "";

  // 4) Insert en messages_mentesana
  const nowIso = new Date().toISOString();
  const msgId = wamid || `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const previewContent = caption ?? `[${metaType}] ${safeName}`;
  const { error: insErr } = await sb.from("messages_mentesana").insert({
    id: msgId,
    conversation_id: convId,
    phone: conv.phone,
    sender: agentId ?? "agent",
    sender_name: agentName,
    agent_name: agentName,
    sent_by_agent_id: agentId || null,
    content: previewContent,
    type: metaType,
    is_template: false,
    template_name: null,
    timestamp: nowIso,
    created_at: nowIso,
    status: "sent",
    message_id: wamid || null,
    read: true,
    media_url: mediaUrl,
    media_type: metaType,
    media_mime_type: mime,
    media_filename: safeName,
    media_caption: caption,
  });
  if (insErr) return NextResponse.json({ error: "db_insert: " + insErr.message, wamid, media_url: mediaUrl }, { status: 500 });

  // 5) Mark conv as read (regla del equipo)
  await sb.from("conversations_mentesana").update({ last_message: previewContent.slice(0, 500), last_message_time: nowIso, updated_at: nowIso, unread_count: 0 }).eq("id", convId);
  await sb.from("messages_mentesana").update({ read: true }).eq("conversation_id", convId).eq("read", false);

  return NextResponse.json({ ok: true, message_id: msgId, wamid, sent_at: nowIso, media_url: mediaUrl, media_type: metaType, sent_from: { name: chosen.name, phone_number_id: chosen.phone_number_id } });
}
