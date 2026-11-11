-- Phase 14 (Nutzerin, 11.11.2026): Benachrichtigungen bündeln statt fluten. Nachrichten mit gleichem Bündel-Schlüssel
-- (z. B. alle zu einem Termin) an dieselbe Person gehen, solange sie warten, als eine raus – die neueste Fassung gilt.
-- Ältere werden „ersetzt“. Termin-Einladungen, -Änderungen und Statuswechsel warten bis send_after (10 Minuten Ruhe).
-- invite_text: Text einer Termin-Änderung, falls die Einladung noch nicht raus ist (leer: dann nichts schicken).

alter table public.notification_outbox add column bundle_key text check (length(bundle_key) > 0);
alter table public.notification_outbox add column invite_text text;
alter table public.notification_outbox add column send_after timestamptz;
alter table public.notification_outbox drop constraint notification_outbox_status_check;
alter table public.notification_outbox add constraint notification_outbox_status_check
  check (status in ('wartet', 'gesendet', 'fehlgeschlagen', 'ersetzt'));
create index notification_outbox_bundle on public.notification_outbox (member_id, channel, bundle_key)
  where status = 'wartet' and bundle_key is not null;

-- Glocke: noch nicht gesehene Einträge eines Bündels erscheinen als einer
alter table public.inbox_entries add column bundle_key text check (length(bundle_key) > 0);
alter table public.inbox_entries add column invite_text text;
