// Kern der Server-Funktionen (ANFORDERUNGEN 7.2): jede Aktion in einer Transaktion, handelnde Person immer aus der
// Sitzung, Historie in derselben Transaktion, Optimistic Locking, Rückgängig über gespeicherte Gegenschritte.
// Geschnitten wie die Testdaten-Schicht (src/data/mock/server.ts), nur gegen die Datenbank.
import type { Kysely, Transaction } from 'kysely';
import type { ZodType } from 'zod';
import { AppError, validationErrorFromZod } from '../../src/shared/errors';
import { UNDO_WINDOW_MS } from '../../src/shared/rules/undo';
import type { HistoryChanges } from '../../src/shared/schema';
import type { Database, HistoryTable, MemberRow } from '../db/types';

export type Trx = Transaction<Database>;
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
  | {
      kind: 'mark_restore';
      row: {
        id: string;
        task_id: string | null;
        position: number;
        note: string | null;
        marked_by: string;
        marked_at: string;
      };
    }
  | { kind: 'mark_remove'; target: 'task'; id: string }
  | { kind: 'blocker_remove'; task_id: string; blocker_task_id: string }
  | { kind: 'event_status'; event_id: string; status: string };

export interface Ctx {
  trx: Trx;
  /** handelnde Person: immer die der Sitzung, nie eine mitgeschickte ID (7.2) */
  actor: MemberRow;
  now: Date;
  inverse: InverseOp[];
  historyIds: string[];
}

export const iso = (ctx: Ctx) => ctx.now.toISOString();
export const rule = (message: string, field?: string) => new AppError('rule', message, { field });
export const notFound = (what: string) => new AppError('not_found', `${what} gibt es nicht mehr.`);

export function parse<T>(schema: ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) throw validationErrorFromZod(result.error);
  return result.data;
}

export function requireAdmin(ctx: Ctx): void {
  if (!ctx.actor.is_admin) throw new AppError('forbidden', 'Das dürfen nur Personen mit Admin-Rechten.');
}

export async function writeHistory(
  ctx: Ctx,
  entity_type: HistoryEntity,
  entity_id: string,
  action: string,
  changes: HistoryChanges = {},
): Promise<void> {
  const id = crypto.randomUUID();
  ctx.historyIds.push(id);
  await ctx.trx
    .insertInto('history')
    .values({
      id,
      entity_type,
      entity_id,
      actor_member_id: ctx.actor.id,
      action,
      changes: JSON.stringify(changes),
      created_at: iso(ctx),
    })
    .execute();
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
  if (ctx.inverse.length === 0) return { undo_token: '' };
  const cutoff = new Date(ctx.now.getTime() - UNDO_WINDOW_MS).toISOString();
  await ctx.trx.deleteFrom('undo_actions').where('created_at', '<', cutoff).execute();
  const token = crypto.randomUUID();
  await ctx.trx
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
): Promise<T> {
  return db.transaction().execute(async (trx) => {
    const actor = await resolveActor(trx, authUserId);
    return fn({ trx, actor, now, inverse: [], historyIds: [] });
  });
}

export async function resolveActor(
  trx: Trx | Kysely<Database>,
  authUserId: string | null,
): Promise<MemberRow> {
  if (!authUserId)
    throw new AppError('unauthenticated', 'Du bist nicht mehr angemeldet. Bitte melde dich neu an.');
  const actor = await trx
    .selectFrom('members')
    .selectAll()
    .where('auth_user_id', '=', authUserId)
    .where('is_system', '=', false)
    .executeTakeFirst();
  if (!actor || !actor.active)
    throw new AppError('unauthenticated', 'Du bist nicht mehr angemeldet. Bitte melde dich neu an.');
  return actor;
}
