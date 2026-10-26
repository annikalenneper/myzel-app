// Phase 3 – Termine: Statusmodell 4.3, Zu- und Absagen, Terminarten, Nachrichten
// Mit MYZEL_API=server laufen dieselben Tests gegen die echten Server-Funktionen auf PGlite (Schritt C, Phase 3).
import { beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../../shared/errors';
import { appointmentReminderMessages, yesAndOpen } from '../../shared/rules/appointments';
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
const expectError = async (promise: Promise<unknown>, code: AppError['code'], field?: string) => {
  const error = (await promise.then(
    () => null,
    (e: unknown) => e,
  )) as AppError | null;
  expect(error?.code).toBe(code);
  if (field) expect(error?.field).toBe(field);
};
const appointment = async (title: string) => (await api.listAppointments()).find((a) => a.title === title)!;
const type = async (label: string) => (await api.listAppointmentTypes()).find((t) => t.label === label)!;
const member = async (name: string) => (await api.listMembers()).find((m) => m.display_name === name)!;
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

describe('Termin anlegen (WF-TER-02, WF-PLE-01)', () => {
  it('lädt zu einem nachgetragenen Termin niemanden ein', async () => {
    const bautag = await type('Bautag');
    await api.createAppointment({
      type_id: bautag.id,
      title: 'Bautag nachgetragen',
      starts_at: inDays(-1, 10),
      format: 'vor_ort',
      location: 'Lager',
    });
    await login('jule');
    expect((await api.demo!.myMessages()).some((m) => m.text.includes('Bautag nachgetragen'))).toBe(false);
    await login('mo');
  });

  it('verlangt Art, Titel, Beginn – und je nach Format Ort bzw. Link', async () => {
    const bautag = await type('Bautag');
    const base = { type_id: bautag.id, title: 'Bautag Dezember', starts_at: inDays(60, 10) };
    await expectError(api.createAppointment({ ...base, format: 'vor_ort' }), 'validation', 'location');
    // der Link zum Call darf noch fehlen (Phase 9) – ist einer da, muss er stimmen
    const withoutLink = await api.createAppointment({ ...base, format: 'online' });
    expect((await api.getAppointment(withoutLink.id)).online_url).toBeNull();
    await expectError(
      api.createAppointment({ ...base, format: 'hybrid', location: 'Lager', online_url: 'kein-link' }),
      'validation',
      'online_url',
    );
    await expectError(
      api.createAppointment({ ...base, format: 'vor_ort', location: 'Lager', ends_at: inDays(60, 9) }),
      'validation',
      'ends_at',
    );
    await expectError(
      api.createAppointment({ ...base, title: ' ', format: 'vor_ort', location: 'Lager' }),
      'validation',
      'title',
    );
    const { id } = await api.createAppointment({ ...base, format: 'vor_ort', location: 'Lager' });
    const created = await api.getAppointment(id);
    expect([created.status, created.topic_id, created.online_url]).toEqual([
      'geplant',
      bautag.default_topic_id,
      null,
    ]);
  });

  it('lädt alle aktiven Mitglieder ein – außer der anlegenden Person', async () => {
    const plenum = await type('Plenum');
    await api.createAppointment({
      type_id: plenum.id,
      title: 'Plenum Dezember',
      starts_at: inDays(60),
      format: 'online',
      online_url: 'https://meet.example.org/x',
    });
    await login('jule');
    const invitation = (await api.demo!.myMessages()).filter((m) => m.event_type === 'termin_einladung');
    expect(invitation[0]!.text).toMatch(/^Plenum Dezember am .* \(online\) – kommst du\?$/);
    await login('mo');
    expect((await api.demo!.myMessages()).some((m) => m.event_type === 'termin_einladung')).toBe(false);
  });
});

describe('Zu- und Absage (WF-TER-03)', () => {
  it('speichert, ändert und nimmt zurück – mit Rückgängig', async () => {
    const bautag = await appointment('Bautag Oktober');
    expect([bautag.yes_count, bautag.my_answer]).toEqual([4, null]);
    const { undo_token } = await api.setRsvp(bautag.id, 'ja');
    expect((await api.getAppointment(bautag.id)).yes_count).toBe(5);
    await api.setRsvp(bautag.id, 'nein');
    const declined = await api.getAppointment(bautag.id);
    expect([declined.yes_count, declined.my_answer]).toEqual([4, 'nein']);
    await api.setRsvp(bautag.id, null);
    expect((await api.getAppointment(bautag.id)).my_answer).toBeNull();
    await api.undo(undo_token).catch(() => undefined);
  });

  it('geht nur bei geplanten Terminen, die noch nicht begonnen haben', async () => {
    const past = await appointment('Bautag September');
    await expectError(api.setRsvp(past.id, 'ja'), 'rule');
    const bautag = await appointment('Bautag Oktober');
    clock = new Date(new Date(bautag.starts_at).getTime() + 60_000);
    await expectError(api.setRsvp(bautag.id, 'ja'), 'rule');
  });
});

describe('Bearbeiten, Absagen, Stattgefunden (WF-TER-04 bis -06, 4.3)', () => {
  const fields = (a: Awaited<ReturnType<typeof appointment>>) => ({
    type_id: a.type_id,
    title: a.title,
    starts_at: a.starts_at,
    ends_at: a.ends_at,
    format: a.format,
    location: a.location,
    online_url: a.online_url,
    event_id: a.event_id,
    version: a.version,
  });

  it('benachrichtigt beim Verschieben Zusagen und ohne Antwort; Zusagen bleiben erhalten', async () => {
    const a = await appointment('Bautag Oktober');
    const same = await api.updateAppointment(a.id, { ...fields(a), title: 'Bautag im Oktober' });
    expect(same.notified).toBe(0);
    const moved = await api.updateAppointment(a.id, {
      ...fields(a),
      title: 'Bautag im Oktober',
      starts_at: inDays(13, 10),
      ends_at: inDays(13, 16),
      version: a.version + 1,
    });
    // 4 Zusagen + 6 ohne Antwort, ohne Mo selbst (handelnde Person) und ohne die Absage von Sam
    expect(moved.notified).toBe(9);
    expect((await api.getAppointment(a.id)).yes_count).toBe(4);
    await login('sam');
    expect((await api.demo!.myMessages()).some((m) => m.event_type === 'termin_geaendert')).toBe(false);
    await login('lea');
    expect((await api.demo!.myMessages()).some((m) => m.text.includes('wurde geändert'))).toBe(true);
    await login('mo');
    await expectError(api.updateAppointment(a.id, { ...fields(a), title: 'Alt' }), 'conflict');
  });

  it('sagt nur geplante Termine ab und sperrt danach', async () => {
    const a = await appointment('Vorbesprechung Winterrave mit Kollektiv Sporenflug');
    await api.cancelAppointment(a.id, a.version);
    const cancelled = await api.getAppointment(a.id);
    expect(cancelled.status).toBe('abgesagt');
    await expectError(api.cancelAppointment(a.id, cancelled.version), 'rule');
    await expectError(api.updateAppointment(a.id, { ...fields(cancelled) }), 'rule');
    await expectError(api.setRsvp(a.id, 'ja'), 'rule');
  });

  it('„Hat stattgefunden“ geht erst nach Beginn; Teilnahme bleibt korrigierbar', async () => {
    const a = await appointment('Bautag Oktober');
    const lea = await member('Lea');
    await expectError(api.markAppointmentHappened(a.id, [lea.id], a.version), 'rule');
    await expectError(api.setAttendee(a.id, lea.id, true), 'rule');
    clock = new Date(new Date(a.starts_at).getTime() + 3_600_000);
    const { undo_token } = await api.markAppointmentHappened(a.id, [lea.id], a.version);
    const done = await api.getAppointment(a.id);
    expect([done.status, done.attendee_ids]).toEqual(['stattgefunden', [lea.id]]);
    await api.setAttendee(a.id, (await member('Kim')).id, true);
    expect((await api.getAppointment(a.id)).attendee_ids).toHaveLength(2);
    await api.undo(undo_token);
    const back = await api.getAppointment(a.id);
    expect([back.status, back.attendee_ids]).toEqual(['geplant', []]);
  });
});

describe('Aufgaben am Termin und Deaktivieren (WF-TER-07, F-LOG-03)', () => {
  it('hängt Aufgaben an einen Termin', async () => {
    const a = await appointment('Bautag Oktober');
    expect((await api.getAppointment(a.id)).tasks.map((t) => t.title)).toEqual([
      'Werkzeug mitbringen (Akkuschrauber, Leiter)',
      'Schwerlastregal im Lager aufbauen',
    ]);
    const topic = (await api.listTopics()).find((t) => t.name === 'Lager & Material')!;
    const { id } = await api.createTask({
      title: 'Kaffee mitbringen',
      topic_id: topic.id,
      appointment_id: a.id,
    });
    expect((await api.getTask(id)).appointment_id).toBe(a.id);
    expect((await api.getAppointment(a.id)).task_count).toBe(3);
    await expectError(
      api.createTask({ title: 'x', topic_id: topic.id, appointment_id: crypto.randomUUID() }),
      'validation',
      'appointment_id',
    );
  });

  it('entfernt beim Deaktivieren die Antworten für künftige Termine – vergangene bleiben', async () => {
    const lea = await member('Lea');
    const impact = await api.getDeactivationImpact(lea.id);
    expect(impact.future_rsvp_count).toBe(4);
    await api.deactivateMember(lea.id);
    expect((await api.getAppointment((await appointment('Bautag Oktober')).id)).yes_ids).not.toContain(
      lea.id,
    );
    expect((await api.getAppointment((await appointment('Bautag September')).id)).yes_ids).toContain(lea.id);
  });
});

describe('Terminarten (WF-ADM-06)', () => {
  it('nur Admins; belegte nur archivierbar; unbenutzte löschbar', async () => {
    const topic = (await api.listTopics()).find((t) => t.name === 'Organisatorisches')!;
    const input = {
      label: 'Putztag',
      default_topic_id: topic.id,
      default_format: 'vor_ort' as const,
      color: '#8FA6FF' as const,
    };
    await login('jule');
    await expectError(api.createAppointmentType(input), 'forbidden');
    await login('mo');
    const { id } = await api.createAppointmentType(input);
    await expectError(api.createAppointmentType({ ...input, label: 'putztag' }), 'validation', 'label');
    await api.deleteAppointmentType(id);
    const bautag = await type('Bautag');
    await expectError(api.deleteAppointmentType(bautag.id), 'rule');
    await api.archiveAppointmentType(bautag.id, bautag.version);
    expect((await type('Bautag')).archived_at).not.toBeNull();
    // archivierte Arten stehen für neue Termine nicht mehr zur Auswahl
    await expectError(
      api.createAppointment({
        type_id: bautag.id,
        title: 'x',
        starts_at: inDays(5),
        format: 'vor_ort',
        location: 'Lager',
      }),
      'validation',
      'type_id',
    );
  });

  it('legt Plenum-Funktionen nur beim Anlegen fest', async () => {
    const plenum = await type('Plenum');
    expect(plenum.has_plenum_features).toBe(true);
    await api.updateAppointmentType(plenum.id, {
      label: 'Plenum',
      default_topic_id: plenum.default_topic_id,
      default_format: 'hybrid',
      default_location: 'Lager',
      color: '#F062C0',
      // @ts-expect-error has_plenum_features ist nach dem Anlegen nicht mehr Teil der Eingabe
      has_plenum_features: false,
      version: plenum.version,
    });
    const after = await type('Plenum');
    expect([after.has_plenum_features, after.default_format]).toEqual([true, 'hybrid']);
  });
});

describe('Termin-Erinnerungen (6.2)', () => {
  const a = {
    id: 'a',
    title: 'Plenum',
    starts_at: new Date(2026, 9, 15, 19, 0).toISOString(),
    format: 'online' as const,
    online_url: 'https://meet.example.org/x',
    status: 'geplant' as const,
  };
  const kinds = (now: Date) =>
    appointmentReminderMessages([{ appointment: a, recipientIds: ['m'] }], now).map(
      (m) => m.dedupe_key.split(':')[0],
    );

  it('kommen 3 Tage und 1 Stunde vorher, bei online mit Link', () => {
    expect(kinds(new Date(2026, 9, 11, 12, 0))).toEqual([]);
    expect(kinds(new Date(2026, 9, 12, 19, 0))).toEqual(['termin_erinnerung_tage']);
    expect(kinds(new Date(2026, 9, 15, 18, 5))).toEqual(['termin_erinnerung_stunde']);
    expect(kinds(new Date(2026, 9, 15, 19, 5))).toEqual([]);
    const [m] = appointmentReminderMessages(
      [{ appointment: a, recipientIds: ['m'] }],
      new Date(2026, 9, 15, 18, 5),
    );
    expect(m!.text).toBe('Gleich: Plenum um 19:00 Uhr. Link: https://meet.example.org/x');
  });

  it('gehen an Zusagen und alle ohne Antwort, nicht an Absagen', () => {
    expect(
      yesAndOpen(
        [
          { member_id: 'a', answer: 'ja' },
          { member_id: 'b', answer: 'nein' },
        ],
        ['a', 'b', 'c'],
      ),
    ).toEqual(['a', 'c']);
  });
});
