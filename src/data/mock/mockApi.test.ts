// Die Testdaten-Schicht wendet die Regeln wirklich an (Abschnitt 10, Schritt A):
// Pflichtfelder, verbotene Übergänge, Rückgängig, Versionskonflikt, Aufräumen beim Deaktivieren.
// Mit MYZEL_API=server laufen dieselben Tests gegen die echten Server-Funktionen auf PGlite (Schritt C, Phase 1) –
// so verhalten sich beide Schichten nachweislich gleich. Nur was es allein in der Testdaten-Schicht gibt
// (Speicher im Browser, zweiter Tab), läuft dann nicht.
import { beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../../shared/errors';
import { taskHistorySentence } from '../../shared/historyText';
import type { MyzelApi, TaskDetail } from '../api';
import { createMockApi, type KeyValueStorage } from './mockApi';

function memoryStorage(): KeyValueStorage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const SERVER = process.env.MYZEL_API === 'server';
const onlyMock = it.skipIf(SERVER);
let api: MyzelApi;
let clock: Date;
let storage: KeyValueStorage;
const mail = (name: string) => `${name}@example.org`;
const login = (name: string) => api.demo!.signInAs(mail(name));

async function expectError(promise: Promise<unknown>, code: AppError['code'], field?: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  if (field) expect((error as AppError).field).toBe(field);
  return error as AppError;
}

async function ids() {
  const [members, topics, tasks, events] = await Promise.all([
    api.listMembers(),
    api.listTopics(),
    api.listTasks(),
    api.listEvents(),
  ]);
  return {
    member: (name: string) => members.find((m) => m.display_name === name)!,
    topic: (name: string) => topics.find((t) => t.name === name)!,
    task: (title: string) => tasks.find((t) => t.title.startsWith(title))!,
    event: (title: string) => events.find((e) => e.title === title)!,
  };
}

async function newTask(overrides: Record<string, unknown> = {}): Promise<TaskDetail> {
  const { topic } = await ids();
  const { id } = await api.createTask({
    title: 'Nebelfluid nachbestellen',
    topic_id: topic('Lager & Material').id,
    ...overrides,
  });
  return api.getTask(id);
}

beforeEach(async () => {
  clock = new Date(2026, 9, 11, 12, 0, 0);
  storage = memoryStorage();
  api = SERVER
    ? await (await import('../../../server/api/serverApi')).createServerApi({ now: () => clock })
    : createMockApi({ storage, now: () => clock });
  await login('mo');
});

describe('Anmeldung (WF-LOG-01 bis -03)', () => {
  it('lässt nur aktive Mitglieder rein', async () => {
    expect((await login('lea')).state).toBe('member');
    expect(await login('jemand')).toEqual({ state: 'no_access', email: mail('jemand') });
    expect((await login('tarek')).state).toBe('no_access');
  });

  it('gibt ohne Mitgliedschaft keine Daten heraus', async () => {
    await login('jemand');
    await expectError(api.listTasks(), 'unauthenticated');
    await expectError(api.createTask({ title: 'x', topic_id: crypto.randomUUID() }), 'unauthenticated');
  });

  onlyMock('behält die Sitzung über einen Neustart und beendet sie beim Abmelden', async () => {
    const reopened = createMockApi({ storage, now: () => clock });
    expect((await reopened.getSession()).state).toBe('member');
    await reopened.signOut();
    expect((await reopened.getSession()).state).toBe('anonymous');
  });

  it('antwortet beim Mail-Link immer gleich und meldet erst über den Link an', async () => {
    await api.signOut();
    await expect(api.requestMagicLink('Jule@Example.org')).resolves.toBeUndefined();
    expect((await api.getSession()).state).toBe('anonymous');
    expect((await api.demo!.openMagicLink()).state).toBe('member');
    await api.signOut();
    await expect(api.requestMagicLink(mail('unbekannt'))).resolves.toBeUndefined();
    expect((await api.demo!.openMagicLink()).state).toBe('no_access');
    await expectError(api.requestMagicLink('keine-mail'), 'validation', 'email');
  });

  it('macht ein neu angelegtes Mitglied sofort anmeldbar', async () => {
    await api.createMember({ display_name: 'Zora', short: 'zo', email: 'Zora@Example.org' });
    const session = await login('zora');
    expect(session.state === 'member' && session.member.short).toBe('ZO');
  });
});

describe('Aufgabe anlegen (WF-AUF-03)', () => {
  it('verlangt Titel und Thema', async () => {
    const { topic } = await ids();
    await expectError(api.createTask({ title: '  ', topic_id: topic('Verein').id }), 'validation', 'title');
    await expectError(api.createTask({ title: 'Ohne Thema', topic_id: '' }), 'validation', 'topic_id');
    await expectError(
      api.createTask({ title: 'Altes Thema', topic_id: topic('Alte Location').id }),
      'validation',
      'topic_id',
    );
  });

  it('legt im Status neu an, Anlegende folgt', async () => {
    const me = (await ids()).member('Mo');
    const task = await newTask();
    expect(task.status).toBe('neu');
    expect(task.priority).toBe('mittel');
    expect(task.follower_ids).toEqual([me.id]);
    expect(task.assignee_ids).toEqual([]);
  });

  it('trägt bei „Ich übernehme das“ nur ein – der Status bleibt neu', async () => {
    const me = (await ids()).member('Mo');
    const task = await newTask({ assign_self: true });
    expect(task.status).toBe('neu');
    expect(task.assignee_ids).toEqual([me.id]);
  });

  it('vergibt fortlaufende Nummern', async () => {
    const a = await newTask();
    const b = await newTask();
    expect(b.number).toBe(a.number + 1);
  });
});

describe('Status (WF-AUF-06 bis -09)', () => {
  it('blockiert nicht ohne Grund – auch nicht mit Leerzeichen', async () => {
    const task = await newTask();
    await expectError(
      api.setTaskStatus(task.id, { status: 'blockiert', version: 1 }),
      'validation',
      'block_reason',
    );
    await expectError(
      api.setTaskStatus(task.id, { status: 'blockiert', block_reason: '   ', version: 1 }),
      'validation',
      'block_reason',
    );
    expect((await api.getTask(task.id)).status).toBe('neu');
  });

  it('lehnt verbotene Übergänge ab', async () => {
    const task = await newTask();
    await api.setTaskStatus(task.id, { status: 'geplant', version: 1 });
    await expectError(api.setTaskStatus(task.id, { status: 'neu', version: 2 }), 'rule');
    await api.setTaskStatus(task.id, { status: 'erledigt', version: 2 });
    await expectError(
      api.setTaskStatus(task.id, { status: 'blockiert', block_reason: 'x', version: 3 }),
      'rule',
    );
    await expectError(api.setTaskStatus(task.id, { status: 'verworfen', version: 3 }), 'rule');
  });

  it('„In Arbeit“ trägt niemanden von selbst ein (Phase 9)', async () => {
    const me = (await ids()).member('Mo');
    const task = await newTask();
    await api.setTaskStatus(task.id, { status: 'in_arbeit', version: 1 });
    const after = await api.getTask(task.id);
    expect([after.status, after.assignee_ids, after.version]).toEqual(['in_arbeit', [], 2]);
    expect(after.follower_ids).toContain(me.id);
  });

  it('speichert den Blockade-Grund und leert ihn beim Lösen', async () => {
    const task = await newTask();
    await api.setTaskStatus(task.id, { status: 'blockiert', block_reason: ' Adresse fehlt ', version: 1 });
    expect((await api.getTask(task.id)).block_reason).toBe('Adresse fehlt');
    await api.setTaskStatus(task.id, { status: 'geplant', version: 2 });
    const after = await api.getTask(task.id);
    expect(after.block_reason).toBeNull();
    const look = { memberName: () => 'Mo', topicName: () => '', eventTitle: () => '', taskTitle: () => '' };
    expect(after.history.map((h) => taskHistorySentence(h, look))).toContain(
      'Mo hat den Status von Neu auf Blockiert geändert. Grund: Adresse fehlt',
    );
  });

  it('blockiert ohne Grund, wenn auf eine andere Aufgabe gewartet wird – die letzte Abhängigkeit bleibt dann', async () => {
    const task = await newTask({ title: 'Wartet' });
    const other = await newTask({ title: 'Vorher' });
    await expectError(
      api.setTaskStatus(task.id, { status: 'blockiert', version: 1 }),
      'validation',
      'block_reason',
    );
    await api.setTaskStatus(task.id, { status: 'blockiert', blocker_ids: [other.id], version: 1 });
    const blocked = await api.getTask(task.id);
    expect(blocked).toMatchObject({ status: 'blockiert', block_reason: null });
    // ohne Grund hält nur die Abhängigkeit die Blockade
    await expectError(api.removeBlocker(task.id, other.id), 'rule');
    await api.setTaskStatus(task.id, { status: 'geplant', version: blocked.version });
    await api.removeBlocker(task.id, other.id);
    // eine schon eingetragene Abhängigkeit genügt ebenfalls
    await api.addBlocker(task.id, other.id);
    await api.setTaskStatus(task.id, { status: 'blockiert', version: (await api.getTask(task.id)).version });
    expect((await api.getTask(task.id)).status).toBe('blockiert');
  });

  it('verhindert Selbstbezug und Zyklen bei blockierenden Aufgaben', async () => {
    const a = await newTask({ title: 'A' });
    const b = await newTask({ title: 'B' });
    await expectError(
      api.setTaskStatus(a.id, { status: 'blockiert', block_reason: 'x', blocker_ids: [a.id], version: 1 }),
      'rule',
    );
    expect((await api.getTask(a.id)).status).toBe('neu');
    await api.setTaskStatus(a.id, {
      status: 'blockiert',
      block_reason: 'wartet auf B',
      blocker_ids: [b.id],
      version: 1,
    });
    expect((await api.getTask(a.id)).blockers.map((x) => x.title)).toEqual(['B']);
    await expectError(api.addBlocker(b.id, a.id), 'rule');
    expect((await api.getTask(b.id)).blockers).toEqual([]);
  });

  it('öffnet erledigte und verworfene wieder und leert den Verwerfen-Grund', async () => {
    const task = await newTask();
    await api.setTaskStatus(task.id, {
      status: 'verworfen',
      discard_reason: 'macht die Druckerei',
      version: 1,
    });
    expect((await api.getTask(task.id)).discard_reason).toBe('macht die Druckerei');
    await api.setTaskStatus(task.id, { status: 'geplant', version: 2 });
    const after = await api.getTask(task.id);
    expect(after.status).toBe('geplant');
    expect(after.discard_reason).toBeNull();
  });
});

describe('Bearbeitende und Folgende (WF-AUF-10, -11)', () => {
  it('trägt zwei gleichzeitige Einträge beide ein', async () => {
    const { member } = await ids();
    const task = await newTask();
    // beide kennen nur den Stand vor dem jeweils anderen Eintrag
    await api.addAssignee(task.id, member('Lea').id);
    await api.addAssignee(task.id, member('Jule').id);
    const after = await api.getTask(task.id);
    expect(after.assignee_ids).toEqual([member('Lea').id, member('Jule').id]);
    expect(after.follower_ids).toEqual(expect.arrayContaining([member('Lea').id, member('Jule').id]));
  });

  it('selbst folgen und entfolgen stehen nicht in der Historie, auch nicht ihr Rückgängig', async () => {
    const { member } = await ids();
    const task = await newTask();
    const me = member('Mo').id;
    const before = (await api.getTask(task.id)).history.length;
    if ((await api.getTask(task.id)).follower_ids.includes(me)) await api.removeFollower(task.id, me);
    const { undo_token } = await api.addFollower(task.id, me);
    await api.undo(undo_token);
    expect((await api.getTask(task.id)).history).toHaveLength(before);
    // eine andere Person einzutragen bleibt sichtbar
    await api.addFollower(task.id, member('Lea').id);
    expect((await api.getTask(task.id)).history[0]!.action).toBe('follower_added');
  });

  it('lässt nur aktive Mitglieder zu', async () => {
    const { member } = await ids();
    const task = await newTask();
    await expectError(api.addAssignee(task.id, member('Tarek').id), 'rule');
    await expectError(api.addFollower(task.id, member('Myzel (automatisch)').id), 'rule');
  });

  it('setzt „In Arbeit“ auf „Geplant“ zurück, wenn die letzte Person geht', async () => {
    const me = (await ids()).member('Mo');
    const task = await newTask();
    await api.addAssignee(task.id, me.id);
    await api.setTaskStatus(task.id, { status: 'in_arbeit', version: 2 });
    const result = await api.removeAssignee(task.id, me.id);
    expect(result.status_reset).toBe(true);
    expect((await api.getTask(task.id)).status).toBe('geplant');
  });
});

describe('Rückgängig (WF-ALL-02)', () => {
  it('nimmt einen Statuswechsel vollständig zurück – auch zurück zu „neu“', async () => {
    const task = await newTask();
    const { undo_token } = await api.setTaskStatus(task.id, { status: 'in_arbeit', version: 1 });
    await api.undo(undo_token);
    const after = await api.getTask(task.id);
    expect(after.status).toBe('neu');
    expect(after.assignee_ids).toEqual([]);
    expect(after.history[0]!.action).toBe('undo');
    // was zurückgesetzt wurde, steht als alt → neu in der Historie (3.10)
    expect(after.history[0]!.changes.status).toEqual({ old: 'in_arbeit', new: 'neu' });
  });

  it('stellt nach „Blockiert“ Grund und Abhängigkeit wieder her', async () => {
    const { task } = await ids();
    const flyer = await api.getTask(task('Flyer').id);
    const { undo_token } = await api.setTaskStatus(flyer.id, { status: 'geplant', version: flyer.version });
    expect((await api.getTask(flyer.id)).block_reason).toBeNull();
    await api.undo(undo_token);
    const after = await api.getTask(flyer.id);
    expect(after.status).toBe('blockiert');
    expect(after.block_reason).toBe(flyer.block_reason);
  });

  it('gilt nur kurz, nur einmal und nur für die Person selbst', async () => {
    const task = await newTask();
    const lea = (await ids()).member('Lea');
    const first = await api.addFollower(task.id, lea.id);
    await api.undo(first.undo_token);
    await expectError(api.undo(first.undo_token), 'rule');
    const second = await api.addFollower(task.id, lea.id);
    await login('lea');
    await expectError(api.undo(second.undo_token), 'rule');
    await login('mo');
    clock = new Date(clock.getTime() + 60_000);
    await expectError(api.undo(second.undo_token), 'rule');
  });

  it('stellt „In Arbeit“ nicht ohne Bearbeitende wieder her', async () => {
    const { member } = await ids();
    const jule = member('Jule');
    const task = await newTask();
    await api.addAssignee(task.id, jule.id);
    await api.setTaskStatus(task.id, { status: 'in_arbeit', version: (await api.getTask(task.id)).version });
    await api.removeAssignee(task.id, (await ids()).member('Mo').id);
    const { undo_token } = await api.removeAssignee(task.id, jule.id);
    expect((await api.getTask(task.id)).status).toBe('geplant');
    await api.deactivateMember(jule.id);
    await expectError(api.undo(undo_token), 'rule');
    expect((await api.getTask(task.id)).status).toBe('geplant');
  });

  it('überschreibt keine Änderung, die inzwischen jemand anderes gemacht hat', async () => {
    const task = await newTask();
    const { undo_token } = await api.setTaskStatus(task.id, { status: 'geplant', version: 1 });
    await api.demo!.simulateForeignEdit(task.id);
    await expectError(api.undo(undo_token), 'conflict');
    expect((await api.getTask(task.id)).status).toBe('geplant');
  });
});

describe('Versionskonflikt (WF-ALL-01)', () => {
  it('speichert nichts und nennt, wer inzwischen geändert hat', async () => {
    const task = await newTask();
    await api.demo!.simulateForeignEdit(task.id);
    const error = await expectError(
      api.updateTaskFields(task.id, { title: 'Neu' }, task.version),
      'conflict',
    );
    expect(error.conflict?.changed_by_name).toBe('Lea');
    await expectError(api.updateTaskDescription(task.id, 'Text', task.version), 'conflict');
    await expectError(api.setTaskStatus(task.id, { status: 'geplant', version: task.version }), 'conflict');
    await expectError(api.archiveTask(task.id, task.version), 'conflict');
    const after = await api.getTask(task.id);
    expect(after.title).toBe(task.title);
    expect(after.status).toBe('neu');
  });
});

describe('Netzfehler (WF-ALL-03)', () => {
  it('ändert nichts und klappt beim nächsten Versuch', async () => {
    const task = await newTask();
    api.demo!.failNextWrites(1);
    await expectError(api.updateTaskDescription(task.id, 'Text', 1), 'network');
    expect((await api.getTask(task.id)).description).toBeNull();
    await api.updateTaskDescription(task.id, 'Text', 1);
    expect((await api.getTask(task.id)).description).toBe('Text');
  });
});

describe('Bearbeiten, Kommentare, Archiv (WF-AUF-04, -05, -12, -14)', () => {
  it('wer bearbeitet oder kommentiert, folgt automatisch', async () => {
    const { member } = await ids();
    const task = await newTask();
    await login('lea');
    await api.updateTaskFields(task.id, { priority: 'hoch' }, 1);
    await login('jule');
    const comment = await api.addComment('task', task.id, 'Bin dabei');
    expect(comment.now_following).toBe(true);
    const after = await api.getTask(task.id);
    expect(after.follower_ids).toEqual([member('Mo').id, member('Lea').id, member('Jule').id]);
    expect(after.comment_count).toBe(1);
  });

  it('lässt nur eigene Kommentare bearbeiten und keine leeren zu', async () => {
    const task = await newTask();
    const { id } = await api.addComment('task', task.id, 'Erster');
    await expectError(api.addComment('task', task.id, '   '), 'validation');
    await api.updateComment(id, 'Erster, korrigiert');
    await login('lea');
    await expectError(api.updateComment(id, 'Gekapert'), 'forbidden');
    const after = await api.getTask(task.id);
    expect(after.comments[0]!.body).toBe('Erster, korrigiert');
    // Text alt → neu in der Historie (3.10)
    expect(after.history.find((h) => h.action === 'comment_edited')!.changes.body).toEqual({
      old: 'Erster',
      new: 'Erster, korrigiert',
    });
  });

  it('archiviert statt zu löschen und stellt wieder her', async () => {
    const task = await newTask();
    await api.archiveTask(task.id, 1);
    expect((await api.listTasks()).some((t) => t.id === task.id)).toBe(false);
    const archived = await api.getTask(task.id);
    expect(archived.archived_at).not.toBeNull();
    await expectError(api.updateTaskFields(task.id, { title: 'x' }, archived.version), 'rule');
    await api.restoreTask(task.id, archived.version);
    expect((await api.listTasks()).some((t) => t.id === task.id)).toBe(true);
  });

  it('schreibt jede Änderung mit Person und Zeit in die Historie', async () => {
    const { member, topic } = await ids();
    const task = await newTask();
    await api.updateTaskFields(task.id, { title: 'Nebelfluid bestellen', due_date: '2026-10-20' }, 1);
    await api.addAssignee(task.id, member('Sam').id);
    const detail = await api.getTask(task.id);
    const look = {
      memberName: (id: string) => [member('Mo'), member('Sam')].find((m) => m.id === id)!.display_name,
      topicName: () => topic('Lager & Material').name,
      eventTitle: () => '',
      taskTitle: () => '',
    };
    expect(detail.history.map((h) => taskHistorySentence(h, look)).reverse()).toEqual([
      'Mo hat die Aufgabe angelegt.',
      'Mo hat den Titel von „Nebelfluid nachbestellen“ auf „Nebelfluid bestellen“ geändert. Mo hat die Frist auf 20.10. gesetzt.',
      'Mo hat Sam zugewiesen.',
    ]);
    expect(detail.history.every((h) => h.actor_member_id === member('Mo').id && h.created_at)).toBe(true);
  });
});

describe('Veranstaltungen (WF-VER-02 bis -04)', () => {
  const start = '2027-03-20T19:00:00.000Z';

  it('legt als Idee an und verlangt Titel, Art und Beginn', async () => {
    const { id } = await api.createEvent({ title: 'Frühlingsfest', type: 'party', starts_at: start });
    expect((await api.getEvent(id)).status).toBe('idee');
    await expectError(api.createEvent({ title: '', type: 'party', starts_at: start }), 'validation', 'title');
    await expectError(
      api.createEvent({ title: 'x', type: 'party', starts_at: '' }),
      'validation',
      'starts_at',
    );
  });

  it('lehnt ein Ende vor dem Beginn ab', async () => {
    await expectError(
      api.createEvent({ title: 'x', type: 'party', starts_at: start, ends_at: '2027-03-20T18:00:00.000Z' }),
      'validation',
      'ends_at',
    );
  });

  it('erlaubt nur den nächsten Schritt oder die Absage, mit Rückgängig', async () => {
    const { id } = await api.createEvent({ title: 'Frühlingsfest', type: 'party', starts_at: start });
    await expectError(api.setEventStatus(id, 'bestaetigt', 1), 'rule');
    const { undo_token } = await api.setEventStatus(id, 'in_planung', 1);
    await api.undo(undo_token);
    expect((await api.getEvent(id)).status).toBe('idee');
    const event = await api.getEvent(id);
    await api.setEventStatus(id, 'abgesagt', event.version);
    await expectError(api.setEventStatus(id, 'in_planung', event.version + 1), 'rule');
  });

  it('bearbeitet Basisfelder mit Versionsprüfung und lehnt ein Ende vor dem Beginn ab', async () => {
    const { id } = await api.createEvent({ title: 'Frühlingsfest', type: 'party', starts_at: start });
    const fields = { title: 'Frühlingsfest im Hof', type: 'workshop' as const, starts_at: start };
    await expectError(
      api.updateEvent(id, { ...fields, ends_at: '2027-03-20T18:00:00.000Z', version: 1 }),
      'validation',
      'ends_at',
    );
    await api.updateEvent(id, { ...fields, version: 1 });
    const event = await api.getEvent(id);
    expect([event.title, event.type, event.version]).toEqual(['Frühlingsfest im Hof', 'workshop', 2]);
    // veraltete version: nichts wird überschrieben
    await expectError(api.updateEvent(id, { ...fields, title: 'Alt', version: 1 }), 'conflict');
    await expectError(api.setEventStatus(id, 'in_planung', 1), 'conflict');
    expect((await api.getEvent(id)).title).toBe('Frühlingsfest im Hof');
  });

  it('nimmt einen Statuswechsel nicht zurück, wenn inzwischen jemand geändert hat', async () => {
    const { id } = await api.createEvent({ title: 'Frühlingsfest', type: 'party', starts_at: start });
    const { undo_token } = await api.setEventStatus(id, 'in_planung', 1);
    await login('lea');
    await api.updateEvent(id, { title: 'Hoffrühling', type: 'party', starts_at: start, version: 2 });
    await login('mo');
    await expectError(api.undo(undo_token), 'conflict');
    expect((await api.getEvent(id)).status).toBe('in_planung');
  });

  onlyMock('teilt den Stand mit einem zweiten Tab und erkennt dessen Änderungen', async () => {
    const { id } = await api.createEvent({ title: 'Frühlingsfest', type: 'party', starts_at: start });
    const otherTab = createMockApi({ storage, now: () => clock });
    await otherTab.updateEvent(id, { title: 'Umbenannt', type: 'party', starts_at: start, version: 1 });
    await expectError(api.setEventStatus(id, 'in_planung', 1), 'conflict');
    expect((await api.getEvent(id)).title).toBe('Umbenannt');
  });

  it('zählt den Fortschritt ohne verworfene und archivierte Aufgaben', async () => {
    const { event } = await ids();
    const rave = event('Winterrave');
    expect([rave.task_done, rave.task_total, rave.task_overdue]).toEqual([4, 9, 1]);
    const extra = await newTask({ event_id: rave.id });
    expect((await api.getEvent(rave.id)).task_total).toBe(10);
    await api.setTaskStatus(extra.id, { status: 'verworfen', version: 1 });
    expect((await api.getEvent(rave.id)).task_total).toBe(9);
  });
});

describe('Mitglieder (WF-ADM-01 bis -04)', () => {
  it('erlaubt die Verwaltung nur Admins', async () => {
    const { member, topic } = await ids();
    await login('jule');
    await expectError(api.createMember({ display_name: 'X', short: 'X', email: mail('x') }), 'forbidden');
    await expectError(api.deactivateMember(member('Sam').id), 'forbidden');
    await expectError(api.createTopic({ name: 'Neu' }), 'forbidden');
    await expectError(api.archiveTopic(topic('Organisatorisches').id, 1), 'forbidden');
    const jule = member('Jule');
    await expectError(
      api.updateMember(jule.id, {
        display_name: 'Jule',
        short: 'JU',
        email: mail('jule'),
        is_admin: true,
        version: jule.version,
      }),
      'forbidden',
    );
    await expectError(api.reactivateMember(member('Tarek').id), 'forbidden');
    await expectError(api.getDeactivationImpact(member('Sam').id), 'forbidden');
    const org = topic('Organisatorisches');
    await expectError(api.updateTopic(org.id, { name: 'Orga', version: org.version }), 'forbidden');
    await expectError(api.restoreTopic(topic('Alte Location').id, 1), 'forbidden');
    await expectError(api.deleteTopic(topic('Sonstiges').id), 'forbidden');
    expect((await login('jule')).state === 'member').toBe(true);
    expect((await api.listMembers()).find((m) => m.id === jule.id)!.is_admin).toBe(false);
  });

  it('schützt den Systemeintrag', async () => {
    const system = (await ids()).member('Myzel (automatisch)');
    expect(system.is_system).toBe(true);
    await expectError(api.deactivateMember(system.id), 'rule');
    await expectError(
      api.updateMember(system.id, {
        display_name: 'Bot',
        short: 'BO',
        email: mail('bot'),
        version: system.version,
      }),
      'rule',
    );
  });

  it('hält Kürzel und Mail eindeutig', async () => {
    await expectError(
      api.createMember({ display_name: 'Leon', short: 'le', email: mail('leon') }),
      'validation',
      'short',
    );
    await expectError(
      api.createMember({ display_name: 'Lea 2', short: 'L2', email: 'LEA@example.org' }),
      'validation',
      'email',
    );
  });

  it('lässt immer mindestens eine aktive Person mit Admin-Rechten', async () => {
    const { member } = await ids();
    const lea = member('Lea');
    await api.deactivateMember(lea.id);
    const mo = (await ids()).member('Mo');
    await expectError(api.deactivateMember(mo.id), 'rule');
    await expectError(
      api.updateMember(mo.id, {
        display_name: 'Mo',
        short: 'MO',
        email: mail('mo'),
        is_admin: false,
        version: mo.version,
      }),
      'rule',
    );
  });

  it('zeigt die Folgen und räumt beim Deaktivieren in einer Transaktion auf', async () => {
    const { member, task } = await ids();
    const jule = member('Jule');
    const drinks = task('Getränke');
    await login('jule');
    await api.setTaskStatus(drinks.id, { status: 'in_arbeit', version: drinks.version });
    await login('mo');

    const impact = await api.getDeactivationImpact(jule.id);
    expect(impact.tasks_without_assignee.map((t) => [t.title, t.status, t.status_after])).toEqual([
      ['Getränke bei der Brauerei bestellen', 'in_arbeit', 'geplant'],
      ['Kasse für Winterrave besorgen', 'geplant', 'geplant'],
    ]);
    expect(impact.following_count).toBeGreaterThan(0);

    await api.deactivateMember(jule.id);
    const tasks = await api.listTasks();
    expect(tasks.some((t) => t.assignee_ids.includes(jule.id) || t.follower_ids.includes(jule.id))).toBe(
      false,
    );
    expect(tasks.find((t) => t.id === drinks.id)!.status).toBe('geplant');
    expect((await login('jule')).state).toBe('no_access');

    await login('mo');
    await api.reactivateMember(jule.id);
    expect(
      (await api.listTasks()).some(
        (t) => t.assignee_ids.includes(jule.id) || t.follower_ids.includes(jule.id),
      ),
    ).toBe(false);
    expect((await login('jule')).state).toBe('member');
  });

  it('lässt geteilte Aufgaben beim Deaktivieren in Arbeit', async () => {
    const { member, task } = await ids();
    const colors = task('Farben und Siebe');
    expect((await api.getDeactivationImpact(member('Sam').id)).tasks_shared_count).toBe(1);
    await api.deactivateMember(member('Sam').id);
    const after = await api.getTask(colors.id);
    expect(after.status).toBe('in_arbeit');
    expect(after.assignee_ids).toEqual([member('Kim').id]);
  });
});

describe('Weitere Login-Adressen (WF-ADM-09)', () => {
  it('meldet mit jeder eingetragenen Adresse an – auch per Mail-Link –, bis sie entfernt ist', async () => {
    const jule = (await ids()).member('Jule');
    await api.addMemberEmail(jule.id, ' Jule.Privat@Example.net ');
    const emails = await api.listMemberEmails(jule.id);
    expect(emails.map((e) => e.email)).toEqual(['jule.privat@example.net']);
    // noch einmal dieselbe oder die Hauptadresse: nichts passiert
    await api.addMemberEmail(jule.id, 'jule.privat@example.net');
    await api.addMemberEmail(jule.id, mail('jule'));
    expect(await api.listMemberEmails(jule.id)).toHaveLength(1);

    const viaExtra = await api.demo!.signInAs('jule.privat@example.net');
    expect(viaExtra.state === 'member' && viaExtra.member.id).toBe(jule.id);
    // als Jule handeln: Aufgabe anlegen, Jule steht als Anlegende drin
    const task = await newTask();
    expect(task.created_by).toBe(jule.id);
    await api.signOut();
    await api.requestMagicLink('jule.privat@example.net');
    expect((await api.demo!.openMagicLink()).state).toBe('member');

    await login('mo');
    await api.removeMemberEmail(emails[0]!.id);
    expect(await api.listMemberEmails(jule.id)).toEqual([]);
    await api.signOut();
    await api.requestMagicLink('jule.privat@example.net');
    expect((await api.demo!.openMagicLink()).state).toBe('no_access');
    expect((await login('jule')).state).toBe('member');
  });

  it('hält Adressen über alle Mitglieder eindeutig und erlaubt das nur Admins', async () => {
    const { member } = await ids();
    await expectError(api.addMemberEmail(member('Jule').id, mail('sam')), 'validation', 'email');
    await api.addMemberEmail(member('Jule').id, 'jule.privat@example.net');
    await expectError(api.addMemberEmail(member('Sam').id, 'Jule.Privat@example.net'), 'validation', 'email');
    await expectError(
      api.createMember({ display_name: 'Zora', short: 'ZO', email: 'jule.privat@example.net' }),
      'validation',
      'email',
    );
    await expectError(api.addMemberEmail(member('Sam').id, 'keine-mail'), 'validation');
    await login('jule');
    await expectError(api.listMemberEmails(member('Jule').id), 'forbidden');
    await expectError(api.addMemberEmail(member('Jule').id, 'noch@example.net'), 'forbidden');
  });
});

describe('Themen (WF-ADM-05)', () => {
  it('legt an, benennt um und hält zwei Ebenen ein', async () => {
    const { topic } = await ids();
    const verein = topic('Verein');
    const { id } = await api.createTopic({ name: 'Archiv', parent_id: verein.id });
    await expectError(api.createTopic({ name: 'Tiefer', parent_id: id }), 'validation', 'parent_id');
    await expectError(api.createTopic({ name: 'archiv', parent_id: verein.id }), 'validation', 'name');
    await expectError(
      api.updateTopic(verein.id, { name: 'Verein', parent_id: topic('Organisatorisches').id, version: 1 }),
      'validation',
      'parent_id',
    );
    await api.updateTopic(id, { name: 'Vereinsarchiv', parent_id: verein.id, version: 1 });
    expect((await ids()).topic('Vereinsarchiv').version).toBe(2);
  });

  it('archiviert kein Thema mit aktiven Aufgaben und löscht nur unbenutzte', async () => {
    const { topic } = await ids();
    await expectError(api.archiveTopic(topic('Lager & Material').id, 1), 'rule');
    await expectError(api.deleteTopic(topic('Lager & Material').id), 'rule');
    await expectError(api.archiveTopic(topic('Verein').id, 1), 'rule');
    const unused = topic('Sonstiges');
    expect(unused.task_count).toBe(0);
    await api.deleteTopic(unused.id);
    expect((await api.listTopics()).some((t) => t.id === unused.id)).toBe(false);
  });

  it('stellt kein Thema wieder her, dessen Name inzwischen neu vergeben ist', async () => {
    const old = (await ids()).topic('Alte Location');
    await api.createTopic({ name: 'Alte Location' });
    await expectError(api.restoreTopic(old.id, old.version), 'validation', 'name');
    expect((await api.listTopics()).find((t) => t.id === old.id)!.archived_at).not.toBeNull();
  });

  it('archiviert benutzte Themen ohne aktive Aufgaben und stellt sie wieder her', async () => {
    const { topic } = await ids();
    const old = topic('Alte Location');
    expect(old.archived_at).not.toBeNull();
    expect([old.task_count, old.active_task_count]).toEqual([1, 0]);
    await expectError(api.deleteTopic(old.id), 'rule');
    await api.restoreTopic(old.id, old.version);
    const restored = (await ids()).topic('Alte Location');
    expect(restored.archived_at).toBeNull();
    await api.archiveTopic(old.id, restored.version);
    expect((await ids()).topic('Alte Location').archived_at).not.toBeNull();
  });

  it('öffnet keine Aufgabe in einem archivierten Thema wieder', async () => {
    const { topic } = await ids();
    const own = await api.createTopic({ name: 'Werkstatt' });
    const task = (await newTask({ topic_id: own.id }))!;
    await api.setTaskStatus(task.id, { status: 'erledigt', version: 1 });
    await api.archiveTopic(own.id, (await ids()).topic('Werkstatt').version);
    const done = await api.getTask(task.id);
    const error = await expectError(
      api.setTaskStatus(task.id, { status: 'geplant', version: done.version }),
      'rule',
    );
    expect(error.message).toContain('„Werkstatt“ ist archiviert');
    // eine erledigte Aufgabe darf aus dem Archiv zurück, eine offene nicht
    await api.archiveTask(task.id, done.version);
    await api.restoreTask(task.id, (await api.getTask(task.id)).version);
    const other = topic('Verein');
    await api.restoreTopic(own.id, (await ids()).topic('Werkstatt').version);
    const open = await newTask({ topic_id: own.id });
    await api.archiveTask(open.id, open.version);
    await api.archiveTopic(own.id, (await ids()).topic('Werkstatt').version);
    await expectError(api.restoreTask(open.id, (await api.getTask(open.id)).version), 'rule');
    expect(other).toBeDefined();
  });
});

describe('Profil (WF-PRO-01)', () => {
  it('ändert den eigenen Namen und verlangt einen', async () => {
    await api.updateOwnName('  Mo K. ');
    const session = await api.getSession();
    expect(session.state === 'member' && session.member.display_name).toBe('Mo K.');
    await expectError(api.updateOwnName(''), 'validation');
  });
});

describe('Phase 9: Anlegen mit Beschreibung und Bearbeitenden, „Alle“', () => {
  it('legt mit Beschreibung und mehreren Bearbeitenden an – je Person Historie, Status bleibt neu', async () => {
    const { member } = await ids();
    const task = await newTask({
      description: '  Kisten zählen  ',
      assignee_ids: [member('Lea').id, member('Kim').id, member('Lea').id],
    });
    expect([task.status, task.description]).toEqual(['neu', 'Kisten zählen']);
    expect([...task.assignee_ids].sort()).toEqual([member('Lea').id, member('Kim').id].sort());
    expect(task.follower_ids).toEqual(expect.arrayContaining([member('Lea').id, member('Kim').id]));
    expect(task.history.filter((h) => h.action === 'assignee_added')).toHaveLength(2);
    await expectError(newTask({ assignee_ids: [member('Tarek').id] }), 'rule');
  });

  it('„Alle“ trägt alle fehlenden auf einmal ein – ein Rückgängig für alle', async () => {
    const members = await api.listMembers();
    const active = members.filter((m) => m.active && !m.is_system);
    const task = await newTask({ assign_self: true });
    const { undo_token } = await api.addAssignees(
      task.id,
      active.map((m) => m.id),
    );
    const after = await api.getTask(task.id);
    expect(after.assignee_ids).toHaveLength(active.length);
    expect(after.version).toBe(task.version + 1);
    await api.undo(undo_token);
    expect((await api.getTask(task.id)).assignee_ids).toEqual(task.assignee_ids);
    expect((await api.addAssignees(task.id, task.assignee_ids)).undo_token).toBe('');
  });
});

describe('Phase 9: Löschen ist Archivieren (WF-ALL-09)', () => {
  it('jede Art verschwindet aus ihrer Liste, mit Verlauf und Rückgängig', async () => {
    const [event] = await api.listEvents();
    const [appointment] = await api.listAppointments();
    const [decision] = await api.listDecisions();
    const [question] = await api.listQuestions();
    const [document] = await api.listDocuments();
    const [partner] = await api.listPartners();
    const cases = [
      ['event', event!, async () => (await api.listEvents()).map((x) => x.id)],
      ['appointment', appointment!, async () => (await api.listAppointments()).map((x) => x.id)],
      ['decision', decision!, async () => (await api.listDecisions()).map((x) => x.id)],
      ['question', question!, async () => (await api.listQuestions()).map((x) => x.id)],
      ['document', document!, async () => (await api.listDocuments()).map((x) => x.id)],
      ['partner', partner!, async () => (await api.listPartners()).map((x) => x.id)],
    ] as const;
    for (const [type, row, ids] of cases) {
      const { undo_token } = await api.archiveArtifact(type, row.id, row.version);
      expect(await ids(), type).not.toContain(row.id);
      await api.undo(undo_token);
      expect(await ids(), type).toContain(row.id);
    }
  });

  it('prüft die Version und nimmt eine Entscheidung von der Agenda', async () => {
    const marked = (await api.listDecisions()).find((d) => d.marked)!;
    await expectError(api.archiveArtifact('decision', marked.id, marked.version + 5), 'conflict');
    await api.archiveArtifact('decision', marked.id, marked.version);
    const detail = await api.getDecision(marked.id);
    expect([detail.marked, !!detail.archived_at]).toEqual([false, true]);
    expect(detail.history.some((h) => h.action === 'archived')).toBe(true);
  });

  it('Rückgängig bringt eine gelöschte Entscheidung samt Markierung zurück auf die Agenda', async () => {
    const marked = (await api.listDecisions()).find((d) => d.marked)!;
    const { undo_token } = await api.archiveArtifact('decision', marked.id, marked.version);
    await api.undo(undo_token);
    const back = await api.getDecision(marked.id);
    expect([back.marked, back.archived_at]).toEqual([true, null]);
    await expectError(api.archiveArtifact('task' as never, marked.id, 1), 'rule');
  });
});

describe('Phase 9, Review: Gelöschtes bleibt, wie es ist', () => {
  it('gelöschte Veranstaltung, Termin und Partner lassen sich nicht mehr bearbeiten', async () => {
    const [event] = await api.listEvents();
    await api.archiveArtifact('event', event!.id, event!.version);
    await expectError(api.setEventStatus(event!.id, 'abgesagt', event!.version + 1), 'rule');
    const appointment = (await api.listAppointments()).find((a) => a.status === 'geplant' && !a.is_plenum)!;
    await api.archiveArtifact('appointment', appointment.id, appointment.version);
    await expectError(api.setRsvp(appointment.id, 'ja'), 'rule');
    const [partner] = await api.listPartners();
    await api.archiveArtifact('partner', partner!.id, partner!.version);
    await expectError(api.linkPartner((await api.listEvents())[0]!.id, partner!.id, null), 'rule');
  });

  onlyMock('ein gelöschter Serientermin kommt mit dem nächsten Joblauf nicht zurück', async () => {
    const occurrence = (await api.listAppointments()).find((a) => a.series && a.status === 'geplant')!;
    const { undo_token } = await api.archiveArtifact('appointment', occurrence.id, occurrence.version);
    await api.demo!.runJobNow();
    expect((await api.listAppointments()).map((a) => a.id)).not.toContain(occurrence.id);
    await api.undo(undo_token);
    expect((await api.listAppointments()).map((a) => a.id)).toContain(occurrence.id);
  });
});
