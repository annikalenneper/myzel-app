-- Verbesserungen (Nutzerin, 31.10.2026): Glocke – Benachrichtigungseinträge in der App für alle relevanten Änderungen
-- seit dem letzten Besuch. Ein Eintrag je Anlass und Person, unabhängig von Push und Telegram; „Rückgängig“ zieht
-- ihn zurück. Der letzte Blick in die Glocke steht je Person in inbox_seen.

create table public.inbox_entries (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete restrict,
  event_type text not null check (length(event_type) > 0),
  text text not null check (length(text) > 0),
  link text not null check (length(link) > 0),
  dedupe_key text not null check (length(dedupe_key) > 0),
  created_at timestamptz not null default now(),
  unique (member_id, dedupe_key)
);
create index inbox_entries_member on public.inbox_entries (member_id, created_at desc);

create table public.inbox_seen (
  member_id uuid primary key references public.members (id) on delete restrict,
  seen_at timestamptz not null
);

-- persönlich: nur über die Server-Funktionen, kein direktes Lesen (wie notification_outbox)
alter table public.inbox_entries enable row level security;
alter table public.inbox_seen enable row level security;
