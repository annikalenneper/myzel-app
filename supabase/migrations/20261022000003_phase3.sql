-- Phase 3 – Plenum-Zyklus (ANFORDERUNGEN 3.6 bis 3.9, 3.14, 4.3 bis 4.5, 10.3): Terminarten (+Startbestand), Termine,
-- Zu- und Absagen, Teilnahme, Entscheidungen und Fakten, offene Fragen, Dokumente mit Verknüpfungen; Aufgaben mit
-- Termin und Herkunft; Markierung „Fürs Plenum“ für alle Arten. Fachliche Regeln stehen im Server-Code (server/p3).

-- ── Terminarten (3.6, F-TER-06) ─────────────────────────────────────────────
create table public.appointment_types (
  id uuid primary key default gen_random_uuid(),
  key text not null check (length(key) > 0),
  label text not null check (length(trim(label)) > 0),
  default_topic_id uuid not null references public.topics (id) on delete restrict,
  default_format text not null check (default_format in ('vor_ort', 'online', 'hybrid')),
  default_location text,
  -- Agenda, Ergebnis und Abschluss – nach dem Anlegen nicht mehr änderbar
  has_plenum_features boolean not null default false,
  color text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.members (id) on delete restrict,
  version integer not null default 1 check (version >= 1)
);
create unique index appointment_types_label_unique on public.appointment_types (lower(label))
  where archived_at is null;

-- ── Termine (3.6) ───────────────────────────────────────────────────────────
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  type_id uuid not null references public.appointment_types (id) on delete restrict,
  title text not null check (length(trim(title)) > 0),
  topic_id uuid not null references public.topics (id) on delete restrict,
  event_id uuid references public.events (id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz,
  format text not null check (format in ('vor_ort', 'online', 'hybrid')),
  location text,
  online_url text,
  status text not null default 'geplant'
    check (status in ('geplant', 'stattgefunden', 'abgeschlossen', 'abgesagt')),
  -- [P6] Serien: die Spalten kommen mit ihrer Migration
  is_exception boolean not null default false,
  -- nur Plenum: Protokoll, protokollierende Person, Notizen
  protocol_document_id uuid,
  protocol_member_id uuid references public.members (id) on delete restrict,
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references public.members (id) on delete restrict,
  version integer not null default 1 check (version >= 1),
  constraint appointments_end_after_start check (ends_at is null or ends_at > starts_at)
);
create index appointments_starts on public.appointments (starts_at);
create index appointments_type on public.appointments (type_id);

create table public.appointment_rsvps (
  appointment_id uuid not null references public.appointments (id) on delete restrict,
  member_id uuid not null references public.members (id) on delete restrict,
  answer text not null check (answer in ('ja', 'nein')),
  answered_at timestamptz not null default now(),
  primary key (appointment_id, member_id)
);
create index appointment_rsvps_member on public.appointment_rsvps (member_id);

-- tatsächliche Teilnahme
create table public.appointment_attendees (
  appointment_id uuid not null references public.appointments (id) on delete restrict,
  member_id uuid not null references public.members (id) on delete restrict,
  primary key (appointment_id, member_id)
);

-- ── Aufgaben: Termin und Herkunft aus einem Plenum (F-AUF-08) ───────────────
alter table public.tasks
  add column appointment_id uuid references public.appointments (id) on delete restrict,
  add column origin_plenum_id uuid references public.appointments (id) on delete restrict;
create index tasks_appointment on public.tasks (appointment_id);

-- ── Dokumente (3.9): nur Links, keine Dateiinhalte ──────────────────────────
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  url text not null check (url ~ '^https?://'),
  -- nur bei Dateien aus dem Vereins-Drive [P5]
  drive_file_id text,
  doc_type text not null check (doc_type in ('protokoll', 'leitlinie', 'vorlage', 'schichtplan', 'sonstiges')),
  topic_id uuid references public.topics (id) on delete restrict,
  tags jsonb not null default '[]'::jsonb check (jsonb_typeof(tags) = 'array'),
  description text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references public.members (id) on delete restrict,
  version integer not null default 1 check (version >= 1)
);
create unique index documents_drive_file on public.documents (drive_file_id) where drive_file_id is not null;

alter table public.appointments
  add constraint appointments_protocol_document_fk
  foreign key (protocol_document_id) references public.documents (id) on delete restrict;

-- Verknüpfung eines Dokuments mit Aufgabe, Veranstaltung, Termin oder Entscheidung; das Ziel prüft der Server,
-- verwaiste Verknüpfungen meldet check:integrity
create table public.document_links (
  document_id uuid not null references public.documents (id) on delete restrict,
  target_type text not null check (target_type in ('task', 'event', 'appointment', 'decision')),
  target_id uuid not null,
  primary key (document_id, target_type, target_id)
);
create index document_links_target on public.document_links (target_type, target_id);

-- ── Entscheidungen und Fakten (3.8): mindestens eine Quelle ────────────────
create table public.decisions (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  description text,
  kind text not null check (kind in ('entscheidung', 'fakt')),
  topic_id uuid not null references public.topics (id) on delete restrict,
  decided_on date not null,
  status text not null default 'gueltig' check (status in ('gueltig', 'ersetzt', 'aufgehoben')),
  superseded_by_id uuid references public.decisions (id) on delete restrict,
  source_plenum_id uuid references public.appointments (id) on delete restrict,
  source_document_id uuid references public.documents (id) on delete restrict,
  source_note text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references public.members (id) on delete restrict,
  version integer not null default 1 check (version >= 1),
  constraint decisions_need_source
    check (source_plenum_id is not null or source_document_id is not null or length(trim(coalesce(source_note, ''))) > 0),
  constraint decisions_superseded_consistent check ((status = 'ersetzt') = (superseded_by_id is not null)),
  constraint decisions_not_own_successor check (superseded_by_id is distinct from id)
);

-- ── Offene Fragen (3.7) ─────────────────────────────────────────────────────
create table public.questions (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  description text,
  topic_id uuid not null references public.topics (id) on delete restrict,
  event_id uuid references public.events (id) on delete restrict,
  urgency text not null default 'mittel' check (urgency in ('hoch', 'mittel', 'niedrig')),
  status text not null default 'offen' check (status in ('offen', 'geklaert', 'verworfen')),
  raised_by uuid not null references public.members (id) on delete restrict,
  answer text,
  answered_in_plenum_id uuid references public.appointments (id) on delete restrict,
  resulting_decision_id uuid references public.decisions (id) on delete restrict,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references public.members (id) on delete restrict,
  version integer not null default 1 check (version >= 1),
  constraint questions_clarified_has_answer check (status <> 'geklaert' or length(trim(coalesce(answer, ''))) > 0)
);

-- ── Markierung „Fürs Plenum“ für alle Arten (3.14); Partner kommen mit P4 ───
alter table public.plenum_marks
  add column question_id uuid unique references public.questions (id) on delete restrict,
  add column decision_id uuid unique references public.decisions (id) on delete restrict,
  add column event_id uuid unique references public.events (id) on delete restrict,
  add column appointment_id uuid unique references public.appointments (id) on delete restrict,
  add column document_id uuid unique references public.documents (id) on delete restrict;
alter table public.plenum_marks drop constraint plenum_marks_one_target;
alter table public.plenum_marks add constraint plenum_marks_one_target
  check (num_nonnulls(task_id, question_id, decision_id, event_id, appointment_id, document_id) = 1);

-- ── Historie: neue Arten ────────────────────────────────────────────────────
alter table public.history drop constraint history_entity_type_check;
alter table public.history add constraint history_entity_type_check check (entity_type in (
  'task', 'event', 'member', 'topic', 'appointment', 'appointment_type', 'decision', 'question', 'document'
));

-- ── Zugriff (7.1): Lesen für aktive Mitglieder, direktes Schreiben gesperrt ──
alter table public.appointment_types enable row level security;
alter table public.appointments enable row level security;
alter table public.appointment_rsvps enable row level security;
alter table public.appointment_attendees enable row level security;
alter table public.documents enable row level security;
alter table public.document_links enable row level security;
alter table public.decisions enable row level security;
alter table public.questions enable row level security;

create policy appointment_types_read on public.appointment_types for select to authenticated using (public.is_active_member());
create policy appointments_read on public.appointments for select to authenticated using (public.is_active_member());
create policy appointment_rsvps_read on public.appointment_rsvps for select to authenticated using (public.is_active_member());
create policy appointment_attendees_read on public.appointment_attendees for select to authenticated using (public.is_active_member());
create policy documents_read on public.documents for select to authenticated using (public.is_active_member());
create policy document_links_read on public.document_links for select to authenticated using (public.is_active_member());
create policy decisions_read on public.decisions for select to authenticated using (public.is_active_member());
create policy questions_read on public.questions for select to authenticated using (public.is_active_member());

grant select on
  public.appointment_types, public.appointments, public.appointment_rsvps, public.appointment_attendees,
  public.documents, public.document_links, public.decisions, public.questions
to authenticated;

-- ── Startbestand: Terminarten (wie die Testdaten) ───────────────────────────
insert into public.appointment_types (key, label, default_topic_id, default_format, default_location, has_plenum_features, color, sort_order)
select t.key, t.label, topic.id, t.format, t.place, t.plenum, t.color, t.sort_order
from (values
  ('plenum', 'Plenum', 'Organisatorisches', 'online', null, true, '#F062C0', 1),
  ('bautag', 'Bautag', 'Lager & Material', 'vor_ort', 'Lager', false, '#B59AF5', 2),
  ('betriebsausflug', 'Betriebsausflug', 'Organisatorisches', 'vor_ort', null, false, '#E2DCF0', 3),
  ('besprechung_mit_externen', 'Besprechung mit Externen', 'Organisatorisches', 'vor_ort', null, false, '#8FA6FF', 4),
  ('sonstiges', 'Sonstiges', 'Organisatorisches', 'vor_ort', null, false, '#A69FB8', 5)
) as t (key, label, topic_name, format, place, plenum, color, sort_order)
join public.topics topic on topic.name = t.topic_name and topic.parent_id is null and topic.archived_at is null;
