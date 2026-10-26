// Umbau Phase 8 – Rückmeldung aus der App (16.5): Bug oder Feature-Wunsch, Liste nur für Admins
// Mit MYZEL_API=server laufen dieselben Tests gegen die echten Server-Funktionen auf PGlite.
import { beforeEach, describe, expect, it } from 'vitest';
import type { AppError } from '../../shared/errors';
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
const errorOf = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (e: unknown) => e as AppError,
  );

beforeEach(async () => {
  const clock = new Date(2026, 9, 29, 12, 0, 0);
  api =
    process.env.MYZEL_API === 'server'
      ? await (await import('../../../server/api/serverApi')).createServerApi({ now: () => clock })
      : createMockApi({ storage: memoryStorage(), now: () => clock });
});

describe('Rückmeldung aus der App (16.5)', () => {
  it('jedes Mitglied kann melden; die Person kommt aus der Sitzung', async () => {
    await login('jule');
    const { id } = await api.createAppReport({
      kind: 'wunsch',
      text: '  Termine nach Ort filtern ',
      app_version: '0.8.0',
    });
    expect((await errorOf(api.createAppReport({ kind: 'bug', text: '   ' })))?.field).toBe('text');
    expect((await errorOf(api.listAppReports()))?.code).toBe('forbidden');

    await login('mo');
    const reports = await api.listAppReports();
    const mine = reports.find((r) => r.id === id)!;
    const members = await api.listMembers();
    expect([mine.kind, mine.text, mine.app_version]).toEqual(['wunsch', 'Termine nach Ort filtern', '0.8.0']);
    expect(members.find((m) => m.id === mine.member_id)?.display_name).toBe('Jule');
    // neueste zuerst
    expect(reports[0]!.id).toBe(id);
  });
});
