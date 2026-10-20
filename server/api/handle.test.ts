// HTTP-Schicht (7.2): handelnde Person allein aus dem Login, erster Login verknüpft über die bestätigte Mail,
// unbekannte Aktionen werden abgewiesen, Fehler kommen als deutsche Sätze ohne Stacktrace.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../../src/shared/errors';
import { createLocalDb, type LocalDb } from '../db/localDb';
import { errorBody, handleAction } from './handle';

let local: LocalDb;
const now = new Date(2026, 9, 20, 12);
const LEA_AUTH = '11111111-1111-4111-8111-111111111111';

const code = async (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => (e as AppError).code,
  );

beforeEach(async () => {
  local = await createLocalDb();
  await local.pg.exec(`
    insert into members (id, email, display_name, short, is_admin)
    values ('a0000000-0000-4000-8000-000000000001', 'lea@example.org', 'Lea', 'LE', true);
  `);
});
afterEach(async () => {
  await local.db.destroy();
});

describe('Anmeldung über Supabase (F-LOG-01, -02)', () => {
  it('ohne Login: anonym, keine Daten, kein Schreiben', async () => {
    expect(await handleAction(local.db, null, 'getSession', [], now)).toEqual({ state: 'anonymous' });
    expect(await code(handleAction(local.db, null, 'listTasks', [], now))).toBe('unauthenticated');
    expect(await code(handleAction(local.db, null, 'createTopic', [{ name: 'X' }], now))).toBe(
      'unauthenticated',
    );
  });

  it('der erste Login mit bestätigter Mail verknüpft das Mitglied, danach zählt die Login-ID', async () => {
    const session = (await handleAction(
      local.db,
      { authUserId: LEA_AUTH, email: 'Lea@Example.org' },
      'getSession',
      [],
      now,
    )) as {
      state: string;
    };
    expect(session.state).toBe('member');
    // später ohne Mail (z. B. Token ohne E-Mail-Claim): die Verknüpfung bleibt
    const again = (await handleAction(
      local.db,
      { authUserId: LEA_AUTH, email: null },
      'getSession',
      [],
      now,
    )) as {
      state: string;
    };
    expect(again.state).toBe('member');
    // ein anderer Login mit derselben Mail übernimmt das Mitglied nicht
    const other = (await handleAction(
      local.db,
      { authUserId: '22222222-2222-4222-8222-222222222222', email: 'lea@example.org' },
      'getSession',
      [],
      now,
    )) as { state: string };
    expect(other.state).toBe('no_access');
  });

  it('wer nicht auf der Liste steht, bekommt keinen Zugriff; ohne bestätigte Mail verknüpft nichts', async () => {
    expect(
      await handleAction(
        local.db,
        { authUserId: LEA_AUTH, email: 'fremd@example.org' },
        'getSession',
        [],
        now,
      ),
    ).toEqual({ state: 'no_access', email: 'fremd@example.org' });
    expect(
      await handleAction(local.db, { authUserId: LEA_AUTH, email: null }, 'getSession', [], now),
    ).toEqual({
      state: 'no_access',
      email: '',
    });
  });
});

describe('Aktionen', () => {
  const lea = { authUserId: LEA_AUTH, email: 'lea@example.org' };

  it('die handelnde Person kommt aus dem Login – nicht aus den Argumenten', async () => {
    await handleAction(local.db, lea, 'getSession', [], now);
    const { id } = (await handleAction(
      local.db,
      lea,
      'createTopic',
      [{ name: 'Neu', actor_member_id: 'x' }],
      now,
    )) as {
      id: string;
    };
    const history = await local.db.selectFrom('history').selectAll().where('entity_id', '=', id).execute();
    expect(history[0]?.actor_member_id).toBe('a0000000-0000-4000-8000-000000000001');
  });

  it('unbekannte und eingeschleuste Aktionsnamen werden abgewiesen', async () => {
    await handleAction(local.db, lea, 'getSession', [], now);
    expect(await code(handleAction(local.db, lea, 'toString', [], now))).toBe('rule');
    expect(await code(handleAction(local.db, lea, '__proto__', [], now))).toBe('rule');
    expect(await code(handleAction(local.db, lea, 'listAppointments', [], now))).toBe('rule');
  });

  it('Fehler werden zu deutschen Sätzen mit passendem Status, ohne technische Details', () => {
    expect(errorBody(new AppError('conflict', 'Wurde inzwischen von Lea geändert.'))).toMatchObject({
      status: 409,
      body: { error: { code: 'conflict', message: 'Wurde inzwischen von Lea geändert.' } },
    });
    const crash = errorBody(new Error('relation "x" does not exist'));
    expect(crash.status).toBe(500);
    expect(JSON.stringify(crash.body)).not.toMatch(/relation|does not exist/);
  });
});
