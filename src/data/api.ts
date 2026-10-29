// Schnittstelle zwischen Oberfläche und Daten. In Schritt A bedient sie die Testdaten-Schicht
// (src/data/mock), in Schritt C die Server-Funktionen – die Oberfläche kennt nur dieses Interface.
import type { DriveKind } from '../shared/rules/drive';
import type { ResultGroupItems, SessionPlenum } from '../shared/rules/plenum';
import type { NotificationGroupKey } from '../shared/rules/notifications';
import type { TelegramButtonKey } from '../shared/rules/telegram';
import type { SectionSummary } from '../shared/rules/eventDetails';
import type {
  Decision,
  DecisionCreateInput,
  DecisionReplaceInput,
  DocumentCreateInput,
  DocumentLinkTarget,
  DocumentRow,
  DriveLinkInput,
  Question,
  QuestionClarifyInput,
  QuestionCreateInput,
  Appointment,
  ProtocolInput,
  AppointmentCreateInput,
  AppointmentSeries,
  SeriesCreateInput,
  SeriesUpdateInput,
  AppointmentType,
  AppointmentTypeCreateInput,
  AppointmentTypeUpdateInput,
  AppointmentUpdateInput,
  RsvpAnswer,
  CommentItem,
  Reaction,
  CommentTarget,
  DecisionUpdateInput,
  DecisionVoteKind,
  MarkReason,
  AppReport,
  AppReportCreateInput,
  ArchiveTarget,
  QuestionUpdateInput,
  EventCreateInput,
  BookingCreateInput,
  BookingUpdateInput,
  EventBooking,
  EventDetails,
  EventDetailUpdateInput,
  Partner,
  EventTemplate,
  EventTemplateItem,
  TemplateItemInput,
  TemplateItemUpdateInput,
  PartnerCreateInput,
  PartnerUpdateInput,
  EventRow,
  EventStatus,
  EventUpdateInput,
  HistoryEntry,
  JobRun,
  Member,
  MemberEmail,
  NotificationChannel,
  OutboxEntry,
  MemberCreateInput,
  MemberUpdateInput,
  Task,
  TaskCreateInput,
  TaskFieldsInput,
  TaskStatus,
  TaskStatusChangeInput,
  Topic,
  TopicCreateInput,
  TopicUpdateInput,
} from '../shared/schema';

export type Session =
  | { state: 'anonymous' }
  | { state: 'no_access'; email: string }
  /** plenum: das laufende bzw. nächste Plenum (16.2) – die App fragt damit vor einer Änderung nach */
  | { state: 'member'; member: Member; plenum: SessionPlenum | null };

export interface TaskListItem extends Task {
  assignee_ids: string[];
  follower_ids: string[];
  /** Titel der Aufgaben, von denen diese abhängt (nicht archivierte) */
  blocker_titles: string[];
  comment_count: number;
}

export interface TaskBlockerRef {
  id: string;
  title: string;
  status: TaskStatus;
}

export interface TaskDetail extends TaskListItem {
  blockers: TaskBlockerRef[];
  comments: CommentItem[];
  history: HistoryEntry[];
}

export interface EventListItem extends EventRow {
  /** nicht archivierte, nicht verworfene Aufgaben der Veranstaltung */
  task_total: number;
  task_done: number;
  task_overdue: number;
  /** seit wann „in Nachbereitung“ [P4]; die Liste weist auf lange Nachbereitung hin (4.2) */
  follow_up_since: string | null;
}

/** S-22 Veranstaltung – Detail mit den Ergänzungen aus P4 */
export interface EventDetail extends EventListItem {
  details: EventDetails;
  bookings: EventBooking[];
  lead_ids: string[];
  shift_plan_document: { id: string; title: string; url: string } | null;
  summaries: SectionSummary[];
  /** WF-VER-07: am Tag danach „In Nachbereitung?“ vorschlagen */
  suggests_follow_up: boolean;
  /** WF-VER-14 Drive-Ordner mit Inhalt aus dem Cache [P5]; missing: in Drive nicht mehr vorhanden */
  drive_folder: {
    file_id: string;
    name: string;
    web_url: string | null;
    missing: boolean;
    entries: DriveEntry[];
  } | null;
  /** Entscheidungen und Fakten zu dieser Veranstaltung (16.3) */
  decisions: {
    id: string;
    title: string;
    kind: Decision['kind'];
    status: Decision['status'];
    description: string | null;
  }[];
  comments: CommentItem[];
  history: HistoryEntry[];
  /** WF-VER-10 verknüpfte Partner */
  partners: {
    id: string;
    name: string;
    kind: string | null;
    role_note: string | null;
    event_count: number;
  }[];
}

/** S-23 Vorlagen-Dialog: Aufgaben der Vorlage, nach Baustein gruppiert, mit berechneter Frist */
export interface TemplateDialog {
  event_id: string;
  /** null: für diese Veranstaltungsart gibt es keine Vorlage */
  template: { id: string; name: string } | null;
  blocks: {
    block: string;
    items: (EventTemplateItem & {
      due_date: string;
      /** schon angelegt: die Aufgabe */
      task_id: string | null;
      /** warum sich die Aufgabe gerade nicht anlegen lässt, z. B. archiviertes Thema */
      blocked: string | null;
    })[];
  }[];
}

/** S-55 Vorlagen bearbeiten */
export interface TemplateWithItems extends EventTemplate {
  blocks: { block: string; items: EventTemplateItem[] }[];
}

/** S-24 Partner – Liste */
export interface PartnerListItem extends Partner {
  event_count: number;
}

/** S-24 Partner – Detail mit den Veranstaltungen, bei denen er beteiligt war (WF-VER-13) */
export interface PartnerDetail extends PartnerListItem {
  events: { id: string; title: string; starts_at: string; status: EventStatus; role_note: string | null }[];
  comments: CommentItem[];
  history: HistoryEntry[];
}

export interface TopicWithUsage extends Topic {
  /** alle Aufgaben mit diesem Thema – benutzte Themen sind nur archivierbar */
  task_count: number;
  /** aktive, nicht archivierte Aufgaben – verhindern das Archivieren (3.2) */
  active_task_count: number;
}

export interface DeactivationImpact {
  member_id: string;
  /** aktive Aufgaben, die danach niemand mehr bearbeitet */
  tasks_without_assignee: { id: string; title: string; status: TaskStatus; status_after: TaskStatus }[];
  /** aktive Aufgaben mit weiteren Bearbeitenden – unkritisch */
  tasks_shared_count: number;
  following_count: number;
  /** Zusagen und Absagen für künftige Termine – werden entfernt [P3] */
  future_rsvp_count: number;
  /** Veranstaltungen, bei denen die Person hauptverantwortlich ist – wird ausgetragen [P4] */
  lead_count: number;
  /** Partner, bei denen die Person interne Kontaktperson ist – wird ausgetragen [P4] */
  partner_contact_count: number;
}

export interface DecisionListItem extends Decision {
  /** „Plenum 10.09.2026“, Titel des Dokuments oder „Notiz“ */
  source_label: string;
  superseded_by_title: string | null;
  /** ausdrücklich auf der Agenda (16.1) */
  marked: boolean;
  /** Phase 12: „Stimmt das noch?“ oder „Aktion erforderlich“ – null, wenn nicht auf der Agenda */
  mark_reason: MarkReason | null;
  /** aus welcher Frage der Eintrag entstanden ist (16.3) */
  source_question: { id: string; title: string } | null;
  /** Stand der Abstimmung (16.4) – nur bei Entscheidungen mit Frist; Stimmen aktiver Mitglieder */
  consensus: {
    confirmed: number;
    objected: number;
    total: number;
    /** eigene Stimme der angemeldeten Person */
    my_vote: DecisionVoteKind | null;
  } | null;
}

export interface DecisionDetail extends DecisionListItem {
  source_plenum: { id: string; title: string; starts_at: string } | null;
  source_document: { id: string; title: string; url: string } | null;
  /** Einträge, die durch diesen ersetzt wurden */
  replaces: { id: string; title: string }[];
  /** Stimmen aktiver Mitglieder, neueste zuerst, und wer noch nicht abgestimmt hat (16.4) */
  votes: { member_id: string; vote: DecisionVoteKind; voted_at: string }[];
  pending_ids: string[];
  documents: DocumentListItem[];
  comments: CommentItem[];
  history: HistoryEntry[];
}

export interface QuestionListItem extends Question {
  /** Entscheidungen und Fakten, die aus der Frage entstanden sind (16.3) */
  results: { id: string; title: string; kind: Decision['kind']; status: Decision['status'] }[];
}

export interface QuestionDetail extends QuestionListItem {
  comments: CommentItem[];
  history: HistoryEntry[];
}

export interface DocumentListItem extends DocumentRow {
  link_count: number;
  /** „1 Aufgabe“, „3 verknüpft“, „nicht verknüpft“ */
  link_summary: string;
  /** [P5] Datei aus dem Vereins-Drive, die dort nicht mehr vorhanden ist (3.13) */
  drive_missing: boolean;
}

/** Ein Eintrag im Drive-Verzeichnis (F-WIS-04, F-WIS-08) – aus dem Cache, nicht live aus Drive */
export interface DriveEntry {
  file_id: string;
  parent_id: string | null;
  name: string;
  kind: DriveKind;
  modified_time: string;
  web_url: string;
  /** Ordner: Zahl der Einträge darin */
  child_count: number | null;
  /** erfasstes Dokument zu dieser Datei – „womit sie verknüpft ist“ */
  document_id: string | null;
  /** „1 Veranstaltung“, „3 verknüpft“, „erfasst“; null ohne Dokument */
  link_summary: string | null;
  /** Suche und „Zuletzt geändert“: Ordnerpfad ohne die Wurzel, z. B. „Veranstaltungen / 2026-12 Winterrave“ */
  path: string;
}

export interface DriveSyncInfo {
  last_checked_at: string | null;
  last_full_sync_at: string | null;
}

export interface DriveFolder {
  folder: { file_id: string; name: string; web_url: string };
  /** von der Wurzel bis zu diesem Ordner */
  path: { file_id: string; name: string }[];
  entries: DriveEntry[];
  sync: DriveSyncInfo;
}

export type SearchGroupKey =
  'aufgaben' | 'events' | 'termine' | 'beschluesse' | 'fragen' | 'dokumente' | 'partner';
export interface SearchGroup {
  key: SearchGroupKey;
  title: string;
  items: { id: string; title: string; meta: string; link: string; external?: boolean }[];
}

export interface AppointmentTypeWithUsage extends AppointmentType {
  /** mit Terminen belegte Arten sind nur archivierbar */
  appointment_count: number;
}

/** [P6] Serie mit verständlicher Regel und den kommenden Terminen (WF-TER-09) */
export interface SeriesDetail extends AppointmentSeries {
  /** „jeden 3. Samstag im Monat“ */
  label: string;
  upcoming: { id: string; starts_at: string; is_exception: boolean }[];
}

export interface AppointmentListItem extends Appointment {
  /** [P6] Serie, zu der der Termin gehört */
  series: { id: string; label: string; active: boolean } | null;
  type_label: string;
  type_color: string;
  /** Terminart mit Plenum-Funktionen: Ergebnis, Protokoll, Abschluss */
  is_plenum: boolean;
  yes_count: number;
  my_answer: RsvpAnswer | null;
  task_count: number;
}

export interface AppointmentDetail extends AppointmentListItem {
  yes_ids: string[];
  no_ids: string[];
  /** beim Anlegen ausgewählte Personen; leer: alle aktiven Mitglieder eingeladen (Phase 12) */
  invitee_ids: string[];
  /** eingeladene aktive Mitglieder ohne Antwort */
  open_ids: string[];
  /** tatsächliche Teilnahme */
  attendee_ids: string[];
  tasks: { id: string; title: string; status: TaskStatus; assignee_ids: string[] }[];
  comments: CommentItem[];
  history: HistoryEntry[];
}

/** S-33 Plenum – Detail: ein Termin mit Ergebnis und Protokoll */
export interface PlenumDetail extends AppointmentDetail {
  /** je Artefakt eine Zeile: angelegt, geändert oder mit diesem Plenum als Quelle (16.2) */
  results: ResultGroupItems[];
  protocol_document: { id: string; title: string; url: string } | null;
  /** an wie viele Mitglieder die Zusammenfassung ging; null, solange nicht abgeschlossen */
  summary_recipients: number | null;
}

/** Wie die eingeloggte Person erreichbar ist (WF-PRO-02, WF-PRO-03) */
export interface NotificationSettings {
  /** Push-Abo für dieses Gerät vorhanden */
  push: boolean;
  telegram: 'aus' | 'wartet' | 'verbunden';
  /** Link zum Bot mit Einmal-Code, solange die Verknüpfung auf /start wartet */
  telegram_url: string | null;
  /** [P6] Schalter-Matrix (F-PRO-02): je Zeile Push und Telegram */
  matrix: { key: NotificationGroupKey; push: boolean; telegram: boolean }[];
  reminder_lead_days: number;
}

/** S-54 Systemstatus (WF-ADM-07) */
export interface SystemStatus {
  /** die letzten Jobläufe, neuester zuerst */
  runs: JobRun[];
  last_run_at: string | null;
  outbox_waiting: number;
  failed_24h: number;
  push_subscriptions: number;
  telegram_linked: number;
  active_members: number;
}

/** Sofort gespeicherte Aktionen liefern ein Token für „Rückgängig“ (WF-ALL-02). */
export interface Undoable {
  undo_token: string;
}

export interface DemoAccount {
  email: string;
  label: string;
  hint: string;
}

/** Nur in der Testdaten-Schicht vorhanden; entfällt mit Schritt C. */
export interface DemoTools {
  accounts(): DemoAccount[];
  signInAs(email: string): Promise<Session>;
  /** Mail, für die zuletzt ein Link angefordert wurde (ersetzt das Postfach). */
  pendingMagicLink(): string | null;
  openMagicLink(): Promise<Session>;
  /** Eine andere Person ändert die Aufgabe, ohne dass diese Sitzung es mitbekommt. */
  simulateForeignEdit(taskId: string): Promise<void>;
  /** Die nächsten n Schreibzugriffe scheitern mit einem Netzfehler. */
  failNextWrites(n: number): void;
  /** Was der Telegram-Bot nach „Start“ tut: den offenen Einmal-Code einlösen */
  completeTelegramLink(): Promise<void>;
  /** Nachrichten an die eingeloggte Person – ersetzt Handy und Telegram */
  myMessages(): Promise<OutboxEntry[]>;
  /** Einen Joblauf sofort ausführen (sonst alle 15 Minuten) */
  runJobNow(): Promise<void>;
  /** Ausfall der Jobläufe zeigen bzw. beenden (Warnung nach 2 Stunden) */
  setOutage(on: boolean): Promise<void>;
  /** Jemand legt im Vereins-Drive eine Datei an – die App sieht sie nach dem nächsten Abgleich. Gibt den Namen. */
  driveAddFile(): Promise<string>;
  /** Jemand löscht eine verknüpfte Datei im Drive („In Drive nicht mehr vorhanden“). Gibt den Namen. */
  driveTrashLinkedFile(): Promise<string | null>;
  /**
   * Ersetzt Telegram [P6]: einen Button unter einer eigenen Telegram-Nachricht drücken (6.4). In Schritt C ruft
   * der Webhook dieselbe Server-Logik auf. Antwortet mit dem Satz, den der Bot im Chat schreibt.
   */
  telegramPress(outboxId: string, button: TelegramButtonKey): Promise<{ ok: boolean; text: string }>;
  /** Der nächtliche Export [P6] (E-08) als YAML – in Schritt C schreibt ihn der Joblauf ins private Repo */
  exportYaml(): Promise<string>;
  /** Testdaten auf den Ausgangsstand (Hinweisband der Demo); nur die Testdaten-Schicht im Browser */
  reset?(): Promise<void>;
}

export interface MyzelApi {
  /** Benachrichtigt nach jeder Datenänderung dieser Sitzung. */
  subscribe(listener: () => void): () => void;

  // Anmeldung (WF-LOG-01 bis -03)
  getSession(): Promise<Session>;
  signInWithGoogle(): Promise<void>;
  requestMagicLink(email: string): Promise<void>;
  signOut(): Promise<void>;

  // Lesen
  listMembers(): Promise<Member[]>;
  listTopics(): Promise<TopicWithUsage[]>;
  listTasks(): Promise<TaskListItem[]>;
  getTask(id: string): Promise<TaskDetail>;
  listEvents(): Promise<EventListItem[]>;
  getEvent(id: string): Promise<EventListItem>;

  // Aufgaben (WF-AUF-02 bis -14)
  createTask(input: TaskCreateInput): Promise<{ id: string }>;
  updateTaskFields(id: string, fields: TaskFieldsInput, version: number): Promise<void>;
  updateTaskDescription(id: string, description: string, version: number): Promise<void>;
  setTaskStatus(id: string, input: TaskStatusChangeInput): Promise<Undoable>;
  addAssignee(taskId: string, memberId: string): Promise<Undoable>;
  /** WF-AUF-10 „Alle“: mehrere auf einmal eintragen – ein Rückgängig für alle (Phase 9) */
  addAssignees(taskId: string, memberIds: string[]): Promise<Undoable>;
  removeAssignee(taskId: string, memberId: string): Promise<Undoable & { status_reset: boolean }>;
  addFollower(taskId: string, memberId: string): Promise<Undoable>;
  removeFollower(taskId: string, memberId: string): Promise<Undoable>;
  addBlocker(taskId: string, blockerTaskId: string): Promise<void>;
  removeBlocker(taskId: string, blockerTaskId: string): Promise<void>;
  /** Kommentar an jedem Artefakt (16.3); now_following nur bei Aufgaben */
  addComment(
    target: CommentTarget,
    targetId: string,
    body: string,
  ): Promise<{ id: string; now_following: boolean }>;
  updateComment(commentId: string, body: string): Promise<void>;
  /** Phase 12: Reaktion an einem Kommentar an- oder abschalten (eintragsweise) */
  setReaction(commentId: string, reaction: Reaction, on: boolean): Promise<void>;
  archiveTask(id: string, version: number): Promise<Undoable>;
  restoreTask(id: string, version: number): Promise<void>;
  /** WF-ALL-09 Löschen (archivieren) für alle anderen Artefakte – mit Rückgängig (Phase 9) */
  archiveArtifact(type: ArchiveTarget, id: string, version: number): Promise<Undoable>;
  undo(token: string): Promise<void>;

  // Veranstaltungen (WF-VER-02 bis -04)
  createEvent(input: EventCreateInput): Promise<{ id: string }>;
  updateEvent(id: string, input: EventUpdateInput): Promise<void>;
  setEventStatus(id: string, status: EventStatus, version: number): Promise<Undoable>;
  // Veranstaltungen ausgebaut [P4] (WF-VER-07 bis -11)
  getEventDetail(id: string): Promise<EventDetail>;
  updateEventDetail(id: string, input: EventDetailUpdateInput): Promise<void>;
  addBooking(eventId: string, input: BookingCreateInput): Promise<Undoable & { id: string }>;
  updateBooking(id: string, input: BookingUpdateInput): Promise<void>;
  removeBooking(id: string): Promise<Undoable>;
  addEventLead(eventId: string, memberId: string): Promise<Undoable>;
  removeEventLead(eventId: string, memberId: string): Promise<Undoable>;
  setShiftPlan(eventId: string, documentId: string | null, version: number): Promise<void>;
  // Kooperationspartner [P4] (S-24, WF-VER-10, WF-VER-13)
  listPartners(): Promise<PartnerListItem[]>;
  getPartner(id: string): Promise<PartnerDetail>;
  createPartner(input: PartnerCreateInput): Promise<{ id: string }>;
  updatePartner(id: string, input: PartnerUpdateInput): Promise<void>;
  linkPartner(eventId: string, partnerId: string, roleNote: string | null): Promise<Undoable>;
  unlinkPartner(eventId: string, partnerId: string): Promise<Undoable>;
  // Vorlagen [P4] (S-23 WF-VER-12, S-55 WF-ADM-08)
  getTemplateDialog(eventId: string): Promise<TemplateDialog>;
  applyTemplate(eventId: string, itemIds: string[]): Promise<Undoable & { created: number }>;
  listTemplates(): Promise<TemplateWithItems[]>;
  createTemplateItem(templateId: string, input: TemplateItemInput): Promise<{ id: string }>;
  updateTemplateItem(id: string, input: TemplateItemUpdateInput): Promise<void>;
  removeTemplateItem(id: string): Promise<void>;

  // Profil und Verwaltung (WF-PRO-01, WF-ADM-01 bis -05)
  updateOwnName(name: string): Promise<void>;
  createMember(input: MemberCreateInput): Promise<{ id: string }>;
  updateMember(id: string, input: MemberUpdateInput): Promise<void>;
  getDeactivationImpact(memberId: string): Promise<DeactivationImpact>;
  deactivateMember(memberId: string): Promise<DeactivationImpact>;
  reactivateMember(memberId: string): Promise<void>;
  /** Weitere Login-Adressen (WF-ADM-09, nur Admins); eintragsweise hinzufügen und entfernen */
  listMemberEmails(memberId: string): Promise<MemberEmail[]>;
  addMemberEmail(memberId: string, email: string): Promise<void>;
  removeMemberEmail(id: string): Promise<void>;
  createTopic(input: TopicCreateInput): Promise<{ id: string }>;
  updateTopic(id: string, input: TopicUpdateInput): Promise<void>;
  archiveTopic(id: string, version: number): Promise<void>;
  restoreTopic(id: string, version: number): Promise<void>;
  deleteTopic(id: string): Promise<void>;

  // Termine [P3] (WF-TER-01 bis -08, WF-ADM-06)
  listAppointmentTypes(): Promise<AppointmentTypeWithUsage[]>;
  createAppointmentType(input: AppointmentTypeCreateInput): Promise<{ id: string }>;
  updateAppointmentType(id: string, input: AppointmentTypeUpdateInput): Promise<void>;
  archiveAppointmentType(id: string, version: number): Promise<void>;
  restoreAppointmentType(id: string, version: number): Promise<void>;
  deleteAppointmentType(id: string): Promise<void>;
  listAppointments(): Promise<AppointmentListItem[]>;
  getAppointment(id: string): Promise<AppointmentDetail>;
  createAppointment(input: AppointmentCreateInput): Promise<{ id: string }>;
  updateAppointment(id: string, input: AppointmentUpdateInput): Promise<{ notified: number }>;
  setRsvp(id: string, answer: RsvpAnswer | null): Promise<Undoable>;
  cancelAppointment(id: string, version: number): Promise<{ notified: number }>;
  /** WF-TER-12: weitere Personen einladen, nur wenn beim Anlegen ausgewählt wurde */
  inviteToAppointment(id: string, memberIds: string[]): Promise<{ notified: number }>;
  markAppointmentHappened(id: string, attendeeIds: string[], version: number): Promise<Undoable>;
  setAttendee(id: string, memberId: string, present: boolean): Promise<void>;
  // Serien [P6] (WF-TER-09, -10): Einzeltermine entstehen im Joblauf 3 Monate im Voraus
  getSeries(id: string): Promise<SeriesDetail>;
  createSeries(input: SeriesCreateInput): Promise<{ id: string; created: number }>;
  updateSeries(id: string, input: SeriesUpdateInput): Promise<{ notified: number }>;
  endSeries(id: string, version: number): Promise<{ notified: number }>;

  // Wissen [P3] (WF-WIS-01 bis -07, -11, WF-FRA-01 bis -03, WF-VER-06, WF-AUF-13)
  listDecisions(): Promise<DecisionListItem[]>;
  getDecision(id: string): Promise<DecisionDetail>;
  createDecision(input: DecisionCreateInput): Promise<{ id: string }>;
  replaceDecision(id: string, input: DecisionReplaceInput): Promise<Undoable & { successor_id: string }>;
  revokeDecision(id: string, note: string | null, version: number): Promise<Undoable>;
  /** WF-WIS-12 Titel, Text, Thema, Veranstaltung korrigieren (Historie alt → neu) */
  updateDecision(id: string, input: DecisionUpdateInput): Promise<void>;
  /** WF-WIS-13 offene Entscheidung bestätigen oder widersprechen (16.4); valid: dadurch gerade gültig geworden */
  voteDecision(id: string, vote: DecisionVoteKind): Promise<Undoable & { valid: boolean }>;
  listQuestions(): Promise<QuestionListItem[]>;
  getQuestion(id: string): Promise<QuestionDetail>;
  createQuestion(input: QuestionCreateInput): Promise<{ id: string }>;
  /** WF-FRA-06 Frage bearbeiten (Historie alt → neu) */
  updateQuestion(id: string, input: QuestionUpdateInput): Promise<void>;
  /** WF-FRA-02 „Als beantwortet markieren“ – Ergebnisse hängen schon über createDecision an der Frage */
  clarifyQuestion(id: string, input: QuestionClarifyInput): Promise<Undoable>;
  discardQuestion(id: string, version: number): Promise<Undoable>;
  /** WF-FRA-04 geklärte oder verworfene Frage wieder öffnen; Ergebnisse bleiben bestehen */
  reopenQuestion(id: string, version: number): Promise<Undoable>;
  listDocuments(): Promise<DocumentListItem[]>;
  listLinkedDocuments(target: DocumentLinkTarget, targetId: string): Promise<DocumentListItem[]>;
  /** created: false – zu diesem Drive-Link gibt es schon ein Dokument; es wird nur verknüpft */
  createDocument(input: DocumentCreateInput): Promise<{ id: string; created: boolean }>;
  linkDocument(documentId: string, target: DocumentLinkTarget, targetId: string): Promise<void>;
  unlinkDocument(documentId: string, target: DocumentLinkTarget, targetId: string): Promise<void>;
  /** Entscheidung oder Fakt ausdrücklich auf die Agenda setzen bzw. herunternehmen (16.1) */
  setDecisionAgenda(id: string, onAgenda: boolean, reason?: MarkReason): Promise<Undoable>;
  search(query: string): Promise<SearchGroup[]>;

  // Drive [P5] (WF-WIS-08 bis -10, WF-VER-14): Anzeige immer sofort aus dem Cache
  getDriveFolder(folderId: string | null): Promise<DriveFolder>;
  /** Dateisuche über die Namen im ganzen Verzeichnis (F-WIS-08) */
  searchDrive(query: string): Promise<DriveEntry[]>;
  /** „Zuletzt geändert“: die neuesten Dateien */
  recentDrive(): Promise<DriveEntry[]>;
  /** Abgleich im Hintergrund über die Changes-API, höchstens einmal pro Minute */
  syncDrive(): Promise<{ changed: number; checked: boolean }>;
  /** WF-WIS-10 „Neu einlesen“: vollständiger Neuaufbau des Caches */
  rebuildDrive(): Promise<{ count: number }>;
  /** WF-WIS-09: legt den documents-Eintrag an, falls neu, und verknüpft ihn */
  linkDriveFile(input: DriveLinkInput): Promise<{ document_id: string; created: boolean }>;
  setEventDriveFolder(eventId: string, folderId: string | null, version: number): Promise<void>;

  // Plenum [P3] (WF-PLE-03, -19, -20): Ergebnis, Protokoll, Abschluss
  getPlenum(id: string): Promise<PlenumDetail>;
  updateProtocol(plenumId: string, input: ProtocolInput): Promise<void>;
  closePlenum(plenumId: string, attendeeIds: string[], version: number): Promise<{ recipients: number }>;
  /**
   * Antwort auf „Gehört das zum Plenum?“ (16.2) für Personen ohne Zusage – gilt für alle weiteren Änderungen dieser
   * Sitzung, solange das Plenum läuft. Nur auf diesem Gerät; der Server prüft selbst, ob das Plenum läuft.
   */
  setPlenumAnswer(plenumId: string, belongs: boolean): void;

  // Erinnerungen [P2] (WF-PRO-02, WF-PRO-03, WF-ADM-07)
  getNotificationSettings(): Promise<NotificationSettings>;
  setPush(on: boolean): Promise<void>;
  startTelegramLink(): Promise<{ url: string; expires_at: string }>;
  unlinkTelegram(): Promise<void>;
  getSystemStatus(): Promise<SystemStatus>;
  /** WF-PRO-05 Rückmeldung aus der App: Bug oder Feature-Wunsch (16.5) */
  createAppReport(input: AppReportCreateInput): Promise<{ id: string }>;
  /** WF-ADM-10 alle Rückmeldungen, neueste zuerst – nur für Admins */
  listAppReports(): Promise<AppReport[]>;
  // Benachrichtigungs-Einstellungen [P6] (WF-PRO-04): wirken sofort
  setNotificationPreference(
    group: NotificationGroupKey,
    channel: NotificationChannel,
    enabled: boolean,
  ): Promise<void>;
  setReminderLeadDays(days: number): Promise<void>;

  demo?: DemoTools;
}
