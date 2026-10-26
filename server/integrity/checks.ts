// Konsistenzprüfung (7.4 Nr. 4): Invarianten, die die Datenbank-Struktur allein nicht sichert, als SQL-Abfragen.
// Läuft nur lesend (auch gegen Produktion) – `npm run check:integrity` mit DATABASE_URL aus der .env.
// Jede Prüfung liefert die betroffenen Zeilen; leer heißt in Ordnung. Spätere Phasen hängen ihre Prüfungen an.
import { pathToFileURL } from 'node:url';
import { sql, type Kysely, type RawBuilder } from 'kysely';
import { ACTIVE_TASK_STATUSES } from '../../src/shared/rules/taskStatus';
import type { Database } from '../db/types';

export interface IntegrityCheck {
  name: string;
  /** fehler: Regel verletzt; hinweis: sollte jemand ansehen, ist aber kein Datenfehler */
  level: 'fehler' | 'hinweis';
  /** jede Zeile ist ein Treffer; `label` beschreibt ihn lesbar */
  query: RawBuilder<{ label: string }>;
}

const active = sql.join(ACTIVE_TASK_STATUSES.map((s) => sql.lit(s)));
const task = sql`'#' || t.number || ' ' || t.title`;

export const CHECKS: IntegrityCheck[] = [
  {
    name: 'Mindestens eine aktive Person mit Admin-Rechten',
    level: 'fehler',
    query: sql`select 'keine aktive Admin-Person' as label
      where not exists (select 1 from members where active and is_admin and not is_system)`,
  },
  {
    name: 'Keine aktive Aufgabe in einem archivierten Thema',
    level: 'fehler',
    query: sql`select ${task} || ' im Thema „' || tp.name || '“' as label
      from tasks t join topics tp on tp.id = t.topic_id
      where t.archived_at is null and t.status in (${active}) and tp.archived_at is not null`,
  },
  {
    name: 'Keine deaktivierten Bearbeitenden oder Folgenden',
    level: 'fehler',
    query: sql`select ${task} || ': ' || m.display_name || ' (' || x.rolle || ')' as label
      from (select task_id, member_id, 'bearbeitet' as rolle from task_assignees
            union all select task_id, member_id, 'folgt' from task_followers) x
      join members m on m.id = x.member_id join tasks t on t.id = x.task_id
      where not m.active or m.is_system`,
  },
  {
    name: 'Keine Zyklen bei Abhängigkeiten',
    level: 'fehler',
    query: sql`with recursive path (start_id, task_id) as (
        select task_id, blocker_task_id from task_blockers
        -- „union“ statt „union all“: jedes Paar nur einmal, endet auch bei verzweigten Abhängigkeiten
        union
        select p.start_id, b.blocker_task_id from path p join task_blockers b on b.task_id = p.task_id
      )
      select distinct ${task} || ' hängt über einen Kreis von sich selbst ab' as label
      from path p join tasks t on t.id = p.start_id where p.task_id = p.start_id`,
  },
  // ── Phase 3: Plenum-Zyklus ──
  {
    name: 'Auf der Agenda nur gültige oder offene Entscheidungen und Fakten',
    level: 'fehler',
    query: sql`select 'Eintrag „' || d.title || '“ (' || d.status || ')' as label
      from plenum_marks pm join decisions d on d.id = pm.decision_id
      where d.archived_at is not null or d.status not in ('gueltig', 'offen')`,
  },
  // ── Umbau Phase 6: Konsens (16.4) ──
  {
    name: 'Offene Entscheidungen ohne Widerspruch werden nach der Frist gültig (Joblauf)',
    level: 'hinweis',
    query: sql`select 'Entscheidung „' || d.title || '“ (Frist ' || d.consensus_until || ')' as label
      from decisions d
      where d.status = 'offen' and d.consensus_until < (now() at time zone 'Europe/Berlin')::date - 1
        and not exists (
          select 1 from decision_votes v join members m on m.id = v.member_id
          where v.decision_id = d.id and v.vote = 'widerspruch' and m.active
        )`,
  },
  {
    name: 'Beantwortete Fragen haben eine Antwort oder ein Ergebnis',
    level: 'fehler',
    query: sql`select 'Frage „' || q.title || '“' as label
      from questions q
      where q.status = 'geklaert' and length(trim(coalesce(q.answer, ''))) = 0
        and not exists (
          select 1 from decisions d where d.source_question_id = q.id and d.archived_at is null
        )`,
  },
  {
    name: 'Quelle „Plenum“ und Herkunft aus dem Plenum zeigen auf einen Plenum-Termin',
    level: 'fehler',
    query: sql`select x.art || ' „' || x.name || '“' as label from (
        select 'Eintrag' as art, d.title as name, d.source_plenum_id as plenum_id from decisions d where d.source_plenum_id is not null
        union all select 'Aufgabe', t.title, t.origin_plenum_id from tasks t where t.origin_plenum_id is not null
        union all select 'Frage', q.title, q.answered_in_plenum_id from questions q where q.answered_in_plenum_id is not null
      ) x join appointments a on a.id = x.plenum_id join appointment_types ty on ty.id = a.type_id
      where not ty.has_plenum_features`,
  },
  {
    name: 'Keine Kreise bei ersetzten Entscheidungen',
    level: 'fehler',
    query: sql`with recursive chain (start_id, id) as (
        select id, superseded_by_id from decisions where superseded_by_id is not null
        union
        select c.start_id, d.superseded_by_id from chain c join decisions d on d.id = c.id where d.superseded_by_id is not null
      )
      select distinct '„' || d.title || '“ ersetzt sich über einen Kreis selbst' as label
      from chain c join decisions d on d.id = c.start_id where c.id = c.start_id`,
  },
  {
    name: 'Dokument-Verknüpfungen zeigen auf vorhandene Ziele',
    level: 'fehler',
    query: sql`select '„' || d.title || '“ → ' || l.target_type || ' fehlt' as label
      from document_links l join documents d on d.id = l.document_id
      where not exists (
        select 1 from tasks x where l.target_type = 'task' and x.id = l.target_id
        union all select 1 from events x where l.target_type = 'event' and x.id = l.target_id
        union all select 1 from appointments x where l.target_type = 'appointment' and x.id = l.target_id
        union all select 1 from decisions x where l.target_type = 'decision' and x.id = l.target_id
      )`,
  },
  {
    name: 'Deaktivierte haben keine Zusagen für künftige Termine',
    level: 'fehler',
    query: sql`select m.display_name || ' bei „' || a.title || '“' as label
      from appointment_rsvps r join members m on m.id = r.member_id join appointments a on a.id = r.appointment_id
      where not m.active and a.status = 'geplant' and a.starts_at > now()`,
  },
  {
    name: 'Alles Angelegte hat seinen Eintrag „angelegt“ in der Historie',
    level: 'fehler',
    query: sql`select x.art || ' „' || x.name || '“ ohne Historie' as label
      from (select 'task' as typ, 'Aufgabe' as art, id, title as name from tasks
            union all select 'event', 'Veranstaltung', id, title from events
            union all select 'member', 'Mitglied', id, display_name from members where not is_system
            union all select 'topic', 'Thema', id, name from topics
            union all select 'appointment', 'Termin', id, title from appointments
            union all select 'decision', 'Eintrag', id, title from decisions
            union all select 'question', 'Frage', id, title from questions
            union all select 'document', 'Dokument', id, title from documents
            union all select 'partner', 'Partner', id, name from partners) x
      where not exists (select 1 from history h
        where h.entity_type = x.typ and h.entity_id = x.id and h.action like 'created%')
        -- Startbestand der Migration (Systemeintrag, Grundthemen) entsteht ohne Historie
        and not (x.typ = 'topic' and exists (select 1 from topics tp where tp.id = x.id and tp.created_by is null))`,
  },
  // ── Phase 4: Veranstaltungen ──
  {
    name: 'Keine deaktivierten Hauptverantwortlichen oder Kontaktpersonen',
    level: 'fehler',
    query: sql`select m.display_name || ' bei „' || x.name || '“ (' || x.rolle || ')' as label from (
        select l.member_id, e.title as name, 'hauptverantwortlich' as rolle from event_leads l join events e on e.id = l.event_id
        union all select p.internal_contact_member_id, p.name, 'Kontaktperson' from partners p where p.internal_contact_member_id is not null
      ) x join members m on m.id = x.member_id where not m.active`,
  },
  {
    // beim Umhängen fällt der Eintrag weg – eine Abweichung ist ein Fehler
    name: 'Aufgaben aus Vorlagen hängen an der Veranstaltung, für die sie angelegt wurden',
    level: 'fehler',
    query: sql`select ${task} || ' (Veranstaltung geändert)' as label
      from template_applications a join tasks t on t.id = a.task_id
      where t.event_id is distinct from a.event_id`,
  },
  {
    name: 'Detailbereiche passen zu ihrer Veranstaltung',
    level: 'fehler',
    query: sql`select e.title || ': Detailbereiche ohne passende Kennung' as label
      from event_details d join events e on e.id = d.event_id
      where d.data ->> 'event_id' is distinct from d.event_id::text`,
  },
  // ── Phase 2: Erinnerungen ──
  {
    name: 'Keine Nachricht wartet länger als 24 Stunden in der Outbox',
    level: 'fehler',
    query: sql`select case when count(*) = 1 then '1 Nachricht' else count(*) || ' Nachrichten' end || ', die älteste von ' || to_char(min(created_at) at time zone 'Europe/Berlin', 'DD.MM. HH24:MI') as label
      from notification_outbox where status = 'wartet' and created_at < now() - interval '24 hours' having count(*) > 0`,
  },
  {
    name: 'Erfolgreicher Joblauf in den letzten 2 Stunden',
    level: 'hinweis',
    query: sql`select coalesce('letzter Lauf ' || to_char(max(started_at) at time zone 'Europe/Berlin', 'DD.MM. HH24:MI'), 'noch kein Lauf') as label
      from job_runs where result = 'ok' having coalesce(max(started_at), '1970-01-01') < now() - interval '2 hours'`,
  },
  {
    name: 'Deaktivierte haben keine Push-Abos und keine Telegram-Verknüpfung',
    level: 'fehler',
    query: sql`select m.display_name || ' (' || x.kanal || ')' as label
      from (select member_id, 'Push' as kanal from push_subscriptions
            union all select member_id, 'Telegram' from telegram_links) x
      join members m on m.id = x.member_id where not m.active`,
  },
  {
    name: 'Abgelaufene Rückgängig-Einträge werden aufgeräumt',
    level: 'hinweis',
    query: sql`select count(*) || ' Einträge älter als einen Tag' as label from undo_actions
      where created_at < now() - interval '1 day' having count(*) > 0`,
  },
  // ── Phase 5: Drive ──
  {
    name: 'Drive-Cache in den letzten 8 Tagen vollständig neu eingelesen',
    level: 'hinweis',
    query: sql`select coalesce('zuletzt ' || to_char(s.last_full_sync_at at time zone 'Europe/Berlin', 'DD.MM. HH24:MI'), 'noch nie') as label
      from (select 1) x left join drive_sync_state s on true
      where coalesce(s.last_full_sync_at, '1970-01-01') < now() - interval '8 days'`,
  },
  {
    name: 'Verknüpfte Drive-Dateien und Ordner der Veranstaltungen sind im Drive vorhanden',
    level: 'hinweis',
    query: sql`with recursive live (file_id) as (
        select d.file_id from drive_items d join drive_sync_state s on s.root_folder_id = d.file_id where not d.trashed
        union
        select d.file_id from drive_items d join live l on d.parent_id = l.file_id where not d.trashed
      )
      select 'Dokument „' || title || '“' as label from documents
        where archived_at is null and drive_file_id is not null and drive_file_id not in (select file_id from live)
      union all
      select 'Ordner der Veranstaltung „' || title || '“' from events
        where archived_at is null and drive_folder_id is not null and drive_folder_id not in (select file_id from live)`,
  },
];

export interface IntegrityResult {
  check: IntegrityCheck;
  findings: string[];
}

/** alle Prüfungen in einer nur lesenden Transaktion */
export async function runChecks(db: Kysely<Database>): Promise<IntegrityResult[]> {
  return db.transaction().execute(async (trx) => {
    await sql`set transaction read only`.execute(trx);
    const results: IntegrityResult[] = [];
    for (const check of CHECKS) {
      const { rows } = await check.query.execute(trx);
      results.push({ check, findings: rows.map((r) => r.label).sort() });
    }
    return results;
  });
}

export function report(results: IntegrityResult[]): string {
  const lines = results.map(({ check, findings }) => {
    const mark = findings.length === 0 ? 'ok     ' : check.level === 'fehler' ? 'FEHLER ' : 'hinweis';
    return [`${mark} ${check.name}`, ...findings.slice(0, 20).map((f) => `          – ${f}`)].join('\n');
  });
  const errors = results.filter((r) => r.check.level === 'fehler' && r.findings.length > 0).length;
  lines.push('', errors === 0 ? 'Alles in Ordnung.' : `${errors} Prüfung(en) mit Fehlern.`);
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { database } = await import('../db/connection');
  const db = database();
  const results = await runChecks(db);
  await db.destroy();
  console.log(report(results));
  process.exitCode = results.some((r) => r.check.level === 'fehler' && r.findings.length > 0) ? 1 : 0;
}
