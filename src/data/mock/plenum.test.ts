// Phase 3 – Plenum: Ergebnis, Protokoll, Abschluss (F-PLE-04, 16.2). Die Agenda ist eine eigene Ansicht (16.1).
// Mit MYZEL_API=server laufen dieselben Tests gegen die echten Server-Funktionen auf PGlite (Schritt C, Phase 3).
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
let plenumId: string;
const login = (name: string) => api.demo!.signInAs(`${name}@example.org`);
const expectError = async (promise: Promise<unknown>, code: AppError['code']) => {
  const error = (await promise.then(
    () => null,
    (e: unknown) => e,
  )) as AppError | null;
  expect(error?.code).toBe(code);
};
const inDays = (days: number, hour = 19) =>
  new Date(clock.getFullYear(), clock.getMonth(), clock.getDate() + days, hour).toISOString();
const plenum = () => api.getPlenum(plenumId);
const member = async (name: string) => (await api.listMembers()).find((m) => m.display_name === name)!;

beforeEach(async () => {
  clock = new Date(2026, 9, 11, 12, 0, 0);
  api =
    process.env.MYZEL_API === 'server'
      ? await (await import('../../../server/api/serverApi')).createServerApi({ now: () => clock })
      : createMockApi({ storage: memoryStorage(), now: () => clock });
  await login('mo');
  plenumId = (await api.listAppointments()).find((a) => a.title === 'Plenum Oktober')!.id;
});

describe('Protokoll (WF-PLE-03)', () => {
  it('speichert protokollierende Person, Notizen und Drive-Protokoll mit Versionsprüfung', async () => {
    const lea = await member('Lea');
    const doc = (await api.listDocuments()).find((d) => d.title === 'Protokoll Plenum September')!;
    const p = await plenum();
    await api.updateProtocol(plenumId, {
      protocol_member_id: lea.id,
      notes: 'Moderation: Lea.',
      protocol_document_id: doc.id,
      version: p.version,
    });
    const after = await plenum();
    expect(after.protocol_member_id).toBe(lea.id);
    expect(after.notes).toBe('Moderation: Lea.');
    expect(after.protocol_document?.title).toBe('Protokoll Plenum September');
    await expectError(
      api.updateProtocol(plenumId, {
        protocol_member_id: null,
        notes: null,
        protocol_document_id: null,
        version: p.version,
      }),
      'conflict',
    );
  });
});

describe('Plenum abschließen (WF-PLE-20, F-PLE-04)', () => {
  it('geht erst nach Beginn', async () => {
    const p = await plenum();
    await expectError(api.closePlenum(plenumId, [], p.version), 'rule');
  });

  it('setzt „abgeschlossen“, hält die Teilnahme fest und schickt die Zusammenfassung an alle', async () => {
    const type = (await api.listAppointmentTypes()).find((t) => t.label === 'Plenum')!;
    const { id } = await api.createAppointment({
      type_id: type.id,
      title: 'Plenum Sondersitzung',
      starts_at: inDays(0, 10),
      format: 'online',
      online_url: 'https://meet.example.org/myzel',
    });
    plenumId = id;
    const lea = await member('Lea');
    const { recipients } = await api.closePlenum(
      plenumId,
      [lea.id, (await member('Mo')).id],
      (await plenum()).version,
    );
    const closed = await plenum();
    expect(closed.status).toBe('abgeschlossen');
    expect(closed.attendee_ids).toHaveLength(2);
    expect(closed.summary_recipients).toBe(recipients);
    expect(recipients).toBe((await api.listMembers()).filter((m) => m.active && !m.is_system).length);
    await login('jule');
    const summary = (await api.demo!.myMessages()).find((m) => m.event_type === 'plenum_zusammenfassung')!;
    expect(summary.text).toContain('Plenum Sondersitzung ist abgeschlossen');
    // ein zweites Mal geht nicht
    await expectError(api.closePlenum(plenumId, [], closed.version), 'rule');
  });
});
