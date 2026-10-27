-- Schalter-Matrix der Benachrichtigungen (F-PRO-02, WF-PRO-04) auf dem Server: je Mitglied, Ereignis und Kanal an
-- oder aus. Fehlt eine Zeile, ist der Kanal aus (Rückmeldung vom 22.10.2026). Bisher hat der Server alles verschickt –
-- damit sich für die bestehenden Mitglieder nichts ändert, bekommen sie alle Schalter „an“.

create table public.notification_preferences (
  member_id uuid not null references public.members (id) on delete restrict,
  event_type text not null check (event_type in (
    'zuweisung', 'kommentar', 'frist_naht', 'frist_heute', 'frist_ueberschritten', 'status', 'blockade_aufgehoben',
    'termin_einladung', 'termin_erinnerung', 'termin_geaendert', 'plenum_zusammenfassung', 'zuweisung_abgelehnt',
    'entscheidung_bestaetigen', 'entscheidung_frist'
  )),
  channel text not null check (channel in ('push', 'telegram')),
  enabled boolean not null,
  primary key (member_id, event_type, channel)
);

-- persönliche Einstellungen: keine Lese-Policy, nur die Server-Funktionen sehen sie
alter table public.notification_preferences enable row level security;

insert into public.notification_preferences (member_id, event_type, channel, enabled)
select m.id, e.event_type, c.channel, true
from public.members m
cross join (values
  ('zuweisung'), ('kommentar'), ('frist_naht'), ('frist_heute'), ('frist_ueberschritten'), ('status'),
  ('blockade_aufgehoben'), ('termin_einladung'), ('termin_erinnerung'), ('termin_geaendert'),
  ('plenum_zusammenfassung'), ('zuweisung_abgelehnt'), ('entscheidung_bestaetigen'), ('entscheidung_frist')
) as e (event_type)
cross join (values ('push'), ('telegram')) as c (channel)
where not m.is_system;
