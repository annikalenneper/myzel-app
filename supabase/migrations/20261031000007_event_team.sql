-- Verbesserungen (Nutzerin, 31.10.2026): neben „Hauptverantwortlich“ auch „Mitarbeit Orga“ und „Mitarbeit am Tag des
-- Events“. Eine Person kann mehrere Rollen haben; bestehende Einträge sind Hauptverantwortliche.

alter table public.event_leads
  add column role text not null default 'haupt' check (role in ('haupt', 'orga', 'tag'));
alter table public.event_leads drop constraint event_leads_pkey;
alter table public.event_leads add primary key (event_id, member_id, role);
alter table public.event_leads alter column role drop default;
