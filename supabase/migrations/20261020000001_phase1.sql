-- Phase 1 – Aufgaben (ANFORDERUNGEN 3.1 bis 3.4, 3.10, 3.14, 7.1)
-- Die Datenbank sichert nur die Struktur: NOT NULL, Unique, Fremdschlüssel mit RESTRICT, RLS (Lesen für aktive
-- Mitglieder, direktes Schreiben gesperrt). Alle fachlichen Regeln stehen in den Server-Funktionen; die schreiben
-- über eine eigene Datenbank-Verbindung, an RLS vorbei.

-- ── Mitglieder (3.1) ────────────────────────────────────────────────────────
create table public.members (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  email text,
  display_name text not null check (length(trim(display_name)) > 0),
  short text not null check (length(short) between 1 and 3),
  is_admin boolean not null default false,
  active boolean not null default true,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.members (id) on delete restrict,
  version integer not null default 1 check (version >= 1),
  -- nur der Systemeintrag „Myzel (automatisch)“ hat keine Mail (Annahme A13)
  constraint members_email_unless_system check (is_system or email is not null)
);
create unique index members_email_unique on public.members (lower(email));
create unique index members_short_unique on public.members (upper(short));
-- höchstens ein Systemeintrag
create unique index members_one_system on public.members (is_system) where is_system;

-- ── Themen (3.2), zwei Ebenen ───────────────────────────────────────────────
create table public.topics (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  parent_id uuid references public.topics (id) on delete restrict,
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.members (id) on delete restrict,
  version integer not null default 1 check (version >= 1),
  constraint topics_not_own_parent check (parent_id is distinct from id)
);
-- gleicher Name nur einmal je Ebene
create unique index topics_name_unique on public.topics (coalesce(parent_id, '00000000-0000-0000-0000-000000000000'), lower(name));

-- ── Veranstaltungen, schlank (3.4 Basis) ────────────────────────────────────
create table public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  type text not null check (type in ('party', 'workshop', 'soli', 'sonstiges')),
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  status text not null default 'idee'
    check (status in ('idee', 'in_planung', 'bestaetigt', 'in_nachbereitung', 'abgeschlossen', 'abgesagt')),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references public.members (id) on delete restrict,
  version integer not null default 1 check (version >= 1),
  constraint events_end_after_start check (ends_at is null or ends_at > starts_at)
);

-- ── Aufgaben (3.3) ──────────────────────────────────────────────────────────
-- fortlaufende Nummer („AUFGABE #017“, Annahme A4)
create sequence public.task_number_seq;
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  number integer not null unique default nextval('public.task_number_seq'),
  title text not null check (length(trim(title)) > 0),
  description text,
  topic_id uuid not null references public.topics (id) on delete restrict,
  event_id uuid references public.events (id) on delete restrict,
  priority text not null default 'mittel' check (priority in ('hoch', 'mittel', 'niedrig')),
  due_date date,
  status text not null default 'neu'
    check (status in ('neu', 'geplant', 'in_arbeit', 'blockiert', 'erledigt', 'verworfen')),
  block_reason text,
  discard_reason text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references public.members (id) on delete restrict,
  version integer not null default 1 check (version >= 1),
  -- blockiert ⇒ Grund (Pflichtregel aus 3.3; die Server-Funktion prüft es vorher mit deutscher Meldung)
  constraint tasks_blocked_needs_reason check (status <> 'blockiert' or length(trim(coalesce(block_reason, ''))) > 0)
);
alter sequence public.task_number_seq owned by public.tasks.number;
create index tasks_topic on public.tasks (topic_id);
create index tasks_event on public.tasks (event_id);

create table public.task_assignees (
  task_id uuid not null references public.tasks (id) on delete restrict,
  member_id uuid not null references public.members (id) on delete restrict,
  assigned_by uuid not null references public.members (id) on delete restrict,
  assigned_at timestamptz not null default now(),
  primary key (task_id, member_id)
);
create index task_assignees_member on public.task_assignees (member_id);

create table public.task_followers (
  task_id uuid not null references public.tasks (id) on delete restrict,
  member_id uuid not null references public.members (id) on delete restrict,
  primary key (task_id, member_id)
);
create index task_followers_member on public.task_followers (member_id);

-- „task_id hängt ab von blocker_task_id“; keine Selbstreferenz – Zyklen prüft der Server
create table public.task_blockers (
  task_id uuid not null references public.tasks (id) on delete restrict,
  blocker_task_id uuid not null references public.tasks (id) on delete restrict,
  primary key (task_id, blocker_task_id),
  constraint task_blockers_not_self check (task_id <> blocker_task_id)
);
create index task_blockers_blocker on public.task_blockers (blocker_task_id);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete restrict,
  author_id uuid not null references public.members (id) on delete restrict,
  body text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index comments_task on public.comments (task_id, created_at);

-- ── Markierung „Fürs Plenum“ (3.14) – P1 nur Aufgaben; weitere Zielspalten kommen mit P3 und P4 ──
create table public.plenum_marks (
  id uuid primary key default gen_random_uuid(),
  task_id uuid unique references public.tasks (id) on delete restrict,
  position integer not null,
  note text,
  marked_by uuid not null references public.members (id) on delete restrict,
  marked_at timestamptz not null default now(),
  constraint plenum_marks_one_target check (num_nonnulls(task_id) = 1)
);

-- ── Historie (3.10): nicht änder- oder löschbar ──────────────────────────────
create table public.history (
  id uuid primary key default gen_random_uuid(),
  -- Reihenfolge des Eintragens: eine Aktion schreibt oft mehrere Einträge mit demselben Zeitstempel
  seq bigint generated always as identity,
  entity_type text not null check (entity_type in ('task', 'event', 'member', 'topic')),
  entity_id uuid not null,
  actor_member_id uuid not null references public.members (id) on delete restrict,
  action text not null check (length(action) > 0),
  changes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index history_entity on public.history (entity_type, entity_id, created_at, seq);

create function public.history_is_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'Die Historie lässt sich nicht ändern oder löschen.';
end;
$$;
create trigger history_append_only before update or delete on public.history
  for each row execute function public.history_is_append_only();
create trigger history_no_truncate before truncate on public.history
  for each statement execute function public.history_is_append_only();

-- ── Rückgängig (WF-ALL-02): Gegenschritte einer Aktion, 30 Sekunden gültig ───
create table public.undo_actions (
  token uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.members (id) on delete restrict,
  created_at timestamptz not null default now(),
  entity_type text not null,
  entity_id uuid not null,
  version_after integer not null,
  label text not null,
  ops jsonb not null,
  history_ids jsonb not null default '[]'::jsonb
);

-- ── Zugriff (7.1): Lesen für aktive Mitglieder, direktes Schreiben gesperrt ──
create function public.is_active_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.members m where m.auth_user_id = auth.uid() and m.active and not m.is_system
  );
$$;

alter table public.members enable row level security;
alter table public.topics enable row level security;
alter table public.events enable row level security;
alter table public.tasks enable row level security;
alter table public.task_assignees enable row level security;
alter table public.task_followers enable row level security;
alter table public.task_blockers enable row level security;
alter table public.comments enable row level security;
alter table public.plenum_marks enable row level security;
alter table public.history enable row level security;
alter table public.undo_actions enable row level security;

create policy members_read on public.members for select to authenticated using (public.is_active_member());
create policy topics_read on public.topics for select to authenticated using (public.is_active_member());
create policy events_read on public.events for select to authenticated using (public.is_active_member());
create policy tasks_read on public.tasks for select to authenticated using (public.is_active_member());
create policy task_assignees_read on public.task_assignees for select to authenticated using (public.is_active_member());
create policy task_followers_read on public.task_followers for select to authenticated using (public.is_active_member());
create policy task_blockers_read on public.task_blockers for select to authenticated using (public.is_active_member());
create policy comments_read on public.comments for select to authenticated using (public.is_active_member());
create policy plenum_marks_read on public.plenum_marks for select to authenticated using (public.is_active_member());
create policy history_read on public.history for select to authenticated using (public.is_active_member());
-- undo_actions: keine Policy – nur die Server-Funktionen sehen sie

-- ── Startbestand ────────────────────────────────────────────────────────────
-- Systemeintrag für automatische Vorgänge (7.2)
insert into public.members (id, email, display_name, short, is_system)
values ('00000000-0000-4000-8000-000100000000', null, 'Myzel (automatisch)', '⚙', true);

-- Themen (3.2); Unterkategorien „Verein“ nach Frage 6 (Vorschlag, noch nicht bestätigt)
with top (name, sort_order) as (
  values ('Veranstaltungen', 1), ('Verein', 2), ('Lager & Material', 3), ('Öffentlichkeitsarbeit', 4),
         ('Organisatorisches', 5)
), inserted as (
  insert into public.topics (name, sort_order) select name, sort_order from top returning id, name
)
insert into public.topics (name, parent_id, sort_order)
select child.name, inserted.id, child.sort_order
from inserted
join (values ('Mitglieder', 1), ('Finanzen & Förderung', 2), ('Versicherung & Recht', 3),
             ('Vorstand & Satzung', 4), ('Infrastruktur', 5)) as child (name, sort_order)
  on inserted.name = 'Verein';
