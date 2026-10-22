// Markierung „Fürs Plenum“ (3.14): eine gemeinsame Agenda über alle Arten, sortiert nach position.
// Neu Markiertes kommt ans Ende; Statusänderungen und Archivieren entfernen die Markierung (mit Gegenschritt).
import { isFinalEventStatus } from '../../src/shared/rules/eventStatus';
import { isActiveTaskStatus } from '../../src/shared/rules/taskStatus';
import type { HistoryChanges } from '../../src/shared/schema';
import { iso, lockFor, type Ctx, type Trx } from './context';

/** Arten, die der Server markieren kann */
export type ServerMarkTarget =
  'task' | 'question' | 'decision' | 'event' | 'appointment' | 'document' | 'partner';
export const SERVER_MARK_TARGETS: readonly ServerMarkTarget[] = [
  'task',
  'question',
  'decision',
  'event',
  'appointment',
  'document',
  'partner',
];
export const markColumn = <T extends ServerMarkTarget>(target: T) => `${target}_id` as `${T}_id`;

export async function isMarked(trx: Trx, target: ServerMarkTarget, id: string): Promise<boolean> {
  return !!(await trx
    .selectFrom('plenum_marks')
    .select('id')
    .where(markColumn(target), '=', id)
    .executeTakeFirst());
}

/** Statusänderungen und Archivieren entfernen die Markierung „Fürs Plenum“ (3.14). */
export async function dropMark(
  ctx: Ctx,
  target: ServerMarkTarget,
  id: string,
  changes: HistoryChanges,
): Promise<boolean> {
  const mark = await ctx.trx
    .deleteFrom('plenum_marks')
    .where(markColumn(target), '=', id)
    .returningAll()
    .executeTakeFirst();
  if (!mark) return false;
  ctx.inverse.push({ kind: 'mark_restore', row: mark });
  changes.plenum_mark = { old: true, new: false };
  return true;
}

/** Neu Markiertes kommt ans Ende der Agenda. */
export async function addMark(ctx: Ctx, target: ServerMarkTarget, id: string): Promise<void> {
  await lockFor(ctx, 'plenum_marks');
  const max = await ctx.trx
    .selectFrom('plenum_marks')
    .select(ctx.trx.fn.max('position').as('max'))
    .executeTakeFirst();
  await ctx.trx
    .insertInto('plenum_marks')
    .values({
      [markColumn(target)]: id,
      position: Number(max?.max ?? 0) + 1,
      marked_by: ctx.actor.id,
      marked_at: iso(ctx),
    })
    .execute();
  ctx.inverse.push({ kind: 'mark_remove', target, id });
}

/** Darf das Objekt jetzt (wieder) auf der Agenda stehen? Für das Rückgängig einer entfernten Markierung. */
export async function markable(trx: Trx, target: ServerMarkTarget, id: string): Promise<boolean> {
  switch (target) {
    case 'task': {
      const t = await trx
        .selectFrom('tasks')
        .select(['status', 'archived_at'])
        .where('id', '=', id)
        .executeTakeFirst();
      return !!t && !t.archived_at && isActiveTaskStatus(t.status);
    }
    case 'question': {
      const q = await trx
        .selectFrom('questions')
        .select(['status', 'archived_at'])
        .where('id', '=', id)
        .executeTakeFirst();
      return !!q && !q.archived_at && q.status === 'offen';
    }
    case 'decision': {
      const d = await trx
        .selectFrom('decisions')
        .select(['status', 'archived_at'])
        .where('id', '=', id)
        .executeTakeFirst();
      return !!d && !d.archived_at && d.status === 'gueltig';
    }
    case 'event': {
      const e = await trx
        .selectFrom('events')
        .select(['status', 'archived_at'])
        .where('id', '=', id)
        .executeTakeFirst();
      return !!e && !e.archived_at && !isFinalEventStatus(e.status);
    }
    case 'appointment': {
      const a = await trx
        .selectFrom('appointments as a')
        .innerJoin('appointment_types as t', 't.id', 'a.type_id')
        .select(['a.status', 'a.archived_at', 't.has_plenum_features'])
        .where('a.id', '=', id)
        .executeTakeFirst();
      return !!a && !a.archived_at && a.status === 'geplant' && !a.has_plenum_features;
    }
    case 'document': {
      const d = await trx
        .selectFrom('documents')
        .select('archived_at')
        .where('id', '=', id)
        .executeTakeFirst();
      return !!d && !d.archived_at;
    }
    case 'partner': {
      const p = await trx
        .selectFrom('partners')
        .select('archived_at')
        .where('id', '=', id)
        .executeTakeFirst();
      return !!p && !p.archived_at;
    }
  }
}

/** Welche Art eine Markierung hat */
export const markTarget = (row: Record<`${ServerMarkTarget}_id`, string | null>): ServerMarkTarget =>
  SERVER_MARK_TARGETS.find((t) => row[markColumn(t)])!;
