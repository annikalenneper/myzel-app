// Phase 2 – Erinnerungen: Benachrichtigungslogik, Outbox ohne Doppelversand, Joblauf, Push, Telegram.
// Mit MYZEL_API=server laufen dieselben Tests gegen die echten Server-Funktionen auf PGlite (Schritt C, Phase 2).
import { beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../../shared/errors';
import { dueReminderMessages, isJobOverdue } from '../../shared/rules/notifications';
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

const SERVER = process.env.MYZEL_API === 'server';
const onlyMock = it.skipIf(SERVER);
let api: MyzelApi;
let clock: Date;
let storage: KeyValueStorage;
const login = (name: string) => api.demo!.signInAs(`${name}@example.org`);
const messages = async (name: string) => {
  await login(name);
  const list = await api.demo!.myMessages();
  await login('mo');
  return list;
};
const expectCode = async (promise: Promise<unknown>, code: AppError['code']) => {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect((error as AppError)?.code).toBe(code);
};
const topicId = async () => (await api.listTopics()).find((t) => t.name === 'Organisatorisches')!.id;
const memberId = async (name: string) => (await api.listMembers()).find((m) => m.display_name === name)!.id;

beforeEach(async () => {
  clock = new Date(2026, 9, 11, 12, 0, 0);
  storage = memoryStorage();
  api = SERVER
    ? await (await import('../../../server/api/serverApi')).createServerApi({ now: () => clock })
    : createMockApi({ storage, now: () => clock });
  await login('mo');
});

describe('Fristerinnerungen (6.2)', () => {
  const item = (due_date: string, lead = 3) => ({
    task: { id: 't', title: 'Getränke bestellen', due_date, status: 'geplant' as const, archived_at: null },
    assignees: [{ id: 'a', reminder_lead_days: lead }],
    followerIds: ['f'],
  });
  const kinds = (due: string, today: string, lead?: number) =>
    dueReminderMessages([item(due, lead)], today).map((m) => `${m.event_type}:${m.member_id}`);

  it('kommen mit Vorlauf, am Tag und einmal bei Überschreitung', () => {
    expect(kinds('2026-10-14', '2026-10-10')).toEqual([]);
    expect(kinds('2026-10-14', '2026-10-11')).toEqual(['frist_naht:a']);
    expect(kinds('2026-10-14', '2026-10-14')).toEqual(['frist_heute:a']);
    // überschritten: Bearbeitende und Folgende
    expect(kinds('2026-10-14', '2026-10-15')).toEqual(['frist_ueberschritten:a', 'frist_ueberschritten:f']);
    expect(kinds('2026-10-14', '2026-10-08', 7)).toEqual(['frist_naht:a']);
  });

  it('nennen Titel und Datum und führen direkt zur Aufgabe', () => {
    const [m] = dueReminderMessages([item('2026-10-14')], '2026-10-11');
    expect(m!.text).toBe('„Getränke bestellen“ muss bis 14.10. erledigt sein – noch 3 Tage.');
    expect(m!.link).toBe('/aufgaben/t');
  });

  it('haben je Anlass denselben Schlüssel – an jedem Tag des Vorlaufs', () => {
    const key = (today: string) => dueReminderMessages([item('2026-10-14')], today)[0]!.dedupe_key;
    expect(key('2026-10-11')).toBe(key('2026-10-13'));
  });

  it('gibt es nicht für erledigte oder archivierte Aufgaben', () => {
    const done = { ...item('2026-10-01'), task: { ...item('2026-10-01').task, status: 'erledigt' as const } };
    expect(dueReminderMessages([done], '2026-10-11')).toEqual([]);
  });
});

describe('Ereignisse und Outbox (6.1, 6.2)', () => {
  it('Zuweisung durch A erreicht B per Push und Telegram – nicht sich selbst', async () => {
    const { id } = await api.createTask({
      title: 'Kabel kaufen',
      topic_id: await topicId(),
      due_date: '2026-11-14',
    });
    await api.addAssignee(id, await memberId('Jule'));
    await api.addAssignee(id, await memberId('Mo'));
    const jule = (await messages('jule')).filter((m) => m.event_type === 'zuweisung');
    expect(jule.map((m) => m.channel).sort()).toEqual(['push', 'telegram']);
    expect(jule[0]!.text).toBe('Du bist jetzt bei „Kabel kaufen“ eingetragen. Frist: 14.11.');
    expect(jule[0]!.link).toBe(`/aufgaben/${id}`);
    expect((await api.demo!.myMessages()).some((m) => m.event_type === 'zuweisung')).toBe(false);
  });

  it('eigene Statusänderungen erzeugen keine Nachricht, fremde schon', async () => {
    const { id } = await api.createTask({ title: 'Kabel kaufen', topic_id: await topicId() });
    await api.addFollower(id, await memberId('Jule'));
    await api.setTaskStatus(id, { status: 'geplant', version: 1 });
    expect((await api.demo!.myMessages()).some((m) => m.event_type === 'status')).toBe(false);
    const jule = (await messages('jule')).filter((m) => m.event_type === 'status');
    expect(jule[0]!.text).toBe('„Kabel kaufen“ ist jetzt „Geplant“.');
  });

  it('Kommentar geht an Bearbeitende und Folgende außer Autor*in', async () => {
    const { id } = await api.createTask({ title: 'Kabel kaufen', topic_id: await topicId() });
    await api.addAssignee(id, await memberId('Jule'));
    await api.addComment(id, 'Baumarkt hat welche');
    const jule = (await messages('jule')).filter((m) => m.event_type === 'kommentar');
    expect(jule[0]!.text).toBe('Neuer Kommentar von Mo bei „Kabel kaufen“: Baumarkt hat welche');
    expect((await api.demo!.myMessages()).some((m) => m.event_type === 'kommentar')).toBe(false);
  });

  it('„Blockade aufgehoben“ geht an die Bearbeitenden der wartenden Aufgabe', async () => {
    const tasks = await api.listTasks();
    const location = tasks.find((t) => t.title.startsWith('Location'))!;
    await api.setTaskStatus(location.id, { status: 'erledigt', version: location.version });
    const sam = (await messages('sam')).filter((m) => m.event_type === 'blockade_aufgehoben');
    expect(sam[0]!.text).toBe(
      '„Location für Winterrave bestätigen“ ist erledigt – „Flyer drucken lassen“ ist nicht mehr blockiert.',
    );
    // der Status der wartenden Aufgabe ändert sich nicht automatisch
    expect((await api.listTasks()).find((t) => t.title === 'Flyer drucken lassen')!.status).toBe('blockiert');
  });

  it('„Rückgängig“ zieht eine noch nicht verschickte Nachricht zurück', async () => {
    const { id } = await api.createTask({ title: 'Kabel kaufen', topic_id: await topicId() });
    const { undo_token } = await api.addAssignee(id, await memberId('Jule'));
    await api.undo(undo_token);
    await api.demo!.runJobNow();
    expect((await messages('jule')).some((m) => m.event_type === 'zuweisung')).toBe(false);
  });

  it('der Joblauf wartet das Rückgängig-Fenster ab – ein „Rückgängig“ danach zieht noch zurück', async () => {
    const { id } = await api.createTask({ title: 'Kabel kaufen', topic_id: await topicId() });
    const { undo_token } = await api.addAssignee(id, await memberId('Jule'));
    await api.demo!.runJobNow();
    expect((await messages('jule')).find((m) => m.event_type === 'zuweisung')!.status).toBe('wartet');
    await api.undo(undo_token);
    expect((await messages('jule')).some((m) => m.event_type === 'zuweisung')).toBe(false);

    await api.addAssignee(id, await memberId('Jule'));
    clock = new Date(clock.getTime() + 31_000);
    await api.demo!.runJobNow();
    expect((await messages('jule')).find((m) => m.event_type === 'zuweisung')!.status).toBe('gesendet');
  });

  it('Erinnerungen des Joblaufs gehen im selben Lauf raus – nur Rücknehmbares wartet', async () => {
    const today = `${clock.getFullYear()}-${String(clock.getMonth() + 1).padStart(2, '0')}-${String(clock.getDate()).padStart(2, '0')}`;
    const { id } = await api.createTask({
      title: 'Kabel kaufen',
      topic_id: await topicId(),
      due_date: today,
    });
    await api.addAssignee(id, await memberId('Jule'));
    await api.demo!.runJobNow();
    const jule = await messages('jule');
    expect(jule.find((m) => m.event_type === 'frist_heute')!.status).toBe('gesendet');
    expect(jule.find((m) => m.event_type === 'zuweisung')!.status).toBe('wartet');
  });

  it('wer die blockierende Aufgabe selbst erledigt und auch die wartende bearbeitet, bekommt keine Nachricht', async () => {
    await login('sam');
    const location = (await api.listTasks()).find((t) => t.title.startsWith('Location'))!;
    await api.setTaskStatus(location.id, { status: 'erledigt', version: location.version });
    expect((await api.demo!.myMessages()).some((m) => m.event_type === 'blockade_aufgehoben')).toBe(false);
  });

  it('Telegram trennen: wartende Nachrichten dieses Kanals gehen nicht mehr raus', async () => {
    const { id } = await api.createTask({ title: 'Kabel kaufen', topic_id: await topicId() });
    await api.addAssignee(id, await memberId('Jule'));
    await login('jule');
    await api.unlinkTelegram();
    const mine = (await api.demo!.myMessages()).filter((m) => m.event_type === 'zuweisung');
    expect(mine.map((m) => `${m.channel}:${m.status}`).sort()).toEqual([
      'push:wartet',
      'telegram:fehlgeschlagen',
    ]);
  });

  it('„Rückgängig“ eines Statuswechsels zieht die Nachricht ebenfalls zurück', async () => {
    const task = (await api.listTasks()).find((t) => t.title.startsWith('Getränke'))!;
    const before = (await messages('jule')).length;
    const { undo_token } = await api.setTaskStatus(task.id, { status: 'in_arbeit', version: task.version });
    expect((await messages('jule')).length).toBeGreaterThan(before);
    await api.undo(undo_token);
    await api.demo!.runJobNow();
    expect((await messages('jule')).length).toBe(before);
  });

  it('ein später eingeschalteter Kanal bekommt keine alten Erinnerungen nachgeliefert', async () => {
    const overdue = async () =>
      (await api.demo!.myMessages()).filter((m) => m.event_type === 'frist_ueberschritten');
    expect((await overdue()).map((m) => m.channel)).toEqual(['telegram']);
    await api.setPush(true);
    await api.demo!.runJobNow();
    clock = new Date(clock.getTime() + 24 * 3_600_000);
    await api.demo!.runJobNow();
    expect((await overdue()).map((m) => m.channel)).toEqual(['telegram']);
  });

  // die Testdaten entstehen hier mit eigenem Joblauf; gegen den Server prüft das server/p2/notify.test.ts
  onlyMock('vor 9 Uhr gehen keine Fristerinnerungen raus', async () => {
    clock = new Date(2026, 9, 12, 8, 30, 0);
    const early = createMockApi({ storage: memoryStorage(), now: () => clock });
    await early.demo!.signInAs('mo@example.org');
    expect((await early.demo!.myMessages()).some((m) => m.event_type.startsWith('frist'))).toBe(false);
    clock = new Date(2026, 9, 12, 9, 5, 0);
    await early.demo!.runJobNow();
    expect((await early.demo!.myMessages()).some((m) => m.event_type === 'frist_ueberschritten')).toBe(true);
  });

  it('wer weder Push noch Telegram hat, bekommt nichts in die Outbox', async () => {
    const { id } = await api.createTask({ title: 'Kabel kaufen', topic_id: await topicId() });
    await api.addAssignee(id, await memberId('Paula'));
    const paula = await messages('paula');
    // Paula hat in den Testdaten nur Push
    expect(paula.filter((m) => m.event_type === 'zuweisung').map((m) => m.channel)).toEqual(['push']);
  });
});

describe('Joblauf (E-07)', () => {
  it('verschickt Fristerinnerungen nie doppelt und holt einen ausgefallenen Lauf nach', async () => {
    const overdue = () => messagesOf('frist_ueberschritten');
    const messagesOf = async (type: string) =>
      (await api.demo!.myMessages()).filter((m) => m.event_type === type);
    const before = (await overdue()).length;
    expect(before).toBe(1); // „Location …“ ist überfällig, Mo per Telegram erreichbar
    await api.demo!.runJobNow();
    await api.demo!.runJobNow();
    expect((await overdue()).length).toBe(before);
    expect((await api.demo!.myMessages()).every((m) => m.status === 'gesendet')).toBe(true);
  });

  it('warnt nach zwei Stunden ohne Lauf', async () => {
    const status = await api.getSystemStatus();
    expect(status.runs).toHaveLength(5);
    expect(isJobOverdue(status.last_run_at, clock)).toBe(false);
    await api.demo!.setOutage(true);
    const during = await api.getSystemStatus();
    expect(isJobOverdue(during.last_run_at, clock)).toBe(true);
    await api.demo!.setOutage(false);
    expect(isJobOverdue((await api.getSystemStatus()).last_run_at, clock)).toBe(false);
  });

  it('zeigt den Systemstatus nur Admins', async () => {
    const status = await api.getSystemStatus();
    expect([status.push_subscriptions, status.telegram_linked, status.active_members]).toEqual([9, 8, 11]);
    await login('jule');
    await expectCode(api.getSystemStatus(), 'forbidden');
  });
});

describe('Push und Telegram im Profil (WF-PRO-02, WF-PRO-03)', () => {
  it('legt das Push-Abo für dieses Gerät an und entfernt es beim Abmelden', async () => {
    expect((await api.getNotificationSettings()).push).toBe(false);
    await api.setPush(true);
    expect((await api.getNotificationSettings()).push).toBe(true);
    expect((await api.getSystemStatus()).push_subscriptions).toBe(10);
    await api.signOut();
    await login('mo');
    expect((await api.getNotificationSettings()).push).toBe(false);
    expect((await api.getSystemStatus()).push_subscriptions).toBe(9);
  });

  it('verknüpft Telegram über einen Einmal-Code, 15 Minuten gültig, einmal verwendbar', async () => {
    expect((await api.getNotificationSettings()).telegram).toBe('verbunden');
    await expectCode(api.startTelegramLink(), 'rule');
    await api.unlinkTelegram();
    expect((await api.getNotificationSettings()).telegram).toBe('aus');

    const link = await api.startTelegramLink();
    expect(link.url).toMatch(/^https:\/\/t\.me\/\w+\?start=\w{16}$/);
    expect(new Date(link.expires_at).getTime() - clock.getTime()).toBe(15 * 60_000);
    expect((await api.getNotificationSettings()).telegram).toBe('wartet');
    await api.demo!.completeTelegramLink();
    expect((await api.getNotificationSettings()).telegram).toBe('verbunden');
    await expectCode(api.demo!.completeTelegramLink(), 'rule');
  });

  it('lässt einen abgelaufenen Code verfallen', async () => {
    await api.unlinkTelegram();
    await api.startTelegramLink();
    clock = new Date(clock.getTime() + 16 * 60_000);
    expect((await api.getNotificationSettings()).telegram).toBe('aus');
    await expectCode(api.demo!.completeTelegramLink(), 'rule');
  });
});
