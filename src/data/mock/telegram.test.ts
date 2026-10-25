// Phase 6 – Telegram-Buttons (6.4): dieselbe Logik wie die App, mit Person in der Historie, idempotent,
// mit Bestätigung im Chat und freundlichem Hinweis, wenn es nicht mehr geht
import { beforeEach, describe, expect, it } from 'vitest';
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
const topicId = async () => (await api.listTopics()).find((t) => t.name === 'Organisatorisches')!.id;
const memberId = async (name: string) => (await api.listMembers()).find((m) => m.display_name === name)!.id;
/** die Telegram-Nachricht der eingeloggten Person zu diesem Ereignis und Ziel */
const tg = async (event: string, link: string) =>
  (await api.demo!.myMessages()).find(
    (m) => m.channel === 'telegram' && m.event_type === event && m.link === link,
  )!;
const press = (id: string, button: Parameters<NonNullable<MyzelApi['demo']>['telegramPress']>[1]) =>
  api.demo!.telegramPress(id, button);

/** Mo legt eine Aufgabe an und trägt Jule ein */
const assignedToJule = async (title = 'Kabel kaufen') => {
  const { id } = await api.createTask({ title, topic_id: await topicId(), due_date: '2026-10-13' });
  await api.addAssignee(id, await memberId('Jule'));
  await login('jule');
  return id;
};

beforeEach(async () => {
  api = createMockApi({ storage: memoryStorage(), now: () => new Date(2026, 9, 11, 12) });
  await login('mo');
});

describe('Zuweisung (6.4)', () => {
  it('„Übernehme ich“ setzt In Arbeit – mit Person in der Historie, ein zweiter Tipp ändert nichts', async () => {
    const id = await assignedToJule();
    const msg = await tg('zuweisung', `/agenda/${id}`);
    expect(await press(msg.id, 'uebernehme')).toEqual({
      ok: true,
      text: 'Danke! „Kabel kaufen“ ist jetzt „In Arbeit“.',
    });
    const task = await api.getTask(id);
    expect(task.status).toBe('in_arbeit');
    expect(task.history[0]).toMatchObject({ actor_member_id: await memberId('Jule'), action: 'status' });
    const version = task.version;
    expect(await press(msg.id, 'uebernehme')).toEqual({
      ok: true,
      text: '„Kabel kaufen“ ist schon „In Arbeit“.',
    });
    expect((await api.getTask(id)).version).toBe(version);
  });

  it('„Passt nicht“ trägt aus, setzt „In Arbeit“ zurück und benachrichtigt, wer zugewiesen hat', async () => {
    const id = await assignedToJule();
    const msg = await tg('zuweisung', `/agenda/${id}`);
    await press(msg.id, 'uebernehme');
    expect(await press(msg.id, 'passt_nicht')).toEqual({
      ok: true,
      text: 'Okay, du bist bei „Kabel kaufen“ ausgetragen – sie ist wieder „Geplant“.',
    });
    const task = await api.getTask(id);
    expect(task.assignee_ids).toEqual([]);
    expect(task.status).toBe('geplant');
    expect(await press(msg.id, 'passt_nicht')).toEqual({
      ok: true,
      text: 'Du bist bei „Kabel kaufen“ schon ausgetragen.',
    });
    await login('mo');
    const told = (await api.demo!.myMessages()).filter((m) => m.event_type === 'zuweisung_abgelehnt');
    expect(told[0]?.text).toBe('Jule passt „Kabel kaufen“ nicht – die Aufgabe braucht jemand anderen.');
  });

  it('wer nicht mehr eingetragen ist, bekommt einen Hinweis statt einer Änderung', async () => {
    const id = await assignedToJule();
    const msg = await tg('zuweisung', `/agenda/${id}`);
    await login('mo');
    await api.removeAssignee(id, await memberId('Jule'));
    await login('jule');
    expect(await press(msg.id, 'uebernehme')).toEqual({
      ok: false,
      text: 'Du bist bei „Kabel kaufen“ nicht mehr eingetragen.',
    });
  });
});

describe('Frist, Blockade, Termin (6.4)', () => {
  it('„Erledigt“ und „Bin dran“ an der Fristerinnerung', async () => {
    const id = await assignedToJule();
    await api.demo!.runJobNow();
    const msg = await tg('frist_naht', `/agenda/${id}`);
    expect((await press(msg.id, 'bin_dran')).ok).toBe(true);
    expect((await api.getTask(id)).status).toBe('in_arbeit');
    expect(await press(msg.id, 'erledigt')).toEqual({
      ok: true,
      text: 'Super! „Kabel kaufen“ ist erledigt.',
    });
    expect((await api.getTask(id)).status).toBe('erledigt');
  });

  it('geht es nicht mehr, kommt ein freundlicher Hinweis – und nichts wird halb gespeichert', async () => {
    const id = await assignedToJule();
    await api.demo!.runJobNow();
    const msg = await tg('frist_naht', `/agenda/${id}`);
    await login('mo');
    await api.archiveTask(id, (await api.getTask(id)).version);
    await login('jule');
    const reply = await press(msg.id, 'erledigt');
    expect(reply.ok).toBe(false);
    expect(reply.text).toMatch(/^Das geht gerade nicht: Archivierte Aufgaben lassen sich nicht ändern/);
    expect((await api.getTask(id)).status).not.toBe('erledigt');
  });

  it('„Weiter geht’s“ nach aufgehobener Blockade', async () => {
    const waiting = await assignedToJule('Flyer verteilen');
    await login('mo');
    const { id: blocker } = await api.createTask({ title: 'Flyer drucken', topic_id: await topicId() });
    await api.addBlocker(waiting, blocker);
    await api.addAssignee(blocker, await memberId('Mo'));
    await api.setTaskStatus(blocker, { status: 'erledigt', version: (await api.getTask(blocker)).version });
    await login('jule');
    const msg = await tg('blockade_aufgehoben', `/agenda/${waiting}`);
    expect((await press(msg.id, 'weiter')).text).toBe('„Flyer verteilen“ ist jetzt „In Arbeit“.');
  });

  it('„Komme“ und „Komme nicht“ an der Termin-Einladung', async () => {
    await api.createAppointment({
      type_id: (await api.listAppointmentTypes()).find((t) => t.label === 'Bautag')!.id,
      title: 'Bautag extra',
      starts_at: new Date(2026, 9, 24, 10).toISOString(),
      format: 'vor_ort',
      location: 'Lager',
    });
    await login('jule');
    const appointment = (await api.listAppointments()).find((a) => a.title === 'Bautag extra')!;
    const msg = await tg('termin_einladung', `/termine/${appointment.id}`);
    expect(await press(msg.id, 'komme')).toEqual({
      ok: true,
      text: 'Schön! Zusage für „Bautag extra“ gespeichert.',
    });
    expect(await press(msg.id, 'komme')).toEqual({
      ok: true,
      text: 'Du hast für „Bautag extra“ schon zugesagt.',
    });
    expect((await press(msg.id, 'komme_nicht')).ok).toBe(true);
    expect((await api.getAppointment(appointment.id)).no_ids).toContain(await memberId('Jule'));
  });

  it('nur eigene Telegram-Nachrichten und nur die Buttons der Nachricht', async () => {
    const id = await assignedToJule();
    const msg = await tg('zuweisung', `/agenda/${id}`);
    // der Bot antwortet freundlich und ändert nichts
    expect(await press(msg.id, 'komme')).toEqual({
      ok: false,
      text: 'Das geht gerade nicht: Diesen Button gibt es an dieser Nachricht nicht.',
    });
    await login('lea');
    expect(await press(msg.id, 'uebernehme')).toEqual({
      ok: false,
      text: 'Das geht gerade nicht: Diese Nachricht gibt es nicht mehr.',
    });
    expect((await api.getTask(id)).status).toBe('neu');
  });
});

describe('Verknüpfung (7.2)', () => {
  it('nach dem Trennen wirken Buttons alter Nachrichten nicht mehr', async () => {
    const id = await assignedToJule();
    const msg = await tg('zuweisung', `/agenda/${id}`);
    await api.unlinkTelegram();
    expect(await press(msg.id, 'uebernehme')).toEqual({
      ok: false,
      text: 'Das geht gerade nicht: Dieser Chat ist nicht mehr mit Myzel verbunden. Verknüpfe Telegram im Profil neu.',
    });
    expect((await api.getTask(id)).status).toBe('neu');
  });
});
