// Testdaten-Schicht, Phase 4: Veranstaltungen ausgebaut – Detailbereiche, Booking, Hauptverantwortliche,
// Schichtplan (ANFORDERUNGEN 3.4, F-VER-04, WF-VER-07 bis -11)
import { AppError } from '../../shared/errors';
import {
  BOOKING_ACT_TYPE_LABEL,
  emptyEventDetails,
  sectionSummaries,
  suggestsFollowUp,
} from '../../shared/rules/eventDetails';
import {
  bookingCreateSchema,
  bookingUpdateSchema,
  EVENT_DETAIL_FIELDS,
  eventDetailUpdateSchema,
  type EventBooking,
  type EventDetails,
} from '../../shared/schema';
import type { EventDetail, Undoable } from '../api';
import {
  checkVersion,
  findEvent,
  getEvent,
  notFound,
  parse,
  registerUndo,
  rule,
  touch,
  writeHistory,
  type Ctx,
  type Db,
} from './server';
import { checkDriveFolder, childEntries, driveItem } from './drive';

const uuid = () => crypto.randomUUID();

export function detailsOf(db: Db, eventId: string): EventDetails {
  return db.event_details.find((d) => d.event_id === eventId) ?? emptyEventDetails(eventId);
}

export function getEventDetail(db: Db, id: string, now: Date): EventDetail {
  const event = getEvent(db, id, now);
  const details = detailsOf(db, id);
  const bookings = db.event_bookings
    .filter((b) => b.event_id === id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const partners = db.event_partners
    .filter((ep) => ep.event_id === id)
    .map((ep) => {
      const p = db.partners.find((x) => x.id === ep.partner_id)!;
      return {
        id: p.id,
        name: p.name,
        kind: p.kind,
        role_note: ep.role_note,
        event_count: db.event_partners.filter((x) => x.partner_id === p.id).length,
      };
    });
  const doc = event.shift_plan_document_id
    ? db.documents.find((d) => d.id === event.shift_plan_document_id)
    : undefined;
  const folderId = event.drive_folder_id;
  const folder = folderId ? driveItem(db, folderId) : undefined;
  return {
    ...event,
    drive_folder: folderId
      ? {
          file_id: folderId,
          // verschwundener Ordner: letzter bekannter Name aus dem Cache
          name: folder?.name ?? db.drive_items.find((i) => i.file_id === folderId)?.name ?? 'Drive-Ordner',
          web_url: folder?.web_url ?? null,
          missing: !folder,
          entries: folder ? childEntries(db, folderId) : [],
        }
      : null,
    details,
    bookings,
    lead_ids: db.event_leads.filter((l) => l.event_id === id).map((l) => l.member_id),
    shift_plan_document: doc ? { id: doc.id, title: doc.title, url: doc.url } : null,
    summaries: sectionSummaries(details, bookings, partners),
    suggests_follow_up: suggestsFollowUp(event, now),
    partners,
  };
}

/** WF-VER-08: ein Feld eines Detailbereichs; Versionsprüfung an der Veranstaltung, Historie alt → neu */
export function updateEventDetail(ctx: Ctx, eventId: string, raw: unknown): void {
  const input = parse(eventDetailUpdateSchema, raw);
  const event = findEvent(ctx.db, eventId);
  if (input.expected === undefined) checkVersion(ctx, 'event', event, input.version);
  const fieldSchema = EVENT_DETAIL_FIELDS[input.field];
  const parsed = fieldSchema.safeParse(input.value);
  if (!parsed.success)
    throw new AppError('validation', parsed.error.issues[0]?.message ?? 'Diese Eingabe passt nicht.', {
      field: input.field,
    });
  const value = parsed.data as unknown;
  let details = ctx.db.event_details.find((d) => d.event_id === eventId);
  if (!details) {
    details = emptyEventDetails(eventId);
    ctx.db.event_details.push(details);
  }
  // „location.name“ → details.location.name, „entry.price“ → details.entry.price
  const path = input.field.split('.');
  let target = details as unknown as Record<string, unknown>;
  for (const key of path.slice(0, -1)) target = target[key] as Record<string, unknown>;
  const key = path.at(-1)!;
  const last = ctx.db.history
    .filter((h) => h.entity_type === 'event' && h.entity_id === eventId && input.field in h.changes)
    .at(-1);
  // Konflikt nur, wenn jemand anderes genau dieses Feld inzwischen geändert hat (7) – eigene schnelle
  // Folgetipps auf dasselbe Feld warten in der Reihe und stoßen sich nicht an sich selbst
  if (
    input.expected !== undefined &&
    (target[key] ?? null) !== (input.expected ?? null) &&
    last?.actor_member_id !== ctx.actor.id
  ) {
    const name = last
      ? (ctx.db.members.find((m) => m.id === last.actor_member_id)?.display_name ?? null)
      : null;
    throw new AppError('conflict', `Wurde inzwischen von ${name ?? 'jemand anderem'} geändert.`, {
      conflict: { changed_by_name: name, changed_at: last?.created_at ?? null },
    });
  }
  if (target[key] === value) return;
  writeHistory(ctx, 'event', eventId, 'details', { [input.field]: { old: target[key], new: value } });
  target[key] = value;
  touch(ctx, event);
}

// ── Booking (mehrere Acts) ──────────────────────────────────────────────────

function findBooking(db: Db, id: string): EventBooking {
  const booking = db.event_bookings.find((b) => b.id === id);
  if (!booking) throw notFound('Diesen Act');
  return booking;
}

export function addBooking(ctx: Ctx, eventId: string, raw: unknown): Undoable & { id: string } {
  const input = parse(bookingCreateSchema, raw);
  const event = findEvent(ctx.db, eventId);
  const booking: EventBooking = {
    id: uuid(),
    event_id: eventId,
    ...input,
    created_at: ctx.now.toISOString(),
    created_by: ctx.actor.id,
    version: 1,
  };
  ctx.db.event_bookings.push(booking);
  ctx.inverse.push({ kind: 'booking_remove', booking_id: booking.id });
  writeHistory(ctx, 'event', eventId, 'booking_added', {
    booking: { old: null, new: `${booking.act_name} (${BOOKING_ACT_TYPE_LABEL[booking.act_type]})` },
  });
  return { ...registerUndo(ctx, 'event', event, `Act angelegt: ${booking.act_name}`), id: booking.id };
}

export function updateBooking(ctx: Ctx, id: string, raw: unknown): void {
  const input = parse(bookingUpdateSchema, raw);
  const booking = findBooking(ctx.db, id);
  if (booking.version !== input.version)
    throw new AppError('conflict', 'Jemand hat diesen Act inzwischen geändert.');
  const changes: Record<string, { old: unknown; new: unknown }> = {};
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
    (booking[key] as unknown) = input[key];
  }
  if (Object.keys(changes).length === 0) return;
  booking.version += 1;
  writeHistory(ctx, 'event', booking.event_id, 'booking_updated', {
    booking: { old: null, new: booking.act_name },
    ...changes,
  });
}

export function removeBooking(ctx: Ctx, id: string): Undoable {
  const booking = findBooking(ctx.db, id);
  const event = findEvent(ctx.db, booking.event_id);
  ctx.db.event_bookings = ctx.db.event_bookings.filter((b) => b.id !== id);
  ctx.inverse.push({ kind: 'booking_restore', row: booking });
  writeHistory(ctx, 'event', event.id, 'booking_removed', { booking: { old: booking.act_name, new: null } });
  return registerUndo(ctx, 'event', event, `Act entfernt: ${booking.act_name}`);
}

// ── Hauptverantwortliche (WF-VER-09), eintragsweise ─────────────────────────

export function addLead(ctx: Ctx, eventId: string, memberId: string): Undoable {
  const event = findEvent(ctx.db, eventId);
  const member = ctx.db.members.find((m) => m.id === memberId);
  if (!member || member.is_system) throw notFound('Dieses Mitglied');
  if (!member.active) throw rule(`${member.display_name} ist deaktiviert.`);
  if (ctx.db.event_leads.some((l) => l.event_id === eventId && l.member_id === memberId))
    return { undo_token: '' };
  ctx.db.event_leads.push({
    event_id: eventId,
    member_id: memberId,
    added_by: ctx.actor.id,
    added_at: ctx.now.toISOString(),
  });
  ctx.inverse.push({ kind: 'lead_remove', event_id: eventId, member_id: memberId });
  writeHistory(ctx, 'event', eventId, 'lead_added', { lead: { old: null, new: memberId } });
  return registerUndo(ctx, 'event', event, `Hauptverantwortlich: ${member.display_name}`);
}

function dropLead(ctx: Ctx, eventId: string, memberId: string, action: string): boolean {
  const row = ctx.db.event_leads.find((l) => l.event_id === eventId && l.member_id === memberId);
  if (!row) return false;
  ctx.db.event_leads = ctx.db.event_leads.filter((l) => l !== row);
  ctx.inverse.push({ kind: 'lead_restore', row });
  writeHistory(ctx, 'event', eventId, action, { lead: { old: memberId, new: null } });
  return true;
}

export function removeLead(ctx: Ctx, eventId: string, memberId: string): Undoable {
  const event = findEvent(ctx.db, eventId);
  if (!dropLead(ctx, eventId, memberId, 'lead_removed')) return { undo_token: '' };
  return registerUndo(ctx, 'event', event, 'Ausgetragen');
}

/** „Mitglied deaktivieren“ ab P4: auch als Hauptverantwortliche austragen (WF-ADM-03), Teil der Transaktion */
export function dropLeads(ctx: Ctx, memberId: string): number {
  const rows = ctx.db.event_leads.filter((l) => l.member_id === memberId);
  for (const row of rows) dropLead(ctx, row.event_id, memberId, 'lead_removed_deactivated');
  return rows.length;
}

// ── Schichtplan (WF-VER-11) ─────────────────────────────────────────────────

/** WF-VER-14: Drive-Ordner wählen oder entfernen */
export function setDriveFolder(ctx: Ctx, eventId: string, folderId: string | null, version: number): void {
  const event = findEvent(ctx.db, eventId);
  checkVersion(ctx, 'event', event, version);
  if (folderId) checkDriveFolder(ctx.db, folderId);
  if (event.drive_folder_id === folderId) return;
  writeHistory(ctx, 'event', eventId, 'updated', {
    drive_folder_id: { old: event.drive_folder_id, new: folderId },
  });
  event.drive_folder_id = folderId;
  touch(ctx, event);
}

export function setShiftPlan(ctx: Ctx, eventId: string, documentId: string | null, version: number): void {
  const event = findEvent(ctx.db, eventId);
  checkVersion(ctx, 'event', event, version);
  if (documentId && !ctx.db.documents.some((d) => d.id === documentId))
    throw new AppError('validation', 'Dieses Dokument gibt es nicht mehr.', {
      field: 'shift_plan_document_id',
    });
  if (event.shift_plan_document_id === documentId) return;
  writeHistory(ctx, 'event', eventId, 'updated', {
    shift_plan_document_id: { old: event.shift_plan_document_id, new: documentId },
  });
  event.shift_plan_document_id = documentId;
  touch(ctx, event);
}
