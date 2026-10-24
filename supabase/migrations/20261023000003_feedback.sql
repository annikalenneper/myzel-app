-- Rückmeldungen der Nutzerin vom 22.10.2026 (PROGRESS.md, Plan bis zum Deploy).

-- Blockiert ⇒ Grund oder mindestens eine Abhängigkeit (7.2): das reicht über zwei Tabellen, deshalb prüft es allein
-- der Server-Code; die Datenbank verlangt den Grund nicht mehr.
alter table public.tasks drop constraint tasks_blocked_needs_reason;

-- Themen (3.2): „Verein“ ohne Unterkategorien. Unbenutzte werden gelöscht, benutzte archiviert (wiederherstellbar).
create temporary table verein_children on commit drop as
  select c.id from public.topics c join public.topics p on p.id = c.parent_id
  where p.parent_id is null and p.name = 'Verein';

-- Vorlagen und Terminarten sind Einstellungen ohne eigene Historie: auf „Verein“ umhängen
update public.event_template_items set topic_id = (select id from public.topics where parent_id is null and name = 'Verein')
where topic_id in (select id from verein_children);
update public.appointment_types set default_topic_id = (select id from public.topics where parent_id is null and name = 'Verein')
where default_topic_id in (select id from verein_children);

delete from public.topics t
where t.id in (select id from verein_children)
  and not exists (select 1 from public.topics x where x.parent_id = t.id)
  and not exists (select 1 from public.tasks x where x.topic_id = t.id)
  and not exists (select 1 from public.appointment_types x where x.default_topic_id = t.id)
  and not exists (select 1 from public.appointments x where x.topic_id = t.id)
  and not exists (select 1 from public.documents x where x.topic_id = t.id)
  and not exists (select 1 from public.decisions x where x.topic_id = t.id)
  and not exists (select 1 from public.questions x where x.topic_id = t.id)
  and not exists (select 1 from public.event_template_items x where x.topic_id = t.id);

update public.topics set archived_at = now()
where id in (select id from verein_children) and archived_at is null;

-- Neues Thema „Sonstiges“ auf oberster Ebene, ans Ende
insert into public.topics (name, sort_order)
select 'Sonstiges', coalesce(max(sort_order), 0) + 1 from public.topics where parent_id is null
having not exists (select 1 from public.topics where parent_id is null and lower(name) = 'sonstiges');

-- Booking: Gage als Auswahl offen / nein / ja, Betrag nur bei „ja“ (3.4)
alter table public.event_bookings
  add column fee_status text not null default 'offen' check (fee_status in ('offen', 'nein', 'ja'));
update public.event_bookings set fee_status = 'ja' where fee is not null;
alter table public.event_bookings
  add constraint event_bookings_fee_only_if_yes check (fee is null or fee_status = 'ja');
