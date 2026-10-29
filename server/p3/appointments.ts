// Phase 3: Termine, Terminarten, Zu- und Absagen, Teilnahme (ANFORDERUNGEN 3.6, 4.3; WF-TER-01 bis -08,
// WF-ADM-06). Wie die Testdaten-Schicht (src/data/mock/appointments.ts), gegen die Datenbank.
import type {
  AppointmentDetail,
  AppointmentListItem,
  AppointmentTypeWithUsage,
  Undoable,
} from '../../src/data/api';
import { AppError } from '../../src/shared/errors';
import {
  canMarkHappened,
  canRsvp,
  changeMessages,
  hasStarted,
  invitationMessages,
  invitedIds,
  yesAndOpen,
} from '../../src/shared/rules/appointments';
import { z } from 'zod';
import {
  idSchema,
  appointmentCreateSchema,
  appointmentTypeCreateSchema,
  appointmentTypeUpdateSchema,
  appointmentUpdateSchema,
  type HistoryChanges,
  type RsvpAnswer,
} from '../../src/shared/schema';
import {
  ARCHIVED,
  checkVersion,
  iso,
  notFound,
  parse,
  registerUndo,
  requireAdmin,
  rule,
  updatedOne,
  writeHistory,
  type Ctx,
  type Db,
  type ReadCtx,
} from '../core/context';
import type { AppointmentRow, AppointmentTypeRow } from '../db/types';
import { commentsOf } from '../p1/comments';
import { historyOf } from '../p1/reads';
import { notify } from '../p2/notify';

/** Serien kommen mit P6 */
const seriesLater = { series_id: null, series_date: null, series: null } as const;

export async function activeIds(trx: Db): Promise<string[]> {
  const rows = await trx
    .selectFrom('members')
    .select('id')
    .where('active', '=', true)
    .where('is_system', '=', false)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  return rows.map((r) => r.id);
}

async function inviteeIds(trx: Db, id: string): Promise<string[]> {
  const rows = await trx
    .selectFrom('appointment_invitees')
    .select('member_id')
    .where('appointment_id', '=', id)
    .execute();
  return rows.map((r) => r.member_id);
}

// ── Terminarten (nur Admins, WF-ADM-06) ─────────────────────────────────────

async function findType(trx: Db, id: string, lock = false): Promise<AppointmentTypeRow> {
  const type = await trx
    .selectFrom('appointment_types')
    .selectAll()
    .where('id', '=', id)
    .$if(lock, (q) => q.forUpdate())
    .executeTakeFirst();
  if (!type) throw notFound('Diese Terminart');
  return type;
}

export async function listAppointmentTypes(ctx: ReadCtx): Promise<AppointmentTypeWithUsage[]> {
  const [types, counts] = await Promise.all([
    ctx.trx.selectFrom('appointment_types').selectAll().orderBy('sort_order').orderBy('id').execute(),
    ctx.trx
      .selectFrom('appointments')
      .select(['type_id', (eb) => eb.fn.countAll<number>().as('n')])
      .groupBy('type_id')
      .execute(),
  ]);
  return types.map((t) => ({
    ...t,
    appointment_count: Number(counts.find((c) => c.type_id === t.id)?.n ?? 0),
  }));
}

async function assertType(
  ctx: Ctx,
  input: { label: string; default_topic_id: string },
  selfId?: string,
): Promise<void> {
  const topic = await ctx.trx
    .selectFrom('topics')
    .select('archived_at')
    .where('id', '=', input.default_topic_id)
    .forShare()
    .executeTakeFirst();
  if (!topic || topic.archived_at)
    throw new AppError('validation', 'Bitte ein aktives Thema wählen.', { field: 'default_topic_id' });
  const clash = await ctx.trx
    .selectFrom('appointment_types')
    .select('id')
    .where('archived_at', 'is', null)
    .where((eb) => eb(eb.fn('lower', ['label']), '=', input.label.toLowerCase()))
    .$if(!!selfId, (q) => q.where('id', '<>', selfId!))
    .executeTakeFirst();
  if (clash)
    throw new AppError('validation', 'Eine Terminart mit diesem Namen gibt es schon.', { field: 'label' });
}

export async function createAppointmentType(ctx: Ctx, raw: unknown): Promise<{ id: string }> {
  requireAdmin(ctx);
  const input = parse(appointmentTypeCreateSchema, raw);
  await assertType(ctx, input);
  const max = await ctx.trx
    .selectFrom('appointment_types')
    .select((eb) => eb.fn.max('sort_order').as('max'))
    .executeTakeFirst();
  const now = iso(ctx);
  const type = await ctx.trx
    .insertInto('appointment_types')
    .values({
      // nur aus Sonderzeichen: ein eigener Schlüssel statt eines leeren
      key:
        input.label
          .toLowerCase()
          .normalize('NFD')
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_|_$/g, '') || `typ_${crypto.randomUUID().slice(0, 8)}`,
      label: input.label,
      default_topic_id: input.default_topic_id,
      default_format: input.default_format,
      default_location: input.default_location,
      has_plenum_features: input.has_plenum_features,
      color: input.color,
      sort_order: Math.max(0, Number(max?.max ?? 0)) + 1,
      created_at: now,
      updated_at: now,
      created_by: ctx.actor.id,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await writeHistory(ctx, 'appointment_type', type.id, 'created', { label: { old: null, new: input.label } });
  return { id: type.id };
}

async function touchType(ctx: Ctx, type: AppointmentTypeRow, set: Partial<AppointmentTypeRow>) {
  const result = await ctx.trx
    .updateTable('appointment_types')
    .set({ ...set, version: type.version + 1, updated_at: iso(ctx) } as never)
    .where('id', '=', type.id)
    .where('version', '=', type.version)
    .executeTakeFirst();
  await updatedOne(ctx, result, 'appointment_type', type);
}

export async function updateAppointmentType(ctx: Ctx, id: string, raw: unknown): Promise<void> {
  requireAdmin(ctx);
  const input = parse(appointmentTypeUpdateSchema, raw);
  const type = await findType(ctx.trx, id, true);
  await checkVersion(ctx, 'appointment_type', type, input.version);
  await assertType(ctx, input, id);
  const changes: HistoryChanges = {};
  const set: Partial<AppointmentTypeRow> = {};
  for (const key of ['label', 'default_topic_id', 'default_format', 'default_location', 'color'] as const) {
    if (type[key] === input[key]) continue;
    changes[key] = { old: type[key], new: input[key] };
    (set as Record<string, unknown>)[key] = input[key];
  }
  if (Object.keys(changes).length === 0) return;
  await touchType(ctx, type, set);
  await writeHistory(ctx, 'appointment_type', id, 'updated', changes);
}

export async function archiveAppointmentType(
  ctx: Ctx,
  id: string,
  version: number,
  archived: boolean,
): Promise<void> {
  requireAdmin(ctx);
  const type = await findType(ctx.trx, id, true);
  await checkVersion(ctx, 'appointment_type', type, version);
  if (!!type.archived_at === archived) return;
  if (!archived) await assertType(ctx, { label: type.label, default_topic_id: type.default_topic_id }, id);
  await touchType(ctx, type, { archived_at: archived ? iso(ctx) : null });
  await writeHistory(ctx, 'appointment_type', id, archived ? 'archived' : 'restored');
}

export async function deleteAppointmentType(ctx: Ctx, id: string): Promise<void> {
  requireAdmin(ctx);
  const type = await findType(ctx.trx, id, true);
  const used = await ctx.trx
    .selectFrom('appointments')
    .select('id')
    .where('type_id', '=', id)
    .executeTakeFirst();
  if (used) throw rule('Mit Terminen belegt – deshalb nur archivierbar.');
  await ctx.trx.deleteFrom('appointment_types').where('id', '=', id).execute();
  await writeHistory(ctx, 'appointment_type', id, 'deleted', { label: { old: type.label, new: null } });
}

// ── Termine ─────────────────────────────────────────────────────────────────

export async function findAppointment(trx: Db, id: string, lock = true): Promise<AppointmentRow> {
  const appointment = await trx
    .selectFrom('appointments')
    .selectAll()
    .where('id', '=', id)
    .$if(lock, (q) => q.forUpdate())
    .executeTakeFirst();
  if (!appointment) throw notFound('Diesen Termin');
  // gesperrt heißt schreiben: Gelöschtes bleibt, wie es ist
  if (lock && appointment.archived_at) throw rule(ARCHIVED);
  return appointment;
}

export async function isPlenum(trx: Db, appointment: Pick<AppointmentRow, 'type_id'>): Promise<boolean> {
  const type = await trx
    .selectFrom('appointment_types')
    .select('has_plenum_features')
    .where('id', '=', appointment.type_id)
    .executeTakeFirst();
  return !!type?.has_plenum_features;
}

async function listItems(trx: Db, rows: AppointmentRow[], meId: string): Promise<AppointmentListItem[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((a) => a.id);
  const [types, rsvps, tasks] = await Promise.all([
    trx.selectFrom('appointment_types').select(['id', 'label', 'color', 'has_plenum_features']).execute(),
    trx.selectFrom('appointment_rsvps').selectAll().where('appointment_id', 'in', ids).execute(),
    trx
      .selectFrom('tasks')
      .select('appointment_id')
      .where('appointment_id', 'in', ids)
      .where('archived_at', 'is', null)
      .execute(),
  ]);
  return rows.map((a) => {
    const type = types.find((t) => t.id === a.type_id)!;
    const own = rsvps.filter((r) => r.appointment_id === a.id);
    return {
      ...a,
      ...seriesLater,
      type_label: type.label,
      type_color: type.color,
      is_plenum: type.has_plenum_features,
      yes_count: own.filter((r) => r.answer === 'ja').length,
      my_answer: own.find((r) => r.member_id === meId)?.answer ?? null,
      task_count: tasks.filter((t) => t.appointment_id === a.id).length,
    };
  });
}

export async function listAppointments(ctx: ReadCtx): Promise<AppointmentListItem[]> {
  const rows = await ctx.trx
    .selectFrom('appointments')
    .selectAll()
    .where('archived_at', 'is', null)
    .orderBy('starts_at')
    .orderBy('id')
    .execute();
  return listItems(ctx.trx, rows, ctx.actor.id);
}

export async function getAppointment(trx: Db, id: string, meId: string): Promise<AppointmentDetail> {
  const a = await findAppointment(trx, id, false);
  const [[item], rsvps, attendees, tasks, people, invitees, comments, history] = await Promise.all([
    listItems(trx, [a], meId),
    trx.selectFrom('appointment_rsvps').selectAll().where('appointment_id', '=', id).execute(),
    trx.selectFrom('appointment_attendees').select('member_id').where('appointment_id', '=', id).execute(),
    trx
      .selectFrom('tasks')
      .select(['id', 'title', 'status'])
      .where('appointment_id', '=', id)
      .where('archived_at', 'is', null)
      .orderBy('created_at')
      .orderBy('id')
      .execute(),
    activeIds(trx),
    inviteeIds(trx, id),
    commentsOf(trx, 'appointment', id),
    historyOf(trx, 'appointment', id),
  ]);
  const assignees = tasks.length
    ? await trx
        .selectFrom('task_assignees')
        .select(['task_id', 'member_id'])
        .where(
          'task_id',
          'in',
          tasks.map((t) => t.id),
        )
        .orderBy('assigned_at')
        .execute()
    : [];
  const answered = new Set(rsvps.map((r) => r.member_id));
  return {
    ...item!,
    yes_ids: rsvps.filter((r) => r.answer === 'ja').map((r) => r.member_id),
    no_ids: rsvps.filter((r) => r.answer === 'nein').map((r) => r.member_id),
    invitee_ids: invitees,
    open_ids: invitedIds(people, invitees, a.created_by).filter((m) => !answered.has(m)),
    attendee_ids: attendees.map((x) => x.member_id),
    tasks: tasks.map((t) => ({
      ...t,
      assignee_ids: assignees.filter((x) => x.task_id === t.id).map((x) => x.member_id),
    })),
    comments,
    history,
  };
}

async function checkRefs(
  ctx: Ctx,
  input: { type_id: string; event_id: string | null },
  creating: boolean,
): Promise<AppointmentTypeRow> {
  const type = await ctx.trx
    .selectFrom('appointment_types')
    .selectAll()
    .where('id', '=', input.type_id)
    .forShare()
    .executeTakeFirst();
  if (!type || (creating && type.archived_at))
    throw new AppError('validation', 'Diese Terminart gibt es nicht mehr.', { field: 'type_id' });
  if (input.event_id) {
    const event = await ctx.trx
      .selectFrom('events')
      .select('id')
      .where('id', '=', input.event_id)
      .where('archived_at', 'is', null)
      .executeTakeFirst();
    if (!event)
      throw new AppError('validation', 'Diese Veranstaltung gibt es nicht mehr.', { field: 'event_id' });
  }
  return type;
}

/** Nur aktive Mitglieder lassen sich einladen; die anlegende Person ist ohnehin dabei */
function checkInvitees(ctx: Ctx, people: readonly string[], ids: readonly string[]): string[] {
  const active = new Set(people);
  const unique = [...new Set(ids)].filter((m) => m !== ctx.actor.id);
  if (unique.some((m) => !active.has(m)))
    throw new AppError('validation', 'Diese Person lässt sich nicht einladen.', { field: 'invitee_ids' });
  if (ids.length > 0 && unique.length === 0)
    throw new AppError('validation', 'Bitte mindestens eine Person auswählen.', { field: 'invitee_ids' });
  return unique;
}

/** WF-TER-02 / WF-PLE-01: Status geplant; Einladung an alle aktiven Mitglieder oder an ausgewählte (WF-TER-12) */
export async function createAppointment(ctx: Ctx, raw: unknown): Promise<{ id: string }> {
  const input = parse(appointmentCreateSchema, raw);
  const [type, people] = await Promise.all([checkRefs(ctx, input, true), activeIds(ctx.trx)]);
  const invitees = checkInvitees(ctx, people, input.invitee_ids);
  const now = iso(ctx);
  const appointment = await ctx.trx
    .insertInto('appointments')
    .values({
      type_id: input.type_id,
      title: input.title,
      topic_id: type.default_topic_id,
      event_id: input.event_id,
      starts_at: input.starts_at,
      ends_at: input.ends_at,
      format: input.format,
      location: input.format === 'online' ? null : input.location,
      online_url: input.format === 'vor_ort' ? null : input.online_url,
      description: input.description,
      protocol_document_id: null,
      protocol_member_id: null,
      notes: null,
      archived_at: null,
      created_at: now,
      updated_at: now,
      created_by: ctx.actor.id,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  if (invitees.length)
    await ctx.trx
      .insertInto('appointment_invitees')
      .values(invitees.map((member_id) => ({ appointment_id: appointment.id, member_id })))
      .execute();
  await writeHistory(ctx, 'appointment', appointment.id, 'created', {
    title: { old: null, new: appointment.title },
    ...(invitees.length ? { invitees: { old: null, new: invitees.length } } : {}),
  });
  // nachgetragene Termine laden niemanden mehr ein
  if (!hasStarted(appointment, ctx.now))
    await notify(
      ctx,
      invitationMessages(appointment, invitedIds(people, invitees, ctx.actor.id), ctx.actor.id),
      `zu „${appointment.title}“ eingeladen`,
    );
  return { id: appointment.id };
}

async function touchAppointment(ctx: Ctx, a: AppointmentRow, set: Partial<AppointmentRow>): Promise<void> {
  const result = await ctx.trx
    .updateTable('appointments')
    .set({ ...set, version: a.version + 1, updated_at: iso(ctx) } as never)
    .where('id', '=', a.id)
    .where('version', '=', a.version)
    .executeTakeFirst();
  await updatedOne(ctx, result, 'appointment', a);
  Object.assign(a, set, { version: a.version + 1, updated_at: iso(ctx) });
}
export { touchAppointment };

/** Zusagen und Eingeladene ohne Antwort, ohne die handelnde Person */
async function rsvpRecipients(ctx: Ctx, a: AppointmentRow): Promise<string[]> {
  const [rsvps, people, invitees] = await Promise.all([
    ctx.trx.selectFrom('appointment_rsvps').selectAll().where('appointment_id', '=', a.id).execute(),
    activeIds(ctx.trx),
    inviteeIds(ctx.trx, a.id),
  ]);
  return yesAndOpen(rsvps, people, invitedIds(people, invitees, a.created_by)).filter(
    (m) => m !== ctx.actor.id,
  );
}

/** WF-TER-04: bearbeiten/verschieben; bei Zeit oder Ort geändert: Nachricht an Zusagen und ohne Antwort */
export async function updateAppointment(ctx: Ctx, id: string, raw: unknown): Promise<{ notified: number }> {
  const input = parse(appointmentUpdateSchema, raw);
  const a = await findAppointment(ctx.trx, id);
  await checkVersion(ctx, 'appointment', a, input.version);
  if (a.status === 'abgesagt') throw rule('Abgesagte Termine lassen sich nicht mehr bearbeiten.');
  if (input.type_id !== a.type_id) throw rule('Die Terminart lässt sich nachträglich nicht ändern.');
  await checkRefs(ctx, input, false);
  const next = {
    title: input.title,
    starts_at: input.starts_at,
    ends_at: input.ends_at,
    format: input.format,
    location: input.format === 'online' ? null : input.location,
    online_url: input.format === 'vor_ort' ? null : input.online_url,
    event_id: input.event_id,
    description: input.description,
  };
  const time = (v: string | null) => (v ? new Date(v).getTime() : null);
  const changes: HistoryChanges = {};
  const set: Partial<AppointmentRow> = {};
  for (const key of Object.keys(next) as (keyof typeof next)[]) {
    const same =
      key === 'starts_at' || key === 'ends_at' ? time(a[key]) === time(next[key]) : a[key] === next[key];
    if (same) continue;
    changes[key] = { old: a[key], new: next[key] };
    (set as Record<string, unknown>)[key] = next[key];
  }
  if (Object.keys(changes).length === 0) return { notified: 0 };
  await touchAppointment(ctx, a, set);
  await writeHistory(ctx, 'appointment', id, 'updated', changes);
  // Zusagen bleiben erhalten; benachrichtigt wird nur, was noch bevorsteht
  const moved = ['starts_at', 'ends_at', 'format', 'location', 'online_url'].some((k) => k in changes);
  if (!moved || a.status !== 'geplant' || hasStarted(a, ctx.now)) return { notified: 0 };
  const recipients = await rsvpRecipients(ctx, a);
  await notify(
    ctx,
    changeMessages(a, 'verschoben', recipients, ctx.actor.id, iso(ctx)),
    `„${a.title}“ geändert`,
  );
  return { notified: recipients.length };
}

/** WF-TER-03: Zu- oder Absage setzen, ändern oder zurücknehmen */
export async function setRsvp(ctx: Ctx, id: string, answer: RsvpAnswer | null): Promise<Undoable> {
  if (answer !== null && answer !== 'ja' && answer !== 'nein')
    throw new AppError('validation', 'Bitte zu- oder absagen.');
  const a = await findAppointment(ctx.trx, id);
  if (!canRsvp(a, ctx.now))
    throw rule(
      a.status === 'geplant'
        ? 'Der Termin hat schon begonnen – Zu- und Absagen sind nicht mehr möglich.'
        : 'Für diesen Termin sind keine Zu- und Absagen mehr möglich.',
    );
  const current = await ctx.trx
    .selectFrom('appointment_rsvps')
    .selectAll()
    .where('appointment_id', '=', id)
    .where('member_id', '=', ctx.actor.id)
    .executeTakeFirst();
  if ((current?.answer ?? null) === answer) return { undo_token: '' };
  ctx.inverse.push({
    kind: 'rsvp_restore',
    appointment_id: id,
    member_id: ctx.actor.id,
    row: current ?? null,
  });
  await ctx.trx
    .deleteFrom('appointment_rsvps')
    .where('appointment_id', '=', id)
    .where('member_id', '=', ctx.actor.id)
    .execute();
  if (answer)
    await ctx.trx
      .insertInto('appointment_rsvps')
      .values({ appointment_id: id, member_id: ctx.actor.id, answer, answered_at: iso(ctx) })
      .execute();
  await writeHistory(ctx, 'appointment', id, 'rsvp', { rsvp: { old: current?.answer ?? null, new: answer } });
  return registerUndo(
    ctx,
    'appointment',
    a,
    answer === 'ja' ? 'Zugesagt' : answer === 'nein' ? 'Abgesagt' : 'Antwort zurückgenommen',
  );
}

/** WF-TER-05: absagen – Nachricht an Zusagen und ohne Antwort */
export async function cancelAppointment(
  ctx: Ctx,
  id: string,
  version: number,
): Promise<{ notified: number }> {
  const a = await findAppointment(ctx.trx, id);
  await checkVersion(ctx, 'appointment', a, version);
  if (a.status !== 'geplant') throw rule('Nur geplante Termine lassen sich absagen.');
  const changes: HistoryChanges = { status: { old: a.status, new: 'abgesagt' } };
  await touchAppointment(ctx, a, { status: 'abgesagt' });
  await writeHistory(ctx, 'appointment', id, 'status', changes);
  const recipients = await rsvpRecipients(ctx, a);
  await notify(
    ctx,
    changeMessages(a, 'abgesagt', recipients, ctx.actor.id, iso(ctx)),
    `„${a.title}“ abgesagt`,
  );
  return { notified: recipients.length };
}

const attendeeList = z.array(idSchema).max(500);

export async function replaceAttendees(ctx: Ctx, id: string, memberIds: readonly unknown[]): Promise<void> {
  if (!attendeeList.safeParse(memberIds).success) throw rule('Unbekannte Person in der Teilnahmeliste.');
  const unique = [...new Set(memberIds)];
  const known = unique.length
    ? await ctx.trx
        .selectFrom('members')
        .select('id')
        .where('id', 'in', unique as string[])
        .where('is_system', '=', false)
        .execute()
    : [];
  if (known.length !== unique.length) throw rule('Unbekannte Person in der Teilnahmeliste.');
  await ctx.trx.deleteFrom('appointment_attendees').where('appointment_id', '=', id).execute();
  if (unique.length)
    await ctx.trx
      .insertInto('appointment_attendees')
      .values((unique as string[]).map((member_id) => ({ appointment_id: id, member_id })))
      .execute();
}

/** WF-TER-06: „Hat stattgefunden“ mit Teilnahme – erst nach Beginn */
export async function markHappened(
  ctx: Ctx,
  id: string,
  attendeeIds: readonly unknown[],
  version: number,
): Promise<Undoable> {
  if (!Array.isArray(attendeeIds)) throw rule('Unbekannte Person in der Teilnahmeliste.');
  const a = await findAppointment(ctx.trx, id);
  await checkVersion(ctx, 'appointment', a, version);
  if (!canMarkHappened(a, ctx.now))
    throw rule(
      a.status === 'geplant'
        ? 'Das geht erst, wenn der Termin begonnen hat.'
        : 'Der Termin ist nicht mehr im Status „Geplant“.',
    );
  const attendees = await ctx.trx
    .selectFrom('appointment_attendees')
    .selectAll()
    .where('appointment_id', '=', id)
    .execute();
  ctx.inverse.push({ kind: 'appointment_state', appointment_id: id, status: a.status, attendees });
  const changes: HistoryChanges = {
    status: { old: a.status, new: 'stattgefunden' },
    attendees: { old: null, new: attendeeIds.length },
  };
  await replaceAttendees(ctx, id, attendeeIds);
  await touchAppointment(ctx, a, { status: 'stattgefunden' });
  await writeHistory(ctx, 'appointment', id, 'status', changes);
  return registerUndo(ctx, 'appointment', a, 'Als stattgefunden gespeichert');
}

/** Vergangene Termine bleiben korrigierbar (4.3): Teilnahme nachträglich ändern */
export async function setAttendee(ctx: Ctx, id: string, memberId: string, present: boolean): Promise<void> {
  const a = await findAppointment(ctx.trx, id);
  if (a.status !== 'stattgefunden' && a.status !== 'abgeschlossen')
    throw rule('Die Teilnahme lässt sich erst festhalten, wenn der Termin stattgefunden hat.');
  const exists = await ctx.trx
    .selectFrom('appointment_attendees')
    .select('member_id')
    .where('appointment_id', '=', id)
    .where('member_id', '=', memberId)
    .executeTakeFirst();
  if (!!exists === present) return;
  if (present) {
    const member = await ctx.trx
      .selectFrom('members')
      .select('id')
      .where('id', '=', memberId)
      .where('is_system', '=', false)
      .executeTakeFirst();
    if (!member) throw notFound('Dieses Mitglied');
    await ctx.trx
      .insertInto('appointment_attendees')
      .values({ appointment_id: id, member_id: memberId })
      .execute();
  } else
    await ctx.trx
      .deleteFrom('appointment_attendees')
      .where('appointment_id', '=', id)
      .where('member_id', '=', memberId)
      .execute();
  await writeHistory(ctx, 'appointment', id, present ? 'attendee_added' : 'attendee_removed', {
    attendee: present ? { old: null, new: memberId } : { old: memberId, new: null },
    // nach dem Abschluss eines Plenums nur nach Rückfrage geändert (16.2)
    ...(a.status === 'abgeschlossen' ? { after_close: { old: null, new: true } } : {}),
  });
}

/** Beim Deaktivieren: Zusagen für künftige Termine (F-LOG-03, ab P3) */
async function futureRsvps(trx: Db, memberId: string, now: Date) {
  return trx
    .selectFrom('appointment_rsvps as r')
    .innerJoin('appointments as a', 'a.id', 'r.appointment_id')
    .select(['r.appointment_id', 'r.answer'])
    .where('r.member_id', '=', memberId)
    .where('a.status', '=', 'geplant')
    .where('a.starts_at', '>', now.toISOString())
    .execute();
}

export async function futureRsvpCount(trx: Db, memberId: string, now: Date): Promise<number> {
  return (await futureRsvps(trx, memberId, now)).length;
}

export async function dropFutureRsvps(ctx: Ctx, memberId: string): Promise<void> {
  for (const r of await futureRsvps(ctx.trx, memberId, ctx.now)) {
    await ctx.trx
      .deleteFrom('appointment_rsvps')
      .where('appointment_id', '=', r.appointment_id)
      .where('member_id', '=', memberId)
      .execute();
    await writeHistory(ctx, 'appointment', r.appointment_id, 'rsvp_removed', {
      rsvp: { old: r.answer, new: null },
      member: { old: memberId, new: null },
      reason: { old: null, new: 'deactivated' },
    });
  }
}
