// Phase 14 – Benachrichtigungen bündeln statt fluten (Nutzerin, 11.11.2026). Mit MYZEL_API=server laufen dieselben
// Tests gegen die Server-Funktionen auf PGlite.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BUNDLE_QUIET_MS,
  collapseInbox,
  digestText,
  isNight,
  nextMorning,
  nightExempt,
  resolveBundle,
} from '../../shared/rules/notifications';
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
const later = (ms: number) => (clock = new Date(clock.getTime() + ms));
/** Nachrichten an eine Person, die rausgingen bzw. noch rausgehen – ohne „ersetzt“, nur ein Kanal */
const outbox = async (name: string, about: string) => {
  await login(name);
  const list = (await api.demo!.myMessages()).filter(
    (m) => m.link.includes(about) && m.channel === 'telegram',
  );
  await login('mo');
  return list;
};
const live = (list: Awaited<ReturnType<typeof outbox>>) => list.filter((m) => m.status !== 'ersetzt');
const inDays = (days: number, hour = 19) =>
  new Date(clock.getFullYear(), clock.getMonth(), clock.getDate() + days, hour).toISOString();

beforeEach(async () => {
  clock = new Date(2026, 9, 11, 12, 0, 0);
  api =
    process.env.MYZEL_API === 'server'
      ? await (await import('../../../server/api/serverApi')).createServerApi({ now: () => clock })
      : createMockApi({ storage: memoryStorage(), now: () => clock });
  await login('mo');
});

describe('Regeln (resolveBundle, collapseInbox)', () => {
  const row = (
    event_type: 'termin_einladung' | 'termin_geaendert' | 'kommentar',
    text: string,
    at: number,
    invite_text: string | null = null,
  ) => ({
    event_type,
    text,
    invite_text,
    created_at: new Date(2026, 9, 11, 12, at).toISOString(),
  });

  it('die neueste Fassung gewinnt; eine noch wartende Einladung nimmt die Änderung auf', () => {
    const invite = row('termin_einladung', 'Bautag am Mo – kommst du?', 0);
    const moved = row('termin_geaendert', 'Bautag wurde geändert: jetzt Di', 2, 'Bautag am Di – kommst du?');
    expect(resolveBundle([moved, invite])).toMatchObject({
      keep: moved,
      event_type: 'termin_einladung',
      text: 'Bautag am Di – kommst du?',
    });
    // ohne wartende Einladung bleibt es die Änderung
    expect(resolveBundle([moved])).toMatchObject({ event_type: 'termin_geaendert', text: moved.text });
  });

  it('nach einer Absage vor der Einladung geht nichts raus; mehrere Kommentare mit „(+n weitere)“', () => {
    const invite = row('termin_einladung', 'Bautag – kommst du?', 0);
    expect(resolveBundle([invite, row('termin_geaendert', 'Bautag fällt aus.', 1, '')])).toBeNull();
    const comments = [
      row('kommentar', 'A: eins', 0),
      row('kommentar', 'B: zwei', 1),
      row('kommentar', 'C: drei', 2),
    ];
    expect(resolveBundle(comments)?.text).toBe('C: drei (+2 weitere)');
  });

  it('Glocke: nur Ungesehenes eines Bündels erscheint als ein Eintrag', () => {
    const e = (id: string, minute: number, bundle_key: string | null) => ({
      id,
      event_type: 'status' as const,
      text: `Text ${id}`,
      link: '/agenda/x',
      created_at: new Date(2026, 9, 11, 12, minute).toISOString(),
      bundle_key,
    });
    const seen = new Date(2026, 9, 11, 12, 5).toISOString();
    // neueste zuerst: c und b ungesehen im selben Bündel, a gesehen, d ohne Bündel
    const list = collapseInbox(
      [e('d', 9, null), e('c', 8, 'status:x'), e('b', 7, 'status:x'), e('a', 1, 'status:x')],
      seen,
    );
    expect(list.map((x) => x.id)).toEqual(['d', 'c', 'a']);
  });
});

describe('Bündeln im Versand (Phase 14)', () => {
  const createBautag = async () => {
    const type = (await api.listAppointmentTypes()).find((t) => t.label === 'Bautag')!;
    await api.createAppointment({
      type_id: type.id,
      title: 'Bautag Bündel',
      starts_at: inDays(10, 10),
      format: 'vor_ort',
      location: 'Lager',
    });
    return (await api.listAppointments()).find((a) => a.title === 'Bautag Bündel')!;
  };
  const move = async (id: string, days: number) => {
    const a = (await api.listAppointments()).find((x) => x.id === id)!;
    await api.updateAppointment(id, {
      type_id: a.type_id,
      title: a.title,
      starts_at: inDays(days, 10),
      ends_at: null,
      format: a.format,
      location: a.location,
      online_url: a.online_url,
      event_id: a.event_id,
      version: a.version,
    });
  };

  it('Termin anlegen und zweimal verschieben: eine Einladung mit dem neuen Stand, erst nach 10 Minuten Ruhe', async () => {
    const a = await createBautag();
    later(2 * 60_000);
    await move(a.id, 11);
    later(3 * 60_000);
    await move(a.id, 12);
    // die Ruhezeit läuft ab der letzten Änderung
    later(BUNDLE_QUIET_MS - 60_000);
    await api.demo!.runJobNow();
    expect(live(await outbox('jule', a.id)).map((m) => m.status)).toEqual(['wartet', 'wartet', 'wartet']);
    later(2 * 60_000);
    await api.demo!.runJobNow();
    const sent = live(await outbox('jule', a.id));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ status: 'gesendet', event_type: 'termin_einladung' });
    expect(sent[0]!.text).toMatch(/^Bautag Bündel am .+ – kommst du\?$/);
    expect(sent[0]!.text).toContain(new Date(inDays(12, 10)).getDate().toString());
  });

  it('Termin vor dem Versand der Einladung abgesagt: es geht gar nichts raus', async () => {
    const a = await createBautag();
    later(60_000);
    const current = (await api.listAppointments()).find((x) => x.id === a.id)!;
    await api.cancelAppointment(a.id, current.version);
    later(BUNDLE_QUIET_MS + 60_000);
    await api.demo!.runJobNow();
    expect(live(await outbox('jule', a.id))).toEqual([]);
  });

  it('nach verschickter Einladung kommt eine Änderung als eigene Nachricht', async () => {
    const a = await createBautag();
    later(BUNDLE_QUIET_MS + 60_000);
    await api.demo!.runJobNow();
    await move(a.id, 11);
    later(BUNDLE_QUIET_MS + 60_000);
    await api.demo!.runJobNow();
    const sent = live(await outbox('jule', a.id));
    expect(sent.map((m) => `${m.event_type}:${m.status}`).sort()).toEqual([
      'termin_einladung:gesendet',
      'termin_geaendert:gesendet',
    ]);
  });

  it('mehrere Kommentare kurz hintereinander: eine Nachricht mit „(+1 weitere)“', async () => {
    const task = (await api.listTasks()).find((t) => t.title.startsWith('Getränke'))!;
    await api.addComment('task', task.id, 'Erster Gedanke');
    await api.addComment('task', task.id, 'Noch etwas');
    later(31_000);
    await api.demo!.runJobNow();
    const sent = live(await outbox('jule', task.id)).filter((m) => m.event_type === 'kommentar');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toMatch(/Noch etwas \(\+1 weitere\)$/);
  });

  it('Glocke: zwei Statuswechsel erscheinen als ein neuer Eintrag mit dem letzten Stand', async () => {
    let task = (await api.listTasks()).find((t) => t.title.startsWith('Getränke'))!;
    await api.setTaskStatus(task.id, { status: 'in_arbeit', version: task.version });
    later(60_000);
    task = (await api.listTasks()).find((t) => t.id === task.id)!;
    await api.setTaskStatus(task.id, { status: 'geplant', version: task.version });
    await login('jule');
    const inbox = await api.listInbox();
    const mine = inbox.entries.filter((e) => e.link.includes(task.id) && e.event_type === 'status');
    expect(mine).toHaveLength(1);
    expect(mine[0]!.text).toContain('„Geplant“');
  });
});

describe('Phase 15: Nachtruhe, tägliche Zusammenfassung, ferne Termine (Nutzerin, 12.11.2026)', () => {
  it('Regeln: Nacht von 22 bis 8 Uhr, nächster Morgen 8 Uhr, nur „Termin in 1 Stunde“ darf nachts', () => {
    expect(isNight(new Date(2026, 10, 12, 21, 59))).toBe(false);
    expect(isNight(new Date(2026, 10, 12, 22, 0))).toBe(true);
    expect(isNight(new Date(2026, 10, 13, 7, 59))).toBe(true);
    expect(isNight(new Date(2026, 10, 13, 8, 0))).toBe(false);
    expect(nextMorning(new Date(2026, 10, 12, 23, 10))).toBe(new Date(2026, 10, 13, 8, 0).toISOString());
    expect(nextMorning(new Date(2026, 10, 13, 6, 30))).toBe(new Date(2026, 10, 13, 8, 0).toISOString());
    expect(nextMorning(new Date(2026, 10, 13, 12, 0))).toBe(new Date(2026, 10, 14, 8, 0).toISOString());
    expect(nightExempt('termin_erinnerung_stunde:a:b:c:push')).toBe(true);
    expect(nightExempt('termin_erinnerung_tage:a:b:c:push')).toBe(false);
    const many = digestText(
      Array.from({ length: 10 }, (_, i) => `Nachricht ${i + 1}`),
      true,
    ).split('\n');
    expect(many[0]).toBe('Seit gestern Abend: 10 Neuigkeiten');
    expect(many.at(-1)).toBe('… und 2 weitere – alles in der Glocke');
  });

  it('Nachtruhe: was abends passiert, kommt morgens als eine Nachricht', async () => {
    clock = new Date(2026, 9, 11, 23, 0, 0);
    const task = (await api.listTasks()).find((t) => t.title.startsWith('Getränke'))!;
    await api.addComment('task', task.id, 'Spät noch eine Idee');
    later(60_000);
    const { id: other } = await api.createTask({
      title: 'Kabel kaufen',
      topic_id: (await api.listTopics())[0]!.id,
    });
    await api.addAssignee(other, (await api.listMembers()).find((m) => m.display_name === 'Jule')!.id);
    later(30 * 60_000);
    await api.demo!.runJobNow();
    await login('jule');
    const night = (await api.demo!.myMessages()).filter(
      (m) => m.channel === 'telegram' && m.event_type === 'kommentar',
    );
    expect(night.map((m) => m.status)).toEqual(night.map(() => 'wartet'));
    await login('mo');
    clock = new Date(2026, 9, 12, 8, 5, 0);
    await api.demo!.runJobNow();
    await login('jule');
    const morning = (await api.demo!.myMessages()).filter((m) => m.channel === 'telegram');
    const digest = morning.filter((m) => m.event_type === 'sammelnachricht');
    expect(digest).toHaveLength(1);
    expect(digest[0]).toMatchObject({ status: 'gesendet', link: '/agenda' });
    expect(digest[0]!.text).toMatch(/^Seit gestern Abend: \d+ Neuigkeiten\n• /);
    expect(digest[0]!.text).toContain('Spät noch eine Idee');
    expect(morning.filter((m) => m.event_type === 'kommentar').every((m) => m.status === 'ersetzt')).toBe(
      true,
    );
    // die Glocke behält jeden Eintrag einzeln
    expect(
      (await api.listInbox()).entries.filter((e) => e.event_type === 'kommentar').length,
    ).toBeGreaterThan(0);
  });

  it('Täglich: Kommentare kommen am nächsten Morgen zusammen, andere Zeilen weiter sofort', async () => {
    await login('jule');
    await api.setNotificationDigest('kommentar', true);
    expect((await api.getNotificationSettings()).matrix.find((r) => r.key === 'kommentar')!.daily).toBe(true);
    await login('mo');
    const task = (await api.listTasks()).find((t) => t.title.startsWith('Getränke'))!;
    const { id } = await api.createTask({ title: 'Kabel kaufen', topic_id: (await api.listTopics())[0]!.id });
    await api.addAssignee(id, (await api.listMembers()).find((m) => m.display_name === 'Jule')!.id);
    // Kommentare an zwei Aufgaben – an derselben würden sie schon vorher zu einer Nachricht gebündelt
    await api.addComment('task', task.id, 'Erstens');
    later(60_000);
    await api.addComment('task', id, 'Zweitens');
    later(60_000);
    await api.demo!.runJobNow();
    await login('jule');
    let mine = (await api.demo!.myMessages()).filter((m) => m.channel === 'telegram');
    expect(mine.filter((m) => m.event_type === 'kommentar').every((m) => m.status === 'wartet')).toBe(true);
    expect(mine.find((m) => m.event_type === 'zuweisung')!.status).toBe('gesendet');
    await login('mo');
    clock = new Date(2026, 9, 12, 8, 1, 0);
    await api.demo!.runJobNow();
    await login('jule');
    mine = (await api.demo!.myMessages()).filter((m) => m.channel === 'telegram');
    const digest = mine.filter((m) => m.event_type === 'sammelnachricht');
    expect(digest).toHaveLength(1);
    expect(digest[0]!.text).toMatch(/^Deine Zusammenfassung: 2 Neuigkeiten/);
  });

  it('Termin in mehr als 4 Wochen verschoben: nur in der Glocke – eine wartende Einladung bekommt den neuen Stand', async () => {
    const type = (await api.listAppointmentTypes()).find((t) => t.label === 'Bautag')!;
    const create = async (title: string) => {
      await api.createAppointment({
        type_id: type.id,
        title,
        starts_at: inDays(40, 10),
        format: 'vor_ort',
        location: 'Lager',
      });
      return (await api.listAppointments()).find((a) => a.title === title)!;
    };
    const moveTo = async (id: string, days: number) => {
      const a = (await api.listAppointments()).find((x) => x.id === id)!;
      await api.updateAppointment(id, {
        type_id: a.type_id,
        title: a.title,
        starts_at: inDays(days, 10),
        ends_at: null,
        format: a.format,
        location: a.location,
        online_url: a.online_url,
        event_id: a.event_id,
        version: a.version,
      });
    };
    // Einladung schon raus: die Verschiebung kommt nicht per Telegram, steht aber in der Glocke
    const sent = await create('Bautag weit weg');
    later(BUNDLE_QUIET_MS + 60_000);
    await api.demo!.runJobNow();
    await moveTo(sent.id, 41);
    later(BUNDLE_QUIET_MS + 60_000);
    await api.demo!.runJobNow();
    expect(live(await outbox('jule', sent.id)).map((m) => m.event_type)).toEqual(['termin_einladung']);
    await login('jule');
    // ungesehen fasst die Glocke Einladung und Änderung zur Einladung mit dem neuen Stand zusammen
    const day = String(new Date(inDays(41, 10)).getDate());
    expect(
      (await api.listInbox()).entries.some((e) => e.link.includes(sent.id) && e.text.includes(day)),
    ).toBe(true);
    await login('mo');
    // Einladung noch nicht raus: sie geht mit der neuen Zeit raus
    const fresh = await create('Bautag neu weit weg');
    later(60_000);
    await moveTo(fresh.id, 45);
    later(BUNDLE_QUIET_MS + 60_000);
    await api.demo!.runJobNow();
    const invite = live(await outbox('jule', fresh.id));
    expect(invite).toHaveLength(1);
    expect(invite[0]!.text).toContain(String(new Date(inDays(45, 10)).getDate()));
  });
});
