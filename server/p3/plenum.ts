// Phase 3: Plenum – Agenda aus allen Markierungen, Aktionen je Art, Ergebnis, Protokoll und Abschluss
// (ANFORDERUNGEN 3.14, 4.3, F-PLE-01 bis -05, WF-PLE-03 bis -20). Wie die Testdaten-Schicht (src/data/mock/plenum.ts).
// Jede Aktion ist eine Transaktion mit genau einem Rückgängig-Eintrag; was dabei passiert, steht mit „im Plenum vom …“
// in der Historie des Objekts – daraus entsteht das Ergebnis.
import { sql } from 'kysely';
import type { AgendaItem, PlenumDetail, Undoable } from '../../src/data/api';
import { AppError } from '../../src/shared/errors';
import { formatDayMonth } from '../../src/shared/format';
import { EVENT_STATUS_LABEL, PRIORITY_LABEL, TASK_STATUS_LABEL } from '../../src/shared/labels';
import { hasStarted } from '../../src/shared/rules/appointments';
import { berlinDate, isOverdue } from '../../src/shared/rules/due';
import { canTransitionEvent } from '../../src/shared/rules/eventStatus';
import { DECISION_KIND_LABEL, DOC_TYPE_LABEL } from '../../src/shared/rules/knowledge';
import { isActiveTaskStatus } from '../../src/shared/rules/taskStatus';
import {
  plenumActionSchema,
  plenumAddSchema,
  protocolSchema,
  RESULT_GROUPS,
  type HistoryChanges,
  type ResultGroup,
} from '../../src/shared/schema';
import {
  checkVersion,
  notFound,
  parse,
  registerUndo,
  rule,
  writeHistory,
  type Ctx,
  type HistoryEntity,
  type Trx,
} from '../core/context';
import { dropMark, isMarked, markColumn, markTarget } from '../core/marks';
import type { AppointmentRow, TaskRow } from '../db/types';
import { findEvent, setEventStatus } from '../p1/events';
import { addAssignee, createTask, findTask, removeAssignee, setTaskStatus } from '../p1/tasks';
import { enqueue } from '../p2/notify';
import * as appts from './appointments';
import { findPartner } from '../p4/partners';
import * as know from './knowledge';

const day = (iso: string) => formatDayMonth(new Date(iso));
const dueText = (isoDate: string) => {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return formatDayMonth(new Date(y, m - 1, d));
};
const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'] as const;
const OPEN = ['neu', 'geplant', 'in_arbeit', 'blockiert'] as const;

async function findPlenum(trx: Trx, id: string, lock = true): Promise<AppointmentRow> {
  const plenum = await appts.findAppointment(trx, id, lock);
  if (!(await appts.isPlenum(trx, plenum))) throw rule('Das geht nur bei einem Plenum.');
  return plenum;
}

/** Agenda-Aktionen gehen, solange das Plenum weder abgeschlossen noch abgesagt ist. */
async function openPlenum(ctx: Ctx, id: string): Promise<AppointmentRow> {
  const plenum = await findPlenum(ctx.trx, id);
  if (plenum.status === 'abgeschlossen') throw rule('Dieses Plenum ist schon abgeschlossen.');
  if (plenum.status === 'abgesagt') throw rule('Dieses Plenum wurde abgesagt.');
  return plenum;
}

const plenumLabel = (plenum: AppointmentRow) => `${plenum.title} vom ${day(plenum.starts_at)}`;

// ── Agenda: eine gemeinsame Liste aller markierten Objekte (F-PLE-03) ───────

export async function agenda(trx: Trx, now: Date): Promise<AgendaItem[]> {
  const marks = await trx
    .selectFrom('plenum_marks')
    .selectAll()
    .orderBy('position')
    .orderBy('marked_at')
    .execute();
  if (marks.length === 0) return [];
  const idsOf = (t: Parameters<typeof markColumn>[0]) =>
    marks.flatMap((m) => (m[markColumn(t)] ? [m[markColumn(t)]!] : []));
  const none = ['00000000-0000-0000-0000-000000000000'];
  const or = (ids: string[]) => (ids.length ? ids : none);
  const [
    tasks,
    assignees,
    questions,
    decisions,
    events,
    eventTasks,
    appointments,
    documents,
    partners,
    partnerEvents,
  ] = await Promise.all([
    trx
      .selectFrom('tasks')
      .selectAll()
      .where('id', 'in', or(idsOf('task')))
      .execute(),
    trx
      .selectFrom('task_assignees')
      .select(['task_id', 'member_id'])
      .where('task_id', 'in', or(idsOf('task')))
      .orderBy('assigned_at')
      .execute(),
    trx
      .selectFrom('questions')
      .selectAll()
      .where('id', 'in', or(idsOf('question')))
      .execute(),
    trx
      .selectFrom('decisions')
      .selectAll()
      .where('id', 'in', or(idsOf('decision')))
      .execute(),
    trx
      .selectFrom('events')
      .selectAll()
      .where('id', 'in', or(idsOf('event')))
      .execute(),
    trx
      .selectFrom('tasks')
      .select('event_id')
      .where('event_id', 'in', or(idsOf('event')))
      .where('archived_at', 'is', null)
      .where('status', 'in', OPEN)
      .execute(),
    trx
      .selectFrom('appointments')
      .selectAll()
      .where('id', 'in', or(idsOf('appointment')))
      .execute(),
    trx
      .selectFrom('documents')
      .selectAll()
      .where('id', 'in', or(idsOf('document')))
      .execute(),
    trx
      .selectFrom('partners')
      .selectAll()
      .where('id', 'in', or(idsOf('partner')))
      .execute(),
    trx
      .selectFrom('event_partners')
      .select('partner_id')
      .where('partner_id', 'in', or(idsOf('partner')))
      .execute(),
  ]);
  const today = berlinDate(now);
  const items: AgendaItem[] = [];
  for (const mark of marks) {
    const target = markTarget(mark);
    const id = mark[markColumn(target)]!;
    const base = { mark_id: mark.id, target, id };
    if (target === 'task') {
      const t = tasks.find((x) => x.id === id);
      if (!t) continue;
      const overdue = isOverdue(t.due_date, t.status, today);
      items.push({
        ...base,
        title: t.title,
        version: t.version,
        label: [
          'Aufgabe',
          TASK_STATUS_LABEL[t.status],
          overdue ? 'überfällig' : t.due_date && `bis ${dueText(t.due_date)}`,
        ]
          .filter(Boolean)
          .join(' · '),
        tone: overdue || t.status === 'blockiert' ? 'rot' : 'grau',
        task_status: t.status,
        assignee_ids: assignees.filter((a) => a.task_id === t.id).map((a) => a.member_id),
        due_date: t.due_date,
        event_id: t.event_id,
      });
    } else if (target === 'question') {
      const q = questions.find((x) => x.id === id);
      if (!q) continue;
      items.push({
        ...base,
        title: q.title,
        version: q.version,
        label: `Frage · ${PRIORITY_LABEL[q.urgency]}`,
        tone: 'bernstein',
      });
    } else if (target === 'decision') {
      const d = decisions.find((x) => x.id === id);
      if (!d) continue;
      items.push({
        ...base,
        title: d.title,
        version: d.version,
        label: `${DECISION_KIND_LABEL[d.kind]} · Gültig`,
        tone: 'gruen',
      });
    } else if (target === 'event') {
      const e = events.find((x) => x.id === id);
      if (!e) continue;
      const open = eventTasks.filter((t) => t.event_id === e.id).length;
      items.push({
        ...base,
        title: e.title,
        version: e.version,
        label: [
          'Veranstaltung',
          EVENT_STATUS_LABEL[e.status],
          day(e.starts_at),
          open > 0 && `${open} ${open === 1 ? 'offene Aufgabe' : 'offene Aufgaben'}`,
        ]
          .filter(Boolean)
          .join(' · '),
        tone: 'violett',
        event_status: e.status,
        open_tasks: open,
      });
    } else if (target === 'appointment') {
      const a = appointments.find((x) => x.id === id);
      if (!a) continue;
      const d = new Date(a.starts_at);
      items.push({
        ...base,
        title: a.title,
        version: a.version,
        label: `Termin · ${WEEKDAYS[d.getDay()]} ${day(a.starts_at)}`,
        tone: 'blau',
        starts_at: a.starts_at,
      });
    } else if (target === 'partner') {
      const partner = partners.find((x) => x.id === id);
      if (!partner) continue;
      const count = partnerEvents.filter((ep) => ep.partner_id === partner.id).length;
      items.push({
        ...base,
        title: partner.name,
        version: partner.version,
        label: ['Partner', partner.kind, `${count} ${count === 1 ? 'Veranstaltung' : 'Veranstaltungen'}`]
          .filter(Boolean)
          .join(' · '),
        tone: 'violett',
      });
    } else {
      const d = documents.find((x) => x.id === id);
      if (!d) continue;
      items.push({
        ...base,
        title: d.title,
        version: d.version,
        label: `Dokument · ${DOC_TYPE_LABEL[d.doc_type]}`,
        tone: 'hell',
        url: d.url,
      });
    }
  }
  return items;
}

// ── Ergebnis: was in diesem Plenum passiert ist (F-PLE-04) ──────────────────

interface Line {
  group: ResultGroup;
  text: string;
}

export async function results(
  trx: Trx,
  plenumId: string,
): Promise<{ group: ResultGroup; lines: string[] }[]> {
  // zurückgenommene Aktionen zählen nicht; passend zu den Indizes history_plenum und history_undone
  const rows = await sql<{ line: Line }>`
    select h.changes -> 'plenum_line' -> 'new' as line
    from history h
    where h.changes -> 'plenum_id' ->> 'new' = ${plenumId}
      and h.changes ? 'plenum_line'
      and not exists (
        select 1 from history u
        where u.action = 'undo' and u.changes -> 'history_ids' -> 'old' ? h.id::text
      )
    order by h.created_at, h.seq`.execute(trx);
  const lines = rows.rows.map((r) => r.line);
  return RESULT_GROUPS.map((group) => ({
    group,
    lines: lines.filter((l) => l.group === group).map((l) => l.text),
  })).filter((g) => g.lines.length > 0);
}

export const RESULT_TITLE: Record<ResultGroup, string> = {
  beschluesse: 'Entscheidungen & Fakten',
  aufgaben: 'Aufgaben',
  fragen: 'Fragen',
  termine: 'Veranstaltungen & Termine',
  besprochen: 'Besprochen',
};

export async function getPlenum(ctx: Ctx, id: string): Promise<PlenumDetail> {
  const plenum = await findPlenum(ctx.trx, id, false);
  const [detail, agendaItems, resultGroups, doc, summary] = await Promise.all([
    appts.getAppointment(ctx.trx, id, ctx.actor.id),
    agenda(ctx.trx, ctx.now),
    results(ctx.trx, id),
    plenum.protocol_document_id
      ? ctx.trx
          .selectFrom('documents')
          .select(['id', 'title', 'url'])
          .where('id', '=', plenum.protocol_document_id)
          .executeTakeFirst()
      : undefined,
    ctx.trx
      .selectFrom('history')
      .select('changes')
      .where('entity_type', '=', 'appointment')
      .where('entity_id', '=', id)
      .where('action', '=', 'closed')
      .executeTakeFirst(),
  ]);
  return {
    ...detail,
    agenda: agendaItems,
    results: resultGroups,
    protocol_document: doc ?? null,
    summary_recipients: summary ? Number((summary.changes as HistoryChanges).recipients?.new ?? 0) : null,
  };
}

/** Eintrag „im Plenum vom …“ in der Historie des Objekts; daraus entsteht auch das Ergebnis. */
async function logLine(
  ctx: Ctx,
  plenum: AppointmentRow,
  type: HistoryEntity,
  id: string,
  line: Line,
  action = 'plenum',
): Promise<void> {
  await writeHistory(ctx, type, id, action, {
    plenum_id: { old: null, new: plenum.id },
    plenum_label: { old: null, new: plenumLabel(plenum) },
    plenum_line: { old: null, new: line },
  });
}

// ── Aktionen in der Agenda (F-PLE-05) ───────────────────────────────────────

async function assigneeNames(trx: Trx, taskId: string): Promise<string[]> {
  const rows = await trx
    .selectFrom('task_assignees as a')
    .innerJoin('members as m', 'm.id', 'a.member_id')
    .select('m.display_name')
    .where('a.task_id', '=', taskId)
    .orderBy('a.assigned_at')
    .execute();
  return rows.map((r) => r.display_name);
}

/** „· Jule, Mo · bis 30.10.“ – mit allen Bearbeitenden, wie es in die Zusammenfassung gehört (F-PLE-04) */
async function whoWhen(trx: Trx, taskId: string): Promise<string> {
  const task = await trx
    .selectFrom('tasks')
    .select('due_date')
    .where('id', '=', taskId)
    .executeTakeFirstOrThrow();
  return [(await assigneeNames(trx, taskId)).join(', '), task.due_date && `bis ${dueText(task.due_date)}`]
    .filter(Boolean)
    .map((part) => ` · ${part}`)
    .join('');
}

async function setDue(ctx: Ctx, task: TaskRow, dueDate: string | null): Promise<void> {
  if (!dueDate || dueDate === task.due_date) return;
  await writeHistory(ctx, 'task', task.id, 'updated', { due_date: { old: task.due_date, new: dueDate } });
  await ctx.trx.updateTable('tasks').set({ due_date: dueDate }).where('id', '=', task.id).execute();
  task.due_date = dueDate;
}

async function setOrigin(ctx: Ctx, taskId: string, plenumId: string): Promise<void> {
  await ctx.trx.updateTable('tasks').set({ origin_plenum_id: plenumId }).where('id', '=', taskId).execute();
}

/** Legt eine Aufgabe an, die gleich „geplant“ ist – Herkunft dieses Plenum (WF-PLE-11, WF-PLE-17). */
async function plannedTask(
  ctx: Ctx,
  plenum: AppointmentRow,
  input: {
    title: string;
    topic_id: string;
    event_id?: string | null;
    appointment_id?: string | null;
    assignee_id: string | null;
    due_date: string | null;
  },
): Promise<TaskRow> {
  const { id } = await createTask(ctx, {
    title: input.title,
    topic_id: input.topic_id,
    event_id: input.event_id ?? null,
    appointment_id: input.appointment_id ?? null,
    due_date: input.due_date,
    mark_for_plenum: false,
  });
  ctx.inverse.push({ kind: 'task_delete', task_id: id });
  await setTaskStatus(ctx, id, { status: 'geplant', version: 1 });
  await setOrigin(ctx, id, plenum.id);
  if (input.assignee_id) await addAssignee(ctx, id, input.assignee_id);
  return findTask(ctx, id);
}

const TABLE_OF = {
  task: 'tasks',
  question: 'questions',
  decision: 'decisions',
  event: 'events',
  appointment: 'appointments',
  document: 'documents',
  partner: 'partners',
} as const;

/** Worauf eine Plenum-Aktion zielt – nur Punkte, die gerade auf der Agenda stehen (Entscheidung der Nutzerin, 22.10.2026) */
const actionTarget = (kind: string) =>
  kind.startsWith('task_')
    ? 'task'
    : kind.startsWith('question_')
      ? 'question'
      : kind.startsWith('decision_')
        ? 'decision'
        : kind === 'event_status'
          ? 'event'
          : kind.startsWith('appointment_')
            ? 'appointment'
            : null;

export async function plenumAction(ctx: Ctx, plenumId: string, raw: unknown): Promise<Undoable> {
  const input = parse(plenumActionSchema, raw);
  const plenum = await openPlenum(ctx, plenumId);
  const target = actionTarget(input.kind);
  if (target && 'id' in input && !(await isMarked(ctx.trx, target, input.id)))
    throw rule('Dieser Punkt steht nicht mehr auf der Agenda.');
  // die Teilschritte legen keine eigenen Rückgängig-Einträge an – es bleibt genau einer für die ganze Aktion
  ctx.deferUndo = true;
  let entity: { type: HistoryEntity & keyof typeof TABLE_OF; id: string };
  let line: Line;
  let action = 'plenum';

  switch (input.kind) {
    case 'task_plan': {
      const task = await findTask(ctx, input.id);
      if (task.status !== 'neu') throw rule('Einplanen geht nur bei neuen Aufgaben.');
      ctx.inverse.push({
        kind: 'task_fields',
        task_id: task.id,
        due_date: task.due_date,
        origin_plenum_id: task.origin_plenum_id,
      });
      await setTaskStatus(ctx, task.id, { status: 'geplant', version: input.version });
      await setOrigin(ctx, task.id, plenum.id);
      await setDue(ctx, await findTask(ctx, task.id), input.due_date);
      if (input.assignee_id) await addAssignee(ctx, task.id, input.assignee_id);
      entity = { type: 'task', id: task.id };
      line = { group: 'aufgaben', text: `Eingeplant: ${task.title}${await whoWhen(ctx.trx, task.id)}` };
      break;
    }
    case 'task_replan': {
      const task = await findTask(ctx, input.id);
      if (task.status !== 'geplant' && task.status !== 'in_arbeit')
        throw rule('Umplanen geht nur bei geplanten Aufgaben und Aufgaben in Arbeit.');
      await checkVersion(ctx, 'task', task, input.version);
      ctx.inverse.push({
        kind: 'task_fields',
        task_id: task.id,
        due_date: task.due_date,
        origin_plenum_id: task.origin_plenum_id,
      });
      if (input.assignee_id) {
        // die gewählte Person übernimmt; der Status bleibt
        await addAssignee(ctx, task.id, input.assignee_id);
        const others = await ctx.trx
          .selectFrom('task_assignees')
          .select('member_id')
          .where('task_id', '=', task.id)
          .where('member_id', '<>', input.assignee_id)
          .execute();
        for (const row of others) await removeAssignee(ctx, task.id, row.member_id);
      }
      const current = await findTask(ctx, task.id);
      await setDue(ctx, current, input.due_date);
      const changes: HistoryChanges = {};
      if (await dropMark(ctx, 'task', task.id, changes))
        await writeHistory(ctx, 'task', task.id, 'unmarked', changes);
      await ctx.trx
        .updateTable('tasks')
        .set({ version: current.version + 1, updated_at: ctx.now.toISOString() })
        .where('id', '=', task.id)
        .execute();
      entity = { type: 'task', id: task.id };
      line = { group: 'aufgaben', text: `Umgeplant: ${task.title}${await whoWhen(ctx.trx, task.id)}` };
      break;
    }
    case 'task_unblock': {
      const task = await findTask(ctx, input.id);
      if (task.status !== 'blockiert') throw rule('Diese Aufgabe ist nicht blockiert.');
      await setTaskStatus(ctx, task.id, { status: input.to, version: input.version }, { selfAssign: false });
      entity = { type: 'task', id: task.id };
      line = { group: 'aufgaben', text: `Blockade gelöst: ${task.title} → ${TASK_STATUS_LABEL[input.to]}` };
      break;
    }
    case 'task_finish': {
      const task = await findTask(ctx, input.id);
      if (!isActiveTaskStatus(task.status)) throw rule('Diese Aufgabe ist schon abgeschlossen.');
      await setTaskStatus(ctx, task.id, { status: input.to, version: input.version });
      const who = (await assigneeNames(ctx.trx, task.id)).join(', ');
      entity = { type: 'task', id: task.id };
      line = {
        group: 'aufgaben',
        text: `${input.to === 'erledigt' ? 'Erledigt' : 'Verworfen'}: ${task.title}${who ? ` · ${who}` : ''}`,
      };
      break;
    }
    case 'question_clarify': {
      const question = await ctx.trx
        .selectFrom('questions')
        .selectAll()
        .where('id', '=', input.id)
        .executeTakeFirst();
      if (!question) throw notFound('Diese Frage');
      const { decision_id } = await know.clarifyQuestion(
        ctx,
        question.id,
        { answer: input.answer, result: input.result, version: input.version },
        plenum.id,
      );
      if (decision_id)
        await logLine(ctx, plenum, 'decision', decision_id, {
          group: 'beschluesse',
          text: `${input.result === 'fakt' ? 'Neuer Fakt' : 'Neue Entscheidung'}: ${question.title} – ${input.answer}`,
        });
      if (input.follow_up) {
        const task = await plannedTask(ctx, plenum, {
          title: `Folgeaufgabe: ${question.title}`.slice(0, 200),
          topic_id: question.topic_id,
          event_id: question.event_id,
          assignee_id: null,
          due_date: null,
        });
        await logLine(ctx, plenum, 'task', task.id, {
          group: 'aufgaben',
          text: `Neu eingeplant: ${task.title}`,
        });
      }
      entity = { type: 'question', id: question.id };
      line = { group: 'fragen', text: `Geklärt: ${question.title} – ${input.answer}` };
      break;
    }
    case 'question_discard': {
      const question = await ctx.trx
        .selectFrom('questions')
        .selectAll()
        .where('id', '=', input.id)
        .executeTakeFirst();
      if (!question) throw notFound('Diese Frage');
      await know.discardQuestion(ctx, question.id, input.version, plenum.id);
      entity = { type: 'question', id: question.id };
      line = { group: 'fragen', text: `Verworfen: ${question.title}` };
      break;
    }
    case 'decision_replace': {
      const old = await ctx.trx
        .selectFrom('decisions')
        .selectAll()
        .where('id', '=', input.id)
        .executeTakeFirst();
      if (!old) throw notFound('Diesen Eintrag');
      await know.replaceDecision(ctx, old.id, {
        title: input.title,
        description: input.description,
        source_plenum_id: plenum.id,
        version: input.version,
      });
      entity = { type: 'decision', id: old.id };
      line = { group: 'beschluesse', text: `Ersetzt: „${old.title}“ → „${input.title}“` };
      break;
    }
    case 'decision_revoke': {
      const decision = await ctx.trx
        .selectFrom('decisions')
        .selectAll()
        .where('id', '=', input.id)
        .executeTakeFirst();
      if (!decision) throw notFound('Diesen Eintrag');
      await know.revokeDecision(ctx, decision.id, input.note || null, input.version, plenum.id);
      entity = { type: 'decision', id: decision.id };
      line = { group: 'beschluesse', text: `Aufgehoben: ${decision.title}` };
      break;
    }
    case 'event_status': {
      const event = await findEvent(ctx, input.id);
      if (!canTransitionEvent(event.status, input.to))
        throw rule(
          `Von „${EVENT_STATUS_LABEL[event.status]}“ nach „${EVENT_STATUS_LABEL[input.to]}“ geht es nicht.`,
        );
      await setEventStatus(ctx, event.id, input.to, input.version);
      const verb: Partial<Record<typeof input.to, string>> = {
        in_planung: 'In Planung genommen',
        bestaetigt: 'Bestätigt',
        in_nachbereitung: 'In Nachbereitung',
        abgeschlossen: 'Abgeschlossen',
        abgesagt: 'Abgesagt',
      };
      entity = { type: 'event', id: event.id };
      line = { group: 'termine', text: `${verb[input.to]}: ${event.title}` };
      break;
    }
    case 'appointment_move': {
      const a = await appts.findAppointment(ctx.trx, input.id);
      if (await appts.isPlenum(ctx.trx, a))
        throw rule('Ein Plenum lässt sich nicht aus einem Plenum heraus verschieben.');
      if (a.status !== 'geplant') throw rule('Nur geplante Termine lassen sich verschieben.');
      ctx.inverse.push({
        kind: 'appointment_times',
        appointment_id: a.id,
        starts_at: a.starts_at,
        ends_at: a.ends_at,
      });
      const length = a.ends_at ? new Date(a.ends_at).getTime() - new Date(a.starts_at).getTime() : null;
      await appts.updateAppointment(ctx, a.id, {
        type_id: a.type_id,
        title: a.title,
        starts_at: input.starts_at,
        ends_at: length ? new Date(new Date(input.starts_at).getTime() + length).toISOString() : null,
        format: a.format,
        location: a.location,
        online_url: a.online_url,
        event_id: a.event_id,
        version: input.version,
      });
      const changes: HistoryChanges = {};
      if (await dropMark(ctx, 'appointment', a.id, changes))
        await writeHistory(ctx, 'appointment', a.id, 'unmarked', changes);
      entity = { type: 'appointment', id: a.id };
      line = {
        group: 'termine',
        text: `Verschoben: ${a.title} → ${day(input.starts_at)} (Zusagen und ohne Antwort benachrichtigt)`,
      };
      break;
    }
    case 'appointment_cancel': {
      const a = await appts.findAppointment(ctx.trx, input.id);
      if (await appts.isPlenum(ctx.trx, a))
        throw rule('Ein Plenum lässt sich nicht aus einem Plenum heraus absagen.');
      const attendees = await ctx.trx
        .selectFrom('appointment_attendees')
        .selectAll()
        .where('appointment_id', '=', a.id)
        .execute();
      ctx.inverse.push({ kind: 'appointment_state', appointment_id: a.id, status: a.status, attendees });
      await appts.cancelAppointment(ctx, a.id, input.version);
      entity = { type: 'appointment', id: a.id };
      line = { group: 'termine', text: `Abgesagt: ${a.title} (Zusagen und ohne Antwort benachrichtigt)` };
      break;
    }
    case 'sub_task': {
      if (!(await isMarked(ctx.trx, input.target, input.id)))
        throw rule('Dieser Punkt steht nicht mehr auf der Agenda.');
      const fallbackTopic = plenum.topic_id;
      let task: TaskRow;
      let about: string;
      if (input.target === 'event') {
        const event = await findEvent(ctx, input.id);
        about = event.title;
        const topic = await ctx.trx
          .selectFrom('topics')
          .select('id')
          .where('name', '=', 'Veranstaltungen')
          .where('archived_at', 'is', null)
          .where('parent_id', 'is', null)
          .executeTakeFirst();
        task = await plannedTask(ctx, plenum, {
          ...input,
          topic_id: topic?.id ?? fallbackTopic,
          event_id: event.id,
        });
      } else if (input.target === 'appointment') {
        const a = await appts.findAppointment(ctx.trx, input.id);
        about = a.title;
        task = await plannedTask(ctx, plenum, {
          ...input,
          topic_id: a.topic_id,
          appointment_id: a.id,
          event_id: a.event_id,
        });
      } else if (input.target === 'partner') {
        const partner = await findPartner(ctx.trx, input.id, false);
        about = partner.name;
        task = await plannedTask(ctx, plenum, { ...input, topic_id: fallbackTopic });
      } else {
        const doc = await ctx.trx
          .selectFrom('documents')
          .selectAll()
          .where('id', '=', input.id)
          .executeTakeFirst();
        if (!doc) throw notFound('Dieses Dokument');
        about = doc.title;
        task = await plannedTask(ctx, plenum, { ...input, topic_id: doc.topic_id ?? fallbackTopic });
        await know.linkDocument(ctx, doc.id, 'task', task.id);
      }
      // der Punkt selbst bleibt auf der Agenda
      entity = { type: 'task', id: task.id };
      line = {
        group: 'aufgaben',
        text: `Neu eingeplant: ${task.title} (zu „${about}“)${await whoWhen(ctx.trx, task.id)}`,
      };
      break;
    }
    case 'discussed': {
      const found = (await ctx.trx
        .selectFrom(TABLE_OF[input.target])
        .selectAll()
        .where('id', '=', input.id)
        .executeTakeFirst()) as { id: string; title?: string; name?: string } | undefined;
      if (!found) throw notFound('Diesen Eintrag');
      const row = { id: found.id, title: found.title ?? found.name ?? '' };
      const changes: HistoryChanges = {};
      if (!(await dropMark(ctx, input.target, input.id, changes)))
        throw rule('Dieser Punkt steht nicht mehr auf der Agenda.');
      const suffix =
        input.target === 'question'
          ? ' (Frage bleibt offen)'
          : input.target === 'decision'
            ? ' (bestätigt)'
            : '';
      entity = { type: input.target, id: row.id };
      line = { group: 'besprochen', text: `${row.title}${suffix}` };
      action = 'discussed';
      break;
    }
  }

  await logLine(ctx, plenum, entity.type, entity.id, line, action);
  ctx.deferUndo = false;
  const row = (await ctx.trx
    .selectFrom(TABLE_OF[entity.type])
    .select(['id', 'version'])
    .where('id', '=', entity.id)
    .executeTakeFirstOrThrow()) as { id: string; version: number };
  return registerUndo(ctx, entity.type, row, line.text);
}

/** WF-PLE-04: Reihenfolge der Agenda – für alle gleich; beim gleichzeitigen Umsortieren gilt die letzte. */
export async function moveMark(ctx: Ctx, markId: unknown, toIndex: unknown): Promise<void> {
  if (typeof markId !== 'string' || typeof toIndex !== 'number' || !Number.isInteger(toIndex))
    throw new AppError('validation', 'Diese Position gibt es nicht.');
  await sql`select pg_advisory_xact_lock(hashtext('plenum_marks'))`.execute(ctx.trx);
  const ordered = await ctx.trx
    .selectFrom('plenum_marks')
    .select('id')
    .orderBy('position')
    .orderBy('marked_at')
    .execute();
  const from = ordered.findIndex((m) => m.id === markId);
  if (from < 0) return; // inzwischen von der Agenda verschwunden – nichts geht verloren
  const [moved] = ordered.splice(from, 1);
  ordered.splice(Math.max(0, Math.min(toIndex, ordered.length)), 0, moved!);
  for (const [i, m] of ordered.entries())
    await ctx.trx
      .updateTable('plenum_marks')
      .set({ position: i + 1 })
      .where('id', '=', m.id)
      .execute();
}

/** WF-PLE-05: im Plenum neu anlegen */
export async function plenumAdd(
  ctx: Ctx,
  plenumId: string,
  raw: unknown,
): Promise<{ id: string; on_agenda: boolean }> {
  const input = parse(plenumAddSchema, raw);
  const plenum = await openPlenum(ctx, plenumId);
  if (input.kind === 'aufgabe') {
    const { id } = await createTask(ctx, {
      title: input.title,
      topic_id: input.topic_id,
      mark_for_plenum: true,
    });
    await setOrigin(ctx, id, plenum.id);
    return { id, on_agenda: true };
  }
  if (input.kind === 'frage') {
    const { id } = await know.createQuestion(
      ctx,
      { title: input.title, topic_id: input.topic_id, mark_for_plenum: true },
      plenum.id,
    );
    return { id, on_agenda: true };
  }
  // Entscheidungen und Fakten gehen mit diesem Plenum als Quelle direkt ins Ergebnis
  const { id } = await know.createDecision(ctx, {
    title: input.title,
    kind: input.kind,
    topic_id: input.topic_id,
    source_plenum_id: plenum.id,
  });
  await logLine(ctx, plenum, 'decision', id, {
    group: 'beschluesse',
    text: `${input.kind === 'fakt' ? 'Neuer Fakt' : 'Neue Entscheidung'}: ${input.title}`,
  });
  return { id, on_agenda: false };
}

/** WF-PLE-03 Protokoll */
export async function updateProtocol(ctx: Ctx, plenumId: string, raw: unknown): Promise<void> {
  const input = parse(protocolSchema, raw);
  const plenum = await findPlenum(ctx.trx, plenumId);
  await checkVersion(ctx, 'appointment', plenum, input.version);
  if (input.protocol_member_id) {
    const member = await ctx.trx
      .selectFrom('members')
      .select('id')
      .where('id', '=', input.protocol_member_id)
      .where('is_system', '=', false)
      .executeTakeFirst();
    if (!member)
      throw new AppError('validation', 'Diese Person gibt es nicht.', { field: 'protocol_member_id' });
  }
  if (input.protocol_document_id) {
    const doc = await ctx.trx
      .selectFrom('documents')
      .select('id')
      .where('id', '=', input.protocol_document_id)
      .where('archived_at', 'is', null)
      .executeTakeFirst();
    if (!doc)
      throw new AppError('validation', 'Dieses Dokument gibt es nicht mehr.', {
        field: 'protocol_document_id',
      });
  }
  const changes: HistoryChanges = {};
  const set: Partial<AppointmentRow> = {};
  for (const key of ['protocol_member_id', 'notes', 'protocol_document_id'] as const) {
    if (plenum[key] === input[key]) continue;
    changes[key] = { old: plenum[key], new: input[key] };
    set[key] = input[key];
  }
  if (Object.keys(changes).length === 0) return;
  await appts.touchAppointment(ctx, plenum, set);
  await writeHistory(ctx, 'appointment', plenumId, 'protocol', changes);
}

/** Zusammenfassung an alle aktiven Mitglieder (F-PLE-04): kurz, mit Link */
export async function summaryText(trx: Trx, plenum: AppointmentRow): Promise<string> {
  const groups = await results(trx, plenum.id);
  if (groups.length === 0)
    return `${plenum.title} ist abgeschlossen – es wurde nichts beschlossen oder besprochen.`;
  const parts = groups.map((g) => `${RESULT_TITLE[g.group]}: ${g.lines.join('; ')}`);
  return `${plenum.title} ist abgeschlossen. ${parts.join(' · ')}`;
}

/**
 * WF-PLE-20 „Plenum abschließen“: setzt „stattgefunden“ mit, hält die Teilnahme fest und verschickt die
 * Zusammenfassung. Was nicht behandelt wurde, bleibt markiert. Eine Transaktion.
 */
export async function closePlenum(
  ctx: Ctx,
  plenumId: string,
  attendeeIds: unknown,
  version: number,
): Promise<{ recipients: number }> {
  if (!Array.isArray(attendeeIds)) throw rule('Unbekannte Person in der Teilnahmeliste.');
  const plenum = await openPlenum(ctx, plenumId);
  await checkVersion(ctx, 'appointment', plenum, version);
  if (!hasStarted(plenum, ctx.now)) throw rule('Abschließen geht erst, wenn das Plenum begonnen hat.');
  await appts.replaceAttendees(ctx, plenumId, attendeeIds);
  const recipients = await appts.activeIds(ctx.trx);
  const text = await summaryText(ctx.trx, plenum);
  await enqueue(
    ctx.trx,
    ctx.now,
    recipients.map((member_id) => ({
      member_id,
      event_type: 'plenum_zusammenfassung' as const,
      text,
      link: `/termine/${plenumId}`,
      dedupe_key: `plenum_zusammenfassung:${plenumId}:${member_id}`,
    })),
  );
  const from = plenum.status;
  await appts.touchAppointment(ctx, plenum, { status: 'abgeschlossen' });
  await writeHistory(ctx, 'appointment', plenumId, 'closed', {
    status: { old: from, new: 'abgeschlossen' },
    attendees: { old: null, new: attendeeIds.length },
    recipients: { old: null, new: recipients.length },
  });
  return { recipients: recipients.length };
}
