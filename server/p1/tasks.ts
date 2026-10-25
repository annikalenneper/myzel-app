// Aufgaben, Phase 1 (F-AUF-01 bis -07, -09; WF-AUF-02 bis -14): dieselben Regeln wie die Testdaten-Schicht
// (src/data/mock/server.ts), gegen die Datenbank. Die Zeile der Aufgabe wird für die Dauer der Transaktion
// gesperrt (FOR UPDATE), Listen werden eintragsweise geändert, die Historie steht in derselben Transaktion.
// Benachrichtigungen kommen mit Phase 2.
import { sql } from 'kysely';
import { AppError } from '../../src/shared/errors';
import { TASK_STATUS_LABEL } from '../../src/shared/labels';
import { wouldCreateBlockerCycle } from '../../src/shared/rules/blockers';
import {
  assignmentMessages,
  commentMessages,
  statusMessages,
  unblockedMessages,
} from '../../src/shared/rules/notifications';
import {
  BLOCK_REASON_MISSING,
  blockReasonMissing,
  LAST_BLOCKER,
  canTransitionTask,
  isActiveTaskStatus,
  statusAfterLastAssigneeLeft,
} from '../../src/shared/rules/taskStatus';
import {
  commentBodySchema,
  taskCreateSchema,
  taskDescriptionSchema,
  taskFieldsSchema,
  taskStatusChangeSchema,
  type HistoryChanges,
} from '../../src/shared/schema';
import {
  checkVersion,
  lockFor,
  updatedOne,
  iso,
  notFound,
  parse,
  registerUndo,
  rule,
  writeHistory,
  type Ctx,
  type Undoable,
} from '../core/context';
import type { TaskRow } from '../db/types';
import * as marks from '../core/marks';
import { notify } from '../p2/notify';

export async function findTask(ctx: Ctx, id: string, { lock = true } = {}): Promise<TaskRow> {
  let q = ctx.trx.selectFrom('tasks').selectAll().where('id', '=', id);
  if (lock) q = q.forUpdate();
  const task = await q.executeTakeFirst();
  if (!task) throw notFound('Diese Aufgabe');
  return task;
}

async function editableTask(ctx: Ctx, id: string): Promise<TaskRow> {
  const task = await findTask(ctx, id);
  if (task.archived_at)
    throw rule('Archivierte Aufgaben lassen sich nicht ändern. Stell sie erst wieder her.');
  return task;
}

/**
 * Aufgabe sperren und in derselben Rundreise mitlesen, wer bearbeitet und folgt und ob sie Abhängigkeiten hat –
 * jede Abfrage kostet zwischen Function und Datenbank rund 87 ms (16.6).
 */
async function editableTaskWithPeople(
  ctx: Ctx,
  id: string,
): Promise<{ task: TaskRow; assignees: string[]; followers: string[]; hasBlockers: boolean }> {
  const row = await ctx.trx
    .selectFrom('tasks')
    .selectAll('tasks')
    .select([
      sql<
        string[]
      >`coalesce((select array_agg(a.member_id::text) from task_assignees a where a.task_id = tasks.id), '{}')`.as(
        'people_assignees',
      ),
      sql<
        string[]
      >`coalesce((select array_agg(f.member_id::text) from task_followers f where f.task_id = tasks.id), '{}')`.as(
        'people_followers',
      ),
      sql<boolean>`exists (select 1 from task_blockers b where b.task_id = tasks.id)`.as(
        'people_has_blockers',
      ),
    ])
    .where('id', '=', id)
    .forUpdate()
    .executeTakeFirst();
  if (!row) throw notFound('Diese Aufgabe');
  const { people_assignees, people_followers, people_has_blockers, ...task } = row;
  if (task.archived_at)
    throw rule('Archivierte Aufgaben lassen sich nicht ändern. Stell sie erst wieder her.');
  return { task, assignees: people_assignees, followers: people_followers, hasBlockers: people_has_blockers };
}

async function usableTopic(ctx: Ctx, id: string): Promise<void> {
  const topic = await ctx.trx
    .selectFrom('topics')
    .select(['archived_at'])
    .where('id', '=', id)
    // gleichzeitiges Archivieren des Themas wartet (archiveTopic sperrt die Zeile)
    .forShare()
    .executeTakeFirst();
  if (!topic) throw new AppError('validation', 'Dieses Thema gibt es nicht mehr.', { field: 'topic_id' });
  if (topic.archived_at)
    throw new AppError('validation', 'Dieses Thema ist archiviert.', { field: 'topic_id' });
}

/** Wieder aktiv nur in einem aktiven Thema – sonst stünde eine offene Aufgabe in einem archivierten (WF-ADM-05) */
export async function topicStillActive(ctx: Ctx, task: { topic_id: string }): Promise<void> {
  const topic = await ctx.trx
    .selectFrom('topics')
    .select(['name', 'archived_at'])
    .where('id', '=', task.topic_id)
    .forShare()
    .executeTakeFirstOrThrow();
  if (topic.archived_at)
    throw rule(
      `Das Thema „${topic.name}“ ist archiviert. Stell es erst wieder her oder wähle ein anderes Thema.`,
    );
}

async function usableEvent(ctx: Ctx, id: string): Promise<void> {
  const event = await ctx.trx
    .selectFrom('events')
    .select('id')
    .where('id', '=', id)
    .where('archived_at', 'is', null)
    .executeTakeFirst();
  if (!event)
    throw new AppError('validation', 'Diese Veranstaltung gibt es nicht mehr.', { field: 'event_id' });
}

async function usableAppointment(ctx: Ctx, id: string): Promise<void> {
  const appointment = await ctx.trx
    .selectFrom('appointments')
    .select('id')
    .where('id', '=', id)
    .where('archived_at', 'is', null)
    .forShare()
    .executeTakeFirst();
  if (!appointment)
    throw new AppError('validation', 'Diesen Termin gibt es nicht mehr.', { field: 'appointment_id' });
}

export async function selectableMember(ctx: Ctx, id: string): Promise<{ id: string; display_name: string }> {
  const member = await ctx.trx
    .selectFrom('members')
    .select(['id', 'display_name', 'active', 'is_system'])
    .where('id', '=', id)
    // gleichzeitiges Deaktivieren wartet und trägt die Person danach auch hier aus
    .forShare()
    .executeTakeFirst();
  if (!member || member.is_system || !member.active)
    throw rule('Nur aktive Mitglieder lassen sich eintragen.');
  return member;
}

async function assigneeIds(ctx: Ctx, taskId: string): Promise<string[]> {
  const rows = await ctx.trx
    .selectFrom('task_assignees')
    .select('member_id')
    .where('task_id', '=', taskId)
    .execute();
  return rows.map((r) => r.member_id);
}

async function followerIds(ctx: Ctx, taskId: string): Promise<string[]> {
  const rows = await ctx.trx
    .selectFrom('task_followers')
    .select('member_id')
    .where('task_id', '=', taskId)
    .execute();
  return rows.map((r) => r.member_id);
}

async function memberName(ctx: Ctx, id: string): Promise<string> {
  return (
    (await ctx.trx.selectFrom('members').select('display_name').where('id', '=', id).executeTakeFirst())
      ?.display_name ?? 'Person'
  );
}

/** version erhöhen – geändert wird nur, was noch die gelesene version hat (die Zeile ist gesperrt) */
async function touchTask(ctx: Ctx, task: TaskRow, set: Partial<TaskRow> = {}): Promise<void> {
  const { id, version } = task;
  Object.assign(task, set, { version: version + 1, updated_at: iso(ctx) });
  const result = await ctx.trx
    .updateTable('tasks')
    .set({ ...set, version: version + 1, updated_at: iso(ctx) } as never)
    .where('id', '=', id)
    .where('version', '=', version)
    .executeTakeFirst();
  await updatedOne(ctx, result, 'task', { id, version });
}

/** Trägt die Person als Folgende*n ein, falls sie noch nicht folgt (F-AUF-06). */
async function follow(ctx: Ctx, taskId: string, memberId: string): Promise<boolean> {
  const result = await ctx.trx
    .insertInto('task_followers')
    .values({ task_id: taskId, member_id: memberId })
    .onConflict((oc) => oc.doNothing())
    .executeTakeFirst();
  if (Number(result.numInsertedOrUpdatedRows ?? 0) === 0) return false;
  ctx.inverse.push({ kind: 'follower_remove', task_id: taskId, member_id: memberId });
  return true;
}

const isMarked = (ctx: Ctx, taskId: string) => marks.isMarked(ctx.trx, 'task', taskId);

/** Statusänderungen und Archivieren entfernen die Markierung „Fürs Plenum“ (3.14). */
export const dropMark = (ctx: Ctx, taskId: string) => marks.dropMark(ctx, 'task', taskId);

/** Neu Markiertes kommt ans Ende der Agenda. */
const addMark = (ctx: Ctx, taskId: string) => marks.addMark(ctx, 'task', taskId);

const taskState = (task: TaskRow) =>
  ({
    kind: 'task_state',
    task_id: task.id,
    status: task.status,
    block_reason: task.block_reason,
    discard_reason: task.discard_reason,
    archived_at: task.archived_at,
  }) as const;

export async function createTask(ctx: Ctx, raw: unknown): Promise<{ id: string }> {
  const input = parse(taskCreateSchema, raw);
  await usableTopic(ctx, input.topic_id);
  if (input.event_id) await usableEvent(ctx, input.event_id);
  if (input.appointment_id) await usableAppointment(ctx, input.appointment_id);
  const now = iso(ctx);
  const task = await ctx.trx
    .insertInto('tasks')
    .values({
      title: input.title,
      topic_id: input.topic_id,
      event_id: input.event_id,
      appointment_id: input.appointment_id,
      origin_plenum_id: null,
      priority: input.priority,
      due_date: input.due_date,
      created_at: now,
      updated_at: now,
      created_by: ctx.actor.id,
    })
    .returning(['id'])
    .executeTakeFirstOrThrow();
  const changes: HistoryChanges = { title: { old: null, new: input.title } };
  await follow(ctx, task.id, ctx.actor.id);
  if (input.assign_self) {
    // trägt nur ein – der Status bleibt „neu“ (F-AUF-04)
    await ctx.trx
      .insertInto('task_assignees')
      .values({ task_id: task.id, member_id: ctx.actor.id, assigned_by: ctx.actor.id, assigned_at: now })
      .execute();
    changes.assignee = { old: null, new: ctx.actor.id };
  }
  if (input.mark_for_plenum) {
    await addMark(ctx, task.id);
  }
  await writeHistory(ctx, 'task', task.id, 'created', changes);
  return { id: task.id };
}

export async function updateTaskFields(ctx: Ctx, id: string, raw: unknown, version: number): Promise<void> {
  const input = parse(taskFieldsSchema, raw);
  const task = await editableTask(ctx, id);
  await checkVersion(ctx, 'task', task, version);
  const changes: HistoryChanges = {};
  const set: Partial<TaskRow> = {};
  if (input.title !== undefined && input.title !== task.title) {
    changes.title = { old: task.title, new: input.title };
    set.title = input.title;
  }
  if (input.topic_id !== undefined && input.topic_id !== task.topic_id) {
    await usableTopic(ctx, input.topic_id);
    changes.topic_id = { old: task.topic_id, new: input.topic_id };
    set.topic_id = input.topic_id;
  }
  if (input.priority !== undefined && input.priority !== task.priority) {
    changes.priority = { old: task.priority, new: input.priority };
    set.priority = input.priority;
  }
  if (input.due_date !== undefined && input.due_date !== task.due_date) {
    changes.due_date = { old: task.due_date, new: input.due_date };
    set.due_date = input.due_date;
  }
  if (input.event_id !== undefined && input.event_id !== task.event_id) {
    if (input.event_id) await usableEvent(ctx, input.event_id);
    changes.event_id = { old: task.event_id, new: input.event_id };
    set.event_id = input.event_id;
    // [P4] aus einer Vorlage angelegt: bei der bisherigen Veranstaltung wieder anlegbar (Entscheidung 22.10.2026)
    await ctx.trx.deleteFrom('template_applications').where('task_id', '=', id).execute();
  }
  if (input.appointment_id !== undefined && input.appointment_id !== task.appointment_id) {
    if (input.appointment_id) await usableAppointment(ctx, input.appointment_id);
    changes.appointment_id = { old: task.appointment_id, new: input.appointment_id };
    set.appointment_id = input.appointment_id;
  }
  if (Object.keys(changes).length === 0) return;
  await touchTask(ctx, task, set);
  await follow(ctx, id, ctx.actor.id);
  await writeHistory(ctx, 'task', id, 'updated', changes);
}

export async function updateTaskDescription(
  ctx: Ctx,
  id: string,
  raw: unknown,
  version: number,
): Promise<void> {
  const description = parse(taskDescriptionSchema, raw);
  const task = await editableTask(ctx, id);
  await checkVersion(ctx, 'task', task, version);
  if (description === task.description) return;
  const changes: HistoryChanges = { description: { old: task.description, new: description } };
  await touchTask(ctx, task, { description });
  await follow(ctx, id, ctx.actor.id);
  await writeHistory(ctx, 'task', id, 'updated', changes);
}

async function insertBlocker(ctx: Ctx, task: TaskRow, blockerId: string): Promise<boolean> {
  if (blockerId === task.id) throw rule('Eine Aufgabe kann nicht auf sich selbst warten.');
  const blocker = await findTask(ctx, blockerId, { lock: false });
  if (blocker.archived_at) throw rule('Archivierte Aufgaben können nicht blockieren.');
  await lockFor(ctx, 'task_blockers');
  const edges = await ctx.trx.selectFrom('task_blockers').selectAll().execute();
  if (edges.some((b) => b.task_id === task.id && b.blocker_task_id === blockerId)) return false;
  if (wouldCreateBlockerCycle(edges, task.id, blockerId))
    throw rule(`„${blocker.title}“ wartet selbst schon auf diese Aufgabe – das wäre ein Kreis.`);
  await ctx.trx
    .insertInto('task_blockers')
    .values({ task_id: task.id, blocker_task_id: blockerId })
    .execute();
  ctx.inverse.push({ kind: 'blocker_remove', task_id: task.id, blocker_task_id: blockerId });
  await writeHistory(ctx, 'task', task.id, 'blocker_added', { blocker: { old: null, new: blockerId } });
  return true;
}

export async function setTaskStatus(
  ctx: Ctx,
  id: string,
  raw: unknown,
  { selfAssign = true }: { selfAssign?: boolean } = {},
): Promise<Undoable & { self_assigned: boolean }> {
  const input = parse(taskStatusChangeSchema, raw);
  const { task, assignees, followers, hasBlockers: blocked } = await editableTaskWithPeople(ctx, id);
  await checkVersion(ctx, 'task', task, input.version);
  const from = task.status;
  const to = input.status;
  if (!canTransitionTask(from, to))
    throw rule(
      from === to
        ? `Die Aufgabe ist schon „${TASK_STATUS_LABEL[to]}“.`
        : `Von „${TASK_STATUS_LABEL[from]}“ nach „${TASK_STATUS_LABEL[to]}“ geht es nicht.`,
    );
  const hasBlockers = (input.blocker_ids?.length ?? 0) > 0 || blocked;
  if (blockReasonMissing(to, input.block_reason, hasBlockers))
    throw new AppError('validation', BLOCK_REASON_MISSING, { field: 'block_reason' });

  if (!isActiveTaskStatus(from) && isActiveTaskStatus(to)) await topicStillActive(ctx, task);

  ctx.inverse.push(taskState(task));
  const changes: HistoryChanges = { status: { old: from, new: to } };
  const set: Partial<TaskRow> = { status: to };
  if (from === 'blockiert') {
    // der Grund wird geleert und bleibt in der Historie
    changes.block_reason = { old: task.block_reason, new: null };
    set.block_reason = null;
  }
  if (from === 'verworfen' && task.discard_reason) {
    changes.discard_reason = { old: task.discard_reason, new: null };
    set.discard_reason = null;
  }
  if (to === 'blockiert') {
    // mit Abhängigkeit darf der Grund fehlen
    set.block_reason = input.block_reason?.trim() || null;
    if (set.block_reason) changes.block_reason = { old: null, new: set.block_reason };
  }
  if (to === 'verworfen' && input.discard_reason) {
    set.discard_reason = input.discard_reason;
    changes.discard_reason = { old: null, new: input.discard_reason };
  }
  await touchTask(ctx, task, set);
  if (to === 'blockiert')
    for (const blockerId of input.blocker_ids ?? []) await insertBlocker(ctx, task, blockerId);

  let self_assigned = false;
  const isAssignee = assignees.includes(ctx.actor.id);
  if (to === 'in_arbeit' && !isAssignee && selfAssign) {
    // wer loslegt und nicht eingetragen ist, wird automatisch Bearbeitende*r (4.1)
    await ctx.trx
      .insertInto('task_assignees')
      .values({ task_id: id, member_id: ctx.actor.id, assigned_by: ctx.actor.id, assigned_at: iso(ctx) })
      .execute();
    ctx.inverse.push({ kind: 'assignee_remove', task_id: id, member_id: ctx.actor.id });
    changes.assignee = { old: null, new: ctx.actor.id };
    self_assigned = true;
    assignees.push(ctx.actor.id);
  }
  await dropMark(ctx, id);
  await follow(ctx, id, ctx.actor.id);
  if (!followers.includes(ctx.actor.id)) followers.push(ctx.actor.id);
  await writeHistory(ctx, 'task', id, 'status', changes);
  // [P2] Bearbeitende und Folgende erfahren es (6.2)
  await notify(ctx, statusMessages(task, to, ctx.actor.id, assignees, followers, iso(ctx)));
  if (to === 'erledigt') {
    // die wartenden Aufgaben ändern ihren Status nicht automatisch – ihre Bearbeitenden erfahren es (4.1)
    const waiting = await ctx.trx
      .selectFrom('task_blockers as b')
      .innerJoin('tasks as t', 't.id', 'b.task_id')
      .select(['t.id', 't.title', 't.due_date'])
      .where('b.blocker_task_id', '=', id)
      .where('t.archived_at', 'is', null)
      .where('t.status', 'in', ['neu', 'geplant', 'in_arbeit', 'blockiert'])
      .execute();
    for (const w of waiting)
      await notify(ctx, unblockedMessages(task, w, await assigneeIds(ctx, w.id), ctx.actor.id, iso(ctx)));
  }
  return { ...(await registerUndo(ctx, 'task', task, `Status: ${TASK_STATUS_LABEL[to]}`)), self_assigned };
}

export async function addAssignee(ctx: Ctx, taskId: string, memberId: string): Promise<Undoable> {
  const task = await editableTask(ctx, taskId);
  const member = await selectableMember(ctx, memberId);
  const inserted = await ctx.trx
    .insertInto('task_assignees')
    .values({ task_id: taskId, member_id: memberId, assigned_by: ctx.actor.id, assigned_at: iso(ctx) })
    .onConflict((oc) => oc.doNothing())
    .executeTakeFirst();
  if (Number(inserted.numInsertedOrUpdatedRows ?? 0) === 0) return { undo_token: '' };
  ctx.inverse.push({ kind: 'assignee_remove', task_id: taskId, member_id: memberId });
  await follow(ctx, taskId, memberId);
  await touchTask(ctx, task);
  await writeHistory(ctx, 'task', taskId, 'assignee_added', { assignee: { old: null, new: memberId } });
  await notify(ctx, assignmentMessages(task, memberId, ctx.actor.id, iso(ctx)));
  return registerUndo(ctx, 'task', task, `${member.display_name} eingetragen`);
}

export async function dropAssignee(
  ctx: Ctx,
  task: TaskRow,
  memberId: string,
  reason?: 'deactivated',
): Promise<boolean> {
  const row = await ctx.trx
    .deleteFrom('task_assignees')
    .where('task_id', '=', task.id)
    .where('member_id', '=', memberId)
    .returningAll()
    .executeTakeFirst();
  if (!row) return false;
  ctx.inverse.push({ kind: 'assignee_add', row });
  const changes: HistoryChanges = { assignee: { old: memberId, new: null } };
  if (reason) changes.reason = { old: null, new: reason };
  const left = await ctx.trx
    .selectFrom('task_assignees')
    .select('member_id')
    .where('task_id', '=', task.id)
    .executeTakeFirst();
  const next = left ? task.status : statusAfterLastAssigneeLeft(task.status);
  let statusReset = false;
  if (next !== task.status) {
    ctx.inverse.push(taskState(task));
    changes.status = { old: task.status, new: next };
    await dropMark(ctx, task.id);
    statusReset = true;
  }
  await touchTask(ctx, task, statusReset ? { status: next } : {});
  await writeHistory(ctx, 'task', task.id, 'assignee_removed', changes);
  return statusReset;
}

export async function removeAssignee(
  ctx: Ctx,
  taskId: string,
  memberId: string,
): Promise<Undoable & { status_reset: boolean }> {
  const task = await editableTask(ctx, taskId);
  const name = await memberName(ctx, memberId);
  const status_reset = await dropAssignee(ctx, task, memberId);
  return { ...(await registerUndo(ctx, 'task', task, `${name} ausgetragen`)), status_reset };
}

export async function addFollower(ctx: Ctx, taskId: string, memberId: string): Promise<Undoable> {
  const task = await editableTask(ctx, taskId);
  const member = await selectableMember(ctx, memberId);
  if (!(await follow(ctx, taskId, memberId))) return { undo_token: '' };
  // selbst folgen oder entfolgen betrifft nur die Person selbst – ohne Historie
  if (memberId !== ctx.actor.id)
    await writeHistory(ctx, 'task', taskId, 'follower_added', { follower: { old: null, new: memberId } });
  return registerUndo(ctx, 'task', task, `${member.display_name} folgt`);
}

export async function dropFollower(
  ctx: Ctx,
  taskId: string,
  memberId: string,
  reason?: 'deactivated',
): Promise<boolean> {
  const row = await ctx.trx
    .deleteFrom('task_followers')
    .where('task_id', '=', taskId)
    .where('member_id', '=', memberId)
    .returningAll()
    .executeTakeFirst();
  if (!row) return false;
  ctx.inverse.push({ kind: 'follower_add', task_id: taskId, member_id: memberId });
  const changes: HistoryChanges = { follower: { old: memberId, new: null } };
  if (reason) changes.reason = { old: null, new: reason };
  if (memberId !== ctx.actor.id) await writeHistory(ctx, 'task', taskId, 'follower_removed', changes);
  return true;
}

export async function removeFollower(ctx: Ctx, taskId: string, memberId: string): Promise<Undoable> {
  const task = await editableTask(ctx, taskId);
  const name = await memberName(ctx, memberId);
  await dropFollower(ctx, taskId, memberId);
  return registerUndo(ctx, 'task', task, `${name} folgt nicht mehr`);
}

export async function addBlocker(ctx: Ctx, taskId: string, blockerTaskId: string): Promise<void> {
  const task = await editableTask(ctx, taskId);
  if (await insertBlocker(ctx, task, blockerTaskId)) await follow(ctx, taskId, ctx.actor.id);
}

export async function removeBlocker(ctx: Ctx, taskId: string, blockerTaskId: string): Promise<void> {
  const task = await editableTask(ctx, taskId);
  // blockiert ohne Grund braucht mindestens eine Abhängigkeit
  if (task.status === 'blockiert' && !task.block_reason) {
    await lockFor(ctx, 'task_blockers');
    const rows = await ctx.trx
      .selectFrom('task_blockers')
      .select('blocker_task_id')
      .where('task_id', '=', taskId)
      .execute();
    if (rows.length === 1 && rows[0]!.blocker_task_id === blockerTaskId) throw rule(LAST_BLOCKER);
  }
  const row = await ctx.trx
    .deleteFrom('task_blockers')
    .where('task_id', '=', taskId)
    .where('blocker_task_id', '=', blockerTaskId)
    .returningAll()
    .executeTakeFirst();
  if (!row) return;
  await follow(ctx, taskId, ctx.actor.id);
  await writeHistory(ctx, 'task', taskId, 'blocker_removed', { blocker: { old: blockerTaskId, new: null } });
}

export async function setPlenumMark(ctx: Ctx, taskId: string, marked: boolean): Promise<Undoable> {
  const task = await editableTask(ctx, taskId);
  if ((await isMarked(ctx, taskId)) === marked) return { undo_token: '' };
  if (marked) {
    if (!isActiveTaskStatus(task.status))
      throw rule('Abgeschlossene Aufgaben lassen sich nicht fürs Plenum markieren.');
    await addMark(ctx, taskId);
    return registerUndo(ctx, 'task', task, 'Fürs Plenum markiert');
  }
  await dropMark(ctx, taskId);
  return registerUndo(ctx, 'task', task, 'Markierung entfernt');
}

export async function addComment(
  ctx: Ctx,
  taskId: string,
  raw: unknown,
): Promise<{ id: string; now_following: boolean }> {
  const body = parse(commentBodySchema, raw);
  const task = await editableTask(ctx, taskId);
  const now = iso(ctx);
  const comment = await ctx.trx
    .insertInto('comments')
    .values({ task_id: taskId, author_id: ctx.actor.id, body, created_at: now, updated_at: now })
    .returning('id')
    .executeTakeFirstOrThrow();
  const now_following = await follow(ctx, taskId, ctx.actor.id);
  await writeHistory(ctx, 'task', taskId, 'comment_added', { comment: { old: null, new: comment.id } });
  const [assignees, followers] = await Promise.all([assigneeIds(ctx, taskId), followerIds(ctx, taskId)]);
  await notify(
    ctx,
    commentMessages(
      task,
      { id: comment.id, body },
      ctx.actor.id,
      ctx.actor.display_name,
      assignees,
      followers,
    ),
  );
  return { id: comment.id, now_following };
}

export async function updateComment(ctx: Ctx, commentId: string, raw: unknown): Promise<void> {
  const body = parse(commentBodySchema, raw);
  const comment = await ctx.trx
    .selectFrom('comments')
    .selectAll()
    .where('id', '=', commentId)
    .forUpdate()
    .executeTakeFirst();
  if (!comment) throw notFound('Diesen Kommentar');
  if (comment.author_id !== ctx.actor.id)
    throw new AppError('forbidden', 'Nur eigene Kommentare lassen sich bearbeiten.');
  await editableTask(ctx, comment.task_id);
  if (body === comment.body) return;
  await ctx.trx
    .updateTable('comments')
    .set({ body, updated_at: iso(ctx) })
    .where('id', '=', commentId)
    .execute();
  await writeHistory(ctx, 'task', comment.task_id, 'comment_edited', {
    comment: { old: comment.id, new: comment.id },
    // Text alt → neu (3.10)
    body: { old: comment.body, new: body },
  });
}

export async function archiveTask(ctx: Ctx, id: string, version: number): Promise<Undoable> {
  const task = await editableTask(ctx, id);
  await checkVersion(ctx, 'task', task, version);
  ctx.inverse.push(taskState(task));
  const changes: HistoryChanges = {};
  await dropMark(ctx, id);
  await touchTask(ctx, task, { archived_at: iso(ctx) });
  await writeHistory(ctx, 'task', id, 'archived', changes);
  return registerUndo(ctx, 'task', task, 'Archiviert');
}

export async function restoreTask(ctx: Ctx, id: string, version: number): Promise<void> {
  const task = await findTask(ctx, id);
  await checkVersion(ctx, 'task', task, version);
  if (!task.archived_at) return;
  if (isActiveTaskStatus(task.status)) await topicStillActive(ctx, task);
  await touchTask(ctx, task, { archived_at: null });
  await writeHistory(ctx, 'task', id, 'restored');
}
