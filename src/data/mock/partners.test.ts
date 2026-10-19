// Phase 4 – Kooperationspartner: anlegen, suchen, verknüpfen, bisherige Veranstaltungen, Plenum, Deaktivieren
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
const login = (name: string) => api.demo!.signInAs(`${name}@example.org`);
const expectError = async (promise: Promise<unknown>, code: AppError['code'], field?: string) => {
  const error = (await promise.then(
    () => null,
    (e: unknown) => e,
  )) as AppError | null;
  expect(error?.code).toBe(code);
  if (field) expect(error?.field).toBe(field);
};
const partner = async (name: string) => (await api.listPartners()).find((p) => p.name === name)!;
const eventId = async (title: string) => (await api.listEvents()).find((e) => e.title === title)!.id;
const memberId = async (name: string) => (await api.listMembers()).find((m) => m.display_name === name)!.id;

beforeEach(async () => {
  api = createMockApi({ storage: memoryStorage(), now: () => new Date(2026, 9, 11, 12) });
  await login('mo');
});

describe('Partner (F-VER-05, WF-VER-13)', () => {
  it('zeigt im Detail die bisherigen Veranstaltungen, neueste zuerst', async () => {
    const sporenflug = await api.getPartner((await partner('Kollektiv Sporenflug')).id);
    expect(sporenflug.event_count).toBe(3);
    expect(sporenflug.events.map((e) => e.title)).toEqual([
      'Winterrave',
      'Soli-Tresen Sporenflug',
      'Hoffest',
    ]);
    expect(sporenflug.events[0]!.role_note).toBe('Line-up und Deko');
  });

  it('anlegen verlangt einen eindeutigen Namen und eine gültige Mail', async () => {
    await expectError(api.createPartner({ name: ' ' }), 'validation', 'name');
    await expectError(api.createPartner({ name: 'kollektiv sporenflug' }), 'validation', 'name');
    await expectError(api.createPartner({ name: 'Neu', email: 'keine-mail' }), 'validation', 'email');
    const { id } = await api.createPartner({ name: 'Radio Myzel', kind: 'Radio' });
    expect((await api.getPartner(id)).event_count).toBe(0);
  });

  it('bearbeiten mit Versionsprüfung', async () => {
    const p = await partner('Druckerei Tinte & Tusche');
    await api.updatePartner(p.id, { ...p, phone: '0123 999', version: p.version });
    expect((await api.getPartner(p.id)).phone).toBe('0123 999');
    await expectError(api.updatePartner(p.id, { ...p, version: p.version }), 'conflict');
  });

  it('ist über die Suche zu finden', async () => {
    const groups = await api.search('Sporen');
    expect(groups.find((g) => g.key === 'partner')!.items[0]).toMatchObject({
      title: 'Kollektiv Sporenflug',
      meta: 'Kollektiv · 3 Veranstaltungen',
    });
  });
});

describe('Verknüpfen mit Veranstaltungen (WF-VER-10)', () => {
  it('eintragsweise, mit Rolle und Rückgängig; die Veranstaltung zeigt die Partner', async () => {
    const workshop = await eventId('Siebdruck-Workshop');
    const verein = await partner('Nachbarschaftsverein Hafenviertel');
    const { undo_token } = await api.linkPartner(workshop, verein.id, 'Raum und Werbung');
    const detail = await api.getEventDetail(workshop);
    expect(detail.partners).toEqual([
      { id: verein.id, name: verein.name, kind: 'Verein', role_note: 'Raum und Werbung', event_count: 1 },
    ]);
    expect(detail.summaries.find((s) => s.section === 'partner')!.text).toBe(
      'Nachbarschaftsverein Hafenviertel',
    );
    await api.undo(undo_token);
    expect((await api.getEventDetail(workshop)).partners).toEqual([]);

    const rave = await eventId('Winterrave');
    const sporenflug = await partner('Kollektiv Sporenflug');
    const removed = await api.unlinkPartner(rave, sporenflug.id);
    expect((await api.getPartner(sporenflug.id)).event_count).toBe(2);
    await api.undo(removed.undo_token);
    expect((await api.getPartner(sporenflug.id)).events[0]!.role_note).toBe('Line-up und Deko');
  });
});

describe('Fürs Plenum (3.14, P4)', () => {
  it('Partner lassen sich markieren und im Plenum besprechen oder mit einer Aufgabe versehen', async () => {
    const p = await partner('Druckerei Tinte & Tusche');
    await api.setMark('partner', p.id, true);
    const plenumId = (await api.listAppointments()).find((a) => a.title === 'Plenum Oktober')!.id;
    const item = (await api.getPlenum(plenumId)).agenda.find((a) => a.target === 'partner')!;
    expect(item.label).toBe('Partner · Firma · 1 Veranstaltung');
    await api.plenumAction(plenumId, {
      kind: 'sub_task',
      target: 'partner',
      id: p.id,
      title: 'Rechnung nachfragen',
    });
    expect(
      (await api.listTasks()).some((t) => t.title === 'Rechnung nachfragen' && t.status === 'geplant'),
    ).toBe(true);
    await api.plenumAction(plenumId, { kind: 'discussed', target: 'partner', id: p.id });
    expect((await api.getPartner(p.id)).marked).toBe(false);
    expect((await api.getPlenum(plenumId)).results.find((g) => g.group === 'besprochen')!.lines).toEqual([
      'Druckerei Tinte & Tusche',
    ]);
  });
});

describe('Deaktivieren (WF-ADM-03, ab P4)', () => {
  it('trägt die Person als interne Kontaktperson aus', async () => {
    const rana = await memberId('Rana');
    expect((await api.getDeactivationImpact(rana)).partner_contact_count).toBe(1);
    const impact = await api.deactivateMember(rana);
    expect(impact.partner_contact_count).toBe(1);
    expect((await partner('Kollektiv Sporenflug')).internal_contact_member_id).toBeNull();
  });

  it('nur aktive Mitglieder sind als Kontaktperson wählbar', async () => {
    const tarek = (await api.listMembers()).find((m) => m.display_name === 'Tarek')!;
    await expectError(
      api.createPartner({ name: 'Neu', internal_contact_member_id: tarek.id }),
      'validation',
      'internal_contact_member_id',
    );
  });
});
