// Datenvertrag Phase 1 (ANFORDERUNGEN Abschnitt 3): Zeilen-Schemas der Tabellen und
// Eingabe-Schemas der Server-Funktionen. Gemeinsam für Frontend und Functions.
import { z } from 'zod';
import { isPlausibleDate } from './rules/due';
import { parseRule } from './rules/series';

export const idSchema = z.uuid();
export const timestampSchema = z.iso.datetime({ offset: true });
export const dateSchema = z.iso
  .date()
  .refine(isPlausibleDate, 'Bitte ein Datum zwischen 2000 und 2100 wählen.');

export const TASK_STATUSES = ['neu', 'geplant', 'in_arbeit', 'blockiert', 'erledigt', 'verworfen'] as const;
export const taskStatusSchema = z.enum(TASK_STATUSES);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const PRIORITIES = ['hoch', 'mittel', 'niedrig'] as const;
export const prioritySchema = z.enum(PRIORITIES);
export type Priority = z.infer<typeof prioritySchema>;

/** Frage 5, von der Nutzerin bestätigt (20.10.2026) */
export const EVENT_TYPES = ['party', 'workshop', 'soli', 'sonstiges'] as const;
export const eventTypeSchema = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof eventTypeSchema>;

export const EVENT_STATUSES = [
  'idee',
  'in_planung',
  'bestaetigt',
  'in_nachbereitung',
  'abgeschlossen',
  'abgesagt',
] as const;
export const eventStatusSchema = z.enum(EVENT_STATUSES);
export type EventStatus = z.infer<typeof eventStatusSchema>;

// ── Zeilen ──────────────────────────────────────────────────────────────────

export const memberSchema = z.object({
  id: idSchema,
  auth_user_id: idSchema.nullable(),
  email: z.email().nullable(), // nur der Systemeintrag hat keine
  display_name: z.string().min(1),
  short: z.string().min(1).max(3),
  is_admin: z.boolean(),
  active: z.boolean(),
  is_system: z.boolean(),
  /** Vorlauf für Fristerinnerungen in Tagen, Standard 3 [P2] */
  reminder_lead_days: z.number().int().min(0),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  created_by: idSchema.nullable(),
  version: z.number().int().min(1),
});
export type Member = z.infer<typeof memberSchema>;

/** Weitere Login-Adresse eines Mitglieds (3.1); die Hauptadresse steht in members.email */
export const memberEmailSchema = z.object({
  id: idSchema,
  member_id: idSchema,
  email: z.email(),
  created_at: timestampSchema,
  created_by: idSchema,
});
export type MemberEmail = z.infer<typeof memberEmailSchema>;

export const topicSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  parent_id: idSchema.nullable(),
  sort_order: z.number().int(),
  archived_at: timestampSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  created_by: idSchema.nullable(),
  version: z.number().int().min(1),
});
export type Topic = z.infer<typeof topicSchema>;

export const taskSchema = z.object({
  id: idSchema,
  number: z.number().int().min(1),
  title: z.string().min(1),
  description: z.string().nullable(),
  topic_id: idSchema,
  event_id: idSchema.nullable(),
  /** z. B. Bautag [P3] */
  appointment_id: idSchema.nullable(),
  /** Plenum, in dem die Aufgabe beschlossen oder eingeplant wurde [P3] */
  origin_plenum_id: idSchema.nullable(),
  priority: prioritySchema,
  due_date: dateSchema.nullable(),
  status: taskStatusSchema,
  block_reason: z.string().nullable(),
  discard_reason: z.string().nullable(),
  archived_at: timestampSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  created_by: idSchema,
  version: z.number().int().min(1),
});
export type Task = z.infer<typeof taskSchema>;

export const taskAssigneeSchema = z.object({
  task_id: idSchema,
  member_id: idSchema,
  assigned_by: idSchema,
  assigned_at: timestampSchema,
});
export type TaskAssignee = z.infer<typeof taskAssigneeSchema>;

export const taskFollowerSchema = z.object({ task_id: idSchema, member_id: idSchema });
export type TaskFollower = z.infer<typeof taskFollowerSchema>;

/** „task_id hängt ab von blocker_task_id“ */
export const taskBlockerSchema = z.object({ task_id: idSchema, blocker_task_id: idSchema });
export type TaskBlocker = z.infer<typeof taskBlockerSchema>;

/** Woran Kommentare hängen können (16.3) – genau eine Zielspalte ist gesetzt */
export const COMMENT_TARGETS = ['task', 'question', 'decision', 'event', 'appointment', 'partner'] as const;
export type CommentTarget = (typeof COMMENT_TARGETS)[number];
export const commentSchema = z.object({
  id: idSchema,
  task_id: idSchema.nullable(),
  question_id: idSchema.nullable(),
  decision_id: idSchema.nullable(),
  event_id: idSchema.nullable(),
  appointment_id: idSchema.nullable(),
  partner_id: idSchema.nullable(),
  author_id: idSchema,
  body: z.string().min(1),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});
export type Comment = z.infer<typeof commentSchema>;

/**
 * Entscheidung oder Fakt ausdrücklich auf der Agenda (16.1): „Stimmt das noch?“. Andere Arten stehen von selbst
 * auf der Agenda (offene Aufgaben und Fragen) oder gar nicht.
 */
export const plenumMarkSchema = z.object({
  id: idSchema,
  decision_id: idSchema,
  position: z.number().int(),
  note: z.string().nullable(),
  marked_by: idSchema,
  marked_at: timestampSchema,
});
export type PlenumMark = z.infer<typeof plenumMarkSchema>;

export const eventSchema = z.object({
  id: idSchema,
  title: z.string().min(1),
  type: eventTypeSchema,
  description: z.string().nullable(),
  starts_at: timestampSchema,
  ends_at: timestampSchema.nullable(),
  /** [P4] Aufbau ab, Abbau bis; Schichtplan als verknüpftes Dokument */
  setup_at: timestampSchema.nullable(),
  teardown_at: timestampSchema.nullable(),
  shift_plan_document_id: idSchema.nullable(),
  /** [P5] Ordner im Vereins-Drive; die Detailansicht zeigt seinen Inhalt aus dem Cache */
  drive_folder_id: z.string().nullable(),
  status: eventStatusSchema,
  archived_at: timestampSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  created_by: idSchema,
  version: z.number().int().min(1),
});
export type EventRow = z.infer<typeof eventSchema>;

export const HISTORY_ENTITY_TYPES = [
  'task',
  'event',
  'member',
  'topic',
  'appointment',
  'appointment_type',
  'appointment_series',
  'decision',
  'question',
  'document',
  'partner',
] as const;
export type HistoryEntityType = (typeof HISTORY_ENTITY_TYPES)[number];
export const historyChangeSchema = z.object({ old: z.unknown(), new: z.unknown() });
export const historySchema = z.object({
  id: idSchema,
  entity_type: z.enum(HISTORY_ENTITY_TYPES),
  entity_id: idSchema,
  actor_member_id: idSchema,
  action: z.string().min(1),
  changes: z.record(z.string(), historyChangeSchema),
  created_at: timestampSchema,
});
export type HistoryEntry = z.infer<typeof historySchema>;
export type HistoryChanges = HistoryEntry['changes'];

// ── Benachrichtigungen [P2] (3.11) ──────────────────────────────────────────

export const NOTIFICATION_EVENTS = [
  'zuweisung',
  'kommentar',
  'frist_naht',
  'frist_heute',
  'frist_ueberschritten',
  'status',
  'blockade_aufgehoben',
  // [P3]
  'termin_einladung',
  'termin_erinnerung',
  'termin_geaendert',
  'plenum_zusammenfassung',
  // [P6] Telegram-Button „Passt nicht“: an die Person, die zugewiesen hat (6.4)
  'zuweisung_abgelehnt',
] as const;
export const notificationEventSchema = z.enum(NOTIFICATION_EVENTS);
export type NotificationEvent = z.infer<typeof notificationEventSchema>;

export const NOTIFICATION_CHANNELS = ['push', 'telegram'] as const;
export const notificationChannelSchema = z.enum(NOTIFICATION_CHANNELS);
export type NotificationChannel = z.infer<typeof notificationChannelSchema>;

/** [P6] Schalter-Matrix (F-PRO-02): fehlt eine Zeile, ist der Kanal für dieses Ereignis an */
export const notificationPreferenceSchema = z.object({
  member_id: idSchema,
  event_type: notificationEventSchema,
  channel: notificationChannelSchema,
  enabled: z.boolean(),
});
export type NotificationPreference = z.infer<typeof notificationPreferenceSchema>;

/** Vorlauf für Fristerinnerungen: Auswahl wie im Prototyp (D-Profil) */
export const REMINDER_LEAD_CHOICES = [1, 3, 7] as const;
export const reminderLeadSchema = z
  .number()
  .int()
  .refine((v) => (REMINDER_LEAD_CHOICES as readonly number[]).includes(v), 'Bitte 1, 3 oder 7 Tage wählen.');

/** Push-Endpoints und Telegram-Chat-IDs gelten als personenbezogen (Abschnitt 9). */
export const pushSubscriptionSchema = z.object({
  id: idSchema,
  member_id: idSchema,
  endpoint: z.string().min(1),
  created_at: timestampSchema,
});
export type PushSubscriptionRow = z.infer<typeof pushSubscriptionSchema>;

export const telegramLinkSchema = z.object({
  member_id: idSchema,
  chat_id: z.string().min(1),
  linked_at: timestampSchema,
});
export type TelegramLink = z.infer<typeof telegramLinkSchema>;

/** Einmal-Code: 15 Minuten gültig, einmal verwendbar */
export const telegramLinkCodeSchema = z.object({
  code: z.string().min(8),
  member_id: idSchema,
  expires_at: timestampSchema,
  used_at: timestampSchema.nullable(),
});
export type TelegramLinkCode = z.infer<typeof telegramLinkCodeSchema>;

export const OUTBOX_STATUSES = ['wartet', 'gesendet', 'fehlgeschlagen'] as const;
export const outboxSchema = z.object({
  id: idSchema,
  dedupe_key: z.string().min(1),
  member_id: idSchema,
  event_type: notificationEventSchema,
  channel: notificationChannelSchema,
  text: z.string().min(1),
  link: z.string().min(1),
  status: z.enum(OUTBOX_STATUSES),
  attempts: z.number().int().min(0),
  created_at: timestampSchema,
  sent_at: timestampSchema.nullable(),
});
export type OutboxEntry = z.infer<typeof outboxSchema>;

export const jobRunSchema = z.object({
  id: idSchema,
  started_at: timestampSchema,
  finished_at: timestampSchema.nullable(),
  result: z.enum(['ok', 'fehler']),
  summary: z.string(),
  error: z.string().nullable(),
  sent_push: z.number().int().min(0),
  sent_telegram: z.number().int().min(0),
  retries: z.number().int().min(0),
});
export type JobRun = z.infer<typeof jobRunSchema>;

// ── Termine, Plenum, Wissen [P3] (3.6 bis 3.9) ──────────────────────────────

export const APPOINTMENT_FORMATS = ['vor_ort', 'online', 'hybrid'] as const;
export const appointmentFormatSchema = z.enum(APPOINTMENT_FORMATS);
export type AppointmentFormat = z.infer<typeof appointmentFormatSchema>;

/** „abgeschlossen“ gibt es nur bei Terminarten mit Plenum-Funktionen (4.3) */
export const APPOINTMENT_STATUSES = ['geplant', 'stattgefunden', 'abgeschlossen', 'abgesagt'] as const;
export const appointmentStatusSchema = z.enum(APPOINTMENT_STATUSES);
export type AppointmentStatus = z.infer<typeof appointmentStatusSchema>;

export const TYPE_COLORS = ['#F062C0', '#B59AF5', '#8FA6FF', '#E2DCF0', '#A69FB8'] as const;

export const appointmentTypeSchema = z.object({
  id: idSchema,
  key: z.string().min(1),
  label: z.string().min(1),
  default_topic_id: idSchema,
  default_format: appointmentFormatSchema,
  default_location: z.string().nullable(),
  /** Agenda, Ergebnis und Abschluss – nach dem Anlegen nicht mehr änderbar */
  has_plenum_features: z.boolean(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  sort_order: z.number().int(),
  archived_at: timestampSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  created_by: idSchema.nullable(),
  version: z.number().int().min(1),
});
export type AppointmentType = z.infer<typeof appointmentTypeSchema>;

export const appointmentSchema = z.object({
  id: idSchema,
  type_id: idSchema,
  title: z.string().min(1),
  topic_id: idSchema,
  event_id: idSchema.nullable(),
  starts_at: timestampSchema,
  ends_at: timestampSchema.nullable(),
  format: appointmentFormatSchema,
  location: z.string().nullable(),
  online_url: z.string().nullable(),
  status: appointmentStatusSchema,
  /** [P6] Serie und der Tag, für den sie den Termin angelegt hat – eindeutig je Serie (3.6) */
  series_id: idSchema.nullable(),
  series_date: dateSchema.nullable(),
  /** einzeln verschoben oder abgesagt: Serienänderungen lassen ihn in Ruhe */
  is_exception: z.boolean(),
  /** Beschreibung wie bei allen Artefakten (16.3) */
  description: z.string().nullable(),
  /** nur Plenum: verknüpftes Protokoll, protokollierende Person, Notizen in der App */
  protocol_document_id: idSchema.nullable(),
  protocol_member_id: idSchema.nullable(),
  notes: z.string().nullable(),
  archived_at: timestampSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  created_by: idSchema,
  version: z.number().int().min(1),
});
export type Appointment = z.infer<typeof appointmentSchema>;

/** Uhrzeit „HH:MM“ (Europe/Berlin) */
export const clockSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Bitte eine Uhrzeit wählen.');

/** [P6] Serie (3.6): Einzeltermine entstehen im Joblauf rollierend 3 Monate im Voraus */
export const appointmentSeriesSchema = z.object({
  id: idSchema,
  type_id: idSchema,
  title: z.string().min(1),
  topic_id: idSchema,
  format: appointmentFormatSchema,
  location: z.string().nullable(),
  online_url: z.string().nullable(),
  start_time: clockSchema,
  end_time: clockSchema.nullable(),
  /** Teilmenge von RRULE, z. B. Bautag: FREQ=MONTHLY;BYDAY=SA;BYSETPOS=3 */
  rrule: z.string().min(1),
  valid_from: dateSchema,
  valid_until: dateSchema.nullable(),
  /** ab hier zählt „alle 2 Wochen“; neu gesetzt, wenn sich die Regel ändert */
  anchor_date: dateSchema,
  active: z.boolean(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  created_by: idSchema,
  version: z.number().int().min(1),
});
export type AppointmentSeries = z.infer<typeof appointmentSeriesSchema>;

export const RSVP_ANSWERS = ['ja', 'nein'] as const;
export const rsvpAnswerSchema = z.enum(RSVP_ANSWERS);
export type RsvpAnswer = z.infer<typeof rsvpAnswerSchema>;

export const appointmentRsvpSchema = z.object({
  appointment_id: idSchema,
  member_id: idSchema,
  answer: rsvpAnswerSchema,
  answered_at: timestampSchema,
});
export type AppointmentRsvp = z.infer<typeof appointmentRsvpSchema>;

/** tatsächliche Teilnahme */
export const appointmentAttendeeSchema = z.object({ appointment_id: idSchema, member_id: idSchema });
export type AppointmentAttendee = z.infer<typeof appointmentAttendeeSchema>;

export const DECISION_KINDS = ['entscheidung', 'fakt'] as const;
export const decisionKindSchema = z.enum(DECISION_KINDS);
export type DecisionKind = z.infer<typeof decisionKindSchema>;
/** offen: Entscheidung, die noch auf Bestätigung wartet (16.4) – Fakten gelten sofort */
export const DECISION_STATUSES = ['offen', 'gueltig', 'ersetzt', 'aufgehoben'] as const;
export const decisionStatusSchema = z.enum(DECISION_STATUSES);
export type DecisionStatus = z.infer<typeof decisionStatusSchema>;

/** Entscheidung oder Fakt; mindestens eine Quelle ist Pflicht (3.8) */
export const decisionSchema = z.object({
  id: idSchema,
  title: z.string().min(1),
  description: z.string().nullable(),
  kind: decisionKindSchema,
  topic_id: idSchema,
  decided_on: dateSchema,
  status: decisionStatusSchema,
  superseded_by_id: idSchema.nullable(),
  source_plenum_id: idSchema.nullable(),
  source_document_id: idSchema.nullable(),
  source_note: z.string().nullable(),
  /** aus welcher Frage der Eintrag entstanden ist – eine Frage kann mehrere Ergebnisse haben (16.3) */
  source_question_id: idSchema.nullable(),
  /** optional zu einer Veranstaltung (16.3) */
  event_id: idSchema.nullable(),
  /** letzter Tag zum Bestätigen oder Widersprechen (16.4) – nur bei Entscheidungen, die abgestimmt werden */
  consensus_until: dateSchema.nullable(),
  archived_at: timestampSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  created_by: idSchema,
  version: z.number().int().min(1),
});
export type Decision = z.infer<typeof decisionSchema>;

export const DECISION_VOTES = ['bestaetigt', 'widerspruch'] as const;
export const decisionVoteKindSchema = z.enum(DECISION_VOTES);
export type DecisionVoteKind = z.infer<typeof decisionVoteKindSchema>;

/** Stimme eines Mitglieds zu einer offenen Entscheidung (16.4) – je Person eine, änderbar, solange sie offen ist */
export const decisionVoteSchema = z.object({
  decision_id: idSchema,
  member_id: idSchema,
  vote: decisionVoteKindSchema,
  voted_at: timestampSchema,
});
export type DecisionVote = z.infer<typeof decisionVoteSchema>;

export const QUESTION_STATUSES = ['offen', 'geklaert', 'verworfen'] as const;
export const questionStatusSchema = z.enum(QUESTION_STATUSES);
export type QuestionStatus = z.infer<typeof questionStatusSchema>;

export const questionSchema = z.object({
  id: idSchema,
  title: z.string().min(1),
  description: z.string().nullable(),
  topic_id: idSchema,
  event_id: idSchema.nullable(),
  urgency: prioritySchema,
  status: questionStatusSchema,
  raised_by: idSchema,
  answer: z.string().nullable(),
  answered_in_plenum_id: idSchema.nullable(),
  archived_at: timestampSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  created_by: idSchema,
  version: z.number().int().min(1),
});
export type Question = z.infer<typeof questionSchema>;

/** Startliste; erweiterbar (Frage 11.2 Nr. 3) */
export const DOC_TYPES = ['protokoll', 'leitlinie', 'vorlage', 'schichtplan', 'sonstiges'] as const;
export const docTypeSchema = z.enum(DOC_TYPES);
export type DocType = z.infer<typeof docTypeSchema>;

/** Link auf eine Datei – die App speichert keine Dateiinhalte (Abschnitt 1) */
export const documentSchema = z.object({
  id: idSchema,
  title: z.string().min(1),
  url: z.url(),
  /** nur bei Dateien aus dem Vereins-Drive [P5] */
  drive_file_id: z.string().nullable(),
  doc_type: docTypeSchema,
  topic_id: idSchema.nullable(),
  tags: z.array(z.string().min(1)),
  description: z.string().nullable(),
  archived_at: timestampSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  created_by: idSchema,
  version: z.number().int().min(1),
});
export type DocumentRow = z.infer<typeof documentSchema>;

/** Verknüpfung eines Dokuments mit Aufgabe, Veranstaltung, Termin oder Entscheidung */
export const DOCUMENT_LINK_TARGETS = ['task', 'event', 'appointment', 'decision'] as const;
export type DocumentLinkTarget = (typeof DOCUMENT_LINK_TARGETS)[number];
export const documentLinkSchema = z.object({
  document_id: idSchema,
  target_type: z.enum(DOCUMENT_LINK_TARGETS),
  target_id: idSchema,
});
export type DocumentLink = z.infer<typeof documentLinkSchema>;

// ── Drive-Cache [P5] (3.13): nur Metadaten des Vereinsordners ──────────────

export const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';
export const driveItemSchema = z.object({
  file_id: z.string().min(1),
  /** null nur beim Wurzelordner */
  parent_id: z.string().nullable(),
  name: z.string().min(1),
  mime_type: z.string().min(1),
  modified_time: timestampSchema,
  web_url: z.url(),
  trashed: z.boolean(),
  synced_at: timestampSchema,
});
export type DriveItem = z.infer<typeof driveItemSchema>;

export const driveSyncStateSchema = z.object({
  root_folder_id: z.string().min(1),
  changes_page_token: z.string().nullable(),
  last_checked_at: timestampSchema.nullable(),
  last_full_sync_at: timestampSchema.nullable(),
});
export type DriveSyncState = z.infer<typeof driveSyncStateSchema>;

// ── Eingaben ────────────────────────────────────────────────────────────────

const versionSchema = z.number().int().min(1);
const titleSchema = z
  .string()
  .trim()
  .min(1, 'Bitte einen Titel eingeben.')
  .max(200, 'Der Titel darf höchstens 200 Zeichen haben.');
const longTextSchema = z.string().trim().max(10000, 'Der Text ist zu lang.');
const emptyToNull = (v: string) => (v === '' ? null : v);

export const taskCreateSchema = z.object({
  title: titleSchema,
  topic_id: z.uuid('Bitte ein Thema wählen.'),
  priority: prioritySchema.default('mittel'),
  due_date: dateSchema.nullable().default(null),
  event_id: idSchema.nullable().default(null),
  appointment_id: idSchema.nullable().default(null),
  assign_self: z.boolean().default(false),
});
export type TaskCreateInput = z.input<typeof taskCreateSchema>;

export const taskFieldsSchema = z
  .object({
    title: titleSchema,
    topic_id: z.uuid('Bitte ein Thema wählen.'),
    priority: prioritySchema,
    due_date: dateSchema.nullable(),
    event_id: idSchema.nullable(),
    appointment_id: idSchema.nullable(),
  })
  .partial();
export type TaskFieldsInput = z.input<typeof taskFieldsSchema>;

export const taskDescriptionSchema = longTextSchema.transform(emptyToNull);

export const taskStatusChangeSchema = z.object({
  status: taskStatusSchema,
  block_reason: z.string().trim().max(2000, 'Der Grund ist zu lang.').optional(),
  blocker_ids: z.array(idSchema).optional(),
  discard_reason: z.string().trim().max(2000, 'Der Grund ist zu lang.').optional(),
  version: versionSchema,
});
export type TaskStatusChangeInput = z.input<typeof taskStatusChangeSchema>;

export const commentBodySchema = z
  .string()
  .trim()
  .min(1, 'Der Kommentar ist leer.')
  .max(5000, 'Der Kommentar ist zu lang.');

const eventFields = {
  title: titleSchema,
  type: eventTypeSchema,
  starts_at: z.iso.datetime({ offset: true, error: 'Bitte einen Beginn wählen.' }),
  ends_at: timestampSchema.nullable().default(null),
  description: longTextSchema.transform(emptyToNull).nullable().default(null),
  setup_at: timestampSchema.nullable().default(null),
  teardown_at: timestampSchema.nullable().default(null),
};
const endsAfterStart = (v: { starts_at: string; ends_at: string | null }) =>
  !v.ends_at || new Date(v.ends_at).getTime() > new Date(v.starts_at).getTime();
const endsAfterStartIssue = { path: ['ends_at'], message: 'Das Ende muss nach dem Beginn liegen.' };

// Aufbau vor dem Beginn, Abbau nicht vor dem Ende
const setupBeforeStart = (v: { starts_at: string; setup_at: string | null }) =>
  !v.setup_at || new Date(v.setup_at).getTime() <= new Date(v.starts_at).getTime();
const setupIssue = { path: ['setup_at'], message: 'Der Aufbau muss vor dem Beginn liegen.' };
const teardownAfterEnd = (v: { starts_at: string; ends_at: string | null; teardown_at: string | null }) =>
  !v.teardown_at || new Date(v.teardown_at).getTime() >= new Date(v.ends_at ?? v.starts_at).getTime();
const teardownIssue = { path: ['teardown_at'], message: 'Der Abbau muss nach dem Ende liegen.' };

export const eventCreateSchema = z
  .object(eventFields)
  .refine(endsAfterStart, endsAfterStartIssue)
  .refine(setupBeforeStart, setupIssue)
  .refine(teardownAfterEnd, teardownIssue);
export type EventCreateInput = z.input<typeof eventCreateSchema>;
export const eventUpdateSchema = z
  .object({ ...eventFields, version: versionSchema })
  .refine(endsAfterStart, endsAfterStartIssue)
  .refine(setupBeforeStart, setupIssue)
  .refine(teardownAfterEnd, teardownIssue);
export type EventUpdateInput = z.input<typeof eventUpdateSchema>;

const displayNameSchema = z
  .string()
  .trim()
  .min(1, 'Bitte einen Namen eingeben.')
  .max(60, 'Der Name darf höchstens 60 Zeichen haben.');
export const profileNameSchema = displayNameSchema;

export const emailInputSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Bitte eine gültige Mail-Adresse eingeben.'));

const memberFields = {
  display_name: displayNameSchema,
  short: z
    .string()
    .trim()
    .min(1, 'Bitte ein Kürzel eingeben.')
    .max(3, 'Das Kürzel darf höchstens 3 Zeichen haben.')
    .transform((v) => v.toUpperCase()),
  email: emailInputSchema,
  is_admin: z.boolean().default(false),
};
export const memberCreateSchema = z.object(memberFields);
export type MemberCreateInput = z.input<typeof memberCreateSchema>;
export const memberUpdateSchema = z.object({ ...memberFields, version: versionSchema });
export type MemberUpdateInput = z.input<typeof memberUpdateSchema>;

const topicFields = {
  name: z
    .string()
    .trim()
    .min(1, 'Bitte einen Namen eingeben.')
    .max(60, 'Der Name darf höchstens 60 Zeichen haben.'),
  parent_id: idSchema.nullable().default(null),
};
export const topicCreateSchema = z.object(topicFields);
export type TopicCreateInput = z.input<typeof topicCreateSchema>;
export const topicUpdateSchema = z.object({ ...topicFields, version: versionSchema });
export type TopicUpdateInput = z.input<typeof topicUpdateSchema>;

// ── Eingaben [P3] ───────────────────────────────────────────────────────────

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .default(null);

const appointmentFields = {
  type_id: z.uuid('Bitte eine Terminart wählen.'),
  title: titleSchema,
  starts_at: z.iso.datetime({ offset: true, error: 'Bitte einen Beginn wählen.' }),
  ends_at: timestampSchema.nullable().default(null),
  format: appointmentFormatSchema,
  location: optionalText(200, 'Der Ort ist zu lang.'),
  online_url: optionalText(500, 'Der Link ist zu lang.'),
  event_id: idSchema.nullable().default(null),
  description: optionalText(10000, 'Der Text ist zu lang.'),
};
type AppointmentPlace = { format: AppointmentFormat; location: string | null; online_url: string | null };
/** Ort bei vor Ort/hybrid, Link bei online/hybrid (3.6) */
const placeIssues = (v: AppointmentPlace, ctx: z.RefinementCtx) => {
  if (v.format !== 'online' && !v.location)
    ctx.addIssue({ code: 'custom', path: ['location'], message: 'Bitte einen Ort angeben.' });
  if (v.format !== 'vor_ort' && !v.online_url)
    ctx.addIssue({ code: 'custom', path: ['online_url'], message: 'Bitte den Link zum Call angeben.' });
  if (v.format !== 'vor_ort' && v.online_url && !/^https?:\/\/\S+$/.test(v.online_url))
    ctx.addIssue({ code: 'custom', path: ['online_url'], message: 'Der Link muss mit https:// beginnen.' });
};
export const appointmentCreateSchema = z
  .object(appointmentFields)
  .refine(endsAfterStart, endsAfterStartIssue)
  .superRefine(placeIssues);
export type AppointmentCreateInput = z.input<typeof appointmentCreateSchema>;
export const appointmentUpdateSchema = z
  .object({ ...appointmentFields, version: versionSchema })
  .refine(endsAfterStart, endsAfterStartIssue)
  .superRefine(placeIssues);
export type AppointmentUpdateInput = z.input<typeof appointmentUpdateSchema>;

// ── Serien [P6] (WF-TER-09) ─────────────────────────────────────────────────

const seriesFields = {
  type_id: z.uuid('Bitte eine Terminart wählen.'),
  title: titleSchema,
  format: appointmentFormatSchema,
  location: optionalText(200, 'Der Ort ist zu lang.'),
  online_url: optionalText(500, 'Der Link ist zu lang.'),
  start_time: clockSchema,
  end_time: clockSchema.nullable().default(null),
  rrule: z.string().refine((v) => parseRule(v) !== null, 'Bitte wählen, wann sich der Termin wiederholt.'),
  valid_from: dateSchema,
  valid_until: dateSchema.nullable().default(null),
};
type SeriesShape = {
  start_time: string;
  end_time: string | null;
  valid_from: string;
  valid_until: string | null;
};
const seriesIssues = (v: SeriesShape & AppointmentPlace, ctx: z.RefinementCtx) => {
  placeIssues(v, ctx);
  if (v.end_time && v.end_time <= v.start_time)
    ctx.addIssue({ code: 'custom', path: ['end_time'], message: 'Das Ende muss nach dem Beginn liegen.' });
  if (v.valid_until && v.valid_until < v.valid_from)
    ctx.addIssue({
      code: 'custom',
      path: ['valid_until'],
      message: '„Bis“ darf nicht vor dem ersten Termin liegen.',
    });
};
export const seriesCreateSchema = z.object(seriesFields).superRefine(seriesIssues);
export type SeriesCreateInput = z.input<typeof seriesCreateSchema>;
/** Terminart und Beginn der Serie sind fest (der Server prüft das); Änderungen wirken auf künftige Nicht-Ausnahmen */
export const seriesUpdateSchema = z
  .object({ ...seriesFields, version: versionSchema })
  .superRefine(seriesIssues);
export type SeriesUpdateInput = z.input<typeof seriesUpdateSchema>;

const appointmentTypeFields = {
  label: z
    .string()
    .trim()
    .min(1, 'Bitte einen Namen eingeben.')
    .max(60, 'Der Name darf höchstens 60 Zeichen haben.'),
  default_topic_id: z.uuid('Bitte ein Thema wählen.'),
  default_format: appointmentFormatSchema,
  default_location: optionalText(200, 'Der Ort ist zu lang.'),
  color: z.enum(TYPE_COLORS),
};
export const appointmentTypeCreateSchema = z.object({
  ...appointmentTypeFields,
  has_plenum_features: z.boolean().default(false),
});
export type AppointmentTypeCreateInput = z.input<typeof appointmentTypeCreateSchema>;
/** has_plenum_features ist nach dem Anlegen fest und fehlt hier bewusst */
export const appointmentTypeUpdateSchema = z.object({ ...appointmentTypeFields, version: versionSchema });
export type AppointmentTypeUpdateInput = z.input<typeof appointmentTypeUpdateSchema>;

const sourceFields = {
  source_plenum_id: idSchema.nullable().default(null),
  source_document_id: idSchema.nullable().default(null),
  source_note: optionalText(500, 'Die Notiz ist zu lang.'),
};
type SourceInput = {
  source_plenum_id: string | null;
  source_document_id: string | null;
  source_note: string | null;
};
const oneSource = (v: SourceInput) => !!(v.source_plenum_id || v.source_document_id || v.source_note);
const oneSourceIssue = { path: ['source'], message: 'Ohne Quelle lässt sich nichts festhalten.' };

/** Text von Entscheidungen und Fakten: kurz, damit er auf die Karte passt (16.4) */
export const DECISION_TEXT_MAX = 300;
const decisionText = optionalText(
  DECISION_TEXT_MAX,
  `Der Text darf höchstens ${DECISION_TEXT_MAX} Zeichen haben.`,
);

/** WF-WIS-01: Entscheidung oder Fakt – mindestens eine Quelle ist Pflicht (3.8) */
export const decisionCreateSchema = z
  .object({
    title: titleSchema,
    description: decisionText,
    kind: decisionKindSchema,
    topic_id: z.uuid('Bitte ein Thema wählen.'),
    event_id: idSchema.nullable().default(null),
    decided_on: dateSchema.nullable().default(null),
    /** Frist zum Bestätigen (16.4), ohne Angabe 7 Tage; bei Fakten ohne Bedeutung */
    consensus_until: dateSchema.nullable().default(null),
    /** Ergebnis einer Frage (16.3): die Frage bleibt dabei offen */
    source_question_id: idSchema.nullable().default(null),
    ...sourceFields,
  })
  .refine(oneSource, oneSourceIssue);
export type DecisionCreateInput = z.input<typeof decisionCreateSchema>;

/** WF-WIS-02: Nachfolgerin wählen (successor_id) oder neu anlegen (Titel und Quelle) */
export const decisionReplaceSchema = z
  .object({
    successor_id: idSchema.nullable().default(null),
    title: z.string().trim().max(200, 'Der Titel darf höchstens 200 Zeichen haben.').default(''),
    description: decisionText,
    /** Frist der neuen Fassung, wenn sie eine Entscheidung ist (16.4) */
    consensus_until: dateSchema.nullable().default(null),
    ...sourceFields,
    version: versionSchema,
  })
  .refine((v) => !!v.successor_id || v.title.length > 0, {
    path: ['title'],
    message: 'Bitte einen Titel eingeben.',
  })
  .refine((v) => !!v.successor_id || oneSource(v), oneSourceIssue);
export type DecisionReplaceInput = z.input<typeof decisionReplaceSchema>;

/** WF-WIS-12: Titel, Text, Thema und Veranstaltung korrigieren – Inhaltliches ändert „Ersetzen“ (Annahme U6) */
export const decisionUpdateSchema = z.object({
  title: titleSchema,
  description: decisionText,
  topic_id: z.uuid('Bitte ein Thema wählen.'),
  event_id: idSchema.nullable().default(null),
  version: versionSchema,
});
export type DecisionUpdateInput = z.input<typeof decisionUpdateSchema>;

/** WF-FRA-01 */
export const questionCreateSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Bitte die Frage eingeben.')
    .max(200, 'Die Frage darf höchstens 200 Zeichen haben.'),
  description: optionalText(10000, 'Der Text ist zu lang.'),
  topic_id: z.uuid('Bitte ein Thema wählen.'),
  event_id: idSchema.nullable().default(null),
  urgency: prioritySchema.default('mittel'),
});
export type QuestionCreateInput = z.input<typeof questionCreateSchema>;

/** WF-FRA-06: Frage bearbeiten – Titel, Beschreibung, Thema, Veranstaltung, Dringlichkeit */
export const questionUpdateSchema = questionCreateSchema.extend({ version: versionSchema });
export type QuestionUpdateInput = z.input<typeof questionUpdateSchema>;

/**
 * WF-FRA-02 „Als beantwortet markieren“ (16.3): schließt die Frage erst auf Wunsch. Die Antwort ist optional, wenn
 * schon Entscheidungen oder Fakten aus ihr festgehalten sind – sonst Pflicht.
 */
export const questionClarifySchema = z.object({
  answer: optionalText(10000, 'Der Text ist zu lang.'),
  version: versionSchema,
});
export type QuestionClarifyInput = z.input<typeof questionClarifySchema>;

/** WF-WIS-06: Dokument per Link erfassen, optional gleich verknüpfen */
export const documentCreateSchema = z.object({
  title: titleSchema,
  url: z
    .string()
    .trim()
    .pipe(z.url({ protocol: /^https?$/, error: 'Bitte einen Link eingeben, der mit https:// beginnt.' }))
    // „HTTPS://…“ wie „https://…“ speichern
    .transform((v) => v.replace(/^https?:/i, (scheme) => scheme.toLowerCase())),
  doc_type: z.enum(DOC_TYPES, 'Bitte einen Typ wählen.'),
  topic_id: idSchema.nullable().default(null),
  tags: z
    .array(
      z
        .string()
        .trim()
        .min(1, 'Leere Tags gibt es nicht.')
        .max(40, 'Ein Tag darf höchstens 40 Zeichen haben.'),
    )
    .max(10, 'Höchstens 10 Tags.')
    .default([]),
  link: z
    .object({ target_type: z.enum(DOCUMENT_LINK_TARGETS), target_id: idSchema })
    .nullable()
    .default(null),
});
export type DocumentCreateInput = z.input<typeof documentCreateSchema>;

/** WF-WIS-09: Datei aus dem Verzeichnis verknüpfen – der documents-Eintrag entsteht, falls neu */
export const driveLinkSchema = z.object({
  file_id: z.string().min(1, 'Bitte eine Datei wählen.'),
  /** nur für neue Einträge; ein bereits erfasstes Dokument behält seinen Typ */
  doc_type: z.enum(DOC_TYPES, 'Bitte einen Typ wählen.').default('sonstiges'),
  link: z
    .object({ target_type: z.enum(DOCUMENT_LINK_TARGETS), target_id: idSchema })
    .nullable()
    .default(null),
});
export type DriveLinkInput = z.input<typeof driveLinkSchema>;

// ── Plenum [P3] (F-PLE-01 bis -05, WF-PLE-03 bis -20) ───────────────────────

/** WF-PLE-03 Protokoll: protokollierende Person, Notizen in der App, optionales Drive-Protokoll */
export const protocolSchema = z.object({
  protocol_member_id: idSchema.nullable(),
  notes: longTextSchema.transform(emptyToNull).nullable(),
  protocol_document_id: idSchema.nullable(),
  version: versionSchema,
});
export type ProtocolInput = z.input<typeof protocolSchema>;

export const RESULT_GROUPS = ['beschluesse', 'aufgaben', 'fragen', 'termine', 'besprochen'] as const;
export type ResultGroup = (typeof RESULT_GROUPS)[number];

// ── Veranstaltungen: Ausbau [P4] (3.4, F-VER-04, WF-VER-07 bis -11) ──────────

export const LOCATION_CONFIRMATIONS = ['offen', 'angefragt', 'zugesagt', 'vertrag'] as const;
export const BOOKING_ACT_TYPES = ['dj', 'band', 'sonstiges'] as const;
export const BOOKING_STATUSES = ['angefragt', 'zugesagt', 'abgesagt'] as const;
/** Gage: noch offen, keine, oder ja – dann mit Betrag */
export const BOOKING_FEE_STATUSES = ['offen', 'nein', 'ja'] as const;
export const BAR_MODES = ['selbst', 'extern', 'keine'] as const;
export const ENTRY_MODES = ['frei', 'spende', 'fester_preis'] as const;

const shortText = (max = 300) =>
  z.string().trim().max(max, `Höchstens ${max} Zeichen.`).transform(emptyToNull).nullable();
const amount = z
  .number()
  .min(0, 'Bitte keine negative Zahl.')
  .max(10_000_000, 'Die Zahl ist zu groß.')
  .nullable();
const count = z
  .number()
  .int('Bitte eine ganze Zahl.')
  .min(0, 'Bitte keine negative Zahl.')
  .max(1_000_000, 'Die Zahl ist zu groß.')
  .nullable();

/** Alle Detailbereiche einer Veranstaltung, eine Zeile je Veranstaltung; jedes Feld optional (3.4) */
export const eventDetailsSchema = z.object({
  event_id: idSchema,
  location: z.object({
    name: z.string().nullable(),
    address: z.string().nullable(),
    contact: z.string().nullable(),
    capacity: z.number().nullable(),
    cost: z.number().nullable(),
    confirmation: z.enum(LOCATION_CONFIRMATIONS).nullable(),
    accessibility_notes: z.string().nullable(),
  }),
  bar: z.object({
    mode: z.enum(BAR_MODES).nullable(),
    drinks_planning: z.string().nullable(),
    notes: z.string().nullable(),
  }),
  entry: z.object({
    mode: z.enum(ENTRY_MODES).nullable(),
    price: z.string().nullable(),
    cashier_notes: z.string().nullable(),
  }),
  communication: z.object({ announcement_date: z.string().nullable(), channels: z.string().nullable() }),
  numbers: z.object({
    budget_planned: z.number().nullable(),
    expected_visitors: z.number().nullable(),
    actual_visitors: z.number().nullable(),
  }),
  retrospective: z.string().nullable(),
});
export type EventDetails = z.infer<typeof eventDetailsSchema>;

/**
 * Einzelne Felder der Detailbereiche (WF-VER-08): kurze Felder speichern beim Verlassen, Auswahlen
 * sofort, die Nachbereitung mit Speichern/Abbrechen – immer mit Versionsprüfung an der Veranstaltung.
 */
export const EVENT_DETAIL_FIELDS = {
  'location.name': shortText(),
  'location.address': shortText(),
  'location.contact': shortText(),
  'location.capacity': count,
  'location.cost': amount,
  'location.confirmation': z.enum(LOCATION_CONFIRMATIONS).nullable(),
  'location.accessibility_notes': shortText(1000),
  'bar.mode': z.enum(BAR_MODES).nullable(),
  'bar.drinks_planning': shortText(1000),
  'bar.notes': shortText(1000),
  'entry.mode': z.enum(ENTRY_MODES).nullable(),
  'entry.price': shortText(100),
  'entry.cashier_notes': shortText(1000),
  'communication.announcement_date': dateSchema.nullable(),
  'communication.channels': shortText(1000),
  'numbers.budget_planned': amount,
  'numbers.expected_visitors': count,
  'numbers.actual_visitors': count,
  retrospective: longTextSchema.transform(emptyToNull).nullable(),
} satisfies Record<string, z.ZodType>;
export type EventDetailField = keyof typeof EVENT_DETAIL_FIELDS;
export const EVENT_DETAIL_FIELD_KEYS = Object.keys(EVENT_DETAIL_FIELDS) as [
  EventDetailField,
  ...EventDetailField[],
];

export const eventDetailUpdateSchema = z.object({
  field: z.enum(EVENT_DETAIL_FIELD_KEYS),
  value: z.unknown(),
  version: versionSchema,
  /**
   * Feldweises Optimistic Locking: der Wert, von dem die Eingabe ausging. Ist er gesetzt, gilt ein Konflikt
   * nur, wenn jemand genau dieses Feld inzwischen geändert hat – andere Bereiche lassen sich parallel pflegen.
   */
  expected: z.unknown().optional(),
});
export type EventDetailUpdateInput = z.input<typeof eventDetailUpdateSchema>;

/** Booking: mehrere Acts je Veranstaltung, eintragsweise (3.4) */
export const eventBookingSchema = z.object({
  id: idSchema,
  event_id: idSchema,
  act_name: z.string().min(1),
  act_type: z.enum(BOOKING_ACT_TYPES),
  contact: z.string().nullable(),
  status: z.enum(BOOKING_STATUSES),
  fee_status: z.enum(BOOKING_FEE_STATUSES),
  fee: z.string().nullable(),
  tech_requirements: z.string().nullable(),
  notes: z.string().nullable(),
  created_at: timestampSchema,
  created_by: idSchema,
  version: z.number().int().min(1),
});
export type EventBooking = z.infer<typeof eventBookingSchema>;

const bookingFields = {
  act_name: z.string().trim().min(1, 'Bitte einen Namen eingeben.').max(200, 'Höchstens 200 Zeichen.'),
  act_type: z.enum(BOOKING_ACT_TYPES, 'Bitte eine Art wählen.'),
  contact: shortText().default(null),
  status: z.enum(BOOKING_STATUSES).default('angefragt'),
  fee_status: z.enum(BOOKING_FEE_STATUSES).default('offen'),
  fee: shortText(100).default(null),
  tech_requirements: shortText(1000).default(null),
  notes: shortText(1000).default(null),
};
/** einen Betrag gibt es nur bei Gage „ja“ */
const feeOnlyIfYes = <T extends { fee_status: string; fee: string | null }>(v: T): T => ({
  ...v,
  fee: v.fee_status === 'ja' ? v.fee : null,
});
export const bookingCreateSchema = z.object(bookingFields).transform(feeOnlyIfYes);
export type BookingCreateInput = z.input<typeof bookingCreateSchema>;
export const bookingUpdateSchema = z
  .object({ ...bookingFields, version: versionSchema })
  .transform(feeOnlyIfYes);
export type BookingUpdateInput = z.input<typeof bookingUpdateSchema>;

/** Hauptverantwortliche (WF-VER-09), eintragsweise */
export const eventLeadSchema = z.object({
  event_id: idSchema,
  member_id: idSchema,
  added_by: idSchema,
  added_at: timestampSchema,
});
export type EventLead = z.infer<typeof eventLeadSchema>;

// ── Kooperationspartner [P4] (3.5, F-VER-05, WF-VER-10, WF-VER-13) ─────────────

export const partnerSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  /** „Art“ aus WF-VER-10, z. B. Kollektiv, Verein, Firma (Annahme A44) */
  kind: z.string().nullable(),
  description: z.string().nullable(),
  contact_person: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  website: z.string().nullable(),
  notes: z.string().nullable(),
  internal_contact_member_id: idSchema.nullable(),
  archived_at: timestampSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  created_by: idSchema,
  version: z.number().int().min(1),
});
export type Partner = z.infer<typeof partnerSchema>;

const optionalShort = (max: number) =>
  z.string().trim().max(max, `Höchstens ${max} Zeichen.`).transform(emptyToNull).nullable().default(null);
const partnerFields = {
  name: z.string().trim().min(1, 'Bitte einen Namen eingeben.').max(200, 'Höchstens 200 Zeichen.'),
  kind: optionalShort(100),
  description: optionalShort(2000),
  contact_person: optionalShort(200),
  email: z
    .string()
    .trim()
    .transform(emptyToNull)
    .nullable()
    .default(null)
    .refine(
      (v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      'Bitte eine gültige Mail-Adresse eingeben.',
    ),
  phone: optionalShort(50),
  website: optionalShort(300),
  notes: optionalShort(5000),
  internal_contact_member_id: idSchema.nullable().default(null),
};
export const partnerCreateSchema = z.object(partnerFields);
export type PartnerCreateInput = z.input<typeof partnerCreateSchema>;
export const partnerUpdateSchema = z.object({ ...partnerFields, version: versionSchema });
export type PartnerUpdateInput = z.input<typeof partnerUpdateSchema>;

/** Partner an einer Veranstaltung, eintragsweise (3.4) */
export const eventPartnerSchema = z.object({
  event_id: idSchema,
  partner_id: idSchema,
  role_note: z.string().nullable(),
  added_by: idSchema,
  added_at: timestampSchema,
});
export type EventPartner = z.infer<typeof eventPartnerSchema>;

// ── Veranstaltungsvorlagen [P4] (3.12, F-VER-06, F-VER-07, WF-VER-12, WF-ADM-08) ─

export const eventTemplateSchema = z.object({
  id: idSchema,
  event_type: eventTypeSchema,
  name: z.string().min(1),
  updated_at: timestampSchema,
  version: z.number().int().min(1),
});
export type EventTemplate = z.infer<typeof eventTemplateSchema>;

export const eventTemplateItemSchema = z.object({
  id: idSchema,
  template_id: idSchema,
  /** Baustein, z. B. „Bar“ – im Dialog als Block an- und abwählbar */
  block: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullable(),
  /** Frist relativ zum Beginn der Veranstaltung, in Tagen (negativ = vorher) */
  offset_days: z.number().int(),
  default_priority: prioritySchema,
  topic_id: idSchema,
  position: z.number().int(),
  version: z.number().int().min(1),
});
export type EventTemplateItem = z.infer<typeof eventTemplateItemSchema>;

/** Welche Vorlagenaufgabe bei welcher Veranstaltung schon angelegt wurde – erneutes Aufrufen ohne Duplikate */
export const templateApplicationSchema = z.object({
  event_id: idSchema,
  template_item_id: idSchema,
  task_id: idSchema,
  applied_by: idSchema,
  applied_at: timestampSchema,
});
export type TemplateApplication = z.infer<typeof templateApplicationSchema>;

const offsetDaysSchema = z
  .number('Bitte eine ganze Zahl eingeben.')
  .int('Bitte eine ganze Zahl eingeben.')
  .min(-365, 'Höchstens ein Jahr vorher.')
  .max(365, 'Höchstens ein Jahr danach.');

export const templateItemInputSchema = z.object({
  block: z.string().trim().min(1, 'Bitte einen Baustein angeben.').max(60, 'Höchstens 60 Zeichen.'),
  title: titleSchema,
  description: longTextSchema.transform(emptyToNull).nullable().default(null),
  offset_days: offsetDaysSchema,
  default_priority: prioritySchema.default('mittel'),
  topic_id: z.uuid('Bitte ein Thema wählen.'),
});
export type TemplateItemInput = z.input<typeof templateItemInputSchema>;
export const templateItemUpdateSchema = templateItemInputSchema.extend({ version: versionSchema });
export type TemplateItemUpdateInput = z.input<typeof templateItemUpdateSchema>;

export const templateApplySchema = z.object({
  item_ids: z.array(idSchema).max(200),
});

/** Aufbau der YAML-Datei mit dem Startinhalt (3.12); daraus entsteht auch event-templates.schema.json */
export const templateSeedFileSchema = z
  .object({
    templates: z.array(
      z
        .object({
          event_type: eventTypeSchema,
          name: z.string().min(1).max(100),
          items: z.array(
            z
              .object({
                block: z.string().min(1).max(60),
                title: z.string().min(1).max(200),
                description: z.string().max(10000).optional(),
                offset_days: z.number().int().min(-365).max(365),
                priority: prioritySchema.optional(),
                topic: z.string().min(1),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict()
  .refine(
    (f) => new Set(f.templates.map((t) => t.event_type)).size === f.templates.length,
    'Je Veranstaltungsart höchstens eine Vorlage.',
  );
export type TemplateSeedFile = z.infer<typeof templateSeedFileSchema>;

// ── Rückmeldung aus der App (16.5): Bug oder Feature-Wunsch, Liste für Admins ──
export const APP_REPORT_KINDS = ['bug', 'wunsch'] as const;
export const appReportKindSchema = z.enum(APP_REPORT_KINDS);
export type AppReportKind = z.infer<typeof appReportKindSchema>;

export const APP_REPORT_TEXT_MAX = 2000;

export const appReportSchema = z.object({
  id: idSchema,
  kind: appReportKindSchema,
  text: z.string().min(1),
  /** Version der App, in der die Rückmeldung geschrieben wurde */
  app_version: z.string(),
  member_id: idSchema,
  created_at: timestampSchema,
});
export type AppReport = z.infer<typeof appReportSchema>;

/** WF-PRO-05 */
export const appReportCreateSchema = z.object({
  kind: appReportKindSchema,
  text: z
    .string()
    .trim()
    .min(1, 'Bitte beschreib kurz, worum es geht.')
    .max(APP_REPORT_TEXT_MAX, `Der Text darf höchstens ${APP_REPORT_TEXT_MAX} Zeichen haben.`),
  app_version: z.string().trim().max(40).default(''),
});
export type AppReportCreateInput = z.input<typeof appReportCreateSchema>;
