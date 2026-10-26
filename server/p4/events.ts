// Phase 4: Veranstaltungen ausgebaut – Detailbereiche, Booking, Hauptverantwortliche, Schichtplan
// (ANFORDERUNGEN 3.4, F-VER-04, WF-VER-07 bis -11). Wie die Testdaten-Schicht (src/data/mock/events.ts).
import { sql } from 'kysely';
import type { EventDetail, Undoable } from '../../src/data/api';
import { AppError } from '../../src/shared/errors';
import {
  BOOKING_ACT_TYPE_LABEL,
  emptyEventDetails,
  sectionSummaries,
  suggestsFollowUp,
} from '../../src/shared/rules/eventDetails';
import {
  bookingCreateSchema,
  bookingUpdateSchema,
  EVENT_DETAIL_FIELDS,
  eventDetailUpdateSchema,
  type EventDetails,
  type HistoryChanges,
} from '../../src/shared/schema';
import {
  checkVersion,
  iso,
  notFound,
  parse,
  registerUndo,
  rule,
  updatedOne,
  writeHistory,
  type Ctx,
  type Db,
} from '../core/context';
import type { BookingRow, EventRow } from '../db/types';
import { commentsOf } from '../p1/comments';
import { findEvent } from '../p1/events';
import { getEvent, historyOf } from '../p1/reads';
import { eventDriveFolder } from '../p5/drive';

export async function touchEvent(ctx: Ctx, event: EventRow, set: Partial<EventRow> = {}): Promise<void> {
  const result = await ctx.trx
    .updateTable('events')
    .set({ ...set, version: event.version + 1, updated_at: iso(ctx) } as never)
    .where('id', '=', event.id)
    .where('version', '=', event.version)
    .executeTakeFirst();
  await updatedOne(ctx, result, 'event', event);
  Object.assign(event, set, { version: event.version + 1 });
}

/** Gespeicherte Detailbereiche, auf jeder Ebene mit den leeren Werten aufgefüllt (z. B. neue Rahmen-Punkte) */
async function detailsOf(trx: Db, eventId: string): Promise<EventDetails> {
  const row = await trx
    .selectFrom('event_details')
    .select('data')
    .where('event_id', '=', eventId)
    .executeTakeFirst();
  const empty = emptyEventDetails(eventId);
  if (!row) return empty;
  const stored = row.data as Partial<EventDetails>;
  const merged = { ...empty } as Record<string, unknown>;
  for (const [key, value] of Object.entries(empty)) {
    const saved = (stored as Record<string, unknown>)[key];
    if (value && typeof value === 'object' && saved && typeof saved === 'object') {
      merged[key] = { ...(value as Record<string, unknown>), ...(saved as Record<string, unknown>) };
    } else if (saved !== undefined) merged[key] = saved;
  }
  merged.event_id = eventId;
  return merged as EventDetails;
}

export async function getEventDetail(trx: Db, id: string, now: Date): Promise<EventDetail> {
  const event = await getEvent(trx, id, now);
  const [details, bookings, leads, partners, doc, decisions, comments, history] = await Promise.all([
    detailsOf(trx, id),
    trx
      .selectFrom('event_bookings')
      .selectAll()
      .where('event_id', '=', id)
      .orderBy('created_at')
      .orderBy('id')
      .execute(),
    trx
      .selectFrom('event_leads')
      .select('member_id')
      .where('event_id', '=', id)
      .orderBy('added_at')
      .execute(),
    trx
      .selectFrom('event_partners as ep')
      .innerJoin('partners as p', 'p.id', 'ep.partner_id')
      .select([
        'p.id',
        'p.name',
        'p.kind',
        'ep.role_note',
        (eb) =>
          eb
            .selectFrom('event_partners as x')
            .select(eb.fn.countAll<number>().as('n'))
            .whereRef('x.partner_id', '=', 'p.id')
            .as('event_count'),
      ])
      .where('ep.event_id', '=', id)
      .orderBy('ep.added_at')
      .execute(),
    event.shift_plan_document_id
      ? trx
          .selectFrom('documents')
          .select(['id', 'title', 'url'])
          .where('id', '=', event.shift_plan_document_id)
          .executeTakeFirst()
      : undefined,
    // Entscheidungen und Fakten zu dieser Veranstaltung (16.3)
    trx
      .selectFrom('decisions')
      .select(['id', 'title', 'kind', 'status', 'description'])
      .where('event_id', '=', id)
      .where('archived_at', 'is', null)
      .orderBy('decided_on', 'desc')
      .orderBy('title')
      .execute(),
    commentsOf(trx, 'event', id),
    historyOf(trx, 'event', id),
  ]);
  const partnerItems = partners.map((p) => ({ ...p, event_count: Number(p.event_count ?? 0) }));
  return {
    ...event,
    details,
    bookings,
    lead_ids: leads.map((l) => l.member_id),
    shift_plan_document: doc ?? null,
    summaries: sectionSummaries(details, bookings, partnerItems),
    suggests_follow_up: suggestsFollowUp(event, now),
    drive_folder: await eventDriveFolder(trx, event.drive_folder_id),
    partners: partnerItems,
    decisions,
    comments,
    history,
  };
}

/** WF-VER-08: ein Feld eines Detailbereichs; Versionsprüfung an der Veranstaltung, Historie alt → neu */
export async function updateEventDetail(ctx: Ctx, eventId: string, raw: unknown): Promise<void> {
  const input = parse(eventDetailUpdateSchema, raw);
  const event = await findEvent(ctx, eventId);
  if (input.expected === undefined) await checkVersion(ctx, 'event', event, input.version);
  const parsed = EVENT_DETAIL_FIELDS[input.field].safeParse(input.value);
  if (!parsed.success)
    throw new AppError('validation', parsed.error.issues[0]?.message ?? 'Diese Eingabe passt nicht.', {
      field: input.field,
    });
  const value = (parsed.data ?? null) as unknown;
  const details = await detailsOf(ctx.trx, eventId);
  // „location.name“ → details.location.name, „entry.price“ → details.entry.price
  const path = input.field.split('.');
  let target = details as unknown as Record<string, unknown>;
  for (const key of path.slice(0, -1)) {
    target[key] ??= {};
    target = target[key] as Record<string, unknown>;
  }
  const key = path.at(-1)!;
  const current = (target[key] ?? null) as unknown;
  if (input.expected !== undefined && current !== (input.expected ?? null)) {
    // Konflikt nur, wenn jemand anderes genau dieses Feld inzwischen geändert hat (7) – eigene schnelle
    // Folgetipps auf dasselbe Feld warten in der Reihe und stoßen sich nicht an sich selbst
    const last = await ctx.trx
      .selectFrom('history as h')
      .leftJoin('members as m', 'm.id', 'h.actor_member_id')
      .select(['h.actor_member_id', 'h.created_at', 'm.display_name'])
      .where('h.entity_type', '=', 'event')
      .where('h.entity_id', '=', eventId)
      .where(sql<boolean>`h.changes ? ${input.field}`)
      .orderBy('h.created_at', 'desc')
      .orderBy('h.seq', 'desc')
      .executeTakeFirst();
    if (last?.actor_member_id !== ctx.actor.id) {
      const name = last?.display_name ?? null;
      throw new AppError('conflict', `Wurde inzwischen von ${name ?? 'jemand anderem'} geändert.`, {
        conflict: { changed_by_name: name, changed_at: last?.created_at ?? null },
      });
    }
  }
  if (current === value) return;
  target[key] = value;
  await ctx.trx
    .insertInto('event_details')
    .values({ event_id: eventId, data: JSON.stringify(details) })
    .onConflict((oc) => oc.column('event_id').doUpdateSet({ data: JSON.stringify(details) }))
    .execute();
  await writeHistory(ctx, 'event', eventId, 'details', { [input.field]: { old: current, new: value } });
  await touchEvent(ctx, event);
}

// ── Booking (mehrere Acts) ──────────────────────────────────────────────────

async function findBooking(trx: Db, id: string): Promise<BookingRow> {
  const booking = await trx
    .selectFrom('event_bookings')
    .selectAll()
    .where('id', '=', id)
    .forUpdate()
    .executeTakeFirst();
  if (!booking) throw notFound('Diesen Act');
  return booking;
}

export async function addBooking(
  ctx: Ctx,
  eventId: string,
  raw: unknown,
): Promise<Undoable & { id: string }> {
  const input = parse(bookingCreateSchema, raw);
  const event = await findEvent(ctx, eventId);
  const booking = await ctx.trx
    .insertInto('event_bookings')
    .values({ event_id: eventId, ...input, created_at: iso(ctx), created_by: ctx.actor.id })
    .returningAll()
    .executeTakeFirstOrThrow();
  ctx.inverse.push({ kind: 'booking_remove', booking_id: booking.id });
  await writeHistory(ctx, 'event', eventId, 'booking_added', {
    booking: { old: null, new: `${booking.act_name} (${BOOKING_ACT_TYPE_LABEL[booking.act_type]})` },
  });
  return {
    ...(await registerUndo(ctx, 'event', event, `Act angelegt: ${booking.act_name}`)),
    id: booking.id,
  };
}

export async function updateBooking(ctx: Ctx, id: string, raw: unknown): Promise<void> {
  const input = parse(bookingUpdateSchema, raw);
  const booking = await findBooking(ctx.trx, id);
  if (booking.version !== input.version)
    throw new AppError('conflict', 'Jemand hat diesen Act inzwischen geändert.');
  const changes: HistoryChanges = {};
  const set: Partial<BookingRow> = {};
  for (const key of [
    'act_name',
    'act_type',
    'contact',
    'status',
    'fee_status',
    'fee',
    'tech_requirements',
    'notes',
  ] as const) {
    if (booking[key] === input[key]) continue;
    changes[`booking.${key}`] = { old: booking[key], new: input[key] };
    (set as Record<string, unknown>)[key] = input[key];
  }
  if (Object.keys(changes).length === 0) return;
  await ctx.trx
    .updateTable('event_bookings')
    .set({ ...set, version: booking.version + 1 } as never)
    .where('id', '=', id)
    .execute();
  await writeHistory(ctx, 'event', booking.event_id, 'booking_updated', {
    booking: { old: null, new: input.act_name },
    ...changes,
  });
}

export async function removeBooking(ctx: Ctx, id: string): Promise<Undoable> {
  // erst die Veranstaltung sperren, dann den Act – dieselbe Reihenfolge wie im Rückgängig
  const ref = await ctx.trx
    .selectFrom('event_bookings')
    .select('event_id')
    .where('id', '=', id)
    .executeTakeFirst();
  if (!ref) throw notFound('Diesen Act');
  const event = await findEvent(ctx, ref.event_id);
  const booking = await findBooking(ctx.trx, id);
  await ctx.trx.deleteFrom('event_bookings').where('id', '=', id).execute();
  ctx.inverse.push({ kind: 'booking_restore', row: booking });
  await writeHistory(ctx, 'event', event.id, 'booking_removed', {
    booking: { old: booking.act_name, new: null },
  });
  return registerUndo(ctx, 'event', event, `Act entfernt: ${booking.act_name}`);
}

// ── Hauptverantwortliche (WF-VER-09), eintragsweise ─────────────────────────

export async function addLead(ctx: Ctx, eventId: string, memberId: string): Promise<Undoable> {
  const event = await findEvent(ctx, eventId);
  const member = await ctx.trx
    .selectFrom('members')
    .select(['id', 'display_name', 'active', 'is_system'])
    .where('id', '=', memberId)
    // gleichzeitiges Deaktivieren wartet und trägt die Person danach auch hier aus
    .forShare()
    .executeTakeFirst();
  if (!member || member.is_system) throw notFound('Dieses Mitglied');
  if (!member.active) throw rule(`${member.display_name} ist deaktiviert.`);
  const inserted = await ctx.trx
    .insertInto('event_leads')
    .values({ event_id: eventId, member_id: memberId, added_by: ctx.actor.id, added_at: iso(ctx) })
    .onConflict((oc) => oc.doNothing())
    .executeTakeFirst();
  if (Number(inserted.numInsertedOrUpdatedRows ?? 0) === 0) return { undo_token: '' };
  ctx.inverse.push({ kind: 'lead_remove', event_id: eventId, member_id: memberId });
  await writeHistory(ctx, 'event', eventId, 'lead_added', { lead: { old: null, new: memberId } });
  return registerUndo(ctx, 'event', event, `Hauptverantwortlich: ${member.display_name}`);
}

async function dropLead(ctx: Ctx, eventId: string, memberId: string, action: string): Promise<boolean> {
  const row = await ctx.trx
    .deleteFrom('event_leads')
    .where('event_id', '=', eventId)
    .where('member_id', '=', memberId)
    .returningAll()
    .executeTakeFirst();
  if (!row) return false;
  ctx.inverse.push({ kind: 'lead_restore', row });
  await writeHistory(ctx, 'event', eventId, action, { lead: { old: memberId, new: null } });
  return true;
}

export async function removeLead(ctx: Ctx, eventId: string, memberId: string): Promise<Undoable> {
  const event = await findEvent(ctx, eventId);
  if (!(await dropLead(ctx, eventId, memberId, 'lead_removed'))) return { undo_token: '' };
  return registerUndo(ctx, 'event', event, 'Ausgetragen');
}

/** „Mitglied deaktivieren“ ab P4: auch als Hauptverantwortliche austragen (WF-ADM-03), Teil der Transaktion */
export async function dropLeads(ctx: Ctx, memberId: string): Promise<number> {
  const rows = await ctx.trx
    .selectFrom('event_leads')
    .select('event_id')
    .where('member_id', '=', memberId)
    .execute();
  for (const row of rows) await dropLead(ctx, row.event_id, memberId, 'lead_removed_deactivated');
  return rows.length;
}

export async function leadCount(trx: Db, memberId: string): Promise<number> {
  return (await trx.selectFrom('event_leads').select('event_id').where('member_id', '=', memberId).execute())
    .length;
}

// ── Schichtplan (WF-VER-11) ─────────────────────────────────────────────────

export async function setShiftPlan(
  ctx: Ctx,
  eventId: string,
  documentId: unknown,
  version: number,
): Promise<void> {
  if (documentId !== null && typeof documentId !== 'string')
    throw new AppError('validation', 'Dieses Dokument gibt es nicht mehr.', {
      field: 'shift_plan_document_id',
    });
  const event = await findEvent(ctx, eventId);
  await checkVersion(ctx, 'event', event, version);
  if (documentId) {
    const doc = await ctx.trx
      .selectFrom('documents')
      .select('id')
      .where('id', '=', documentId)
      .where('archived_at', 'is', null)
      .executeTakeFirst();
    if (!doc)
      throw new AppError('validation', 'Dieses Dokument gibt es nicht mehr.', {
        field: 'shift_plan_document_id',
      });
  }
  if (event.shift_plan_document_id === documentId) return;
  await writeHistory(ctx, 'event', eventId, 'updated', {
    shift_plan_document_id: { old: event.shift_plan_document_id, new: documentId },
  });
  await touchEvent(ctx, event, { shift_plan_document_id: documentId });
}
