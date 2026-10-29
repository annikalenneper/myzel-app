-- Phase 12 (Nutzerin, 29.10.2026): Termine einzeln einladen. Ohne Einträge sind alle aktiven Mitglieder eingeladen,
-- sonst nur die ausgewählten Personen und die anlegende Person.

create table public.appointment_invitees (
  appointment_id uuid not null references public.appointments (id) on delete restrict,
  member_id uuid not null references public.members (id) on delete restrict,
  primary key (appointment_id, member_id)
);
create index appointment_invitees_member on public.appointment_invitees (member_id);

-- Lesen für aktive Mitglieder; schreiben nur über die Server-Funktionen
alter table public.appointment_invitees enable row level security;
create policy appointment_invitees_read on public.appointment_invitees for select to authenticated using (public.is_active_member());
grant select on public.appointment_invitees to authenticated;
