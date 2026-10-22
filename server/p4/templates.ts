// Phase 4: Veranstaltungsvorlagen – Vorlagen-Dialog (S-23) und Vorlagen bearbeiten (S-55)
// (ANFORDERUNGEN 3.12, F-VER-06, F-VER-07, WF-VER-12, WF-ADM-08). Wie die Testdaten-Schicht (src/data/mock/templates.ts).
// Entfernte Vorlagenaufgaben werden archiviert: schon angelegte Aufgaben verweisen über template_applications darauf.
import type { TemplateDialog, TemplateWithItems, Undoable } from '../../src/data/api';
import { AppError } from '../../src/shared/errors';
import { addDays, berlinDate } from '../../src/shared/rules/due';
import {
  templateApplySchema,
  templateItemInputSchema,
  templateItemUpdateSchema,
  type TemplateSeedFile,
} from '../../src/shared/schema';
import { iso, notFound, parse, registerUndo, rule, writeHistory, type Ctx, type Trx } from '../core/context';
import type { TemplateItemRow } from '../db/types';
import { findEvent } from '../p1/events';
import { createTask } from '../p1/tasks';

async function itemsOf(trx: Trx, templateId: string): Promise<TemplateItemRow[]> {
  return trx
    .selectFrom('event_template_items')
    .selectAll()
    .where('template_id', '=', templateId)
    .where('archived_at', 'is', null)
    .orderBy('position')
    .orderBy('id')
    .execute();
}

/** Bausteine in der Reihenfolge ihres ersten Auftretens */
function groupByBlock<T extends { block: string }>(items: readonly T[]): { block: string; items: T[] }[] {
  const groups: { block: string; items: T[] }[] = [];
  for (const item of items) {
    const group = groups.find((g) => g.block === item.block);
    if (group) group.items.push(item);
    else groups.push({ block: item.block, items: [item] });
  }
  return groups;
}

/** Frist aus dem Datum der Veranstaltung (Kölner Kalender); was schon vorbei wäre, bekommt heute (Annahme A48) */
export function dueFor(startsAt: string, offsetDays: number, now: Date): string {
  const due = addDays(berlinDate(new Date(startsAt)), offsetDays);
  const today = berlinDate(now);
  return due < today ? today : due;
}

/** archived_at gehört nicht zum Datenvertrag der Vorlagenaufgabe */
const withoutArchive = (item: TemplateItemRow) => {
  const copy: Partial<TemplateItemRow> = { ...item };
  delete copy.archived_at;
  return copy as Omit<TemplateItemRow, 'archived_at'>;
};

/** S-23: Vorlagenaufgaben der Veranstaltungsart, gruppiert nach Baustein, mit Frist und „schon angelegt“ */
export async function getTemplateDialog(trx: Trx, eventId: string, now: Date): Promise<TemplateDialog> {
  const event = await trx.selectFrom('events').selectAll().where('id', '=', eventId).executeTakeFirst();
  if (!event) throw notFound('Diese Veranstaltung');
  const template = await trx
    .selectFrom('event_templates')
    .select(['id', 'name'])
    .where('event_type', '=', event.type)
    .executeTakeFirst();
  if (!template) return { event_id: eventId, template: null, blocks: [] };
  const [items, applied, topics] = await Promise.all([
    itemsOf(trx, template.id),
    // nur zählt, was noch existiert – eine gelöschte Aufgabe lässt sich erneut anlegen
    trx
      .selectFrom('template_applications as a')
      .innerJoin('tasks as t', 't.id', 'a.task_id')
      .select(['a.template_item_id', 'a.task_id'])
      .where('a.event_id', '=', eventId)
      .execute(),
    trx.selectFrom('topics').select(['id', 'archived_at']).execute(),
  ]);
  return {
    event_id: eventId,
    template,
    blocks: groupByBlock(
      items.map((item) => ({
        ...withoutArchive(item),
        due_date: dueFor(event.starts_at, item.offset_days, now),
        task_id: applied.find((a) => a.template_item_id === item.id)?.task_id ?? null,
        // archiviertes Thema: in der Vorlage ändern, bis dahin nicht anlegbar
        blocked: topics.some((t) => t.id === item.topic_id && !t.archived_at)
          ? null
          : 'Thema archiviert – in der Vorlage ändern',
      })),
    ),
  };
}

/** WF-VER-12: nur Ausgewähltes als „neu“ anlegen, ohne Duplikate; ein Rückgängig für alles */
export async function applyTemplate(
  ctx: Ctx,
  eventId: string,
  itemIds: unknown,
): Promise<Undoable & { created: number }> {
  const { item_ids } = parse(templateApplySchema, { item_ids: itemIds });
  const event = await findEvent(ctx, eventId);
  if (event.archived_at || event.status === 'abgesagt' || event.status === 'abgeschlossen')
    throw rule('Für abgeschlossene oder abgesagte Veranstaltungen gibt es keine Vorlagen mehr.');
  const dialog = await getTemplateDialog(ctx.trx, eventId, ctx.now);
  const open = new Map(dialog.blocks.flatMap((b) => b.items).map((i) => [i.id, i]));
  // die Teilschritte legen keine eigenen Rückgängig-Einträge an
  ctx.deferUndo = true;
  let created = 0;
  for (const id of new Set(item_ids)) {
    const item = open.get(id);
    // inzwischen aus der Vorlage entfernt: wird übersprungen, der Rest wird angelegt
    if (!item) continue;
    if (item.task_id) continue; // schon angelegt
    if (item.blocked) throw rule(`„${item.title}“: ${item.blocked}.`);
    const { id: taskId } = await createTask(ctx, {
      title: item.title,
      topic_id: item.topic_id,
      event_id: eventId,
      priority: item.default_priority,
      due_date: item.due_date,
      mark_for_plenum: false,
    });
    if (item.description)
      await ctx.trx
        .updateTable('tasks')
        .set({ description: item.description })
        .where('id', '=', taskId)
        .execute();
    ctx.inverse.push({ kind: 'task_delete', task_id: taskId });
    // ein gleichzeitiger Dialog legt dieselbe Vorlagenaufgabe nicht doppelt an (Primärschlüssel)
    await ctx.trx
      .insertInto('template_applications')
      .values({
        event_id: eventId,
        template_item_id: item.id,
        task_id: taskId,
        applied_by: ctx.actor.id,
        applied_at: iso(ctx),
      })
      .execute();
    created += 1;
  }
  ctx.deferUndo = false;
  if (created === 0) return { undo_token: '', created };
  await writeHistory(ctx, 'event', eventId, 'template_applied', {
    tasks_created: { old: null, new: created },
  });
  return { ...(await registerUndo(ctx, 'event', event, `${created} Aufgaben aus der Vorlage`)), created };
}

// ── Vorlagen bearbeiten (S-55, WF-ADM-08) ───────────────────────────────────

export async function listTemplates(trx: Trx): Promise<TemplateWithItems[]> {
  const templates = await trx.selectFrom('event_templates').selectAll().orderBy('event_type').execute();
  const out: TemplateWithItems[] = [];
  for (const t of templates)
    out.push({ ...t, blocks: groupByBlock((await itemsOf(trx, t.id)).map(withoutArchive)) });
  return out;
}

async function findItem(trx: Trx, id: string): Promise<TemplateItemRow> {
  const item = await trx
    .selectFrom('event_template_items')
    .selectAll()
    .where('id', '=', id)
    .where('archived_at', 'is', null)
    .forUpdate()
    .executeTakeFirst();
  if (!item) throw notFound('Diese Vorlagenaufgabe');
  return item;
}

async function usableTopic(trx: Trx, topicId: string): Promise<void> {
  const topic = await trx
    .selectFrom('topics')
    .select('archived_at')
    .where('id', '=', topicId)
    .executeTakeFirst();
  if (!topic || topic.archived_at)
    throw new AppError('validation', 'Bitte ein aktives Thema wählen.', { field: 'topic_id' });
}

/** Vorlage sperren und hochzählen: Änderungen an derselben Vorlage laufen nacheinander */
async function touchTemplate(ctx: Ctx, templateId: string): Promise<void> {
  const result = await ctx.trx
    .updateTable('event_templates')
    .set((eb) => ({ version: eb('version', '+', 1), updated_at: iso(ctx) }))
    .where('id', '=', templateId)
    .executeTakeFirst();
  if (Number(result.numUpdatedRows) === 0) throw notFound('Diese Vorlage');
}

export async function createTemplateItem(
  ctx: Ctx,
  templateId: string,
  raw: unknown,
): Promise<{ id: string }> {
  const input = parse(templateItemInputSchema, raw);
  await touchTemplate(ctx, templateId);
  await usableTopic(ctx.trx, input.topic_id);
  const items = await itemsOf(ctx.trx, templateId);
  // neue Aufgabe ans Ende ihres Bausteins, die folgenden rücken nach
  const lastInBlock = items.filter((i) => i.block === input.block).at(-1);
  const position = lastInBlock ? lastInBlock.position + 1 : (items.at(-1)?.position ?? 0) + 1;
  if (lastInBlock)
    await ctx.trx
      .updateTable('event_template_items')
      .set((eb) => ({ position: eb('position', '+', 1) }))
      .where('template_id', '=', templateId)
      .where('position', '>=', position)
      .execute();
  const item = await ctx.trx
    .insertInto('event_template_items')
    .values({ template_id: templateId, ...input, position })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { id: item.id };
}

/** erst die Vorlage sperren, dann die Aufgabe darin – dieselbe Reihenfolge wie beim Anlegen */
async function lockTemplateOf(ctx: Ctx, itemId: string): Promise<void> {
  const ref = await ctx.trx
    .selectFrom('event_template_items')
    .select('template_id')
    .where('id', '=', itemId)
    .executeTakeFirst();
  if (!ref) throw notFound('Diese Vorlagenaufgabe');
  await ctx.trx
    .selectFrom('event_templates')
    .select('id')
    .where('id', '=', ref.template_id)
    .forUpdate()
    .execute();
}

export async function updateTemplateItem(ctx: Ctx, id: string, raw: unknown): Promise<void> {
  const input = parse(templateItemUpdateSchema, raw);
  await lockTemplateOf(ctx, id);
  const item = await findItem(ctx.trx, id);
  if (item.version !== input.version)
    throw new AppError('conflict', 'Jemand hat diese Vorlagenaufgabe inzwischen geändert.');
  await usableTopic(ctx.trx, input.topic_id);
  await ctx.trx
    .updateTable('event_template_items')
    .set({
      block: input.block,
      title: input.title,
      description: input.description,
      offset_days: input.offset_days,
      default_priority: input.default_priority,
      topic_id: input.topic_id,
      version: item.version + 1,
    })
    .where('id', '=', id)
    .execute();
  await touchTemplate(ctx, item.template_id);
}

/** Wirkt nur auf künftige Dialoge; schon angelegte Aufgaben bleiben, wie sie sind (WF-ADM-08) */
export async function removeTemplateItem(ctx: Ctx, id: string): Promise<void> {
  await lockTemplateOf(ctx, id);
  const item = await findItem(ctx.trx, id);
  await ctx.trx
    .updateTable('event_template_items')
    .set({ archived_at: iso(ctx) })
    .where('id', '=', id)
    .execute();
  await touchTemplate(ctx, item.template_id);
}

/** Startinhalt (src/shared/seed/event-templates.yaml) in eine leere Datenbank – einmalig, `npm run db:seed-templates` */
export async function seedTemplates(trx: Trx, seed: TemplateSeedFile, now: Date): Promise<number> {
  const existing = await trx.selectFrom('event_templates').select('id').executeTakeFirst();
  if (existing) return 0;
  const topics = await trx
    .selectFrom('topics')
    .select(['id', 'name'])
    .where('archived_at', 'is', null)
    .execute();
  let count = 0;
  for (const t of seed.templates) {
    const template = await trx
      .insertInto('event_templates')
      .values({ event_type: t.event_type, name: t.name, updated_at: now.toISOString() })
      .returning('id')
      .executeTakeFirstOrThrow();
    for (const [i, item] of t.items.entries()) {
      const topic = topics.find((x) => x.name === item.topic);
      if (!topic) throw new Error(`event-templates.yaml: unbekanntes Thema „${item.topic}“`);
      await trx
        .insertInto('event_template_items')
        .values({
          template_id: template.id,
          block: item.block,
          title: item.title,
          description: item.description ?? null,
          offset_days: item.offset_days,
          default_priority: item.priority ?? 'mittel',
          topic_id: topic.id,
          position: i + 1,
        })
        .execute();
      count += 1;
    }
  }
  return count;
}
