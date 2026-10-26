-- Umbau 10/2026, Phase 3 (ANFORDERUNGEN 16.2, 16.3): Aus einer Frage können mehrere Entscheidungen und Fakten
-- entstehen. Statt questions.resulting_decision_id (eins zu eins) verweist jeder Eintrag auf seine Frage.

alter table public.decisions
  add column source_question_id uuid references public.questions (id) on delete restrict;
create index decisions_source_question on public.decisions (source_question_id)
  where source_question_id is not null;

update public.decisions d
set source_question_id = q.id
from public.questions q
where q.resulting_decision_id = d.id;

alter table public.questions drop column resulting_decision_id;

-- Beantwortet ⇒ Antwort oder mindestens ein Ergebnis (16.3): reicht über zwei Tabellen, deshalb prüft es allein der
-- Server-Code; die Datenbank verlangt die Antwort nicht mehr.
alter table public.questions drop constraint questions_clarified_has_answer;

-- Ergebnis eines Plenums (16.2): Herkunft und Antwort im Plenum schnell finden
create index tasks_origin_plenum on public.tasks (origin_plenum_id) where origin_plenum_id is not null;
create index questions_answered_in_plenum on public.questions (answered_in_plenum_id)
  where answered_in_plenum_id is not null;
create index decisions_source_plenum on public.decisions (source_plenum_id) where source_plenum_id is not null;

-- Rückgängig-Einträge der letzten 30 Sekunden kennen noch den alten Verweis
delete from public.undo_actions;
