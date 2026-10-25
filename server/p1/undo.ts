// Rückgängig (WF-ALL-02): die gespeicherten Gegenschritte einer Aktion, 30 Sekunden lang, nur für die
// Person, die gehandelt hat; ebenfalls in der Historie. Hat die Aktion die Zeile selbst geändert, darf inzwischen
// niemand anderes daran gewesen sein (Optimistic Locking wie überall).
import { sql } from 'kysely';
import { canRsvp } from '../../src/shared/rules/appointments';
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
import { markable } from '../core/marks';
import { topicStillActive } from './tasks';

const ROW_KINDS = new Set<InverseOp['kind']>([
  'task_state',
  'assignee_add',
  'assignee_remove',
  'event_status',
  // [P3]
  'appointment_state',
  'decision_state',
  'question_state',
  'task_fields',
  'appointment_times',
]);

/** Tabelle je Art, die ein Rückgängig betreffen kann */
const TABLES = {
  task: 'tasks',
  event: 'events',
  appointment: 'appointments',
  decision: 'decisions',
  question: 'questions',
  document: 'documents',
  partner: 'partners',
} as const;
type UndoEntity = keyof typeof TABLES;

/** Im selben Schritt Angelegtes verschwindet zuletzt – nachdem alle Verweise darauf zurückgesetzt sind */
const LAST = new Set<InverseOp['kind']>(['task_delete', 'decision_delete']);

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

  if (!Object.hasOwn(TABLES, record.entity_type)) throw rule('Das lässt sich nicht mehr rückgängig machen.');
  const entityType = record.entity_type as UndoEntity;
  const table = TABLES[entityType];
  const entity = await ctx.trx
    .selectFrom(table)
    .select(['id', 'version'])
    .where('id', '=', record.entity_id)
    .forUpdate()
    .executeTakeFirst();
  if (!entity) throw notFound('Diesen Eintrag');
  const stored = record.ops as InverseOp[];
  const ops = [...stored.filter((op) => !LAST.has(op.kind)), ...stored.filter((op) => LAST.has(op.kind))];
  await stillUndoable(ctx, record.history_ids as string[], ops, entity.id);
  const touchesRow = ops.some((op) => ROW_KINDS.has(op.kind));
  if (touchesRow) await checkVersion(ctx, entityType, entity, record.version_after);

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
        // nur, wenn der Eintrag (nach den Gegenschritten davor) noch gilt – sonst bleibt er herunter
        if (!(await markable(ctx.trx, op.row.decision_id))) break;
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
          .where('decision_id', '=', op.decision_id)
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
      // ── Phase 3 ──
      case 'rsvp_restore': {
        // nur, solange Zu- und Absagen noch möglich sind
        const appointment = await ctx.trx
          .selectFrom('appointments')
          .select(['status', 'starts_at'])
          .where('id', '=', op.appointment_id)
          .executeTakeFirstOrThrow();
        if (!canRsvp(appointment, ctx.now))
          throw rule('Für diesen Termin sind keine Zu- und Absagen mehr möglich.');
        const current = await ctx.trx
          .selectFrom('appointment_rsvps')
          .select('answer')
          .where('appointment_id', '=', op.appointment_id)
          .where('member_id', '=', op.member_id)
          .executeTakeFirst();
        changes.rsvp = { old: current?.answer ?? null, new: op.row?.answer ?? null };
        await ctx.trx
          .deleteFrom('appointment_rsvps')
          .where('appointment_id', '=', op.appointment_id)
          .where('member_id', '=', op.member_id)
          .execute();
        if (op.row) await ctx.trx.insertInto('appointment_rsvps').values(op.row).execute();
        break;
      }
      case 'appointment_state': {
        const before = await ctx.trx
          .selectFrom('appointments')
          .select('status')
          .where('id', '=', op.appointment_id)
          .executeTakeFirstOrThrow();
        if (before.status !== op.status) changes.status = { old: before.status, new: op.status };
        await ctx.trx
          .updateTable('appointments')
          .set({ status: op.status as never })
          .where('id', '=', op.appointment_id)
          .execute();
        await ctx.trx
          .deleteFrom('appointment_attendees')
          .where('appointment_id', '=', op.appointment_id)
          .execute();
        if (op.attendees.length)
          await ctx.trx.insertInto('appointment_attendees').values(op.attendees).execute();
        break;
      }
      case 'appointment_times': {
        const before = await ctx.trx
          .selectFrom('appointments')
          .select(['starts_at', 'ends_at'])
          .where('id', '=', op.appointment_id)
          .executeTakeFirstOrThrow();
        for (const key of ['starts_at', 'ends_at'] as const)
          if (before[key] !== op[key]) changes[key] = { old: before[key], new: op[key] };
        await ctx.trx
          .updateTable('appointments')
          .set({ starts_at: op.starts_at, ends_at: op.ends_at })
          .where('id', '=', op.appointment_id)
          .execute();
        break;
      }
      case 'task_fields': {
        const before = await ctx.trx
          .selectFrom('tasks')
          .select(['due_date', 'origin_plenum_id'])
          .where('id', '=', op.task_id)
          .executeTakeFirstOrThrow();
        for (const key of ['due_date', 'origin_plenum_id'] as const)
          if (before[key] !== op[key]) changes[key] = { old: before[key], new: op[key] };
        await ctx.trx
          .updateTable('tasks')
          .set({ due_date: op.due_date, origin_plenum_id: op.origin_plenum_id })
          .where('id', '=', op.task_id)
          .execute();
        break;
      }
      case 'decision_state': {
        const before = await ctx.trx
          .selectFrom('decisions')
          .select('status')
          .where('id', '=', op.decision_id)
          .executeTakeFirstOrThrow();
        if (before.status !== op.status) changes.status = { old: before.status, new: op.status };
        await ctx.trx
          .updateTable('decisions')
          .set({ status: op.status as never, superseded_by_id: op.superseded_by_id })
          .where('id', '=', op.decision_id)
          .execute();
        break;
      }
      case 'question_state': {
        const before = await ctx.trx
          .selectFrom('questions')
          .select('status')
          .where('id', '=', op.question_id)
          .executeTakeFirstOrThrow();
        if (before.status !== op.status) changes.status = { old: before.status, new: op.status };
        await ctx.trx
          .updateTable('questions')
          .set({
            status: op.status as never,
            answer: op.answer,
            answered_in_plenum_id: op.answered_in_plenum_id,
            resulting_decision_id: op.resulting_decision_id,
          })
          .where('id', '=', op.question_id)
          .execute();
        break;
      }
      case 'task_delete':
        // die im selben Schritt angelegte Aufgabe verschwindet wieder; ihre Historie bleibt (unveränderlich)
        await ctx.trx.deleteFrom('task_assignees').where('task_id', '=', op.task_id).execute();
        await ctx.trx.deleteFrom('task_followers').where('task_id', '=', op.task_id).execute();
        await ctx.trx.deleteFrom('template_applications').where('task_id', '=', op.task_id).execute();
        await ctx.trx
          .deleteFrom('document_links')
          .where('target_type', '=', 'task')
          .where('target_id', '=', op.task_id)
          .execute();
        await ctx.trx.deleteFrom('tasks').where('id', '=', op.task_id).execute();
        break;
      // ── Phase 4 ──
      case 'booking_remove':
        await ctx.trx.deleteFrom('event_bookings').where('id', '=', op.booking_id).execute();
        break;
      case 'booking_restore':
        await ctx.trx
          .insertInto('event_bookings')
          .values(op.row)
          .onConflict((oc) => oc.doNothing())
          .execute();
        break;
      case 'lead_remove':
        await ctx.trx
          .deleteFrom('event_leads')
          .where('event_id', '=', op.event_id)
          .where('member_id', '=', op.member_id)
          .execute();
        break;
      case 'lead_restore': {
        // wer inzwischen deaktiviert ist, kommt nicht zurück (WF-ADM-03)
        const active = await ctx.trx
          .selectFrom('members')
          .select('id')
          .where('id', '=', op.row.member_id)
          .where('active', '=', true)
          .forShare()
          .executeTakeFirst();
        if (active)
          await ctx.trx
            .insertInto('event_leads')
            .values(op.row)
            .onConflict((oc) => oc.doNothing())
            .execute();
        break;
      }
      case 'event_partner_remove':
        await ctx.trx
          .deleteFrom('event_partners')
          .where('event_id', '=', op.event_id)
          .where('partner_id', '=', op.partner_id)
          .execute();
        break;
      case 'event_partner_restore': {
        // ein inzwischen archivierter Partner wird nicht wieder verknüpft (wie linkPartner)
        const partner = await ctx.trx
          .selectFrom('partners')
          .select('archived_at')
          .where('id', '=', op.row.partner_id)
          .forShare()
          .executeTakeFirst();
        if (partner && !partner.archived_at)
          await ctx.trx
            .insertInto('event_partners')
            .values(op.row)
            .onConflict((oc) => oc.doNothing())
            .execute();
        break;
      }
      case 'decision_delete':
        // die im selben Schritt angelegte Entscheidung verschwindet wieder – samt Markierung; die Historie bleibt
        await ctx.trx.deleteFrom('plenum_marks').where('decision_id', '=', op.decision_id).execute();
        await ctx.trx
          .deleteFrom('document_links')
          .where('target_type', '=', 'decision')
          .where('target_id', '=', op.decision_id)
          .execute();
        await ctx.trx.deleteFrom('decisions').where('id', '=', op.decision_id).execute();
        break;
    }
  }
  // Nachrichten der zurückgenommenen Aktion, die noch nicht raus sind, werden nicht mehr verschickt
  const outboxIds = record.outbox_ids as string[];
  if (outboxIds.length > 0)
    await ctx.trx
      .deleteFrom('notification_outbox')
      .where('id', 'in', outboxIds)
      .where('status', '=', 'wartet')
      // was ein Joblauf gerade verschickt, ist schon unterwegs
      .where('locked_until', 'is', null)
      .execute();
  // eine im selben Schritt angelegte Aufgabe ist wieder weg: nichts mehr zu prüfen oder hochzuzählen – der
  // Eintrag „rückgängig gemacht“ bleibt trotzdem, damit ihre Zeile aus dem Ergebnis des Plenums verschwindet
  const deleted = ops.some((op) => op.kind === 'task_delete' && op.task_id === entity.id);
  if (table === 'tasks' && !deleted)
    await taskStillValid(
      ctx,
      entity.id,
      ops.some((op) => op.kind === 'task_state' && op.status === 'in_arbeit'),
    );
  if (touchesRow && !deleted)
    await ctx.trx
      .updateTable(table)
      .set({ version: entity.version + 1, updated_at: iso(ctx) })
      .where('id', '=', entity.id)
      .execute();
  // was ohne Historie geschah (Markierung, selbst folgen), wird auch still zurückgenommen
  if ((record.history_ids as string[]).length === 0) return;
  await writeHistory(ctx, entityType, entity.id, 'undo', {
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

/**
 * Was sich nicht mehr zurücknehmen lässt: Aktionen eines abgeschlossenen Plenums (die Zusammenfassung ist verschickt,
 * WF-PLE-19) und im selben Schritt Angelegtes, das inzwischen jemand weiterverwendet.
 */
async function stillUndoable(
  ctx: Ctx,
  historyIds: string[],
  ops: InverseOp[],
  entityId: string,
): Promise<void> {
  if (historyIds.length > 0) {
    // die Plenen der Aktion sperren: ein gleichzeitiges „Abschließen“ wartet bzw. ist schon durch
    const plenums = await ctx.trx
      .selectFrom('history')
      .select(sql<string>`changes -> 'plenum_id' ->> 'new'`.as('plenum_id'))
      .where('id', 'in', historyIds)
      .where(sql<boolean>`changes -> 'plenum_id' ->> 'new' is not null`)
      .execute();
    const ids = [...new Set(plenums.map((p) => p.plenum_id))];
    const closed = ids.length
      ? await ctx.trx
          .selectFrom('appointments')
          .select(['id', 'status'])
          .where('id', 'in', ids)
          .forUpdate()
          .execute()
          .then((rows) => rows.some((a) => a.status === 'abgeschlossen'))
      : false;
    if (closed)
      throw rule('Das Plenum ist schon abgeschlossen – das lässt sich nicht mehr rückgängig machen.');
  }
  for (const op of ops) {
    if (op.kind === 'booking_remove') {
      const booking = await ctx.trx
        .selectFrom('event_bookings')
        .select('version')
        .where('id', '=', op.booking_id)
        .forUpdate()
        .executeTakeFirst();
      if ((booking?.version ?? 1) > 1)
        throw rule('Der Act wurde inzwischen bearbeitet – das lässt sich nicht mehr rückgängig machen.');
    }
    if (op.kind === 'decision_delete') {
      const created = await ctx.trx
        .selectFrom('decisions')
        .select(['id', 'version'])
        .where('id', '=', op.decision_id)
        .forUpdate()
        .executeTakeFirst();
      if (!created) continue;
      const [successorOf, linked, marked] = await Promise.all([
        ctx.trx
          .selectFrom('decisions')
          .select('id')
          .where('superseded_by_id', '=', created.id)
          .where('id', '<>', entityId)
          .executeTakeFirst(),
        ctx.trx
          .selectFrom('document_links')
          .select('document_id')
          .where('target_type', '=', 'decision')
          .where('target_id', '=', created.id)
          .executeTakeFirst(),
        ctx.trx
          .selectFrom('plenum_marks')
          .select('id')
          .where('decision_id', '=', created.id)
          .executeTakeFirst(),
      ]);
      if (created.version > 1 || successorOf || linked || marked)
        throw rule(
          'Der neue Eintrag wird inzwischen weiterverwendet – das lässt sich nicht mehr rückgängig machen.',
        );
    }
    if (op.kind === 'task_delete') {
      const [foreign, comment, blocker] = await Promise.all([
        ctx.trx
          .selectFrom('history')
          .select('id')
          .where('entity_type', '=', 'task')
          .where('entity_id', '=', op.task_id)
          .$if(historyIds.length > 0, (q) => q.where('id', 'not in', historyIds))
          .executeTakeFirst(),
        ctx.trx.selectFrom('comments').select('id').where('task_id', '=', op.task_id).executeTakeFirst(),
        ctx.trx
          .selectFrom('task_blockers')
          .select('task_id')
          .where((eb) => eb.or([eb('task_id', '=', op.task_id), eb('blocker_task_id', '=', op.task_id)]))
          .executeTakeFirst(),
      ]);
      if (foreign || comment || blocker)
        throw rule(
          'Eine der neuen Aufgaben wurde inzwischen bearbeitet – das lässt sich nicht mehr rückgängig machen.',
        );
    }
  }
}
