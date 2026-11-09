-- Webhooks de Meta (WhatsApp) no-mensaje, reenviados por el monolito a /api/whatsapp/meta-events.
-- Proyecto principal. Solo service role: RLS activado y sin políticas.

-- Salud actual de cada plantilla (una fila por WABA + nombre + idioma).
create table if not exists public.wa_template_health (
  waba_id text not null,
  template_name text not null,
  language text not null default '',
  template_id text,
  quality text,            -- GREEN | YELLOW | RED | UNKNOWN
  status text,             -- APPROVED | PAUSED | DISABLED | FLAGGED | REJECTED | ...
  category text,           -- MARKETING | UTILITY | AUTHENTICATION
  last_event text,
  last_reason text,
  last_alert_key text,     -- último aviso al CTO (dedupe 24 h)
  last_alert_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (waba_id, template_name, language)
);
create index if not exists wa_template_health_name_idx on public.wa_template_health (template_name);
alter table public.wa_template_health enable row level security;

-- Log crudo de eventos de plantillas (event_key = sha256 del change: idempotente ante reintentos).
create table if not exists public.wa_template_events (
  id bigserial primary key,
  event_key text not null unique,
  waba_id text,
  field text not null,
  template_name text,
  language text,
  payload jsonb not null,
  received_at timestamptz not null default now()
);
create index if not exists wa_template_events_name_idx on public.wa_template_events (template_name, received_at desc);
alter table public.wa_template_events enable row level security;

-- Log de user_preferences (baja/alta de marketing desde WhatsApp). pref_key = teléfono en dígitos o BSUID.
create table if not exists public.wa_pref_events (
  id bigserial primary key,
  event_key text not null unique,
  waba_id text,
  phone_number_id text,
  pref_key text not null,
  wa_id text,
  user_id text,
  action text not null,    -- stop | resume
  category text,
  event_ts timestamptz,
  applied boolean not null default true,
  payload jsonb,
  received_at timestamptz not null default now()
);
create index if not exists wa_pref_events_key_idx on public.wa_pref_events (pref_key, event_ts desc);
alter table public.wa_pref_events enable row level security;
