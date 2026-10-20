// Datenbank-Tests (7.4 Nr. 3): Migrationen laufen frisch durch, Startbestand ist da, die Struktur-Regeln greifen;
// direkt schreiben lässt sich nichts, lesen dürfen nur aktive Mitglieder, die Historie ist unveränderlich.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { asUser, createLocalDb, migrationFiles, type LocalDb } from './localDb';

let local: LocalDb;
const AUTH_LEA = '11111111-1111-4111-8111-111111111111';
const AUTH_TAREK = '22222222-2222-4222-8222-222222222222';
const AUTH_FREMD = '33333333-3333-4333-8333-333333333333';

const fails = async (sql: string, params: unknown[] = []) => {
  try {
    await local.pg.query(sql, params);
  } catch (e) {
    return (e as Error).message;
  }
  return null;
};

beforeEach(async () => {
  local = await createLocalDb();
  await local.pg.exec(`
    insert into public.members (id, auth_user_id, email, display_name, short, is_admin)
    values ('a0000000-0000-4000-8000-000000000001', '${AUTH_LEA}', 'lea@example.org', 'Lea', 'LE', true);
    insert into public.members (id, auth_user_id, email, display_name, short, active)
    values ('a0000000-0000-4000-8000-000000000002', '${AUTH_TAREK}', 'tarek@example.org', 'Tarek', 'TA', false);
  `);
});
afterEach(async () => {
  await local.db.destroy();
});

describe('Migrationen', () => {
  it('laufen auf frischer Datenbank fehlerfrei und legen den Startbestand an', async () => {
    expect(migrationFiles().length).toBeGreaterThan(0);
    const system = await local.db.selectFrom('members').selectAll().where('is_system', '=', true).execute();
    expect(system.map((m) => m.display_name)).toEqual(['Myzel (automatisch)']);
    const topics = await local.db
      .selectFrom('topics')
      .select(['name', 'parent_id'])
      .orderBy('sort_order')
      .execute();
    expect(topics.filter((t) => !t.parent_id).map((t) => t.name)).toEqual([
      'Veranstaltungen',
      'Verein',
      'Lager & Material',
      'Öffentlichkeitsarbeit',
      'Organisatorisches',
    ]);
    expect(topics.filter((t) => t.parent_id)).toHaveLength(5);
  });
});

describe('Struktur-Regeln (7.1)', () => {
  it('Mitglieder: Mail Pflicht außer beim Systemeintrag, Mail und Kürzel eindeutig', async () => {
    expect(await fails(`insert into members (display_name, short) values ('Ohne', 'OH')`)).toMatch(
      /members_email_unless_system/,
    );
    expect(
      await fails(`insert into members (email, display_name, short) values ('LEA@example.org', 'X', 'XX')`),
    ).toMatch(/members_email_unique/);
    expect(
      await fails(`insert into members (email, display_name, short) values ('x@example.org', 'X', 'le')`),
    ).toMatch(/members_short_unique/);
  });

  it('Aufgaben: Thema Pflicht, blockiert nur mit Grund, Nummer fortlaufend, keine Selbst-Abhängigkeit', async () => {
    const topic = (
      await local.db.selectFrom('topics').select('id').where('name', '=', 'Verein').executeTakeFirstOrThrow()
    ).id;
    const lea = 'a0000000-0000-4000-8000-000000000001';
    expect(await fails(`insert into tasks (title, created_by) values ('X', $1)`, [lea])).toMatch(/topic_id/);
    expect(
      await fails(
        `insert into tasks (title, topic_id, status, created_by) values ('X', $1, 'blockiert', $2)`,
        [topic, lea],
      ),
    ).toMatch(/tasks_blocked_needs_reason/);
    const a = await local.pg.query<{ id: string; number: number }>(
      `insert into tasks (title, topic_id, created_by) values ('A', $1, $2) returning id, number`,
      [topic, lea],
    );
    const b = await local.pg.query<{ number: number }>(
      `insert into tasks (title, topic_id, created_by) values ('B', $1, $2) returning number`,
      [topic, lea],
    );
    expect(b.rows[0]!.number).toBe(a.rows[0]!.number + 1);
    const id = a.rows[0]!.id;
    expect(await fails(`insert into task_blockers values ($1, $1)`, [id])).toMatch(/task_blockers_not_self/);
    // FK RESTRICT: ein benutztes Thema lässt sich nicht löschen
    expect(await fails(`delete from topics where id = $1`, [topic])).toMatch(/foreign key/);
  });

  it('die Historie lässt sich nicht ändern oder löschen', async () => {
    const lea = 'a0000000-0000-4000-8000-000000000001';
    await local.pg.query(
      `insert into history (entity_type, entity_id, actor_member_id, action) values ('member', $1, $1, 'created')`,
      [lea],
    );
    expect(await fails(`update history set action = 'x'`)).toMatch(/Historie lässt sich nicht ändern/);
    expect(await fails(`delete from history`)).toMatch(/Historie lässt sich nicht ändern/);
  });
});

describe('Zugriff über Supabase (RLS)', () => {
  it('aktive Mitglieder lesen, Deaktivierte und Fremde sehen nichts', async () => {
    const count = () => local.pg.query<{ n: number }>(`select count(*)::int as n from public.topics`);
    expect((await asUser(local.pg, AUTH_LEA, count)).rows[0]!.n).toBe(10);
    expect((await asUser(local.pg, AUTH_TAREK, count)).rows[0]!.n).toBe(0);
    expect((await asUser(local.pg, AUTH_FREMD, count)).rows[0]!.n).toBe(0);
    expect((await asUser(local.pg, null, count)).rows[0]!.n).toBe(0);
  });

  it('direktes Schreiben ist gesperrt – auch für aktive Mitglieder', async () => {
    const result = await asUser(local.pg, AUTH_LEA, async () => ({
      insert: await fails(`insert into public.topics (name) values ('Neu')`),
      update: (await local.pg.query(`update public.members set is_admin = true`)).affectedRows,
      remove: (await local.pg.query(`delete from public.topics`)).affectedRows,
    }));
    expect(result.insert).toMatch(/row-level security/);
    expect(result.update).toBe(0);
    expect(result.remove).toBe(0);
    expect((await local.db.selectFrom('topics').select('id').execute()).length).toBe(10);
  });

  it('Rückgängig-Einträge sieht niemand über Supabase', async () => {
    const lea = 'a0000000-0000-4000-8000-000000000001';
    await local.pg.query(
      `insert into undo_actions (actor_id, entity_type, entity_id, version_after, label, ops) values ($1, 'task', $1, 1, 'x', '[]')`,
      [lea],
    );
    const seen = await asUser(local.pg, AUTH_LEA, () => local.pg.query(`select * from public.undo_actions`));
    expect(seen.rows).toHaveLength(0);
  });
});
