-- Umbau 10/2026, Phase 6 (ANFORDERUNGEN 16.4): Entscheidungen im Konsens. Eine neue Entscheidung ist „offen“, bis alle
-- aktiven Mitglieder bestätigt haben oder die Frist ohne Widerspruch abläuft. Fakten gelten sofort. Bestehende
-- Entscheidungen bleiben gültig (Annahme U2).

alter table public.decisions drop constraint decisions_status_check;
alter table public.decisions add constraint decisions_status_check
  check (status in ('offen', 'gueltig', 'ersetzt', 'aufgehoben'));

-- letzter Tag zum Bestätigen oder Widersprechen
alter table public.decisions add column consensus_until date;
alter table public.decisions add constraint decisions_open_has_deadline
  check (status <> 'offen' or (kind = 'entscheidung' and consensus_until is not null));
create index decisions_open on public.decisions (consensus_until) where status = 'offen';

-- je Mitglied eine Stimme; eintragsweise geändert, nie als Ganzes ersetzt
create table public.decision_votes (
  decision_id uuid not null references public.decisions (id) on delete restrict,
  member_id uuid not null references public.members (id) on delete restrict,
  vote text not null check (vote in ('bestaetigt', 'widerspruch')),
  voted_at timestamptz not null default now(),
  primary key (decision_id, member_id)
);

alter table public.decision_votes enable row level security;
create policy decision_votes_read on public.decision_votes for select to authenticated using (public.is_active_member());
grant select on public.decision_votes to authenticated;
