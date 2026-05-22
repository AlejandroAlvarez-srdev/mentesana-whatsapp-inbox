import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getAgent } from "@/lib/agent-auth";

const EDGE_BASE = `${process.env.NEXT_PUBLIC_BLOG_SUPABASE_URL}/functions/v1/inbox-v2-server`;
const ANON_KEY = process.env.NEXT_PUBLIC_BLOG_SUPABASE_ANON_KEY!;
const INBOX_SECRET = process.env.INBOX_SECRET ?? process.env.INSIGHTS_SECRET ?? "REDACTED_SECRET";

export const dynamic = "force-dynamic";

async function forward(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }, method: "GET" | "POST") {
  const unauth = await requireAdmin(req);
  if (unauth) return unauth;

  // El admin es un agent con role='admin', así que también tiene cookie de agent — la usamos
  // para conocer su nombre y inyectarlo en send-text/send-template/broadcast (antes los
  // mensajes salían como 'Agente' genérico porque el cliente hardcodea agent_name='agente').
  const agent = await getAgent(req);

  const { path } = await ctx.params;
  const pathStr = path.join("/");
  const search = new URL(req.url).search;
  const url = `${EDGE_BASE}/${pathStr}${search}`;

  const headers: Record<string, string> = {
    "Authorization": `Bearer ${ANON_KEY}`,
    "x-inbox-secret": INBOX_SECRET,
  };
  let body: BodyInit | undefined;
  if (method === "POST") {
    const reqCT = req.headers.get("content-type") ?? "";
    const isMultipart = reqCT.toLowerCase().includes("multipart/form-data");
    if (isMultipart) {
      headers["Content-Type"] = reqCT;
      body = await req.arrayBuffer();
    } else {
      headers["Content-Type"] = "application/json";
      const raw = await req.text();
      if (raw && agent && (pathStr.endsWith("/send-text") || pathStr.endsWith("/send-template") || pathStr.startsWith("broadcast/"))) {
        try {
          const j = JSON.parse(raw);
          if (!j.agent_id) j.agent_id = agent.id;
          if (!j.agent_name || j.agent_name === "agente") j.agent_name = agent.name?.trim() || agent.email;
          body = JSON.stringify(j);
        } catch {
          body = raw;
        }
      } else {
        body = raw;
      }
    }
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
