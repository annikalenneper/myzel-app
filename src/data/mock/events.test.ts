// Phase 4 – Veranstaltungen ausgebaut: Detailbereiche, Booking, Hauptverantwortliche, Schichtplan, Nachbereitung
// Mit MYZEL_API=server laufen dieselben Tests gegen die echten Server-Funktionen auf PGlite (Schritt C, Phase 4).
import { beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../../shared/errors';
import { sectionSummaries, suggestsFollowUp, emptyEventDetails } from '../../shared/rules/eventDetails';
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
const eventId = async (title: string) => (await api.listEvents()).find((e) => e.title === title)!.id;
const detail = async (title = 'Winterrave') => api.getEventDetail(await eventId(title));
const memberId = async (name: string) => (await api.listMembers()).find((m) => m.display_name === name)!.id;

beforeEach(async () => {
  clock = new Date(2026, 9, 11, 12, 0, 0);
  api =
    process.env.MYZEL_API === 'server'
      ? await (await import('../../../server/api/serverApi')).createServerApi({ now: () => clock })
      : createMockApi({ storage: memoryStorage(), now: () => clock });
  await login('mo');
});

describe('Detailbereiche (F-VER-04, WF-VER-08)', () => {
  it('zeigen Kurzzusammenfassungen; offene Punkte sind markiert', async () => {
    const rave = await detail();
    const byKey = Object.fromEntries(rave.summaries.map((s) => [s.section, s]));
    expect(byKey.location).toEqual({
      section: 'location',
      text: 'Halle am Kanal · Angefragt · bis 300 Personen',
      open: true,
    });
    expect(byKey.booking).toMatchObject({ text: '1 zugesagt · 2 angefragt', open: true });
    expect(byKey.bar!.text).toBe('Machen wir selbst · Liste im Drive');
    expect(byKey.entry!.text).toBe('Spende 5–10 €');
    // der Bereich „Rahmen“ entfällt (Rückmeldung vom 22.10.2026)
    expect(byKey.frame).toBeUndefined();
    expect(byKey.retrospective!.text).toBe('—');
  });

  it('speichern feldweise mit Versionsprüfung und Historie alt → neu', async () => {
    const rave = await detail();
    await api.updateEventDetail(rave.id, {
      field: 'location.confirmation',
      value: 'zugesagt',
      version: rave.version,
    });
    const after = await detail();
    expect(after.details.location.confirmation).toBe('zugesagt');
    expect(after.version).toBe(rave.version + 1);
    expect(after.summaries.find((s) => s.section === 'location')!.open).toBe(false);
    // derselbe alte Stand noch einmal: kein stilles Überschreiben
    await expectError(
      api.updateEventDetail(rave.id, {
        field: 'location.name',
        value: 'Andere Halle',
        version: rave.version,
      }),
      'conflict',
    );
  });

  it('prüfen jeden Wert gegen sein Feld – mit deutscher Meldung am Feld', async () => {
    const rave = await detail();
    await expectError(
      api.updateEventDetail(rave.id, { field: 'location.capacity', value: -3, version: rave.version }),
      'validation',
      'location.capacity',
    );
    await expectError(
      api.updateEventDetail(rave.id, {
        field: 'location.confirmation',
        value: 'vielleicht',
        version: rave.version,
      }),
      'validation',
    );
  });

  it('leere Eingabe löscht ein kurzes Feld', async () => {
    const rave = await detail();
    await api.updateEventDetail(rave.id, {
      field: 'bar.drinks_planning',
      value: '  ',
      version: rave.version,
    });
    expect((await detail()).details.bar.drinks_planning).toBeNull();
  });
});

describe('Booking', () => {
  it('Acts eintragsweise hinzufügen, bearbeiten und entfernen – mit Rückgängig', async () => {
    const rave = await detail();
    const { id, undo_token } = await api.addBooking(rave.id, {
      act_name: 'Myzelium Soundsystem',
      act_type: 'band',
    });
    expect((await detail()).bookings).toHaveLength(4);
    await api.undo(undo_token);
    expect((await detail()).bookings).toHaveLength(3);

    const again = await api.addBooking(rave.id, { act_name: 'Myzelium Soundsystem', act_type: 'band' });
    const booking = (await detail()).bookings.find((b) => b.id === again.id)!;
    await api.updateBooking(booking.id, { ...booking, status: 'zugesagt', version: booking.version });
    await expectError(api.updateBooking(booking.id, { ...booking, version: booking.version }), 'conflict');
    // ein inzwischen bearbeiteter Act verschwindet nicht durch das alte Rückgängig
    await expectError(api.undo(again.undo_token), 'rule');

    const removed = await api.removeBooking(booking.id);
    expect((await detail()).bookings.some((b) => b.id === booking.id)).toBe(false);
    await api.undo(removed.undo_token);
    expect((await detail()).bookings.find((b) => b.id === booking.id)!.status).toBe('zugesagt');
    expect(id).not.toBe(again.id);
  });

  it('verlangt Name und Art', async () => {
    const rave = await detail();
    await expectError(api.addBooking(rave.id, { act_name: ' ', act_type: 'dj' }), 'validation', 'act_name');
  });

  it('Gage: Betrag nur bei „ja“ – sonst fällt er weg', async () => {
    const rave = await detail();
    const { id } = await api.addBooking(rave.id, {
      act_name: 'Pilzkapelle',
      act_type: 'band',
      fee_status: 'nein',
      fee: '100 €',
    });
    const act = () => detail().then((d) => d.bookings.find((b) => b.id === id)!);
    expect(await act()).toMatchObject({ fee_status: 'nein', fee: null });
    const before = await act();
    await api.updateBooking(id, { ...before, fee_status: 'ja', fee: '100 €', version: before.version });
    expect(await act()).toMatchObject({ fee_status: 'ja', fee: '100 €' });
  });
});

describe('Hauptverantwortliche (WF-VER-09) und Deaktivieren (WF-ADM-03)', () => {
  it('werden einzeln ein- und ausgetragen, mit Rückgängig', async () => {
    const rave = await detail();
    const jule = await memberId('Jule');
    await api.addEventLead(rave.id, jule);
    expect((await detail()).lead_ids).toEqual([await memberId('Lea'), jule]);
    const { undo_token } = await api.removeEventLead(rave.id, jule);
    expect((await detail()).lead_ids).not.toContain(jule);
    await api.undo(undo_token);
    expect((await detail()).lead_ids).toContain(jule);
  });

  it('Deaktivieren trägt die Person überall als Hauptverantwortliche aus', async () => {
    const lea = await memberId('Lea');
    expect((await api.getDeactivationImpact(lea)).lead_count).toBe(1);
    const impact = await api.deactivateMember(lea);
    expect(impact.lead_count).toBe(1);
    expect((await detail()).lead_ids).toEqual([]);
  });

  it('deaktivierte Personen lassen sich nicht eintragen', async () => {
    const tarek = (await api.listMembers()).find((m) => m.display_name === 'Tarek')!;
    await expectError(api.addEventLead((await detail()).id, tarek.id), 'rule');
  });
});

describe('Aufbau, Abbau, Schichtplan', () => {
  it('Aufbau liegt vor dem Beginn, Abbau nicht vor dem Ende', async () => {
    const rave = await detail();
    const base = {
      title: rave.title,
      type: rave.type,
      starts_at: rave.starts_at,
      ends_at: rave.ends_at,
      description: rave.description,
      version: rave.version,
    };
    const later = new Date(new Date(rave.starts_at).getTime() + 3_600_000).toISOString();
    await expectError(api.updateEvent(rave.id, { ...base, setup_at: later }), 'validation', 'setup_at');
    await expectError(
      api.updateEvent(rave.id, { ...base, teardown_at: rave.starts_at }),
      'validation',
      'teardown_at',
    );
    const after = new Date(new Date(rave.ends_at!).getTime() + 2 * 3_600_000).toISOString();
    await api.updateEvent(rave.id, { ...base, teardown_at: after });
    expect((await detail()).teardown_at).toBe(after);
  });

  it('Schichtplan als verknüpftes Dokument (WF-VER-11)', async () => {
    const rave = await detail();
    const doc = (await api.listDocuments())[0]!;
    await api.setShiftPlan(rave.id, doc.id, rave.version);
    expect((await detail()).shift_plan_document?.title).toBe(doc.title);
  });
});

describe('Nachbereitung (4.2, WF-VER-07)', () => {
  it('schlägt „In Nachbereitung“ erst am Tag nach einer bestätigten Veranstaltung vor', () => {
    const event = {
      status: 'bestaetigt' as const,
      starts_at: '2026-10-10T20:00:00.000Z',
      ends_at: '2026-10-11T02:00:00.000Z',
    };
    expect(suggestsFollowUp(event, new Date(2026, 9, 11, 18))).toBe(false);
    expect(suggestsFollowUp(event, new Date(2026, 9, 12, 8))).toBe(true);
    expect(suggestsFollowUp({ ...event, status: 'in_planung' }, new Date(2026, 9, 12, 8))).toBe(false);
  });

  it('die Liste kennt den Beginn der Nachbereitung', async () => {
    const soli = (await api.listEvents()).find((e) => e.title === 'Soli-Tresen Sporenflug')!;
    expect(soli.status).toBe('in_nachbereitung');
    expect(soli.follow_up_since).not.toBeNull();
  });

  it('leere Bereiche haben keine offenen Punkte', () => {
    expect(sectionSummaries(emptyEventDetails('x'), []).every((s) => s.text === '—' && !s.open)).toBe(true);
  });
});

describe('Befunde aus dem Review (18.10.2026)', () => {
  it('feldweises Locking: parallel in anderen Feldern geht, dasselbe Feld meldet einen Konflikt', async () => {
    const rave = await detail();
    await login('jule');
    await api.updateEventDetail(rave.id, {
      field: 'bar.notes',
      value: 'Pfand 2 €',
      expected: null,
      version: rave.version,
    });
    await login('mo');
    // anderes Feld, alter Stand: kein Konflikt
    await api.updateEventDetail(rave.id, {
      field: 'entry.price',
      value: '8 €',
      expected: rave.details.entry.price,
      version: (await detail()).version,
    });
    // dasselbe Feld, ausgehend vom alten Wert: Konflikt statt stillem Überschreiben
    await expectError(
      api.updateEventDetail(rave.id, {
        field: 'bar.notes',
        value: 'Kein Pfand',
        expected: null,
        version: (await detail()).version,
      }),
      'conflict',
    );
    expect((await detail()).details.bar.notes).toBe('Pfand 2 €');
  });

  it('schnelle eigene Folgetipps auf dasselbe Feld stoßen sich nicht an sich selbst', async () => {
    const rave = await detail();
    const first = api.updateEventDetail(rave.id, {
      field: 'location.confirmation',
      value: 'zugesagt',
      expected: 'angefragt',
      version: rave.version,
    });
    await first;
    // der zweite Tipp ging noch vom alten Stand aus
    await api.updateEventDetail(rave.id, {
      field: 'location.confirmation',
      value: 'vertrag',
      expected: 'angefragt',
      version: (await detail()).version,
    });
    expect((await detail()).details.location.confirmation).toBe('vertrag');
  });

  it('Rückgängig bringt eine inzwischen deaktivierte Person nicht als Hauptverantwortliche zurück', async () => {
    const rave = await detail();
    const lea = await memberId('Lea');
    const { undo_token } = await api.removeEventLead(rave.id, lea);
    await api.deactivateMember(lea);
    await api.undo(undo_token);
    expect((await detail()).lead_ids).toEqual([]);
  });
});
