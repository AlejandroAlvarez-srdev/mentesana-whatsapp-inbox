-- Proyecto BLOG (donde viven conversations_mentesana / messages_mentesana).
-- Log de cada "✨ Borrador IA" generado en inbox-v2 (src/lib/inbox-agent, /api/agent/inbox-draft).
-- Aditiva: solo crea tabla e índices. El código funciona aunque esta migración no esté aplicada
-- (el insert es best-effort). Solo service role: RLS activado y sin políticas.
create table if not exists public.inbox_ai_drafts (
  id uuid primary key default gen_random_uuid(),
  conversation_id text not null,
  agent_id text,
  agent_email text,
  intent text not null,
  confidence numeric,
  draft_reply text,
  suggested_actions jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  supervisor_source text,
  model text,
  parsed_ok boolean,
  latency_ms integer,
  -- Feedback futuro: qué hizo el agente con el borrador (enviado tal cual / editado / descartado).
  outcome text,
  created_at timestamptz not null default now()
);

create index if not exists inbox_ai_drafts_conv_idx on public.inbox_ai_drafts (conversation_id, created_at desc);
create index if not exists inbox_ai_drafts_intent_idx on public.inbox_ai_drafts (intent, created_at desc);

alter table public.inbox_ai_drafts enable row level security;
