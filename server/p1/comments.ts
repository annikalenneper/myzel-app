// Kommentare an allen Artefakten (ANFORDERUNGEN 16.3) – wie die Testdaten-Schicht (src/data/mock/comments.ts).
// Aufgaben behalten ihre eigenen Regeln (wer kommentiert, folgt; Benachrichtigung) in tasks.ts; alle anderen Arten
// bekommen den Kommentar und einen Eintrag in ihrer Historie. Bearbeiten darf nur, wer ihn geschrieben hat.
import { AppError } from '../../src/shared/errors';
import {
  COMMENT_TARGETS,
  commentBodySchema,
  type Comment,
  type CommentTarget,
} from '../../src/shared/schema';
import { iso, notFound, parse, rule, writeHistory, type Ctx, type Db } from '../core/context';
import * as tasks from './tasks';

const column = <T extends CommentTarget>(target: T) => `${target}_id` as `${T}_id`;
const TABLE = {
  task: 'tasks',
  question: 'questions',
  decision: 'decisions',
  event: 'events',
  appointment: 'appointments',
  partner: 'partners',
} as const;

export const commentTarget = (v: unknown): CommentTarget => {
  if (typeof v !== 'string' || !(COMMENT_TARGETS as readonly string[]).includes(v))
    throw notFound('Das Ziel des Kommentars');
  return v as CommentTarget;
};

/** Kommentare eines Artefakts, ältester zuerst */
export async function commentsOf(trx: Db, target: CommentTarget, id: string): Promise<Comment[]> {
  return trx
    .selectFrom('comments')
    .selectAll()
    .where(column(target), '=', id)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
}

async function openEntity(ctx: Ctx, target: CommentTarget, id: string): Promise<void> {
  // gleichzeitiges Archivieren wartet, bis der Kommentar steht
  const entity = await ctx.trx
    .selectFrom(TABLE[target])
    .select('archived_at')
    .where('id', '=', id)
    .forShare()
    .executeTakeFirst();
  if (!entity) throw notFound('Diesen Eintrag');
  if (entity.archived_at) throw rule('Archivierte Einträge lassen sich nicht kommentieren.');
}

export async function addComment(
  ctx: Ctx,
  target: CommentTarget,
  id: string,
  raw: unknown,
): Promise<{ id: string; now_following: boolean }> {
  if (target === 'task') return tasks.addComment(ctx, id, raw);
  const body = parse(commentBodySchema, raw);
  await openEntity(ctx, target, id);
  const now = iso(ctx);
  const comment = await ctx.trx
    .insertInto('comments')
    .values({ [column(target)]: id, author_id: ctx.actor.id, body, created_at: now, updated_at: now })
    .returning('id')
    .executeTakeFirstOrThrow();
  await writeHistory(ctx, target, id, 'comment_added', { comment: { old: null, new: comment.id } });
  return { id: comment.id, now_following: false };
}

export async function updateComment(ctx: Ctx, commentId: string, raw: unknown): Promise<void> {
  const comment = await ctx.trx
    .selectFrom('comments')
    .selectAll()
    .where('id', '=', commentId)
    .forUpdate()
    .executeTakeFirst();
  if (!comment) throw notFound('Diesen Kommentar');
  const target = COMMENT_TARGETS.find((t) => comment[column(t)]);
  if (!target) throw notFound('Diesen Kommentar');
  if (target === 'task') return tasks.updateComment(ctx, commentId, raw);
  const id = comment[column(target)]!;
  const body = parse(commentBodySchema, raw);
  if (comment.author_id !== ctx.actor.id)
    throw new AppError('forbidden', 'Nur eigene Kommentare lassen sich bearbeiten.');
  await openEntity(ctx, target, id);
  if (body === comment.body) return;
  await ctx.trx
    .updateTable('comments')
    .set({ body, updated_at: iso(ctx) })
    .where('id', '=', commentId)
    .execute();
  await writeHistory(ctx, target, id, 'comment_edited', {
    comment: { old: comment.id, new: comment.id },
    // Text alt → neu (3.10)
    body: { old: comment.body, new: body },
  });
}
