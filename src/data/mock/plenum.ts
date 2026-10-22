// Testdaten-Schicht, Phase 3: Plenum – Agenda aus allen Markierungen, Aktionen je Art, Ergebnis,
// Protokoll und Abschluss (ANFORDERUNGEN 3.14, 4.3, F-PLE-01 bis -05, WF-PLE-03 bis -20)
import { AppError } from '../../shared/errors';
import { formatDayMonth } from '../../shared/format';
import { EVENT_STATUS_LABEL, PRIORITY_LABEL, TASK_STATUS_LABEL } from '../../shared/labels';
import { hasStarted } from '../../shared/rules/appointments';
import { isOverdue, toIsoDate } from '../../shared/rules/due';
import { canTransitionEvent } from '../../shared/rules/eventStatus';
import { DECISION_KIND_LABEL, DOC_TYPE_LABEL } from '../../shared/rules/knowledge';
import { isActiveTaskStatus } from '../../shared/rules/taskStatus';
import {
  MARK_TARGETS,
  plenumActionSchema,
  plenumAddSchema,
  protocolSchema,
  RESULT_GROUPS,
  type Appointment,
  type HistoryChanges,
  type HistoryEntityType,
  type MarkTarget,
  type ResultGroup,
  type Task,
} from '../../shared/schema';
import type { AgendaItem, PlenumDetail, Undoable } from '../api';
import * as appts from './appointments';
import * as know from './knowledge';
import * as partners from './partners';
import { enqueue } from './notify';
import * as server from './server';
import {
  checkVersion,
  dropMark,
  isMarked,
  notFound,
  parse,
  registerUndo,
  rule,
  touch,
  writeHistory,
  type Ctx,
  type Db,
  type UndoEntity,
} from './server';

const day = (iso: string) => formatDayMonth(new Date(iso));
const dueText = (isoDate: string) => {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return formatDayMonth(new Date(y, m - 1, d));
};
const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'] as const;

function findPlenum(db: Db, id: string): Appointment {
  const plenum = appts.findAppointment(db, id);
  if (!appts.isPlenum(db, plenum)) throw rule('Das geht nur bei einem Plenum.');
  return plenum;
}

/** Agenda-Aktionen gehen, solange das Plenum weder abgeschlossen noch abgesagt ist. */
function openPlenum(ctx: Ctx, id: string): Appointment {
  const plenum = findPlenum(ctx.db, id);
  if (plenum.status === 'abgeschlossen') throw rule('Dieses Plenum ist schon abgeschlossen.');
  if (plenum.status === 'abgesagt') throw rule('Dieses Plenum wurde abgesagt.');
  return plenum;
}

const plenumLabel = (plenum: Appointment) => `${plenum.title} vom ${day(plenum.starts_at)}`;

// ── Agenda: eine gemeinsame Liste aller markierten Objekte (F-PLE-03) ───────

const column = (target: MarkTarget) => `${target}_id` as const;

export function agenda(db: Db, now: Date): AgendaItem[] {
  const today = toIsoDate(now);
  const items: AgendaItem[] = [];
  for (const mark of [...db.plenum_marks].sort((a, b) => a.position - b.position)) {
    const target = MARK_TARGETS.find((t) => mark[column(t)])!;
    const id = mark[column(target)]!;
    const base = { mark_id: mark.id, target, id };
    if (target === 'task') {
      const t = db.tasks.find((x) => x.id === id);
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
        assignee_ids: db.task_assignees.filter((a) => a.task_id === t.id).map((a) => a.member_id),
        due_date: t.due_date,
        event_id: t.event_id,
      });
    } else if (target === 'question') {
      const q = db.questions.find((x) => x.id === id);
      if (!q) continue;
      items.push({
        ...base,
        title: q.title,
        version: q.version,
        label: `Frage · ${PRIORITY_LABEL[q.urgency]}`,
        tone: 'bernstein',
      });
    } else if (target === 'decision') {
      const d = db.decisions.find((x) => x.id === id);
      if (!d) continue;
      items.push({
        ...base,
        title: d.title,
        version: d.version,
        label: `${DECISION_KIND_LABEL[d.kind]} · Gültig`,
        tone: 'gruen',
      });
    } else if (target === 'event') {
      const e = db.events.find((x) => x.id === id);
      if (!e) continue;
      const open = db.tasks.filter(
        (t) => t.event_id === e.id && !t.archived_at && isActiveTaskStatus(t.status),
      ).length;
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
      const a = db.appointments.find((x) => x.id === id);
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
      const p = db.partners.find((x) => x.id === id);
      if (!p) continue;
      const count = db.event_partners.filter((ep) => ep.partner_id === p.id).length;
      items.push({
        ...base,
        title: p.name,
        version: p.version,
        label: ['Partner', p.kind, `${count} ${count === 1 ? 'Veranstaltung' : 'Veranstaltungen'}`]
          .filter(Boolean)
          .join(' · '),
        tone: 'violett',
      });
    } else {
      const d = db.documents.find((x) => x.id === id);
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

export function results(db: Db, plenumId: string): { group: ResultGroup; lines: string[] }[] {
  // zurückgenommene Aktionen zählen nicht
  const undone = new Set(
    db.history.flatMap((h) =>
      h.action === 'undo' ? ((h.changes.history_ids?.old as string[] | undefined) ?? []) : [],
    ),
  );
  const lines = db.history
    .filter((h) => h.changes.plenum_id?.new === plenumId && h.changes.plenum_line && !undone.has(h.id))
    .map((h) => h.changes.plenum_line!.new as Line);
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

export function getPlenum(db: Db, id: string, meId: string, now: Date): PlenumDetail {
  const plenum = findPlenum(db, id);
  const doc = plenum.protocol_document_id
    ? db.documents.find((d) => d.id === plenum.protocol_document_id)
    : undefined;
  const summary = db.history.find(
    (h) => h.entity_type === 'appointment' && h.entity_id === id && h.action === 'closed',
  );
  return {
    ...appts.getAppointment(db, id, meId),
    agenda: agenda(db, now),
    results: results(db, id),
    protocol_document: doc ? { id: doc.id, title: doc.title, url: doc.url } : null,
    summary_recipients: summary ? Number(summary.changes.recipients?.new ?? 0) : null,
  };
}

/** Eintrag „im Plenum vom …“ in der Historie des Objekts; daraus entsteht auch das Ergebnis. */
function logLine(
  ctx: Ctx,
  plenum: Appointment,
  type: HistoryEntityType,
  id: string,
  line: Line,
  action = 'plenum',
): void {
  writeHistory(ctx, type, id, action, {
    plenum_id: { old: null, new: plenum.id },
    plenum_label: { old: null, new: plenumLabel(plenum) },
    plenum_line: { old: null, new: line },
  });
}

// ── Aktionen in der Agenda (F-PLE-05) ───────────────────────────────────────

const memberName = (db: Db, id: string | null) =>
  id ? (db.members.find((m) => m.id === id)?.display_name ?? null) : null;
/** „· Jule, Mo · bis 30.10.“ – mit allen Bearbeitenden, wie es in die Zusammenfassung gehört (F-PLE-04) */
const whoWhen = (db: Db, task: Task) =>
  [
    db.task_assignees
      .filter((a) => a.task_id === task.id)
      .map((a) => memberName(db, a.member_id))
      .filter(Boolean)
      .join(', '),
    task.due_date && `bis ${dueText(task.due_date)}`,
  ]
    .filter(Boolean)
    .map((part) => ` · ${part}`)
    .join('');

function setDue(ctx: Ctx, task: Task, dueDate: string | null): void {
  if (!dueDate || dueDate === task.due_date) return;
  writeHistory(ctx, 'task', task.id, 'updated', { due_date: { old: task.due_date, new: dueDate } });
  task.due_date = dueDate;
}

/** Legt eine Aufgabe an, die gleich „geplant“ ist – Herkunft dieses Plenum (WF-PLE-11, WF-PLE-17). */
function plannedTask(
  ctx: Ctx,
  plenum: Appointment,
  input: {
    title: string;
    topic_id: string;
    event_id?: string | null;
    appointment_id?: string | null;
    assignee_id: string | null;
    due_date: string | null;
  },
): Task {
  const { id } = server.createTask(ctx, {
    title: input.title,
    topic_id: input.topic_id,
    event_id: input.event_id ?? null,
    appointment_id: input.appointment_id ?? null,
    due_date: input.due_date,
    mark_for_plenum: false,
  });
  ctx.inverse.push({ kind: 'task_delete', task_id: id });
  server.setTaskStatus(ctx, id, { status: 'geplant', version: 1 });
  const task = server.findTask(ctx.db, id);
  task.origin_plenum_id = plenum.id;
  if (input.assignee_id) server.addAssignee(ctx, id, input.assignee_id);
  return task;
}

export function plenumAction(ctx: Ctx, plenumId: string, raw: unknown): Undoable {
  const input = parse(plenumActionSchema, raw);
  const plenum = openPlenum(ctx, plenumId);
  const db = ctx.db;
  let entity: { type: UndoEntity; row: { id: string; version: number } };
  let line: Line;
  let action = 'plenum';

  switch (input.kind) {
    case 'task_plan': {
      const task = server.findTask(db, input.id);
      if (task.status !== 'neu') throw rule('Einplanen geht nur bei neuen Aufgaben.');
      ctx.inverse.push({
        kind: 'task_fields',
        task_id: task.id,
        due_date: task.due_date,
        origin_plenum_id: task.origin_plenum_id,
      });
      server.setTaskStatus(ctx, task.id, { status: 'geplant', version: input.version });
      task.origin_plenum_id = plenum.id;
      setDue(ctx, task, input.due_date);
      if (input.assignee_id) server.addAssignee(ctx, task.id, input.assignee_id);
      entity = { type: 'task', row: task };
      line = {
        group: 'aufgaben',
        text: `Eingeplant: ${task.title}${whoWhen(db, task)}`,
      };
      break;
    }
    case 'task_replan': {
      const task = server.findTask(db, input.id);
      if (task.status !== 'geplant' && task.status !== 'in_arbeit')
        throw rule('Umplanen geht nur bei geplanten Aufgaben und Aufgaben in Arbeit.');
      checkVersion(ctx, 'task', task, input.version);
      ctx.inverse.push({
        kind: 'task_fields',
        task_id: task.id,
        due_date: task.due_date,
        origin_plenum_id: task.origin_plenum_id,
      });
      if (input.assignee_id) {
        // die gewählte Person übernimmt; der Status bleibt
        server.addAssignee(ctx, task.id, input.assignee_id);
        for (const row of db.task_assignees.filter(
          (a) => a.task_id === task.id && a.member_id !== input.assignee_id,
        ))
          server.removeAssignee(ctx, task.id, row.member_id);
      }
      setDue(ctx, task, input.due_date);
      const changes: HistoryChanges = {};
      if (dropMark(ctx, 'task', task.id, changes)) writeHistory(ctx, 'task', task.id, 'unmarked', changes);
      touch(ctx, task);
      entity = { type: 'task', row: task };
      line = {
        group: 'aufgaben',
        text: `Umgeplant: ${task.title}${whoWhen(db, task)}`,
      };
      break;
    }
    case 'task_unblock': {
      const task = server.findTask(db, input.id);
      if (task.status !== 'blockiert') throw rule('Diese Aufgabe ist nicht blockiert.');
      server.setTaskStatus(ctx, task.id, { status: input.to, version: input.version }, { selfAssign: false });
      entity = { type: 'task', row: task };
      line = { group: 'aufgaben', text: `Blockade gelöst: ${task.title} → ${TASK_STATUS_LABEL[input.to]}` };
      break;
    }
    case 'task_finish': {
      const task = server.findTask(db, input.id);
      if (!isActiveTaskStatus(task.status)) throw rule('Diese Aufgabe ist schon abgeschlossen.');
      server.setTaskStatus(ctx, task.id, { status: input.to, version: input.version });
      const who = db.task_assignees
        .filter((a) => a.task_id === task.id)
        .map((a) => memberName(db, a.member_id))
        .filter(Boolean)
        .join(', ');
      entity = { type: 'task', row: task };
      line = {
        group: 'aufgaben',
        text: `${input.to === 'erledigt' ? 'Erledigt' : 'Verworfen'}: ${task.title}${who ? ` · ${who}` : ''}`,
      };
      break;
    }
    case 'question_clarify': {
      const question = db.questions.find((q) => q.id === input.id);
      if (!question) throw notFound('Diese Frage');
      const { decision_id } = know.clarifyQuestion(
        ctx,
        question.id,
        { answer: input.answer, result: input.result, version: input.version },
        plenum.id,
      );
      if (decision_id)
        logLine(ctx, plenum, 'decision', decision_id, {
          group: 'beschluesse',
          text: `${input.result === 'fakt' ? 'Neuer Fakt' : 'Neue Entscheidung'}: ${question.title} – ${input.answer}`,
        });
      if (input.follow_up) {
        const task = plannedTask(ctx, plenum, {
          title: `Folgeaufgabe: ${question.title}`.slice(0, 200),
          topic_id: question.topic_id,
          event_id: question.event_id,
          assignee_id: null,
          due_date: null,
        });
        logLine(ctx, plenum, 'task', task.id, { group: 'aufgaben', text: `Neu eingeplant: ${task.title}` });
      }
      entity = { type: 'question', row: question };
      line = { group: 'fragen', text: `Geklärt: ${question.title} – ${input.answer}` };
      break;
    }
    case 'question_discard': {
      const question = db.questions.find((q) => q.id === input.id);
      if (!question) throw notFound('Diese Frage');
      know.discardQuestion(ctx, question.id, input.version, plenum.id);
      entity = { type: 'question', row: question };
      line = { group: 'fragen', text: `Verworfen: ${question.title}` };
      break;
    }
    case 'decision_replace': {
      const old = db.decisions.find((d) => d.id === input.id);
      if (!old) throw notFound('Diesen Eintrag');
      know.replaceDecision(ctx, old.id, {
        title: input.title,
        description: input.description,
        source_plenum_id: plenum.id,
        version: input.version,
      });
      entity = { type: 'decision', row: old };
      line = { group: 'beschluesse', text: `Ersetzt: „${old.title}“ → „${input.title}“` };
      break;
    }
    case 'decision_revoke': {
      const decision = db.decisions.find((d) => d.id === input.id);
      if (!decision) throw notFound('Diesen Eintrag');
      know.revokeDecision(ctx, decision.id, input.note || null, input.version, plenum.id);
      entity = { type: 'decision', row: decision };
      line = { group: 'beschluesse', text: `Aufgehoben: ${decision.title}` };
      break;
    }
    case 'event_status': {
      const event = server.findEvent(db, input.id);
      if (!canTransitionEvent(event.status, input.to))
        throw rule(
          `Von „${EVENT_STATUS_LABEL[event.status]}“ nach „${EVENT_STATUS_LABEL[input.to]}“ geht es nicht.`,
        );
      server.setEventStatus(ctx, event.id, input.to, input.version);
      const verb: Partial<Record<typeof input.to, string>> = {
        in_planung: 'In Planung genommen',
        bestaetigt: 'Bestätigt',
        in_nachbereitung: 'In Nachbereitung',
        abgeschlossen: 'Abgeschlossen',
        abgesagt: 'Abgesagt',
      };
      entity = { type: 'event', row: event };
      line = { group: 'termine', text: `${verb[input.to]}: ${event.title}` };
      break;
    }
    case 'appointment_move': {
      const a = appts.findAppointment(db, input.id);
      if (appts.isPlenum(db, a))
        throw rule('Ein Plenum lässt sich nicht aus einem Plenum heraus verschieben.');
      if (a.status !== 'geplant') throw rule('Nur geplante Termine lassen sich verschieben.');
      ctx.inverse.push({
        kind: 'appointment_times',
        appointment_id: a.id,
        starts_at: a.starts_at,
        ends_at: a.ends_at,
      });
      const length = a.ends_at ? new Date(a.ends_at).getTime() - new Date(a.starts_at).getTime() : null;
      appts.updateAppointment(ctx, a.id, {
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
      if (dropMark(ctx, 'appointment', a.id, changes))
        writeHistory(ctx, 'appointment', a.id, 'unmarked', changes);
      entity = { type: 'appointment', row: a };
      line = {
        group: 'termine',
        text: `Verschoben: ${a.title} → ${day(input.starts_at)} (Zusagen und ohne Antwort benachrichtigt)`,
      };
      break;
    }
    case 'appointment_cancel': {
      const a = appts.findAppointment(db, input.id);
      if (appts.isPlenum(db, a)) throw rule('Ein Plenum lässt sich nicht aus einem Plenum heraus absagen.');
      ctx.inverse.push({
        kind: 'appointment_state',
        appointment_id: a.id,
        status: a.status,
        attendees: db.appointment_attendees.filter((x) => x.appointment_id === a.id),
      });
      appts.cancelAppointment(ctx, a.id, input.version);
      entity = { type: 'appointment', row: a };
      line = { group: 'termine', text: `Abgesagt: ${a.title} (Zusagen und ohne Antwort benachrichtigt)` };
      break;
    }
    case 'sub_task': {
      if (!isMarked(db, input.target, input.id)) throw rule('Dieser Punkt steht nicht mehr auf der Agenda.');
      const fallbackTopic = plenum.topic_id;
      let task: Task;
      let about: string;
      if (input.target === 'event') {
        const event = server.findEvent(db, input.id);
        about = event.title;
        const topic = db.topics.find((t) => t.name === 'Veranstaltungen' && !t.archived_at && !t.parent_id);
        task = plannedTask(ctx, plenum, {
          ...input,
          topic_id: topic?.id ?? fallbackTopic,
          event_id: event.id,
        });
      } else if (input.target === 'appointment') {
        const a = appts.findAppointment(db, input.id);
        about = a.title;
        task = plannedTask(ctx, plenum, {
          ...input,
          topic_id: a.topic_id,
          appointment_id: a.id,
          event_id: a.event_id,
        });
      } else if (input.target === 'partner') {
        const partner = partners.findPartner(db, input.id);
        about = partner.name;
        task = plannedTask(ctx, plenum, { ...input, topic_id: fallbackTopic });
      } else {
        const doc = db.documents.find((d) => d.id === input.id);
        if (!doc) throw notFound('Dieses Dokument');
        about = doc.title;
        task = plannedTask(ctx, plenum, { ...input, topic_id: doc.topic_id ?? fallbackTopic });
        know.linkDocument(ctx, doc.id, 'task', task.id);
      }
      // der Punkt selbst bleibt auf der Agenda
      entity = { type: 'task', row: task };
      line = {
        group: 'aufgaben',
        text: `Neu eingeplant: ${task.title} (zu „${about}“)${whoWhen(db, task)}`,
      };
      break;
    }
    case 'discussed': {
      const table = {
        task: db.tasks,
        question: db.questions,
        decision: db.decisions,
        event: db.events,
        appointment: db.appointments,
        document: db.documents,
        partner: db.partners,
      }[input.target] as readonly ({ id: string; version: number } & (
        { title: string } | { name: string }
      ))[];
      const row = table.find((x) => x.id === input.id);
      if (!row) throw notFound('Diesen Eintrag');
      const name = 'title' in row ? row.title : row.name;
      const changes: HistoryChanges = {};
      if (!dropMark(ctx, input.target, input.id, changes))
        throw rule('Dieser Punkt steht nicht mehr auf der Agenda.');
      const suffix =
        input.target === 'question'
          ? ' (Frage bleibt offen)'
          : input.target === 'decision'
            ? ' (bestätigt)'
            : '';
      entity = { type: input.target, row };
      line = { group: 'besprochen', text: `${name}${suffix}` };
      action = 'discussed';
      break;
    }
  }

  logLine(ctx, plenum, entity.type, entity.row.id, line, action);
  // die Teilschritte haben eigene Rückgängig-Einträge angelegt – es bleibt genau einer für die ganze Aktion
  ctx.db.undo = ctx.db.undo.filter((u) => u.ops !== ctx.inverse);
  // dabei angelegte Aufgaben verschwinden zuletzt, nachdem ihre eigenen Schritte zurückgenommen sind
  ctx.inverse.sort((a, b) => Number(a.kind === 'task_delete') - Number(b.kind === 'task_delete'));
  return registerUndo(ctx, entity.type, entity.row, line.text);
}

/** WF-PLE-04: Reihenfolge der Agenda – für alle gleich; beim gleichzeitigen Umsortieren gilt die letzte. */
export function moveMark(ctx: Ctx, markId: string, toIndex: number): void {
  const ordered = [...ctx.db.plenum_marks].sort((a, b) => a.position - b.position);
  const from = ordered.findIndex((m) => m.id === markId);
  if (from < 0) return; // inzwischen von der Agenda verschwunden – nichts geht verloren
  const [moved] = ordered.splice(from, 1);
  ordered.splice(Math.max(0, Math.min(toIndex, ordered.length)), 0, moved!);
  ordered.forEach((m, i) => (m.position = i + 1));
}

/** WF-PLE-05: im Plenum neu anlegen */
export function plenumAdd(ctx: Ctx, plenumId: string, raw: unknown): { id: string; on_agenda: boolean } {
  const input = parse(plenumAddSchema, raw);
  const plenum = openPlenum(ctx, plenumId);
  if (input.kind === 'aufgabe') {
    const { id } = server.createTask(ctx, {
      title: input.title,
      topic_id: input.topic_id,
      mark_for_plenum: true,
    });
    server.findTask(ctx.db, id).origin_plenum_id = plenum.id;
    return { id, on_agenda: true };
  }
  if (input.kind === 'frage') {
    const { id } = know.createQuestion(
      ctx,
      { title: input.title, topic_id: input.topic_id, mark_for_plenum: true },
      plenum.id,
    );
    return { id, on_agenda: true };
  }
  // Entscheidungen und Fakten gehen mit diesem Plenum als Quelle direkt ins Ergebnis
  const { id } = know.createDecision(ctx, {
    title: input.title,
    kind: input.kind,
    topic_id: input.topic_id,
    source_plenum_id: plenum.id,
  });
  logLine(ctx, plenum, 'decision', id, {
    group: 'beschluesse',
    text: `${input.kind === 'fakt' ? 'Neuer Fakt' : 'Neue Entscheidung'}: ${input.title}`,
  });
  return { id, on_agenda: false };
}

/** WF-PLE-03 Protokoll */
export function updateProtocol(ctx: Ctx, plenumId: string, raw: unknown): void {
  const input = parse(protocolSchema, raw);
  const plenum = findPlenum(ctx.db, plenumId);
  checkVersion(ctx, 'appointment', plenum, input.version);
  if (
    input.protocol_member_id &&
    !ctx.db.members.some((m) => m.id === input.protocol_member_id && !m.is_system)
  )
    throw new AppError('validation', 'Diese Person gibt es nicht.', { field: 'protocol_member_id' });
  if (input.protocol_document_id && !ctx.db.documents.some((d) => d.id === input.protocol_document_id))
    throw new AppError('validation', 'Dieses Dokument gibt es nicht mehr.', {
      field: 'protocol_document_id',
    });
  const changes: HistoryChanges = {};
  for (const key of ['protocol_member_id', 'notes', 'protocol_document_id'] as const) {
    if (plenum[key] === input[key]) continue;
    changes[key] = { old: plenum[key], new: input[key] };
    plenum[key] = input[key];
  }
  if (Object.keys(changes).length === 0) return;
  touch(ctx, plenum);
  writeHistory(ctx, 'appointment', plenumId, 'protocol', changes);
}

/** Zusammenfassung an alle aktiven Mitglieder (F-PLE-04): kurz, mit Link */
export function summaryText(db: Db, plenum: Appointment): string {
  const groups = results(db, plenum.id);
  if (groups.length === 0)
    return `${plenum.title} ist abgeschlossen – es wurde nichts beschlossen oder besprochen.`;
  const parts = groups.map((g) => `${RESULT_TITLE[g.group]}: ${g.lines.join('; ')}`);
  return `${plenum.title} ist abgeschlossen. ${parts.join(' · ')}`;
}

/**
 * WF-PLE-20 „Plenum abschließen“: setzt „stattgefunden“ mit, hält die Teilnahme fest und verschickt die
 * Zusammenfassung. Was nicht behandelt wurde, bleibt markiert. Eine Transaktion.
 */
export function closePlenum(
  ctx: Ctx,
  plenumId: string,
  attendeeIds: readonly string[],
  version: number,
): { recipients: number } {
  const plenum = openPlenum(ctx, plenumId);
  checkVersion(ctx, 'appointment', plenum, version);
  if (!hasStarted(plenum, ctx.now)) throw rule('Abschließen geht erst, wenn das Plenum begonnen hat.');
  const db = ctx.db;
  for (const id of attendeeIds)
    if (!db.members.some((m) => m.id === id && !m.is_system))
      throw rule('Unbekannte Person in der Teilnahmeliste.');
  db.appointment_attendees = db.appointment_attendees
    .filter((x) => x.appointment_id !== plenumId)
    .concat([...new Set(attendeeIds)].map((member_id) => ({ appointment_id: plenumId, member_id })));
  const recipients = db.members.filter((m) => m.active && !m.is_system);
  const text = summaryText(db, plenum);
  enqueue(
    db,
    ctx.now,
    recipients.map((m) => ({
      member_id: m.id,
      event_type: 'plenum_zusammenfassung' as const,
      text,
      link: `/termine/${plenumId}`,
      dedupe_key: `plenum_zusammenfassung:${plenumId}:${m.id}`,
    })),
  );
  const from = plenum.status;
  plenum.status = 'abgeschlossen';
  touch(ctx, plenum);
  writeHistory(ctx, 'appointment', plenumId, 'closed', {
    status: { old: from, new: 'abgeschlossen' },
    attendees: { old: null, new: attendeeIds.length },
    recipients: { old: null, new: recipients.length },
  });
  return { recipients: recipients.length };
}
