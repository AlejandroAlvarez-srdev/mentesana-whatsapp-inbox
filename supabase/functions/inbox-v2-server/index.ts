// inbox-v2-server v18 — routing MM Lite: templates MARKETING → /marketing_messages, resto → /messages
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

function cleanKey(v: string | undefined): string | undefined { if (!v) return v; return v.replace(/[^\x20-\x7E]/g, '').trim(); }

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!.trim();
const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!.trim();
const ANTHROPIC_API_KEY = cleanKey(Deno.env.get('ANTHROPIC_API_KEY'));
const VOYAGE_API_KEY = cleanKey(Deno.env.get('VOYAGE_API_KEY'));
const INBOX_SECRET = (Deno.env.get('INBOX_SECRET') ?? Deno.env.get('INSIGHTS_SECRET') ?? 'REDACTED_SECRET').trim();
const WHATSAPP_API = 'https://graph.facebook.com/v21.0';

const MODEL_FAST = 'claude-haiku-4-5';
const MODEL_RICH = 'claude-sonnet-4-6';
const EMBED_MODEL = 'voyage-3-large';

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, { auth: { persistSession: false } });

type WaNumber = { phone_number_id: string; wa_number_id: string; name: string; access_token: string; business_account_id: string | null; phone_number: string | null; is_default: boolean; status: string; is_pdf_number: boolean };

let _waCache: { ts: number; numbers: WaNumber[] } | null = null;
async function loadWaNumbers(force = false): Promise<WaNumber[]> {
  const TTL = 30_000;
  if (!force && _waCache && Date.now() - _waCache.ts < TTL) return _waCache.numbers;
  const { data, error } = await sb.from('whatsapp_numbers').select('phone_number_id, wa_number_id, name, access_token, business_account_id, phone_number, is_default, status, is_pdf_number').eq('status', 'active');
  if (error) throw new Error('whatsapp_numbers: ' + error.message);
  _waCache = { ts: Date.now(), numbers: (data ?? []) as WaNumber[] };
  return _waCache.numbers;
}
async function getNumberForConversation(convId: string): Promise<WaNumber | null> {
  const { data: routing } = await sb.from('conversation_routing').select('phone_number_id').eq('conversation_id', convId).maybeSingle();
  const numbers = await loadWaNumbers();
  if (routing?.phone_number_id) {
    const m = numbers.find((n) => n.phone_number_id === routing.phone_number_id);
    if (m) return m;
  }
  return numbers.find((n) => n.is_default) ?? numbers[0] ?? null;
}

function json(data: any, status = 200) { return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } }); }
function checkSecret(req: Request): Response | null {
  const url = new URL(req.url);
  const provided = (req.headers.get('x-inbox-secret') ?? url.searchParams.get('secret') ?? '').trim();
  if (provided !== INBOX_SECRET) return json({ error: 'unauthorized' }, 401);
  return null;
}

async function callVoyageEmbedding(text: string, inputType: 'document' | 'query' = 'query'): Promise<number[]> {
  if (!VOYAGE_API_KEY) throw new Error('VOYAGE_API_KEY not configured');
  const res = await fetch('https://api.voyageai.com/v1/embeddings', { method: 'POST', headers: { 'Authorization': `Bearer ${VOYAGE_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: EMBED_MODEL, input: text.slice(0, 16000), input_type: inputType }) });
  if (!res.ok) throw new Error(`Voyage ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).data?.[0]?.embedding ?? [];
}
async function callVoyageBatch(texts: string[]): Promise<number[][]> {
  if (!VOYAGE_API_KEY) throw new Error('VOYAGE_API_KEY not configured');
  const res = await fetch('https://api.voyageai.com/v1/embeddings', { method: 'POST', headers: { 'Authorization': `Bearer ${VOYAGE_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: EMBED_MODEL, input: texts, input_type: 'document' }) });
  if (!res.ok) throw new Error(`Voyage ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const d = await res.json();
  return (d.data || []).map((x: any) => x.embedding as number[]);
}

function streamAnthropic(model: string, max_tokens: number, system: string, userContent: string): Response {
  return new Response(new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder(); const dec = new TextDecoder();
      try {
        const up = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model, max_tokens, stream: true, system, messages: [{ role: 'user', content: userContent }] }) });
        if (!up.ok || !up.body) { controller.enqueue(enc.encode(`[CLAUDE ${up.status}: ${(await up.text()).slice(0, 300)}]`)); controller.close(); return; }
        const reader = up.body.getReader(); let buf = '';
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl;
          while ((nl = buf.indexOf('\n')) !== -1) {
            const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
            if (line.startsWith('data: ')) { const data = line.slice(6); if (data === '[DONE]') continue; try { const ev = JSON.parse(data); if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') controller.enqueue(enc.encode(ev.delta.text)); } catch { } }
          }
        }
      } catch (e) { controller.enqueue(enc.encode(`\n[STREAM ERROR: ${String(e)}]\n`)); } finally { controller.close(); }
    }
  }), { headers: { 'content-type': 'text/plain; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'no-cache' } });
}

const RISK_PATTERNS = [
  { level: 'critico', regex: /\b(suicid|matarme|pegarme un tiro|quitarme la vida|acabar con todo|no quiero vivir)\b/i, label: 'Ideacion suicida' },
  { level: 'critico', regex: /\b(maltrat|abus|violaci[oo]n|me peg[ao]|me agrede)\b/i, label: 'Violencia / abuso' },
  { level: 'alto', regex: /\b(denuncia|denunciar|consumo|ocu|abogado|fraude|estafa|reseña negativa|reseña google)\b/i, label: 'Amenaza legal' },
  { level: 'alto', regex: /\b(contracargo|chargeback|disputa visa|cancelar tarjeta)\b/i, label: 'Disputa bancaria' },
  { level: 'alto', regex: /\b(crisis|emergencia|urgente|hospital|ingres)\b/i, label: 'Crisis emocional' },
  { level: 'medio', regex: /\b(cobr[oa]r? sin|sin autorizar|no autorizad|me parece fatal|me parece mal)\b/i, label: 'Queja operacional grave' },
];
function detectRiskFlags(text: string): { level: string; label: string; match: string }[] {
  const flags: { level: string; label: string; match: string }[] = [];
  for (const p of RISK_PATTERNS) { const m = text.match(p.regex); if (m) flags.push({ level: p.level, label: p.label, match: m[0] }); }
  return flags;
}

async function listConversations(url: URL) {
  const search = (url.searchParams.get('search') ?? '').trim();
  const pipeline = url.searchParams.get('pipeline');
  const status = url.searchParams.get('status');
  const clientType = url.searchParams.get('client_type');
  const paidOnly = url.searchParams.get('paid') === 'true';
  const unreadOnly = url.searchParams.get('unread') === 'true';
  const assignedTo = url.searchParams.get('assigned_to');
  const phoneNumberId = url.searchParams.get('phone_number_id');
  const hasInsight = url.searchParams.get('hasInsight') === 'true';
  const limit = Math.min(500, Math.max(5, Number(url.searchParams.get('limit') ?? 30)));
  const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0));
  let q = sb.from('conversations_mentesana').select('id, phone, lead_name, source, pipeline_type, client_type, status, purchase_status, paid_at, purchase_amount, assigned_to, assigned_psychologist_name, last_message_time, last_message, unread_count, created_at', { count: 'exact' });
  if (pipeline) q = q.eq('pipeline_type', pipeline);
  if (status) q = q.eq('status', status);
  if (clientType) q = q.eq('client_type', clientType);
  if (assignedTo) q = q.eq('assigned_to', assignedTo);
  if (paidOnly) q = q.or('purchase_status.eq.pagado,paid_at.not.is.null,status.eq.pagado');
  if (unreadOnly) q = q.gt('unread_count', 0);
  if (search) q = q.or(`lead_name.ilike.%${search}%,phone.ilike.%${search}%,last_message.ilike.%${search}%`);
  q = q.order('last_message_time', { ascending: false, nullsFirst: false }).range(offset, offset + limit - 1);
  const { data, error, count } = await q;
  if (error) return json({ error: error.message }, 500);
  let filtered = data ?? [];
  if (phoneNumberId && filtered.length > 0) {
    const ids = filtered.map((c: any) => c.id);
    const { data: routes } = await sb.from('conversation_routing').select('conversation_id').eq('phone_number_id', phoneNumberId).in('conversation_id', ids);
    const set = new Set((routes ?? []).map((r: any) => r.conversation_id));
    filtered = filtered.filter((c: any) => set.has(c.id));
  }
  if (hasInsight && filtered.length > 0) {
    const ids = filtered.map((c: any) => c.id);
    const { data: insightIds } = await sb.from('conversation_insights').select('conversation_id').in('conversation_id', ids);
    const set = new Set((insightIds ?? []).map((i: any) => i.conversation_id));
    filtered = filtered.filter((c: any) => set.has(c.id));
  }
  return json({ conversations: filtered, total: count, limit, offset });
}

async function listContacts(url: URL) {
  const search = (url.searchParams.get('search') ?? '').trim();
  const clientType = url.searchParams.get('client_type');
  const status = url.searchParams.get('status');
  const limit = Math.min(500, Math.max(5, Number(url.searchParams.get('limit') ?? 50)));
  const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0));
  let q = sb.from('contacts_mentesana').select('phone, lead_name, email, status, source, test_score, payment_amount, utm_source, utm_campaign, ipc_type, client_type, priority, last_message_preview, last_message_time, unread_count, assigned_to, assigned_psychologist, created_at, updated_at', { count: 'exact' });
  if (clientType) q = q.eq('client_type', clientType);
  if (status) q = q.eq('status', status);
  if (search) q = q.or(`lead_name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`);
  q = q.order('updated_at', { ascending: false, nullsFirst: false }).range(offset, offset + limit - 1);
  const { data, error, count } = await q;
  if (error) return json({ error: error.message }, 500);
  return json({ contacts: data ?? [], total: count, limit, offset });
}

async function getConversation(id: string, includeMessages: boolean) {
  const { data: conv, error: convErr } = await sb.from('conversations_mentesana').select('*').eq('id', id).single();
  if (convErr || !conv) return json({ error: convErr?.message ?? 'not_found' }, 404);
  const { data: insight } = await sb.from('conversation_insights').select('*').eq('conversation_id', id).maybeSingle();
  let messages: any[] = [];
  if (includeMessages) {
    const { data: msgs, error: mErr } = await sb.from('messages_mentesana').select('id, sender, sender_name, content, type, is_template, template_name, timestamp, status, media_url, media_type, media_caption, media_mime_type, media_filename').eq('conversation_id', id).order('timestamp', { ascending: true }).limit(500);
    if (mErr) return json({ error: mErr.message }, 500);
    messages = (msgs ?? []).map((m: any) => ({ ...m, is_lead: m.sender === conv.phone, is_agent: m.sender !== conv.phone && m.sender !== 'psicologo' && !/^\d+$/.test(m.sender ?? ''), is_psychologist: m.sender === 'psicologo' }));
  }
  return json({ conversation: conv, insight, messages });
}

async function getRiskFlags(id: string) {
  const { data: conv } = await sb.from('conversations_mentesana').select('id, phone, lead_name').eq('id', id).single();
  if (!conv) return json({ error: 'not_found' }, 404);
  const { data: msgs } = await sb.from('messages_mentesana').select('content, timestamp').eq('conversation_id', id).eq('sender', conv.phone).limit(500);
  const allText = (msgs ?? []).map((m: any) => m.content ?? '').join(' \n ');
  const flags = detectRiskFlags(allText);
  return json({ conversation_id: id, lead_name: conv.lead_name, flag_count: flags.length, flags, max_level: flags.reduce((acc, f) => f.level === 'critico' ? 'critico' : (acc === 'critico' ? acc : (f.level === 'alto' ? 'alto' : acc)), 'ninguno') });
}

async function searchSemantic(query: string, topK: number, filterPaid: boolean | null) {
  if (!query.trim()) return json({ error: 'empty query' }, 400);
  const emb = await callVoyageEmbedding(query, 'query');
  const { data, error } = await sb.rpc('match_conversations', { query_embedding: emb, match_count: Math.min(50, Math.max(5, topK)), filter_paid: filterPaid, filter_pipeline: null });
  if (error) return json({ error: error.message }, 500);
  const ids = (data ?? []).map((m: any) => m.conversation_id);
  const { data: convs } = await sb.from('conversations_mentesana').select('id, lead_name, phone, last_message_time, purchase_status, paid_at').in('id', ids);
  const byId = new Map((convs ?? []).map((c: any) => [c.id, c]));
  return json({ results: (data ?? []).map((m: any, idx: number) => ({ rank: idx + 1, ...m, ...byId.get(m.conversation_id) })) });
}

let _tplCache: { ts: number; templatesByWaba: Map<string, any[]> } = { ts: 0, templatesByWaba: new Map() };
async function fetchApprovedTemplatesForNumber(num: WaNumber): Promise<any[]> {
  const TTL = 10 * 60_000;
  const wabaId = num.business_account_id;
  if (!wabaId) return [];
  if (_tplCache.templatesByWaba.has(wabaId) && Date.now() - _tplCache.ts < TTL) return _tplCache.templatesByWaba.get(wabaId)!;
  try {
    const all: any[] = [];
    let after: string | undefined = undefined;
    for (let page = 0; page < 10; page++) {
      const params = new URLSearchParams({ fields: 'name,language,status,category,components', limit: '200' });
      if (after) params.set('after', after);
      const r = await fetch(`${WHATSAPP_API}/${wabaId}/message_templates?${params}`, { headers: { 'Authorization': `Bearer ${num.access_token}` } });
      if (!r.ok) break;
      const j = await r.json();
      for (const t of j.data ?? []) if (t.status === 'APPROVED') all.push(t);
      after = j.paging?.cursors?.after;
      if (!after) break;
    }
    _tplCache.templatesByWaba.set(wabaId, all);
    _tplCache.ts = Date.now();
    return all;
  } catch { return []; }
}
function componentText(t: any, kind: 'HEADER' | 'BODY' | 'FOOTER'): string | null {
  const c = (t.components ?? []).find((x: any) => x.type === kind);
  if (!c) return null;
  if (kind === 'BODY' || kind === 'FOOTER') return c.text ?? null;
  if (c.format === 'TEXT') return c.text ?? null;
  return null;
}

async function suggestReply(id: string): Promise<Response> {
  const { data: conv } = await sb.from('conversations_mentesana').select('id, phone, lead_name, status, purchase_status, paid_at, assigned_psychologist_name').eq('id', id).single();
  if (!conv) return json({ error: 'not_found' }, 404);
  const { data: insight } = await sb.from('conversation_insights').select('*').eq('conversation_id', id).maybeSingle();
  const { data: lastMsgs } = await sb.from('messages_mentesana').select('content, sender, timestamp, is_template, template_name').eq('conversation_id', id).order('timestamp', { ascending: false }).limit(10);
  const lastLeadMsg = (lastMsgs ?? []).find((m: any) => m.sender === conv.phone)?.content ?? '';
  const recentHistory = (lastMsgs ?? []).slice().reverse().map((m: any) => { const who = m.sender === conv.phone ? 'LEAD' : (m.is_template ? `AGENTE(template:${m.template_name})` : 'AGENTE'); return `${who}: ${String(m.content ?? '').slice(0, 200)}`; }).join('\n');

  // Build query text
  const queryText = (insight
    ? `${insight.dolor_principal ?? ''} ${(insight.objeciones || []).join(' ')} ${lastLeadMsg}`
    : recentHistory).slice(0, 2000);

  // RAG: paid → any → none (nunca 404)
  let matches: any[] = [];
  let matchSource: 'paid' | 'any' | 'none' = 'none';
  try {
    const emb = await callVoyageEmbedding(queryText || (conv.lead_name ?? 'lead'), 'query');
    const paidRes = await sb.rpc('match_conversations', { query_embedding: emb, match_count: 8, filter_paid: true, filter_pipeline: null });
    if (paidRes.data && paidRes.data.length > 0) { matches = paidRes.data; matchSource = 'paid'; }
    else {
      const anyRes = await sb.rpc('match_conversations', { query_embedding: emb, match_count: 8, filter_paid: null, filter_pipeline: null });
      if (anyRes.data && anyRes.data.length > 0) { matches = anyRes.data; matchSource = 'any'; }
    }
  } catch (_e) { /* sigue sin matches */ }

  let ctx = '';
  if (matches.length > 0) {
    const ids = matches.map((m: any) => m.conversation_id);
    const { data: similarInsights } = await sb.from('conversation_insights').select('conversation_id, dolor_principal, motivo_compra, motivo_no_compra, triggers_compra, objeciones, quote_marketing, resumen').in('conversation_id', ids);
    const { data: similarConvs } = await sb.from('conversations_mentesana').select('id, purchase_status, paid_at').in('id', ids);
    const insightById = new Map((similarInsights ?? []).map((i: any) => [i.conversation_id, i]));
    const convById = new Map((similarConvs ?? []).map((c: any) => [c.id, c]));
    ctx = matches.map((m: any, idx: number) => {
      const i = insightById.get(m.conversation_id) as any;
      const c = convById.get(m.conversation_id) as any;
      const pagado = c?.purchase_status === 'pagado' || c?.paid_at;
      const tag = pagado ? 'PAGÓ' : 'no pagó';
      return `## Caso #${idx + 1} (similar ${m.similarity?.toFixed(2)}, ${tag})\nDolor: ${i?.dolor_principal ?? '?'}\nQue funciono: ${i?.motivo_compra ?? '?'}\nQue NO funciono: ${i?.motivo_no_compra ?? '-'}\nTriggers: ${(i?.triggers_compra || []).join('; ')}\nObjeciones: ${(i?.objeciones || []).join('; ')}\nQuote: ${i?.quote_marketing ?? ''}`;
    }).join('\n\n');
  }

  // NUEVO v16: cargamos plantillas Meta aprobadas del número asignado a esta conv
  let templatesBlock = '';
  try {
    const num = await getNumberForConversation(id);
    if (num) {
      const tpls = await fetchApprovedTemplatesForNumber(num);
      if (tpls.length > 0) {
        const lines = tpls.slice(0, 50).map((t: any) => {
          const body = (componentText(t, 'BODY') ?? '').replace(/\s+/g, ' ').slice(0, 180);
          return `- ${t.name} [${t.category}/${t.language}]: ${body}`;
        });
        templatesBlock = `\n\n# Plantillas Meta APROBADAS disponibles para este número (usa estos names exactos):\n${lines.join('\n')}`;
      }
    }
  } catch { /* sin plantillas */ }

  const system = `Eres una ASESORA ESTRATEGICA del equipo de ventas/soporte de MenteSana. NO redactas mensajes — el agente humano escribe a su voz. Tu trabajo es darle ANGULO + CONTEXTO + PUNTOS CLAVE + qué PLANTILLA META concreta enviar.\n\nFORMATO OBLIGATORIO (markdown):\n\n**Diagnóstico:** [1 frase: dónde está el lead emocional/comercialmente]\n**Ángulo recomendado:** [enfoque, dolor a tocar, trigger — SIN escribir frases del mensaje]\n**Plantilla recomendada:** \`<exact_template_name>\` — [1 frase explicando por qué esa]\n   _Alternativa:_ \`<otro_template_name>\` si la primera no encaja\n**Puntos clave a mencionar:** [bullets cortos]\n**Qué NO hacer:** [bullets de qué evitar]\n**Por qué funcionaría:** [1 frase apoyada en casos similares]\n\nREGLAS DURAS:\n- Si te paso plantillas disponibles, DEBES recomendar 1 por su name exacto (entre backticks). Si ninguna encaja, dilo: "Ninguna plantilla disponible encaja — recomiendo redactar mensaje libre".\n- PROHIBIDO escribir mensajes listos para enviar entre comillas.\n- PROHIBIDO empezar frases tipo "Hola X, ..." o "Te cuento...".\n- Solo das estrategia + nombre de plantilla; el agente redacta variables/voz.`;

  const insightBlock = insight
    ? `Dolor: ${insight.dolor_principal ?? '?'}\nObjeciones: ${(insight.objeciones || []).join('; ')}\nSentimiento: ${insight.sentimiento ?? '?'}\nPrecio sensibilidad: ${insight.precio_sensibilidad ?? '?'}\nMomento vital: ${insight.momento_vital ?? '?'}\nResumen: ${(insight.resumen ?? '').slice(0, 400)}`
    : '(sin insight Voyage extraído — basándote solo en mensajes recientes)';

  const ctxBlock = matchSource === 'paid'
    ? `# Casos similares que PAGARON\n${ctx}`
    : matchSource === 'any'
      ? `# Casos similares (mira el tag pagó/no pagó)\n${ctx}`
      : `# Sin casos similares en el cerebro vectorial — dá estrategia general en base al estado del lead.`;

  const purchaseCtx = conv.purchase_status === 'pagado' || conv.paid_at
    ? '\nESTADO: YA PAGÓ — foco onboarding/agendamiento, NO ventas.'
    : conv.assigned_psychologist_name
      ? `\nESTADO: psicóloga asignada (${conv.assigned_psychologist_name}) pero aún no ha pagado.`
      : '';

  const userContent = `# Lead actual: ${conv.lead_name ?? '(sin nombre)'} · ${conv.phone}${purchaseCtx}\n${insightBlock}\n\nUltimo mensaje del lead: "${lastLeadMsg}"\n\n# Historial reciente\n${recentHistory}\n\n${ctxBlock}${templatesBlock}\n\nDame el PLAN estratégico para el agente con la plantilla concreta. NO escribas el mensaje, solo el enfoque + el nombre de plantilla.`;
  return streamAnthropic(MODEL_FAST, 1400, system, userContent);
}

async function summarizeConversation(id: string): Promise<Response> {
  const { data: conv } = await sb.from('conversations_mentesana').select('phone, lead_name, created_at').eq('id', id).single();
  if (!conv) return json({ error: 'not_found' }, 404);
  const { data: msgs } = await sb.from('messages_mentesana').select('sender, content, timestamp, is_template, template_name').eq('conversation_id', id).order('timestamp', { ascending: true }).limit(300);
  const total = (msgs ?? []).length;
  if (total < 4) return json({ error: 'too_short' }, 400);
  const formatted = (msgs ?? []).map((m: any, i: number) => { const who = m.sender === conv.phone ? 'LEAD' : m.sender === 'psicologo' ? 'PSIC' : 'AGENTE'; let c = (m.content ?? '').slice(0, 400); if (m.is_template) c = `[TEMPLATE ${m.template_name ?? ''}] ${c}`; return `${i + 1}. ${who}: ${c}`; }).join('\n');
  const system = `Resume conversacion. Markdown:\n- **Estado:** 1 frase\n- **Ya ofrecido:** bullets\n- **Rechazado:** bullets\n- **Interesa:** bullets\n- **Próxima acción recomendada:** 1-2 frases describiendo el enfoque (NO redactes el mensaje, solo el plan)`;
  return streamAnthropic(MODEL_FAST, 1024, system, `Conv con ${conv.lead_name ?? 'lead'} (${total} msgs):\n\n${formatted}`);
}

async function brain(url: URL) {
  const { data: anchors, error: aErr } = await sb.rpc('brain_anchors');
  if (aErr) return json({ error: 'brain_anchors: ' + aErr.message }, 500);
  const missing = (anchors ?? []).filter((a: any) => !a.has_embedding);
  if (missing.length > 0) {
    const { data: rows } = await sb.from('concept_anchors').select('id, prompt, position_index').in('id', missing.map((m: any) => m.id)).order('position_index');
    if (rows && rows.length > 0) {
      const prompts = rows.map((r: any) => r.prompt);
      const embeddings = await callVoyageBatch(prompts);
      for (let i = 0; i < rows.length; i++) { const vec = `[${embeddings[i].join(',')}]`; const { error: upErr } = await sb.from('concept_anchors').update({ embedding: vec as any }).eq('id', rows[i].id); if (upErr) return json({ error: 'anchor_update: ' + upErr.message }, 500); }
    }
  }
  const sampleSize = url.searchParams.get('sample');
  const { data: points, error: bErr } = await sb.rpc('brain_map', { sample_size: sampleSize ? Number(sampleSize) : null });
  if (bErr) return json({ error: 'brain_map: ' + bErr.message }, 500);
  const { data: anchorsOut } = await sb.rpc('brain_anchors');
  return json({ anchors: (anchorsOut ?? []).map(({ id, slug, label, position_index, color }: any) => ({ id, slug, label, position_index, color })), points: points ?? [], count: (points ?? []).length });
}

async function metaSendText(num: WaNumber, toPhone: string, text: string): Promise<{ wamid: string }> {
  const url = `${WHATSAPP_API}/${num.phone_number_id}/messages`;
  const res = await fetch(url, { method: 'POST', headers: { 'Authorization': `Bearer ${num.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', to: toPhone, type: 'text', text: { body: text } }) });
  if (!res.ok) throw new Error(`Meta ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const j = await res.json();
  return { wamid: j.messages?.[0]?.id ?? '' };
}
// Caché en memoria de categoría por template (name+lang). Se llena con el primer fetch
// al WABA y se reutiliza durante la vida de la función (Deno edge — proceso reutilizable).
// TTL implícito: vive lo que vive el proceso. Se refresca cuando el cache se queda corto.
const TEMPLATE_CATEGORY_CACHE: Map<string, string> = new Map();
function tplCacheKey(wabaId: string, name: string, lang: string) { return `${wabaId}:${name}:${lang}`; }

async function fetchTemplateCategory(num: WaNumber, name: string, lang: string): Promise<string | null> {
  const wabaId = num.business_account_id;
  if (!wabaId) return null;
  const key = tplCacheKey(wabaId, name, lang);
  const cached = TEMPLATE_CATEGORY_CACHE.get(key);
  if (cached) return cached;
  // Pull todas y rellenar caché en bulk (más eficiente que pedir 1 a 1)
  try {
    const params = new URLSearchParams({ fields: 'name,language,status,category', limit: '200' });
    const r = await fetch(`${WHATSAPP_API}/${wabaId}/message_templates?${params}`, { headers: { 'Authorization': `Bearer ${num.access_token}` } });
    if (!r.ok) return null;
    const j = await r.json();
    for (const t of (j.data ?? [])) {
      TEMPLATE_CATEGORY_CACHE.set(tplCacheKey(wabaId, t.name, t.language), t.category);
    }
    return TEMPLATE_CATEGORY_CACHE.get(key) ?? null;
  } catch { return null; }
}

async function metaSendTemplate(num: WaNumber, toPhone: string, templateName: string, lang: string, components: any[]): Promise<{ wamid: string }> {
  // ROUTING MM Lite: si el template es categoría MARKETING, enviamos por
  // /{phone-id}/marketing_messages (endpoint MM Lite). Cualquier otra categoría
  // (UTILITY, AUTHENTICATION) usa el endpoint clásico /messages.
  // El número debe estar onboardeado a MM Lite. Actualmente: solo
  // REDACTED_ID (Mente Sana Soporte, +34 XXX XXX XXX,
  // WABA REDACTED_ID). Los anteriores REDACTED_ID y
  // REDACTED_ID (WABA REDACTED_ID) están BANNED desde 2026-05-29.
  const category = await fetchTemplateCategory(num, templateName, lang);
  const isMarketing = (category ?? '').toUpperCase() === 'MARKETING';
  const path = isMarketing ? 'marketing_messages' : 'messages';
  const url = `${WHATSAPP_API}/${num.phone_number_id}/${path}`;
  const body: any = { messaging_product: 'whatsapp', to: toPhone, type: 'template', template: { name: templateName, language: { code: lang } } };
  if (components && components.length > 0) body.template.components = components;
  const res = await fetch(url, { method: 'POST', headers: { 'Authorization': `Bearer ${num.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Meta ${res.status} (${isMarketing ? 'MM_LITE' : 'CLOUD'}): ${(await res.text()).slice(0, 500)}`);
  const j = await res.json();
  return { wamid: j.messages?.[0]?.id ?? '' };
}

async function pickNumberFor(convId: string, override?: string | null): Promise<WaNumber> {
  if (override) {
    const numbers = await loadWaNumbers();
    const m = numbers.find((n) => n.phone_number_id === override || n.wa_number_id === override);
    if (m) return m;
  }
  const n = await getNumberForConversation(convId);
  if (!n) throw new Error('no_whatsapp_number_configured');
  return n;
}

async function markConvAsReadAfterAgentReply(convId: string, lastMessage: string, nowIso: string) {
  await sb.from('conversations_mentesana').update({ last_message: lastMessage.slice(0, 500), last_message_time: nowIso, updated_at: nowIso, unread_count: 0 }).eq('id', convId);
  await sb.from('messages_mentesana').update({ read: true }).eq('conversation_id', convId).eq('read', false);
}

async function sendText(id: string, req: Request): Promise<Response> {
  let body: any = {}; try { body = await req.json(); } catch { }
  const text = (body.text ?? '').toString().trim();
  const agentId = body.agent_id ?? null;
  const agentName = body.agent_name ?? 'agente';
  const fromOverride = body.from_number ?? null;
  if (!text) return json({ error: 'text required' }, 400);
  const { data: conv, error: convErr } = await sb.from('conversations_mentesana').select('id, phone, lead_name').eq('id', id).single();
  if (convErr || !conv) return json({ error: convErr?.message ?? 'not_found' }, 404);
  let num: WaNumber;
  try { num = await pickNumberFor(id, fromOverride); } catch (e: any) { return json({ error: 'no_number', detail: e?.message ?? String(e) }, 500); }
  let wamid = '';
  let sendError: string | null = null;
  try { const out = await metaSendText(num, conv.phone, text); wamid = out.wamid; }
  catch (e: any) { sendError = e?.message ?? String(e); }
  const nowIso = new Date().toISOString();
  if (sendError) {
    const failedId = `local_failed_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await sb.from('messages_mentesana').insert({ id: failedId, conversation_id: id, phone: conv.phone, sender: agentId ?? 'agent', sender_name: agentName, content: text, type: 'text', is_template: false, template_name: null, timestamp: nowIso, created_at: nowIso, status: 'failed', error_reason: sendError.slice(0, 1000), read: true, sent_by_agent_id: agentId || null, agent_name: agentName });
    await sb.from('conversations_mentesana').update({ last_message: '⚠️ envío fallido', last_message_time: nowIso, updated_at: nowIso }).eq('id', id);
    return json({ error: 'meta_send_failed', detail: sendError, used_number: { name: num.name, phone_number_id: num.phone_number_id } }, 502);
  }
  const msgId = wamid || `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const { error: insErr } = await sb.from('messages_mentesana').insert({ id: msgId, conversation_id: id, phone: conv.phone, sender: agentId ?? 'agent', sender_name: agentName, content: text, type: 'text', is_template: false, template_name: null, timestamp: nowIso, created_at: nowIso, status: 'sent', message_id: wamid || null, read: true, sent_by_agent_id: agentId || null, agent_name: agentName });
  if (insErr) return json({ error: 'db_insert: ' + insErr.message, wamid }, 500);
  await markConvAsReadAfterAgentReply(id, text, nowIso);
  return json({ ok: true, message_id: msgId, wamid, sent_at: nowIso, sent_from: { name: num.name, phone_number_id: num.phone_number_id } });
}

async function sendTemplate(id: string, req: Request): Promise<Response> {
  let body: any = {}; try { body = await req.json(); } catch { }
  const templateName = (body.template_name ?? '').toString().trim();
  const lang = (body.language ?? 'es').toString();
  const components = Array.isArray(body.components) ? body.components : [];
  const agentId = body.agent_id ?? null;
  const agentName = body.agent_name ?? 'agente';
  const fromOverride = body.from_number ?? null;
  if (!templateName) return json({ error: 'template_name required' }, 400);
  const { data: conv, error: convErr } = await sb.from('conversations_mentesana').select('id, phone, lead_name').eq('id', id).single();
  if (convErr || !conv) return json({ error: convErr?.message ?? 'not_found' }, 404);
  let num: WaNumber;
  try { num = await pickNumberFor(id, fromOverride); } catch (e: any) { return json({ error: 'no_number', detail: e?.message ?? String(e) }, 500); }
  let wamid = '';
  let sendError: string | null = null;
  try { const out = await metaSendTemplate(num, conv.phone, templateName, lang, components); wamid = out.wamid; }
  catch (e: any) { sendError = e?.message ?? String(e); }
  const nowIso = new Date().toISOString();
  const preview = `[Template ${templateName}]`;
  if (sendError) {
    const failedId = `local_failed_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await sb.from('messages_mentesana').insert({ id: failedId, conversation_id: id, phone: conv.phone, sender: agentId ?? 'agent', sender_name: agentName, content: preview, type: 'template', is_template: true, template_name: templateName, timestamp: nowIso, created_at: nowIso, status: 'failed', error_reason: sendError.slice(0, 1000), read: true, sent_by_agent_id: agentId || null, agent_name: agentName });
    await sb.from('conversations_mentesana').update({ last_message: `⚠️ plantilla ${templateName} falló`, last_message_time: nowIso, updated_at: nowIso }).eq('id', id);
    return json({ error: 'meta_send_failed', detail: sendError, used_number: { name: num.name, phone_number_id: num.phone_number_id } }, 502);
  }
  const msgId = wamid || `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const { error: insErr } = await sb.from('messages_mentesana').insert({ id: msgId, conversation_id: id, phone: conv.phone, sender: agentId ?? 'agent', sender_name: agentName, content: preview, type: 'template', is_template: true, template_name: templateName, timestamp: nowIso, created_at: nowIso, status: 'sent', message_id: wamid || null, read: true, sent_by_agent_id: agentId || null, agent_name: agentName });
  if (insErr) return json({ error: 'db_insert: ' + insErr.message, wamid }, 500);
  await markConvAsReadAfterAgentReply(id, preview, nowIso);
  return json({ ok: true, message_id: msgId, wamid, sent_at: nowIso, sent_from: { name: num.name, phone_number_id: num.phone_number_id } });
}

async function patchConversation(id: string, req: Request): Promise<Response> {
  let body: any = {}; try { body = await req.json(); } catch { }
  const allowed = ['status', 'assigned_to', 'assigned_psychologist', 'assigned_psychologist_name', 'pipeline_type', 'notes', 'priority', 'client_type', 'lead_name', 'email'];
  const patch: any = {};
  for (const k of allowed) if (k in body) patch[k] = body[k];
  if (Object.keys(patch).length === 0) return json({ error: 'no_fields' }, 400);
  patch.updated_at = new Date().toISOString();
  const { data, error } = await sb.from('conversations_mentesana').update(patch).eq('id', id).select('*').single();
  if (error) return json({ error: error.message }, 500);
  const mirror: any = { updated_at: patch.updated_at };
  for (const k of ['status', 'assigned_to', 'assigned_psychologist', 'notes', 'lead_name', 'email', 'priority']) if (k in patch) mirror[k] = patch[k];
  if (Object.keys(mirror).length > 1) {
    const { data: conv } = await sb.from('conversations_mentesana').select('phone').eq('id', id).single();
    if (conv?.phone) await sb.from('contacts_mentesana').update(mirror).eq('phone', conv.phone);
  }
  return json({ ok: true, conversation: data });
}

async function markRead(id: string): Promise<Response> {
  const nowIso = new Date().toISOString();
  const { error } = await sb.from('conversations_mentesana').update({ unread_count: 0, updated_at: nowIso }).eq('id', id);
  if (error) return json({ error: error.message }, 500);
  await sb.from('messages_mentesana').update({ read: true }).eq('conversation_id', id).eq('read', false);
  return json({ ok: true });
}

async function patchContact(phone: string, req: Request): Promise<Response> {
  let body: any = {}; try { body = await req.json(); } catch { }
  const allowed = ['lead_name', 'email', 'status', 'source', 'client_type', 'priority', 'notes', 'utm_source', 'utm_campaign', 'ipc_type', 'assigned_to', 'assigned_psychologist'];
  const patch: any = {};
  for (const k of allowed) if (k in body) patch[k] = body[k];
  if (Object.keys(patch).length === 0) return json({ error: 'no_fields' }, 400);
  patch.updated_at = new Date().toISOString();
  const { data, error } = await sb.from('contacts_mentesana').update(patch).eq('phone', phone).select('*').maybeSingle();
  if (error) return json({ error: error.message }, 500);
  const convMirror: any = { updated_at: patch.updated_at };
  for (const k of ['lead_name', 'email', 'status', 'assigned_to', 'assigned_psychologist', 'notes', 'priority']) if (k in patch) convMirror[k] = patch[k];
  if (Object.keys(convMirror).length > 1) await sb.from('conversations_mentesana').update(convMirror).eq('phone', phone);
  return json({ ok: true, contact: data });
}

async function getLeadProfile(id: string): Promise<Response> {
  const { data: conv } = await sb.from('conversations_mentesana').select('id, phone, lead_name, email, status, assigned_to, assigned_psychologist, assigned_psychologist_name, source, pipeline_type, purchase_status, purchase_amount, paid_at, notes, created_at, last_message_time, priority, client_type').eq('id', id).single();
  if (!conv) return json({ error: 'not_found' }, 404);
  const phone = conv.phone;
  const [contactRes, paymentsRes, tagsRes, msgsCountRes, numberAssigned, routing] = await Promise.all([
    sb.from('contacts_mentesana').select('phone, lead_name, email, status, source, test_score, test_results, payment_amount, utm_source, utm_medium, utm_campaign, ipc_type, issue_type, priority, client_type, extra_data, created_at, updated_at, notes').eq('phone', phone).maybeSingle(),
    sb.from('payments').select('id, amount_cents, currency, status, psychologist, source, stripe_session_id, created_at, metadata').or(`patient_phone.eq.${phone},patient_phone.eq.+${phone}`).order('created_at', { ascending: false }).limit(20),
    sb.from('contact_tags_mentesana').select('tag_id, created_at, tags_mentesana ( id, name, color )').eq('phone', phone),
    sb.from('messages_mentesana').select('id', { count: 'exact', head: true }).eq('conversation_id', id),
    getNumberForConversation(id),
    sb.from('conversation_routing').select('agent_type').eq('conversation_id', id).maybeSingle(),
  ]);
  return json({ conversation: conv, contact: contactRes.data, payments: paymentsRes.data ?? [], tags: (tagsRes.data ?? []).map((t: any) => t.tags_mentesana).filter(Boolean), total_messages: msgsCountRes.count ?? 0, assigned_wa_number: numberAssigned ? { name: numberAssigned.name, phone_number_id: numberAssigned.phone_number_id, phone_number: numberAssigned.phone_number } : null, agent_type: (routing.data as any)?.agent_type ?? 'humano' });
}

async function listAgents(): Promise<Response> {
  const { data, error } = await sb.from('agents_mentesana').select('id, email, name, role, agent_type, support_category, total_templates_sent').order('name');
  if (error) return json({ error: error.message }, 500);
  return json({ agents: data ?? [] });
}
async function listPsychologists(): Promise<Response> {
  const { data, error } = await sb.from('psychologists_mentesana').select('id, name, email, specialty, years_experience, max_patients, current_patients, is_accepting_patients, status').eq('status', 'active').order('name');
  if (error) return json({ error: error.message }, 500);
  return json({ psychologists: data ?? [] });
}
async function listAllTags(): Promise<Response> {
  const { data, error } = await sb.from('tags_mentesana').select('id, name, color, description').order('name');
  if (error) return json({ error: error.message }, 500);
  return json({ tags: data ?? [] });
}
async function listTemplates(): Promise<Response> {
  const { data, error } = await sb.from('messages_mentesana').select('template_name').eq('is_template', true).not('template_name', 'is', null).limit(2000);
  if (error) return json({ error: error.message }, 500);
  const counts: Record<string, number> = {};
  for (const r of data ?? []) { const n = (r as any).template_name; if (n) counts[n] = (counts[n] ?? 0) + 1; }
  const templates = Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  return json({ templates });
}
async function listWaNumbers(): Promise<Response> {
  const numbers = await loadWaNumbers(true);
  return json({ numbers: numbers.map((n) => ({ phone_number_id: n.phone_number_id, name: n.name, phone_number: n.phone_number, is_default: n.is_default, status: n.status, is_pdf_number: n.is_pdf_number, business_account_id: n.business_account_id })) });
}
async function listQuickReplies(): Promise<Response> {
  const { data, error } = await sb.from('quick_replies_v2').select('id, title, content, category, shortcut, is_active, usage_count, updated_at').eq('is_active', true).order('usage_count', { ascending: false });
  if (error) return json({ error: error.message }, 500);
  return json({ quick_replies: data ?? [] });
}

let _wabaCache: Map<string, { ts: number; templates: any[] }> = new Map();
async function fetchTemplatesForWaba(wabaId: string, accessToken: string): Promise<any[]> {
  const TTL = 10 * 60_000;
  const cached = _wabaCache.get(wabaId);
  if (cached && Date.now() - cached.ts < TTL) return cached.templates;
  const all: any[] = [];
  let after: string | undefined = undefined;
  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams({ fields: 'name,language,status,category,components', limit: '200' });
    if (after) params.set('after', after);
    const url = `${WHATSAPP_API}/${wabaId}/message_templates?${params}`;
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
    if (!res.ok) { throw new Error(`Meta templates ${res.status} (WABA ${wabaId}): ${(await res.text()).slice(0, 300)}`); }
    const j = await res.json();
    for (const t of j.data ?? []) all.push({ ...t, waba_id: wabaId });
    after = j.paging?.cursors?.after;
    if (!after) break;
  }
  _wabaCache.set(wabaId, { ts: Date.now(), templates: all });
  return all;
}

async function listMetaTemplates(url: URL): Promise<Response> {
  const onlyPhoneNumberId = url.searchParams.get('phone_number_id');
  const numbers = await loadWaNumbers();
  let activeNumbers = numbers.filter((n) => n.access_token && n.business_account_id);
  if (onlyPhoneNumberId) activeNumbers = activeNumbers.filter((n) => n.phone_number_id === onlyPhoneNumberId);
  const wabaTokens = new Map<string, { token: string; numbers: WaNumber[] }>();
  for (const n of activeNumbers) {
    const w = n.business_account_id!;
    if (!wabaTokens.has(w)) wabaTokens.set(w, { token: n.access_token, numbers: [] });
    wabaTokens.get(w)!.numbers.push(n);
  }
  const wabaResults = await Promise.allSettled(
    Array.from(wabaTokens.entries()).map(async ([wabaId, info]) => ({ wabaId, info, templates: await fetchTemplatesForWaba(wabaId, info.token) })),
  );
  const merged = new Map<string, any>();
  const errors: any[] = [];
  for (const r of wabaResults) {
    if (r.status === 'rejected') { errors.push(String(r.reason)); continue; }
    const { info, templates } = r.value;
    for (const t of templates) {
      const key = `${t.name}__${t.language}`;
      if (!merged.has(key)) merged.set(key, { ...t, available_from: [] as { phone_number_id: string; name: string }[] });
      const entry = merged.get(key)!;
      for (const num of info.numbers) {
        if (!entry.available_from.find((x: any) => x.phone_number_id === num.phone_number_id)) {
          entry.available_from.push({ phone_number_id: num.phone_number_id, name: num.name });
        }
      }
    }
  }
  const { data: usageRows } = await sb.from('messages_mentesana').select('template_name').eq('is_template', true).not('template_name', 'is', null).limit(5000);
  const usage: Record<string, number> = {};
  for (const r of usageRows ?? []) { const n = (r as any).template_name; if (n) usage[n] = (usage[n] ?? 0) + 1; }
  const out = Array.from(merged.values()).map((t) => ({ ...t, usage_count: usage[t.name] ?? 0 })).sort((a, b) => (b.usage_count - a.usage_count) || a.name.localeCompare(b.name));
  return json({ templates: out, errors });
}

async function attachTag(id: string, req: Request): Promise<Response> {
  let body: any = {}; try { body = await req.json(); } catch { }
  const tagId = body.tag_id;
  if (!tagId) return json({ error: 'tag_id required' }, 400);
  const { data: conv } = await sb.from('conversations_mentesana').select('phone').eq('id', id).single();
  if (!conv?.phone) return json({ error: 'conv_not_found' }, 404);
  const { error } = await sb.from('contact_tags_mentesana').upsert({ phone: conv.phone, tag_id: tagId, created_at: new Date().toISOString() }, { onConflict: 'phone,tag_id' });
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
}
async function detachTag(id: string, tagId: string): Promise<Response> {
  const { data: conv } = await sb.from('conversations_mentesana').select('phone').eq('id', id).single();
  if (!conv?.phone) return json({ error: 'conv_not_found' }, 404);
  const { error } = await sb.from('contact_tags_mentesana').delete().eq('phone', conv.phone).eq('tag_id', tagId);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
}

async function pollMessages(id: string, sinceIso: string | null): Promise<Response> {
  let q = sb.from('messages_mentesana').select('id, sender, sender_name, content, type, is_template, template_name, timestamp, status, media_url, media_type, media_caption, media_mime_type, media_filename, created_at').eq('conversation_id', id).order('timestamp', { ascending: true }).limit(200);
  if (sinceIso) q = q.gt('timestamp', sinceIso);
  const { data, error } = await q;
  if (error) return json({ error: error.message }, 500);
  const { data: conv } = await sb.from('conversations_mentesana').select('phone, status, last_message_time, unread_count').eq('id', id).single();
  const phone = conv?.phone;
  const messages = (data ?? []).map((m: any) => ({ ...m, is_lead: m.sender === phone, is_agent: m.sender !== phone && m.sender !== 'psicologo' && !/^\d+$/.test(m.sender ?? ''), is_psychologist: m.sender === 'psicologo' }));
  return json({ messages, conversation: conv });
}

async function broadcast(req: Request, type: 'text' | 'template'): Promise<Response> {
  let body: any = {}; try { body = await req.json(); } catch { }
  const recipientsRaw: any[] = Array.isArray(body.recipients) ? body.recipients : Array.isArray(body.phones) ? body.phones.map((p: any) => ({ phone: String(p).trim() })) : [];
  if (recipientsRaw.length === 0) return json({ error: 'recipients[] or phones[] required' }, 400);
  if (recipientsRaw.length > 500) return json({ error: 'max 500 destinatarios por batch' }, 400);
  const recipients = recipientsRaw.map((r: any) => ({ phone: String(r.phone ?? '').trim(), components: Array.isArray(r.components) ? r.components : undefined })).filter((r) => r.phone);
  const fromOverride = body.from_number ?? null;
  const numbers = await loadWaNumbers();
  const num = numbers.find((n) => n.phone_number_id === fromOverride || n.wa_number_id === fromOverride) ?? numbers.find((n) => n.is_default) ?? numbers[0];
  if (!num) return json({ error: 'no_whatsapp_number_configured' }, 500);
  let text = ''; let templateName = ''; let lang = 'es'; let sharedComponents: any[] = [];
  if (type === 'text') { text = (body.text ?? '').toString().trim(); if (!text) return json({ error: 'text required' }, 400); }
  else { templateName = (body.template_name ?? '').toString().trim(); lang = (body.language ?? 'es').toString(); sharedComponents = Array.isArray(body.components) ? body.components : []; if (!templateName) return json({ error: 'template_name required' }, 400); }
  const agentId = body.agent_id ?? null;
  const agentName = body.agent_name ?? 'agente';
  const results: { phone: string; ok: boolean; wamid?: string; error?: string; conversation_id?: string }[] = [];
  const concurrency = 5; const delayMs = 350;
  let idx = 0;
  async function worker() {
    while (idx < recipients.length) {
      const i = idx++; const r = recipients[i]; const phone = r.phone;
      const components = r.components ?? sharedComponents;
      try {
        const out = type === 'text' ? await metaSendText(num, phone, text) : await metaSendTemplate(num, phone, templateName, lang, components);
        const wamid = out.wamid;
        const { data: existing } = await sb.from('conversations_mentesana').select('id').eq('phone', phone).limit(1).maybeSingle();
        const convId = existing?.id ?? null;
        if (convId) {
          const nowIso = new Date().toISOString();
          const msgId = wamid || `local_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`;
          const content = type === 'text' ? text : `[Template ${templateName}]`;
          await sb.from('messages_mentesana').insert({ id: msgId, conversation_id: convId, phone, sender: agentId ?? 'agent', sender_name: agentName, content, type, is_template: type === 'template', template_name: type === 'template' ? templateName : null, timestamp: nowIso, created_at: nowIso, status: 'sent', message_id: wamid || null, read: true, sent_by_agent_id: agentId || null, agent_name: agentName });
          await markConvAsReadAfterAgentReply(convId, content, nowIso);
        }
        results.push({ phone, ok: true, wamid, conversation_id: convId ?? undefined });
      } catch (e: any) { results.push({ phone, ok: false, error: (e?.message ?? String(e)).slice(0, 200) }); }
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const ok = results.filter((r) => r.ok).length;
  return json({ ok: true, sent_from: { name: num.name, phone_number_id: num.phone_number_id }, total: recipients.length, success: ok, failed: recipients.length - ok, results });
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  let path = url.pathname.replace(/^\/inbox-v2-server/, '') || '/';
  if (path.endsWith('/') && path !== '/') path = path.slice(0, -1);
  const method = req.method;
  if (method === 'OPTIONS') return new Response(null, { headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS', 'access-control-allow-headers': 'authorization, content-type, x-inbox-secret' } });
  try {
    if (method === 'GET' && path === '/') { const nums = await loadWaNumbers().catch(() => []); return json({ ok: true, service: 'inbox-v2-server', version: 'v18', mm_lite_routing: true, wa_numbers: nums.length, wa_default: nums.find((n) => n.is_default)?.name ?? null, models: { fast: MODEL_FAST, rich: MODEL_RICH, embed: EMBED_MODEL } }); }
    const auth = checkSecret(req); if (auth) return auth;
    if (method === 'GET' && path === '/brain') return await brain(url);
    if (method === 'GET' && path === '/agents') return await listAgents();
    if (method === 'GET' && path === '/psychologists') return await listPsychologists();
    if (method === 'GET' && path === '/templates') return await listTemplates();
    if (method === 'GET' && path === '/meta-templates') return await listMetaTemplates(url);
    if (method === 'GET' && path === '/tags') return await listAllTags();
    if (method === 'GET' && path === '/whatsapp-numbers') return await listWaNumbers();
    if (method === 'GET' && path === '/quick-replies') return await listQuickReplies();
    if (method === 'GET' && path === '/conversations') return await listConversations(url);
    if (method === 'GET' && path === '/contacts') return await listContacts(url);
    if (method === 'POST' && path === '/broadcast/text') return await broadcast(req, 'text');
    if (method === 'POST' && path === '/broadcast/template') return await broadcast(req, 'template');
    const convDetailMatch = path.match(/^\/conversations\/([^/]+)$/);
    if (convDetailMatch) {
      if (method === 'GET') { const includeMessages = url.searchParams.get('messages') !== 'false'; return await getConversation(convDetailMatch[1], includeMessages); }
      if (method === 'PATCH') return await patchConversation(convDetailMatch[1], req);
    }
    const contactPatchMatch = path.match(/^\/contacts\/([^/]+)$/);
    if (method === 'PATCH' && contactPatchMatch) return await patchContact(decodeURIComponent(contactPatchMatch[1]), req);
    const riskMatch = path.match(/^\/conversations\/([^/]+)\/risk-flags$/);
    if (method === 'GET' && riskMatch) return await getRiskFlags(riskMatch[1]);
    const summarizeMatch = path.match(/^\/conversations\/([^/]+)\/summary$/);
    if (method === 'POST' && summarizeMatch) return await summarizeConversation(summarizeMatch[1]);
    const replyMatch = path.match(/^\/conversations\/([^/]+)\/suggested-reply$/);
    if (method === 'POST' && replyMatch) return await suggestReply(replyMatch[1]);
    const sendTextMatch = path.match(/^\/conversations\/([^/]+)\/send-text$/);
    if (method === 'POST' && sendTextMatch) return await sendText(sendTextMatch[1], req);
    const sendTplMatch = path.match(/^\/conversations\/([^/]+)\/send-template$/);
    if (method === 'POST' && sendTplMatch) return await sendTemplate(sendTplMatch[1], req);
    const markReadMatch = path.match(/^\/conversations\/([^/]+)\/mark-read$/);
    if (method === 'POST' && markReadMatch) return await markRead(markReadMatch[1]);
    const profileMatch = path.match(/^\/conversations\/([^/]+)\/lead-profile$/);
    if (method === 'GET' && profileMatch) return await getLeadProfile(profileMatch[1]);
    const tagsConvMatch = path.match(/^\/conversations\/([^/]+)\/tags$/);
    if (method === 'POST' && tagsConvMatch) return await attachTag(tagsConvMatch[1], req);
    const tagsConvDelMatch = path.match(/^\/conversations\/([^/]+)\/tags\/([^/]+)$/);
    if (method === 'DELETE' && tagsConvDelMatch) return await detachTag(tagsConvDelMatch[1], tagsConvDelMatch[2]);
    const pollMatch = path.match(/^\/conversations\/([^/]+)\/poll$/);
    if (method === 'GET' && pollMatch) { const sinceIso = url.searchParams.get('since'); return await pollMessages(pollMatch[1], sinceIso); }
    if (method === 'GET' && path === '/search') {
      const q = url.searchParams.get('q') ?? ''; const topK = Number(url.searchParams.get('topK') ?? 20);
      const paidParam = url.searchParams.get('paid'); const filterPaid = paidParam === 'true' ? true : paidParam === 'false' ? false : null;
      return await searchSemantic(q, topK, filterPaid);
    }
    return json({ error: 'not_found', method, path }, 404);
  } catch (e: any) { return json({ ok: false, error: e?.message ?? String(e) }, 500); }
});
