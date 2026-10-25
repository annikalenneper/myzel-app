// Testdaten-Schicht, Phase 3: Termine, Terminarten, Zu- und Absagen, Teilnahme (ANFORDERUNGEN 3.6, 4.3)
import { AppError } from '../../shared/errors';
import {
  canMarkHappened,
  canRsvp,
  changeMessages,
  hasStarted,
  invitationMessages,
  yesAndOpen,
} from '../../shared/rules/appointments';
import { ruleLabel } from '../../shared/rules/series';
import {
  appointmentCreateSchema,
  appointmentTypeCreateSchema,
  appointmentTypeUpdateSchema,
  appointmentUpdateSchema,
  type Appointment,
  type AppointmentType,
  type HistoryChanges,
  type RsvpAnswer,
} from '../../shared/schema';
import type { AppointmentDetail, AppointmentListItem, AppointmentTypeWithUsage, Undoable } from '../api';
import { enqueue } from './notify';
import {
  checkVersion,
  notFound,
  parse,
  registerUndo,
  requireAdmin,
  rule,
  touch,
  writeHistory,
  type Ctx,
  type Db,
} from './server';

const uuid = () => crypto.randomUUID();
const iso = (ctx: Ctx) => ctx.now.toISOString();
export const activeIds = (db: Db) => db.members.filter((m) => m.active && !m.is_system).map((m) => m.id);

// ── Terminarten (nur Admins, WF-ADM-06) ─────────────────────────────────────

function findType(db: Db, id: string): AppointmentType {
  const type = db.appointment_types.find((t) => t.id === id);
  if (!type) throw notFound('Diese Terminart');
  return type;
}

export function listAppointmentTypes(db: Db): AppointmentTypeWithUsage[] {
  return [...db.appointment_types]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((t) => ({ ...t, appointment_count: db.appointments.filter((a) => a.type_id === t.id).length }));
}

function assertType(
  ctx: Ctx,
  input: { label: string; default_topic_id: string },
  self?: AppointmentType,
): void {
  const topic = ctx.db.topics.find((t) => t.id === input.default_topic_id);
  if (!topic || topic.archived_at)
    throw new AppError('validation', 'Bitte ein aktives Thema wählen.', { field: 'default_topic_id' });
  const clash = ctx.db.appointment_types.some(
    (t) => t.id !== self?.id && !t.archived_at && t.label.toLowerCase() === input.label.toLowerCase(),
  );
  if (clash)
    throw new AppError('validation', 'Eine Terminart mit diesem Namen gibt es schon.', { field: 'label' });
}

export function createAppointmentType(ctx: Ctx, raw: unknown): { id: string } {
  requireAdmin(ctx);
  const input = parse(appointmentTypeCreateSchema, raw);
  assertType(ctx, input);
  const now = iso(ctx);
  const type: AppointmentType = {
    id: uuid(),
    key: input.label
      .toLowerCase()
      .normalize('NFD')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, ''),
    label: input.label,
    default_topic_id: input.default_topic_id,
    default_format: input.default_format,
    default_location: input.default_location,
    has_plenum_features: input.has_plenum_features,
    color: input.color,
    sort_order: Math.max(0, ...ctx.db.appointment_types.map((t) => t.sort_order)) + 1,
    archived_at: null,
    created_at: now,
    updated_at: now,
    created_by: ctx.actor.id,
    version: 1,
  };
  ctx.db.appointment_types.push(type);
  writeHistory(ctx, 'appointment_type', type.id, 'created', { label: { old: null, new: type.label } });
  return { id: type.id };
}

export function updateAppointmentType(ctx: Ctx, id: string, raw: unknown): void {
  requireAdmin(ctx);
  const input = parse(appointmentTypeUpdateSchema, raw);
  const type = findType(ctx.db, id);
  checkVersion(ctx, 'appointment_type', type, input.version);
  assertType(ctx, input, type);
  const changes: HistoryChanges = {};
  for (const key of ['label', 'default_topic_id', 'default_format', 'default_location', 'color'] as const) {
    if (type[key] === input[key]) continue;
    changes[key] = { old: type[key], new: input[key] };
    (type[key] as unknown) = input[key];
  }
  if (Object.keys(changes).length === 0) return;
  touch(ctx, type);
  writeHistory(ctx, 'appointment_type', id, 'updated', changes);
}

export function archiveAppointmentType(ctx: Ctx, id: string, version: number, archived: boolean): void {
  requireAdmin(ctx);
  const type = findType(ctx.db, id);
  checkVersion(ctx, 'appointment_type', type, version);
  if (!!type.archived_at === archived) return;
  if (!archived) assertType(ctx, { label: type.label, default_topic_id: type.default_topic_id }, type);
  type.archived_at = archived ? iso(ctx) : null;
  touch(ctx, type);
  writeHistory(ctx, 'appointment_type', id, archived ? 'archived' : 'restored');
}

export function deleteAppointmentType(ctx: Ctx, id: string): void {
  requireAdmin(ctx);
  const type = findType(ctx.db, id);
  if (ctx.db.appointments.some((a) => a.type_id === id))
    throw rule('Mit Terminen belegt – deshalb nur archivierbar.');
  ctx.db.appointment_types = ctx.db.appointment_types.filter((t) => t !== type);
  writeHistory(ctx, 'appointment_type', id, 'deleted', { label: { old: type.label, new: null } });
}

// ── Termine ─────────────────────────────────────────────────────────────────

export function findAppointment(db: Db, id: string): Appointment {
  const appointment = db.appointments.find((a) => a.id === id);
  if (!appointment) throw notFound('Diesen Termin');
  return appointment;
}

export const isPlenum = (db: Db, appointment: Pick<Appointment, 'type_id'>) =>
  !!db.appointment_types.find((t) => t.id === appointment.type_id)?.has_plenum_features;

function seriesRef(db: Db, a: Appointment): AppointmentListItem['series'] {
  const s = a.series_id ? db.appointment_series.find((x) => x.id === a.series_id) : undefined;
  return s ? { id: s.id, label: ruleLabel(s.rrule), active: s.active } : null;
}

function listItem(db: Db, a: Appointment, meId: string): AppointmentListItem {
  const type = findType(db, a.type_id);
  const rsvps = db.appointment_rsvps.filter((r) => r.appointment_id === a.id);
  return {
    ...a,
    type_label: type.label,
    type_color: type.color,
    is_plenum: type.has_plenum_features,
    yes_count: rsvps.filter((r) => r.answer === 'ja').length,
    my_answer: rsvps.find((r) => r.member_id === meId)?.answer ?? null,
    task_count: db.tasks.filter((t) => t.appointment_id === a.id && !t.archived_at).length,
    series: seriesRef(db, a),
  };
}

export function listAppointments(db: Db, meId: string): AppointmentListItem[] {
  return db.appointments.filter((a) => !a.archived_at).map((a) => listItem(db, a, meId));
}

export function getAppointment(db: Db, id: string, meId: string): AppointmentDetail {
  const a = findAppointment(db, id);
  const rsvps = db.appointment_rsvps.filter((r) => r.appointment_id === id);
  const answered = new Set(rsvps.map((r) => r.member_id));
  return {
    ...listItem(db, a, meId),
    yes_ids: rsvps.filter((r) => r.answer === 'ja').map((r) => r.member_id),
    no_ids: rsvps.filter((r) => r.answer === 'nein').map((r) => r.member_id),
    open_ids: activeIds(db).filter((m) => !answered.has(m)),
    attendee_ids: db.appointment_attendees.filter((x) => x.appointment_id === id).map((x) => x.member_id),
    tasks: db.tasks
      .filter((t) => t.appointment_id === id && !t.archived_at)
      .map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        assignee_ids: db.task_assignees.filter((x) => x.task_id === t.id).map((x) => x.member_id),
      })),
  };
}

export function checkRefs(
  ctx: Ctx,
  input: { type_id: string; event_id: string | null },
  creating: boolean,
): AppointmentType {
  const type = ctx.db.appointment_types.find((t) => t.id === input.type_id);
  if (!type || (creating && type.archived_at))
    throw new AppError('validation', 'Diese Terminart gibt es nicht mehr.', { field: 'type_id' });
  if (input.event_id && !ctx.db.events.some((e) => e.id === input.event_id && !e.archived_at))
    throw new AppError('validation', 'Diese Veranstaltung gibt es nicht mehr.', { field: 'event_id' });
  return type;
}

/** WF-TER-02 / WF-PLE-01: Status geplant; Einladung an alle aktiven Mitglieder */
export function createAppointment(ctx: Ctx, raw: unknown): { id: string } {
  const input = parse(appointmentCreateSchema, raw);
  const type = checkRefs(ctx, input, true);
  const now = iso(ctx);
  const appointment: Appointment = {
    id: uuid(),
    type_id: input.type_id,
    title: input.title,
    topic_id: type.default_topic_id,
    event_id: input.event_id,
    starts_at: input.starts_at,
    ends_at: input.ends_at,
    format: input.format,
    location: input.format === 'online' ? null : input.location,
    online_url: input.format === 'vor_ort' ? null : input.online_url,
    status: 'geplant',
    series_id: null,
    series_date: null,
    is_exception: false,
    protocol_document_id: null,
    protocol_member_id: null,
    notes: null,
    archived_at: null,
    created_at: now,
    updated_at: now,
    created_by: ctx.actor.id,
    version: 1,
  };
  ctx.db.appointments.push(appointment);
  writeHistory(ctx, 'appointment', appointment.id, 'created', {
    title: { old: null, new: appointment.title },
  });
  // nachgetragene Termine laden niemanden mehr ein
  if (!hasStarted(appointment, ctx.now))
    enqueue(ctx.db, ctx.now, invitationMessages(appointment, activeIds(ctx.db), ctx.actor.id));
  return { id: appointment.id };
}

/** WF-TER-10: ein einzeln geänderter oder abgesagter Serientermin ist eine Ausnahme – die Serie lässt ihn in Ruhe */
function markException(a: Appointment, changes: HistoryChanges): void {
  if (!a.series_id || a.is_exception) return;
  changes.is_exception = { old: false, new: true };
  a.is_exception = true;
}

/** WF-TER-04: bearbeiten/verschieben; bei Zeit oder Ort geändert: Nachricht an Zusagen und ohne Antwort */
export function updateAppointment(ctx: Ctx, id: string, raw: unknown): { notified: number } {
  const input = parse(appointmentUpdateSchema, raw);
  const a = findAppointment(ctx.db, id);
  checkVersion(ctx, 'appointment', a, input.version);
  if (a.status === 'abgesagt') throw rule('Abgesagte Termine lassen sich nicht mehr bearbeiten.');
  if (input.type_id !== a.type_id) throw rule('Die Terminart lässt sich nachträglich nicht ändern.');
  checkRefs(ctx, input, false);
  const next = {
    title: input.title,
    starts_at: input.starts_at,
    ends_at: input.ends_at,
    format: input.format,
    location: input.format === 'online' ? null : input.location,
    online_url: input.format === 'vor_ort' ? null : input.online_url,
    event_id: input.event_id,
  };
  const time = (v: string | null) => (v ? new Date(v).getTime() : null);
  const changes: HistoryChanges = {};
  for (const key of Object.keys(next) as (keyof typeof next)[]) {
    const same =
      key === 'starts_at' || key === 'ends_at' ? time(a[key]) === time(next[key]) : a[key] === next[key];
    if (same) continue;
    changes[key] = { old: a[key], new: next[key] };
    (a[key] as unknown) = next[key];
  }
  if (Object.keys(changes).length === 0) return { notified: 0 };
  markException(a, changes);
  touch(ctx, a);
  writeHistory(ctx, 'appointment', id, 'updated', changes);
  // Zusagen bleiben erhalten; benachrichtigt wird nur, was noch bevorsteht
  const moved = ['starts_at', 'ends_at', 'format', 'location', 'online_url'].some((k) => k in changes);
  if (!moved || a.status !== 'geplant' || hasStarted(a, ctx.now)) return { notified: 0 };
  const recipients = yesAndOpen(
    ctx.db.appointment_rsvps.filter((r) => r.appointment_id === id),
    activeIds(ctx.db),
  ).filter((m) => m !== ctx.actor.id);
  enqueue(
    ctx.db,
    ctx.now,
    changeMessages(a, 'verschoben', recipients, ctx.actor.id, iso(ctx)),
    (ctx.outbox ??= []),
  );
  return { notified: recipients.length };
}

/** WF-TER-03: Zu- oder Absage setzen, ändern oder zurücknehmen */
export function setRsvp(ctx: Ctx, id: string, answer: RsvpAnswer | null): Undoable {
  const a = findAppointment(ctx.db, id);
  if (!canRsvp(a, ctx.now))
    throw rule(
      a.status === 'geplant'
        ? 'Der Termin hat schon begonnen – Zu- und Absagen sind nicht mehr möglich.'
        : 'Für diesen Termin sind keine Zu- und Absagen mehr möglich.',
    );
  const db = ctx.db;
  const current = db.appointment_rsvps.find((r) => r.appointment_id === id && r.member_id === ctx.actor.id);
  if ((current?.answer ?? null) === answer) return { undo_token: '' };
  ctx.inverse.push({
    kind: 'rsvp_restore',
    appointment_id: id,
    member_id: ctx.actor.id,
    row: current ?? null,
  });
  db.appointment_rsvps = db.appointment_rsvps.filter((r) => r !== current);
  if (answer)
    db.appointment_rsvps.push({ appointment_id: id, member_id: ctx.actor.id, answer, answered_at: iso(ctx) });
  writeHistory(ctx, 'appointment', id, 'rsvp', { rsvp: { old: current?.answer ?? null, new: answer } });
  return registerUndo(
    ctx,
    'appointment',
    a,
    answer === 'ja' ? 'Zugesagt' : answer === 'nein' ? 'Abgesagt' : 'Antwort zurückgenommen',
  );
}

/** WF-TER-05: absagen – Nachricht an Zusagen und ohne Antwort, Markierung entfernt */
export function cancelAppointment(ctx: Ctx, id: string, version: number): { notified: number } {
  const a = findAppointment(ctx.db, id);
  checkVersion(ctx, 'appointment', a, version);
  if (a.status !== 'geplant') throw rule('Nur geplante Termine lassen sich absagen.');
  const changes: HistoryChanges = { status: { old: a.status, new: 'abgesagt' } };
  markException(a, changes);
  a.status = 'abgesagt';
  touch(ctx, a);
  writeHistory(ctx, 'appointment', id, 'status', changes);
  const recipients = yesAndOpen(
    ctx.db.appointment_rsvps.filter((r) => r.appointment_id === id),
    activeIds(ctx.db),
  ).filter((m) => m !== ctx.actor.id);
  enqueue(
    ctx.db,
    ctx.now,
    changeMessages(a, 'abgesagt', recipients, ctx.actor.id, iso(ctx)),
    (ctx.outbox ??= []),
  );
  return { notified: recipients.length };
}

function replaceAttendees(ctx: Ctx, id: string, memberIds: readonly string[]): void {
  const unique = [...new Set(memberIds)];
  for (const memberId of unique)
    if (!ctx.db.members.some((m) => m.id === memberId && !m.is_system))
      throw rule('Unbekannte Person in der Teilnahmeliste.');
  ctx.db.appointment_attendees = ctx.db.appointment_attendees
    .filter((x) => x.appointment_id !== id)
    .concat(unique.map((member_id) => ({ appointment_id: id, member_id })));
}

/** WF-TER-06: „Hat stattgefunden“ mit Teilnahme – erst nach Beginn */
export function markHappened(
  ctx: Ctx,
  id: string,
  attendeeIds: readonly string[],
  version: number,
): Undoable {
  const a = findAppointment(ctx.db, id);
  checkVersion(ctx, 'appointment', a, version);
  if (!canMarkHappened(a, ctx.now))
    throw rule(
      a.status === 'geplant'
        ? 'Das geht erst, wenn der Termin begonnen hat.'
        : 'Der Termin ist nicht mehr im Status „Geplant“.',
    );
  ctx.inverse.push({
    kind: 'appointment_state',
    appointment_id: id,
    status: a.status,
    attendees: ctx.db.appointment_attendees.filter((x) => x.appointment_id === id),
  });
  const changes: HistoryChanges = {
    status: { old: a.status, new: 'stattgefunden' },
    attendees: { old: null, new: attendeeIds.length },
  };
  a.status = 'stattgefunden';
  replaceAttendees(ctx, id, attendeeIds);
  touch(ctx, a);
  writeHistory(ctx, 'appointment', id, 'status', changes);
  return registerUndo(ctx, 'appointment', a, 'Als stattgefunden gespeichert');
}

/** Vergangene Termine bleiben korrigierbar (4.3): Teilnahme nachträglich ändern */
export function setAttendee(ctx: Ctx, id: string, memberId: string, present: boolean): void {
  const a = findAppointment(ctx.db, id);
  if (a.status !== 'stattgefunden' && a.status !== 'abgeschlossen')
    throw rule('Die Teilnahme lässt sich erst festhalten, wenn der Termin stattgefunden hat.');
  const db = ctx.db;
  const exists = db.appointment_attendees.some((x) => x.appointment_id === id && x.member_id === memberId);
  if (exists === present) return;
  if (present) {
    if (!db.members.some((m) => m.id === memberId && !m.is_system)) throw notFound('Dieses Mitglied');
    db.appointment_attendees.push({ appointment_id: id, member_id: memberId });
  } else
    db.appointment_attendees = db.appointment_attendees.filter(
      (x) => !(x.appointment_id === id && x.member_id === memberId),
    );
  writeHistory(ctx, 'appointment', id, present ? 'attendee_added' : 'attendee_removed', {
    attendee: present ? { old: null, new: memberId } : { old: memberId, new: null },
  });
}

/** Beim Deaktivieren: Zusagen für künftige Termine entfernen (F-LOG-03, ab P3) */
export function futureRsvpCount(db: Db, memberId: string, now: Date): number {
  return db.appointment_rsvps.filter((r) => {
    if (r.member_id !== memberId) return false;
    const a = db.appointments.find((x) => x.id === r.appointment_id);
    return !!a && a.status === 'geplant' && !hasStarted(a, now);
  }).length;
}

export function dropFutureRsvps(ctx: Ctx, memberId: string): void {
  const db = ctx.db;
  for (const r of db.appointment_rsvps.filter((x) => x.member_id === memberId)) {
    const a = db.appointments.find((x) => x.id === r.appointment_id);
    if (!a || a.status !== 'geplant' || hasStarted(a, ctx.now)) continue;
    db.appointment_rsvps = db.appointment_rsvps.filter((x) => x !== r);
    writeHistory(ctx, 'appointment', a.id, 'rsvp_removed', {
      rsvp: { old: r.answer, new: null },
      member: { old: memberId, new: null },
      reason: { old: null, new: 'deactivated' },
    });
  }
}
