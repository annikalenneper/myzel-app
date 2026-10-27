// Tabellen-Typen für Kysely, passend zu supabase/migrations. Spaltennamen wie im Datenvertrag (src/shared/schema.ts);
// Zeitstempel kommen als ISO-Text aus der Datenbank, Datumsfelder als YYYY-MM-DD (siehe connection.ts).
import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';
import type {
  AppointmentFormat,
  AppReportKind,
  AppointmentStatus,
  DecisionKind,
  DecisionStatus,
  DecisionVoteKind,
  MarkReason,
  DocType,
  DocumentLinkTarget,
  QuestionStatus,
  RsvpAnswer,
  EventBooking,
  EventDetails,
  EventStatus,
  EventType,
  HistoryChanges,
  NotificationChannel,
  NotificationEvent,
  Priority,
  Reaction,
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

/** Weitere Login-Adressen (3.1); jede mit eigener Verknüpfung zum Supabase-Login */
export interface MemberEmailsTable {
  id: Generated<string>;
  member_id: string;
  email: string;
  auth_user_id: string | null;
  created_at: CreatedAt;
  created_by: string;
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
  /** [P4] Aufbau, Abbau, Schichtplan */
  setup_at: Timestamp | null;
  teardown_at: Timestamp | null;
  shift_plan_document_id: string | null;
  /** [P5] Ordner im Vereins-Drive */
  drive_folder_id: string | null;
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
  /** [P3] Termin und Herkunft aus einem Plenum */
  appointment_id: string | null;
  origin_plenum_id: string | null;
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
  /** genau eine Zielspalte ist gesetzt (16.3) */
  task_id: string | null;
  question_id: string | null;
  decision_id: string | null;
  event_id: string | null;
  appointment_id: string | null;
  partner_id: string | null;
  author_id: string;
  body: string;
  created_at: CreatedAt;
  updated_at: Timestamp;
}

/** Entscheidung oder Fakt ausdrücklich auf der Agenda (16.1) */
export interface PlenumMarksTable {
  id: Generated<string>;
  decision_id: string;
  position: number;
  note: string | null;
  /** Phase 12: „Stimmt das noch?“ oder „Aktion erforderlich“ */
  reason: Generated<MarkReason>;
  marked_by: string;
  marked_at: CreatedAt;
}

export interface HistoryTable {
  id: Generated<string>;
  seq: Generated<string>;
  entity_type:
    | 'task'
    | 'event'
    | 'member'
    | 'topic'
    | 'appointment'
    | 'appointment_type'
    | 'decision'
    | 'question'
    | 'document'
    | 'partner';
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

// ── Phase 3: Plenum-Zyklus ──────────────────────────────────────────────────
export interface AppointmentTypesTable {
  id: Generated<string>;
  key: string;
  label: string;
  default_topic_id: string;
  default_format: AppointmentFormat;
  default_location: string | null;
  has_plenum_features: boolean;
  color: string;
  sort_order: number;
  archived_at: Timestamp | null;
  created_at: CreatedAt;
  updated_at: Timestamp;
  created_by: string | null;
  version: Generated<number>;
}

export interface AppointmentsTable {
  id: Generated<string>;
  type_id: string;
  title: string;
  topic_id: string;
  event_id: string | null;
  starts_at: Timestamp;
  ends_at: Timestamp | null;
  format: AppointmentFormat;
  location: string | null;
  online_url: string | null;
  status: Generated<AppointmentStatus>;
  is_exception: Generated<boolean>;
  protocol_document_id: string | null;
  protocol_member_id: string | null;
  description: string | null;
  notes: string | null;
  archived_at: Timestamp | null;
  created_at: CreatedAt;
  updated_at: Timestamp;
  created_by: string;
  version: Generated<number>;
}

export interface AppointmentRsvpsTable {
  appointment_id: string;
  member_id: string;
  answer: RsvpAnswer;
  answered_at: Timestamp;
}

export interface AppointmentAttendeesTable {
  appointment_id: string;
  member_id: string;
}

export interface DocumentsTable {
  id: Generated<string>;
  title: string;
  url: string;
  drive_file_id: string | null;
  doc_type: DocType;
  topic_id: string | null;
  tags: ColumnType<string[], string, string>;
  description: string | null;
  archived_at: Timestamp | null;
  created_at: CreatedAt;
  updated_at: Timestamp;
  created_by: string;
  version: Generated<number>;
}

export interface DocumentLinksTable {
  document_id: string;
  target_type: DocumentLinkTarget;
  target_id: string;
}

export interface DecisionsTable {
  id: Generated<string>;
  title: string;
  description: string | null;
  kind: DecisionKind;
  topic_id: string;
  /** YYYY-MM-DD */
  decided_on: string;
  status: Generated<DecisionStatus>;
  superseded_by_id: string | null;
  source_plenum_id: string | null;
  source_document_id: string | null;
  source_note: string | null;
  source_question_id: string | null;
  event_id: string | null;
  /** YYYY-MM-DD, letzter Tag zum Bestätigen (16.4) */
  consensus_until: string | null;
  archived_at: Timestamp | null;
  created_at: CreatedAt;
  updated_at: Timestamp;
  created_by: string;
  version: Generated<number>;
}

/** Schalter-Matrix (F-PRO-02): fehlt eine Zeile, ist der Kanal für dieses Ereignis an */
export interface NotificationPreferencesTable {
  member_id: string;
  event_type: NotificationEvent;
  channel: NotificationChannel;
  enabled: boolean;
}

export interface CommentReactionsTable {
  comment_id: string;
  member_id: string;
  reaction: Reaction;
  created_at: CreatedAt;
}

export interface AppReportsTable {
  id: Generated<string>;
  kind: AppReportKind;
  text: string;
  app_version: string;
  member_id: string;
  created_at: CreatedAt;
}

export interface DecisionVotesTable {
  decision_id: string;
  member_id: string;
  vote: DecisionVoteKind;
  voted_at: Timestamp;
}

export interface QuestionsTable {
  id: Generated<string>;
  title: string;
  description: string | null;
  topic_id: string;
  event_id: string | null;
  urgency: Generated<Priority>;
  status: Generated<QuestionStatus>;
  raised_by: string;
  answer: string | null;
  answered_in_plenum_id: string | null;
  archived_at: Timestamp | null;
  created_at: CreatedAt;
  updated_at: Timestamp;
  created_by: string;
  version: Generated<number>;
}

// ── Phase 4: Veranstaltungen ────────────────────────────────────────────────
export interface EventDetailsTable {
  event_id: string;
  data: ColumnType<EventDetails, string, string>;
}

export interface EventBookingsTable {
  id: Generated<string>;
  event_id: string;
  act_name: string;
  act_type: EventBooking['act_type'];
  contact: string | null;
  status: EventBooking['status'];
  fee_status: Generated<EventBooking['fee_status']>;
  fee: string | null;
  tech_requirements: string | null;
  notes: string | null;
  created_at: CreatedAt;
  created_by: string;
  version: Generated<number>;
}

export interface EventLeadsTable {
  event_id: string;
  member_id: string;
  added_by: string;
  added_at: Timestamp;
}

export interface PartnersTable {
  id: Generated<string>;
  name: string;
  kind: string | null;
  description: string | null;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  notes: string | null;
  internal_contact_member_id: string | null;
  archived_at: Timestamp | null;
  created_at: CreatedAt;
  updated_at: Timestamp;
  created_by: string;
  version: Generated<number>;
}

export interface EventPartnersTable {
  event_id: string;
  partner_id: string;
  role_note: string | null;
  added_by: string;
  added_at: Timestamp;
}

export interface EventTemplatesTable {
  id: Generated<string>;
  event_type: EventType;
  name: string;
  updated_at: Timestamp;
  version: Generated<number>;
}

export interface EventTemplateItemsTable {
  id: Generated<string>;
  template_id: string;
  block: string;
  title: string;
  description: string | null;
  offset_days: number;
  default_priority: Priority;
  topic_id: string;
  position: number;
  archived_at: Timestamp | null;
  version: Generated<number>;
}

export interface TemplateApplicationsTable {
  event_id: string;
  template_item_id: string;
  task_id: string;
  applied_by: string;
  applied_at: Timestamp;
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

/** [P5] Drive-Cache (3.13): nur Metadaten */
export interface DriveItemsTable {
  file_id: string;
  parent_id: string | null;
  name: string;
  mime_type: string;
  modified_time: Timestamp;
  web_url: string;
  trashed: boolean;
  synced_at: Timestamp;
}

export interface DriveSyncStateTable {
  id: Generated<boolean>;
  root_folder_id: string;
  changes_page_token: string | null;
  last_checked_at: Timestamp | null;
  last_full_sync_at: Timestamp | null;
  /** letzter Versuch, auch fehlgeschlagen – höchstens einmal pro Minute erneut */
  last_attempt_at: ColumnType<string | null, string | null | undefined, string | null>;
}

export interface Database {
  members: MembersTable;
  member_emails: MemberEmailsTable;
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
  appointment_types: AppointmentTypesTable;
  appointments: AppointmentsTable;
  appointment_rsvps: AppointmentRsvpsTable;
  appointment_attendees: AppointmentAttendeesTable;
  documents: DocumentsTable;
  document_links: DocumentLinksTable;
  decisions: DecisionsTable;
  decision_votes: DecisionVotesTable;
  questions: QuestionsTable;
  event_details: EventDetailsTable;
  event_bookings: EventBookingsTable;
  event_leads: EventLeadsTable;
  partners: PartnersTable;
  event_partners: EventPartnersTable;
  event_templates: EventTemplatesTable;
  event_template_items: EventTemplateItemsTable;
  template_applications: TemplateApplicationsTable;
  drive_items: DriveItemsTable;
  drive_sync_state: DriveSyncStateTable;
  app_reports: AppReportsTable;
  notification_preferences: NotificationPreferencesTable;
  comment_reactions: CommentReactionsTable;
}

export type MemberRow = Selectable<MembersTable>;
export type TaskRow = Selectable<TasksTable>;
export type AppointmentRow = Selectable<AppointmentsTable>;
export type AppointmentTypeRow = Selectable<AppointmentTypesTable>;
export type DecisionRow = Selectable<DecisionsTable>;
export type QuestionRow = Selectable<QuestionsTable>;
export type DocumentRow = Selectable<DocumentsTable>;
export type EventRow = Selectable<EventsTable>;
export type BookingRow = Selectable<EventBookingsTable>;
export type PartnerRow = Selectable<PartnersTable>;
export type TemplateItemRow = Selectable<EventTemplateItemsTable>;
export type NewTask = Insertable<TasksTable>;
export type TaskUpdate = Updateable<TasksTable>;
