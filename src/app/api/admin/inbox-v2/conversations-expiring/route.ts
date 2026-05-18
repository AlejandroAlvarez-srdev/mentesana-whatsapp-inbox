import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/admin-auth";

const sb = createClient(process.env.NEXT_PUBLIC_BLOG_SUPABASE_URL!, process.env.BLOG_SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } });

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const u = await requireAdmin(req); if (u) return u;
  const url = new URL(req.url);
  const hours = Math.min(48, Math.max(1, Number(url.searchParams.get("hours") ?? 6)));
  const clientType = url.searchParams.get("client_type") || null;
  const { data, error } = await sb.rpc("conversations_window_summary", { hours_to_check: hours, filter_client_type: clientType });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const all = data ?? [];
  const counts = { open: 0, expiring_soon: 0, expired: 0 } as Record<string, number>;
  for (const c of all) counts[c.window_status] = (counts[c.window_status] ?? 0) + 1;
  return NextResponse.json({ conversations: all, counts });
}
