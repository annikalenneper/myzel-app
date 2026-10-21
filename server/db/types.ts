// Tabellen-Typen für Kysely, passend zu supabase/migrations. Spaltennamen wie im Datenvertrag (src/shared/schema.ts);
// Zeitstempel kommen als ISO-Text aus der Datenbank, Datumsfelder als YYYY-MM-DD (siehe connection.ts).
import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';
import type {
  EventStatus,
  EventType,
  HistoryChanges,
  NotificationChannel,
  NotificationEvent,
  Priority,
  TaskStatus,
} from '../../src/shared/schema';

type Timestamp = ColumnType<string, string, string>;
type CreatedAt = ColumnType<string, string | undefined, never>;

export interface MembersTable {
  id: Generated<string>;
  auth_user_id: string | null;
  email: string | null;
  display_name: string;
  short: string;
  is_admin: Generated<boolean>;
  active: Generated<boolean>;
  is_system: Generated<boolean>;
  created_at: CreatedAt;
  updated_at: Timestamp;
  created_by: string | null;
  version: Generated<number>;
  /** [P2] Vorlauf für Fristerinnerungen */
  reminder_lead_days: Generated<number>;
}

export interface TopicsTable {
  id: Generated<string>;
  name: string;
  parent_id: string | null;
  sort_order: Generated<number>;
  archived_at: Timestamp | null;
  created_at: CreatedAt;
  updated_at: Timestamp;
  created_by: string | null;
  version: Generated<number>;
}

export interface EventsTable {
  id: Generated<string>;
  title: string;
  type: EventType;
  description: string | null;
  starts_at: Timestamp;
  ends_at: Timestamp | null;
  status: Generated<EventStatus>;
  archived_at: Timestamp | null;
  created_at: CreatedAt;
  updated_at: Timestamp;
  created_by: string;
  version: Generated<number>;
}

export interface TasksTable {
  id: Generated<string>;
  number: Generated<number>;
  title: string;
  description: string | null;
  topic_id: string;
  event_id: string | null;
  priority: Generated<Priority>;
  /** YYYY-MM-DD */
  due_date: ColumnType<string | null, string | null, string | null>;
  status: Generated<TaskStatus>;
  block_reason: string | null;
  discard_reason: string | null;
  archived_at: Timestamp | null;
  created_at: CreatedAt;
  updated_at: Timestamp;
  created_by: string;
  version: Generated<number>;
}

export interface TaskAssigneesTable {
  task_id: string;
  member_id: string;
  assigned_by: string;
  assigned_at: CreatedAt;
}

export interface TaskFollowersTable {
  task_id: string;
  member_id: string;
}

export interface TaskBlockersTable {
  task_id: string;
  blocker_task_id: string;
}

export interface CommentsTable {
  id: Generated<string>;
  task_id: string;
  author_id: string;
  body: string;
  created_at: CreatedAt;
  updated_at: Timestamp;
}

export interface PlenumMarksTable {
  id: Generated<string>;
  task_id: string | null;
  position: number;
  note: string | null;
  marked_by: string;
  marked_at: CreatedAt;
}

export interface HistoryTable {
  id: Generated<string>;
  seq: Generated<string>;
  entity_type: 'task' | 'event' | 'member' | 'topic';
  entity_id: string;
  actor_member_id: string;
  action: string;
  changes: ColumnType<HistoryChanges, string, never>;
  created_at: CreatedAt;
}

export interface UndoActionsTable {
  token: Generated<string>;
  actor_id: string;
  created_at: CreatedAt;
  entity_type: string;
  entity_id: string;
  version_after: number;
  label: string;
  ops: ColumnType<unknown[], string, never>;
  history_ids: ColumnType<string[], string, never>;
  /** [P2] Nachrichten der Aktion, die „Rückgängig“ noch zurückzieht */
  outbox_ids: ColumnType<string[], string | undefined, never>;
}

// ── Phase 2: Erinnerungen ───────────────────────────────────────────────────
export interface PushSubscriptionsTable {
  id: Generated<string>;
  member_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: CreatedAt;
}

export interface TelegramLinksTable {
  member_id: string;
  chat_id: string;
  linked_at: CreatedAt;
}

export interface TelegramLinkCodesTable {
  code: string;
  member_id: string;
  expires_at: Timestamp;
  used_at: Timestamp | null;
}

export interface NotificationOutboxTable {
  id: Generated<string>;
  dedupe_key: string;
  member_id: string;
  event_type: NotificationEvent;
  channel: NotificationChannel;
  text: string;
  link: string;
  status: Generated<'wartet' | 'gesendet' | 'fehlgeschlagen'>;
  attempts: Generated<number>;
  last_error: string | null;
  locked_until: Timestamp | null;
  /** Push: Endpoints, die die Nachricht schon bekommen haben */
  delivered_to: ColumnType<string[], string | undefined, string>;
  created_at: CreatedAt;
  sent_at: Timestamp | null;
}

export interface JobRunsTable {
  id: Generated<string>;
  started_at: Timestamp;
  finished_at: Timestamp | null;
  result: 'ok' | 'fehler';
  summary: string;
  error: string | null;
  sent_push: Generated<number>;
  sent_telegram: Generated<number>;
  retries: Generated<number>;
}

export interface Database {
  members: MembersTable;
  topics: TopicsTable;
  events: EventsTable;
  tasks: TasksTable;
  task_assignees: TaskAssigneesTable;
  task_followers: TaskFollowersTable;
  task_blockers: TaskBlockersTable;
  comments: CommentsTable;
  plenum_marks: PlenumMarksTable;
  history: HistoryTable;
  undo_actions: UndoActionsTable;
  push_subscriptions: PushSubscriptionsTable;
  telegram_links: TelegramLinksTable;
  telegram_link_codes: TelegramLinkCodesTable;
  notification_outbox: NotificationOutboxTable;
  job_runs: JobRunsTable;
}

export type MemberRow = Selectable<MembersTable>;
export type TaskRow = Selectable<TasksTable>;
export type NewTask = Insertable<TasksTable>;
export type TaskUpdate = Updateable<TasksTable>;
