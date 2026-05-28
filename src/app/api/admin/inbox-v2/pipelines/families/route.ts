// GET /api/admin/inbox-v2/pipelines/families
// Lista todas las familias de pipelines con conteo de cards por fase.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAgent } from "@/lib/agent-auth";

const sb = createClient(
  process.env.NEXT_PUBLIC_BLOG_SUPABASE_URL!,
  process.env.BLOG_SUPABASE_SERVICE_KEY!,
  { auth: { persistSession: false } },
);

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireAgent(req);
  if ("status" in auth) return auth;

  const { data: families, error } = await sb
    .from("pipeline_families_v2")
    .select("family, display_name, total_phases, template_by_phase, category, is_active")
    .eq("is_active", true)
    .order("total_phases", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Conteos por familia × fase
  const { data: counts } = await sb.rpc("noop").select(); // placeholder no-op
  // En su lugar, agregamos con SQL nativo
  const { data: agg } = await sb
    .from("pipeline_cards_v2")
    .select("family, current_phase, assigned_to_email");

  const byFamily = new Map<string, { phases: Record<string, number>; total: number; assigned: number; unassigned: number }>();
  for (const f of families ?? []) byFamily.set(f.family, { phases: {}, total: 0, assigned: 0, unassigned: 0 });
  for (const row of agg ?? []) {
    const b = byFamily.get(row.family);
    if (!b) continue;
    b.phases[String(row.current_phase)] = (b.phases[String(row.current_phase)] ?? 0) + 1;
    b.total += 1;
    if (row.assigned_to_email) b.assigned += 1;
    else b.unassigned += 1;
  }

  const out = (families ?? []).map((f) => ({
    ...f,
    stats: byFamily.get(f.family) ?? { phases: {}, total: 0, assigned: 0, unassigned: 0 },
  }));

  return NextResponse.json({ families: out });
}
