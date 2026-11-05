// Construye el contexto del borrador IA con herramientas de SOLO LECTURA:
//   - conversación + últimos ~20 mensajes de inbox-v2 (BLOG: conversations_mentesana /
//     messages_mentesana — las mismas tablas que lee inbox-v2-server; nada del monolito ni kv_store)
//   - Amelia por teléfono: próximas citas y sesiones restantes del bono (misma lógica que
//     /api/agent/customer-360 y /api/agent/amelia/upcoming-meet; solo SELECT)
//   - pautas do/don't del entrenador IA (match_learning_chunks sobre ai_learning_chunks, Voyage).
//     OJO: NO usamos rlhf/rag-retriever (match_session_notes_global = notas de sesión de OTROS
//     pacientes) para no meter datos clínicos de terceros en el prompt.
// Al modelo solo le llega lo mínimo del propio paciente: nada de notas, emails ni pagos.
import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ameliaQuery, ameliaTable } from "@/lib/amelia-db";
import { isExcludedPatient } from "@/lib/excluded-patients";
import { voyageEmbed } from "@/lib/voyage-embed";
import { lastInboundTurn } from "./supervisor";
import { redactSecrets } from "./guardrails";
import type { ChatTurn, DraftContext, UpcomingAppointment } from "./types";

export const MAX_TURNS = 20;

function sbBlog(): SupabaseClient {
  const url = (process.env.NEXT_PUBLIC_BLOG_SUPABASE_URL || "").replace(/\n/g, "").trim();
  const key = (process.env.BLOG_SUPABASE_SERVICE_KEY || "").replace(/\n/g, "").trim();
  return createClient(url, key, { auth: { persistSession: false } });
}

export type ConvRow = { id: string; phone: string; lead_name: string | null; email: string | null; client_type: string | null };

function phoneVariants(raw: string): string[] {
  const p = raw.replace(/\s+/g, "");
  return Array.from(new Set([p, p.replace(/^\+/, ""), p.startsWith("+") ? p : `+${p}`]));
}

export async function loadConversation(input: { conversationId?: string | null; phone?: string | null }): Promise<ConvRow | null> {
  const sb = sbBlog();
  if (input.conversationId) {
    const { data } = await sb.from("conversations_mentesana").select("*").eq("id", input.conversationId).maybeSingle();
    return data ? toConv(data) : null;
  }
  if (input.phone) {
    const { data } = await sb.from("conversations_mentesana").select("*").in("phone", phoneVariants(input.phone))
      .order("updated_at", { ascending: false }).limit(1);
    return data?.[0] ? toConv(data[0]) : null;
  }
  return null;
}

function toConv(r: Record<string, unknown>): ConvRow {
  return {
    id: String(r.id),
    phone: String(r.phone ?? ""),
    lead_name: (r.lead_name as string | null) ?? null,
    email: (r.email as string | null) ?? null,
    client_type: (r.client_type as string | null) ?? null,
  };
}

type MsgRow = { sender: string | null; content: string | null; transcription?: string | null; timestamp: string; is_template: boolean | null; template_name: string | null; media_type: string | null };

export function messagesToTurns(rows: MsgRow[], convPhone: string): ChatTurn[] {
  const phoneDigits = convPhone.replace(/\D/g, "");
  const turns: ChatTurn[] = [];
  for (const m of rows) {
    const sender = m.sender ?? "";
    const senderDigits = /^\+?\d+$/.test(sender) ? sender.replace(/\D/g, "") : "";
    let role: ChatTurn["role"];
    if (sender === convPhone || (senderDigits && senderDigits === phoneDigits)) role = "paciente";
    else if (sender === "psicologo") role = "psicologa";
    else if (senderDigits) continue; // otro número: no lo mezclamos
    else role = "agente";
    let text = (m.content ?? "").trim() || (m.transcription ?? "").trim();
    if (!text && m.media_type) text = `[${m.media_type}]`;
    if (m.is_template) text = `[plantilla ${m.template_name ?? ""}] ${text}`.trim();
    if (!text) continue;
    turns.push({ role, text: redactSecrets(text.slice(0, 600)).text, at: m.timestamp });
  }
  return turns;
}

export async function loadTurns(conv: ConvRow, limit = MAX_TURNS): Promise<ChatTurn[]> {
  const sb = sbBlog();
  // transcription no existe en todas las réplicas del esquema → reintento sin ella (INSERT/SELECT resilientes).
  let res = await sb.from("messages_mentesana")
    .select("sender, content, transcription, timestamp, is_template, template_name, media_type")
    .eq("conversation_id", conv.id).order("timestamp", { ascending: false }).limit(limit);
  if (res.error) {
    res = await sb.from("messages_mentesana")
      .select("sender, content, timestamp, is_template, template_name, media_type")
      .eq("conversation_id", conv.id).order("timestamp", { ascending: false }).limit(limit) as typeof res;
  }
  const rows = ((res.data ?? []) as MsgRow[]).reverse();
  return messagesToTurns(rows, conv.phone);
}

export async function loadAmelia(phone: string, email: string | null): Promise<DraftContext["amelia"] & { email: string | null }> {
  const empty = { found: false, excluded: false, upcoming: [], active_packages: [], remaining_sessions_total: 0, attended_sessions: 0, email: null };
  try {
    const variants = phoneVariants(phone);
    const users = await ameliaQuery<{ id: number; email: string | null }>(
      `SELECT id, email FROM ${ameliaTable("users")} WHERE type='customer' AND phone IN (${variants.map(() => "?").join(",")}) LIMIT 1`,
      variants,
    );
    const u = users[0];
    if (!u) return { ...empty, excluded: isExcludedPatient({ email }) };
    if (isExcludedPatient({ customerId: u.id, email: u.email }) || isExcludedPatient({ email })) {
      return { ...empty, found: true, excluded: true };
    }
    const cb = ameliaTable("customer_bookings");
    const ab = ameliaTable("appointments");
    const pc = ameliaTable("packages_to_customers");
    const [upc, pkgs, st] = await Promise.all([
      ameliaQuery<{ bookingStart: string; providerId: number | null; provider_fn: string | null; service_name: string | null }>(
        `SELECT a.bookingStart, a.providerId, pu.firstName provider_fn, s.name service_name
         FROM ${ab} a JOIN ${cb} cb ON cb.appointmentId = a.id
         LEFT JOIN ${ameliaTable("users")} pu ON pu.id = a.providerId
         LEFT JOIN ${ameliaTable("services")} s ON s.id = a.serviceId
         WHERE cb.customerId = ? AND cb.status IN ('approved','pending') AND a.bookingStart >= NOW()
         ORDER BY a.bookingStart ASC LIMIT 3`,
        [u.id],
      ),
      ameliaQuery<{ id: number; status: string; end: string | null; bookingsCount: number | null; package_name: string | null }>(
        `SELECT p.id, p.status, p.end, p.bookingsCount, pk.name AS package_name
         FROM ${pc} p LEFT JOIN ${ameliaTable("packages")} pk ON pk.id = p.packageId
         WHERE p.customerId = ? AND p.status='approved' AND (p.end IS NULL OR p.end >= NOW())
         ORDER BY p.purchased DESC LIMIT 5`,
        [u.id],
      ),
      // Semántica MS: cb.status pending = ASISTIÓ (reference_amelia_attendance)
      ameliaQuery<{ attended: number | null }>(`SELECT SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS attended FROM ${cb} WHERE customerId = ?`, [u.id]),
    ]);
    // Sesiones usadas por bono (approved/pending) — misma cuenta que customer-360.
    const used = new Map<number, number>();
    if (pkgs.length) {
      try {
        const rows = await ameliaQuery<{ pkg_cust_id: number; used: number }>(
          `SELECT pcs.packageCustomerId AS pkg_cust_id,
                  COALESCE(SUM(CASE WHEN cb_u.status IN ('approved','pending') THEN 1 ELSE 0 END), 0) AS used
           FROM ${ameliaTable("packages_customers_to_services")} pcs
           LEFT JOIN ${cb} cb_u ON cb_u.packageCustomerServiceId = pcs.id
           WHERE pcs.packageCustomerId IN (${pkgs.map(() => "?").join(",")})
           GROUP BY pcs.packageCustomerId`,
          pkgs.map((p) => p.id),
        );
        for (const r of rows) used.set(Number(r.pkg_cust_id), Number(r.used));
      } catch { /* sin desglose */ }
    }
    const active = pkgs.map((p) => ({
      name: p.package_name,
      remaining_sessions: Math.max(0, Number(p.bookingsCount ?? 0) - (used.get(Number(p.id)) ?? 0)),
      ends: p.end ? new Date(p.end).toISOString() : null,
    }));
    const upcoming: UpcomingAppointment[] = upc.map((a) => ({
      start: new Date(a.bookingStart).toISOString(),
      service: a.service_name,
      provider_first_name: a.provider_fn,
      provider_amelia_id: a.providerId != null ? Number(a.providerId) : null,
    }));
    return {
      found: true,
      excluded: false,
      upcoming,
      active_packages: active,
      remaining_sessions_total: active.reduce((s, p) => s + p.remaining_sessions, 0),
      attended_sessions: Number(st[0]?.attended ?? 0),
      email: u.email,
    };
  } catch {
    // Amelia caída o sin credenciales: seguimos sin esos datos.
    return { ...empty, excluded: isExcludedPatient({ email }) };
  }
}

export async function loadPlaybook(query: string, k = 4): Promise<DraftContext["playbook"]> {
  const q = query.trim();
  if (!q) return [];
  try {
    const emb = await voyageEmbed(q, "query");
    if (!emb) return [];
    const sb = sbBlog();
    const [dos, donts] = await Promise.all([
      sb.rpc("match_learning_chunks", { query_embedding: emb, match_count: k, want_kind: "do" }),
      sb.rpc("match_learning_chunks", { query_embedding: emb, match_count: Math.max(1, Math.ceil(k / 2)), want_kind: "dont" }),
    ]);
    const norm = (rows: unknown, kind: "do" | "dont") => Array.isArray(rows)
      ? (rows as { title?: string; content?: string }[]).map((r) => ({ kind, text: redactSecrets(`${r.title ? `${r.title}: ` : ""}${r.content ?? ""}`.slice(0, 400)).text })).filter((r) => r.text.trim())
      : [];
    return [...norm(dos.data, "do"), ...norm(donts.data, "dont")];
  } catch {
    return [];
  }
}

export async function buildDraftContext(conv: ConvRow): Promise<{ ctx: DraftContext; patientEmail: string | null }> {
  const turns = await loadTurns(conv);
  const last = lastInboundTurn(turns);
  const [amelia, playbook] = await Promise.all([loadAmelia(conv.phone, conv.email), loadPlaybook(last)]);
  const { email: ameliaEmail, ...ameliaCtx } = amelia;
  const firstName = (conv.lead_name ?? "").trim().split(/\s+/)[0] || null;
  return {
    ctx: { lead_first_name: firstName, turns, amelia: ameliaCtx, playbook },
    patientEmail: conv.email ?? ameliaEmail ?? null,
  };
}

/** Log best-effort en inbox_ai_drafts (la tabla puede no existir todavía). */
export async function logDraft(row: Record<string, unknown>): Promise<string | null> {
  try {
    const { data, error } = await sbBlog().from("inbox_ai_drafts").insert(row).select("id").maybeSingle();
    if (error) return null;
    return (data as { id?: string } | null)?.id ?? null;
  } catch {
    return null;
  }
}
