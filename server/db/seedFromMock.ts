// Nur Tests und lokale Entwicklung: dieselben Testdaten wie die Testdaten-Schicht (src/data/mock/seed.ts), soweit
// Phase 1 sie kennt. So laufen die Tests der Testdaten-Schicht unverändert auch gegen die Server-Funktionen.
import { sql, type Kysely } from 'kysely';
import { seedDb } from '../../src/data/mock/seed';
import type { Database } from './types';

const P1_HISTORY = new Set(['task', 'event', 'member', 'topic']);

/** Login-ID eines Testkontos: fest aus der Mitglieds-ID abgeleitet */
export const testAuthId = (memberId: string) => memberId.replace(/^0{8}/, 'aaaaaaaa');

export async function seedFromMock(db: Kysely<Database>, now: Date): Promise<void> {
  const data = seedDb(now);
  await db.transaction().execute(async (trx) => {
    // der Startbestand der Migration wird durch die Testdaten ersetzt (gleiche Namen, andere IDs)
    await trx.deleteFrom('topics').execute();
    await trx.deleteFrom('members').where('is_system', '=', false).execute();
    const members = data.members.filter((m) => !m.is_system);
    // created_by zeigt teils auf später angelegte Mitglieder: erst ohne, dann nachtragen
    await trx
      .insertInto('members')
      .values(
        members.map((m) => ({
          id: m.id,
          auth_user_id: testAuthId(m.id),
          email: m.email,
          display_name: m.display_name,
          short: m.short,
          is_admin: m.is_admin,
          active: m.active,
          created_at: m.created_at,
          updated_at: m.updated_at,
          created_by: null,
          version: m.version,
        })),
      )
      .execute();
    for (const m of members.filter((x) => x.created_by))
      await trx.updateTable('members').set({ created_by: m.created_by }).where('id', '=', m.id).execute();

    const topics = [...data.topics].sort((a, b) => Number(!!a.parent_id) - Number(!!b.parent_id));
    if (topics.length) await trx.insertInto('topics').values(topics).execute();
    if (data.events.length)
      await trx
        .insertInto('events')
        .values(
          data.events.map((e) => ({
            id: e.id,
            title: e.title,
            type: e.type,
            description: e.description,
            starts_at: e.starts_at,
            ends_at: e.ends_at,
            status: e.status,
            archived_at: e.archived_at,
            created_at: e.created_at,
            updated_at: e.updated_at,
            created_by: e.created_by,
            version: e.version,
          })),
        )
        .execute();
    if (data.tasks.length)
      await trx
        .insertInto('tasks')
        .values(
          data.tasks.map((t) => ({
            id: t.id,
            number: t.number,
            title: t.title,
            description: t.description,
            topic_id: t.topic_id,
            event_id: t.event_id,
            priority: t.priority,
            due_date: t.due_date,
            status: t.status,
            block_reason: t.block_reason,
            discard_reason: t.discard_reason,
            archived_at: t.archived_at,
            created_at: t.created_at,
            updated_at: t.updated_at,
            created_by: t.created_by,
            version: t.version,
          })),
        )
        .execute();
    await sql`select setval('public.task_number_seq', (select coalesce(max(number), 0) from public.tasks) + 1, false)`.execute(
      trx,
    );
    if (data.task_assignees.length)
      await trx.insertInto('task_assignees').values(data.task_assignees).execute();
    if (data.task_followers.length)
      await trx.insertInto('task_followers').values(data.task_followers).execute();
    if (data.task_blockers.length) await trx.insertInto('task_blockers').values(data.task_blockers).execute();
    if (data.comments.length) await trx.insertInto('comments').values(data.comments).execute();
    const marks = data.plenum_marks.filter((m) => m.task_id);
    if (marks.length)
      await trx
        .insertInto('plenum_marks')
        .values(
          marks.map((m) => ({
            id: m.id,
            task_id: m.task_id,
            position: m.position,
            note: m.note,
            marked_by: m.marked_by,
            marked_at: m.marked_at,
          })),
        )
        .execute();
    const history = data.history.filter((h) => P1_HISTORY.has(h.entity_type));
    for (let i = 0; i < history.length; i += 200)
      await trx
        .insertInto('history')
        .values(
          history.slice(i, i + 200).map((h) => ({
            id: h.id,
            entity_type: h.entity_type as 'task',
            entity_id: h.entity_id,
            actor_member_id: h.actor_member_id,
            action: h.action,
            changes: JSON.stringify(h.changes),
            created_at: h.created_at,
          })),
        )
        .execute();
  });
}
