// Profil, Mitglieder und Themen, Phase 1 (F-LOG-03, F-LOG-04, F-PRO-04; WF-PRO-01, WF-ADM-01 bis -05).
// Wie die Testdaten-Schicht; „Mitglied deaktivieren“ räumt in derselben Transaktion auf (F-LOG-03).
import type { DeactivationImpact } from '../../src/data/api';
import { AppError } from '../../src/shared/errors';
import { isActiveTaskStatus, statusAfterLastAssigneeLeft } from '../../src/shared/rules/taskStatus';
import {
  memberCreateSchema,
  memberUpdateSchema,
  profileNameSchema,
  topicCreateSchema,
  topicUpdateSchema,
  type HistoryChanges,
} from '../../src/shared/schema';
import {
  checkVersion,
  updatedOne,
  iso,
  notFound,
  parse,
  requireAdmin,
  rule,
  writeHistory,
  type Ctx,
} from '../core/context';
import type { MemberRow } from '../db/types';
import { dropChannels } from '../p2/notify';
import { dropFutureRsvps, futureRsvpCount } from '../p3/appointments';
import { dropAssignee, dropFollower } from './tasks';

async function findMember(ctx: Ctx, id: string): Promise<MemberRow> {
  const member = await ctx.trx
    .selectFrom('members')
    .selectAll()
    .where('id', '=', id)
    .forUpdate()
    .executeTakeFirst();
  if (!member) throw notFound('Dieses Mitglied');
  return member;
}

async function touchMember(ctx: Ctx, member: MemberRow, set: Partial<MemberRow>): Promise<void> {
  const result = await ctx.trx
    .updateTable('members')
    .set({ ...set, version: member.version + 1, updated_at: iso(ctx) } as never)
    .where('id', '=', member.id)
    .where('version', '=', member.version)
    .executeTakeFirst();
  await updatedOne(ctx, result, 'member', member);
}

async function assertUniqueMember(
  ctx: Ctx,
  input: { short: string; email: string },
  exceptId?: string,
): Promise<void> {
  const others = await ctx.trx
    .selectFrom('members')
    .select(['short', 'email'])
    .$if(!!exceptId, (q) => q.where('id', '<>', exceptId!))
    .execute();
  if (others.some((m) => m.short.toUpperCase() === input.short))
    throw new AppError('validation', `Das Kürzel ${input.short} ist schon vergeben.`, { field: 'short' });
  if (others.some((m) => m.email?.toLowerCase() === input.email))
    throw new AppError('validation', 'Diese Mail-Adresse ist schon eingetragen.', { field: 'email' });
}

async function activeAdminCount(ctx: Ctx): Promise<number> {
  const rows = await ctx.trx
    .selectFrom('members')
    .select('id')
    .where('active', '=', true)
    .where('is_admin', '=', true)
    .where('is_system', '=', false)
    .forUpdate()
    .execute();
  return rows.length;
}

export async function updateOwnName(ctx: Ctx, raw: unknown): Promise<void> {
  const name = parse(profileNameSchema, raw);
  const me = await findMember(ctx, ctx.actor.id);
  if (me.display_name === name) return;
  await touchMember(ctx, me, { display_name: name });
  await writeHistory(ctx, 'member', me.id, 'updated', { display_name: { old: me.display_name, new: name } });
}

export async function createMember(ctx: Ctx, raw: unknown): Promise<{ id: string }> {
  requireAdmin(ctx);
  const input = parse(memberCreateSchema, raw);
  await assertUniqueMember(ctx, input);
  const now = iso(ctx);
  const member = await ctx.trx
    .insertInto('members')
    .values({
      email: input.email,
      display_name: input.display_name,
      short: input.short,
      is_admin: input.is_admin,
      created_at: now,
      updated_at: now,
      created_by: ctx.actor.id,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await writeHistory(ctx, 'member', member.id, 'created', {
    display_name: { old: null, new: input.display_name },
  });
  return { id: member.id };
}

export async function updateMember(ctx: Ctx, id: string, raw: unknown): Promise<void> {
  requireAdmin(ctx);
  const input = parse(memberUpdateSchema, raw);
  const member = await findMember(ctx, id);
  if (member.is_system) throw rule('Der Systemeintrag lässt sich nicht bearbeiten.');
  await checkVersion(ctx, 'member', member, input.version);
  await assertUniqueMember(ctx, input, id);
  if (member.active && member.is_admin && !input.is_admin && (await activeAdminCount(ctx)) <= 1)
    throw rule('Mindestens eine aktive Person braucht Admin-Rechte.', 'is_admin');
  const changes: HistoryChanges = {};
  const set: Partial<MemberRow> = {};
  for (const key of ['display_name', 'short', 'email', 'is_admin'] as const) {
    if (member[key] === input[key]) continue;
    changes[key] = { old: member[key], new: input[key] };
    (set as Record<string, unknown>)[key] = input[key];
  }
  if (Object.keys(changes).length === 0) return;
  // neue Mail-Adresse: der bisherige Login gehört nicht mehr dazu; beim nächsten Login wird neu verknüpft
  if (changes.email) set.auth_user_id = null;
  await touchMember(ctx, member, set);
  await writeHistory(ctx, 'member', id, 'updated', changes);
}

export async function getDeactivationImpact(ctx: Ctx, memberId: string): Promise<DeactivationImpact> {
  requireAdmin(ctx);
  await findMember(ctx, memberId);
  const [assigned, following] = await Promise.all([
    ctx.trx
      .selectFrom('task_assignees as a')
      .innerJoin('tasks as t', 't.id', 'a.task_id')
      .select(['t.id', 't.title', 't.status', 't.archived_at'])
      .select((eb) =>
        eb
          .selectFrom('task_assignees as o')
          .select(eb.fn.countAll<string>().as('n'))
          .whereRef('o.task_id', '=', 't.id')
          .where('o.member_id', '<>', memberId)
          .as('others'),
      )
      .where('a.member_id', '=', memberId)
      .orderBy('t.number')
      .execute(),
    ctx.trx.selectFrom('task_followers').select('task_id').where('member_id', '=', memberId).execute(),
  ]);
  const impact: DeactivationImpact = {
    member_id: memberId,
    tasks_without_assignee: [],
    tasks_shared_count: 0,
    following_count: following.length,
    // [P3] Zusagen für künftige Termine; Hauptverantwortliche und Partner-Kontakte kommen mit P4
    future_rsvp_count: await futureRsvpCount(ctx.trx, memberId, ctx.now),
    lead_count: 0,
    partner_contact_count: 0,
  };
  for (const task of assigned) {
    if (task.archived_at || !isActiveTaskStatus(task.status)) continue;
    if (Number(task.others ?? 0) > 0) impact.tasks_shared_count += 1;
    else
      impact.tasks_without_assignee.push({
        id: task.id,
        title: task.title,
        status: task.status,
        status_after: statusAfterLastAssigneeLeft(task.status),
      });
  }
  return impact;
}

/** F-LOG-03: Aufräumen direkt in derselben Transaktion, kein Hintergrundjob. */
export async function deactivateMember(ctx: Ctx, memberId: string): Promise<DeactivationImpact> {
  requireAdmin(ctx);
  const member = await findMember(ctx, memberId);
  if (member.is_system) throw rule('Der Systemeintrag lässt sich nicht deaktivieren.');
  if (!member.active) throw rule(`${member.display_name} ist schon deaktiviert.`);
  if (member.is_admin && (await activeAdminCount(ctx)) <= 1)
    throw rule('Letzte Person mit Admin-Rechten – kann nicht deaktiviert werden.');
  const impact = await getDeactivationImpact(ctx, memberId);
  const assigned = await ctx.trx
    .selectFrom('task_assignees')
    .select('task_id')
    .where('member_id', '=', memberId)
    .execute();
  for (const { task_id } of assigned) {
    const task = await ctx.trx
      .selectFrom('tasks')
      .selectAll()
      .where('id', '=', task_id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    await dropAssignee(ctx, task, memberId, 'deactivated');
  }
  const followed = await ctx.trx
    .selectFrom('task_followers')
    .select('task_id')
    .where('member_id', '=', memberId)
    .execute();
  for (const { task_id } of followed) await dropFollower(ctx, task_id, memberId, 'deactivated');
  // [P2] keine Push-Abos und keine Telegram-Verknüpfung mehr, wartende Nachrichten entfallen
  await dropChannels(ctx.trx, memberId);
  await touchMember(ctx, member, { active: false });
  await writeHistory(ctx, 'member', memberId, 'deactivated', { active: { old: true, new: false } });
  // [P3] Zusagen für künftige Termine entfallen
  await dropFutureRsvps(ctx, memberId);
  return impact;
}

export async function reactivateMember(ctx: Ctx, memberId: string): Promise<void> {
  requireAdmin(ctx);
  const member = await findMember(ctx, memberId);
  if (member.active) return;
  // frühere Einträge werden nicht wiederhergestellt (WF-ADM-04)
  await touchMember(ctx, member, { active: true });
  await writeHistory(ctx, 'member', memberId, 'reactivated', { active: { old: false, new: true } });
}

// ── Themen (nur Admins) ─────────────────────────────────────────────────────

async function findTopic(ctx: Ctx, id: string) {
  const topic = await ctx.trx
    .selectFrom('topics')
    .selectAll()
    .where('id', '=', id)
    .forUpdate()
    .executeTakeFirst();
  if (!topic) throw notFound('Dieses Thema');
  return topic;
}

async function assertTopicPlacement(
  ctx: Ctx,
  input: { name: string; parent_id: string | null },
  self?: { id: string },
): Promise<void> {
  const topics = await ctx.trx
    .selectFrom('topics')
    .select(['id', 'name', 'parent_id', 'archived_at'])
    .execute();
  if (input.parent_id) {
    const parent = topics.find((t) => t.id === input.parent_id);
    if (!parent || parent.archived_at || parent.parent_id || parent.id === self?.id)
      throw new AppError('validation', 'Als Oberthema geht nur ein aktives Thema der obersten Ebene.', {
        field: 'parent_id',
      });
    if (self && topics.some((t) => t.parent_id === self.id))
      throw new AppError(
        'validation',
        'Ein Thema mit Unterkategorien kann selbst keine Unterkategorie werden.',
        {
          field: 'parent_id',
        },
      );
  }
  const clash = topics.some(
    (t) =>
      t.id !== self?.id &&
      !t.archived_at &&
      t.parent_id === input.parent_id &&
      t.name.toLowerCase() === input.name.toLowerCase(),
  );
  if (clash)
    throw new AppError('validation', 'Ein Thema mit diesem Namen gibt es hier schon.', { field: 'name' });
}

async function nextSortOrder(ctx: Ctx, parentId: string | null, exceptId?: string): Promise<number> {
  const max = await ctx.trx
    .selectFrom('topics')
    .select(ctx.trx.fn.max('sort_order').as('max'))
    .where('parent_id', parentId === null ? 'is' : '=', parentId)
    .$if(!!exceptId, (q) => q.where('id', '<>', exceptId!))
    .executeTakeFirst();
  return Math.max(0, Number(max?.max ?? 0)) + 1;
}

export async function createTopic(ctx: Ctx, raw: unknown): Promise<{ id: string }> {
  requireAdmin(ctx);
  const input = parse(topicCreateSchema, raw);
  await assertTopicPlacement(ctx, input);
  const now = iso(ctx);
  const topic = await ctx.trx
    .insertInto('topics')
    .values({
      name: input.name,
      parent_id: input.parent_id,
      sort_order: await nextSortOrder(ctx, input.parent_id),
      created_at: now,
      updated_at: now,
      created_by: ctx.actor.id,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await writeHistory(ctx, 'topic', topic.id, 'created', { name: { old: null, new: input.name } });
  return { id: topic.id };
}

export async function updateTopic(ctx: Ctx, id: string, raw: unknown): Promise<void> {
  requireAdmin(ctx);
  const input = parse(topicUpdateSchema, raw);
  const topic = await findTopic(ctx, id);
  await checkVersion(ctx, 'topic', topic, input.version);
  await assertTopicPlacement(ctx, input, topic);
  const changes: HistoryChanges = {};
  const set: Record<string, unknown> = {};
  if (topic.name !== input.name) {
    changes.name = { old: topic.name, new: input.name };
    set.name = input.name;
  }
  if (topic.parent_id !== input.parent_id) {
    changes.parent_id = { old: topic.parent_id, new: input.parent_id };
    set.parent_id = input.parent_id;
    set.sort_order = await nextSortOrder(ctx, input.parent_id, id);
  }
  if (Object.keys(changes).length === 0) return;
  const result = await ctx.trx
    .updateTable('topics')
    .set({ ...set, version: topic.version + 1, updated_at: iso(ctx) })
    .where('id', '=', id)
    .where('version', '=', topic.version)
    .executeTakeFirst();
  await updatedOne(ctx, result, 'topic', topic);
  await writeHistory(ctx, 'topic', id, 'updated', changes);
}

export async function archiveTopic(ctx: Ctx, id: string, version: number): Promise<void> {
  requireAdmin(ctx);
  const topic = await findTopic(ctx, id);
  await checkVersion(ctx, 'topic', topic, version);
  if (topic.archived_at) return;
  const tasks = await ctx.trx
    .selectFrom('tasks')
    .select(['status', 'archived_at'])
    .where('topic_id', '=', id)
    .execute();
  const active = tasks.filter((t) => !t.archived_at && isActiveTaskStatus(t.status)).length;
  if (active > 0)
    throw rule(
      `Das Thema hat noch ${active} ${active === 1 ? 'aktive Aufgabe' : 'aktive Aufgaben'} und lässt sich deshalb nicht archivieren.`,
    );
  const children = await ctx.trx
    .selectFrom('topics')
    .select('id')
    .where('parent_id', '=', id)
    .where('archived_at', 'is', null)
    .executeTakeFirst();
  if (children) throw rule('Erst die Unterkategorien archivieren oder umhängen.');
  await ctx.trx
    .updateTable('topics')
    .set({ archived_at: iso(ctx), version: topic.version + 1, updated_at: iso(ctx) })
    .where('id', '=', id)
    .execute();
  await writeHistory(ctx, 'topic', id, 'archived');
}

export async function restoreTopic(ctx: Ctx, id: string, version: number): Promise<void> {
  requireAdmin(ctx);
  const topic = await findTopic(ctx, id);
  await checkVersion(ctx, 'topic', topic, version);
  if (!topic.archived_at) return;
  if (topic.parent_id && (await findTopic(ctx, topic.parent_id)).archived_at)
    throw rule('Erst das Oberthema wiederherstellen.');
  // inzwischen kann ein gleichnamiges Thema angelegt worden sein
  await assertTopicPlacement(ctx, { name: topic.name, parent_id: topic.parent_id }, topic);
  await ctx.trx
    .updateTable('topics')
    .set({ archived_at: null, version: topic.version + 1, updated_at: iso(ctx) })
    .where('id', '=', id)
    .execute();
  await writeHistory(ctx, 'topic', id, 'restored');
}

export async function deleteTopic(ctx: Ctx, id: string): Promise<void> {
  requireAdmin(ctx);
  const topic = await findTopic(ctx, id);
  // Vorlagen zählen erst ab Phase 4 mit
  if (await ctx.trx.selectFrom('tasks').select('id').where('topic_id', '=', id).executeTakeFirst())
    throw rule('Das Thema wird benutzt (auch Vorlagen zählen) und lässt sich deshalb nur archivieren.');
  if (await ctx.trx.selectFrom('topics').select('id').where('parent_id', '=', id).executeTakeFirst())
    throw rule('Das Thema hat Unterkategorien und lässt sich deshalb nicht löschen.');
  await writeHistory(ctx, 'topic', id, 'deleted', { name: { old: topic.name, new: null } });
  await ctx.trx.deleteFrom('topics').where('id', '=', id).execute();
}
