// Einrichtung: die erste Admin-Person entsteht einmalig, mit Historie als „Myzel (automatisch)“.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFirstAdmin } from './firstAdmin';
import { createLocalDb, type LocalDb } from './localDb';

let local: LocalDb;
const now = new Date(2026, 9, 21, 12);

beforeEach(async () => {
  local = await createLocalDb();
});
afterEach(async () => {
  await local.db.destroy();
});

describe('Erste Admin-Person', () => {
  it('wird aus der Mail angelegt, mit Admin-Rechten und Historie', async () => {
    const result = await createFirstAdmin(local.db, ' Lea.Beispiel@Example.org ', now);
    expect(result.created).toBe(true);
    const member = await local.db
      .selectFrom('members')
      .selectAll()
      .where('is_system', '=', false)
      .executeTakeFirstOrThrow();
    expect(member).toMatchObject({
      email: 'lea.beispiel@example.org',
      display_name: 'Lea.beispiel',
      short: 'LE',
      is_admin: true,
      active: true,
      auth_user_id: null,
    });
    const history = await local.db
      .selectFrom('history')
      .selectAll()
      .where('entity_id', '=', member.id)
      .execute();
    expect(history).toHaveLength(1);
    expect(history[0]!.actor_member_id).toBe('00000000-0000-4000-8000-000100000000');
  });

  it('läuft nur einmal und braucht eine gültige Mail', async () => {
    expect((await createFirstAdmin(local.db, undefined, now)).created).toBe(false);
    expect((await createFirstAdmin(local.db, 'keine-mail', now)).created).toBe(false);
    expect((await createFirstAdmin(local.db, 'lea@example.org', now)).created).toBe(true);
    expect((await createFirstAdmin(local.db, 'tarek@example.org', now)).created).toBe(false);
    const members = await local.db
      .selectFrom('members')
      .select('id')
      .where('is_system', '=', false)
      .execute();
    expect(members).toHaveLength(1);
  });
});
