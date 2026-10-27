// Entscheidung oder Fakt ausdrücklich auf der Agenda (16.1): „Stimmt das noch?“. Neu Aufgesetztes kommt ans Ende;
// Ersetzen und Aufheben nehmen den Eintrag herunter (mit Gegenschritt).
import { decisionActive } from '../../src/shared/rules/knowledge';
import type { MarkReason } from '../../src/shared/schema';
import { iso, lockFor, type Ctx, type Db } from './context';

export async function isMarked(trx: Db, decisionId: string): Promise<boolean> {
  return !!(await trx
    .selectFrom('plenum_marks')
    .select('id')
    .where('decision_id', '=', decisionId)
    .executeTakeFirst());
}

/** Ersetzen und Aufheben nehmen den Eintrag von der Agenda. */
export async function dropMark(ctx: Ctx, decisionId: string): Promise<boolean> {
  const mark = await ctx.trx
    .deleteFrom('plenum_marks')
    .where('decision_id', '=', decisionId)
    .returningAll()
    .executeTakeFirst();
  if (!mark) return false;
  ctx.inverse.push({ kind: 'mark_restore', row: mark });
  return true;
}

/** Neu Aufgesetztes kommt ans Ende der Agenda. */
export async function addMark(
  ctx: Ctx,
  decisionId: string,
  reason: MarkReason = 'stimmt_noch',
): Promise<void> {
  await lockFor(ctx, 'plenum_marks');
  const max = await ctx.trx
    .selectFrom('plenum_marks')
    .select(ctx.trx.fn.max('position').as('max'))
    .executeTakeFirst();
  await ctx.trx
    .insertInto('plenum_marks')
    .values({
      decision_id: decisionId,
      reason,
      position: Number(max?.max ?? 0) + 1,
      marked_by: ctx.actor.id,
      marked_at: iso(ctx),
    })
    .execute();
  ctx.inverse.push({ kind: 'mark_remove', decision_id: decisionId });
}

/** Darf der Eintrag jetzt (wieder) auf der Agenda stehen? Für das Rückgängig einer entfernten Markierung. */
export async function markable(trx: Db, decisionId: string): Promise<boolean> {
  const d = await trx
    .selectFrom('decisions')
    .select(['status', 'archived_at'])
    .where('id', '=', decisionId)
    .executeTakeFirst();
  return !!d && !d.archived_at && decisionActive(d.status);
}
