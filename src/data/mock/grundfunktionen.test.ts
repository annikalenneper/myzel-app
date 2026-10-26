// Umbau 10/2026, Phase 4 (ANFORDERUNGEN 16.3, 16.4): Kommentare, Verlauf und Bearbeiten an allen Artefakten, Event-Bezug
// für Entscheidungen und Fakten, kurzer Text. Mit MYZEL_API=server laufen dieselben Tests gegen die Server-Funktionen.
import { beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../../shared/errors';
import type { MyzelApi } from '../api';
import { createMockApi, type KeyValueStorage } from './mockApi';

function memoryStorage(): KeyValueStorage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

let api: MyzelApi;
const login = (name: string) => api.demo!.signInAs(`${name}@example.org`);
const expectError = async (promise: Promise<unknown>, code: AppError['code'], field?: string) => {
  const error = (await promise.then(
    () => null,
    (e: unknown) => e,
  )) as AppError | null;
  expect(error?.code).toBe(code);
  if (field) expect(error?.field).toBe(field);
};
const decision = async (title: string) => (await api.listDecisions()).find((d) => d.title === title)!;
const question = async (title: string) => (await api.listQuestions()).find((q) => q.title.startsWith(title))!;
const eventId = async (title: string) => (await api.listEvents()).find((e) => e.title === title)!.id;

beforeEach(async () => {
  api =
    process.env.MYZEL_API === 'server'
      ? await (
          await import('../../../server/api/serverApi')
        ).createServerApi({ now: () => new Date(2026, 9, 11, 12) })
      : createMockApi({ storage: memoryStorage(), now: () => new Date(2026, 9, 11, 12) });
  await login('mo');
});

describe('Kommentare an allen Artefakten (16.3)', () => {
  it('Frage, Entscheidung, Veranstaltung, Termin und Partner: kommentieren, nur eigene bearbeiten, mit Verlauf', async () => {
    const q = await question('Machen wir an Silvester');
    const d = await decision('Mate am Tresen für 2,50 €');
    const event = await eventId('Winterrave');
    const appointment = (await api.listAppointments()).find((a) => a.title === 'Bautag Oktober')!.id;
    const partner = (await api.listPartners()).find((p) => p.name === 'Kollektiv Sporenflug')!.id;

    await api.addComment('question', q.id, 'Ich frage im Lager nach.');
    await api.addComment('decision', d.id, 'Gilt auch für Club-Mate light?');
    await api.addComment('event', event, 'Aufbau ab 16 Uhr.');
    await api.addComment('appointment', appointment, 'Ich bringe Werkzeug mit.');
    const { id } = await api.addComment('partner', partner, 'Rechnung kommt im Dezember.');
    await expectError(api.addComment('question', q.id, '   '), 'validation');

    expect((await api.getQuestion(q.id)).comments.map((c) => c.body)).toEqual(['Ich frage im Lager nach.']);
    expect((await api.getDecision(d.id)).comments).toHaveLength(1);
    expect((await api.getEventDetail(event)).comments.map((c) => c.body)).toEqual(['Aufbau ab 16 Uhr.']);
    expect((await api.getAppointment(appointment)).comments).toHaveLength(1);
    const p = await api.getPartner(partner);
    expect(p.comments.map((c) => c.body)).toEqual(['Rechnung kommt im Dezember.']);
    expect(p.history[0]!.action).toBe('comment_added');

    // nur die Person selbst bearbeitet; der Verlauf hält alt → neu fest
    await login('lea');
    await expectError(api.updateComment(id, 'Lea war hier'), 'forbidden');
    await login('mo');
    await api.updateComment(id, 'Rechnung kommt im Januar.');
    const after = await api.getPartner(partner);
    expect(after.comments[0]!.body).toBe('Rechnung kommt im Januar.');
    expect(after.history[0]).toMatchObject({
      action: 'comment_edited',
      changes: { body: { old: 'Rechnung kommt im Dezember.', new: 'Rechnung kommt im Januar.' } },
    });
  });

  it('eine kommentierte neue Fassung lässt sich nicht mehr zurücknehmen', async () => {
    const d = await decision('Mate am Tresen für 2,50 €');
    const r = await api.replaceDecision(d.id, {
      title: 'Mate am Tresen für 3 €',
      source_note: 'Absprache',
      version: d.version,
    });
    const created = r.successor_id;
    await api.addComment('decision', created, 'Wirklich?');
    await expectError(api.undo(r.undo_token), 'rule');
    expect((await api.getDecision(created)).comments).toHaveLength(1);
  });

  it('an Aufgaben bleibt alles wie bisher: wer kommentiert, folgt', async () => {
    const task = (await api.listTasks()).find((t) => t.title === 'Vereinshaftpflicht verlängern')!;
    await login('jule');
    const r = await api.addComment('task', task.id, 'Ich kümmere mich.');
    expect(r.now_following).toBe(true);
    expect((await api.getTask(task.id)).comments.at(-1)!.body).toBe('Ich kümmere mich.');
  });
});

describe('Bearbeiten mit Verlauf alt → neu (16.3)', () => {
  it('Frage: Titel, Beschreibung, Veranstaltung, Dringlichkeit – mit Versionsprüfung', async () => {
    const q = await question('Machen wir an Silvester');
    const rave = await eventId('Winterrave');
    await api.updateQuestion(q.id, {
      title: 'Machen wir an Silvester eine kleine Party?',
      description: 'Nur für uns und Freund*innen.',
      topic_id: q.topic_id,
      event_id: rave,
      urgency: 'mittel',
      version: q.version,
    });
    const after = await api.getQuestion(q.id);
    expect([after.title, after.event_id, after.urgency]).toEqual([
      'Machen wir an Silvester eine kleine Party?',
      rave,
      'mittel',
    ]);
    expect(after.history[0]).toMatchObject({
      action: 'updated',
      changes: {
        title: {
          old: 'Machen wir an Silvester eine Party?',
          new: 'Machen wir an Silvester eine kleine Party?',
        },
      },
    });
    await expectError(
      api.updateQuestion(q.id, { title: 'Alt', topic_id: q.topic_id, version: q.version }),
      'conflict',
    );
  });

  it('Entscheidung: Text höchstens 200 Zeichen; nur gültige; Veranstaltung zeigt sie direkt', async () => {
    const d = await decision('Mate am Tresen für 2,50 €');
    const rave = await eventId('Winterrave');
    await expectError(
      api.updateDecision(d.id, {
        title: d.title,
        description: 'x'.repeat(201),
        topic_id: d.topic_id,
        version: d.version,
      }),
      'validation',
      'description',
    );
    await api.updateDecision(d.id, {
      title: d.title,
      description: 'Gilt für alle Sorten.',
      topic_id: d.topic_id,
      event_id: rave,
      version: d.version,
    });
    const after = await api.getDecision(d.id);
    expect([after.description, after.event_id]).toEqual(['Gilt für alle Sorten.', rave]);
    expect(after.history[0]!.changes.description).toEqual({
      old: d.description,
      new: 'Gilt für alle Sorten.',
    });
    expect((await api.getEventDetail(rave)).decisions.map((x) => x.title)).toContain(
      'Mate am Tresen für 2,50 €',
    );

    const old = await decision('Mate am Tresen für 2 €');
    await expectError(
      api.updateDecision(old.id, { title: 'Neu', topic_id: old.topic_id, version: old.version }),
      'rule',
    );
  });

  it('neue Entscheidungen bekommen Veranstaltung und kurzen Text gleich beim Anlegen', async () => {
    const rave = await eventId('Winterrave');
    const topic = (await api.listTopics()).find((t) => t.name === 'Veranstaltungen')!.id;
    await expectError(
      api.createDecision({
        title: 'Zu lang',
        kind: 'fakt',
        topic_id: topic,
        description: 'y'.repeat(201),
        source_note: 'Notiz',
      }),
      'validation',
      'description',
    );
    const { id } = await api.createDecision({
      title: 'Einlass ab 22 Uhr',
      kind: 'fakt',
      topic_id: topic,
      description: 'Vorher ist Aufbau.',
      event_id: rave,
      source_note: 'Absprache',
    });
    expect((await api.getEventDetail(rave)).decisions.find((x) => x.id === id)).toMatchObject({
      kind: 'fakt',
      description: 'Vorher ist Aufbau.',
    });
  });

  it('Termin: Beschreibung anlegen und ändern, im Verlauf mit altem Stand', async () => {
    const type = (await api.listAppointmentTypes()).find((t) => t.label === 'Bautag')!;
    const { id } = await api.createAppointment({
      type_id: type.id,
      title: 'Bautag extra',
      starts_at: new Date(2026, 9, 20, 10).toISOString(),
      format: 'vor_ort',
      location: 'Lager',
      description: 'Regal fertig bauen.',
    });
    const a = await api.getAppointment(id);
    expect(a.description).toBe('Regal fertig bauen.');
    await api.updateAppointment(id, {
      type_id: a.type_id,
      title: a.title,
      starts_at: a.starts_at,
      ends_at: a.ends_at,
      format: a.format,
      location: a.location,
      online_url: a.online_url,
      event_id: a.event_id,
      description: 'Regal fertig bauen, dann streichen.',
      version: a.version,
    });
    const after = await api.getAppointment(id);
    expect(after.description).toBe('Regal fertig bauen, dann streichen.');
    expect(after.history[0]!.changes.description).toEqual({
      old: 'Regal fertig bauen.',
      new: 'Regal fertig bauen, dann streichen.',
    });
  });
});
