-- Phase 15 (Nutzerin, 12.11.2026): Benachrichtigungen, die unterstützen statt stören.
-- Nachtruhe 22–8 Uhr und „Änderungen an Terminen in mehr als 4 Wochen nur in der Glocke“ brauchen keine Spalten.
-- Tägliche Zusammenfassung: je Person die Ereignisse, die einmal am Tag um 8 Uhr gesammelt kommen; solche Nachrichten
-- tragen digest = true. Was sich über Nacht oder für die Zusammenfassung sammelt, geht als eine „sammelnachricht“ raus.
-- „Eigene Aktionen“ sind ohne Eintrag in notification_preferences jetzt aus (Server-Code, keine Datenänderung).

create table public.notification_digests (
  member_id uuid not null references public.members (id) on delete restrict,
  event_type text not null check (length(event_type) > 0),
  primary key (member_id, event_type)
);
alter table public.notification_digests enable row level security;

alter table public.notification_outbox add column digest boolean not null default false;

alter table public.notification_outbox drop constraint notification_outbox_event_type_check;
alter table public.notification_outbox add constraint notification_outbox_event_type_check check (event_type in (
  'zuweisung', 'kommentar', 'frist_naht', 'frist_heute', 'frist_ueberschritten', 'status', 'blockade_aufgehoben',
  'termin_einladung', 'termin_erinnerung', 'termin_geaendert', 'plenum_zusammenfassung', 'zuweisung_abgelehnt',
  'entscheidung_bestaetigen', 'entscheidung_frist', 'eigene_aktion', 'sammelnachricht'
));
