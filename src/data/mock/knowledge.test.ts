// Phase 3 – Wissen: Entscheidungen mit Pflicht-Quelle, Ersetzen ohne Zyklen, Fragen klären, Dokumente, Suche
// Mit MYZEL_API=server laufen dieselben Tests gegen die echten Server-Funktionen auf PGlite (Schritt C, Phase 3).
import { beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../../shared/errors';
import { canSupersede, sortQuestions } from '../../shared/rules/knowledge';
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
const topic = async (name: string) => (await api.listTopics()).find((t) => t.name === name)!.id;
const decision = async (title: string) => (await api.listDecisions()).find((d) => d.title === title)!;
const question = async (title: string) => (await api.listQuestions()).find((q) => q.title.startsWith(title))!;
const plenum = async (title: string) => (await api.listAppointments()).find((a) => a.title === title)!;

beforeEach(async () => {
  const clock = new Date(2026, 9, 11, 12, 0, 0);
  api =
    process.env.MYZEL_API === 'server'
      ? await (await import('../../../server/api/serverApi')).createServerApi({ now: () => clock })
      : createMockApi({ storage: memoryStorage(), now: () => clock });
  await login('mo');
});

describe('Entscheidungen und Fakten (3.8, 4.5)', () => {
  it('lassen sich ohne Quelle nicht speichern', async () => {
    const base = {
      title: 'Neue Regel',
      kind: 'entscheidung' as const,
      topic_id: await topic('Organisatorisches'),
    };
    await expectError(api.createDecision(base), 'validation', 'source');
    await expectError(api.createDecision({ ...base, source_note: '   ' }), 'validation', 'source');
    // als Plenum-Quelle zählt nur ein Plenum-Termin (7.2)
    const bautag = await plenum('Bautag Oktober');
    await expectError(api.createDecision({ ...base, source_plenum_id: bautag.id }), 'validation', 'source');
    const { id } = await api.createDecision({ ...base, source_note: 'Absprache' });
    const created = await api.getDecision(id);
    expect([created.status, created.decided_on, created.source_label]).toEqual([
      'gueltig',
      '2026-10-11',
      'Notiz',
    ]);
  });

  it('ersetzen: neue Fassung anlegen, alte verweist darauf – in einem Schritt, mit Rückgängig', async () => {
    const old = await decision('Awareness-Team mit mindestens 4 Personen');
    expect(old.marked).toBe(true);
    await expectError(
      api.replaceDecision(old.id, { title: 'Ohne Quelle', version: old.version }),
      'validation',
      'source',
    );
    expect((await api.getDecision(old.id)).status).toBe('gueltig');

    const { undo_token, successor_id } = await api.replaceDecision(old.id, {
      title: 'Awareness-Team mit mindestens 5 Personen',
      source_note: 'Umfrage',
      version: old.version,
    });
    const replaced = await api.getDecision(old.id);
    expect([replaced.status, replaced.superseded_by_id, replaced.marked]).toEqual([
      'ersetzt',
      successor_id,
      false,
    ]);
    expect((await api.getDecision(successor_id)).replaces.map((r) => r.id)).toEqual([old.id]);
    await expectError(
      api.replaceDecision(old.id, { title: 'x', source_note: 'y', version: replaced.version }),
      'rule',
    );

    await api.undo(undo_token);
    const back = await api.getDecision(old.id);
    expect([back.status, back.superseded_by_id, back.marked]).toEqual(['gueltig', null, true]);
    expect((await api.listDecisions()).some((d) => d.id === successor_id)).toBe(false);
  });

  it('ersetzen durch eine vorhandene: Ziel muss gültig sein, keine Zyklen', async () => {
    const a = await decision('Eintritt immer auch auf Spendenbasis möglich');
    const alt = (await api.listDecisions()).find((d) => d.title === 'Mate am Tresen für 2 €')!;
    const aufgehoben = (await api.listDecisions()).find((d) => d.status === 'aufgehoben')!;
    await expectError(
      api.replaceDecision(a.id, { successor_id: a.id, version: a.version }),
      'validation',
      'successor_id',
    );
    await expectError(
      api.replaceDecision(a.id, { successor_id: alt.id, version: a.version }),
      'validation',
      'successor_id',
    );
    await expectError(
      api.replaceDecision(a.id, { successor_id: aufgehoben.id, version: a.version }),
      'validation',
      'successor_id',
    );
    const b = await decision('Mate am Tresen für 2,50 €');
    await api.replaceDecision(a.id, { successor_id: b.id, version: a.version });
    expect((await api.getDecision(a.id)).superseded_by_title).toBe('Mate am Tresen für 2,50 €');
  });

  it('erkennt Kreise in der Kette der Nachfolgerinnen', () => {
    const chain = [
      { id: 'a', status: 'ersetzt' as const, superseded_by_id: 'b' },
      { id: 'b', status: 'gueltig' as const, superseded_by_id: null },
      { id: 'c', status: 'gueltig' as const, superseded_by_id: null },
    ];
    expect(canSupersede(chain, 'c', 'b')).toBeNull();
    expect(canSupersede(chain, 'b', 'a')).toMatch(/gültig/);
    expect(
      canSupersede(
        [
          { id: 'x', status: 'gueltig', superseded_by_id: 'y' },
          { id: 'y', status: 'gueltig', superseded_by_id: null },
        ],
        'y',
        'x',
      ),
    ).toMatch(/Kreis/);
  });

  it('aufheben und markieren gehen nur bei gültigen Einträgen', async () => {
    const d = await decision('Unser Code of Conduct gilt für alle Veranstaltungen');
    await api.setMark('decision', d.id, true);
    await api.revokeDecision(d.id, 'veraltet', d.version);
    const revoked = await api.getDecision(d.id);
    expect([revoked.status, revoked.marked]).toEqual(['aufgehoben', false]);
    await expectError(api.revokeDecision(d.id, null, revoked.version), 'rule');
    await expectError(api.setMark('decision', d.id, true), 'rule');
    await expectError(
      api.revokeDecision((await decision('Mate am Tresen für 2,50 €')).id, null, 99),
      'conflict',
    );
  });
});

describe('Offene Fragen (3.7, 4.4)', () => {
  it('werden nach Dringlichkeit und Alter sortiert und sind beim Anlegen fürs Plenum vorausgewählt', async () => {
    expect(
      sortQuestions([
        { urgency: 'niedrig', created_at: '2026-01-01' },
        { urgency: 'hoch', created_at: '2026-03-01' },
        { urgency: 'hoch', created_at: '2026-02-01' },
      ]).map((q) => q.created_at),
    ).toEqual(['2026-02-01', '2026-03-01', '2026-01-01']);
    await expectError(
      api.createQuestion({ title: ' ', topic_id: await topic('Organisatorisches') }),
      'validation',
      'title',
    );
    const { id } = await api.createQuestion({
      title: 'Wer hat den Zweitschlüssel?',
      topic_id: await topic('Lager & Material'),
    });
    const q = await api.getQuestion(id);
    expect([q.status, q.urgency, q.marked]).toEqual(['offen', 'mittel', true]);
  });

  it('klären verlangt eine Antwort; als Entscheidung braucht es außerhalb des Plenums eine Quelle', async () => {
    const q = await question('Machen wir an Silvester');
    await expectError(
      api.clarifyQuestion(q.id, { answer: '  ', version: q.version }),
      'validation',
      'answer',
    );
    await expectError(
      api.clarifyQuestion(q.id, { answer: 'Ja', result: 'entscheidung', version: q.version }),
      'validation',
      'source',
    );
    expect((await api.getQuestion(q.id)).status).toBe('offen');
    expect((await api.listDecisions()).some((d) => d.title === q.title)).toBe(false);

    const { undo_token, decision_id } = await api.clarifyQuestion(q.id, {
      answer: 'Ja – kleine Party im Lager.',
      result: 'entscheidung',
      source_note: 'Abstimmung im Chat',
      version: q.version,
    });
    const done = await api.getQuestion(q.id);
    expect([done.status, done.marked, done.resulting_decision?.id]).toEqual(['geklaert', false, decision_id]);
    expect((await api.getDecision(decision_id!)).description).toBe('Ja – kleine Party im Lager.');
    await expectError(api.clarifyQuestion(q.id, { answer: 'nochmal', version: done.version }), 'rule');

    await api.undo(undo_token);
    const back = await api.getQuestion(q.id);
    expect([back.status, back.answer, back.marked, back.resulting_decision]).toEqual([
      'offen',
      null,
      true,
      null,
    ]);
    expect((await api.listDecisions()).some((d) => d.id === decision_id)).toBe(false);
  });

  it('verwerfen geht nur bei offenen Fragen', async () => {
    const q = await question('Wechseln wir zu einer anderen Bank');
    await api.discardQuestion(q.id, q.version);
    const discarded = await api.getQuestion(q.id);
    expect(discarded.status).toBe('verworfen');
    await expectError(api.discardQuestion(q.id, discarded.version), 'rule');
    await expectError(api.setMark('question', q.id, true), 'rule');
  });
});

describe('Dokumente (3.9)', () => {
  it('per Link erfassen: Titel, gültiger Link und Typ sind Pflicht; Verknüpfung steht in der Historie', async () => {
    const task = (await api.listTasks()).find((t) => t.title.startsWith('Getränke'))!;
    const base = {
      title: 'Angebot Brauerei',
      url: 'https://example.org/angebot.pdf',
      doc_type: 'sonstiges' as const,
    };
    await expectError(api.createDocument({ ...base, url: 'javascript:alert(1)' }), 'validation', 'url');
    await expectError(api.createDocument({ ...base, title: '' }), 'validation', 'title');
    const { id } = await api.createDocument({
      ...base,
      tags: ['angebot', 'angebot'],
      link: { target_type: 'task', target_id: task.id },
    });
    expect((await api.listLinkedDocuments('task', task.id)).map((d) => d.id)).toEqual([id]);
    const doc = (await api.listDocuments()).find((d) => d.id === id)!;
    expect([doc.link_summary, doc.tags]).toEqual(['1 Aufgabe', ['angebot']]);
    expect((await api.getTask(task.id)).history[0]!.action).toBe('document_linked');
    await api.linkDocument(id, 'task', task.id);
    expect(await api.listLinkedDocuments('task', task.id)).toHaveLength(1);
    await api.unlinkDocument(id, 'task', task.id);
    expect((await api.listDocuments()).find((d) => d.id === id)!.link_summary).toBe('nicht verknüpft');
  });
});

describe('Markierung „Fürs Plenum“ an Veranstaltungen (WF-VER-06)', () => {
  it('nicht bei abgeschlossen/abgesagt; Statuswechsel entfernt sie', async () => {
    const events = await api.listEvents();
    const rave = events.find((e) => e.title === 'Winterrave')!;
    await api.setMark('event', rave.id, true);
    expect((await api.getEvent(rave.id)).marked).toBe(true);
    await api.setEventStatus(rave.id, 'bestaetigt', rave.version);
    expect((await api.getEvent(rave.id)).marked).toBe(false);
    await expectError(api.setMark('event', events.find((e) => e.title === 'Hoffest')!.id, true), 'rule');
  });
});

describe('Globale Suche (F-WIS-06)', () => {
  it('durchsucht nur App-Daten und gruppiert nach Art', async () => {
    expect(await api.search('W')).toEqual([]);
    const groups = await api.search('winterrave');
    expect(groups.map((g) => g.key)).toEqual(['aufgaben', 'events', 'termine', 'fragen', 'dokumente']);
    expect(groups.find((g) => g.key === 'events')!.items[0]!.link).toMatch(/^\/events\//);
    expect((await api.search('Spendenbasis')).map((g) => g.key)).toEqual(['beschluesse']);
  });

  it('gibt ohne Mitgliedschaft nichts heraus', async () => {
    await login('jemand');
    await expectError(api.search('winterrave'), 'unauthenticated');
  });
});
