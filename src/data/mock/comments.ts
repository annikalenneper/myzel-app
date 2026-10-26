// Testdaten-Schicht: Kommentare an allen Artefakten (ANFORDERUNGEN 16.3). Aufgaben behalten ihre eigenen Regeln
// (wer kommentiert, folgt; Benachrichtigung) in server.ts; alle anderen Arten bekommen den Kommentar und einen
// Eintrag in ihrer Historie. Bearbeiten darf nur, wer ihn geschrieben hat.
import { AppError } from '../../shared/errors';
import {
  commentBodySchema,
  type Comment,
  type CommentTarget,
  type HistoryEntityType,
  type HistoryEntry,
} from '../../shared/schema';
import * as server from './server';
import { iso, notFound, parse, rule, writeHistory, type Ctx, type Db } from './server';

const column = (target: CommentTarget) => `${target}_id` as const;

const entities = (db: Db, target: CommentTarget): { id: string; archived_at: string | null }[] =>
  ({
    task: db.tasks,
    question: db.questions,
    decision: db.decisions,
    event: db.events,
    appointment: db.appointments,
    partner: db.partners,
  })[target];

/** Kommentare eines Artefakts, ältester zuerst */
export function commentsOf(db: Db, target: CommentTarget, id: string): Comment[] {
  return db.comments
    .filter((c) => c[column(target)] === id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}

function targetOf(comment: Comment): [CommentTarget, string] {
  for (const target of ['task', 'question', 'decision', 'event', 'appointment', 'partner'] as const) {
    const id = comment[column(target)];
    if (id) return [target, id];
  }
  throw notFound('Diesen Kommentar');
}

function openEntity(ctx: Ctx, target: CommentTarget, id: string): void {
  const entity = entities(ctx.db, target).find((e) => e.id === id);
  if (!entity) throw notFound('Diesen Eintrag');
  if (entity.archived_at) throw rule('Archivierte Einträge lassen sich nicht kommentieren.');
}

export function addComment(
  ctx: Ctx,
  target: CommentTarget,
  id: string,
  raw: unknown,
): { id: string; now_following: boolean } {
  if (target === 'task') return server.addComment(ctx, id, raw);
  const body = parse(commentBodySchema, raw);
  openEntity(ctx, target, id);
  const now = iso(ctx);
  const comment: Comment = {
    id: crypto.randomUUID(),
    ...server.noCommentTarget(),
    [column(target)]: id,
    author_id: ctx.actor.id,
    body,
    created_at: now,
    updated_at: now,
  };
  ctx.db.comments.push(comment);
  writeHistory(ctx, target, id, 'comment_added', { comment: { old: null, new: comment.id } });
  return { id: comment.id, now_following: false };
}

export function updateComment(ctx: Ctx, commentId: string, raw: unknown): void {
  const comment = ctx.db.comments.find((c) => c.id === commentId);
  if (!comment) throw notFound('Diesen Kommentar');
  const [target, id] = targetOf(comment);
  if (target === 'task') return server.updateComment(ctx, commentId, raw);
  const body = parse(commentBodySchema, raw);
  if (comment.author_id !== ctx.actor.id)
    throw new AppError('forbidden', 'Nur eigene Kommentare lassen sich bearbeiten.');
  openEntity(ctx, target, id);
  if (body === comment.body) return;
  // Text alt → neu (3.10)
  const previous = comment.body;
  comment.body = body;
  comment.updated_at = iso(ctx);
  writeHistory(ctx, target, id, 'comment_edited', {
    comment: { old: comment.id, new: comment.id },
    body: { old: previous, new: body },
  });
}

/** Verlauf eines Artefakts, neuester zuerst; bei gleichem Zeitpunkt zählt die Reihenfolge des Eintragens */
export function historyOf(db: Db, type: HistoryEntityType, id: string): HistoryEntry[] {
  return db.history
    .map((h, index) => ({ h, index }))
    .filter(({ h }) => h.entity_type === type && h.entity_id === id)
    .sort((a, b) => b.h.created_at.localeCompare(a.h.created_at) || b.index - a.index)
    .map(({ h }) => h);
}
