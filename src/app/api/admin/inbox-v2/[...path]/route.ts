import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";

const EDGE_BASE = `${process.env.NEXT_PUBLIC_BLOG_SUPABASE_URL}/functions/v1/inbox-v2-server`;
const ANON_KEY = process.env.NEXT_PUBLIC_BLOG_SUPABASE_ANON_KEY!;
const INBOX_SECRET = process.env.INBOX_SECRET ?? process.env.INSIGHTS_SECRET ?? "REDACTED_SECRET";

export const dynamic = "force-dynamic";

async function forward(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }, method: "GET" | "POST") {
  const unauth = await requireAdmin(req);
  if (unauth) return unauth;

  const { path } = await ctx.params;
  const search = new URL(req.url).search;
  const url = `${EDGE_BASE}/${path.join("/")}${search}`;

  const headers: Record<string, string> = {
    "Authorization": `Bearer ${ANON_KEY}`,
    "x-inbox-secret": INBOX_SECRET,
  };
  let body: string | undefined;
  if (method === "POST") {
    headers["Content-Type"] = "application/json";
    body = await req.text();
  }

  const upstream = await fetch(url, { method, headers, body });

  if (!upstream.ok || !upstream.body) {
    const txt = await upstream.text();
    return new Response(txt, {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
    });
  }

  return new Response(upstream.body, {
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      "cache-control": "no-cache",
    },
  });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, ctx, "GET");
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, ctx, "POST");
}
