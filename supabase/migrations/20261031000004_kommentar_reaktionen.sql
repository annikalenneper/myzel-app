-- Phase 12 (Nutzerin, 27.10.2026): Reaktionen an Kommentaren – je Person und Art höchstens eine, eintragsweise an/aus.

create table public.comment_reactions (
  comment_id uuid not null references public.comments (id) on delete restrict,
  member_id uuid not null references public.members (id) on delete restrict,
  reaction text not null check (reaction in ('herz', 'daumen_hoch', 'daumen_runter', 'frage', 'lachen', 'totenkopf', 'kleeblatt')),
  created_at timestamptz not null default now(),
  primary key (comment_id, member_id, reaction)
);

-- Lesen wie die Kommentare selbst: für aktive Mitglieder; schreiben nur über die Server-Funktionen
alter table public.comment_reactions enable row level security;
create policy comment_reactions_read on public.comment_reactions for select to authenticated using (public.is_active_member());
grant select on public.comment_reactions to authenticated;
