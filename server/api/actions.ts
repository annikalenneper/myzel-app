// Alle Aktionen der Server-Funktionen mit Namen – dieselbe Liste nutzen die Netlify Function (netlify/functions/api)
// und die Tests (createServerApi). Lesende Aktionen laufen ohne Transaktion, schreibende in genau einer.
// Was erst eine spätere Phase bringt, steht hier noch nicht: der Aufruf endet dann mit einer verständlichen Meldung.
import type { Kysely } from 'kysely';
import type { DocumentLinkTarget, EventStatus, RsvpAnswer } from '../../src/shared/schema';
import type { Ctx } from '../core/context';
import type { Database } from '../db/types';
import * as events from '../p1/events';
import * as members from '../p1/members';
import * as reads from '../p1/reads';
import * as tasks from '../p1/tasks';
import { undo } from '../p1/undo';
import * as notify from '../p2/notify';
import * as appts from '../p3/appointments';
import * as know from '../p3/knowledge';
import * as plenum from '../p3/plenum';

type Args = unknown[];
const s = (v: unknown) => v as string;
const n = (v: unknown) => v as number;
/** Name des Telegram-Bots (ohne @) für den Verknüpfungs-Link; leer = Telegram noch nicht eingerichtet */
const botUsername = () => process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, '') || null;

export const READ_ACTIONS: Record<string, (db: Kysely<Database>, args: Args, now: Date) => Promise<unknown>> =
  {
    listMembers: (db) => reads.listMembers(db),
    listTopics: (db) => reads.listTopics(db),
    listTasks: (db) => reads.listTasks(db),
    getTask: (db, [id]) => reads.getTask(db, s(id)),
    listEvents: (db, _, now) => reads.listEvents(db, now),
    getEvent: (db, [id], now) => reads.getEvent(db, s(id), now),
    getEventDetail: (db, [id], now) => reads.getEventDetail(db, s(id), now),
  };

export const WRITE_ACTIONS: Record<string, (ctx: Ctx, args: Args) => Promise<unknown>> = {
  createTask: (ctx, [input]) => tasks.createTask(ctx, input),
  updateTaskFields: (ctx, [id, fields, version]) => tasks.updateTaskFields(ctx, s(id), fields, n(version)),
  updateTaskDescription: (ctx, [id, d, version]) => tasks.updateTaskDescription(ctx, s(id), d, n(version)),
  setTaskStatus: (ctx, [id, input]) => tasks.setTaskStatus(ctx, s(id), input),
  addAssignee: (ctx, [taskId, memberId]) => tasks.addAssignee(ctx, s(taskId), s(memberId)),
  removeAssignee: (ctx, [taskId, memberId]) => tasks.removeAssignee(ctx, s(taskId), s(memberId)),
  addFollower: (ctx, [taskId, memberId]) => tasks.addFollower(ctx, s(taskId), s(memberId)),
  removeFollower: (ctx, [taskId, memberId]) => tasks.removeFollower(ctx, s(taskId), s(memberId)),
  addBlocker: (ctx, [taskId, blockerId]) => tasks.addBlocker(ctx, s(taskId), s(blockerId)),
  removeBlocker: (ctx, [taskId, blockerId]) => tasks.removeBlocker(ctx, s(taskId), s(blockerId)),
  setPlenumMark: (ctx, [taskId, marked]) => tasks.setPlenumMark(ctx, s(taskId), marked === true),
  addComment: (ctx, [taskId, body]) => tasks.addComment(ctx, s(taskId), body),
  updateComment: (ctx, [commentId, body]) => tasks.updateComment(ctx, s(commentId), body),
  archiveTask: (ctx, [id, version]) => tasks.archiveTask(ctx, s(id), n(version)),
  restoreTask: (ctx, [id, version]) => tasks.restoreTask(ctx, s(id), n(version)),
  undo: (ctx, [token]) => undo(ctx, s(token)),

  createEvent: (ctx, [input]) => events.createEvent(ctx, input),
  updateEvent: (ctx, [id, input]) => events.updateEvent(ctx, s(id), input),
  setEventStatus: (ctx, [id, status, version]) =>
    events.setEventStatus(ctx, s(id), status as EventStatus, n(version)),

  updateOwnName: (ctx, [name]) => members.updateOwnName(ctx, name),
  createMember: (ctx, [input]) => members.createMember(ctx, input),
  updateMember: (ctx, [id, input]) => members.updateMember(ctx, s(id), input),
  // liest nur, prüft aber Admin-Rechte über die handelnde Person
  getDeactivationImpact: (ctx, [memberId]) => members.getDeactivationImpact(ctx, s(memberId)),
  deactivateMember: (ctx, [memberId]) => members.deactivateMember(ctx, s(memberId)),
  reactivateMember: (ctx, [memberId]) => members.reactivateMember(ctx, s(memberId)),
  createTopic: (ctx, [input]) => members.createTopic(ctx, input),
  updateTopic: (ctx, [id, input]) => members.updateTopic(ctx, s(id), input),
  archiveTopic: (ctx, [id, version]) => members.archiveTopic(ctx, s(id), n(version)),
  restoreTopic: (ctx, [id, version]) => members.restoreTopic(ctx, s(id), n(version)),
  deleteTopic: (ctx, [id]) => members.deleteTopic(ctx, s(id)),

  // [P2] Erinnerungen – lesen auch über die handelnde Person (eigene Einstellungen, Admin-Status)
  getNotificationSettings: (ctx, [endpoint]) =>
    notify.notificationSettings(ctx, typeof endpoint === 'string' ? endpoint : null, botUsername()),
  savePushSubscription: (ctx, [subscription]) => notify.savePushSubscription(ctx, subscription),
  removePushSubscription: (ctx, [endpoint]) => notify.removePushSubscription(ctx, endpoint),
  startTelegramLink: (ctx) => notify.startTelegramLink(ctx, botUsername()),
  unlinkTelegram: (ctx) => notify.unlinkTelegram(ctx),
  getSystemStatus: (ctx) => notify.systemStatus(ctx),

  // [P3] Termine, Terminarten (Lesen über die handelnde Person: eigene Zusage)
  listAppointmentTypes: (ctx) => appts.listAppointmentTypes(ctx),
  createAppointmentType: (ctx, [input]) => appts.createAppointmentType(ctx, input),
  updateAppointmentType: (ctx, [id, input]) => appts.updateAppointmentType(ctx, s(id), input),
  archiveAppointmentType: (ctx, [id, version]) => appts.archiveAppointmentType(ctx, s(id), n(version), true),
  restoreAppointmentType: (ctx, [id, version]) => appts.archiveAppointmentType(ctx, s(id), n(version), false),
  deleteAppointmentType: (ctx, [id]) => appts.deleteAppointmentType(ctx, s(id)),
  listAppointments: (ctx) => appts.listAppointments(ctx),
  getAppointment: (ctx, [id]) => appts.getAppointment(ctx.trx, s(id), ctx.actor.id),
  createAppointment: (ctx, [input]) => appts.createAppointment(ctx, input),
  updateAppointment: (ctx, [id, input]) => appts.updateAppointment(ctx, s(id), input),
  setRsvp: (ctx, [id, answer]) => appts.setRsvp(ctx, s(id), (answer ?? null) as RsvpAnswer | null),
  cancelAppointment: (ctx, [id, version]) => appts.cancelAppointment(ctx, s(id), n(version)),
  markAppointmentHappened: (ctx, [id, attendees, version]) =>
    appts.markHappened(ctx, s(id), attendees as unknown[], n(version)),
  setAttendee: (ctx, [id, memberId, present]) => appts.setAttendee(ctx, s(id), s(memberId), present === true),
  setAppointmentMark: (ctx, [id, marked]) => appts.setAppointmentMark(ctx, s(id), marked === true),

  // [P3] Wissen
  listDecisions: (ctx) => know.listDecisions(ctx.trx),
  getDecision: (ctx, [id]) => know.getDecision(ctx.trx, s(id)),
  createDecision: (ctx, [input]) => know.createDecision(ctx, input),
  replaceDecision: (ctx, [id, input]) => know.replaceDecision(ctx, s(id), input),
  revokeDecision: (ctx, [id, note, version]) => know.revokeDecision(ctx, s(id), note, n(version)),
  listQuestions: (ctx) => know.listQuestions(ctx.trx),
  getQuestion: (ctx, [id]) => know.getQuestion(ctx.trx, s(id)),
  createQuestion: (ctx, [input]) => know.createQuestion(ctx, input),
  clarifyQuestion: (ctx, [id, input]) => know.clarifyQuestion(ctx, s(id), input),
  discardQuestion: (ctx, [id, version]) => know.discardQuestion(ctx, s(id), n(version)),
  listDocuments: (ctx) => know.listDocuments(ctx.trx),
  listLinkedDocuments: (ctx, [target, id]) =>
    know.linkedDocuments(ctx.trx, target as DocumentLinkTarget, s(id)),
  createDocument: (ctx, [input]) => know.createDocument(ctx, input),
  linkDocument: (ctx, [documentId, target, targetId]) =>
    know.linkDocument(ctx, s(documentId), target as DocumentLinkTarget, s(targetId)),
  unlinkDocument: (ctx, [documentId, target, targetId]) =>
    know.unlinkDocument(ctx, s(documentId), target as DocumentLinkTarget, s(targetId)),
  setMark: (ctx, [target, id, marked]) => know.setMark(ctx, target, s(id), marked === true),
  search: (ctx, [query]) => know.search(ctx.trx, query, ctx.now),

  // [P3] Plenum
  getPlenum: (ctx, [id]) => plenum.getPlenum(ctx, s(id)),
  plenumAction: (ctx, [id, input]) => plenum.plenumAction(ctx, s(id), input),
  moveAgendaItem: (ctx, [markId, toIndex]) => plenum.moveMark(ctx, markId, toIndex),
  plenumAdd: (ctx, [id, input]) => plenum.plenumAdd(ctx, s(id), input),
  updateProtocol: (ctx, [id, input]) => plenum.updateProtocol(ctx, s(id), input),
  closePlenum: (ctx, [id, attendees, version]) => plenum.closePlenum(ctx, s(id), attendees, n(version)),
};
