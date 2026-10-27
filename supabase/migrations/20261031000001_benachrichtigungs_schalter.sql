-- Schalter-Matrix der Benachrichtigungen (F-PRO-02, WF-PRO-04) auf dem Server: je Mitglied, Ereignis und Kanal an
-- oder aus. Fehlt eine Zeile, ist der Kanal an (Nutzerin, 27.10.2026: auch neue Mitglieder starten mit allem an) –
-- gespeichert wird, was jemand umschaltet.

create table public.notification_preferences (
  member_id uuid not null references public.members (id) on delete restrict,
  event_type text not null check (event_type in (
    'zuweisung', 'kommentar', 'frist_naht', 'frist_heute', 'frist_ueberschritten', 'status', 'blockade_aufgehoben',
    'termin_einladung', 'termin_erinnerung', 'termin_geaendert', 'plenum_zusammenfassung', 'zuweisung_abgelehnt',
    'entscheidung_bestaetigen', 'entscheidung_frist', 'eigene_aktion'
  )),
  channel text not null check (channel in ('push', 'telegram')),
  enabled boolean not null,
  primary key (member_id, event_type, channel)
);

-- persönliche Einstellungen: keine Lese-Policy, nur die Server-Funktionen sehen sie
alter table public.notification_preferences enable row level security;

-- Phase 12: Bestätigung eigener Aktionen
alter table public.notification_outbox drop constraint notification_outbox_event_type_check;
alter table public.notification_outbox add constraint notification_outbox_event_type_check check (event_type in (
  'zuweisung', 'kommentar', 'frist_naht', 'frist_heute', 'frist_ueberschritten', 'status', 'blockade_aufgehoben',
  'termin_einladung', 'termin_erinnerung', 'termin_geaendert', 'plenum_zusammenfassung', 'zuweisung_abgelehnt',
  'entscheidung_bestaetigen', 'entscheidung_frist', 'eigene_aktion'
));
