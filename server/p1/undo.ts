// Rückgängig (WF-ALL-02), Phase 1: die gespeicherten Gegenschritte einer Aktion, 30 Sekunden lang, nur für die
// Person, die gehandelt hat; ebenfalls in der Historie. Hat die Aktion die Zeile selbst geändert, darf inzwischen
// niemand anderes daran gewesen sein (Optimistic Locking wie überall).
import { isActiveTaskStatus } from '../../src/shared/rules/taskStatus';
import { UNDO_WINDOW_MS } from '../../src/shared/rules/undo';
import {
  checkVersion,
  iso,
  lockFor,
  notFound,
  rule,
  writeHistory,
  type Ctx,
  type InverseOp,
} from '../core/context';
import type { HistoryChanges } from '../../src/shared/schema';
import { topicStillActive } from './tasks';

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

  // was das Rückgängig zurücksetzt, steht als alt → neu in der Historie (3.10)
  const changes: HistoryChanges = {};
  for (const op of ops) {
    switch (op.kind) {
      case 'task_state': {
        const before = await ctx.trx
          .selectFrom('tasks')
          .select(['status', 'block_reason', 'discard_reason', 'archived_at'])
          .where('id', '=', op.task_id)
          .executeTakeFirstOrThrow();
        for (const key of ['status', 'block_reason', 'discard_reason', 'archived_at'] as const)
          if (before[key] !== op[key]) changes[key] = { old: before[key], new: op[key] };
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
      }
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
          // gleichzeitiges Deaktivieren wartet und räumt danach auch diesen Eintrag auf
          .forShare()
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
          // gleichzeitiges Deaktivieren wartet und räumt danach auch diesen Eintrag auf
          .forShare()
          .executeTakeFirst();
        if (active)
          await ctx.trx
            .insertInto('task_followers')
            .values({ task_id: op.task_id, member_id: op.member_id })
            .onConflict((oc) => oc.doNothing())
            .execute();
        break;
      }
      case 'mark_restore': {
        // nur an einer Aufgabe, die (nach den Gegenschritten davor) aktiv ist – sonst bleibt sie unmarkiert
        const task = await ctx.trx
          .selectFrom('tasks')
          .select(['status', 'archived_at'])
          .where('id', '=', op.row.task_id!)
          .executeTakeFirst();
        if (!task || task.archived_at || !isActiveTaskStatus(task.status)) break;
        // der Punkt steht wieder an alter Stelle – ist sie inzwischen vergeben, am Ende
        await lockFor(ctx, 'plenum_marks');
        const taken = await ctx.trx
          .selectFrom('plenum_marks')
          .select('id')
          .where('position', '=', op.row.position)
          .executeTakeFirst();
        const last = await ctx.trx
          .selectFrom('plenum_marks')
          .select(ctx.trx.fn.max('position').as('max'))
          .executeTakeFirst();
        const position = taken ? Number(last?.max ?? 0) + 1 : op.row.position;
        await ctx.trx
          .insertInto('plenum_marks')
          .values({ ...op.row, position })
          .onConflict((oc) => oc.doNothing())
          .execute();
        break;
      }
      case 'mark_remove':
        // nur die Markierung dieser Aktion – eine inzwischen von jemand anderem gesetzte bleibt
        await ctx.trx
          .deleteFrom('plenum_marks')
          .where('task_id', '=', op.id)
          .where('marked_by', '=', record.actor_id)
          .where('marked_at', '=', record.created_at)
          .execute();
        break;
      case 'blocker_remove':
        await ctx.trx
          .deleteFrom('task_blockers')
          .where('task_id', '=', op.task_id)
          .where('blocker_task_id', '=', op.blocker_task_id)
          .execute();
        break;
      case 'event_status': {
        const before = await ctx.trx
          .selectFrom('events')
          .select('status')
          .where('id', '=', op.event_id)
          .executeTakeFirstOrThrow();
        if (before.status !== op.status) changes.status = { old: before.status, new: op.status };
        await ctx.trx
          .updateTable('events')
          .set({ status: op.status as never })
          .where('id', '=', op.event_id)
          .execute();
        break;
      }
    }
  }
  // Nachrichten der zurückgenommenen Aktion, die noch nicht raus sind, werden nicht mehr verschickt
  const outboxIds = record.outbox_ids as string[];
  if (outboxIds.length > 0)
    await ctx.trx
      .deleteFrom('notification_outbox')
      .where('id', 'in', outboxIds)
      .where('status', '=', 'wartet')
      .execute();
  if (table === 'tasks')
    await taskStillValid(
      ctx,
      entity.id,
      ops.some((op) => op.kind === 'task_state' && op.status === 'in_arbeit'),
    );
  if (touchesRow)
    await ctx.trx
      .updateTable(table)
      .set({ version: entity.version + 1, updated_at: iso(ctx) })
      .where('id', '=', entity.id)
      .execute();
  await writeHistory(ctx, record.entity_type as 'task' | 'event', entity.id, 'undo', {
    ...changes,
    undone: { old: record.label, new: null },
    history_ids: { old: record.history_ids, new: null },
  });
}

/** Pflichtregeln nach den Gegenschritten (4.1): sonst bricht das Rückgängig ab und nichts ändert sich */
async function taskStillValid(ctx: Ctx, taskId: string, restoresInArbeit: boolean): Promise<void> {
  const task = await ctx.trx
    .selectFrom('tasks')
    .select(['status', 'archived_at', 'topic_id'])
    .where('id', '=', taskId)
    .executeTakeFirstOrThrow();
  if (task.archived_at || !isActiveTaskStatus(task.status)) return;
  await topicStillActive(ctx, task);
  // „In Arbeit“ ohne Bearbeitende ist sonst erlaubt (z. B. aus dem Plenum) – nur nicht als Ergebnis des Rückgängig
  if (!restoresInArbeit || task.status !== 'in_arbeit') return;
  const assignee = await ctx.trx
    .selectFrom('task_assignees')
    .select('member_id')
    .where('task_id', '=', taskId)
    .executeTakeFirst();
  if (!assignee)
    throw rule('Die Person ist inzwischen nicht mehr aktiv – das lässt sich nicht mehr rückgängig machen.');
}
