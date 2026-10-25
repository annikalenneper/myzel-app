// Phase 6 – Serien: Regeln, Erzeugung im Joblauf, Einladung 2 Wochen vorher, Ausnahmen, Bearbeiten, Beenden
import { beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../../shared/errors';
import { ruleChoices, ruleLabel, seriesDates } from '../../shared/rules/series';
import type { AppointmentListItem, MyzelApi } from '../api';
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
const later = (days: number) => (clock = new Date(clock.getTime() + days * 86_400_000));
const expectError = async (promise: Promise<unknown>, code: AppError['code'], field?: string) => {
  const error = (await promise.then(
    () => null,
    (e: unknown) => e,
  )) as AppError | null;
  expect(error?.code).toBe(code);
  if (field) expect(error?.field).toBe(field);
};
const login = (name: string) => api.demo!.signInAs(`${name}@example.org`);
const occurrences = async (): Promise<AppointmentListItem[]> =>
  (await api.listAppointments())
    .filter((a) => a.series)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
const day = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const typeId = async (label: string) => (await api.listAppointmentTypes()).find((t) => t.label === label)!.id;
const fieldsOf = async (seriesId: string) => {
  const s = await api.getSeries(seriesId);
  return {
    type_id: s.type_id,
    title: s.title,
    format: s.format,
    location: s.location,
    online_url: s.online_url,
    start_time: s.start_time,
    end_time: s.end_time,
    rrule: s.rrule,
    valid_from: s.valid_from,
    valid_until: s.valid_until,
    version: s.version,
  };
};

beforeEach(async () => {
  // Sonntag, 11.10.2026
  clock = new Date(2026, 9, 11, 12);
  api = createMockApi({ storage: memoryStorage(), now: () => clock });
  await login('mo');
});

describe('Regeln (F-TER-02)', () => {
  it('bietet zum gewählten Tag eine verständliche Auswahl an', () => {
    expect(ruleChoices('2026-10-17').map((c) => c.label)).toEqual([
      'jeden Samstag',
      'alle 2 Wochen samstags',
      'jeden 3. Samstag im Monat',
      'jeden 17. im Monat',
    ]);
    // der 31.10. ist der letzte Samstag, einen 31. gibt es nicht jeden Monat
    expect(ruleChoices('2026-10-31').map((c) => c.label)).toEqual([
      'jeden Samstag',
      'alle 2 Wochen samstags',
      'jeden letzten Samstag im Monat',
    ]);
    expect(ruleLabel('FREQ=MONTHLY;BYDAY=SA;BYSETPOS=3')).toBe('jeden 3. Samstag im Monat');
    expect(ruleLabel('FREQ=YEARLY')).toBe('Wiederkehrend');
  });

  it('berechnet die Tage der Serie', () => {
    expect(seriesDates('FREQ=MONTHLY;BYDAY=SA;BYSETPOS=3', '2026-10-01', '2026-10-01', '2027-01-31')).toEqual(
      ['2026-10-17', '2026-11-21', '2026-12-19', '2027-01-16'],
    );
    expect(seriesDates('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU', '2026-10-13', '2026-10-20', '2026-11-11')).toEqual([
      '2026-10-27',
      '2026-11-10',
    ]);
    expect(
      seriesDates('FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1', '2026-10-01', '2026-10-01', '2026-11-30'),
    ).toEqual(['2026-10-30', '2026-11-27']);
  });
});

describe('Bautag-Serie im Joblauf (3.6)', () => {
  it('legt Termine bis 3 Monate im Voraus an – je Tag einmal – und lädt erst 2 Wochen vorher ein', async () => {
    const first = await occurrences();
    // Serie ab 22.11.: 3. Samstag im Dezember und Januar liegen im Horizont bis 11.01.
    expect(first.map((a) => day(a.starts_at))).toEqual(['2026-12-19']);
    expect(first[0]).toMatchObject({ title: 'Bautag', location: 'Lager', type_label: 'Bautag' });
    expect(first[0]!.series?.label).toBe('jeden 3. Samstag im Monat');

    await api.demo!.runJobNow();
    await api.demo!.runJobNow();
    expect(await occurrences()).toHaveLength(1);

    later(30);
    await api.demo!.runJobNow();
    expect((await occurrences()).map((a) => day(a.starts_at))).toEqual(['2026-12-19', '2027-01-16']);
    const history = (await api.getAppointment((await occurrences())[1]!.id)) as unknown as {
      created_by: string;
    };
    expect(history.created_by).toBe((await api.listMembers()).find((m) => m.is_system)!.id);

    // noch 39 Tage bis zum 19.12.: keine Einladung
    const invites = async () =>
      (await api.demo!.myMessages()).filter((m) => m.text.startsWith('Bautag am')).length;
    expect(await invites()).toBe(0);
    // 10.11. + 26 Tage = 6.12.: der 19.12. liegt jetzt innerhalb von 2 Wochen
    later(26);
    await api.demo!.runJobNow();
    expect(await invites()).toBe(1);
    const before = await invites();
    await api.demo!.runJobNow();
    expect(await invites()).toBe(before);
  });

  it('legt beim Anlegen sofort an und lädt zu allem in den nächsten 2 Wochen ein, nicht die anlegende Person', async () => {
    const { id, created } = await api.createSeries({
      type_id: await typeId('Plenum'),
      title: 'Plenum',
      format: 'online',
      online_url: 'https://meet.example.org/plenum',
      start_time: '19:00',
      end_time: '21:00',
      rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU',
      valid_from: '2026-10-13',
    });
    // 13.10. bis 11.01. alle 2 Wochen dienstags
    expect(created).toBe(7);
    const s = await api.getSeries(id);
    expect(s.label).toBe('alle 2 Wochen dienstags');
    expect(s.upcoming).toHaveLength(7);
    expect((await api.demo!.myMessages()).some((m) => m.text.startsWith('Plenum am'))).toBe(false);
    await login('lea');
    // eingeladen ist nur, was in den nächsten 2 Wochen liegt: der 13.10. (der 27.10. ist 16 Tage hin)
    expect((await api.demo!.myMessages()).filter((m) => m.text.startsWith('Plenum am'))).toHaveLength(1);
  });

  it('prüft die Eingaben', async () => {
    const base = {
      type_id: await typeId('Bautag'),
      title: 'Bautag',
      format: 'vor_ort' as const,
      location: 'Lager',
      start_time: '10:00',
      rrule: 'FREQ=MONTHLY;BYDAY=SA;BYSETPOS=3',
      valid_from: '2026-10-17',
    };
    await expectError(api.createSeries({ ...base, end_time: '09:00' }), 'validation', 'end_time');
    await expectError(api.createSeries({ ...base, valid_until: '2026-10-01' }), 'validation', 'valid_until');
    await expectError(api.createSeries({ ...base, rrule: 'FREQ=DAILY' }), 'validation', 'rrule');
    await expectError(api.createSeries({ ...base, location: '' }), 'validation', 'location');
  });
});

describe('Ausnahmen, Bearbeiten und Beenden (F-TER-03, WF-TER-09, -10)', () => {
  const plenum = async () => {
    const { id } = await api.createSeries({
      type_id: await typeId('Plenum'),
      title: 'Plenum',
      format: 'online',
      online_url: 'https://meet.example.org/plenum',
      start_time: '19:00',
      end_time: '21:00',
      rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU',
      valid_from: '2026-10-13',
    });
    return id;
  };
  const ofSeries = async (id: string) => (await occurrences()).filter((a) => a.series?.id === id);

  it('ein einzeln verschobener Termin ist eine Ausnahme, die die Serie in Ruhe lässt', async () => {
    const id = await plenum();
    const [first, second] = await ofSeries(id);
    await api.updateAppointment(first!.id, {
      type_id: first!.type_id,
      title: first!.title,
      starts_at: new Date(2026, 9, 14, 19).toISOString(),
      ends_at: null,
      format: 'online',
      online_url: first!.online_url,
      version: first!.version,
    });
    await api.cancelAppointment(second!.id, second!.version);
    const s = await api.getSeries(id);
    expect(s.upcoming.filter((u) => u.is_exception)).toHaveLength(1);

    await api.updateSeries(id, { ...(await fieldsOf(id)), start_time: '18:30' });
    const after = await ofSeries(id);
    expect(new Date(after[0]!.starts_at).getHours()).toBe(19);
    expect(after.find((a) => a.id === second!.id)!.status).toBe('abgesagt');
    expect(after.slice(2).every((a) => new Date(a.starts_at).getMinutes() === 30)).toBe(true);
    // die verschobene Ausnahme wird nicht neu angelegt
    expect(after.filter((a) => a.series_date === first!.series_date)).toHaveLength(1);
  });

  it('geänderte Uhrzeit benachrichtigt Eingeladene; Zusagen bleiben', async () => {
    const id = await plenum();
    const [first] = await ofSeries(id);
    await login('lea');
    await api.setRsvp(first!.id, 'ja');
    await login('mo');
    const { notified } = await api.updateSeries(id, { ...(await fieldsOf(id)), start_time: '18:00' });
    // eingeladen ist nur der erste Termin
    expect(notified).toBeGreaterThan(0);
    expect((await api.getAppointment(first!.id)).yes_ids).toContain(
      (await api.listMembers()).find((m) => m.display_name === 'Lea')!.id,
    );
    await login('lea');
    expect(
      (await api.demo!.myMessages()).some((m) => m.text.startsWith('Plenum wurde geändert: jetzt')),
    ).toBe(true);
  });

  it('eine geänderte Regel sagt eingeladene Termine ab und nimmt die übrigen still heraus', async () => {
    const id = await plenum();
    const before = await ofSeries(id);
    await api.updateSeries(id, { ...(await fieldsOf(id)), rrule: 'FREQ=MONTHLY;BYDAY=TU;BYSETPOS=1' });
    const after = await ofSeries(id);
    // 13.10. war eingeladen und fällt weg (1. Dienstag im Oktober ist der 6.): abgesagt
    expect(after.find((a) => a.id === before[0]!.id)?.status).toBe('abgesagt');
    // nicht eingeladene verschwinden, neue Tage kommen hinzu
    expect(after.some((a) => a.id === before[4]!.id)).toBe(false);
    expect(after.filter((a) => a.status === 'geplant').map((a) => day(a.starts_at))).toEqual([
      '2026-11-03',
      '2026-12-01',
      '2027-01-05',
    ]);
  });

  it('Beenden: künftige Termine entfallen, Ausnahmen bleiben, danach entsteht nichts mehr', async () => {
    const id = await plenum();
    const [first] = await ofSeries(id);
    await api.updateAppointment(first!.id, {
      type_id: first!.type_id,
      title: 'Plenum mit Gästen',
      starts_at: first!.starts_at,
      ends_at: first!.ends_at,
      format: 'online',
      online_url: first!.online_url,
      version: first!.version,
    });
    const s = await api.getSeries(id);
    await api.endSeries(id, s.version);
    const left = (await ofSeries(id)).filter((a) => a.status === 'geplant');
    expect(left.map((a) => a.title)).toEqual(['Plenum mit Gästen']);
    expect((await api.getSeries(id)).active).toBe(false);
    later(40);
    await api.demo!.runJobNow();
    const future = (await ofSeries(id)).filter((a) => new Date(a.starts_at).getTime() > clock.getTime());
    expect(future).toHaveLength(0);
    await expectError(api.updateSeries(id, await fieldsOf(id)), 'rule');
  });

  it('kein stilles Überschreiben und keine andere Terminart', async () => {
    const id = await plenum();
    const fields = await fieldsOf(id);
    await api.updateSeries(id, { ...fields, title: 'Plenum (online)' });
    await expectError(api.updateSeries(id, { ...fields, title: 'Plenum neu' }), 'conflict');
    await expectError(
      api.updateSeries(id, { ...(await fieldsOf(id)), type_id: await typeId('Bautag') }),
      'rule',
    );
  });
});

describe('Nachbesserungen aus dem Review (Phase 6)', () => {
  const weekly = async (rrule = 'FREQ=WEEKLY;BYDAY=TU', valid_from = '2026-10-13') =>
    (
      await api.createSeries({
        type_id: await typeId('Sonstiges'),
        title: 'Treffen',
        format: 'online',
        online_url: 'https://meet.example.org/treffen',
        start_time: '19:00',
        rrule,
        valid_from,
      })
    ).id;
  const planned = async (id: string) =>
    (await occurrences())
      .filter(
        (a) =>
          a.series?.id === id && a.status === 'geplant' && new Date(a.starts_at).getTime() > clock.getTime(),
      )
      .map((a) => day(a.starts_at));

  it('weggefallene Tage kommen zurück, wenn die Serie sie wieder vorsieht', async () => {
    const id = await weekly();
    const all = await planned(id);
    await api.updateSeries(id, { ...(await fieldsOf(id)), valid_until: '2026-11-30' });
    expect((await planned(id)).length).toBeLessThan(all.length);
    await api.updateSeries(id, { ...(await fieldsOf(id)), valid_until: null });
    expect(await planned(id)).toEqual(all);
  });

  it('„alle 2 Wochen“ behält beim Wechsel den nächsten Termin', async () => {
    const id = await weekly();
    expect((await planned(id))[0]).toBe('2026-10-13');
    await api.updateSeries(id, { ...(await fieldsOf(id)), rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU' });
    expect((await planned(id)).slice(0, 3)).toEqual(['2026-10-13', '2026-10-27', '2026-11-10']);
    await expectError(api.updateSeries(id, { ...(await fieldsOf(id)), valid_from: '2026-10-20' }), 'rule');
  });

  it('verknüpfte Termine verschwinden durch die Serie nicht still, sie werden abgesagt', async () => {
    const id = await weekly('FREQ=WEEKLY;BYDAY=TU', '2026-11-03');
    const later_ = (await occurrences()).find(
      (a) => a.series?.id === id && day(a.starts_at) === '2026-12-01',
    )!;
    const topic = (await api.listTopics()).find((t) => !t.archived_at)!;
    await api.createTask({ title: 'Schlüssel abholen', topic_id: topic.id, appointment_id: later_.id });
    await api.endSeries(id, (await api.getSeries(id)).version);
    const after = (await api.listAppointments()).find((a) => a.id === later_.id)!;
    expect(after.status).toBe('abgesagt');
    // die übrigen, mit nichts verbundenen sind still entfernt; die Serie endet nicht vor ihrem Beginn
    expect(await planned(id)).toEqual(['2026-11-03']);
    expect((await api.getSeries(id)).valid_until).toBe('2026-11-03');
  });

  it('Zusagen vor der Einladung erfahren von einer neuen Uhrzeit; eingeladen wird nur, wer noch nicht geantwortet hat', async () => {
    const id = await weekly('FREQ=WEEKLY;BYDAY=TU', '2026-11-17');
    const first = (await occurrences()).find((a) => a.series?.id === id)!;
    await login('lea');
    await api.setRsvp(first.id, 'ja');
    await login('mo');
    expect((await api.updateSeries(id, { ...(await fieldsOf(id)), start_time: '18:00' })).notified).toBe(1);
    await login('lea');
    expect((await api.demo!.myMessages()).some((m) => m.text.startsWith('Treffen wurde geändert'))).toBe(
      true,
    );
    // 3 Wochen später liegt der 17.11. in der Einladungsfrist: Lea hat geantwortet, Mo hat die Serie angelegt
    later(24);
    await api.demo!.runJobNow();
    expect(
      (await api.demo!.myMessages()).filter(
        (m) => m.event_type === 'termin_einladung' && m.link.endsWith(first.id),
      ),
    ).toHaveLength(0);
    await login('mo');
    expect(
      (await api.demo!.myMessages()).filter(
        (m) => m.event_type === 'termin_einladung' && m.link.endsWith(first.id),
      ),
    ).toHaveLength(0);
    await login('jule');
    expect(
      (await api.demo!.myMessages()).filter(
        (m) => m.event_type === 'termin_einladung' && m.link.endsWith(first.id),
      ).length,
    ).toBeGreaterThan(0);
  });

  it('der neue Takt richtet sich nach dem nächsten Termin, nach dem das Formular die Auswahl zeigt', async () => {
    const id = await weekly('FREQ=MONTHLY;BYMONTHDAY=15', '2026-09-15');
    later(8); // Mo 19.10.: nächster Termin So 15.11.
    expect((await planned(id))[0]).toBe('2026-11-15');
    await api.updateSeries(id, { ...(await fieldsOf(id)), rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=SU' });
    const after = await planned(id);
    expect(after).toContain('2026-11-15');
    expect(after).toContain('2026-11-29');
    expect(after).not.toContain('2026-11-22');
    expect(after).not.toContain('2026-11-08');
  });

  it('wer nicht eingeladen ist, bekommt keine Absage zu einem Termin, von dem niemand gehört hat', async () => {
    const id = await weekly('FREQ=WEEKLY;BYDAY=TU', '2026-11-17');
    // der erste Tag findet auch nach dem Beenden statt – betroffen ist der zweite
    const first = (await occurrences()).filter((a) => a.series?.id === id)[1]!;
    await api.createTask({
      title: 'Beamer mitbringen',
      topic_id: (await api.listTopics())[0]!.id,
      appointment_id: first.id,
    });
    await login('lea');
    await api.setRsvp(first.id, 'ja');
    await login('mo');
    const { notified } = await api.endSeries(id, (await api.getSeries(id)).version);
    expect(notified).toBe(1);
    expect((await api.listAppointments()).find((a) => a.id === first.id)!.status).toBe('abgesagt');
    await login('jule');
    expect((await api.demo!.myMessages()).some((m) => m.text.startsWith('Treffen am'))).toBe(false);
  });

  it('eine Serie, die noch nicht begonnen hat, endet an ihrem ersten Tag – der findet statt', async () => {
    const id = await weekly('FREQ=WEEKLY;BYDAY=TU', '2026-11-17');
    await api.endSeries(id, (await api.getSeries(id)).version);
    expect(await planned(id)).toEqual(['2026-11-17']);
  });

  it('kommt ein abgesagter Serientermin zurück, heißt es „findet doch statt“', async () => {
    const id = await weekly();
    const first = (await occurrences()).find((a) => a.series?.id === id)!;
    await api.updateSeries(id, { ...(await fieldsOf(id)), rrule: 'FREQ=WEEKLY;BYDAY=WE' });
    expect((await api.listAppointments()).find((a) => a.id === first.id)!.status).toBe('abgesagt');
    // die Testansicht zeigt die neuesten 8 Nachrichten
    later(1 / 1440);
    await api.updateSeries(id, { ...(await fieldsOf(id)), rrule: 'FREQ=WEEKLY;BYDAY=TU' });
    expect((await api.listAppointments()).find((a) => a.id === first.id)!.status).toBe('geplant');
    await login('lea');
    expect((await api.demo!.myMessages()).some((m) => m.text.startsWith('Treffen findet doch statt'))).toBe(
      true,
    );
  });

  it('der Horizont endet am Monatsende nicht im übernächsten Monat', async () => {
    const { seriesHorizon } = await import('../../shared/rules/series');
    expect(seriesHorizon('2026-11-30', null)).toBe('2027-02-28');
    expect(seriesHorizon('2026-10-11', null)).toBe('2027-01-11');
  });
});
