// Phase 6 – Benachrichtigungs-Einstellungen: Schalter-Matrix, eigene Statusänderungen, Vorlauf (F-PRO-02, WF-PRO-04)
// Mit MYZEL_API=server laufen dieselben Tests gegen die echten Server-Funktionen auf PGlite.
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
const login = (name: string) => api.demo!.signInAs(`${name}@example.org`);
const topicId = async () => (await api.listTopics()).find((t) => t.name === 'Organisatorisches')!.id;
const memberId = async (name: string) => (await api.listMembers()).find((m) => m.display_name === name)!.id;
/** Jule hat Push und Telegram */
const juleGets = async (event: string) => {
  await login('jule');
  const list = (await api.demo!.myMessages()).filter((m) => m.event_type === event);
  await login('mo');
  return list.map((m) => `${m.channel}:${m.status}`).sort();
};

beforeEach(async () => {
  clock = new Date(2026, 9, 11, 12);
  api =
    process.env.MYZEL_API === 'server'
      ? await (await import('../../../server/api/serverApi')).createServerApi({ now: () => clock })
      : createMockApi({ storage: memoryStorage(), now: () => clock });
  await login('mo');
});

describe('Schalter-Matrix (F-PRO-02)', () => {
  it('ist zunächst überall an – wie die festen Voreinstellungen bis P6', async () => {
    await login('jule');
    const s = await api.getNotificationSettings();
    expect(s.matrix.map((r) => r.key)).toEqual([
      'zuweisung',
      'kommentar',
      'status',
      'blockade',
      'frist',
      'termine',
      'zusammenfassung',
      'eigene',
      'entscheidungen',
    ]);
    expect(s.matrix.every((r) => r.push && r.telegram)).toBe(true);
    expect(s).toMatchObject({ reminder_lead_days: 3 });
  });

  it('ein abgeschalteter Kanal bekommt nichts – nur für dieses Ereignis', async () => {
    await login('jule');
    await api.setNotificationPreference('kommentar', 'telegram', false);
    await login('mo');
    const { id } = await api.createTask({ title: 'Kabel kaufen', topic_id: await topicId() });
    await api.addAssignee(id, await memberId('Jule'));
    await api.addComment('task', id, 'Baumarkt hat welche');
    expect(await juleGets('kommentar')).toEqual(['push:wartet']);
    expect(await juleGets('zuweisung')).toEqual(['push:wartet', 'telegram:wartet']);
    await login('jule');
    expect((await api.getNotificationSettings()).matrix.find((r) => r.key === 'kommentar')).toEqual({
      key: 'kommentar',
      push: true,
      telegram: false,
    });
  });

  it('greift sofort: auch schon wartende Nachrichten gehen nicht mehr raus', async () => {
    const { id } = await api.createTask({ title: 'Kabel kaufen', topic_id: await topicId() });
    await api.addAssignee(id, await memberId('Jule'));
    expect(await juleGets('zuweisung')).toEqual(['push:wartet', 'telegram:wartet']);
    await login('jule');
    await api.setNotificationPreference('zuweisung', 'push', false);
    await login('mo');
    clock = new Date(clock.getTime() + 60_000);
    await api.demo!.runJobNow();
    expect(await juleGets('zuweisung')).toEqual(['push:fehlgeschlagen', 'telegram:gesendet']);
  });

  it('eine Zeile mit mehreren Ereignissen schaltet alle zusammen', async () => {
    await login('jule');
    await api.setNotificationPreference('frist', 'push', false);
    const row = (await api.getNotificationSettings()).matrix.find((r) => r.key === 'frist')!;
    expect(row).toEqual({ key: 'frist', push: false, telegram: true });
    await api.setNotificationPreference('frist', 'push', true);
    expect((await api.getNotificationSettings()).matrix.find((r) => r.key === 'frist')!.push).toBe(true);
  });
});

describe('Eigene Statusänderungen (6.2)', () => {
  it('erzeugen nie eine Nachricht', async () => {
    await login('jule');
    const { id } = await api.createTask({ title: 'Kabel kaufen', topic_id: await topicId() });
    await api.addAssignee(id, await memberId('Jule'));
    const version = async () => (await api.getTask(id)).version;
    await api.setTaskStatus(id, { status: 'in_arbeit', version: await version() });
    await api.setTaskStatus(id, { status: 'erledigt', version: await version() });
    expect((await api.demo!.myMessages()).filter((m) => m.event_type === 'status')).toHaveLength(0);
  });
});

describe('Vorlauf für Fristerinnerungen', () => {
  it('lässt sich auf 1, 3 oder 7 Tage stellen und wirkt beim nächsten Lauf', async () => {
    await login('jule');
    const { id } = await api.createTask({
      title: 'Fass bestellen',
      topic_id: await topicId(),
      due_date: '2026-10-17',
    });
    await api.addAssignee(id, await memberId('Jule'));
    await api.demo!.runJobNow();
    expect(
      (await api.demo!.myMessages()).some(
        (m) => m.event_type === 'frist_naht' && m.text.includes('Fass bestellen'),
      ),
    ).toBe(false);
    await api.setReminderLeadDays(7);
    expect((await api.getNotificationSettings()).reminder_lead_days).toBe(7);
    await api.demo!.runJobNow();
    expect(
      (await api.demo!.myMessages()).some(
        (m) => m.event_type === 'frist_naht' && m.text.includes('Fass bestellen'),
      ),
    ).toBe(true);

    const error = (await api.setReminderLeadDays(5).then(
      () => null,
      (e: unknown) => e,
    )) as AppError | null;
    expect(error?.code).toBe('validation');
    expect(error?.message).toBe('Bitte 1, 3 oder 7 Tage wählen.');
  });
});
