// Nur Tests und lokale Entwicklung: dieselben Testdaten wie die Testdaten-Schicht (src/data/mock/seed.ts), soweit
// Phase 1 sie kennt. So laufen die Tests der Testdaten-Schicht unverändert auch gegen die Server-Funktionen.
import { sql, type Kysely } from 'kysely';
import { seedDb } from '../../src/data/mock/seed';
import type { Database } from './types';

/** Historie der Arten, die der Server schon kennt (Serien und Partner kommen mit P4 und P6) */
const SERVER_HISTORY = new Set([
  'task',
  'event',
  'member',
  'topic',
  'appointment',
  'appointment_type',
  'decision',
  'question',
  'document',
]);

/** Spalten späterer Phasen weglassen */
function without<T extends object, K extends keyof T>(row: T, ...keys: K[]): Omit<T, K> {
  const copy = { ...row };
  for (const key of keys) delete copy[key];
  return copy;
}

/** Login-ID eines Testkontos: fest aus der Mitglieds-ID abgeleitet */
export const testAuthId = (memberId: string) => memberId.replace(/^0{8}/, 'aaaaaaaa');

export async function seedFromMock(db: Kysely<Database>, now: Date): Promise<void> {
  const data = seedDb(now);
  await db.transaction().execute(async (trx) => {
    // der Startbestand der Migration wird durch die Testdaten ersetzt (gleiche Namen, andere IDs)
    await trx.deleteFrom('appointment_types').execute();
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
          reminder_lead_days: m.reminder_lead_days,
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
    // Phase 3: Terminarten, Dokumente, Termine, Zusagen, Teilnahme, Entscheidungen, Fragen
    if (data.appointment_types.length)
      await trx.insertInto('appointment_types').values(data.appointment_types).execute();
    if (data.documents.length)
      await trx
        .insertInto('documents')
        .values(data.documents.map((d) => ({ ...d, tags: JSON.stringify(d.tags) })))
        .execute();
    if (data.appointments.length)
      await trx
        .insertInto('appointments')
        .values(data.appointments.map((a) => without(a, 'series_id', 'series_date')))
        .execute();
    if (data.appointment_rsvps.length)
      await trx.insertInto('appointment_rsvps').values(data.appointment_rsvps).execute();
    if (data.appointment_attendees.length)
      await trx.insertInto('appointment_attendees').values(data.appointment_attendees).execute();
    for (const t of data.tasks.filter((x) => x.appointment_id || x.origin_plenum_id))
      await trx
        .updateTable('tasks')
        .set({ appointment_id: t.appointment_id, origin_plenum_id: t.origin_plenum_id })
        .where('id', '=', t.id)
        .execute();
    if (data.decisions.length) {
      // Nachfolgerinnen verweisen aufeinander: erst ohne, dann nachtragen
      await trx
        .insertInto('decisions')
        .values(data.decisions.map((d) => ({ ...d, status: 'gueltig' as const, superseded_by_id: null })))
        .execute();
      for (const d of data.decisions.filter((x) => x.status !== 'gueltig'))
        await trx
          .updateTable('decisions')
          .set({ status: d.status, superseded_by_id: d.superseded_by_id })
          .where('id', '=', d.id)
          .execute();
    }
    if (data.questions.length) await trx.insertInto('questions').values(data.questions).execute();
    const links = data.document_links.filter((l) => l.target_type !== ('partner' as string));
    if (links.length) await trx.insertInto('document_links').values(links).execute();
    // Markierungen aller Arten, die der Server kennt (Partner kommen mit P4)
    const marks = data.plenum_marks.filter((m) => !m.partner_id);
    if (marks.length)
      await trx
        .insertInto('plenum_marks')
        .values(marks.map((m) => without(m, 'partner_id')))
        .execute();
    const history = data.history.filter((h) => SERVER_HISTORY.has(h.entity_type));
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

    // Phase 2: wer wie erreichbar ist, die Nachrichten und Jobläufe der Testdaten
    if (data.push_subscriptions.length)
      await trx
        .insertInto('push_subscriptions')
        .values(
          data.push_subscriptions.map((s) => ({
            id: s.id,
            member_id: s.member_id,
            endpoint: s.endpoint,
            p256dh: 'test',
            auth: 'test',
            created_at: s.created_at,
          })),
        )
        .execute();
    if (data.telegram_links.length)
      await trx.insertInto('telegram_links').values(data.telegram_links).execute();
    if (data.telegram_link_codes.length)
      await trx.insertInto('telegram_link_codes').values(data.telegram_link_codes).execute();
    if (data.notification_outbox.length)
      await trx
        .insertInto('notification_outbox')
        .values(
          data.notification_outbox.map((o) => ({
            id: o.id,
            dedupe_key: o.dedupe_key,
            member_id: o.member_id,
            event_type: o.event_type,
            channel: o.channel,
            text: o.text,
            link: o.link,
            status: o.status,
            attempts: o.attempts,
            created_at: o.created_at,
            sent_at: o.sent_at,
          })),
        )
        .execute();
    if (data.job_runs.length) await trx.insertInto('job_runs').values(data.job_runs).execute();
  });
}
