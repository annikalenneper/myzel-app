// Mitgliederliste einspielen: Zeilen verstehen, Kürzel eindeutig, über die Server-Funktion mit Historie, mehrfach
// ausführbar – mit erfundenen Namen (die echte Liste liegt nur lokal).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFirstAdmin } from './firstAdmin';
import { importMembers, parseMemberList } from './importMembers';
import { createLocalDb, type LocalDb } from './localDb';

let local: LocalDb;
const now = new Date(2026, 9, 23, 12);
const LIST = `Kira		kira@example.org  (admin)
Kai	 	kai@example.org
Lea  lea@example.org (admin)
`;

beforeEach(async () => {
  local = await createLocalDb();
  await createFirstAdmin(local.db, 'lea@example.org', now);
  // die Admin-Person hat sich einmal angemeldet
  await local.db
    .updateTable('members')
    .set({ auth_user_id: '11111111-1111-4111-8111-111111111111' })
    .where('email', '=', 'lea@example.org')
    .execute();
});
afterEach(async () => {
  await local.db.destroy();
});

describe('Mitgliederliste einspielen', () => {
  it('versteht Tabs, Leerzeichen und „(admin)“', () => {
    expect(parseMemberList(LIST)).toEqual([
      { name: 'Kira', email: 'kira@example.org', extra: [], admin: true },
      { name: 'Kai', email: 'kai@example.org', extra: [], admin: false },
      { name: 'Lea', email: 'lea@example.org', extra: [], admin: true },
    ]);
    expect(() => parseMemberList('nur ein Name')).toThrow(/verstehe ich nicht/);
  });

  it('legt Fehlende mit eindeutigem Kürzel und Historie an – mehrfach ausführbar', async () => {
    const report = await importMembers(local.db, parseMemberList(LIST), 'lea@example.org', now);
    expect(report).toEqual(['angelegt: Kira (KI), Admin', 'angelegt: Kai (KA)', 'schon da: Lea']);
    const members = await local.db
      .selectFrom('members')
      .select(['display_name', 'short', 'is_admin'])
      .where('is_system', '=', false)
      .orderBy('display_name')
      .execute();
    expect(members).toEqual([
      { display_name: 'Kai', short: 'KA', is_admin: false },
      { display_name: 'Kira', short: 'KI', is_admin: true },
      { display_name: 'Lea', short: 'LE', is_admin: true },
    ]);
    const history = await local.db
      .selectFrom('history')
      .select('action')
      .where('entity_type', '=', 'member')
      .execute();
    expect(history.filter((h) => h.action === 'created')).toHaveLength(3);
    expect(await importMembers(local.db, parseMemberList(LIST), 'lea@example.org', now)).toEqual([
      'schon da: Kira',
      'schon da: Kai',
      'schon da: Lea',
    ]);
  });

  it('versteht weitere Adressen und ergänzt sie, ohne doppelt einzutragen', async () => {
    const list = parseMemberList(`Kira	kira@example.org  (admin) kira@example.net
Kai		kai@example.org / Kai@Example.net
`);
    expect(list).toEqual([
      { name: 'Kira', email: 'kira@example.org', extra: ['kira@example.net'], admin: true },
      { name: 'Kai', email: 'kai@example.org', extra: ['kai@example.net'], admin: false },
    ]);
    expect(() => parseMemberList('Kai kai@example.org und noch was')).toThrow(/verstehe ich nicht/);
    expect(await importMembers(local.db, list, 'lea@example.org', now)).toEqual([
      'angelegt: Kira (KI), Admin, weitere Adresse: 1',
      'angelegt: Kai (KA), weitere Adresse: 1',
    ]);
    expect(await importMembers(local.db, list, 'lea@example.org', now)).toEqual([
      'schon da: Kira',
      'schon da: Kai',
    ]);
    const extra = await local.db.selectFrom('member_emails').select('email').orderBy('email').execute();
    expect(extra.map((e) => e.email)).toEqual(['kai@example.net', 'kira@example.net']);
  });

  it('braucht eine angemeldete Admin-Person', async () => {
    await expect(importMembers(local.db, parseMemberList(LIST), 'kai@example.org', now)).rejects.toThrow(
      /angemeldet/,
    );
  });
});
