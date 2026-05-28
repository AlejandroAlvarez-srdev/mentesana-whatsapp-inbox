// POST /api/admin/inbox-v2/pipelines/cards/:id/assign
// Body: { email: string | null }  → null para liberar
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAgent } from "@/lib/agent-auth";

const sb = createClient(
  process.env.NEXT_PUBLIC_BLOG_SUPABASE_URL!,
  process.env.BLOG_SUPABASE_SERVICE_KEY!,
  { auth: { persistSession: false } },
);

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAgent(req);
  if ("status" in auth) return auth;
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({})) as { email?: string | null };
  const email = body.email ? String(body.email).trim().toLowerCase() : null;

  const { data: card, error } = await sb
    .from("pipeline_cards_v2")
    .update({ assigned_to_email: email })
    .eq("id", id)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await sb.from("pipeline_events_v2").insert({
    card_id: id,
    from_phase: card.current_phase,
    to_phase: card.current_phase,
    agent_email: auth.agent.email,
    note: email ? `assigned to ${email}` : "unassigned",
  });

  return NextResponse.json({ card });
}
