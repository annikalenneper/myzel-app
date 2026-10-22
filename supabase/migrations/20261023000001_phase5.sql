-- Phase 5 – Wissen & Drive (ANFORDERUNGEN 3.13, 10.5): Cache des Vereins-Drives (nur Metadaten), Stand des Abgleichs,
-- Drive-Ordner der Veranstaltung. Der Server füllt den Cache über das Dienstkonto (server/p5); Regeln im Server-Code.

-- ── Drive-Cache: ein Eintrag je Datei oder Ordner, wie zuletzt von Drive gemeldet ──
create table public.drive_items (
  file_id text primary key check (length(file_id) > 0),
  -- null nur beim Wurzelordner (oder wenn Drive keinen sichtbaren Elternordner nennt)
  parent_id text,
  name text not null,
  mime_type text not null,
  modified_time timestamptz not null,
  web_url text not null,
  trashed boolean not null default false,
  synced_at timestamptz not null
);
create index drive_items_parent on public.drive_items (parent_id);

-- ── Stand des Abgleichs: genau eine Zeile ──
create table public.drive_sync_state (
  id boolean primary key default true check (id),
  root_folder_id text not null,
  changes_page_token text,
  last_checked_at timestamptz,
  last_full_sync_at timestamptz
);

-- ── Drive-Ordner der Veranstaltung (WF-VER-14): ID aus Drive, darf dort verschwinden ──
alter table public.events add column drive_folder_id text;

-- ── Zugriff (7.1): Lesen für aktive Mitglieder, direktes Schreiben gesperrt ──
alter table public.drive_items enable row level security;
alter table public.drive_sync_state enable row level security;

create policy drive_items_read on public.drive_items for select to authenticated using (public.is_active_member());
create policy drive_sync_state_read on public.drive_sync_state for select to authenticated using (public.is_active_member());

grant select on public.drive_items, public.drive_sync_state to authenticated;
