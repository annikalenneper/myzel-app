// Phase 3 – Plenum: Agenda (3.14, F-PLE-03), Aktionen je Art (F-PLE-05), Ergebnis, Protokoll, Abschluss
// Mit MYZEL_API=server laufen dieselben Tests gegen die echten Server-Funktionen auf PGlite (Schritt C, Phase 3).
import { beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../../shared/errors';
import type { AgendaItem, MyzelApi } from '../api';
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
const item = async (title: string): Promise<AgendaItem> =>
  (await plenum()).agenda.find((a) => a.title.startsWith(title))!;
const titles = async () => (await plenum()).agenda.map((a) => a.title);
const member = async (name: string) => (await api.listMembers()).find((m) => m.display_name === name)!;
const results = async () => Object.fromEntries((await plenum()).results.map((g) => [g.group, g.lines]));

beforeEach(async () => {
  clock = new Date(2026, 9, 11, 12, 0, 0);
  api =
    process.env.MYZEL_API === 'server'
      ? await (await import('../../../server/api/serverApi')).createServerApi({ now: () => clock })
      : createMockApi({ storage: memoryStorage(), now: () => clock });
  await login('mo');
  plenumId = (await api.listAppointments()).find((a) => a.title === 'Plenum Oktober')!.id;
});

describe('Agenda (F-PLE-03, 3.14)', () => {
  it('zeigt alle Markierungen in einer gemeinsamen Reihenfolge, mit Art und Hinweisen', async () => {
    const agenda = (await plenum()).agenda;
    expect(new Set(agenda.map((a) => a.target))).toEqual(
      new Set(['task', 'question', 'decision', 'event', 'appointment', 'document']),
    );
    const location = agenda.find((a) => a.title.startsWith('Location'))!;
    expect(location.label).toBe('Aufgabe · In Arbeit · überfällig');
    expect(location.tone).toBe('rot');
    expect(agenda.find((a) => a.target === 'question')!.label).toBe('Frage · Hoch');
  });

  it('Reihenfolge per Ziehgriff gilt für alle; neu Markiertes kommt ans Ende', async () => {
    const before = await titles();
    const last = (await plenum()).agenda.at(-1)!;
    await api.moveAgendaItem(last.mark_id, 0);
    expect((await titles())[0]).toBe(last.title);
    await login('jule');
    expect((await titles())[0]).toBe(last.title);
    const task = (await api.listTasks()).find((t) => t.title.startsWith('Nebelmaschine'))!;
    await api.setPlenumMark(task.id, true);
    expect((await titles()).at(-1)).toBe(task.title);
    expect(await titles()).toHaveLength(before.length + 1);
  });

  it('eine inzwischen verschwundene Markierung lässt sich verschieben, ohne dass etwas verloren geht', async () => {
    const doc = await item('Hausordnung');
    await api.plenumAction(plenumId, { kind: 'discussed', target: 'document', id: doc.id });
    const count = (await titles()).length;
    await api.moveAgendaItem(doc.mark_id, 0);
    expect(await titles()).toHaveLength(count);
  });
});

describe('Aktionen je Art (F-PLE-05)', () => {
  it('Einplanen: neu → geplant mit Herkunft, Person und Frist; aus der Agenda; Rückgängig stellt alles wieder her', async () => {
    const before = await titles();
    const task = await item('Vereinshaftpflicht');
    const jule = await member('Jule');
    const original = await api.getTask(task.id);
    const { undo_token } = await api.plenumAction(plenumId, {
      kind: 'task_plan',
      id: task.id,
      version: task.version,
      assignee_id: jule.id,
      due_date: '2026-10-30',
    });
    const detail = await api.getTask(task.id);
    expect(detail.status).toBe('geplant');
    expect(detail.origin_plenum_id).toBe(plenumId);
    expect(detail.assignee_ids).toEqual([jule.id]);
    expect(detail.due_date).toBe('2026-10-30');
    expect(await titles()).not.toContain(task.title);
    expect((await results()).aufgaben).toEqual([
      'Eingeplant: Vereinshaftpflicht verlängern · Jule · bis 30.10.',
    ]);
    expect(detail.history.some((h) => h.changes.plenum_label?.new === 'Plenum Oktober vom 15.10.')).toBe(
      true,
    );

    await api.undo(undo_token);
    const back = await api.getTask(task.id);
    expect(back.status).toBe('neu');
    expect(back.origin_plenum_id).toBeNull();
    expect(back.assignee_ids).toEqual([]);
    expect(back.due_date).toBe(original.due_date);
    // der Punkt steht wieder an alter Stelle, das Ergebnis ist leer
    expect(await titles()).toEqual(before);
    expect((await plenum()).results).toEqual([]);
  });

  it('Einplanen geht nur bei neuen Aufgaben', async () => {
    const task = await item('Location');
    await expectError(
      api.plenumAction(plenumId, { kind: 'task_plan', id: task.id, version: task.version }),
      'rule',
    );
  });

  it('Umplanen ändert Bearbeitende und Frist, der Status bleibt', async () => {
    const task = await item('Location');
    const sam = await member('Sam');
    await api.plenumAction(plenumId, {
      kind: 'task_replan',
      id: task.id,
      version: task.version,
      assignee_id: sam.id,
      due_date: '2026-10-20',
    });
    const detail = await api.getTask(task.id);
    expect(detail.status).toBe('in_arbeit');
    expect(detail.assignee_ids).toEqual([sam.id]);
    expect(detail.due_date).toBe('2026-10-20');
    expect(await titles()).not.toContain(task.title);
  });

  it('Blockade lösen, Erledigt und Verwerfen nehmen den Punkt von der Agenda', async () => {
    const flyer = await item('Flyer');
    expect(flyer.task_status).toBe('blockiert');
    await api.plenumAction(plenumId, {
      kind: 'task_unblock',
      id: flyer.id,
      version: flyer.version,
      to: 'in_arbeit',
    });
    expect((await api.getTask(flyer.id)).status).toBe('in_arbeit');
    const location = await item('Location');
    await api.plenumAction(plenumId, {
      kind: 'task_finish',
      id: location.id,
      version: location.version,
      to: 'erledigt',
    });
    expect((await api.getTask(location.id)).status).toBe('erledigt');
    expect(await titles()).not.toContain(flyer.title);
    expect(await titles()).not.toContain(location.title);
    expect((await results()).aufgaben).toEqual([
      'Blockade gelöst: Flyer drucken lassen → In Arbeit',
      expect.stringMatching(/^Erledigt: Location für Winterrave bestätigen · /),
    ]);
  });

  it('Klären als Entscheidung mit Folgeaufgabe: eine Transaktion, ein Rückgängig für alles', async () => {
    const question = await item('Machen wir an Silvester');
    const decisionsBefore = (await api.listDecisions()).length;
    const tasksBefore = (await api.listTasks()).length;
    const { undo_token } = await api.plenumAction(plenumId, {
      kind: 'question_clarify',
      id: question.id,
      version: question.version,
      answer: 'Ja, kleine Party im Lager.',
      result: 'entscheidung',
      follow_up: true,
    });
    const q = await api.getQuestion(question.id);
    expect(q.status).toBe('geklaert');
    expect(q.answered_in_plenum_id).toBe(plenumId);
    const decision = (await api.listDecisions()).find((d) => d.id === q.resulting_decision_id)!;
    expect(decision.source_plenum_id).toBe(plenumId);
    const followUp = (await api.listTasks()).find((t) => t.title === `Folgeaufgabe: ${question.title}`)!;
    expect(followUp.status).toBe('geplant');
    expect(followUp.origin_plenum_id).toBe(plenumId);
    expect(Object.keys(await results())).toEqual(['beschluesse', 'aufgaben', 'fragen']);

    await api.undo(undo_token);
    expect((await api.getQuestion(question.id)).status).toBe('offen');
    expect(await api.listDecisions()).toHaveLength(decisionsBefore);
    expect(await api.listTasks()).toHaveLength(tasksBefore);
    expect(await titles()).toContain(question.title);
    expect((await plenum()).results).toEqual([]);
  });

  it('Klären verlangt eine Antwort', async () => {
    const question = await item('Machen wir an Silvester');
    await expectError(
      api.plenumAction(plenumId, {
        kind: 'question_clarify',
        id: question.id,
        version: question.version,
        answer: '  ',
      }),
      'validation',
    );
  });

  it('Ersetzen: neue Fassung mit diesem Plenum als Quelle, alte ersetzt mit Verweis', async () => {
    const old = await item('Awareness-Team');
    await api.plenumAction(plenumId, {
      kind: 'decision_replace',
      id: old.id,
      version: old.version,
      title: 'Awareness-Team mit mindestens 6 Personen',
    });
    const before = await api.getDecision(old.id);
    expect(before.status).toBe('ersetzt');
    const successor = await api.getDecision(before.superseded_by_id!);
    expect(successor.source_plenum_id).toBe(plenumId);
    expect((await results()).beschluesse).toEqual([
      'Ersetzt: „Awareness-Team mit mindestens 4 Personen“ → „Awareness-Team mit mindestens 6 Personen“',
    ]);
  });

  it('Veranstaltung: Status-Aktion und „Aufgabe dazu anlegen“ – die Veranstaltung bleibt dabei auf der Agenda', async () => {
    const event = await item('Soli-Tresen');
    expect(event.event_status).toBe('in_nachbereitung');
    await api.plenumAction(plenumId, {
      kind: 'sub_task',
      target: 'event',
      id: event.id,
      title: 'Abrechnung an Sporenflug schicken',
    });
    expect(await titles()).toContain(event.title);
    const task = (await api.listTasks()).find((t) => t.title === 'Abrechnung an Sporenflug schicken')!;
    expect(task.status).toBe('geplant');
    expect(task.event_id).toBe(event.id);
    const fresh = await item('Soli-Tresen');
    await api.plenumAction(plenumId, {
      kind: 'event_status',
      id: fresh.id,
      version: fresh.version,
      to: 'abgeschlossen',
    });
    expect(await titles()).not.toContain(event.title);
    expect((await results()).termine).toEqual(['Abgeschlossen: Soli-Tresen Sporenflug']);
  });

  it('Termin verschieben: neues Datum, Länge bleibt, Zusagen und ohne Antwort bekommen eine Nachricht', async () => {
    const appointment = await item('Vorbesprechung');
    const before = await api.getAppointment(appointment.id);
    const { undo_token } = await api.plenumAction(plenumId, {
      kind: 'appointment_move',
      id: appointment.id,
      version: appointment.version,
      starts_at: inDays(30, 18),
    });
    const moved = await api.getAppointment(appointment.id);
    expect(moved.starts_at).toBe(inDays(30, 18));
    expect(await titles()).not.toContain(appointment.title);
    await login('rana');
    expect((await api.demo!.myMessages()).some((m) => m.event_type === 'termin_geaendert')).toBe(true);
    await login('mo');
    await api.undo(undo_token);
    expect((await api.getAppointment(appointment.id)).starts_at).toBe(before.starts_at);
  });

  it('Besprochen: nur die Markierung verschwindet, mit Eintrag in der Historie', async () => {
    const decision = await item('Awareness-Team');
    await api.plenumAction(plenumId, { kind: 'discussed', target: 'decision', id: decision.id });
    const detail = await api.getDecision(decision.id);
    expect(detail.status).toBe('gueltig');
    expect(detail.marked).toBe(false);
    expect(detail.history.some((h) => h.action === 'discussed')).toBe(true);
    expect((await results()).besprochen).toEqual(['Awareness-Team mit mindestens 4 Personen (bestätigt)']);
  });

  it('Rückgängig nach einer Aktion nimmt den Eintrag aus dem Ergebnis', async () => {
    const doc = await item('Hausordnung');
    const { undo_token } = await api.plenumAction(plenumId, {
      kind: 'discussed',
      target: 'document',
      id: doc.id,
    });
    await api.undo(undo_token);
    expect(await titles()).toContain(doc.title);
    expect((await plenum()).results).toEqual([]);
  });
});

describe('+ Hinzufügen (WF-PLE-05)', () => {
  it('Aufgaben und Fragen kommen markiert ans Ende der Agenda, Entscheidungen direkt ins Ergebnis', async () => {
    const topic = (await api.listTopics()).find((t) => t.name === 'Veranstaltungen')!;
    await api.plenumAdd(plenumId, { kind: 'aufgabe', title: 'Getränkepreise festlegen', topic_id: topic.id });
    await api.plenumAdd(plenumId, { kind: 'frage', title: 'Wer macht die Abendkasse?', topic_id: topic.id });
    const { on_agenda } = await api.plenumAdd(plenumId, {
      kind: 'entscheidung',
      title: 'Eintritt Winterrave auf Spende 5–10 €',
      topic_id: topic.id,
    });
    expect(on_agenda).toBe(false);
    expect((await titles()).slice(-2)).toEqual(['Getränkepreise festlegen', 'Wer macht die Abendkasse?']);
    const task = (await api.listTasks()).find((t) => t.title === 'Getränkepreise festlegen')!;
    expect(task.origin_plenum_id).toBe(plenumId);
    expect((await results()).beschluesse).toEqual([
      'Neue Entscheidung: Eintritt Winterrave auf Spende 5–10 €',
    ]);
    const decision = (await api.listDecisions()).find((d) => d.title.startsWith('Eintritt Winterrave'))!;
    expect(decision.source_plenum_id).toBe(plenumId);
  });
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

  it('setzt „abgeschlossen“, hält die Teilnahme fest, schickt die Zusammenfassung an alle; Unbehandeltes bleibt markiert', async () => {
    const type = (await api.listAppointmentTypes()).find((t) => t.label === 'Plenum')!;
    const { id } = await api.createAppointment({
      type_id: type.id,
      title: 'Plenum Sondersitzung',
      starts_at: inDays(0, 10),
      format: 'online',
      online_url: 'https://meet.example.org/myzel',
    });
    plenumId = id;
    const doc = await item('Hausordnung');
    await api.plenumAction(plenumId, { kind: 'discussed', target: 'document', id: doc.id });
    const left = (await titles()).length;
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
    expect(await titles()).toHaveLength(left);
    await login('jule');
    const summary = (await api.demo!.myMessages()).find((m) => m.event_type === 'plenum_zusammenfassung')!;
    expect(summary.text).toContain('Besprochen: Hausordnung Lager');
    // danach gehen keine Agenda-Aktionen mehr
    const next = await item('Location');
    await expectError(api.plenumAction(plenumId, { kind: 'discussed', target: 'task', id: next.id }), 'rule');
  });
});

describe('Befunde aus dem Review (18.10.2026)', () => {
  const startedPlenum = async () => {
    const type = (await api.listAppointmentTypes()).find((t) => t.label === 'Plenum')!;
    const { id } = await api.createAppointment({
      type_id: type.id,
      title: 'Plenum Sondersitzung',
      starts_at: inDays(0, 10),
      format: 'online',
      online_url: 'https://meet.example.org/myzel',
    });
    return id;
  };

  it('nach dem Abschluss lässt sich eine Agenda-Aktion nicht mehr zurücknehmen', async () => {
    plenumId = await startedPlenum();
    const doc = await item('Hausordnung');
    const { undo_token } = await api.plenumAction(plenumId, {
      kind: 'discussed',
      target: 'document',
      id: doc.id,
    });
    await api.closePlenum(plenumId, [], (await plenum()).version);
    await expectError(api.undo(undo_token), 'rule');
    expect((await plenum()).results).toHaveLength(1);
  });

  it('„Blockade lösen → In Arbeit“ trägt die Person an der Agenda nicht ein', async () => {
    const flyer = await item('Flyer');
    const before = (await api.getTask(flyer.id)).assignee_ids;
    await api.plenumAction(plenumId, {
      kind: 'task_unblock',
      id: flyer.id,
      version: flyer.version,
      to: 'in_arbeit',
    });
    expect((await api.getTask(flyer.id)).assignee_ids).toEqual(before);
  });

  it('Ersetzen übernimmt den Text der neuen Fassung', async () => {
    const old = await item('Awareness-Team');
    await api.plenumAction(plenumId, {
      kind: 'decision_replace',
      id: old.id,
      version: old.version,
      title: 'Awareness-Team mit mindestens 6 Personen',
      description: 'Bei Partys ab 200 Gästen.',
    });
    const successor = await api.getDecision((await api.getDecision(old.id)).superseded_by_id!);
    expect(successor.description).toBe('Bei Partys ab 200 Gästen.');
  });

  it('eine inzwischen weiterverwendete neue Fassung verschwindet nicht durch „Rückgängig“', async () => {
    const old = await item('Awareness-Team');
    const { undo_token } = await api.plenumAction(plenumId, {
      kind: 'decision_replace',
      id: old.id,
      version: old.version,
      title: 'Awareness-Team mit mindestens 6 Personen',
    });
    const successorId = (await api.getDecision(old.id)).superseded_by_id!;
    await api.setMark('decision', successorId, true);
    await expectError(api.undo(undo_token), 'rule');
    expect((await api.getDecision(successorId)).status).toBe('gueltig');
  });

  it('die Ergebniszeile nennt alle Bearbeitenden', async () => {
    const location = await item('Location');
    await api.plenumAction(plenumId, {
      kind: 'task_finish',
      id: location.id,
      version: location.version,
      to: 'erledigt',
    });
    const names = (await api.getTask(location.id)).assignee_ids.length;
    expect(names).toBeGreaterThan(0);
    expect((await results()).aufgaben![0]).toMatch(/^Erledigt: Location für Winterrave bestätigen · \S/);
  });
});
