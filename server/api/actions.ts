// Alle Aktionen der Server-Funktionen mit Namen – dieselbe Liste nutzen die Netlify Function (netlify/functions/api)
// und die Tests (createServerApi). Lesende Aktionen laufen ohne Transaktion, schreibende in genau einer.
// Was erst eine spätere Phase bringt, steht hier noch nicht: der Aufruf endet dann mit einer verständlichen Meldung.
import type { Kysely } from 'kysely';
import type { EventStatus } from '../../src/shared/schema';
import type { Ctx } from '../core/context';
import type { Database } from '../db/types';
import * as events from '../p1/events';
import * as members from '../p1/members';
import * as reads from '../p1/reads';
import * as tasks from '../p1/tasks';
import { undo } from '../p1/undo';

type Args = unknown[];
const s = (v: unknown) => v as string;
const n = (v: unknown) => v as number;

export const READ_ACTIONS: Record<string, (db: Kysely<Database>, args: Args, now: Date) => Promise<unknown>> =
  {
    listMembers: (db) => reads.listMembers(db),
    listTopics: (db) => reads.listTopics(db),
    listTasks: (db) => reads.listTasks(db),
    getTask: (db, [id]) => reads.getTask(db, s(id)),
    listEvents: (db, _, now) => reads.listEvents(db, now),
    getEvent: (db, [id], now) => reads.getEvent(db, s(id), now),
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
};
