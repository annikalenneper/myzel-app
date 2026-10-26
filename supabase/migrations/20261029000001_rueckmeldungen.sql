-- Umbau 10/2026, Phase 8 (ANFORDERUNGEN 16.5): Rückmeldung aus der App – Bug oder Feature-Wunsch, in eigener Tabelle.
-- Admins sehen die Liste im Profil; gelesen wird nur über die Server-Funktionen.

create table public.app_reports (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('bug', 'wunsch')),
  text text not null check (length(trim(text)) > 0 and length(text) <= 2000),
  app_version text not null default '',
  member_id uuid not null references public.members (id) on delete restrict,
  created_at timestamptz not null default now()
);
create index app_reports_created on public.app_reports (created_at desc);

-- keine Lese-Policy: nur Admins sehen die Liste, und das prüft der Server
alter table public.app_reports enable row level security;
