// Umbau Phase 6 – Entscheidungen im Konsens (16.4): Frist, Bestätigen und Widersprechen, Joblauf
// Mit MYZEL_API=server laufen dieselben Tests gegen die echten Server-Funktionen auf PGlite.
import { beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../../shared/errors';
import { consensusReached, countVotes, consensusUntilProblem } from '../../shared/rules/knowledge';
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
const topic = async (name: string) => (await api.listTopics()).find((t) => t.name === name)!.id;
const decision = async (title: string) => (await api.listDecisions()).find((d) => d.title === title)!;
const ACTIVE = ['mo', 'lea', 'jule', 'sam', 'kim', 'noa', 'timo', 'rana', 'elif', 'ben', 'paula'];

beforeEach(async () => {
  clock = new Date(2026, 9, 11, 12, 0, 0);
  api =
    process.env.MYZEL_API === 'server'
      ? await (await import('../../../server/api/serverApi')).createServerApi({ now: () => clock })
      : createMockApi({ storage: memoryStorage(), now: () => clock });
  await login('mo');
});

const create = async (extra: { kind?: 'entscheidung' | 'fakt'; consensus_until?: string } = {}) =>
  (
    await api.createDecision({
      title: 'Kasse zählt immer zu zweit',
      kind: 'entscheidung',
      topic_id: await topic('Organisatorisches'),
      source_note: 'Plenum',
      ...extra,
    })
  ).id;

describe('Regeln (16.4)', () => {
  it('gültig bei allen Bestätigungen oder nach der Frist ohne Widerspruch', () => {
    const open = { status: 'offen' as const, consensus_until: '2026-10-18' };
    const yes = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ member_id: `m${i}`, vote: 'bestaetigt' as const }));
    const ids = ['m0', 'm1', 'm2'];
    expect(consensusReached(open, countVotes(yes(2), ids), '2026-10-18')).toBe(false);
    expect(consensusReached(open, countVotes(yes(3), ids), '2026-10-12')).toBe(true);
    // am letzten Tag läuft die Frist noch, danach verfallen nicht abgegebene Stimmen
    expect(consensusReached(open, countVotes([], ids), '2026-10-19')).toBe(true);
    const no = [{ member_id: 'm1', vote: 'widerspruch' as const }];
    expect(consensusReached(open, countVotes(no, ids), '2026-11-30')).toBe(false);
    // Stimmen ausgetretener Personen zählen nicht
    expect(countVotes([{ member_id: 'alt', vote: 'widerspruch' }], ids).objected).toBe(0);
    expect(consensusUntilProblem('2026-10-10', '2026-10-11')).toMatch(/Vergangenheit/);
    expect(consensusUntilProblem('2027-03-01', '2026-10-11')).toMatch(/90 Tage/);
  });
});

describe('Entscheidungen im Konsens (16.4)', () => {
  it('neue Entscheidung ist offen mit Frist 7 Tage; Fakten gelten sofort', async () => {
    const d = await api.getDecision(await create());
    expect([d.status, d.consensus_until]).toEqual(['offen', '2026-10-18']);
    expect(d.consensus).toEqual({ confirmed: 0, objected: 0, total: ACTIVE.length, my_vote: null });
    expect(d.pending_ids).toHaveLength(ACTIVE.length);
    const f = await api.getDecision(await create({ kind: 'fakt' }));
    expect([f.status, f.consensus_until, f.consensus]).toEqual(['gueltig', null, null]);
    const own = await api.getDecision(await create({ consensus_until: '2026-10-25' }));
    expect(own.consensus_until).toBe('2026-10-25');
    await expectError(create({ consensus_until: '2026-10-01' }), 'validation', 'consensus_until');
  });

  it('bestätigen, ändern, Rückgängig; gültig, sobald alle aktiven Mitglieder bestätigt haben', async () => {
    const id = await create();
    const first = await api.voteDecision(id, 'bestaetigt');
    expect(first.valid).toBe(false);
    expect((await decision('Kasse zählt immer zu zweit')).consensus?.my_vote).toBe('bestaetigt');
    await api.undo(first.undo_token);
    expect((await api.getDecision(id)).consensus?.my_vote).toBeNull();

    let last: { valid: boolean } = { valid: false };
    for (const name of ACTIVE) {
      await login(name);
      last = await api.voteDecision(id, 'bestaetigt');
    }
    expect(last.valid).toBe(true);
    const d = await api.getDecision(id);
    expect([d.status, d.pending_ids, d.votes.length]).toEqual(['gueltig', [], ACTIVE.length]);
    expect(d.history.some((h) => h.action === 'consensus_reached')).toBe(true);
    await expectError(api.voteDecision(id, 'widerspruch'), 'rule');
  });

  it('Widerspruch hält sie offen und setzt sie auf die Agenda; Rückgängig nimmt beides zurück', async () => {
    const id = await create();
    await login('noa');
    const { undo_token } = await api.voteDecision(id, 'widerspruch');
    let d = await api.getDecision(id);
    expect([d.status, d.marked, d.consensus?.objected]).toEqual(['offen', true, 1]);
    await api.undo(undo_token);
    d = await api.getDecision(id);
    expect([d.marked, d.consensus?.objected]).toEqual([false, 0]);

    await api.voteDecision(id, 'widerspruch');
    // nach der Frist bleibt sie offen, solange der Widerspruch steht
    clock = new Date(2026, 9, 20, 12, 0, 0);
    await api.demo!.runJobNow();
    expect((await api.getDecision(id)).status).toBe('offen');
    // Widerspruch zurückgenommen: nach der Frist gilt sie sofort
    const changed = await api.voteDecision(id, 'bestaetigt');
    expect(changed.valid).toBe(true);
    expect((await api.getDecision(id)).status).toBe('gueltig');
  });

  it('Joblauf: nach der Frist ohne Widerspruch gültig, als „Myzel (automatisch)“', async () => {
    const id = await create();
    await api.voteDecision(id, 'bestaetigt');
    clock = new Date(2026, 9, 18, 23, 0, 0);
    await api.demo!.runJobNow();
    expect((await api.getDecision(id)).status).toBe('offen');
    clock = new Date(2026, 9, 19, 0, 30, 0);
    await api.demo!.runJobNow();
    const d = await api.getDecision(id);
    expect(d.status).toBe('gueltig');
    const members = await api.listMembers();
    const settled = d.history.find((h) => h.action === 'consensus_reached')!;
    expect(members.find((m) => m.id === settled.actor_member_id)?.is_system).toBe(true);
  });

  it('offene Entscheidungen lassen sich bearbeiten, ersetzen und aufheben', async () => {
    const id = await create();
    const d = await api.getDecision(id);
    const { successor_id } = await api.replaceDecision(id, {
      title: 'Kasse zählt immer zu dritt',
      source_note: 'Nachtrag',
      consensus_until: '2026-10-14',
      version: d.version,
    });
    const next = await api.getDecision(successor_id);
    expect([next.status, next.consensus_until]).toEqual(['offen', '2026-10-14']);
    expect((await api.getDecision(id)).status).toBe('ersetzt');
    await api.revokeDecision(successor_id, null, next.version);
    expect((await api.getDecision(successor_id)).status).toBe('aufgehoben');
  });

  it('eine offene Entscheidung kann Nachfolgerin sein', async () => {
    const old = await decision('Mate am Tresen für 2,50 €');
    const id = await create();
    await api.replaceDecision(old.id, { successor_id: id, version: old.version });
    expect((await api.getDecision(old.id)).superseded_by_id).toBe(id);
  });

  it('Rückgängig beim Ersetzen geht nicht mehr, sobald jemand über die neue Fassung abgestimmt hat', async () => {
    const id = await create();
    const d = await api.getDecision(id);
    const { undo_token, successor_id } = await api.replaceDecision(id, {
      title: 'Kasse zählt zu dritt',
      source_note: 'Nachtrag',
      version: d.version,
    });
    await login('lea');
    await api.voteDecision(successor_id, 'bestaetigt');
    await login('mo');
    await expectError(api.undo(undo_token), 'rule');
    expect((await api.getDecision(successor_id)).consensus?.confirmed).toBe(1);
  });

  it('eine Stimme lässt sich nicht mehr zurücknehmen, wenn andere die Entscheidung gültig gemacht haben', async () => {
    const id = await create();
    let first = '';
    for (const name of ACTIVE) {
      await login(name);
      const r = await api.voteDecision(id, 'bestaetigt');
      if (name === 'mo') first = r.undo_token;
    }
    expect((await api.getDecision(id)).status).toBe('gueltig');
    await login('mo');
    await expectError(api.undo(first), 'conflict');
    expect((await api.getDecision(id)).consensus?.confirmed).toBe(ACTIVE.length);
  });

  it('nach der Frist kein neuer Widerspruch; wer seinen Widerspruch zurücknimmt, macht sie gültig', async () => {
    const id = await create();
    clock = new Date(2026, 9, 19, 9, 0, 0);
    await expectError(api.voteDecision(id, 'widerspruch'), 'rule');
    await api.demo!.runJobNow();
    expect((await api.getDecision(id)).status).toBe('gueltig');

    clock = new Date(2026, 9, 11, 12, 0, 0);
    const other = await create();
    await login('noa');
    await api.voteDecision(other, 'widerspruch');
    clock = new Date(2026, 9, 20, 12, 0, 0);
    const changed = await api.voteDecision(other, 'bestaetigt');
    expect(changed.valid).toBe(true);
  });

  it('Stimmen Deaktivierter zählen nicht – nach der Deaktivierung gilt sie im Joblauf', async () => {
    const id = await create();
    await login('noa');
    await api.voteDecision(id, 'widerspruch');
    await login('mo');
    const noa = (await api.listMembers()).find((m) => m.display_name === 'Noa')!;
    await api.deactivateMember(noa.id);
    const d = await api.getDecision(id);
    expect([d.consensus?.objected, d.consensus?.total]).toEqual([0, ACTIVE.length - 1]);
    clock = new Date(2026, 9, 19, 9, 0, 0);
    await api.demo!.runJobNow();
    expect((await api.getDecision(id)).status).toBe('gueltig');
  });
});
