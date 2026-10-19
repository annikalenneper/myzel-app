// Testdaten-Schicht hinter der MyzelApi-Schnittstelle: Sitzung, Transaktionen, Speicherung im
// Browser und die Demo-Werkzeuge (Konflikt, Netzfehler). Wird in Schritt C durch die Anbindung
// an Supabase und die Netlify Functions ersetzt.
import { AppError } from '../../shared/errors';
import { buildExport, exportToYaml } from '../../shared/export';
import { emailInputSchema, type Member } from '../../shared/schema';
import type { DemoAccount, MyzelApi, Session } from '../api';
import { JOB_INTERVAL_MINUTES, JOB_WARNING_MINUTES } from '../../shared/rules/notifications';
import * as appts from './appointments';
import * as drive from './drive';
import * as events from './events';
import * as partners from './partners';
import * as templates from './templates';
import * as know from './knowledge';
import * as notify from './notify';
import * as plenum from './plenum';
import * as series from './series';
import * as telegram from './telegram';
import { DRIVE_EVENT_FOLDER_ID, seedDb } from './seed';
import * as server from './server';
import type { Ctx, Db } from './server';

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface MockOptions {
  storage?: KeyValueStorage;
  now?: () => Date;
  /** künstliche Verzögerung in ms, damit Ladezustände sichtbar sind */
  latency?: number;
}

const DB_KEY = 'myzel:mock:db:v9';
const DEVICE_KEY = 'myzel:mock:geraet';
const OUTAGE_KEY = 'myzel:mock:ausfall';
const SESSION_KEY = 'myzel:mock:session';
const MAGIC_KEY = 'myzel:mock:magic-link';
const OUTSIDER = 'jemand@example.org';

/**
 * Ein Joblauf (alle 15 Minuten über cron-job.org): Serientermine anlegen und einladen, dann Erinnerungen und
 * Versand, dazu der wöchentliche Neuaufbau des Drive-Caches. Automatische Vorgänge laufen als „Myzel (automatisch)“.
 */
function jobRun(db: Db, at: Date): void {
  const system = db.members.find((m) => m.is_system);
  if (system) series.generateSeries({ db, actor: system, now: at, inverse: [] });
  notify.runJob(db, at);
  drive.weeklyRebuild(db, at);
}

export function createMockApi(options: MockOptions = {}): MyzelApi {
  const storage = options.storage;
  const now = options.now ?? (() => new Date());
  const latency = options.latency ?? 0;
  const listeners = new Set<() => void>();
  let failWrites = 0;
  let memorySession: string | null = null;
  let memoryMagic: string | null = null;

  const load = (): Db => {
    const raw = storage?.getItem(DB_KEY);
    if (raw) {
      try {
        return JSON.parse(raw) as Db;
      } catch {
        // beschädigter Stand: neu aufsetzen
      }
    }
    const fresh = seedDb(now());
    storage?.setItem(DB_KEY, JSON.stringify(fresh));
    return fresh;
  };
  let db = load();

  // Jedes Gerät (hier: jeder Browser) hat sein eigenes Push-Abo
  let memoryDevice: string | null = null;
  const deviceId = (): string => {
    let id = storage?.getItem(DEVICE_KEY) ?? memoryDevice;
    if (!id) {
      id = `geraet-${crypto.randomUUID()}`;
      memoryDevice = id;
      storage?.setItem(DEVICE_KEY, id);
    }
    return id;
  };
  let memoryOutage = false;
  const outage = () => (storage ? storage.getItem(OUTAGE_KEY) === '1' : memoryOutage);

  /** Ersetzt cron-job.org: Ist der letzte Lauf älter als 15 Minuten, läuft der Job einmal nach. */
  const catchUpJob = () => {
    if (outage()) return;
    const last = db.job_runs.at(-1);
    if (last && now().getTime() - new Date(last.started_at).getTime() < JOB_INTERVAL_MINUTES * 60_000) return;
    jobRun(db, now());
    storage?.setItem(DB_KEY, JSON.stringify(db));
  };

  const wait = () => (latency ? new Promise<void>((r) => setTimeout(r, latency)) : Promise.resolve());
  const emit = () => listeners.forEach((l) => l());
  const sessionEmail = () => storage?.getItem(SESSION_KEY) ?? memorySession;
  const setSessionEmail = (email: string | null) => {
    memorySession = email;
    if (email) storage?.setItem(SESSION_KEY, email);
    else storage?.removeItem(SESSION_KEY);
  };

  const memberByEmail = (email: string): Member | undefined =>
    db.members.find((m) => m.email?.toLowerCase() === email.toLowerCase() && m.active && !m.is_system);

  const session = (): Session => {
    sync();
    const email = sessionEmail();
    if (!email) return { state: 'anonymous' };
    const member = memberByEmail(email);
    return member ? { state: 'member', member } : { state: 'no_access', email };
  };

  /** Nur eingeloggte aktive Mitglieder lesen und schreiben (7.1). */
  const actor = (): Member => {
    const s = session();
    if (s.state !== 'member')
      throw new AppError('unauthenticated', 'Du bist nicht mehr angemeldet. Bitte melde dich neu an.');
    return s.member;
  };

  /** Mehrere Tabs teilen sich den Stand im Speicher – vor jedem Zugriff wird er frisch gelesen. */
  const sync = () => {
    if (storage) db = load();
    catchUpJob();
  };

  async function read<T>(fn: (db: Db, now: Date) => T): Promise<T> {
    await wait();
    sync();
    actor();
    return structuredClone(fn(db, now()));
  }

  /** Eine Transaktion: entweder alle Änderungen samt Historie oder keine. */
  function transact<T>(member: Member, fn: (ctx: Ctx) => T, silent = false): T {
    sync();
    const draft = structuredClone(db);
    const ctx: Ctx = {
      db: draft,
      actor: draft.members.find((m) => m.id === member.id)!,
      now: now(),
      inverse: [],
    };
    const result = fn(ctx);
    db = draft;
    storage?.setItem(DB_KEY, JSON.stringify(db));
    if (!silent) emit();
    return result;
  }

  async function write<T>(fn: (ctx: Ctx) => T): Promise<T> {
    await wait();
    if (failWrites > 0) {
      failWrites -= 1;
      throw new AppError('network', 'Keine Verbindung – nicht gespeichert.');
    }
    return transact(actor(), fn);
  }

  const signInAs = async (email: string): Promise<Session> => {
    await wait();
    setSessionEmail(email);
    emit();
    return structuredClone(session());
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async getSession() {
      await wait();
      return structuredClone(session());
    },
    async signInWithGoogle() {
      // In Schritt A gibt es keine echten Konten: die Anmeldeseite zeigt stattdessen demo.accounts().
      throw new AppError('rule', 'Die Google-Anmeldung wird in Schritt C angebunden.');
    },
    async requestMagicLink(email) {
      const parsed = emailInputSchema.safeParse(email);
      if (!parsed.success)
        throw new AppError('validation', parsed.error.issues[0]!.message, { field: 'email' });
      await wait();
      // Antwort ist immer gleich – egal, ob die Adresse bekannt ist (WF-LOG-02)
      storage?.setItem(MAGIC_KEY, parsed.data);
      memoryMagic = parsed.data;
    },
    async signOut() {
      await wait();
      // das Push-Abo dieses Geräts endet mit der Sitzung (WF-LOG-03)
      const s = session();
      if (s.state === 'member') transact(s.member, (ctx) => notify.setPush(ctx, deviceId(), false), true);
      setSessionEmail(null);
      emit();
    },

    listMembers: () => read((d) => d.members),
    listTopics: () => read((d) => server.listTopics(d)),
    listTasks: () => read((d) => server.listTasks(d)),
    getTask: (id) => read((d) => server.getTask(d, id)),
    listEvents: () => read((d, n) => server.listEvents(d, n)),
    getEvent: (id) => read((d, n) => server.getEvent(d, id, n)),

    createTask: (input) => write((ctx) => server.createTask(ctx, input)),
    updateTaskFields: (id, fields, version) =>
      write((ctx) => server.updateTaskFields(ctx, id, fields, version)),
    updateTaskDescription: (id, description, version) =>
      write((ctx) => server.updateTaskDescription(ctx, id, description, version)),
    setTaskStatus: (id, input) => write((ctx) => server.setTaskStatus(ctx, id, input)),
    addAssignee: (taskId, memberId) => write((ctx) => server.addAssignee(ctx, taskId, memberId)),
    removeAssignee: (taskId, memberId) => write((ctx) => server.removeAssignee(ctx, taskId, memberId)),
    addFollower: (taskId, memberId) => write((ctx) => server.addFollower(ctx, taskId, memberId)),
    removeFollower: (taskId, memberId) => write((ctx) => server.removeFollower(ctx, taskId, memberId)),
    addBlocker: (taskId, blockerId) => write((ctx) => server.addBlocker(ctx, taskId, blockerId)),
    removeBlocker: (taskId, blockerId) => write((ctx) => server.removeBlocker(ctx, taskId, blockerId)),
    setPlenumMark: (taskId, marked) => write((ctx) => server.setPlenumMark(ctx, taskId, marked)),
    addComment: (taskId, body) => write((ctx) => server.addComment(ctx, taskId, body)),
    updateComment: (commentId, body) => write((ctx) => server.updateComment(ctx, commentId, body)),
    archiveTask: (id, version) => write((ctx) => server.archiveTask(ctx, id, version)),
    restoreTask: (id, version) => write((ctx) => server.restoreTask(ctx, id, version)),
    undo: (token) => write((ctx) => server.undo(ctx, token)),

    createEvent: (input) => write((ctx) => server.createEvent(ctx, input)),
    updateEvent: (id, input) => write((ctx) => server.updateEvent(ctx, id, input)),
    setEventStatus: (id, status, version) => write((ctx) => server.setEventStatus(ctx, id, status, version)),
    getEventDetail: (id) => read((d, n) => events.getEventDetail(d, id, n)),
    updateEventDetail: (id, input) => write((ctx) => events.updateEventDetail(ctx, id, input)),
    addBooking: (eventId, input) => write((ctx) => events.addBooking(ctx, eventId, input)),
    updateBooking: (id, input) => write((ctx) => events.updateBooking(ctx, id, input)),
    removeBooking: (id) => write((ctx) => events.removeBooking(ctx, id)),
    addEventLead: (eventId, memberId) => write((ctx) => events.addLead(ctx, eventId, memberId)),
    removeEventLead: (eventId, memberId) => write((ctx) => events.removeLead(ctx, eventId, memberId)),
    setShiftPlan: (eventId, documentId, version) =>
      write((ctx) => events.setShiftPlan(ctx, eventId, documentId, version)),
    listPartners: () => read((d) => partners.listPartners(d)),
    getPartner: (id) => read((d) => partners.getPartner(d, id)),
    createPartner: (input) => write((ctx) => partners.createPartner(ctx, input)),
    updatePartner: (id, input) => write((ctx) => partners.updatePartner(ctx, id, input)),
    linkPartner: (eventId, partnerId, roleNote) =>
      write((ctx) => partners.linkPartner(ctx, eventId, partnerId, roleNote)),
    unlinkPartner: (eventId, partnerId) => write((ctx) => partners.unlinkPartner(ctx, eventId, partnerId)),
    getTemplateDialog: (eventId) => read((d, n) => templates.getTemplateDialog(d, eventId, n)),
    applyTemplate: (eventId, itemIds) =>
      write((ctx) => templates.applyTemplate(ctx, eventId, { item_ids: itemIds })),
    listTemplates: () => read((d) => templates.listTemplates(d)),
    createTemplateItem: (templateId, input) =>
      write((ctx) => templates.createTemplateItem(ctx, templateId, input)),
    updateTemplateItem: (id, input) => write((ctx) => templates.updateTemplateItem(ctx, id, input)),
    removeTemplateItem: (id) => write((ctx) => templates.removeTemplateItem(ctx, id)),

    updateOwnName: (name) => write((ctx) => server.updateOwnName(ctx, name)),
    createMember: (input) => write((ctx) => server.createMember(ctx, input)),
    updateMember: (id, input) => write((ctx) => server.updateMember(ctx, id, input)),
    getDeactivationImpact: (memberId) =>
      read((d, n) => ({
        ...server.getDeactivationImpact({ db: d, actor: actor(), now: n, inverse: [] }, memberId),
        future_rsvp_count: appts.futureRsvpCount(d, memberId, n),
        lead_count: d.event_leads.filter((l) => l.member_id === memberId).length,
        partner_contact_count: d.partners.filter((p) => p.internal_contact_member_id === memberId).length,
      })),
    // Aufräumen in derselben Transaktion: Aufgaben, Folgen und künftige Zusagen (F-LOG-03)
    deactivateMember: (memberId) =>
      write((ctx) => {
        const future_rsvp_count = appts.futureRsvpCount(ctx.db, memberId, ctx.now);
        const impact = server.deactivateMember(ctx, memberId);
        appts.dropFutureRsvps(ctx, memberId);
        const lead_count = events.dropLeads(ctx, memberId);
        const partner_contact_count = partners.dropPartnerContacts(ctx, memberId);
        notify.dropChannels(ctx.db, memberId);
        return { ...impact, future_rsvp_count, lead_count, partner_contact_count };
      }),
    reactivateMember: (memberId) => write((ctx) => server.reactivateMember(ctx, memberId)),
    createTopic: (input) => write((ctx) => server.createTopic(ctx, input)),
    updateTopic: (id, input) => write((ctx) => server.updateTopic(ctx, id, input)),
    archiveTopic: (id, version) => write((ctx) => server.archiveTopic(ctx, id, version)),
    restoreTopic: (id, version) => write((ctx) => server.restoreTopic(ctx, id, version)),
    deleteTopic: (id) => write((ctx) => server.deleteTopic(ctx, id)),

    listAppointmentTypes: () => read((d) => appts.listAppointmentTypes(d)),
    createAppointmentType: (input) => write((ctx) => appts.createAppointmentType(ctx, input)),
    updateAppointmentType: (id, input) => write((ctx) => appts.updateAppointmentType(ctx, id, input)),
    archiveAppointmentType: (id, version) =>
      write((ctx) => appts.archiveAppointmentType(ctx, id, version, true)),
    restoreAppointmentType: (id, version) =>
      write((ctx) => appts.archiveAppointmentType(ctx, id, version, false)),
    deleteAppointmentType: (id) => write((ctx) => appts.deleteAppointmentType(ctx, id)),
    listAppointments: () => read((d) => appts.listAppointments(d, actor().id)),
    getAppointment: (id) => read((d) => appts.getAppointment(d, id, actor().id)),
    createAppointment: (input) => write((ctx) => appts.createAppointment(ctx, input)),
    updateAppointment: (id, input) => write((ctx) => appts.updateAppointment(ctx, id, input)),
    setRsvp: (id, answer) => write((ctx) => appts.setRsvp(ctx, id, answer)),
    cancelAppointment: (id, version) => write((ctx) => appts.cancelAppointment(ctx, id, version)),
    markAppointmentHappened: (id, attendeeIds, version) =>
      write((ctx) => appts.markHappened(ctx, id, attendeeIds, version)),
    setAttendee: (id, memberId, present) => write((ctx) => appts.setAttendee(ctx, id, memberId, present)),
    setAppointmentMark: (id, marked) => write((ctx) => appts.setAppointmentMark(ctx, id, marked)),
    getSeries: (id) => read((d, n) => series.seriesDetail(d, id, n)),
    createSeries: (input) => write((ctx) => series.createSeries(ctx, input)),
    updateSeries: (id, input) => write((ctx) => series.updateSeries(ctx, id, input)),
    endSeries: (id, version) => write((ctx) => series.endSeries(ctx, id, version)),

    listDecisions: () => read((d) => know.listDecisions(d)),
    getDecision: (id) => read((d) => know.getDecision(d, id)),
    createDecision: (input) => write((ctx) => know.createDecision(ctx, input)),
    replaceDecision: (id, input) => write((ctx) => know.replaceDecision(ctx, id, input)),
    revokeDecision: (id, note, version) => write((ctx) => know.revokeDecision(ctx, id, note, version)),
    listQuestions: () => read((d) => know.listQuestions(d)),
    getQuestion: (id) => read((d) => know.getQuestion(d, id)),
    createQuestion: (input) => write((ctx) => know.createQuestion(ctx, input)),
    clarifyQuestion: (id, input) => write((ctx) => know.clarifyQuestion(ctx, id, input)),
    discardQuestion: (id, version) => write((ctx) => know.discardQuestion(ctx, id, version)),
    listDocuments: () => read((d) => know.listDocuments(d)),
    listLinkedDocuments: (target, targetId) => read((d) => know.linkedDocuments(d, target, targetId)),
    createDocument: (input) => write((ctx) => know.createDocument(ctx, input)),
    linkDocument: (documentId, target, targetId) =>
      write((ctx) => know.linkDocument(ctx, documentId, target, targetId)),
    unlinkDocument: (documentId, target, targetId) =>
      write((ctx) => know.unlinkDocument(ctx, documentId, target, targetId)),
    setMark: (target, id, marked) => write((ctx) => know.setMark(ctx, target, id, marked)),
    search: (query) => read((d, n) => know.search(d, query, n)),

    getDriveFolder: (folderId) => read((d) => drive.getDriveFolder(d, folderId)),
    searchDrive: (query) => read((d) => drive.searchDrive(d, query)),
    recentDrive: () => read((d) => drive.recentDrive(d)),
    // Abgleich im Hintergrund: keine Handlung der Person, keine Historie. Meldet sich, sobald wirklich
    // abgeglichen wurde – auch ohne Änderung, damit „abgeglichen vor …“ stimmt.
    async syncDrive() {
      await wait();
      const me = actor();
      const before = db.drive_sync_state.last_checked_at;
      const result = transact(me, (ctx) => drive.syncDrive(ctx.db, ctx.now), true);
      if (result.changed || db.drive_sync_state.last_checked_at !== before) emit();
      return result;
    },
    rebuildDrive: () => write((ctx) => drive.rebuildDrive(ctx.db, ctx.now)),
    linkDriveFile: (input) => write((ctx) => drive.linkDriveFile(ctx, input)),
    setEventDriveFolder: (eventId, folderId, version) =>
      write((ctx) => events.setDriveFolder(ctx, eventId, folderId, version)),

    getPlenum: (id) => read((d, n) => plenum.getPlenum(d, id, actor().id, n)),
    plenumAction: (plenumId, input) => write((ctx) => plenum.plenumAction(ctx, plenumId, input)),
    moveAgendaItem: (markId, toIndex) => write((ctx) => plenum.moveMark(ctx, markId, toIndex)),
    plenumAdd: (plenumId, input) => write((ctx) => plenum.plenumAdd(ctx, plenumId, input)),
    updateProtocol: (plenumId, input) => write((ctx) => plenum.updateProtocol(ctx, plenumId, input)),
    closePlenum: (plenumId, attendeeIds, version) =>
      write((ctx) => plenum.closePlenum(ctx, plenumId, attendeeIds, version)),

    getNotificationSettings: () =>
      read((d, n) => notify.notificationSettings({ db: d, actor: actor(), now: n, inverse: [] }, deviceId())),
    setPush: (on) => write((ctx) => notify.setPush(ctx, deviceId(), on)),
    startTelegramLink: () => write((ctx) => notify.startTelegramLink(ctx)),
    unlinkTelegram: () => write((ctx) => notify.unlinkTelegram(ctx)),
    setNotificationPreference: (group, channel, enabled) =>
      write((ctx) => notify.setNotificationPreference(ctx, group, channel, enabled)),
    setReminderLeadDays: (days) => write((ctx) => notify.setReminderLeadDays(ctx, days)),
    setOwnStatusNotifications: (on) => write((ctx) => notify.setOwnStatusNotifications(ctx, on)),
    getSystemStatus: () =>
      read((d, n) => notify.systemStatus({ db: d, actor: actor(), now: n, inverse: [] })),

    demo: {
      accounts(): DemoAccount[] {
        const members = db.members
          .filter((m) => !m.is_system && m.email)
          .slice(0, 4)
          .map((m) => ({
            email: m.email!,
            label: m.display_name,
            hint: m.is_admin ? 'Mitglied mit Admin-Rechten' : 'Mitglied',
          }));
        return [...members, { email: OUTSIDER, label: 'Jemand', hint: 'nicht auf der Mitgliederliste' }];
      },
      signInAs,
      pendingMagicLink: () => storage?.getItem(MAGIC_KEY) ?? memoryMagic,
      async openMagicLink() {
        const email = storage?.getItem(MAGIC_KEY) ?? memoryMagic;
        if (!email) throw new AppError('rule', 'Es wurde kein Link angefordert.');
        storage?.removeItem(MAGIC_KEY);
        memoryMagic = null;
        return signInAs(email);
      },
      async simulateForeignEdit(taskId) {
        const me = actor();
        const other = db.members.find((m) => m.active && !m.is_system && m.id !== me.id)!;
        const task = db.tasks.find((t) => t.id === taskId);
        if (!task) throw new AppError('not_found', 'Diese Aufgabe gibt es nicht mehr.');
        const next = task.priority === 'hoch' ? 'mittel' : 'hoch';
        transact(
          other,
          (ctx) => server.updateTaskFields(ctx, taskId, { priority: next }, task.version),
          true,
        );
      },
      failNextWrites(n) {
        failWrites = n;
      },
      async completeTelegramLink() {
        const me = actor();
        const code = db.telegram_link_codes.filter((c) => c.member_id === me.id && !c.used_at).at(-1);
        if (!code) throw new AppError('rule', 'Es wartet keine Verknüpfung.');
        transact(me, (ctx) =>
          notify.redeemTelegramCode(ctx.db, ctx.now, code.code, `chat-${me.short.toLowerCase()}`),
        );
      },
      async myMessages() {
        return read((d) => notify.messagesFor(d, actor().id));
      },
      async runJobNow() {
        transact(actor(), (ctx) => jobRun(ctx.db, ctx.now));
      },
      async driveAddFile() {
        return transact(
          actor(),
          (ctx) => {
            const n = ctx.db.drive_remote.items.filter((i) => i.file_id.startsWith('drive-neu-')).length;
            const name = `Neue Notiz ${n + 1}`;
            const id = `drive-neu-${crypto.randomUUID()}`;
            drive.remotePut(ctx.db, {
              file_id: id,
              parent_id: DRIVE_EVENT_FOLDER_ID,
              name,
              mime_type: 'application/vnd.google-apps.document',
              modified_time: ctx.now.toISOString(),
              web_url: `https://docs.google.com/document/d/${id}`,
            });
            return name;
          },
          true,
        );
      },
      async exportYaml() {
        return read((d, n) => exportToYaml(buildExport(d, n)));
      },
      async telegramPress(outboxId, button) {
        await wait();
        const me = actor();
        try {
          return transact(me, (ctx) => telegram.pressTelegramButton(ctx, outboxId, button));
        } catch (e) {
          return telegram.friendlyReply(e);
        }
      },
      async driveTrashLinkedFile() {
        return transact(
          actor(),
          (ctx) => {
            const doc = ctx.db.documents.find(
              (d) => d.drive_file_id && !d.archived_at && drive.driveItem(ctx.db, d.drive_file_id),
            );
            if (!doc) return null;
            drive.remoteTrash(ctx.db, doc.drive_file_id!);
            return doc.title;
          },
          true,
        );
      },
      async setOutage(on) {
        memoryOutage = on;
        if (on) storage?.setItem(OUTAGE_KEY, '1');
        else storage?.removeItem(OUTAGE_KEY);
        transact(actor(), (ctx) => {
          // Ausfall: seit gut zwei Stunden kein Lauf; danach holt der nächste Lauf nach
          const cutoff = ctx.now.getTime() - (JOB_WARNING_MINUTES + 15) * 60_000;
          if (on) ctx.db.job_runs = ctx.db.job_runs.filter((r) => new Date(r.started_at).getTime() < cutoff);
          else notify.runJob(ctx.db, ctx.now);
          if (on && ctx.db.job_runs.length === 0) notify.runJob(ctx.db, new Date(cutoff - 60_000));
        });
      },
      outage,
      async reset() {
        memoryOutage = false;
        storage?.removeItem(OUTAGE_KEY);
        db = seedDb(now());
        storage?.setItem(DB_KEY, JSON.stringify(db));
        emit();
      },
    },
  };
}
