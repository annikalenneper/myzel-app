// Veranstaltungen schlank, Phase 1 (F-VER-01 bis -03; WF-VER-02 bis -04) – wie die Testdaten-Schicht.
import { EVENT_STATUS_LABEL } from '../../src/shared/labels';
import { canTransitionEvent } from '../../src/shared/rules/eventStatus';
import { AppError } from '../../src/shared/errors';
import {
  eventCreateSchema,
  eventUpdateSchema,
  type EventStatus,
  type HistoryChanges,
} from '../../src/shared/schema';
import {
  checkVersion,
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

export async function findEvent(ctx: Ctx, id: string) {
  const event = await ctx.trx
    .selectFrom('events')
    .selectAll()
    .where('id', '=', id)
    .forUpdate()
    .executeTakeFirst();
  if (!event) throw notFound('Diese Veranstaltung');
  return event;
}

export async function createEvent(ctx: Ctx, raw: unknown): Promise<{ id: string }> {
  const input = parse(eventCreateSchema, raw);
  // Aufbau und Abbau kommen mit Phase 4
  if (input.setup_at || input.teardown_at)
    throw new AppError('validation', 'Aufbau und Abbau gibt es erst ab Phase 4.', { field: 'setup_at' });
  const now = iso(ctx);
  const event = await ctx.trx
    .insertInto('events')
    .values({
      title: input.title,
      type: input.type,
      description: input.description,
      starts_at: input.starts_at,
      ends_at: input.ends_at,
      created_at: now,
      updated_at: now,
      created_by: ctx.actor.id,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await writeHistory(ctx, 'event', event.id, 'created', { title: { old: null, new: input.title } });
  return { id: event.id };
}

export async function updateEvent(ctx: Ctx, id: string, raw: unknown): Promise<void> {
  const input = parse(eventUpdateSchema, raw);
  const event = await findEvent(ctx, id);
  await checkVersion(ctx, 'event', event, input.version);
  const changes: HistoryChanges = {};
  const set: Record<string, unknown> = {};
  for (const key of ['title', 'type', 'description', 'starts_at', 'ends_at'] as const) {
    const same =
      key === 'starts_at' || key === 'ends_at'
        ? (event[key] ? new Date(event[key]).getTime() : null) ===
          (input[key] ? new Date(input[key]).getTime() : null)
        : event[key] === input[key];
    if (same) continue;
    changes[key] = { old: event[key], new: input[key] };
    set[key] = input[key];
  }
  if (input.setup_at || input.teardown_at)
    throw new AppError('validation', 'Aufbau und Abbau gibt es erst ab Phase 4.', { field: 'setup_at' });
  if (Object.keys(changes).length === 0) return;
  const result = await ctx.trx
    .updateTable('events')
    .set({ ...set, version: event.version + 1, updated_at: iso(ctx) })
    .where('id', '=', id)
    .where('version', '=', event.version)
    .executeTakeFirst();
  await updatedOne(ctx, result, 'event', event);
  await writeHistory(ctx, 'event', id, 'updated', changes);
}

export async function setEventStatus(
  ctx: Ctx,
  id: string,
  status: EventStatus,
  version: number,
): Promise<Undoable> {
  const event = await findEvent(ctx, id);
  await checkVersion(ctx, 'event', event, version);
  if (!canTransitionEvent(event.status, status))
    throw rule(
      `Von „${EVENT_STATUS_LABEL[event.status]}“ nach „${EVENT_STATUS_LABEL[status]}“ geht es nicht.`,
    );
  ctx.inverse.push({ kind: 'event_status', event_id: id, status: event.status });
  const changes: HistoryChanges = { status: { old: event.status, new: status } };
  // Veranstaltungen sind erst ab P3 markierbar – hier gibt es nichts zu entfernen
  const result = await ctx.trx
    .updateTable('events')
    .set({ status, version: event.version + 1, updated_at: iso(ctx) })
    .where('id', '=', id)
    .where('version', '=', event.version)
    .executeTakeFirst();
  await updatedOne(ctx, result, 'event', event);
  await writeHistory(ctx, 'event', id, 'status', changes);
  return registerUndo(
    ctx,
    'event',
    { id, version: event.version + 1 },
    `Status: ${EVENT_STATUS_LABEL[status]}`,
  );
}
