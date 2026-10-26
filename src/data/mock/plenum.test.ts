// Phase 3 – Plenum: Ergebnis, Protokoll, Abschluss (F-PLE-04, 16.2). Die Agenda ist eine eigene Ansicht (16.1).
// Mit MYZEL_API=server laufen dieselben Tests gegen die echten Server-Funktionen auf PGlite (Schritt C, Phase 3).
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
let clock: Date;
let plenumId: string;
const login = (name: string) => api.demo!.signInAs(`${name}@example.org`);
const expectError = async (promise: Promise<unknown>, code: AppError['code']) => {
  const error = (await promise.then(
    () => null,
    (e: unknown) => e,
  )) as AppError | null;
  expect(error?.code).toBe(code);
};
const inDays = (days: number, hour = 19) =>
  new Date(clock.getFullYear(), clock.getMonth(), clock.getDate() + days, hour).toISOString();
const plenum = () => api.getPlenum(plenumId);
const member = async (name: string) => (await api.listMembers()).find((m) => m.display_name === name)!;

beforeEach(async () => {
  clock = new Date(2026, 9, 11, 12, 0, 0);
  api =
    process.env.MYZEL_API === 'server'
      ? await (await import('../../../server/api/serverApi')).createServerApi({ now: () => clock })
      : createMockApi({ storage: memoryStorage(), now: () => clock });
  await login('mo');
  plenumId = (await api.listAppointments()).find((a) => a.title === 'Plenum Oktober')!.id;
});

describe('Protokoll (WF-PLE-03)', () => {
  it('speichert protokollierende Person, Notizen und Drive-Protokoll mit Versionsprüfung', async () => {
    const lea = await member('Lea');
    const doc = (await api.listDocuments()).find((d) => d.title === 'Protokoll Plenum September')!;
    const p = await plenum();
    await api.updateProtocol(plenumId, {
      protocol_member_id: lea.id,
      notes: 'Moderation: Lea.',
      protocol_document_id: doc.id,
      version: p.version,
    });
    const after = await plenum();
    expect(after.protocol_member_id).toBe(lea.id);
    expect(after.notes).toBe('Moderation: Lea.');
    expect(after.protocol_document?.title).toBe('Protokoll Plenum September');
    await expectError(
      api.updateProtocol(plenumId, {
        protocol_member_id: null,
        notes: null,
        protocol_document_id: null,
        version: p.version,
      }),
      'conflict',
    );
  });
});

describe('Plenum abschließen (WF-PLE-20, F-PLE-04)', () => {
  it('geht erst nach Beginn', async () => {
    const p = await plenum();
    await expectError(api.closePlenum(plenumId, [], p.version), 'rule');
  });

  it('setzt „abgeschlossen“, hält die Teilnahme fest und schickt die Zusammenfassung an alle', async () => {
    const type = (await api.listAppointmentTypes()).find((t) => t.label === 'Plenum')!;
    const { id } = await api.createAppointment({
      type_id: type.id,
      title: 'Plenum Sondersitzung',
      starts_at: inDays(0, 10),
      format: 'online',
      online_url: 'https://meet.example.org/myzel',
    });
    plenumId = id;
    const lea = await member('Lea');
    const { recipients } = await api.closePlenum(
      plenumId,
      [lea.id, (await member('Mo')).id],
      (await plenum()).version,
    );
    const closed = await plenum();
    expect(closed.status).toBe('abgeschlossen');
    expect(closed.attendee_ids).toHaveLength(2);
    expect(closed.summary_recipients).toBe(recipients);
    expect(recipients).toBe((await api.listMembers()).filter((m) => m.active && !m.is_system).length);
    await login('jule');
    const summary = (await api.demo!.myMessages()).find((m) => m.event_type === 'plenum_zusammenfassung')!;
    expect(summary.text).toContain('Plenum Sondersitzung ist abgeschlossen');
    // ein zweites Mal geht nicht
    await expectError(api.closePlenum(plenumId, [], closed.version), 'rule');
  });
});

describe('Was während des Plenums passiert, steht im Ergebnis (16.2)', () => {
  /** Plenum heute 13 Uhr, Mo hat zugesagt; danach ist es 13:30 Uhr */
  const runningPlenum = async () => {
    const type = (await api.listAppointmentTypes()).find((t) => t.label === 'Plenum')!;
    const { id } = await api.createAppointment({
      type_id: type.id,
      title: 'Plenum Sondersitzung',
      starts_at: inDays(0, 13),
      format: 'online',
      online_url: 'https://meet.example.org/myzel',
    });
    await api.setRsvp(id, 'ja');
    clock = new Date(clock.getFullYear(), clock.getMonth(), clock.getDate(), 13, 30);
    plenumId = id;
    return id;
  };
  const topicId = async () => (await api.listTopics()).find((t) => t.name === 'Lager & Material')!.id;
  const groups = async () =>
    Object.fromEntries((await plenum()).results.map((g) => [g.group, g.items.map((i) => i.text)]));

  it('die Sitzung kennt das laufende Plenum und ob ich auf der Teilnehmerliste stehe', async () => {
    const id = await runningPlenum();
    const mine = await api.getSession();
    expect(mine.state === 'member' && mine.plenum).toMatchObject({ id, participant: true });
    await login('lea');
    const lea = await api.getSession();
    expect(lea.state === 'member' && lea.plenum).toMatchObject({ id, participant: false });
  });

  it('mit Zusage zählt alles automatisch – je Artefakt eine Zeile, eine Frage nur einmal', async () => {
    await runningPlenum();
    const topic = await topicId();
    const { id: taskId } = await api.createTask({ title: 'Kabeltrommel kaufen', topic_id: topic });
    await api.setTaskStatus(taskId, { status: 'geplant', version: 1 });
    const { id: questionId } = await api.createQuestion({
      title: 'Wer hat den Zweitschlüssel?',
      topic_id: topic,
    });
    await api.createDecision({
      title: 'Zweitschlüssel liegt bei Kim',
      kind: 'fakt',
      topic_id: topic,
      source_plenum_id: plenumId,
      source_question_id: questionId,
    });
    const q = await api.getQuestion(questionId);
    await api.clarifyQuestion(questionId, { answer: 'Kim', version: q.version });
    expect(await groups()).toEqual({
      aufgaben: ['Neu: Kabeltrommel kaufen · Geplant'],
      fragen: [
        'Frage: Wer hat den Zweitschlüssel? – Antwort: Kim – daraus entstanden: Fakt „Zweitschlüssel liegt bei Kim“',
      ],
    });
    // im Plenum angelegte Aufgaben haben es als Herkunft
    expect((await api.getTask(taskId)).origin_plenum_id).toBe(plenumId);
  });

  it('Rückgängig nimmt eine Änderung wieder aus dem Ergebnis', async () => {
    await runningPlenum();
    const flyer = (await api.listTasks()).find((t) => t.title === 'Vereinshaftpflicht verlängern')!;
    const { undo_token } = await api.setTaskStatus(flyer.id, { status: 'geplant', version: flyer.version });
    expect((await groups()).aufgaben).toEqual([
      expect.stringMatching(/^Vereinshaftpflicht verlängern · Geplant · bis /),
    ]);
    await api.undo(undo_token);
    expect((await groups()).aufgaben).toBeUndefined();
  });

  it('später Archiviertes bleibt im Ergebnis – es hält fest, was im Plenum passiert ist', async () => {
    await runningPlenum();
    const { id } = await api.createTask({ title: 'Spenden', topic_id: await topicId() });
    await api.setTaskStatus(id, { status: 'verworfen', discard_reason: 'erledigt sich', version: 1 });
    clock = new Date(clock.getTime() + 6 * 3_600_000);
    await api.archiveTask(id, (await api.getTask(id)).version);
    expect((await groups()).aufgaben).toEqual(['Neu: Spenden · Verworfen']);
  });

  it('F1: Profil und Verwaltung zählen nie zum Plenum – auch nicht mit Zusage', async () => {
    await runningPlenum();
    const lea = (await api.listMembers()).find((m) => m.display_name === 'Lea')!;
    // Lea bearbeitet Aufgaben; das Austragen beim Deaktivieren gehört nicht ins Ergebnis
    await api.deactivateMember(lea.id);
    await api.updateOwnName('Mo K.');
    expect(await groups()).toEqual({});
  });

  it('ohne Zusage nur nach „gehört dazu“; nach dem Ende zählt nichts mehr', async () => {
    const id = await runningPlenum();
    const topic = await topicId();
    await login('lea');
    await api.createTask({ title: 'Ohne Antwort', topic_id: topic });
    api.setPlenumAnswer(id, true);
    await api.createTask({ title: 'Gehört dazu', topic_id: topic });
    api.setPlenumAnswer(id, false);
    await api.createTask({ title: 'Gehört nicht dazu', topic_id: topic });
    await login('mo');
    clock = new Date(clock.getTime() + 3 * 3_600_000);
    await api.createTask({ title: 'Nach dem Ende', topic_id: topic });
    expect((await groups()).aufgaben).toEqual(['Neu: Gehört dazu · Neu']);
  });

  it('was nur über die Quelle dabei ist, steht hinter dem, was im Plenum geändert wurde', async () => {
    const topic = await topicId();
    const id = await runningPlenum();
    clock = new Date(clock.getTime() - 2 * 3_600_000);
    await api.createDecision({
      title: 'AAA nur Quelle',
      kind: 'fakt',
      topic_id: topic,
      source_plenum_id: id,
    });
    clock = new Date(clock.getTime() + 2 * 3_600_000);
    await api.createDecision({ title: 'BBB im Plenum', kind: 'fakt', topic_id: topic, source_note: 'Notiz' });
    expect((await groups()).beschluesse).toEqual(['Neuer Fakt: BBB im Plenum', 'Fakt: AAA nur Quelle']);
  });

  it('die Zusammenfassung ist mehrzeilig: Überschrift, Gruppen, Aufzählung', async () => {
    const id = await runningPlenum();
    await api.createTask({ title: 'Kabeltrommel kaufen', topic_id: await topicId() });
    await api.closePlenum(id, [], (await plenum()).version);
    await login('jule');
    const summary = (await api.demo!.myMessages()).find((m) => m.event_type === 'plenum_zusammenfassung')!;
    expect(summary.text).toBe(
      'Plenum Sondersitzung ist abgeschlossen.\n\nAufgaben:\n• Neu: Kabeltrommel kaufen · Neu',
    );
  });
});
