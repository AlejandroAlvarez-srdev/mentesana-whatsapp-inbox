// GET /api/admin/inbox-v2/pipelines/:family/cards
// Devuelve familia + cards agrupadas por fase (incluyendo estados especiales -1/-2/-3).
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAgent } from "@/lib/agent-auth";

const sb = createClient(
  process.env.NEXT_PUBLIC_BLOG_SUPABASE_URL!,
  process.env.BLOG_SUPABASE_SERVICE_KEY!,
  { auth: { persistSession: false } },
);

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ family: string }> },
) {
  const auth = await requireAgent(req);
  if ("status" in auth) return auth;
  const { family } = await ctx.params;

  const { data: fam, error: fErr } = await sb
    .from("pipeline_families_v2")
    .select("*")
    .eq("family", family)
    .maybeSingle();
  if (fErr || !fam) return NextResponse.json({ error: "family_not_found" }, { status: 404 });

  const url = new URL(req.url);
  const filter = url.searchParams.get("filter"); // 'mine' | 'unassigned' | null
  const me = auth.agent.email;

  let q = sb
    .from("pipeline_cards_v2")
    .select("*")
    .eq("family", family)
    .order("updated_at", { ascending: false })
    .limit(2000);

  if (filter === "mine") q = q.eq("assigned_to_email", me);
  else if (filter === "unassigned") q = q.is("assigned_to_email", null);

  const { data: cards, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ family: fam, cards: cards ?? [] });
}
