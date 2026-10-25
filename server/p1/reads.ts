// Lesen, Phase 1 (F-AUF-01 bis -03, F-AUF-05, F-VER-01, F-VER-03): dieselben Formen wie die Testdaten-Schicht.
// Felder späterer Phasen liefern hier ihren leeren Wert, bis deren Migrationen kommen.
import { sql, type Kysely } from 'kysely';
import type { EventListItem, TaskDetail, TaskListItem, TopicWithUsage } from '../../src/data/api';
import { berlinDate, isOverdue } from '../../src/shared/rules/due';
import { isActiveTaskStatus } from '../../src/shared/rules/taskStatus';
import type { EventRow, HistoryEntry, Member, Task, Topic } from '../../src/shared/schema';
import { notFound } from '../core/context';
import type { Database } from '../db/types';

type Db = Kysely<Database>;

export async function listMembers(db: Db): Promise<Member[]> {
  const rows = await db.selectFrom('members').selectAll().orderBy('created_at').orderBy('id').execute();
  // die Login-ID braucht nur der Server, nicht die anderen Mitglieder
  return rows.map((m) => ({ ...m, auth_user_id: null }));
}

export async function listTopics(db: Db): Promise<TopicWithUsage[]> {
  const [topics, tasks] = await Promise.all([
    db.selectFrom('topics').selectAll().orderBy('created_at').orderBy('id').execute(),
    db.selectFrom('tasks').select(['topic_id', 'status', 'archived_at']).execute(),
  ]);
  return topics.map((topic: Topic) => {
    const own = tasks.filter((t) => t.topic_id === topic.id);
    return {
      ...topic,
      task_count: own.length,
      active_task_count: own.filter((t) => !t.archived_at && isActiveTaskStatus(t.status)).length,
    };
  });
}

async function taskItems(db: Db, tasks: Task[]): Promise<TaskListItem[]> {
  if (tasks.length === 0) return [];
  const ids = tasks.map((t) => t.id);
  const [assignees, followers, blockers, comments] = await Promise.all([
    db
      .selectFrom('task_assignees')
      .select(['task_id', 'member_id'])
      .where('task_id', 'in', ids)
      .orderBy('assigned_at')
      .execute(),
    db.selectFrom('task_followers').select(['task_id', 'member_id']).where('task_id', 'in', ids).execute(),
    db
      .selectFrom('task_blockers')
      .innerJoin('tasks', 'tasks.id', 'task_blockers.blocker_task_id')
      .select(['task_blockers.task_id', 'tasks.title'])
      .where('task_blockers.task_id', 'in', ids)
      .where('tasks.archived_at', 'is', null)
      .execute(),
    db
      .selectFrom('comments')
      .select(['task_id', db.fn.countAll<string>().as('n')])
      .where('task_id', 'in', ids)
      .groupBy('task_id')
      .execute(),
  ]);
  return tasks.map((t) => ({
    ...t,
    assignee_ids: assignees.filter((a) => a.task_id === t.id).map((a) => a.member_id),
    follower_ids: followers.filter((f) => f.task_id === t.id).map((f) => f.member_id),
    blocker_titles: blockers.filter((b) => b.task_id === t.id).map((b) => b.title),
    comment_count: Number(comments.find((c) => c.task_id === t.id)?.n ?? 0),
  }));
}

export async function listTasks(db: Db): Promise<TaskListItem[]> {
  const tasks = await db
    .selectFrom('tasks')
    .selectAll()
    .where('archived_at', 'is', null)
    .orderBy('number')
    .execute();
  return taskItems(db, tasks);
}

export async function historyOf(
  db: Db,
  entityType: HistoryEntry['entity_type'],
  id: string,
): Promise<HistoryEntry[]> {
  const rows = await db
    .selectFrom('history')
    .select(['id', 'entity_type', 'entity_id', 'actor_member_id', 'action', 'changes', 'created_at'])
    .where('entity_type', '=', entityType as 'task')
    .where('entity_id', '=', id)
    // neueste zuerst; bei gleichem Zeitstempel zählt die Reihenfolge des Eintragens
    .orderBy('created_at', 'desc')
    .orderBy('seq', 'desc')
    .execute();
  return rows;
}

export async function getTask(db: Db, id: string): Promise<TaskDetail> {
  const task = await db.selectFrom('tasks').selectAll().where('id', '=', id).executeTakeFirst();
  if (!task) throw notFound('Diese Aufgabe');
  const [item] = await taskItems(db, [task]);
  const [blockers, comments, history] = await Promise.all([
    db
      .selectFrom('task_blockers')
      .innerJoin('tasks', 'tasks.id', 'task_blockers.blocker_task_id')
      .select(['tasks.id', 'tasks.title', 'tasks.status'])
      .where('task_blockers.task_id', '=', id)
      .where('tasks.archived_at', 'is', null)
      .orderBy('tasks.number')
      .execute(),
    db
      .selectFrom('comments')
      .selectAll()
      .where('task_id', '=', id)
      .orderBy('created_at')
      .orderBy('id')
      .execute(),
    historyOf(db, 'task', id),
  ]);
  return { ...item!, blockers, comments, history };
}

async function eventItems(db: Db, events: EventRow[], now: Date): Promise<EventListItem[]> {
  if (events.length === 0) return [];
  const ids = events.map((e) => e.id);
  const today = berlinDate(now);
  const [tasks, followUp] = await Promise.all([
    db
      .selectFrom('tasks')
      .select(['event_id', 'status', 'due_date'])
      .where('event_id', 'in', ids)
      .where('archived_at', 'is', null)
      .where('status', '<>', 'verworfen')
      .execute(),
    // seit wann „in Nachbereitung“: der letzte Statuswechsel dorthin (4.2)
    db
      .selectFrom('history')
      .select(['entity_id', db.fn.max('created_at').as('since')])
      .where('entity_type', '=', 'event')
      .where('entity_id', 'in', ids)
      .where(sql<boolean>`changes -> 'status' ->> 'new' = 'in_nachbereitung'`)
      .groupBy('entity_id')
      .execute(),
  ]);
  return events.map((e) => {
    const own = tasks.filter((t) => t.event_id === e.id);
    return {
      ...e,
      task_total: own.length,
      task_done: own.filter((t) => t.status === 'erledigt').length,
      task_overdue: own.filter((t) => isOverdue(t.due_date, t.status, today)).length,
      follow_up_since:
        e.status === 'in_nachbereitung'
          ? (followUp.find((f) => f.entity_id === e.id)?.since ?? e.updated_at)
          : null,
    };
  });
}

export async function listEvents(db: Db, now: Date): Promise<EventListItem[]> {
  const events = await db
    .selectFrom('events')
    .selectAll()
    .where('archived_at', 'is', null)
    .orderBy('starts_at')
    .execute();
  return eventItems(db, events, now);
}

export async function getEvent(db: Db, id: string, now: Date): Promise<EventListItem> {
  const event = await db.selectFrom('events').selectAll().where('id', '=', id).executeTakeFirst();
  if (!event) throw notFound('Diese Veranstaltung');
  return (await eventItems(db, [event], now))[0]!;
}
