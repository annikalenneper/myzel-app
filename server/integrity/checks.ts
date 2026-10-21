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
  {
    name: 'Markierung „Fürs Plenum“ nur an aktiven Aufgaben',
    level: 'fehler',
    query: sql`select ${task} || ' (' || t.status || ')' as label
      from plenum_marks pm join tasks t on t.id = pm.task_id
      where t.archived_at is not null or t.status not in (${active})`,
  },
  {
    name: 'Jede Aufgabe, Veranstaltung, jedes Mitglied und Thema hat ihren Eintrag „angelegt“ in der Historie',
    level: 'fehler',
    query: sql`select x.art || ' „' || x.name || '“ ohne Historie' as label
      from (select 'task' as typ, 'Aufgabe' as art, id, title as name from tasks
            union all select 'event', 'Veranstaltung', id, title from events
            union all select 'member', 'Mitglied', id, display_name from members where not is_system
            union all select 'topic', 'Thema', id, name from topics) x
      where not exists (select 1 from history h
        where h.entity_type = x.typ and h.entity_id = x.id and h.action = 'created')
        -- Startbestand der Migration (Systemeintrag, Grundthemen) entsteht ohne Historie
        and not (x.typ = 'topic' and exists (select 1 from topics tp where tp.id = x.id and tp.created_by is null))`,
  },
  {
    name: 'Abgelaufene Rückgängig-Einträge werden aufgeräumt',
    level: 'hinweis',
    query: sql`select count(*) || ' Einträge älter als einen Tag' as label from undo_actions
      where created_at < now() - interval '1 day' having count(*) > 0`,
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
