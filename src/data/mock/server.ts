// Testdaten-Schicht, Serverseite: dieselben fachlichen Regeln, die in Schritt C die
// Netlify Functions durchsetzen (ANFORDERUNGEN 4, 5.8, 7.2) – hier gegen eine Datenbank im Speicher.
// Jede Funktion läuft in einer Transaktion (siehe transact in mockApi.ts) und schreibt die Historie mit.
import type { ZodType } from 'zod';
import { AppError, validationErrorFromZod } from '../../shared/errors';
import { EVENT_STATUS_LABEL, TASK_STATUS_LABEL } from '../../shared/labels';
import { canRsvp } from '../../shared/rules/appointments';
import { wouldCreateBlockerCycle } from '../../shared/rules/blockers';
import { UNDO_WINDOW_MS } from '../../shared/rules/undo';
import { isOverdue, toIsoDate } from '../../shared/rules/due';
import {
  assignmentMessages,
  commentMessages,
  statusMessages,
  unblockedMessages,
} from '../../shared/rules/notifications';
import { countsForPlenum } from '../../shared/rules/plenum';
import { canTransitionEvent } from '../../shared/rules/eventStatus';
import { decisionActive } from '../../shared/rules/knowledge';
import {
  BLOCK_REASON_MISSING,
  blockReasonMissing,
  LAST_BLOCKER,
  canTransitionTask,
  isActiveTaskStatus,
  statusAfterLastAssigneeLeft,
} from '../../shared/rules/taskStatus';
import {
  commentBodySchema,
  eventCreateSchema,
  eventUpdateSchema,
  emailInputSchema,
  memberCreateSchema,
  memberUpdateSchema,
  profileNameSchema,
  memberIdsSchema,
  taskCreateSchema,
  taskDescriptionSchema,
  taskFieldsSchema,
  taskStatusChangeSchema,
  topicCreateSchema,
  topicUpdateSchema,
  type Comment,
  type EventBooking,
  type EventDetails,
  type EventLead,
  type EventPartner,
  type EventTemplate,
  type EventTemplateItem,
  type TemplateApplication,
  type Partner,
  type EventRow,
  type EventStatus,
  type HistoryChanges,
  type HistoryEntityType,
  type HistoryEntry,
  type Appointment,
  type AppointmentAttendee,
  type AppointmentRsvp,
  type AppointmentSeries,
  type AppointmentStatus,
  type AppointmentType,
  type Decision,
  type DecisionVote,
  type MarkReason,
  type AppReport,
  type DocumentLink,
  type DocumentRow,
  type DriveItem,
  type DriveSyncState,
  type Question,
  type JobRun,
  type OutboxEntry,
  type PushSubscriptionRow,
  type NotificationPreference,
  type TelegramLink,
  type TelegramLinkCode,
  type Member,
  type MemberEmail,
  type PlenumMark,
  type Task,
  type TaskAssignee,
  type TaskBlocker,
  type TaskFollower,
  type TaskStatus,
  type Topic,
} from '../../shared/schema';
import type {
  DeactivationImpact,
  EventListItem,
  TaskDetail,
  TaskListItem,
  TopicWithUsage,
  Undoable,
} from '../api';
import { settle } from './knowledge';
import { enqueue } from './notify';

export type InverseOp =
  | {
      kind: 'task_state';
      task_id: string;
      status: TaskStatus;
      block_reason: string | null;
      discard_reason: string | null;
      archived_at: string | null;
    }
  | { kind: 'assignee_remove'; task_id: string; member_id: string }
  | { kind: 'assignee_add'; row: TaskAssignee }
  | { kind: 'follower_remove'; task_id: string; member_id: string }
  | { kind: 'follower_add'; task_id: string; member_id: string }
  | { kind: 'mark_restore'; row: PlenumMark }
  | { kind: 'mark_remove'; decision_id: string }
  | { kind: 'rsvp_restore'; appointment_id: string; member_id: string; row: AppointmentRsvp | null }
  | {
      kind: 'appointment_state';
      appointment_id: string;
      status: AppointmentStatus;
      attendees: AppointmentAttendee[];
    }
  | { kind: 'blocker_remove'; task_id: string; blocker_task_id: string }
  | { kind: 'event_status'; event_id: string; status: EventStatus }
  | { kind: 'decision_delete'; decision_id: string }
  | { kind: 'booking_remove'; booking_id: string }
  | { kind: 'booking_restore'; row: EventBooking }
  | { kind: 'lead_remove'; event_id: string; member_id: string }
  | { kind: 'lead_restore'; row: EventLead }
  | { kind: 'event_partner_remove'; event_id: string; partner_id: string }
  | { kind: 'event_partner_restore'; row: EventPartner }
  | { kind: 'task_delete'; task_id: string }
  | { kind: 'task_fields'; task_id: string; due_date: string | null; origin_plenum_id: string | null }
  | { kind: 'appointment_times'; appointment_id: string; starts_at: string; ends_at: string | null }
  | {
      kind: 'decision_state';
      decision_id: string;
      status: Decision['status'];
      superseded_by_id: string | null;
    }
  | {
      kind: 'question_state';
      question_id: string;
      status: Question['status'];
      answer: string | null;
      answered_in_plenum_id: string | null;
    }
  // [Umbau Phase 6] Stimme vor der Abstimmung – null: es gab noch keine
  | { kind: 'vote_restore'; decision_id: string; member_id: string; row: DecisionVote | null }
  // [Phase 9] Löschen (Archivieren) zurücknehmen
  | {
      kind: 'archive_restore';
      collection: 'events' | 'appointments' | 'decisions' | 'questions' | 'documents' | 'partners';
      id: string;
      /** Serientermin: Ausnahme-Kennzeichen vor dem Löschen */
      is_exception?: boolean;
    };

export type UndoEntity = 'task' | 'event' | 'appointment' | 'decision' | 'question' | 'document' | 'partner';

export interface UndoRecord {
  token: string;
  actor_id: string;
  created_at: string;
  entity_type: UndoEntity;
  entity_id: string;
  /** Version direkt nach der Aktion; hat sich seitdem etwas geändert, gibt es einen Konflikt */
  version_after: number;
  label: string;
  ops: InverseOp[];
  outbox_ids: string[];
  history_ids: string[];
}

/** Wurzel des Inhaltsverzeichnisses (Frage 11.4: welcher Ordner, ist noch offen) */
export const DRIVE_ROOT_ID = 'drive-wurzel';

/**
 * Nur Testdaten-Schicht: das simulierte Vereins-Drive hinter der Changes-API. In Schritt C fragt der
 * Server Google Drive über das Dienstkonto ab; dieses Objekt entfällt.
 */
export interface DriveRemote {
  items: Omit<DriveItem, 'synced_at'>[];
  /** Änderungsprotokoll: fortlaufende Nummer je geänderter Datei – der Token ist die letzte Nummer */
  changes: { seq: number; file_id: string }[];
  seq: number;
}

export interface Db {
  members: Member[];
  /** Weitere Login-Adressen (3.1) */
  member_emails: MemberEmail[];
  topics: Topic[];
  tasks: Task[];
  task_assignees: TaskAssignee[];
  task_followers: TaskFollower[];
  task_blockers: TaskBlocker[];
  comments: Comment[];
  plenum_marks: PlenumMark[];
  events: EventRow[];
  /** [P4] Detailbereiche (eine Zeile je Veranstaltung, angelegt beim ersten Speichern), Acts, Hauptverantwortliche */
  event_details: EventDetails[];
  event_bookings: EventBooking[];
  event_leads: EventLead[];
  /** [P4] Kooperationspartner, zentral; Verknüpfung mit Veranstaltungen eintragsweise */
  partners: Partner[];
  event_partners: EventPartner[];
  /** [P4] Vorlagen je Veranstaltungsart; was davon bei einer Veranstaltung schon angelegt wurde */
  event_templates: EventTemplate[];
  event_template_items: EventTemplateItem[];
  template_applications: TemplateApplication[];
  history: HistoryEntry[];
  appointment_types: AppointmentType[];
  appointments: Appointment[];
  /** [P6] Serien; Einzeltermine entstehen im Joblauf */
  appointment_series: AppointmentSeries[];
  appointment_rsvps: AppointmentRsvp[];
  appointment_attendees: AppointmentAttendee[];
  decisions: Decision[];
  /** [Umbau Phase 6] Stimmen zu offenen Entscheidungen (16.4) */
  decision_votes: DecisionVote[];
  /** [Umbau Phase 8] Rückmeldungen aus der App (16.5) */
  app_reports: AppReport[];
  questions: Question[];
  documents: DocumentRow[];
  document_links: DocumentLink[];
  /** [P5] Drive-Cache (3.13) und – nur in der Testdaten-Schicht – das simulierte Vereins-Drive */
  drive_items: DriveItem[];
  drive_sync_state: DriveSyncState;
  drive_remote: DriveRemote;
  push_subscriptions: PushSubscriptionRow[];
  /** [P6] Schalter-Matrix; fehlende Einträge heißen „an“ */
  notification_preferences: NotificationPreference[];
  telegram_links: TelegramLink[];
  telegram_link_codes: TelegramLinkCode[];
  notification_outbox: OutboxEntry[];
  job_runs: JobRun[];
  undo: UndoRecord[];
  task_number_seq: number;
}

export function emptyDb(): Db {
  return {
    members: [],
    topics: [],
    tasks: [],
    task_assignees: [],
    task_followers: [],
    task_blockers: [],
    comments: [],
    plenum_marks: [],
    events: [],
    event_details: [],
    event_bookings: [],
    event_leads: [],
    partners: [],
    event_partners: [],
    event_templates: [],
    event_template_items: [],
    template_applications: [],
    history: [],
    appointment_types: [],
    appointments: [],
    appointment_series: [],
    appointment_rsvps: [],
    appointment_attendees: [],
    decisions: [],
    decision_votes: [],
    app_reports: [],
    questions: [],
    documents: [],
    document_links: [],
    drive_items: [],
    drive_sync_state: {
      root_folder_id: DRIVE_ROOT_ID,
      changes_page_token: null,
      last_checked_at: null,
      last_full_sync_at: null,
    },
    drive_remote: { items: [], changes: [], seq: 0 },
    push_subscriptions: [],
    notification_preferences: [],
    telegram_links: [],
    telegram_link_codes: [],
    member_emails: [],
    notification_outbox: [],
    job_runs: [],
    undo: [],
    task_number_seq: 0,
  };
}

export interface Ctx {
  db: Db;
  /** handelnde Person: immer die der Sitzung, nie eine mitgeschickte ID (7.2) */
  actor: Member;
  now: Date;
  inverse: InverseOp[];
  /** Outbox-Einträge dieser Aktion – ein „Rückgängig“ zieht die noch wartenden zurück */
  outbox?: string[];
  /** Historien-Einträge dieser Aktion – ein „Rückgängig“ nimmt sie aus dem Plenum-Ergebnis */
  historyIds?: string[];
  /** laufendes Plenum, zu dem diese Änderung gehört (16.2) – sonst null */
  plenumId?: string | null;
}

const uuid = () => crypto.randomUUID();
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

export function writeHistory(
  ctx: Ctx,
  entity_type: HistoryEntityType,
  entity_id: string,
  action: string,
  changes: HistoryChanges = {},
): void {
  const id = uuid();
  (ctx.historyIds ??= []).push(id);
  // während des Plenums: die Änderung gehört zu seinem Ergebnis (16.2)
  const all: HistoryChanges = { ...changes };
  if (ctx.plenumId && !changes.plenum_id && countsForPlenum(entity_type, entity_id, action, ctx.plenumId))
    all.plenum_id = { old: null, new: ctx.plenumId };
  ctx.db.history.push({
    id,
    entity_type,
    entity_id,
    actor_member_id: ctx.actor.id,
    action,
    changes: all,
    created_at: iso(ctx),
  });
}

export function checkVersion(
  ctx: Ctx,
  entity_type: HistoryEntityType,
  row: { id: string; version: number },
  version: number,
): void {
  if (row.version === version) return;
  const last = ctx.db.history.filter((h) => h.entity_type === entity_type && h.entity_id === row.id).at(-1);
  const name = last
    ? (ctx.db.members.find((m) => m.id === last.actor_member_id)?.display_name ?? null)
    : null;
  throw new AppError('conflict', `Wurde inzwischen von ${name ?? 'jemand anderem'} geändert.`, {
    conflict: { changed_by_name: name, changed_at: last?.created_at ?? null },
  });
}

export function touch(ctx: Ctx, row: { updated_at: string; version: number }): void {
  row.updated_at = iso(ctx);
  row.version += 1;
}

export function registerUndo(
  ctx: Ctx,
  entity_type: UndoEntity,
  entity: { id: string; version: number },
  label: string,
): Undoable {
  if (ctx.inverse.length === 0) return { undo_token: '' };
  const cutoff = ctx.now.getTime() - UNDO_WINDOW_MS;
  ctx.db.undo = ctx.db.undo.filter((u) => new Date(u.created_at).getTime() >= cutoff);
  const token = uuid();
  ctx.db.undo.push({
    token,
    actor_id: ctx.actor.id,
    created_at: iso(ctx),
    entity_type,
    entity_id: entity.id,
    version_after: entity.version,
    label,
    ops: ctx.inverse,
    outbox_ids: ctx.outbox ?? [],
    history_ids: ctx.historyIds ?? [],
  });
  return { undo_token: token };
}

// ── Lesen ───────────────────────────────────────────────────────────────────

function taskListItem(db: Db, task: Task): TaskListItem {
  const blockerIds = db.task_blockers.filter((b) => b.task_id === task.id).map((b) => b.blocker_task_id);
  return {
    ...task,
    assignee_ids: db.task_assignees.filter((a) => a.task_id === task.id).map((a) => a.member_id),
    follower_ids: db.task_followers.filter((f) => f.task_id === task.id).map((f) => f.member_id),
    blocker_titles: db.tasks.filter((t) => blockerIds.includes(t.id) && !t.archived_at).map((t) => t.title),
    comment_count: db.comments.filter((c) => c.task_id === task.id).length,
  };
}

export function listTasks(db: Db): TaskListItem[] {
  return db.tasks.filter((t) => !t.archived_at).map((t) => taskListItem(db, t));
}

export function getTask(db: Db, id: string): TaskDetail {
  const task = findTask(db, id);
  const blockerIds = db.task_blockers.filter((b) => b.task_id === id).map((b) => b.blocker_task_id);
  return {
    ...taskListItem(db, task),
    blockers: db.tasks
      .filter((t) => blockerIds.includes(t.id) && !t.archived_at)
      .map((t) => ({ id: t.id, title: t.title, status: t.status })),
    comments: db.comments
      .filter((c) => c.task_id === id)
      .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    // neueste zuerst; bei gleichem Zeitstempel zählt die Reihenfolge des Eintragens
    history: db.history
      .map((h, index) => ({ h, index }))
      .filter(({ h }) => h.entity_type === 'task' && h.entity_id === id)
      .sort((a, b) => b.h.created_at.localeCompare(a.h.created_at) || b.index - a.index)
      .map(({ h }) => h),
  };
}

function eventListItem(db: Db, event: EventRow, today: string): EventListItem {
  const tasks = db.tasks.filter((t) => t.event_id === event.id && !t.archived_at && t.status !== 'verworfen');
  return {
    ...event,
    task_total: tasks.length,
    task_done: tasks.filter((t) => t.status === 'erledigt').length,
    task_overdue: tasks.filter((t) => isOverdue(t.due_date, t.status, today)).length,
    follow_up_since:
      event.status === 'in_nachbereitung'
        ? ([...db.history]
            .reverse()
            .find(
              (h) =>
                h.entity_type === 'event' &&
                h.entity_id === event.id &&
                h.changes.status?.new === 'in_nachbereitung',
            )?.created_at ?? event.updated_at)
        : null,
  };
}

export function listEvents(db: Db, now: Date): EventListItem[] {
  const today = toIsoDate(now);
  return db.events.filter((e) => !e.archived_at).map((e) => eventListItem(db, e, today));
}

export function getEvent(db: Db, id: string, now: Date): EventListItem {
  return eventListItem(db, findEvent(db, id), toIsoDate(now));
}

export function listTopics(db: Db): TopicWithUsage[] {
  return db.topics.map((topic) => {
    const tasks = db.tasks.filter((t) => t.topic_id === topic.id);
    return {
      ...topic,
      task_count: tasks.length,
      active_task_count: tasks.filter((t) => !t.archived_at && isActiveTaskStatus(t.status)).length,
    };
  });
}

const assigneeIds = (db: Db, taskId: string) =>
  db.task_assignees.filter((a) => a.task_id === taskId).map((a) => a.member_id);
const followerIds = (db: Db, taskId: string) =>
  db.task_followers.filter((f) => f.task_id === taskId).map((f) => f.member_id);

// ── Aufgaben ────────────────────────────────────────────────────────────────

export function findTask(db: Db, id: string): Task {
  const task = db.tasks.find((t) => t.id === id);
  if (!task) throw notFound('Diese Aufgabe');
  return task;
}

function editableTask(ctx: Ctx, id: string): Task {
  const task = findTask(ctx.db, id);
  if (task.archived_at)
    throw rule('Archivierte Aufgaben lassen sich nicht ändern. Stell sie erst wieder her.');
  return task;
}

function usableTopic(ctx: Ctx, id: string): Topic {
  const topic = ctx.db.topics.find((t) => t.id === id);
  if (!topic) throw new AppError('validation', 'Dieses Thema gibt es nicht mehr.', { field: 'topic_id' });
  if (topic.archived_at)
    throw new AppError('validation', 'Dieses Thema ist archiviert.', { field: 'topic_id' });
  return topic;
}

/** Wieder aktiv nur in einem aktiven Thema – sonst stünde eine offene Aufgabe in einem archivierten (WF-ADM-05) */
function topicStillActive(db: Db, task: Task): void {
  const topic = db.topics.find((t) => t.id === task.topic_id);
  if (topic?.archived_at)
    throw rule(
      `Das Thema „${topic.name}“ ist archiviert. Stell es erst wieder her oder wähle ein anderes Thema.`,
    );
}

function usableEvent(ctx: Ctx, id: string): EventRow {
  const event = ctx.db.events.find((e) => e.id === id && !e.archived_at);
  if (!event)
    throw new AppError('validation', 'Diese Veranstaltung gibt es nicht mehr.', { field: 'event_id' });
  return event;
}

function usableAppointment(ctx: Ctx, id: string): Appointment {
  const appointment = ctx.db.appointments.find((a) => a.id === id && !a.archived_at);
  if (!appointment)
    throw new AppError('validation', 'Diesen Termin gibt es nicht mehr.', { field: 'appointment_id' });
  return appointment;
}

export function selectableMember(ctx: Ctx, id: string): Member {
  const member = ctx.db.members.find((m) => m.id === id);
  if (!member || member.is_system || !member.active)
    throw rule('Nur aktive Mitglieder lassen sich eintragen.');
  return member;
}

/** Trägt die Person als Folgende*n ein, falls sie noch nicht folgt. */
function follow(ctx: Ctx, taskId: string, memberId: string): boolean {
  if (ctx.db.task_followers.some((f) => f.task_id === taskId && f.member_id === memberId)) return false;
  ctx.db.task_followers.push({ task_id: taskId, member_id: memberId });
  ctx.inverse.push({ kind: 'follower_remove', task_id: taskId, member_id: memberId });
  return true;
}

/** Entscheidung oder Fakt steht ausdrücklich auf der Agenda (16.1) */
export const isMarked = (db: Db, decisionId: string) =>
  db.plenum_marks.some((m) => m.decision_id === decisionId);

/** Ersetzen und Aufheben nehmen den Eintrag von der Agenda. */
export function dropMark(ctx: Ctx, decisionId: string): boolean {
  const mark = ctx.db.plenum_marks.find((m) => m.decision_id === decisionId);
  if (!mark) return false;
  ctx.db.plenum_marks = ctx.db.plenum_marks.filter((m) => m !== mark);
  ctx.inverse.push({ kind: 'mark_restore', row: mark });
  return true;
}

/** Neu Aufgesetztes kommt ans Ende der Agenda. */
export function addMark(ctx: Ctx, decisionId: string, reason: MarkReason = 'stimmt_noch'): void {
  const position = Math.max(0, ...ctx.db.plenum_marks.map((m) => m.position)) + 1;
  ctx.db.plenum_marks.push({
    id: uuid(),
    decision_id: decisionId,
    position,
    note: null,
    reason,
    marked_by: ctx.actor.id,
    marked_at: iso(ctx),
  });
  ctx.inverse.push({ kind: 'mark_remove', decision_id: decisionId });
}

function taskState(task: Task): InverseOp {
  return {
    kind: 'task_state',
    task_id: task.id,
    status: task.status,
    block_reason: task.block_reason,
    discard_reason: task.discard_reason,
    archived_at: task.archived_at,
  };
}

export function createTask(ctx: Ctx, raw: unknown): { id: string } {
  const input = parse(taskCreateSchema, raw);
  usableTopic(ctx, input.topic_id);
  if (input.event_id) usableEvent(ctx, input.event_id);
  if (input.appointment_id) usableAppointment(ctx, input.appointment_id);
  const now = iso(ctx);
  const task: Task = {
    id: uuid(),
    number: ++ctx.db.task_number_seq,
    title: input.title,
    description: input.description,
    topic_id: input.topic_id,
    event_id: input.event_id,
    appointment_id: input.appointment_id,
    // im laufenden Plenum angelegt: Herkunft dieses Plenum (16.2)
    origin_plenum_id: ctx.plenumId ?? null,
    priority: input.priority,
    due_date: input.due_date,
    status: 'neu',
    block_reason: null,
    discard_reason: null,
    archived_at: null,
    created_at: now,
    updated_at: now,
    created_by: ctx.actor.id,
    version: 1,
  };
  ctx.db.tasks.push(task);
  const changes: HistoryChanges = { title: { old: null, new: task.title } };
  if (task.description) changes.description = { old: null, new: task.description };
  follow(ctx, task.id, ctx.actor.id);
  writeHistory(ctx, 'task', task.id, 'created', changes);
  // trägt nur ein – der Status bleibt „neu“ (F-AUF-04)
  const people = [...(input.assign_self ? [ctx.actor.id] : []), ...input.assignee_ids];
  if (people.length) assignMany(ctx, task, people);
  return { id: task.id };
}

/** Mehrere eintragen (Phase 9: „Alle“, Zuordnung beim Anlegen) – eintragsweise, je Person Historie und Nachricht */
function assignMany(ctx: Ctx, task: Task, memberIds: readonly string[]): string[] {
  const ids = [...new Set(memberIds)];
  for (const id of ids) selectableMember(ctx, id);
  const added = ids.filter(
    (id) => !ctx.db.task_assignees.some((a) => a.task_id === task.id && a.member_id === id),
  );
  for (const memberId of added) {
    ctx.db.task_assignees.push({
      task_id: task.id,
      member_id: memberId,
      assigned_by: ctx.actor.id,
      assigned_at: iso(ctx),
    });
    ctx.inverse.push({ kind: 'assignee_remove', task_id: task.id, member_id: memberId });
    follow(ctx, task.id, memberId);
    writeHistory(ctx, 'task', task.id, 'assignee_added', { assignee: { old: null, new: memberId } });
    enqueue(ctx.db, ctx.now, assignmentMessages(task, memberId, ctx.actor.id, iso(ctx)), (ctx.outbox ??= []));
  }
  return added;
}

/** WF-AUF-10 „Alle“: alle genannten Personen auf einmal eintragen, ein Rückgängig für alles */
export function addAssignees(ctx: Ctx, taskId: string, raw: unknown): Undoable {
  const memberIds = parse(memberIdsSchema, raw);
  const task = editableTask(ctx, taskId);
  const added = assignMany(ctx, task, memberIds);
  if (added.length === 0) return { undo_token: '' };
  touch(ctx, task);
  return registerUndo(ctx, 'task', task, `${added.length} eingetragen`);
}

export function updateTaskFields(ctx: Ctx, id: string, raw: unknown, version: number): void {
  const input = parse(taskFieldsSchema, raw);
  const task = editableTask(ctx, id);
  checkVersion(ctx, 'task', task, version);
  const changes: HistoryChanges = {};
  if (input.title !== undefined && input.title !== task.title) {
    changes.title = { old: task.title, new: input.title };
    task.title = input.title;
  }
  if (input.topic_id !== undefined && input.topic_id !== task.topic_id) {
    usableTopic(ctx, input.topic_id);
    changes.topic_id = { old: task.topic_id, new: input.topic_id };
    task.topic_id = input.topic_id;
  }
  if (input.priority !== undefined && input.priority !== task.priority) {
    changes.priority = { old: task.priority, new: input.priority };
    task.priority = input.priority;
  }
  if (input.due_date !== undefined && input.due_date !== task.due_date) {
    changes.due_date = { old: task.due_date, new: input.due_date };
    task.due_date = input.due_date;
  }
  if (input.event_id !== undefined && input.event_id !== task.event_id) {
    if (input.event_id) usableEvent(ctx, input.event_id);
    changes.event_id = { old: task.event_id, new: input.event_id };
    task.event_id = input.event_id;
    // [P4] aus einer Vorlage angelegt: bei der bisherigen Veranstaltung wieder anlegbar (Entscheidung 22.10.2026)
    ctx.db.template_applications = ctx.db.template_applications.filter((a) => a.task_id !== id);
  }
  if (input.appointment_id !== undefined && input.appointment_id !== task.appointment_id) {
    if (input.appointment_id) usableAppointment(ctx, input.appointment_id);
    changes.appointment_id = { old: task.appointment_id, new: input.appointment_id };
    task.appointment_id = input.appointment_id;
  }
  if (Object.keys(changes).length === 0) return;
  touch(ctx, task);
  follow(ctx, id, ctx.actor.id);
  writeHistory(ctx, 'task', id, 'updated', changes);
}

export function updateTaskDescription(ctx: Ctx, id: string, raw: unknown, version: number): void {
  const description = parse(taskDescriptionSchema, raw);
  const task = editableTask(ctx, id);
  checkVersion(ctx, 'task', task, version);
  if (description === task.description) return;
  const changes: HistoryChanges = { description: { old: task.description, new: description } };
  task.description = description;
  touch(ctx, task);
  follow(ctx, id, ctx.actor.id);
  writeHistory(ctx, 'task', id, 'updated', changes);
}

function insertBlocker(ctx: Ctx, task: Task, blockerId: string): boolean {
  if (blockerId === task.id) throw rule('Eine Aufgabe kann nicht auf sich selbst warten.');
  const blocker = findTask(ctx.db, blockerId);
  if (blocker.archived_at) throw rule('Archivierte Aufgaben können nicht blockieren.');
  if (ctx.db.task_blockers.some((b) => b.task_id === task.id && b.blocker_task_id === blockerId))
    return false;
  if (wouldCreateBlockerCycle(ctx.db.task_blockers, task.id, blockerId))
    throw rule(`„${blocker.title}“ wartet selbst schon auf diese Aufgabe – das wäre ein Kreis.`);
  ctx.db.task_blockers.push({ task_id: task.id, blocker_task_id: blockerId });
  ctx.inverse.push({ kind: 'blocker_remove', task_id: task.id, blocker_task_id: blockerId });
  writeHistory(ctx, 'task', task.id, 'blocker_added', { blocker: { old: null, new: blockerId } });
  return true;
}

export function setTaskStatus(ctx: Ctx, id: string, raw: unknown): Undoable {
  const input = parse(taskStatusChangeSchema, raw);
  const task = editableTask(ctx, id);
  checkVersion(ctx, 'task', task, input.version);
  const from = task.status;
  const to = input.status;
  if (!canTransitionTask(from, to))
    throw rule(
      from === to
        ? `Die Aufgabe ist schon „${TASK_STATUS_LABEL[to]}“.`
        : `Von „${TASK_STATUS_LABEL[from]}“ nach „${TASK_STATUS_LABEL[to]}“ geht es nicht.`,
    );
  const hasBlockers =
    (input.blocker_ids?.length ?? 0) > 0 || ctx.db.task_blockers.some((b) => b.task_id === id);
  if (blockReasonMissing(to, input.block_reason, hasBlockers))
    throw new AppError('validation', BLOCK_REASON_MISSING, { field: 'block_reason' });
  if (!isActiveTaskStatus(from) && isActiveTaskStatus(to)) topicStillActive(ctx.db, task);

  ctx.inverse.push(taskState(task));
  const changes: HistoryChanges = { status: { old: from, new: to } };
  if (from === 'blockiert') {
    // der Grund wird geleert und bleibt in der Historie
    changes.block_reason = { old: task.block_reason, new: null };
    task.block_reason = null;
  }
  if (from === 'verworfen' && task.discard_reason) {
    changes.discard_reason = { old: task.discard_reason, new: null };
    task.discard_reason = null;
  }
  if (to === 'blockiert') {
    // mit Abhängigkeit darf der Grund fehlen
    task.block_reason = input.block_reason?.trim() || null;
    if (task.block_reason) changes.block_reason = { old: null, new: task.block_reason };
    for (const blockerId of input.blocker_ids ?? []) insertBlocker(ctx, task, blockerId);
  }
  if (to === 'verworfen' && input.discard_reason) {
    task.discard_reason = input.discard_reason;
    changes.discard_reason = { old: null, new: task.discard_reason };
  }
  task.status = to;

  // „In Arbeit“ trägt niemanden automatisch ein (Phase 9, Nutzerin 26.10.2026) – Zuordnen geht nur ausdrücklich
  follow(ctx, id, ctx.actor.id);
  touch(ctx, task);
  writeHistory(ctx, 'task', id, 'status', changes);
  enqueue(
    ctx.db,
    ctx.now,
    statusMessages(task, to, ctx.actor.id, assigneeIds(ctx.db, id), followerIds(ctx.db, id), iso(ctx)),
    (ctx.outbox ??= []),
  );
  if (to === 'erledigt')
    // die wartenden Aufgaben ändern ihren Status nicht automatisch – ihre Bearbeitenden erfahren es (4.1)
    for (const edge of ctx.db.task_blockers.filter((b) => b.blocker_task_id === id)) {
      const waiting = ctx.db.tasks.find((t) => t.id === edge.task_id);
      if (waiting && !waiting.archived_at && isActiveTaskStatus(waiting.status))
        enqueue(
          ctx.db,
          ctx.now,
          unblockedMessages(task, waiting, assigneeIds(ctx.db, waiting.id), ctx.actor.id, iso(ctx)),
          (ctx.outbox ??= []),
        );
    }
  return registerUndo(ctx, 'task', task, `Status: ${TASK_STATUS_LABEL[to]}`);
}

export function addAssignee(ctx: Ctx, taskId: string, memberId: string): Undoable {
  const task = editableTask(ctx, taskId);
  const member = selectableMember(ctx, memberId);
  if (ctx.db.task_assignees.some((a) => a.task_id === taskId && a.member_id === memberId))
    return { undo_token: '' };
  ctx.db.task_assignees.push({
    task_id: taskId,
    member_id: memberId,
    assigned_by: ctx.actor.id,
    assigned_at: iso(ctx),
  });
  ctx.inverse.push({ kind: 'assignee_remove', task_id: taskId, member_id: memberId });
  follow(ctx, taskId, memberId);
  touch(ctx, task);
  writeHistory(ctx, 'task', taskId, 'assignee_added', { assignee: { old: null, new: memberId } });
  enqueue(ctx.db, ctx.now, assignmentMessages(task, memberId, ctx.actor.id, iso(ctx)), (ctx.outbox ??= []));
  return registerUndo(ctx, 'task', task, `${member.display_name} eingetragen`);
}

function dropAssignee(ctx: Ctx, task: Task, memberId: string, reason?: 'deactivated'): boolean {
  const row = ctx.db.task_assignees.find((a) => a.task_id === task.id && a.member_id === memberId);
  if (!row) return false;
  ctx.db.task_assignees = ctx.db.task_assignees.filter((a) => a !== row);
  ctx.inverse.push({ kind: 'assignee_add', row });
  const changes: HistoryChanges = { assignee: { old: memberId, new: null } };
  if (reason) changes.reason = { old: null, new: reason };
  const nobodyLeft = !ctx.db.task_assignees.some((a) => a.task_id === task.id);
  const next = nobodyLeft ? statusAfterLastAssigneeLeft(task.status) : task.status;
  let statusReset = false;
  if (next !== task.status) {
    ctx.inverse.push(taskState(task));
    changes.status = { old: task.status, new: next };
    task.status = next;
    statusReset = true;
  }
  touch(ctx, task);
  writeHistory(ctx, 'task', task.id, 'assignee_removed', changes);
  return statusReset;
}

export function removeAssignee(
  ctx: Ctx,
  taskId: string,
  memberId: string,
): Undoable & { status_reset: boolean } {
  const task = editableTask(ctx, taskId);
  const name = ctx.db.members.find((m) => m.id === memberId)?.display_name ?? 'Person';
  const status_reset = dropAssignee(ctx, task, memberId);
  return { ...registerUndo(ctx, 'task', task, `${name} ausgetragen`), status_reset };
}

export function addFollower(ctx: Ctx, taskId: string, memberId: string): Undoable {
  const task = editableTask(ctx, taskId);
  const member = selectableMember(ctx, memberId);
  if (!follow(ctx, taskId, memberId)) return { undo_token: '' };
  // selbst folgen oder entfolgen betrifft nur die Person selbst – ohne Historie
  if (memberId !== ctx.actor.id)
    writeHistory(ctx, 'task', taskId, 'follower_added', { follower: { old: null, new: memberId } });
  return registerUndo(ctx, 'task', task, `${member.display_name} folgt`);
}

function dropFollower(ctx: Ctx, taskId: string, memberId: string, reason?: 'deactivated'): boolean {
  const row = ctx.db.task_followers.find((f) => f.task_id === taskId && f.member_id === memberId);
  if (!row) return false;
  ctx.db.task_followers = ctx.db.task_followers.filter((f) => f !== row);
  ctx.inverse.push({ kind: 'follower_add', task_id: taskId, member_id: memberId });
  const changes: HistoryChanges = { follower: { old: memberId, new: null } };
  if (reason) changes.reason = { old: null, new: reason };
  if (memberId !== ctx.actor.id) writeHistory(ctx, 'task', taskId, 'follower_removed', changes);
  return true;
}

export function removeFollower(ctx: Ctx, taskId: string, memberId: string): Undoable {
  const task = editableTask(ctx, taskId);
  const name = ctx.db.members.find((m) => m.id === memberId)?.display_name ?? 'Person';
  dropFollower(ctx, taskId, memberId);
  return registerUndo(ctx, 'task', task, `${name} folgt nicht mehr`);
}

export function addBlocker(ctx: Ctx, taskId: string, blockerTaskId: string): void {
  const task = editableTask(ctx, taskId);
  if (insertBlocker(ctx, task, blockerTaskId)) follow(ctx, taskId, ctx.actor.id);
}

export function removeBlocker(ctx: Ctx, taskId: string, blockerTaskId: string): void {
  const task = editableTask(ctx, taskId);
  const row = ctx.db.task_blockers.find((b) => b.task_id === taskId && b.blocker_task_id === blockerTaskId);
  if (!row) return;
  // blockiert ohne Grund braucht mindestens eine Abhängigkeit
  if (
    task.status === 'blockiert' &&
    !task.block_reason &&
    ctx.db.task_blockers.filter((b) => b.task_id === taskId).length === 1
  )
    throw rule(LAST_BLOCKER);
  ctx.db.task_blockers = ctx.db.task_blockers.filter((b) => b !== row);
  follow(ctx, taskId, ctx.actor.id);
  writeHistory(ctx, 'task', taskId, 'blocker_removed', { blocker: { old: blockerTaskId, new: null } });
}

/** Kommentar ohne Ziel – danach wird genau eine Zielspalte gesetzt (16.3) */
export const noCommentTarget = () => ({
  task_id: null,
  question_id: null,
  decision_id: null,
  event_id: null,
  appointment_id: null,
  partner_id: null,
});

/** Kommentar an einer Aufgabe: wer kommentiert, folgt; Bearbeitende und Folgende erfahren es (6.2) */
export function addComment(ctx: Ctx, taskId: string, raw: unknown): { id: string; now_following: boolean } {
  const body = parse(commentBodySchema, raw);
  const task = editableTask(ctx, taskId);
  const now = iso(ctx);
  const comment: Comment = {
    id: uuid(),
    ...noCommentTarget(),
    task_id: taskId,
    author_id: ctx.actor.id,
    body,
    created_at: now,
    updated_at: now,
  };
  ctx.db.comments.push(comment);
  const now_following = follow(ctx, taskId, ctx.actor.id);
  writeHistory(ctx, 'task', taskId, 'comment_added', { comment: { old: null, new: comment.id } });
  enqueue(
    ctx.db,
    ctx.now,
    commentMessages(
      task,
      comment,
      ctx.actor.id,
      ctx.actor.display_name,
      assigneeIds(ctx.db, taskId),
      followerIds(ctx.db, taskId),
    ),
  );
  return { id: comment.id, now_following };
}

export function updateComment(ctx: Ctx, commentId: string, raw: unknown): void {
  const body = parse(commentBodySchema, raw);
  const comment = ctx.db.comments.find((c) => c.id === commentId);
  if (!comment) throw notFound('Diesen Kommentar');
  if (comment.author_id !== ctx.actor.id)
    throw new AppError('forbidden', 'Nur eigene Kommentare lassen sich bearbeiten.');
  const taskId = comment.task_id!;
  editableTask(ctx, taskId);
  if (body === comment.body) return;
  // Text alt → neu (3.10)
  const previous = comment.body;
  comment.body = body;
  comment.updated_at = iso(ctx);
  writeHistory(ctx, 'task', taskId, 'comment_edited', {
    comment: { old: comment.id, new: comment.id },
    body: { old: previous, new: body },
  });
}

export function archiveTask(ctx: Ctx, id: string, version: number): Undoable {
  const task = editableTask(ctx, id);
  checkVersion(ctx, 'task', task, version);
  ctx.inverse.push(taskState(task));
  const changes: HistoryChanges = {};
  task.archived_at = iso(ctx);
  touch(ctx, task);
  writeHistory(ctx, 'task', id, 'archived', changes);
  return registerUndo(ctx, 'task', task, 'Archiviert');
}

export function restoreTask(ctx: Ctx, id: string, version: number): void {
  const task = findTask(ctx.db, id);
  checkVersion(ctx, 'task', task, version);
  if (!task.archived_at) return;
  if (isActiveTaskStatus(task.status)) topicStillActive(ctx.db, task);
  task.archived_at = null;
  touch(ctx, task);
  writeHistory(ctx, 'task', id, 'restored');
}

// ── Rückgängig (WF-ALL-02): Gegenaktion, ebenfalls in der Historie ───────────

/** Pflichtregeln nach den Gegenschritten (4.1): sonst bricht das Rückgängig ab und nichts ändert sich */
function taskStillValid(db: Db, task: Task, restoresInArbeit: boolean): void {
  if (task.archived_at || !isActiveTaskStatus(task.status)) return;
  topicStillActive(db, task);
  // „In Arbeit“ ohne Bearbeitende ist sonst erlaubt (z. B. aus dem Plenum) – nur nicht als Ergebnis des Rückgängig
  if (
    restoresInArbeit &&
    task.status === 'in_arbeit' &&
    !db.task_assignees.some((a) => a.task_id === task.id)
  )
    throw rule('Die Person ist inzwischen nicht mehr aktiv – das lässt sich nicht mehr rückgängig machen.');
}

export function undo(ctx: Ctx, token: string): void {
  const record = ctx.db.undo.find((u) => u.token === token);
  const expired = record && ctx.now.getTime() - new Date(record.created_at).getTime() > UNDO_WINDOW_MS;
  if (!record || expired || record.actor_id !== ctx.actor.id)
    throw rule('Das lässt sich nicht mehr rückgängig machen.');
  ctx.db.undo = ctx.db.undo.filter((u) => u !== record);

  const db = ctx.db;
  const entity =
    record.entity_type === 'task'
      ? findTask(db, record.entity_id)
      : record.entity_type === 'event'
        ? findEvent(db, record.entity_id)
        : record.entity_type === 'appointment'
          ? db.appointments.find((a) => a.id === record.entity_id)
          : record.entity_type === 'decision'
            ? db.decisions.find((d) => d.id === record.entity_id)
            : record.entity_type === 'question'
              ? db.questions.find((q) => q.id === record.entity_id)
              : record.entity_type === 'partner'
                ? db.partners.find((p) => p.id === record.entity_id)
                : db.documents.find((d) => d.id === record.entity_id);
  if (!entity) throw notFound('Diesen Eintrag');
  // Aktionen im Plenum: nach dem Abschluss ist die Zusammenfassung verschickt (WF-PLE-19)
  const plenumIds = new Set(
    db.history
      .filter((h) => record.history_ids.includes(h.id) && h.changes.plenum_id?.new)
      .map((h) => h.changes.plenum_id!.new as string),
  );
  if (db.appointments.some((a) => plenumIds.has(a.id) && a.status === 'abgeschlossen'))
    throw rule('Das Plenum ist schon abgeschlossen – das lässt sich nicht mehr rückgängig machen.');
  // Eine im selben Schritt angelegte Entscheidung verschwindet nur, solange niemand sie weiterverwendet
  for (const op of record.ops) {
    if (op.kind !== 'decision_delete') continue;
    const created = db.decisions.find((d) => d.id === op.decision_id);
    if (
      created &&
      (created.version > 1 ||
        db.decisions.some((d) => d.superseded_by_id === created.id && d.id !== record.entity_id) ||
        db.document_links.some((l) => l.target_type === 'decision' && l.target_id === created.id) ||
        db.plenum_marks.some((m) => m.decision_id === created.id) ||
        db.comments.some((c) => c.decision_id === created.id) ||
        db.decision_votes.some((v) => v.decision_id === created.id))
    )
      throw rule(
        'Der neue Eintrag wird inzwischen weiterverwendet – das lässt sich nicht mehr rückgängig machen.',
      );
  }
  for (const op of record.ops)
    if (
      op.kind === 'booking_remove' &&
      (db.event_bookings.find((b) => b.id === op.booking_id)?.version ?? 1) > 1
    )
      throw rule('Der Act wurde inzwischen bearbeitet – das lässt sich nicht mehr rückgängig machen.');
  // Im selben Schritt angelegte Aufgaben verschwinden nur, solange niemand sie angefasst hat
  for (const op of record.ops) {
    if (op.kind !== 'task_delete') continue;
    const touched =
      db.history.some(
        (h) => h.entity_type === 'task' && h.entity_id === op.task_id && !record.history_ids.includes(h.id),
      ) ||
      db.comments.some((c) => c.task_id === op.task_id) ||
      db.task_blockers.some((b) => b.task_id === op.task_id || b.blocker_task_id === op.task_id);
    if (touched)
      throw rule(
        'Eine der neuen Aufgaben wurde inzwischen bearbeitet – das lässt sich nicht mehr rückgängig machen.',
      );
  }
  // Hat die Aktion die Zeile selbst geändert, darf inzwischen niemand anderes daran gewesen sein
  const rowKinds = [
    'task_state',
    'assignee_add',
    'assignee_remove',
    'event_status',
    'appointment_state',
    'decision_state',
    'question_state',
    'task_fields',
    'appointment_times',
    // eine Stimme: ist die Entscheidung inzwischen (durch andere Stimmen) gültig geworden, bleibt es dabei
    'vote_restore',
    'archive_restore',
  ];
  const touchesRow = record.ops.some((op) => rowKinds.includes(op.kind));
  if (touchesRow) checkVersion(ctx, record.entity_type, entity, record.version_after);

  // was das Rückgängig zurücksetzt, steht als alt → neu in der Historie (3.10)
  const undone: HistoryChanges = {};
  /** Entscheidungen, deren Stimme zurückgesetzt wurde – danach gilt die Konsensregel neu (16.4) */
  const restoredVotes = new Set<string>();
  for (const op of record.ops) {
    switch (op.kind) {
      case 'task_state': {
        const task = findTask(db, op.task_id);
        for (const key of ['status', 'block_reason', 'discard_reason', 'archived_at'] as const)
          if (task[key] !== op[key]) undone[key] = { old: task[key], new: op[key] };
        task.status = op.status;
        task.block_reason = op.block_reason;
        task.discard_reason = op.discard_reason;
        task.archived_at = op.archived_at;
        break;
      }
      case 'assignee_remove':
        db.task_assignees = db.task_assignees.filter(
          (a) => !(a.task_id === op.task_id && a.member_id === op.member_id),
        );
        break;
      case 'assignee_add':
        if (
          db.members.some((m) => m.id === op.row.member_id && m.active) &&
          !db.task_assignees.some((a) => a.task_id === op.row.task_id && a.member_id === op.row.member_id)
        )
          db.task_assignees.push(op.row);
        break;
      case 'follower_remove':
        db.task_followers = db.task_followers.filter(
          (f) => !(f.task_id === op.task_id && f.member_id === op.member_id),
        );
        break;
      case 'follower_add':
        if (
          db.members.some((m) => m.id === op.member_id && m.active) &&
          !db.task_followers.some((f) => f.task_id === op.task_id && f.member_id === op.member_id)
        )
          db.task_followers.push({ task_id: op.task_id, member_id: op.member_id });
        break;
      case 'mark_restore': {
        // nur, wenn der Eintrag (nach den Gegenschritten davor) noch gilt – sonst bleibt er herunter
        const d = db.decisions.find((x) => x.id === op.row.decision_id);
        if (!d || d.archived_at || !decisionActive(d.status)) break;
        if (isMarked(db, op.row.decision_id)) break;
        // der Punkt steht wieder an alter Stelle
        // alte Stelle – ist sie inzwischen vergeben, am Ende
        const taken = db.plenum_marks.some((m) => m.position === op.row.position);
        const position = taken ? Math.max(0, ...db.plenum_marks.map((m) => m.position)) + 1 : op.row.position;
        db.plenum_marks.push({ ...op.row, position });
        break;
      }
      case 'mark_remove':
        // nur die Markierung dieser Aktion – eine inzwischen von jemand anderem gesetzte bleibt
        db.plenum_marks = db.plenum_marks.filter(
          (m) =>
            !(
              m.decision_id === op.decision_id &&
              m.marked_by === record.actor_id &&
              m.marked_at === record.created_at
            ),
        );
        break;
      case 'blocker_remove':
        db.task_blockers = db.task_blockers.filter(
          (b) => !(b.task_id === op.task_id && b.blocker_task_id === op.blocker_task_id),
        );
        break;
      case 'event_status': {
        const event = findEvent(db, op.event_id);
        if (event.status !== op.status) undone.status = { old: event.status, new: op.status };
        event.status = op.status;
        break;
      }
      case 'task_delete':
        db.tasks = db.tasks.filter((t) => t.id !== op.task_id);
        db.task_assignees = db.task_assignees.filter((a) => a.task_id !== op.task_id);
        db.task_followers = db.task_followers.filter((f) => f.task_id !== op.task_id);
        db.document_links = db.document_links.filter(
          (l) => !(l.target_type === 'task' && l.target_id === op.task_id),
        );
        db.history = db.history.filter((h) => !(h.entity_type === 'task' && h.entity_id === op.task_id));
        db.template_applications = db.template_applications.filter((a) => a.task_id !== op.task_id);
        break;
      case 'task_fields': {
        const task = db.tasks.find((t) => t.id === op.task_id);
        if (task) {
          task.due_date = op.due_date;
          task.origin_plenum_id = op.origin_plenum_id;
        }
        break;
      }
      case 'appointment_times': {
        const appointment = db.appointments.find((a) => a.id === op.appointment_id);
        if (appointment) {
          appointment.starts_at = op.starts_at;
          appointment.ends_at = op.ends_at;
        }
        break;
      }
      case 'booking_remove':
        db.event_bookings = db.event_bookings.filter((b) => b.id !== op.booking_id);
        break;
      case 'booking_restore':
        if (!db.event_bookings.some((b) => b.id === op.row.id)) db.event_bookings.push(op.row);
        break;
      case 'lead_remove':
        db.event_leads = db.event_leads.filter(
          (l) => !(l.event_id === op.event_id && l.member_id === op.member_id),
        );
        break;
      case 'lead_restore':
        // wer inzwischen deaktiviert ist, kommt nicht zurück (WF-ADM-03)
        if (!db.members.find((m) => m.id === op.row.member_id)?.active) break;
        if (!db.event_leads.some((l) => l.event_id === op.row.event_id && l.member_id === op.row.member_id))
          db.event_leads.push(op.row);
        break;
      case 'event_partner_remove':
        db.event_partners = db.event_partners.filter(
          (ep) => !(ep.event_id === op.event_id && ep.partner_id === op.partner_id),
        );
        break;
      case 'event_partner_restore':
        // ein inzwischen archivierter Partner wird nicht wieder verknüpft (wie linkPartner)
        if (db.partners.find((p) => p.id === op.row.partner_id)?.archived_at) break;
        if (
          !db.event_partners.some(
            (ep) => ep.event_id === op.row.event_id && ep.partner_id === op.row.partner_id,
          )
        )
          db.event_partners.push(op.row);
        break;
      case 'decision_delete':
        // die im selben Schritt angelegte Entscheidung verschwindet wieder – samt Markierung und Historie
        db.decisions = db.decisions.filter((d) => d.id !== op.decision_id);
        db.plenum_marks = db.plenum_marks.filter((m) => m.decision_id !== op.decision_id);
        db.document_links = db.document_links.filter(
          (l) => !(l.target_type === 'decision' && l.target_id === op.decision_id),
        );
        db.history = db.history.filter(
          (h) => !(h.entity_type === 'decision' && h.entity_id === op.decision_id),
        );
        break;
      case 'decision_state': {
        const decision = db.decisions.find((d) => d.id === op.decision_id);
        if (decision) {
          decision.status = op.status;
          decision.superseded_by_id = op.superseded_by_id;
        }
        break;
      }
      case 'archive_restore': {
        const row = (db[op.collection] as { id: string; archived_at: string | null }[]).find(
          (x) => x.id === op.id,
        );
        if (row?.archived_at) {
          undone.archived_at = { old: row.archived_at, new: null };
          row.archived_at = null;
        }
        if (op.is_exception !== undefined && op.collection === 'appointments') {
          const a = db.appointments.find((x) => x.id === op.id);
          if (a) a.is_exception = op.is_exception;
        }
        break;
      }
      case 'vote_restore':
        undone.vote = {
          old:
            db.decision_votes.find((v) => v.decision_id === op.decision_id && v.member_id === op.member_id)
              ?.vote ?? null,
          new: op.row?.vote ?? null,
        };
        restoredVotes.add(op.decision_id);
        db.decision_votes = db.decision_votes.filter(
          (v) => !(v.decision_id === op.decision_id && v.member_id === op.member_id),
        );
        if (op.row) db.decision_votes.push(op.row);
        break;
      case 'question_state': {
        const question = db.questions.find((q) => q.id === op.question_id);
        if (question) {
          question.status = op.status;
          question.answer = op.answer;
          question.answered_in_plenum_id = op.answered_in_plenum_id;
        }
        break;
      }
      case 'rsvp_restore': {
        // nur, solange Zu- und Absagen noch möglich sind (wie auf dem Server)
        const appointment = db.appointments.find((a) => a.id === op.appointment_id);
        if (!appointment || !canRsvp(appointment, ctx.now))
          throw rule('Für diesen Termin sind keine Zu- und Absagen mehr möglich.');
        db.appointment_rsvps = db.appointment_rsvps.filter(
          (r) => !(r.appointment_id === op.appointment_id && r.member_id === op.member_id),
        );
        if (op.row) db.appointment_rsvps.push(op.row);
        break;
      }
      case 'appointment_state': {
        const appointment = db.appointments.find((a) => a.id === op.appointment_id);
        if (appointment) appointment.status = op.status;
        db.appointment_attendees = db.appointment_attendees
          .filter((a) => a.appointment_id !== op.appointment_id)
          .concat(op.attendees);
        break;
      }
    }
  }
  // Nachrichten der zurückgenommenen Aktion, die noch nicht raus sind, werden nicht mehr verschickt
  db.notification_outbox = db.notification_outbox.filter(
    (o) => !(record.outbox_ids.includes(o.id) && o.status === 'wartet'),
  );
  // eine im selben Schritt angelegte Aufgabe ist wieder weg – dann gibt es nichts mehr zu vermerken
  if (record.ops.some((op) => op.kind === 'task_delete' && op.task_id === entity.id)) return;
  if (record.entity_type === 'task')
    taskStillValid(
      db,
      entity as Task,
      record.ops.some((op) => op.kind === 'task_state' && op.status === 'in_arbeit'),
    );
  if (touchesRow) touch(ctx, entity);
  // zurückgesetzte Stimme: gilt die Entscheidung jetzt (z. B. Widerspruch zurückgenommen nach der Frist)? (16.4)
  for (const decisionId of restoredVotes) {
    const d = db.decisions.find((x) => x.id === decisionId);
    if (d?.status === 'offen' && !d.archived_at) settle(ctx, d);
  }
  // was ohne Historie geschah (Markierung, selbst folgen), wird auch still zurückgenommen
  if (record.history_ids.length === 0) return;
  writeHistory(ctx, record.entity_type, entity.id, 'undo', {
    ...undone,
    undone: { old: record.label, new: null },
    // diese Einträge zählen nicht mehr zum Ergebnis eines Plenums
    history_ids: { old: record.history_ids, new: null },
  });
}

// ── Veranstaltungen ─────────────────────────────────────────────────────────

/** Phase 9: Gelöschtes (archiviert) lässt sich nicht mehr bearbeiten – nur über „Rückgängig“ zurückholen */
export function notArchived<T extends { archived_at: string | null }>(row: T): T {
  if (row.archived_at) throw rule('Gelöscht – das lässt sich nicht mehr ändern.');
  return row;
}

export function findEvent(db: Db, id: string): EventRow {
  const event = db.events.find((e) => e.id === id);
  if (!event) throw notFound('Diese Veranstaltung');
  return event;
}

export function createEvent(ctx: Ctx, raw: unknown): { id: string } {
  const input = parse(eventCreateSchema, raw);
  const now = iso(ctx);
  const event: EventRow = {
    id: uuid(),
    title: input.title,
    type: input.type,
    description: input.description,
    starts_at: input.starts_at,
    ends_at: input.ends_at,
    setup_at: input.setup_at,
    teardown_at: input.teardown_at,
    shift_plan_document_id: null,
    drive_folder_id: null,
    status: 'idee',
    archived_at: null,
    created_at: now,
    updated_at: now,
    created_by: ctx.actor.id,
    version: 1,
  };
  ctx.db.events.push(event);
  writeHistory(ctx, 'event', event.id, 'created', { title: { old: null, new: event.title } });
  return { id: event.id };
}

export function updateEvent(ctx: Ctx, id: string, raw: unknown): void {
  const input = parse(eventUpdateSchema, raw);
  const event = notArchived(findEvent(ctx.db, id));
  checkVersion(ctx, 'event', event, input.version);
  const changes: HistoryChanges = {};
  for (const key of [
    'title',
    'type',
    'description',
    'starts_at',
    'ends_at',
    'setup_at',
    'teardown_at',
  ] as const) {
    const same =
      key === 'starts_at' || key === 'ends_at' || key === 'setup_at' || key === 'teardown_at'
        ? (event[key] ? new Date(event[key]).getTime() : null) ===
          (input[key] ? new Date(input[key]).getTime() : null)
        : event[key] === input[key];
    if (same) continue;
    changes[key] = { old: event[key], new: input[key] };
    (event[key] as unknown) = input[key];
  }
  if (Object.keys(changes).length === 0) return;
  touch(ctx, event);
  writeHistory(ctx, 'event', id, 'updated', changes);
}

export function setEventStatus(ctx: Ctx, id: string, status: EventStatus, version: number): Undoable {
  const event = notArchived(findEvent(ctx.db, id));
  checkVersion(ctx, 'event', event, version);
  if (!canTransitionEvent(event.status, status))
    throw rule(
      `Von „${EVENT_STATUS_LABEL[event.status]}“ nach „${EVENT_STATUS_LABEL[status]}“ geht es nicht.`,
    );
  ctx.inverse.push({ kind: 'event_status', event_id: id, status: event.status });
  const changes: HistoryChanges = { status: { old: event.status, new: status } };
  event.status = status;
  touch(ctx, event);
  writeHistory(ctx, 'event', id, 'status', changes);
  return registerUndo(ctx, 'event', event, `Status: ${EVENT_STATUS_LABEL[status]}`);
}

// ── Profil und Mitglieder ───────────────────────────────────────────────────

function findMember(db: Db, id: string): Member {
  const member = db.members.find((m) => m.id === id);
  if (!member) throw notFound('Dieses Mitglied');
  return member;
}

function assertUniqueMember(ctx: Ctx, input: { short: string; email: string }, exceptId?: string): void {
  const others = ctx.db.members.filter((m) => m.id !== exceptId);
  if (others.some((m) => m.short.toUpperCase() === input.short))
    throw new AppError('validation', `Das Kürzel ${input.short} ist schon vergeben.`, { field: 'short' });
  if (others.some((m) => m.email?.toLowerCase() === input.email) || emailTaken(ctx.db, input.email, exceptId))
    throw new AppError('validation', 'Diese Mail-Adresse ist schon eingetragen.', { field: 'email' });
}

/** Eine weitere Adresse eines anderen Mitglieds (oder irgendeines, ohne exceptId) */
const emailTaken = (db: Db, email: string, exceptMemberId?: string) =>
  db.member_emails.some((e) => e.email.toLowerCase() === email && e.member_id !== exceptMemberId);

/** Mitglied zu einer Adresse – Hauptadresse oder weitere (Anmeldung) */
export function memberForEmail(db: Db, email: string): Member | undefined {
  const key = email.toLowerCase();
  const extra = db.member_emails.find((e) => e.email.toLowerCase() === key);
  return db.members.find((m) => (extra ? m.id === extra.member_id : m.email?.toLowerCase() === key));
}

const activeAdmins = (db: Db) => db.members.filter((m) => m.active && m.is_admin && !m.is_system);

export function updateOwnName(ctx: Ctx, raw: unknown): void {
  const name = parse(profileNameSchema, raw);
  const me = findMember(ctx.db, ctx.actor.id);
  if (me.display_name === name) return;
  const changes: HistoryChanges = { display_name: { old: me.display_name, new: name } };
  me.display_name = name;
  touch(ctx, me);
  writeHistory(ctx, 'member', me.id, 'updated', changes);
}

export function createMember(ctx: Ctx, raw: unknown): { id: string } {
  requireAdmin(ctx);
  const input = parse(memberCreateSchema, raw);
  assertUniqueMember(ctx, input);
  const now = iso(ctx);
  const member: Member = {
    id: uuid(),
    auth_user_id: null,
    email: input.email,
    display_name: input.display_name,
    short: input.short,
    is_admin: input.is_admin,
    active: true,
    is_system: false,
    reminder_lead_days: 3,
    created_at: now,
    updated_at: now,
    created_by: ctx.actor.id,
    version: 1,
  };
  ctx.db.members.push(member);
  writeHistory(ctx, 'member', member.id, 'created', {
    display_name: { old: null, new: member.display_name },
  });
  return { id: member.id };
}

export function updateMember(ctx: Ctx, id: string, raw: unknown): void {
  requireAdmin(ctx);
  const input = parse(memberUpdateSchema, raw);
  const member = findMember(ctx.db, id);
  if (member.is_system) throw rule('Der Systemeintrag lässt sich nicht bearbeiten.');
  checkVersion(ctx, 'member', member, input.version);
  assertUniqueMember(ctx, input, id);
  if (member.active && member.is_admin && !input.is_admin && activeAdmins(ctx.db).length <= 1)
    throw rule('Mindestens eine aktive Person braucht Admin-Rechte.', 'is_admin');
  const changes: HistoryChanges = {};
  for (const key of ['display_name', 'short', 'email', 'is_admin'] as const) {
    if (member[key] === input[key]) continue;
    changes[key] = { old: member[key], new: input[key] };
    (member[key] as unknown) = input[key];
  }
  if (Object.keys(changes).length === 0) return;
  touch(ctx, member);
  writeHistory(ctx, 'member', id, 'updated', changes);
}

export function getDeactivationImpact(ctx: Ctx, memberId: string): DeactivationImpact {
  requireAdmin(ctx);
  findMember(ctx.db, memberId);
  const db = ctx.db;
  const impact: DeactivationImpact = {
    member_id: memberId,
    tasks_without_assignee: [],
    tasks_shared_count: 0,
    following_count: db.task_followers.filter((f) => f.member_id === memberId).length,
    future_rsvp_count: 0,
    lead_count: 0,
    partner_contact_count: 0,
  };
  for (const row of db.task_assignees.filter((a) => a.member_id === memberId)) {
    const task = db.tasks.find((t) => t.id === row.task_id);
    if (!task || task.archived_at || !isActiveTaskStatus(task.status)) continue;
    const others = db.task_assignees.some((a) => a.task_id === task.id && a.member_id !== memberId);
    if (others) impact.tasks_shared_count += 1;
    else
      impact.tasks_without_assignee.push({
        id: task.id,
        title: task.title,
        status: task.status,
        status_after: statusAfterLastAssigneeLeft(task.status),
      });
  }
  return impact;
}

/** F-LOG-03: Aufräumen direkt in derselben Transaktion, kein Hintergrundjob. */
export function deactivateMember(ctx: Ctx, memberId: string): DeactivationImpact {
  requireAdmin(ctx);
  const member = findMember(ctx.db, memberId);
  if (member.is_system) throw rule('Der Systemeintrag lässt sich nicht deaktivieren.');
  if (!member.active) throw rule(`${member.display_name} ist schon deaktiviert.`);
  if (member.is_admin && activeAdmins(ctx.db).length <= 1)
    throw rule('Letzte Person mit Admin-Rechten – kann nicht deaktiviert werden.');
  const impact = getDeactivationImpact(ctx, memberId);
  for (const row of ctx.db.task_assignees.filter((a) => a.member_id === memberId))
    dropAssignee(ctx, findTask(ctx.db, row.task_id), memberId, 'deactivated');
  for (const row of ctx.db.task_followers.filter((f) => f.member_id === memberId))
    dropFollower(ctx, row.task_id, memberId, 'deactivated');
  member.active = false;
  touch(ctx, member);
  writeHistory(ctx, 'member', memberId, 'deactivated', { active: { old: true, new: false } });
  return impact;
}

export function reactivateMember(ctx: Ctx, memberId: string): void {
  requireAdmin(ctx);
  const member = findMember(ctx.db, memberId);
  if (member.active) return;
  // frühere Einträge werden nicht wiederhergestellt (WF-ADM-04)
  member.active = true;
  touch(ctx, member);
  writeHistory(ctx, 'member', memberId, 'reactivated', { active: { old: false, new: true } });
}

// ── Weitere Login-Adressen (WF-ADM-09, nur Admins) ──────────────────────────
// Eigene Zeilen wie Kommentare: das Mitglied selbst (version) bleibt unverändert, die Historie hält es fest.

export function listMemberEmails(ctx: Ctx, memberId: string): MemberEmail[] {
  requireAdmin(ctx);
  findMember(ctx.db, memberId);
  return ctx.db.member_emails
    .filter((e) => e.member_id === memberId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export function addMemberEmail(ctx: Ctx, memberId: string, raw: unknown): void {
  requireAdmin(ctx);
  const email = parse(emailInputSchema, raw);
  const member = findMember(ctx.db, memberId);
  if (member.is_system) throw rule('Der Systemeintrag lässt sich nicht bearbeiten.');
  if (
    member.email?.toLowerCase() === email ||
    ctx.db.member_emails.some((e) => e.member_id === memberId && e.email === email)
  )
    return;
  if (ctx.db.members.some((m) => m.email?.toLowerCase() === email) || emailTaken(ctx.db, email))
    throw new AppError('validation', 'Diese Mail-Adresse ist schon eingetragen.', { field: 'email' });
  ctx.db.member_emails.push({
    id: uuid(),
    member_id: memberId,
    email,
    created_at: iso(ctx),
    created_by: ctx.actor.id,
  });
  writeHistory(ctx, 'member', memberId, 'email_added', { email: { old: null, new: email } });
}

export function removeMemberEmail(ctx: Ctx, id: string): void {
  requireAdmin(ctx);
  const row = ctx.db.member_emails.find((e) => e.id === id);
  if (!row) return;
  const member = findMember(ctx.db, row.member_id);
  ctx.db.member_emails = ctx.db.member_emails.filter((e) => e.id !== id);
  writeHistory(ctx, 'member', member.id, 'email_removed', { email: { old: row.email, new: null } });
}

// ── Themen (nur Admins) ─────────────────────────────────────────────────────

function findTopic(db: Db, id: string): Topic {
  const topic = db.topics.find((t) => t.id === id);
  if (!topic) throw notFound('Dieses Thema');
  return topic;
}

function assertTopicPlacement(
  ctx: Ctx,
  input: { name: string; parent_id: string | null },
  self?: Topic,
): void {
  if (input.parent_id) {
    const parent = ctx.db.topics.find((t) => t.id === input.parent_id);
    if (!parent || parent.archived_at || parent.parent_id || parent.id === self?.id)
      throw new AppError('validation', 'Als Oberthema geht nur ein aktives Thema der obersten Ebene.', {
        field: 'parent_id',
      });
    if (self && ctx.db.topics.some((t) => t.parent_id === self.id))
      throw new AppError(
        'validation',
        'Ein Thema mit Unterkategorien kann selbst keine Unterkategorie werden.',
        {
          field: 'parent_id',
        },
      );
  }
  const clash = ctx.db.topics.some(
    (t) =>
      t.id !== self?.id &&
      !t.archived_at &&
      t.parent_id === input.parent_id &&
      t.name.toLowerCase() === input.name.toLowerCase(),
  );
  if (clash)
    throw new AppError('validation', 'Ein Thema mit diesem Namen gibt es hier schon.', { field: 'name' });
}

export function createTopic(ctx: Ctx, raw: unknown): { id: string } {
  requireAdmin(ctx);
  const input = parse(topicCreateSchema, raw);
  assertTopicPlacement(ctx, input);
  const siblings = ctx.db.topics.filter((t) => t.parent_id === input.parent_id);
  const now = iso(ctx);
  const topic: Topic = {
    id: uuid(),
    name: input.name,
    parent_id: input.parent_id,
    sort_order: Math.max(0, ...siblings.map((t) => t.sort_order)) + 1,
    archived_at: null,
    created_at: now,
    updated_at: now,
    created_by: ctx.actor.id,
    version: 1,
  };
  ctx.db.topics.push(topic);
  writeHistory(ctx, 'topic', topic.id, 'created', { name: { old: null, new: topic.name } });
  return { id: topic.id };
}

export function updateTopic(ctx: Ctx, id: string, raw: unknown): void {
  requireAdmin(ctx);
  const input = parse(topicUpdateSchema, raw);
  const topic = findTopic(ctx.db, id);
  checkVersion(ctx, 'topic', topic, input.version);
  assertTopicPlacement(ctx, input, topic);
  const changes: HistoryChanges = {};
  if (topic.name !== input.name) {
    changes.name = { old: topic.name, new: input.name };
    topic.name = input.name;
  }
  if (topic.parent_id !== input.parent_id) {
    changes.parent_id = { old: topic.parent_id, new: input.parent_id };
    topic.parent_id = input.parent_id;
    const siblings = ctx.db.topics.filter((t) => t.parent_id === input.parent_id && t.id !== id);
    topic.sort_order = Math.max(0, ...siblings.map((t) => t.sort_order)) + 1;
  }
  if (Object.keys(changes).length === 0) return;
  touch(ctx, topic);
  writeHistory(ctx, 'topic', id, 'updated', changes);
}

export function archiveTopic(ctx: Ctx, id: string, version: number): void {
  requireAdmin(ctx);
  const topic = findTopic(ctx.db, id);
  checkVersion(ctx, 'topic', topic, version);
  if (topic.archived_at) return;
  const active = ctx.db.tasks.filter(
    (t) => t.topic_id === id && !t.archived_at && isActiveTaskStatus(t.status),
  ).length;
  if (active > 0)
    throw rule(
      `Das Thema hat noch ${active} ${active === 1 ? 'aktive Aufgabe' : 'aktive Aufgaben'} und lässt sich deshalb nicht archivieren.`,
    );
  if (ctx.db.topics.some((t) => t.parent_id === id && !t.archived_at))
    throw rule('Erst die Unterkategorien archivieren oder umhängen.');
  topic.archived_at = iso(ctx);
  touch(ctx, topic);
  writeHistory(ctx, 'topic', id, 'archived');
}

export function restoreTopic(ctx: Ctx, id: string, version: number): void {
  requireAdmin(ctx);
  const topic = findTopic(ctx.db, id);
  checkVersion(ctx, 'topic', topic, version);
  if (!topic.archived_at) return;
  if (topic.parent_id && findTopic(ctx.db, topic.parent_id).archived_at)
    throw rule('Erst das Oberthema wiederherstellen.');
  // inzwischen kann ein gleichnamiges Thema angelegt worden sein
  assertTopicPlacement(ctx, { name: topic.name, parent_id: topic.parent_id }, topic);
  topic.archived_at = null;
  touch(ctx, topic);
  writeHistory(ctx, 'topic', id, 'restored');
}

export function deleteTopic(ctx: Ctx, id: string): void {
  requireAdmin(ctx);
  const topic = findTopic(ctx.db, id);
  if (
    ctx.db.tasks.some((t) => t.topic_id === id) ||
    ctx.db.event_template_items.some((i) => i.topic_id === id)
  )
    throw rule('Das Thema wird benutzt (auch Vorlagen zählen) und lässt sich deshalb nur archivieren.');
  if (ctx.db.topics.some((t) => t.parent_id === id))
    throw rule('Das Thema hat Unterkategorien und lässt sich deshalb nicht löschen.');
  ctx.db.topics = ctx.db.topics.filter((t) => t !== topic);
  writeHistory(ctx, 'topic', id, 'deleted', { name: { old: topic.name, new: null } });
}
