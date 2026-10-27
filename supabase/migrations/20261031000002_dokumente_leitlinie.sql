-- Datenkorrektur (Nutzerin, 27.10.2026): Code of Conduct, Leitfaden Polizei/Ordnungsamt und Sicherheitskonzept Outdoor
-- sind Leitlinien, nicht „Sonstiges“. Die Art eines Dokuments lässt sich in der App nicht ändern – deshalb hier, mit
-- version und Verlauf wie jede Änderung, als „Myzel (automatisch)“.

with before as (
  select id, doc_type
  from public.documents
  where archived_at is null
    and doc_type <> 'leitlinie'
    and (title ilike '%code of conduct%' or title ilike '%polizei%ordnungsamt%' or title ilike '%sicherheitskonzept%outdoor%')
), fixed as (
  update public.documents d
  set doc_type = 'leitlinie', version = d.version + 1, updated_at = now()
  from before
  where d.id = before.id
  returning d.id, before.doc_type as old_type
)
insert into public.history (entity_type, entity_id, actor_member_id, action, changes)
select 'document', fixed.id, system.id, 'updated',
       jsonb_build_object('doc_type', jsonb_build_object('old', fixed.old_type, 'new', 'leitlinie'))
from fixed
cross join (select id from public.members where is_system limit 1) as system;
