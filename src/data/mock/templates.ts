// Testdaten-Schicht, Phase 4: Veranstaltungsvorlagen – Startinhalt aus YAML, Vorlagen-Dialog (S-23) und
// Vorlagen bearbeiten (S-55) (ANFORDERUNGEN 3.12, F-VER-06, F-VER-07, WF-VER-12, WF-ADM-08)
import { parse as parseYaml } from 'yaml';
import { AppError } from '../../shared/errors';
import { addDays, toIsoDate } from '../../shared/rules/due';
import seedYaml from '../../shared/seed/event-templates.yaml?raw';
import {
  templateApplySchema,
  templateItemInputSchema,
  templateItemUpdateSchema,
  templateSeedFileSchema,
  type EventTemplateItem,
  type TemplateSeedFile,
} from '../../shared/schema';
import type { TemplateDialog, TemplateWithItems, Undoable } from '../api';
import * as server from './server';
import {
  findEvent,
  notArchived,
  notFound,
  parse,
  registerUndo,
  rule,
  writeHistory,
  type Ctx,
  type Db,
} from './server';

const uuid = () => crypto.randomUUID();

/** Startinhalt lesen und gegen das Schema prüfen – ein Fehler in der Datei fällt sofort auf */
export function loadTemplateSeed(text: string = seedYaml): TemplateSeedFile {
  const result = templateSeedFileSchema.safeParse(parseYaml(text));
  if (!result.success)
    throw new Error(`event-templates.yaml passt nicht zum Schema: ${result.error.issues[0]?.message}`);
  return result.data;
}

export function seedTemplates(db: Db, now: Date): void {
  for (const t of loadTemplateSeed().templates) {
    const id = uuid();
    db.event_templates.push({
      id,
      event_type: t.event_type,
      name: t.name,
      updated_at: now.toISOString(),
      version: 1,
    });
    t.items.forEach((item, i) => {
      const topic = db.topics.find((x) => x.name === item.topic && !x.archived_at);
      if (!topic) throw new Error(`event-templates.yaml: unbekanntes Thema „${item.topic}“`);
      db.event_template_items.push({
        id: uuid(),
        template_id: id,
        block: item.block,
        title: item.title,
        description: item.description ?? null,
        offset_days: item.offset_days,
        default_priority: item.priority ?? 'mittel',
        topic_id: topic.id,
        position: i + 1,
        version: 1,
      });
    });
  }
}

const itemsOf = (db: Db, templateId: string) =>
  db.event_template_items.filter((i) => i.template_id === templateId).sort((a, b) => a.position - b.position);

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

/** Frist aus dem Datum der Veranstaltung; was schon vorbei wäre, bekommt heute (Annahme A48) */
export function dueFor(startsAt: string, offsetDays: number, now: Date): string {
  const due = addDays(toIsoDate(new Date(startsAt)), offsetDays);
  const today = toIsoDate(now);
  return due < today ? today : due;
}

/** S-23: Vorlagenaufgaben der Veranstaltungsart, gruppiert nach Baustein, mit Frist und „schon angelegt“ */
export function getTemplateDialog(db: Db, eventId: string, now: Date): TemplateDialog {
  const event = findEvent(db, eventId);
  const template = db.event_templates.find((t) => t.event_type === event.type);
  if (!template) return { event_id: eventId, template: null, blocks: [] };
  const applied = new Map(
    db.template_applications
      .filter((a) => a.event_id === eventId)
      .map((a) => [a.template_item_id, a.task_id]),
  );
  return {
    event_id: eventId,
    template: { id: template.id, name: template.name },
    blocks: groupByBlock(
      itemsOf(db, template.id).map((item) => ({
        ...item,
        due_date: dueFor(event.starts_at, item.offset_days, now),
        // nur zählt, was noch existiert – eine gelöschte Aufgabe lässt sich erneut anlegen
        task_id: db.tasks.some((t) => t.id === applied.get(item.id)) ? applied.get(item.id)! : null,
        // archiviertes Thema: in der Vorlage ändern, bis dahin nicht anlegbar
        blocked: db.topics.some((t) => t.id === item.topic_id && !t.archived_at)
          ? null
          : 'Thema archiviert – in der Vorlage ändern',
      })),
    ),
  };
}

/** WF-VER-12: nur Ausgewähltes als „neu“ anlegen, ohne Duplikate; ein Rückgängig für alles */
export function applyTemplate(ctx: Ctx, eventId: string, raw: unknown): Undoable & { created: number } {
  const { item_ids } = parse(templateApplySchema, raw);
  const event = notArchived(findEvent(ctx.db, eventId));
  if (event.archived_at || event.status === 'abgesagt' || event.status === 'abgeschlossen')
    throw rule('Für abgeschlossene oder abgesagte Veranstaltungen gibt es keine Vorlagen mehr.');
  const dialog = getTemplateDialog(ctx.db, eventId, ctx.now);
  const open = new Map(dialog.blocks.flatMap((b) => b.items).map((i) => [i.id, i]));
  let created = 0;
  for (const id of new Set(item_ids)) {
    const item = open.get(id);
    // inzwischen aus der Vorlage entfernt: wird übersprungen, der Rest wird angelegt
    if (!item) continue;
    if (item.task_id) continue; // schon angelegt
    if (item.blocked) throw rule(`„${item.title}“: ${item.blocked}.`);
    const { id: taskId } = server.createTask(ctx, {
      title: item.title,
      topic_id: item.topic_id,
      event_id: eventId,
      priority: item.default_priority,
      due_date: item.due_date,
    });
    if (item.description) server.findTask(ctx.db, taskId).description = item.description;
    ctx.inverse.push({ kind: 'task_delete', task_id: taskId });
    ctx.db.template_applications.push({
      event_id: eventId,
      template_item_id: item.id,
      task_id: taskId,
      applied_by: ctx.actor.id,
      applied_at: ctx.now.toISOString(),
    });
    created += 1;
  }
  if (created === 0) return { undo_token: '', created };
  writeHistory(ctx, 'event', eventId, 'template_applied', { tasks_created: { old: null, new: created } });
  // createTask hat keine eigenen Rückgängig-Einträge – es gibt genau einen für alle neuen Aufgaben
  return { ...registerUndo(ctx, 'event', event, `${created} Aufgaben aus der Vorlage`), created };
}

// ── Vorlagen bearbeiten (S-55, WF-ADM-08) ───────────────────────────────────

export function listTemplates(db: Db): TemplateWithItems[] {
  return db.event_templates.map((t) => ({ ...t, blocks: groupByBlock(itemsOf(db, t.id)) }));
}

function findItem(db: Db, id: string): EventTemplateItem {
  const item = db.event_template_items.find((i) => i.id === id);
  if (!item) throw notFound('Diese Vorlagenaufgabe');
  return item;
}

function usableTopic(db: Db, topicId: string): void {
  if (!db.topics.some((t) => t.id === topicId && !t.archived_at))
    throw new AppError('validation', 'Bitte ein aktives Thema wählen.', { field: 'topic_id' });
}

function touchTemplate(ctx: Ctx, templateId: string): void {
  const template = ctx.db.event_templates.find((t) => t.id === templateId)!;
  template.version += 1;
  template.updated_at = ctx.now.toISOString();
}

export function createTemplateItem(ctx: Ctx, templateId: string, raw: unknown): { id: string } {
  const input = parse(templateItemInputSchema, raw);
  if (!ctx.db.event_templates.some((t) => t.id === templateId)) throw notFound('Diese Vorlage');
  usableTopic(ctx.db, input.topic_id);
  const items = itemsOf(ctx.db, templateId);
  // neue Aufgabe ans Ende ihres Bausteins
  const lastInBlock = items.filter((i) => i.block === input.block).at(-1);
  const position = lastInBlock ? lastInBlock.position + 0.5 : (items.at(-1)?.position ?? 0) + 1;
  const item: EventTemplateItem = { id: uuid(), template_id: templateId, ...input, position, version: 1 };
  ctx.db.event_template_items.push(item);
  itemsOf(ctx.db, templateId).forEach((i, n) => (i.position = n + 1));
  touchTemplate(ctx, templateId);
  return { id: item.id };
}

export function updateTemplateItem(ctx: Ctx, id: string, raw: unknown): void {
  const input = parse(templateItemUpdateSchema, raw);
  const item = findItem(ctx.db, id);
  if (item.version !== input.version)
    throw new AppError('conflict', 'Jemand hat diese Vorlagenaufgabe inzwischen geändert.');
  usableTopic(ctx.db, input.topic_id);
  Object.assign(item, {
    block: input.block,
    title: input.title,
    description: input.description,
    offset_days: input.offset_days,
    default_priority: input.default_priority,
    topic_id: input.topic_id,
  });
  item.version += 1;
  touchTemplate(ctx, item.template_id);
}

/** Wirkt nur auf künftige Dialoge; schon angelegte Aufgaben bleiben, wie sie sind (WF-ADM-08) */
export function removeTemplateItem(ctx: Ctx, id: string): void {
  const item = findItem(ctx.db, id);
  ctx.db.event_template_items = ctx.db.event_template_items.filter((i) => i !== item);
  touchTemplate(ctx, item.template_id);
}
