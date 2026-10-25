-- Weitere Login-Adressen je Mitglied (3.1, Nutzerin 25.10.2026): Mit jeder eingetragenen Adresse klappt die
-- Anmeldung, per Google oder Mail-Link. Bei Supabase ist jede Adresse ein eigener Login – deshalb hat jede Adresse
-- ihre eigene Verknüpfung (auth_user_id), beim ersten Login damit gesetzt. Die Hauptadresse bleibt members.email.
-- Eindeutig über beide Tabellen prüft der Server-Code; hier nur innerhalb der Tabelle.

create table public.member_emails (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete restrict,
  email text not null check (length(trim(email)) > 0),
  auth_user_id uuid unique,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.members (id) on delete restrict
);
create unique index member_emails_email_unique on public.member_emails (lower(email));
create index member_emails_member on public.member_emails (member_id);

-- enthält Mail-Adressen: keine Lese-Policy, nur die Server-Funktionen sehen sie
alter table public.member_emails enable row level security;

-- Lesen für aktive Mitglieder (7.1): auch wer sich mit einer weiteren Adresse angemeldet hat
create or replace function public.is_active_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.members m
    where m.active and not m.is_system
      and (m.auth_user_id = auth.uid()
        or exists (select 1 from public.member_emails e where e.member_id = m.id and e.auth_user_id = auth.uid()))
  );
$$;
