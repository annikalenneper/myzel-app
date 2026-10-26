-- Umbau 10/2026, F3 (Nutzerin, 30.10.2026): Benachrichtigung bei einer neuen Entscheidung zum Bestätigen und am letzten
-- Tag der Frist an alle, die noch nicht abgestimmt haben.

alter table public.notification_outbox drop constraint notification_outbox_event_type_check;
alter table public.notification_outbox add constraint notification_outbox_event_type_check check (event_type in (
  'zuweisung', 'kommentar', 'frist_naht', 'frist_heute', 'frist_ueberschritten', 'status', 'blockade_aufgehoben',
  'termin_einladung', 'termin_erinnerung', 'termin_geaendert', 'plenum_zusammenfassung', 'zuweisung_abgelehnt',
  'entscheidung_bestaetigen', 'entscheidung_frist'
));
