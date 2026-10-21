-- Review Phase 2 (22.10.2026): Eine Push-Nachricht geht an alle Geräte einer Person. Scheitert eines, versucht der
-- nächste Lauf es noch einmal – ohne die Geräte, die sie schon bekommen haben (keine doppelten Nachrichten, 9).
alter table public.notification_outbox add column delivered_to jsonb not null default '[]'::jsonb;
