-- Umbau 10/2026, Phase 4 (ANFORDERUNGEN 16.3, 16.4): Kommentare für alle Artefakte, Beschreibung an Terminen,
-- Event-Bezug für Entscheidungen und Fakten.

-- Kommentare: genau eine Zielspalte ist gesetzt (wie früher bei den Markierungen)
alter table public.comments alter column task_id drop not null;
alter table public.comments
  add column question_id uuid references public.questions (id) on delete restrict,
  add column decision_id uuid references public.decisions (id) on delete restrict,
  add column event_id uuid references public.events (id) on delete restrict,
  add column appointment_id uuid references public.appointments (id) on delete restrict,
  add column partner_id uuid references public.partners (id) on delete restrict;
alter table public.comments add constraint comments_one_target
  check (num_nonnulls(task_id, question_id, decision_id, event_id, appointment_id, partner_id) = 1);
create index comments_question on public.comments (question_id, created_at) where question_id is not null;
create index comments_decision on public.comments (decision_id, created_at) where decision_id is not null;
create index comments_event on public.comments (event_id, created_at) where event_id is not null;
create index comments_appointment on public.comments (appointment_id, created_at) where appointment_id is not null;
create index comments_partner on public.comments (partner_id, created_at) where partner_id is not null;

-- Termine: Beschreibung wie alle anderen Artefakte
alter table public.appointments add column description text;

-- Entscheidungen und Fakten gehören optional zu einer Veranstaltung
alter table public.decisions add column event_id uuid references public.events (id) on delete restrict;
create index decisions_event on public.decisions (event_id) where event_id is not null;

-- Review Phase 3: Das Ergebnis eines Plenums sucht alle Historie mit seiner plenum_id (16.2) – der alte Teilindex galt
-- nur für Zeilen mit „plenum_line“, die seit dem Umbau niemand mehr schreibt.
drop index public.history_plenum;
create index history_plenum on public.history ((changes -> 'plenum_id' ->> 'new')) where changes ? 'plenum_id';
