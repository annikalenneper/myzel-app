// Rückgängig (WF-ALL-02), Phase 1: die gespeicherten Gegenschritte einer Aktion, 30 Sekunden lang, nur für die
// Person, die gehandelt hat; ebenfalls in der Historie. Hat die Aktion die Zeile selbst geändert, darf inzwischen
// niemand anderes daran gewesen sein (Optimistic Locking wie überall).
import { UNDO_WINDOW_MS } from '../../src/shared/rules/undo';
import { checkVersion, iso, notFound, rule, writeHistory, type Ctx, type InverseOp } from '../core/context';

const ROW_KINDS = new Set<InverseOp['kind']>([
  'task_state',
  'assignee_add',
  'assignee_remove',
  'event_status',
]);

export async function undo(ctx: Ctx, token: string): Promise<void> {
  const record = await ctx.trx
    .selectFrom('undo_actions')
    .selectAll()
    .where('token', '=', token)
    .forUpdate()
    .executeTakeFirst();
  const expired = record && ctx.now.getTime() - new Date(record.created_at).getTime() > UNDO_WINDOW_MS;
  if (!record || expired || record.actor_id !== ctx.actor.id)
    throw rule('Das lässt sich nicht mehr rückgängig machen.');
  await ctx.trx.deleteFrom('undo_actions').where('token', '=', token).execute();

  const table = record.entity_type === 'task' ? 'tasks' : record.entity_type === 'event' ? 'events' : null;
  if (!table) throw rule('Das lässt sich nicht mehr rückgängig machen.');
  const entity = await ctx.trx
    .selectFrom(table)
    .select(['id', 'version'])
    .where('id', '=', record.entity_id)
    .forUpdate()
    .executeTakeFirst();
  if (!entity) throw notFound('Dieser Eintrag');
  const ops = record.ops as InverseOp[];
  const touchesRow = ops.some((op) => ROW_KINDS.has(op.kind));
  if (touchesRow)
    await checkVersion(ctx, record.entity_type as 'task' | 'event', entity, record.version_after);

  for (const op of ops) {
    switch (op.kind) {
      case 'task_state':
        await ctx.trx
          .updateTable('tasks')
          .set({
            status: op.status as never,
            block_reason: op.block_reason,
            discard_reason: op.discard_reason,
            archived_at: op.archived_at,
          })
          .where('id', '=', op.task_id)
          .execute();
        break;
      case 'assignee_remove':
        await ctx.trx
          .deleteFrom('task_assignees')
          .where('task_id', '=', op.task_id)
          .where('member_id', '=', op.member_id)
          .execute();
        break;
      case 'assignee_add': {
        // wer inzwischen deaktiviert ist, kommt nicht zurück
        const active = await ctx.trx
          .selectFrom('members')
          .select('id')
          .where('id', '=', op.row.member_id)
          .where('active', '=', true)
          .executeTakeFirst();
        if (active)
          await ctx.trx
            .insertInto('task_assignees')
            .values(op.row)
            .onConflict((oc) => oc.doNothing())
            .execute();
        break;
      }
      case 'follower_remove':
        await ctx.trx
          .deleteFrom('task_followers')
          .where('task_id', '=', op.task_id)
          .where('member_id', '=', op.member_id)
          .execute();
        break;
      case 'follower_add': {
        const active = await ctx.trx
          .selectFrom('members')
          .select('id')
          .where('id', '=', op.member_id)
          .where('active', '=', true)
          .executeTakeFirst();
        if (active)
          await ctx.trx
            .insertInto('task_followers')
            .values({ task_id: op.task_id, member_id: op.member_id })
            .onConflict((oc) => oc.doNothing())
            .execute();
        break;
      }
      case 'mark_restore':
        // der Punkt steht wieder an alter Stelle
        await ctx.trx
          .insertInto('plenum_marks')
          .values(op.row)
          .onConflict((oc) => oc.doNothing())
          .execute();
        break;
      case 'mark_remove':
        await ctx.trx.deleteFrom('plenum_marks').where('task_id', '=', op.id).execute();
        break;
      case 'blocker_remove':
        await ctx.trx
          .deleteFrom('task_blockers')
          .where('task_id', '=', op.task_id)
          .where('blocker_task_id', '=', op.blocker_task_id)
          .execute();
        break;
      case 'event_status':
        await ctx.trx
          .updateTable('events')
          .set({ status: op.status as never })
          .where('id', '=', op.event_id)
          .execute();
        break;
    }
  }
  if (touchesRow)
    await ctx.trx
      .updateTable(table)
      .set({ version: entity.version + 1, updated_at: iso(ctx) })
      .where('id', '=', entity.id)
      .execute();
  await writeHistory(ctx, record.entity_type as 'task' | 'event', entity.id, 'undo', {
    undone: { old: record.label, new: null },
    history_ids: { old: record.history_ids, new: null },
  });
}
