-- Phase 5, nach dem Agent-Review: letzter Versuch eines Abgleichs (auch fehlgeschlagen) – höchstens einmal pro Minute
-- erneut; ein Dokument je Drive-Datei nur unter den nicht archivierten (wie die Regel „ein Eintrag je Datei“, F-WIS-06).
alter table public.drive_sync_state add column last_attempt_at timestamptz;

drop index public.documents_drive_file;
create unique index documents_drive_file on public.documents (drive_file_id)
  where drive_file_id is not null and archived_at is null;
