-- Phase 2 – Erinnerungen (ANFORDERUNGEN 3.11, 6, 10.2): Push-Abos, Telegram-Verknüpfung, Outbox, Joblauf,
-- members.reminder_lead_days. Push-Endpoints und Telegram-Chat-IDs sind personenbezogen (Abschnitt 9): kein Lesen
-- über Supabase, nur über die Server-Funktionen (keine Grants, RLS ohne Policy).

-- Vorlauf für Fristerinnerungen (Auswahl 1, 3 oder 7 Tage; einstellbar ab P6)
alter table public.members
  add column reminder_lead_days integer not null default 3 check (reminder_lead_days in (1, 3, 7));

-- ── Web-Push (6.3): ein Abo je Gerät ─────────────────────────────────────────
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete restrict,
  endpoint text not null unique check (length(endpoint) > 0),
  -- Schlüssel des Browsers für die Verschlüsselung der Nachricht (Web Push)
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index push_subscriptions_member on public.push_subscriptions (member_id);

-- ── Telegram (6.4): ein Chat je Mitglied, Verknüpfung per Einmal-Code ───────
create table public.telegram_links (
  member_id uuid primary key references public.members (id) on delete restrict,
  chat_id text not null unique,
  linked_at timestamptz not null default now()
);

create table public.telegram_link_codes (
  code text primary key check (length(code) >= 8),
  member_id uuid not null references public.members (id) on delete restrict,
  expires_at timestamptz not null,
  used_at timestamptz
);
create index telegram_link_codes_member on public.telegram_link_codes (member_id);

-- ── Outbox (6.1): alles läuft hierüber; dedupe_key verhindert Doppelversand ──
create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  member_id uuid not null references public.members (id) on delete restrict,
  event_type text not null check (event_type in (
    'zuweisung', 'kommentar', 'frist_naht', 'frist_heute', 'frist_ueberschritten', 'status', 'blockade_aufgehoben',
    'termin_einladung', 'termin_erinnerung', 'termin_geaendert', 'plenum_zusammenfassung', 'zuweisung_abgelehnt'
  )),
  channel text not null check (channel in ('push', 'telegram')),
  text text not null check (length(text) > 0),
  link text not null check (length(link) > 0),
  status text not null default 'wartet' check (status in ('wartet', 'gesendet', 'fehlgeschlagen')),
  attempts integer not null default 0 check (attempts between 0 and 3),
  last_error text,
  -- ein Joblauf beansprucht die Nachricht, bevor er sie verschickt – ein gleichzeitiger Lauf lässt sie aus
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index notification_outbox_waiting on public.notification_outbox (created_at) where status = 'wartet';
create index notification_outbox_member on public.notification_outbox (member_id, created_at);

-- ── Joblauf (E-07): Laufprotokoll für die Statusanzeige ──────────────────────
create table public.job_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null,
  finished_at timestamptz,
  result text not null check (result in ('ok', 'fehler')),
  summary text not null,
  error text,
  sent_push integer not null default 0,
  sent_telegram integer not null default 0,
  retries integer not null default 0
);
create index job_runs_started on public.job_runs (started_at desc);

-- „Rückgängig“ zieht noch wartende Nachrichten der Aktion zurück
alter table public.undo_actions add column outbox_ids jsonb not null default '[]'::jsonb;

alter table public.push_subscriptions enable row level security;
alter table public.telegram_links enable row level security;
alter table public.telegram_link_codes enable row level security;
alter table public.notification_outbox enable row level security;
alter table public.job_runs enable row level security;
