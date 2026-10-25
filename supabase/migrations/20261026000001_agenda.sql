-- Umbau 10/2026, Phase 2 (ANFORDERUNGEN 16.1): Die Agenda ist eine eigene Ansicht. Offene Aufgaben und Fragen stehen
-- von selbst darauf; ausdrücklich aufgesetzt werden nur noch Entscheidungen und Fakten („Stimmt das noch?“).
-- Markierungen anderer Arten entfallen ohne Ersatz – sie haben keine Historie (Annahme U1 in PROGRESS.md).

delete from public.plenum_marks where decision_id is null;

alter table public.plenum_marks drop constraint plenum_marks_one_target;
alter table public.plenum_marks
  drop column task_id,
  drop column question_id,
  drop column event_id,
  drop column appointment_id,
  drop column document_id,
  drop column partner_id;
alter table public.plenum_marks alter column decision_id set not null;

-- Rückgängig-Einträge der letzten 30 Sekunden kennen noch die alten Markierungen
delete from public.undo_actions;
