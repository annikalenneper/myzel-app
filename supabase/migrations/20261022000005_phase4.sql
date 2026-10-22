-- Phase 4 – Veranstaltungen (ANFORDERUNGEN 3.4, 3.5, 3.12, 10.4): Detailbereiche, Booking, Hauptverantwortliche,
-- Partner, Aufbau/Abbau, Schichtplan, Vorlagen; Markierung „Fürs Plenum“ für Partner.
-- Fachliche Regeln stehen im Server-Code (server/p4); die Vorlagen füllt `npm run db:seed-templates` aus der YAML-Datei.

-- ── Veranstaltung: Aufbau, Abbau, Schichtplan ──────────────────────────────
alter table public.events
  add column setup_at timestamptz,
  add column teardown_at timestamptz,
  add column shift_plan_document_id uuid references public.documents (id) on delete restrict,
  add constraint events_setup_before_start check (setup_at is null or setup_at <= starts_at),
  add constraint events_teardown_after_end check (teardown_at is null or teardown_at >= coalesce(ends_at, starts_at));

-- ── Detailbereiche (F-VER-04): eine Zeile je Veranstaltung, Form nach eventDetailsSchema (src/shared/schema.ts) ──
create table public.event_details (
  event_id uuid primary key references public.events (id) on delete restrict,
  data jsonb not null check (jsonb_typeof(data) = 'object')
);

-- ── Booking: mehrere Acts je Veranstaltung, eintragsweise ──────────────────
create table public.event_bookings (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete restrict,
  act_name text not null check (length(trim(act_name)) > 0),
  act_type text not null check (act_type in ('dj', 'band', 'sonstiges')),
  contact text,
  status text not null default 'angefragt' check (status in ('angefragt', 'zugesagt', 'abgesagt')),
  fee text,
  tech_requirements text,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.members (id) on delete restrict,
  version integer not null default 1 check (version >= 1)
);
create index event_bookings_event on public.event_bookings (event_id, created_at);

-- ── Hauptverantwortliche (WF-VER-09), eintragsweise ────────────────────────
create table public.event_leads (
  event_id uuid not null references public.events (id) on delete restrict,
  member_id uuid not null references public.members (id) on delete restrict,
  added_by uuid not null references public.members (id) on delete restrict,
  added_at timestamptz not null default now(),
  primary key (event_id, member_id)
);
create index event_leads_member on public.event_leads (member_id);

-- ── Kooperationspartner (3.5, F-VER-05) ─────────────────────────────────────
create table public.partners (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  kind text,
  description text,
  contact_person text,
  email text,
  phone text,
  website text,
  notes text,
  internal_contact_member_id uuid references public.members (id) on delete restrict,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references public.members (id) on delete restrict,
  version integer not null default 1 check (version >= 1)
);
create unique index partners_name_unique on public.partners (lower(name));

create table public.event_partners (
  event_id uuid not null references public.events (id) on delete restrict,
  partner_id uuid not null references public.partners (id) on delete restrict,
  role_note text check (role_note is null or length(role_note) <= 200),
  added_by uuid not null references public.members (id) on delete restrict,
  added_at timestamptz not null default now(),
  primary key (event_id, partner_id)
);
create index event_partners_partner on public.event_partners (partner_id);

-- ── Vorlagen (3.12, F-VER-06, F-VER-07): je Veranstaltungsart eine ─────────
create table public.event_templates (
  id uuid primary key default gen_random_uuid(),
  event_type text not null unique check (event_type in ('party', 'workshop', 'soli', 'sonstiges')),
  name text not null check (length(trim(name)) > 0),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1)
);

-- Vorlagenaufgaben werden archiviert statt gelöscht: angelegte Aufgaben verweisen über template_applications darauf
create table public.event_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.event_templates (id) on delete restrict,
  block text not null check (length(trim(block)) > 0),
  title text not null check (length(trim(title)) > 0),
  description text,
  offset_days integer not null check (offset_days between -365 and 365),
  default_priority text not null default 'mittel' check (default_priority in ('hoch', 'mittel', 'niedrig')),
  topic_id uuid not null references public.topics (id) on delete restrict,
  position integer not null,
  archived_at timestamptz,
  version integer not null default 1 check (version >= 1)
);
create index event_template_items_template on public.event_template_items (template_id, position);

-- Welche Vorlagenaufgabe bei welcher Veranstaltung schon angelegt ist – verhindert Duplikate (F-VER-07)
create table public.template_applications (
  event_id uuid not null references public.events (id) on delete restrict,
  template_item_id uuid not null references public.event_template_items (id) on delete restrict,
  task_id uuid not null unique references public.tasks (id) on delete restrict,
  applied_by uuid not null references public.members (id) on delete restrict,
  applied_at timestamptz not null default now(),
  primary key (event_id, template_item_id)
);

-- ── Markierung „Fürs Plenum“ für Partner ───────────────────────────────────
alter table public.plenum_marks add column partner_id uuid unique references public.partners (id) on delete restrict;
alter table public.plenum_marks drop constraint plenum_marks_one_target;
alter table public.plenum_marks add constraint plenum_marks_one_target
  check (num_nonnulls(task_id, question_id, decision_id, event_id, appointment_id, document_id, partner_id) = 1);

-- ── Historie: Partner ───────────────────────────────────────────────────────
alter table public.history drop constraint history_entity_type_check;
alter table public.history add constraint history_entity_type_check check (entity_type in (
  'task', 'event', 'member', 'topic', 'appointment', 'appointment_type', 'decision', 'question', 'document', 'partner'
));

-- ── Zugriff (7.1): Lesen für aktive Mitglieder, direktes Schreiben gesperrt ──
alter table public.event_details enable row level security;
alter table public.event_bookings enable row level security;
alter table public.event_leads enable row level security;
alter table public.partners enable row level security;
alter table public.event_partners enable row level security;
alter table public.event_templates enable row level security;
alter table public.event_template_items enable row level security;
alter table public.template_applications enable row level security;

create policy event_details_read on public.event_details for select to authenticated using (public.is_active_member());
create policy event_bookings_read on public.event_bookings for select to authenticated using (public.is_active_member());
create policy event_leads_read on public.event_leads for select to authenticated using (public.is_active_member());
create policy partners_read on public.partners for select to authenticated using (public.is_active_member());
create policy event_partners_read on public.event_partners for select to authenticated using (public.is_active_member());
create policy event_templates_read on public.event_templates for select to authenticated using (public.is_active_member());
create policy event_template_items_read on public.event_template_items for select to authenticated using (public.is_active_member());
create policy template_applications_read on public.template_applications for select to authenticated using (public.is_active_member());

grant select on
  public.event_details, public.event_bookings, public.event_leads, public.partners, public.event_partners,
  public.event_templates, public.event_template_items, public.template_applications
to authenticated;
