// Kern der Server-Funktionen (ANFORDERUNGEN 7.2): jede Aktion in einer Transaktion, handelnde Person immer aus der
// Sitzung, Historie in derselben Transaktion, Optimistic Locking, Rückgängig über gespeicherte Gegenschritte.
// Geschnitten wie die Testdaten-Schicht (src/data/mock/server.ts), nur gegen die Datenbank.
import { sql, type Kysely, type Transaction } from 'kysely';
import type { ZodType } from 'zod';
import { AppError, validationErrorFromZod } from '../../src/shared/errors';
import { countsForPlenum, PLENUM_DEFAULT_HOURS } from '../../src/shared/rules/plenum';
import { UNDO_WINDOW_MS } from '../../src/shared/rules/undo';
import type { HistoryChanges } from '../../src/shared/schema';
import type { Selectable } from 'kysely';
import type { Database, EventBookingsTable, HistoryTable, MemberRow, PlenumMarksTable } from '../db/types';

export type Trx = Transaction<Database>;
/** Datenbank oder Transaktion – für Lesen, das auch außerhalb einer Transaktion läuft (16.6) */
export type Db = Kysely<Database>;

/** Lesen ohne Transaktion: Abfragen laufen parallel über mehrere Verbindungen (16.6) */
export interface ReadCtx {
  trx: Db;
  actor: MemberRow;
  now: Date;
}
export type HistoryEntity = HistoryTable['entity_type'];

/** Gegenschritte einer Aktion für „Rückgängig“ – P1: Aufgaben und Veranstaltungen */
export type InverseOp =
  | {
      kind: 'task_state';
      task_id: string;
      status: string;
      block_reason: string | null;
      discard_reason: string | null;
      archived_at: string | null;
    }
  | { kind: 'assignee_remove'; task_id: string; member_id: string }
  | {
      kind: 'assignee_add';
      row: { task_id: string; member_id: string; assigned_by: string; assigned_at: string };
    }
  | { kind: 'follower_remove'; task_id: string; member_id: string }
  | { kind: 'follower_add'; task_id: string; member_id: string }
  | { kind: 'mark_restore'; row: Selectable<PlenumMarksTable> }
  | { kind: 'mark_remove'; decision_id: string }
  | { kind: 'blocker_remove'; task_id: string; blocker_task_id: string }
  | { kind: 'event_status'; event_id: string; status: string }
  // [P3]
  | { kind: 'rsvp_restore'; appointment_id: string; member_id: string; row: AppointmentRsvp | null }
  | {
      kind: 'appointment_state';
      appointment_id: string;
      status: string;
      attendees: { appointment_id: string; member_id: string }[];
    }
  | { kind: 'appointment_times'; appointment_id: string; starts_at: string; ends_at: string | null }
  | { kind: 'task_delete'; task_id: string }
  | { kind: 'task_fields'; task_id: string; due_date: string | null; origin_plenum_id: string | null }
  | { kind: 'decision_delete'; decision_id: string }
  // [P4]
  | { kind: 'booking_remove'; booking_id: string }
  | { kind: 'booking_restore'; row: Selectable<EventBookingsTable> }
  | { kind: 'lead_remove'; event_id: string; member_id: string }
  | { kind: 'lead_restore'; row: { event_id: string; member_id: string; added_by: string; added_at: string } }
  | { kind: 'event_partner_remove'; event_id: string; partner_id: string }
  | {
      kind: 'event_partner_restore';
      row: {
        event_id: string;
        partner_id: string;
        role_note: string | null;
        added_by: string;
        added_at: string;
      };
    }
  | { kind: 'decision_state'; decision_id: string; status: string; superseded_by_id: string | null }
  // [Phase 9] Löschen (Archivieren) zurücknehmen
  | {
      kind: 'archive_restore';
      table: 'events' | 'appointments' | 'decisions' | 'questions' | 'documents' | 'partners';
      id: string;
    }
  // [Umbau Phase 6] Stimme vor der Abstimmung – null: es gab noch keine
  | {
      kind: 'vote_restore';
      decision_id: string;
      member_id: string;
      row: {
        decision_id: string;
        member_id: string;
        vote: 'bestaetigt' | 'widerspruch';
        voted_at: string;
      } | null;
    }
  | {
      kind: 'question_state';
      question_id: string;
      status: string;
      answer: string | null;
      answered_in_plenum_id: string | null;
    };

type AppointmentRsvp = {
  appointment_id: string;
  member_id: string;
  answer: 'ja' | 'nein';
  answered_at: string;
};

export interface Ctx {
  trx: Trx;
  /** handelnde Person: immer die der Sitzung, nie eine mitgeschickte ID (7.2) */
  actor: MemberRow;
  now: Date;
  inverse: InverseOp[];
  historyIds: string[];
  /** [P2] Nachrichten dieser Aktion in der Outbox – „Rückgängig“ zieht noch wartende zurück */
  outbox: string[];
  /** [P3] Teilschritte einer zusammengesetzten Aktion legen keinen eigenen Rückgängig-Eintrag an */
  deferUndo?: boolean;
  /** laufendes Plenum, zu dem diese Änderung gehört (16.2) – sonst null */
  plenumId: string | null;
}

/** Antwort aus der App auf „Gehört das zum Plenum?“ (16.2) – der Server prüft selbst, ob dieses Plenum läuft */
export interface PlenumAnswer {
  plenumId: string;
  belongs: boolean;
}

export const iso = (ctx: Ctx) => ctx.now.toISOString();
export const rule = (message: string, field?: string) => new AppError('rule', message, { field });
export const notFound = (what: string) => new AppError('not_found', `${what} gibt es nicht mehr.`);
/** Phase 9: Gelöschtes (archiviert) lässt sich nicht mehr bearbeiten – nur über „Rückgängig“ zurückholen */
export const ARCHIVED = 'Gelöscht – das lässt sich nicht mehr ändern.';

export function parse<T>(schema: ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) throw validationErrorFromZod(result.error);
  return result.data;
}

export function requireAdmin(ctx: { actor: MemberRow }): void {
  if (!ctx.actor.is_admin) throw new AppError('forbidden', 'Das dürfen nur Personen mit Admin-Rechten.');
}

/**
 * Sperre für Regeln über viele Zeilen (Zyklen im Abhängigkeitsgraphen, Reihenfolge der Markierungen): gleichzeitige
 * Aktionen warten aufeinander bis zum Ende der Transaktion, statt beide auf demselben alten Stand zu prüfen.
 */
export async function lockFor(ctx: Ctx, name: 'task_blockers' | 'plenum_marks'): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtext(${name}))`.execute(ctx.trx);
}

export async function writeHistory(
  ctx: Ctx,
  entity_type: HistoryEntity,
  entity_id: string,
  action: string,
  changes: HistoryChanges = {},
): Promise<void> {
  await writeHistoryMany(ctx, entity_type, entity_id, action, [changes]);
}

/** Mehrere Einträge gleicher Art in einer Abfrage (16.6) – z. B. „Alle“ eintragen: je Person ein Eintrag */
export async function writeHistoryMany(
  ctx: Ctx,
  entity_type: HistoryEntity,
  entity_id: string,
  action: string,
  changesList: readonly HistoryChanges[],
): Promise<void> {
  if (changesList.length === 0) return;
  const at = iso(ctx);
  const rows = changesList.map((changes) => {
    const id = crypto.randomUUID();
    ctx.historyIds.push(id);
    // während des Plenums: die Änderung gehört zu seinem Ergebnis (16.2)
    const all: HistoryChanges = { ...changes };
    if (ctx.plenumId && !changes.plenum_id && countsForPlenum(entity_type, entity_id, action, ctx.plenumId))
      all.plenum_id = { old: null, new: ctx.plenumId };
    return {
      id,
      entity_type,
      entity_id,
      actor_member_id: ctx.actor.id,
      action,
      changes: JSON.stringify(all),
      created_at: at,
    };
  });
  await ctx.trx.insertInto('history').values(rows).execute();
}

/** Kein stilles Überschreiben (WF-ALL-01): wer mit alter version speichert, bekommt einen Konflikt mit Namen. */
export async function checkVersion(
  ctx: Ctx,
  entity_type: HistoryEntity,
  row: { id: string; version: number },
  version: number,
): Promise<void> {
  if (row.version === version) return;
  const last = await ctx.trx
    .selectFrom('history')
    .leftJoin('members', 'members.id', 'history.actor_member_id')
    .select(['history.created_at', 'members.display_name'])
    .where('history.entity_type', '=', entity_type)
    .where('history.entity_id', '=', row.id)
    .orderBy('history.created_at', 'desc')
    .orderBy('history.seq', 'desc')
    .limit(1)
    .executeTakeFirst();
  const name = last?.display_name ?? null;
  throw new AppError('conflict', `Wurde inzwischen von ${name ?? 'jemand anderem'} geändert.`, {
    conflict: { changed_by_name: name, changed_at: last?.created_at ?? null },
  });
}

/** Das UPDATE mit „where version = …“ hat genau eine Zeile getroffen – sonst war jemand schneller (Konflikt). */
export async function updatedOne(
  ctx: Ctx,
  result: { numUpdatedRows: bigint },
  entity_type: HistoryEntity,
  row: { id: string; version: number },
): Promise<void> {
  if (Number(result.numUpdatedRows) !== 1)
    await checkVersion(ctx, entity_type, { id: row.id, version: -1 }, row.version);
}

export interface Undoable {
  undo_token: string;
}

/** Merkt die Gegenschritte dieser Aktion; „Rückgängig“ ist 30 Sekunden lang möglich (WF-ALL-02). */
export async function registerUndo(
  ctx: Ctx,
  entity_type: string,
  entity: { id: string; version: number },
  label: string,
): Promise<Undoable> {
  // eine zusammengesetzte Aktion (z. B. im Plenum) legt am Ende genau einen Eintrag für alles an
  if (ctx.inverse.length === 0 || ctx.deferUndo) return { undo_token: '' };
  const cutoff = new Date(ctx.now.getTime() - UNDO_WINDOW_MS).toISOString();
  const token = crypto.randomUUID();
  // Abgelaufenes aufräumen und neu eintragen in einer Rundreise (16.6)
  await ctx.trx
    .with('expired', (db) => db.deleteFrom('undo_actions').where('created_at', '<', cutoff))
    .insertInto('undo_actions')
    .values({
      token,
      actor_id: ctx.actor.id,
      created_at: iso(ctx),
      entity_type,
      entity_id: entity.id,
      version_after: entity.version,
      label,
      ops: JSON.stringify(ctx.inverse),
      history_ids: JSON.stringify(ctx.historyIds),
      outbox_ids: JSON.stringify(ctx.outbox),
    })
    .execute();
  return { undo_token: token };
}

/**
 * Eine Aktion als Transaktion: entweder alle Änderungen samt Historie oder keine.
 * Die handelnde Person kommt aus dem Login (auth_user_id) und muss ein aktives Mitglied sein.
 */
export async function inTransaction<T>(
  db: Kysely<Database>,
  authUserId: string | null,
  now: Date,
  fn: (ctx: Ctx) => Promise<T>,
  answer: PlenumAnswer | null = null,
  /** Profil und Verwaltung: gehört nie zum Plenum (F1) */
  outsidePlenum = false,
): Promise<T> {
  // Deadlock oder Serialisierungsfehler bei gleichzeitigen Aktionen: die Transaktion ist zurückgerollt, einmal neu
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.transaction().execute(async (trx) => {
        const { actor, plenum } = await actorAndPlenum(trx, authUserId, now);
        // läuft ein Plenum, gehört die Änderung dazu: auf der Teilnehmerliste immer, sonst nach Antwort (16.2)
        const belongs =
          !!plenum && (plenum.participant || (answer?.plenumId === plenum.id && answer.belongs));
        const plenumId = belongs && !outsidePlenum ? plenum.id : null;
        return fn({ trx, actor, now, inverse: [], historyIds: [], outbox: [], plenumId });
      });
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (attempt < 3 && (code === '40P01' || code === '40001')) continue;
      // Eindeutigkeit (Kürzel, Mail, Themenname), die eine gleichzeitige Aktion gerade vergeben hat
      if (code === '23505')
        throw new AppError(
          'conflict',
          'Das hat gerade jemand anderes angelegt. Bitte lade neu und prüf die Angaben.',
        );
      throw e;
    }
  }
}

/** Mitglied zu einem Login: über die Hauptadresse oder eine weitere Adresse (member_emails) verknüpft */
export async function memberForLogin(
  trx: Trx | Kysely<Database>,
  authUserId: string,
  lock = false,
): Promise<MemberRow | undefined> {
  return memberQuery(trx, authUserId, lock).executeTakeFirst();
}

function memberQuery(trx: Trx | Kysely<Database>, authUserId: string, lock: boolean) {
  return trx
    .selectFrom('members')
    .selectAll()
    .where((eb) =>
      eb.or([
        eb('auth_user_id', '=', authUserId),
        eb(
          'id',
          'in',
          eb.selectFrom('member_emails').select('member_id').where('auth_user_id', '=', authUserId),
        ),
      ]),
    )
    .where('is_system', '=', false)
    .$if(lock, (q) => q.forShare());
}

/**
 * Laufendes Plenum (16.2) als Unterabfrage zur Person: id und ob sie auf der Teilnehmerliste steht (Zusage „ja“
 * oder anwesend). Ohne Ende gilt Beginn + 3 Stunden; abgeschlossene und abgesagte laufen nicht.
 */
const runningPlenumSql = (now: Date) => sql<{ id: string; participant: boolean } | null>`(
  select json_build_object(
    'id', a.id,
    'participant',
      exists (select 1 from appointment_rsvps r
              where r.appointment_id = a.id and r.member_id = members.id and r.answer = 'ja')
      or exists (select 1 from appointment_attendees x
                 where x.appointment_id = a.id and x.member_id = members.id))
  from appointments a join appointment_types t on t.id = a.type_id
  where t.has_plenum_features and a.archived_at is null and a.status in ('geplant', 'stattgefunden')
    and a.starts_at <= ${now.toISOString()}::timestamptz
    and coalesce(a.ends_at, a.starts_at + make_interval(hours => ${PLENUM_DEFAULT_HOURS}))
        >= ${now.toISOString()}::timestamptz
  order by a.starts_at desc
  limit 1)`;

/** Handelnde Person für eine Schreibaktion samt laufendem Plenum – in einer Rundreise (16.6) */
async function actorAndPlenum(
  trx: Trx,
  authUserId: string | null,
  now: Date,
): Promise<{ actor: MemberRow; plenum: { id: string; participant: boolean } | null }> {
  if (!authUserId)
    throw new AppError('unauthenticated', 'Du bist nicht mehr angemeldet. Bitte melde dich neu an.');
  // eine gleichzeitige Deaktivierung wartet, bis diese Aktion fertig ist (und räumt danach auf)
  const row = await memberQuery(trx, authUserId, true)
    .select(runningPlenumSql(now).as('running_plenum'))
    .executeTakeFirst();
  if (!row || !row.active)
    throw new AppError('unauthenticated', 'Du bist nicht mehr angemeldet. Bitte melde dich neu an.');
  const { running_plenum, ...actor } = row;
  return { actor, plenum: running_plenum };
}

export async function resolveActor(
  trx: Trx | Kysely<Database>,
  authUserId: string | null,
  { lock = false }: { lock?: boolean } = {},
): Promise<MemberRow> {
  if (!authUserId)
    throw new AppError('unauthenticated', 'Du bist nicht mehr angemeldet. Bitte melde dich neu an.');
  // beim Schreiben: eine gleichzeitige Deaktivierung wartet, bis diese Aktion fertig ist (und räumt danach auf)
  const actor = await memberForLogin(trx, authUserId, lock);
  if (!actor || !actor.active)
    throw new AppError('unauthenticated', 'Du bist nicht mehr angemeldet. Bitte melde dich neu an.');
  return actor;
}
