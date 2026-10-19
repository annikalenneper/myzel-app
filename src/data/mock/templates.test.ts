// Phase 4 – Vorlagen: YAML-Startinhalt mit Schema, Dialog S-23 (WF-VER-12), Bearbeiten S-55 (WF-ADM-08)
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError } from '../../shared/errors';
import { templateSeedFileSchema } from '../../shared/schema';
import type { MyzelApi } from '../api';
import { createMockApi, type KeyValueStorage } from './mockApi';
import { formatOffsetDays } from '../../shared/format';
import { parseGermanNumber } from '../../shared/rules/eventDetails';
import { dueFor, loadTemplateSeed } from './templates';

function memoryStorage(): KeyValueStorage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

let api: MyzelApi;
const now = new Date(2026, 9, 11, 12);
const expectError = async (promise: Promise<unknown>, code: AppError['code'], field?: string) => {
  const error = (await promise.then(
    () => null,
    (e: unknown) => e,
  )) as AppError | null;
  expect(error?.code).toBe(code);
  if (field) expect(error?.field).toBe(field);
};
const newEvent = async (type: 'party' | 'workshop' = 'party', daysAhead = 70) => {
  const starts = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysAhead, 22);
  return (await api.createEvent({ title: 'Frühlingsrave', type, starts_at: starts.toISOString() })).id;
};
const items = (dialog: Awaited<ReturnType<MyzelApi['getTemplateDialog']>>) =>
  dialog.blocks.flatMap((b) => b.items);

beforeEach(async () => {
  api = createMockApi({ storage: memoryStorage(), now: () => now });
  await api.demo!.signInAs('mo@example.org');
});

describe('Startinhalt (3.12)', () => {
  it('die YAML-Datei passt zum Schema; das JSON-Schema ist aktuell (npm run schema:templates)', async () => {
    const seed = loadTemplateSeed();
    expect(seed.templates.map((t) => t.event_type)).toEqual(['party', 'workshop', 'soli', 'sonstiges']);
    await expect(`${JSON.stringify(z.toJSONSchema(templateSeedFileSchema), null, 2)}\n`).toMatchFileSnapshot(
      '../../shared/seed/event-templates.schema.json',
    );
  });

  it('eine fehlerhafte Datei fällt sofort auf', () => {
    expect(() => loadTemplateSeed('templates:\n  - event_type: rave\n    name: X\n    items: []\n')).toThrow(
      /passt nicht zum Schema/,
    );
  });
});

describe('Vorlagen-Dialog (F-VER-06, WF-VER-12)', () => {
  it('zeigt die Aufgaben der Art nach Baustein, mit Fristen aus dem Datum', async () => {
    const id = await newEvent('party', 70);
    const dialog = await api.getTemplateDialog(id);
    expect(dialog.template?.name).toBe('Party');
    expect(dialog.blocks.map((b) => b.block)).toEqual([
      'Location',
      'Booking',
      'Bar',
      'Eintritt',
      'Awareness',
      'Rahmen',
      'Kommunikation',
      'Nachbereitung',
    ]);
    const anfragen = items(dialog).find((i) => i.title === 'Location anfragen')!;
    expect(anfragen.due_date).toBe('2026-10-21'); // Beginn 20.12., 60 Tage vorher
    expect(anfragen.task_id).toBeNull();
  });

  it('Fristen, die schon vorbei wären, bekommen heute', () => {
    expect(dueFor(new Date(2026, 9, 20, 22).toISOString(), -60, now)).toBe('2026-10-11');
  });

  it('legt nur Ausgewähltes als „neu“ an; erneutes Aufrufen erzeugt keine Duplikate; Rückgängig für alles', async () => {
    const id = await newEvent();
    const dialog = await api.getTemplateDialog(id);
    const bar = dialog.blocks.find((b) => b.block === 'Bar')!.items.map((i) => i.id);
    const tasksBefore = (await api.listTasks()).length;
    const { created, undo_token } = await api.applyTemplate(id, bar);
    expect(created).toBe(2);
    const made = (await api.listTasks()).filter((t) => t.event_id === id);
    expect(made.map((t) => [t.title, t.status])).toEqual([
      ['Getränke bestellen', 'neu'],
      ['Barschichten besetzen', 'neu'],
    ]);
    const again = await api.getTemplateDialog(id);
    expect(
      items(again)
        .filter((i) => i.task_id)
        .map((i) => i.title),
    ).toEqual(['Getränke bestellen', 'Barschichten besetzen']);
    expect((await api.applyTemplate(id, [...bar, items(again)[0]!.id])).created).toBe(1);

    await api.undo((await api.applyTemplate(id, [items(again)[1]!.id])).undo_token);
    await api.undo(undo_token);
    // die ersten beiden sind wieder weg und lassen sich erneut anlegen
    expect((await api.listTasks()).length).toBe(tasksBefore + 1);
    expect(items(await api.getTemplateDialog(id)).filter((i) => i.task_id)).toHaveLength(1);
  });

  it('gibt es nicht für abgesagte Veranstaltungen', async () => {
    const id = await newEvent();
    const event = await api.getEvent(id);
    await api.setEventStatus(id, 'abgesagt', event.version);
    const first = items(await api.getTemplateDialog(id))[0]!;
    await expectError(api.applyTemplate(id, [first.id]), 'rule');
  });
});

describe('Vorlagen bearbeiten (F-VER-07, WF-ADM-08)', () => {
  it('Aufgaben hinzufügen, ändern und entfernen – wirkt auf künftige Dialoge', async () => {
    const party = (await api.listTemplates()).find((t) => t.event_type === 'party')!;
    const topic = (await api.listTopics()).find((t) => t.name === 'Lager & Material')!;
    await api.createTemplateItem(party.id, {
      block: 'Bar',
      title: 'Kühlschrank aus dem Lager holen',
      offset_days: -1,
      topic_id: topic.id,
    });
    const bar = (await api.listTemplates())
      .find((t) => t.id === party.id)!
      .blocks.find((b) => b.block === 'Bar')!;
    expect(bar.items.map((i) => i.title)).toEqual([
      'Getränke bestellen',
      'Barschichten besetzen',
      'Kühlschrank aus dem Lager holen',
    ]);
    const item = bar.items[2]!;
    await api.updateTemplateItem(item.id, { ...item, offset_days: -2, version: item.version });
    await expectError(api.updateTemplateItem(item.id, { ...item, version: item.version }), 'conflict');
    await api.removeTemplateItem(bar.items[0]!.id);
    const id = await newEvent();
    expect(items(await api.getTemplateDialog(id)).some((i) => i.title === 'Getränke bestellen')).toBe(false);
  });

  it('prüft Baustein, Titel, Abstand und Thema', async () => {
    const party = (await api.listTemplates())[0]!;
    await expectError(
      api.createTemplateItem(party.id, {
        block: '',
        title: 'X',
        offset_days: 0,
        topic_id: crypto.randomUUID(),
      }),
      'validation',
      'block',
    );
    await expectError(
      api.createTemplateItem(party.id, {
        block: 'Bar',
        title: 'X',
        offset_days: 400,
        topic_id: crypto.randomUUID(),
      }),
      'validation',
      'offset_days',
    );
  });
});

describe('Befunde aus dem Review (18.10.2026)', () => {
  it('Rückgängig nimmt keine Aufgabe zurück, die inzwischen jemand kommentiert hat', async () => {
    const id = await newEvent();
    const first = items(await api.getTemplateDialog(id))[0]!;
    const { undo_token } = await api.applyTemplate(id, [first.id]);
    const task = (await api.listTasks()).find((t) => t.event_id === id)!;
    await api.addComment(task.id, 'Ich frage morgen an.');
    await expectError(api.undo(undo_token), 'rule');
    expect((await api.listTasks()).some((t) => t.id === task.id)).toBe(true);
  });

  it('ein Thema, das nur Vorlagen benutzen, lässt sich nicht löschen; archiviert sperrt es nur die Aufgabe', async () => {
    const topic = (await api.listTopics()).find((t) => t.name === 'Organisatorisches')!;
    await expectError(api.deleteTopic(topic.id), 'rule');
    const sonstiges = (await api.listTemplates()).find((t) => t.event_type === 'sonstiges')!;
    await api.archiveTopic(topic.id, topic.version);
    const { id } = await api.createEvent({
      title: 'Treffen',
      type: 'sonstiges',
      starts_at: '2026-12-01T18:00:00.000Z',
    });
    const dialog = await api.getTemplateDialog(id);
    const blocked = items(dialog).filter((i) => i.blocked);
    expect(blocked.map((i) => i.title)).toEqual(['Ablauf planen', 'Nachbereitung besprechen']);
    expect(sonstiges.blocks).toHaveLength(2);
    await expectError(api.applyTemplate(id, [blocked[0]!.id]), 'rule');
  });

  it('in deutscher Schreibweise: Tage, Zahlen', () => {
    expect(formatOffsetDays(-1)).toBe('1 Tag vorher');
    expect(formatOffsetDays(14)).toBe('14 Tage danach');
    expect(parseGermanNumber('2.500')).toBe(2500);
    expect(parseGermanNumber('2.500,50')).toBe(2500.5);
    expect(parseGermanNumber('12,5')).toBe(12.5);
    expect(parseGermanNumber('')).toBeNull();
    expect(parseGermanNumber('viele')).toBeNaN();
  });
});
