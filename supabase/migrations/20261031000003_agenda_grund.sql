-- Phase 12 (Nutzerin, 27.10.2026): Wer eine Entscheidung oder einen Fakt auf die Agenda setzt, wählt „Stimmt das noch?“
-- oder „Aktion erforderlich“. Bestehende Markierungen sind „Stimmt das noch?“.

alter table public.plenum_marks
  add column reason text not null default 'stimmt_noch' check (reason in ('stimmt_noch', 'aktion'));
