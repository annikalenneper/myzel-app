// Phase 3: Wissen – Entscheidungen und Fakten, Konsens, offene Fragen, Dokumente, „auf die Agenda“, Suche
// (ANFORDERUNGEN 3.7 bis 3.9, 4.4, 4.5, 5.5, 5.6, 16.4). Wie die Testdaten-Schicht (src/data/mock/knowledge.ts).
import type { Kysely } from 'kysely';
import type { z } from 'zod';
import type {
  DecisionDetail,
  DecisionListItem,
  DocumentListItem,
  QuestionDetail,
  QuestionListItem,
  SearchGroup,
  SearchGroupKey,
  Undoable,
} from '../../src/data/api';
import { AppError } from '../../src/shared/errors';
import { formatDayMonth } from '../../src/shared/format';
import { EVENT_STATUS_LABEL, PRIORITY_LABEL, TASK_STATUS_LABEL } from '../../src/shared/labels';
import { APPOINTMENT_STATUS_LABEL, FORMAT_LABEL } from '../../src/shared/rules/appointments';
import { driveFileIdFromUrl } from '../../src/shared/rules/drive';
import { berlinDate } from '../../src/shared/rules/due';
import { consensusInviteMessages } from '../../src/shared/rules/notifications';
import {
  canSupersede,
  consensusReached,
  consensusUntilProblem,
  countVotes,
  DECISION_KIND_LABEL,
  DECISION_STATUS_LABEL,
  decisionActive,
  defaultConsensusUntil,
  DOC_TYPE_LABEL,
  initialDecisionStatus,
  MARK_REASON_LABEL,
  QUESTION_STATUS_LABEL,
  sortQuestions,
} from '../../src/shared/rules/knowledge';
import {
  decisionCreateSchema,
  decisionUpdateSchema,
  decisionReplaceSchema,
  decisionVoteKindSchema,
  markReasonSchema,
  documentCreateSchema,
  questionClarifySchema,
  questionCreateSchema,
  questionUpdateSchema,
  type DocumentLinkTarget,
  type HistoryChanges,
} from '../../src/shared/schema';
import {
  checkVersion,
  iso,
  notFound,
  parse,
  registerUndo,
  rule,
  updatedOne,
  writeHistory,
  type Ctx,
  type HistoryEntity,
  type Db,
} from '../core/context';
import { addMark, dropMark, isMarked } from '../core/marks';
import type { Database, DecisionRow, DocumentRow, MemberRow, QuestionRow } from '../db/types';
import { commentsOf } from '../p1/comments';
import { historyOf } from '../p1/reads';
import { notify } from '../p2/notify';
import { documentForFile, missingDriveDocuments, visibleDriveFile, type DriveIndex } from '../p5/drive';
import { isPlenum } from './appointments';

const dayText = (isoDate: string) => {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return `${formatDayMonth(new Date(y, m - 1, d))}${y}`;
};

export async function touch<T extends { id: string; version: number }>(
  ctx: Ctx,
  table: 'decisions' | 'questions' | 'documents',
  entity: HistoryEntity,
  row: T,
  set: Partial<T>,
): Promise<void> {
  const result = await ctx.trx
    .updateTable(table)
    .set({ ...set, version: row.version + 1, updated_at: iso(ctx) } as never)
    .where('id', '=', row.id)
    .where('version', '=', row.version)
    .executeTakeFirst();
  await updatedOne(ctx, result, entity, row);
  Object.assign(row, set, { version: row.version + 1 });
}

// ── Entscheidungen und Fakten ───────────────────────────────────────────────

async function findDecision(trx: Db, id: string, lock = true): Promise<DecisionRow> {
  const decision = await trx
    .selectFrom('decisions')
    .selectAll()
    .where('id', '=', id)
    .$if(lock, (q) => q.forUpdate())
    .executeTakeFirst();
  if (!decision) throw notFound('Diesen Eintrag');
  return decision;
}

/** aktive Mitglieder, die abstimmen (16.4) – ohne „Myzel (automatisch)“ */
const activeMemberIds = async (trx: Db) =>
  (
    await trx
      .selectFrom('members')
      .select('id')
      .where('active', '=', true)
      .where('is_system', '=', false)
      .execute()
  ).map((m) => m.id);

async function votesOf(trx: Db, decisionIds: string[]) {
  if (decisionIds.length === 0) return [];
  return trx
    .selectFrom('decision_votes')
    .selectAll()
    .where('decision_id', 'in', decisionIds)
    .orderBy('voted_at', 'desc')
    .execute();
}

async function decisionItems(trx: Db, rows: DecisionRow[], actorId: string): Promise<DecisionListItem[]> {
  if (rows.length === 0) return [];
  const voted = rows.filter((d) => d.consensus_until).map((d) => d.id);
  const plenumIds = rows.flatMap((d) => (d.source_plenum_id ? [d.source_plenum_id] : []));
  const docIds = rows.flatMap((d) => (d.source_document_id ? [d.source_document_id] : []));
  const successorIds = rows.flatMap((d) => (d.superseded_by_id ? [d.superseded_by_id] : []));
  const questionIds = rows.flatMap((d) => (d.source_question_id ? [d.source_question_id] : []));
  const [plenums, docs, successors, marks, questions, votes, activeIds] = await Promise.all([
    plenumIds.length
      ? trx.selectFrom('appointments').select(['id', 'starts_at']).where('id', 'in', plenumIds).execute()
      : [],
    docIds.length
      ? trx.selectFrom('documents').select(['id', 'title']).where('id', 'in', docIds).execute()
      : [],
    successorIds.length
      ? trx.selectFrom('decisions').select(['id', 'title']).where('id', 'in', successorIds).execute()
      : [],
    trx
      .selectFrom('plenum_marks')
      .select(['decision_id', 'reason'])
      .where(
        'decision_id',
        'in',
        rows.map((d) => d.id),
      )
      .execute(),
    questionIds.length
      ? trx.selectFrom('questions').select(['id', 'title']).where('id', 'in', questionIds).execute()
      : [],
    votesOf(trx, voted),
    voted.length ? activeMemberIds(trx) : [],
  ]);
  return rows.map((d) => {
    const own = votes.filter((v) => v.decision_id === d.id);
    // „Plenum 10.09.2026“, Titel des Dokuments oder „Notiz“
    const parts: string[] = [];
    const plenum = plenums.find((p) => p.id === d.source_plenum_id);
    if (plenum) parts.push(`Plenum ${dayText(berlinDate(new Date(plenum.starts_at)))}`);
    const doc = docs.find((x) => x.id === d.source_document_id);
    if (doc) parts.push(doc.title);
    if (d.source_note && parts.length === 0) parts.push('Notiz');
    return {
      ...d,
      source_label: parts.join(' · '),
      superseded_by_title: successors.find((s) => s.id === d.superseded_by_id)?.title ?? null,
      marked: marks.some((m) => m.decision_id === d.id),
      mark_reason: marks.find((m) => m.decision_id === d.id)?.reason ?? null,
      source_question: questions.find((q) => q.id === d.source_question_id) ?? null,
      consensus: d.consensus_until
        ? {
            ...countVotes(own, activeIds),
            my_vote: own.find((v) => v.member_id === actorId)?.vote ?? null,
          }
        : null,
    };
  });
}

export async function listDecisions(trx: Db, actorId: string): Promise<DecisionListItem[]> {
  const rows = await trx
    .selectFrom('decisions')
    .selectAll()
    .where('archived_at', 'is', null)
    .orderBy('decided_on', 'desc')
    .orderBy('created_at', 'desc')
    .execute();
  return decisionItems(trx, rows, actorId);
}

export async function getDecision(trx: Db, id: string, actorId: string): Promise<DecisionDetail> {
  const d = await findDecision(trx, id, false);
  const [[item], plenum, doc, replaces, documents, comments, history, votes, activeIds] = await Promise.all([
    decisionItems(trx, [d], actorId),
    d.source_plenum_id
      ? trx
          .selectFrom('appointments')
          .select(['id', 'title', 'starts_at'])
          .where('id', '=', d.source_plenum_id)
          .executeTakeFirst()
      : undefined,
    d.source_document_id
      ? trx
          .selectFrom('documents')
          .select(['id', 'title', 'url'])
          .where('id', '=', d.source_document_id)
          .executeTakeFirst()
      : undefined,
    trx.selectFrom('decisions').select(['id', 'title']).where('superseded_by_id', '=', id).execute(),
    linkedDocuments(trx, 'decision', id),
    commentsOf(trx, 'decision', id),
    historyOf(trx, 'decision', id),
    d.consensus_until ? votesOf(trx, [id]) : [],
    d.consensus_until ? activeMemberIds(trx) : [],
  ]);
  const active = new Set(activeIds);
  return {
    ...item!,
    source_plenum: plenum ?? null,
    source_document: doc ?? null,
    replaces,
    votes: votes
      .filter((v) => active.has(v.member_id))
      .map(({ member_id, vote, voted_at }) => ({ member_id, vote, voted_at })),
    // wer noch nicht abgestimmt hat – nur, solange abgestimmt wird
    pending_ids: d.status === 'offen' ? activeIds.filter((m) => !votes.some((v) => v.member_id === m)) : [],
    documents,
    comments,
    history,
  };
}

interface Sources {
  source_plenum_id: string | null;
  source_document_id: string | null;
  source_note: string | null;
}

async function checkEvent(ctx: Ctx, eventId: string | null): Promise<void> {
  if (!eventId) return;
  const event = await ctx.trx
    .selectFrom('events')
    .select('id')
    .where('id', '=', eventId)
    .where('archived_at', 'is', null)
    .executeTakeFirst();
  if (!event)
    throw new AppError('validation', 'Diese Veranstaltung gibt es nicht mehr.', { field: 'event_id' });
}

/** Felder alt → neu (3.10): was sich gegenüber der Zeile ändert */
function changed<T extends object, K extends keyof T>(row: T, next: Pick<T, K>): HistoryChanges {
  const changes: HistoryChanges = {};
  for (const key of Object.keys(next) as K[])
    if (row[key] !== next[key]) changes[key as string] = { old: row[key], new: next[key] };
  return changes;
}

/** Mindestens eine Quelle ist Pflicht; ein Plenum als Quelle muss ein Plenum-Termin sein (3.8, 7.2). */
async function checkSources(ctx: Ctx, s: Sources): Promise<void> {
  if (!s.source_plenum_id && !s.source_document_id && !s.source_note)
    throw new AppError('validation', 'Ohne Quelle lässt sich nichts festhalten.', { field: 'source' });
  if (s.source_plenum_id) {
    const a = await ctx.trx
      .selectFrom('appointments')
      .select(['id', 'type_id'])
      .where('id', '=', s.source_plenum_id)
      .executeTakeFirst();
    if (!a || !(await isPlenum(ctx.trx, a)))
      throw new AppError('validation', 'Als Quelle geht nur ein Plenum.', { field: 'source' });
  }
  if (s.source_document_id) {
    const doc = await ctx.trx
      .selectFrom('documents')
      .select('id')
      .where('id', '=', s.source_document_id)
      .where('archived_at', 'is', null)
      .executeTakeFirst();
    if (!doc) throw new AppError('validation', 'Dieses Dokument gibt es nicht mehr.', { field: 'source' });
  }
}

async function checkTopic(ctx: Ctx, topicId: string): Promise<void> {
  const topic = await ctx.trx
    .selectFrom('topics')
    .select('archived_at')
    .where('id', '=', topicId)
    .forShare()
    .executeTakeFirst();
  if (!topic || topic.archived_at)
    throw new AppError('validation', 'Bitte ein aktives Thema wählen.', { field: 'topic_id' });
}

export async function insertDecision(
  ctx: Ctx,
  input: z.output<typeof decisionCreateSchema>,
  action = 'created',
): Promise<DecisionRow> {
  await checkTopic(ctx, input.topic_id);
  await checkSources(ctx, input);
  await checkEvent(ctx, input.event_id);
  const question = input.source_question_id
    ? await findQuestion(ctx.trx, input.source_question_id, false)
    : null;
  if (question?.archived_at)
    throw new AppError('validation', 'Diese Frage gibt es nicht mehr.', { field: 'source_question_id' });
  const consensusUntil = consensusFor(ctx, input.kind, input.consensus_until);
  const now = iso(ctx);
  const decision = await ctx.trx
    .insertInto('decisions')
    .values({
      status: initialDecisionStatus(input.kind),
      consensus_until: consensusUntil,
      title: input.title,
      description: input.description,
      kind: input.kind,
      topic_id: input.topic_id,
      decided_on: input.decided_on ?? berlinDate(ctx.now),
      superseded_by_id: null,
      source_plenum_id: input.source_plenum_id,
      source_document_id: input.source_document_id,
      source_note: input.source_note,
      source_question_id: input.source_question_id,
      event_id: input.event_id,
      archived_at: null,
      created_at: now,
      updated_at: now,
      created_by: ctx.actor.id,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  ctx.inverse.push({ kind: 'decision_delete', decision_id: decision.id });
  await writeHistory(ctx, 'decision', decision.id, action, {
    title: { old: null, new: decision.title },
    ...(decision.source_plenum_id ? { source_plenum_id: { old: null, new: decision.source_plenum_id } } : {}),
    ...(question ? { source_question_id: { old: null, new: question.id } } : {}),
    ...(consensusUntil ? { consensus_until: { old: null, new: consensusUntil } } : {}),
  });
  // alle anderen erfahren, dass sie bestätigen oder widersprechen können (F3)
  if (consensusUntil)
    await notify(
      ctx,
      consensusInviteMessages(
        { id: decision.id, title: decision.title, consensus_until: consensusUntil },
        await activeMemberIds(ctx.trx),
        ctx.actor.id,
      ),
      `„${decision.title}“ zur Bestätigung festgehalten`,
    );
  // die Frage bleibt offen – als beantwortet markiert sie die Person selbst (16.3)
  if (question && action === 'created')
    await writeHistory(ctx, 'question', question.id, 'result_added', {
      decision_id: { old: null, new: decision.id },
      title: { old: null, new: decision.title },
      kind: { old: null, new: decision.kind },
    });
  return decision;
}

/** Frist einer neuen Entscheidung (16.4): ohne Angabe 7 Tage, nicht in der Vergangenheit; Fakten haben keine */
function consensusFor(ctx: Ctx, kind: DecisionRow['kind'], until: string | null): string | null {
  if (kind !== 'entscheidung') return null;
  const today = berlinDate(ctx.now);
  if (!until) return defaultConsensusUntil(today);
  const problem = consensusUntilProblem(until, today);
  if (problem) throw new AppError('validation', problem, { field: 'consensus_until' });
  return until;
}

/** WF-WIS-01 */
export async function createDecision(ctx: Ctx, raw: unknown): Promise<{ id: string }> {
  const decision = await insertDecision(ctx, parse(decisionCreateSchema, raw));
  ctx.inverse.length = 0;
  return { id: decision.id };
}

/** WF-WIS-12: Titel, Text, Thema, Veranstaltung korrigieren – Inhaltliches ändert „Ersetzen“ */
export async function updateDecision(ctx: Ctx, id: string, raw: unknown): Promise<void> {
  const input = parse(decisionUpdateSchema, raw);
  const d = await findDecision(ctx.trx, id);
  await checkVersion(ctx, 'decision', d, input.version);
  if (!decisionActive(d.status)) throw rule('Nur gültige oder offene Einträge lassen sich bearbeiten.');
  if (input.topic_id !== d.topic_id) await checkTopic(ctx, input.topic_id);
  if (input.event_id !== d.event_id) await checkEvent(ctx, input.event_id);
  const { title, description, topic_id, event_id } = input;
  const changes = changed(d, { title, description, topic_id, event_id });
  if (Object.keys(changes).length === 0) return;
  await touch(ctx, 'decisions', 'decision', d, { title, description, topic_id, event_id });
  await writeHistory(ctx, 'decision', id, 'updated', changes);
}

const decisionState = (d: DecisionRow) =>
  ({
    kind: 'decision_state',
    decision_id: d.id,
    status: d.status,
    superseded_by_id: d.superseded_by_id,
  }) as const;

/** WF-WIS-02 / WF-PLE-13: ersetzen – Nachfolgerin neu anlegen oder wählen, in einer Transaktion */
export async function replaceDecision(
  ctx: Ctx,
  id: string,
  raw: unknown,
): Promise<Undoable & { successor_id: string }> {
  const input = parse(decisionReplaceSchema, raw);
  const old = await findDecision(ctx.trx, id);
  await checkVersion(ctx, 'decision', old, input.version);
  if (!decisionActive(old.status)) throw rule('Nur gültige oder offene Einträge lassen sich ersetzen.');
  let successor: DecisionRow;
  if (input.successor_id) {
    successor = await findDecision(ctx.trx, input.successor_id);
    const all = await ctx.trx.selectFrom('decisions').select(['id', 'status', 'superseded_by_id']).execute();
    const problem = canSupersede(all, old.id, successor.id);
    if (problem) throw new AppError('validation', problem, { field: 'successor_id' });
  } else {
    if (!input.title) throw new AppError('validation', 'Bitte einen Titel eingeben.', { field: 'title' });
    successor = await insertDecision(
      ctx,
      {
        title: input.title,
        description: input.description,
        kind: old.kind,
        topic_id: old.topic_id,
        decided_on: null,
        consensus_until: input.consensus_until,
        source_plenum_id: input.source_plenum_id,
        source_document_id: input.source_document_id,
        source_note: input.source_note,
        // die neue Fassung gehört weiter zur selben Frage und Veranstaltung
        source_question_id: old.source_question_id,
        event_id: old.event_id,
      },
      'created_as_replacement',
    );
  }
  ctx.inverse.push(decisionState(old));
  const changes: HistoryChanges = {
    status: { old: old.status, new: 'ersetzt' },
    superseded_by_id: { old: null, new: successor.id },
  };
  await dropMark(ctx, id);
  await touch(ctx, 'decisions', 'decision', old, { status: 'ersetzt', superseded_by_id: successor.id });
  await writeHistory(ctx, 'decision', id, 'replaced', changes);
  return { ...(await registerUndo(ctx, 'decision', old, 'Ersetzt')), successor_id: successor.id };
}

/** WF-WIS-03 / WF-PLE-14: aufheben, Notiz optional */
export async function revokeDecision(
  ctx: Ctx,
  id: string,
  note: unknown,
  version: number,
): Promise<Undoable> {
  const text = typeof note === 'string' ? note.trim().slice(0, 2000) : '';
  const d = await findDecision(ctx.trx, id);
  await checkVersion(ctx, 'decision', d, version);
  if (!decisionActive(d.status)) throw rule('Nur gültige oder offene Einträge lassen sich aufheben.');
  ctx.inverse.push(decisionState(d));
  const changes: HistoryChanges = { status: { old: d.status, new: 'aufgehoben' } };
  if (text) changes.note = { old: null, new: text };
  await dropMark(ctx, id);
  await touch(ctx, 'decisions', 'decision', d, { status: 'aufgehoben' });
  await writeHistory(ctx, 'decision', id, 'revoked', changes);
  return registerUndo(ctx, 'decision', d, 'Aufgehoben');
}

// ── Entscheidungen im Konsens (16.4) ─────────────────────────────────────────

/**
 * Gültig, wenn alle aktiven Mitglieder bestätigt haben oder die Frist ohne Widerspruch abgelaufen ist. Die Zeile ist
 * gesperrt (findDecision); gleichzeitige Stimmen warten aufeinander.
 */
export async function settle(ctx: Ctx, d: DecisionRow): Promise<boolean> {
  const [votes, activeIds] = await Promise.all([votesOf(ctx.trx, [d.id]), activeMemberIds(ctx.trx)]);
  const count = countVotes(votes, activeIds);
  if (!consensusReached(d, count, berlinDate(ctx.now))) return false;
  ctx.inverse.push(decisionState(d));
  await touch(ctx, 'decisions', 'decision', d, { status: 'gueltig' });
  await writeHistory(ctx, 'decision', d.id, 'consensus_reached', {
    status: { old: 'offen', new: 'gueltig' },
    confirmed: { old: null, new: count.confirmed },
    total: { old: null, new: count.total },
  });
  return true;
}

/** WF-WIS-13: bestätigen oder widersprechen – je Person eine Stimme, änderbar, solange die Entscheidung offen ist */
export async function voteDecision(
  ctx: Ctx,
  id: string,
  raw: unknown,
): Promise<Undoable & { valid: boolean }> {
  const vote = parse(decisionVoteKindSchema, raw);
  const d = await findDecision(ctx.trx, id);
  if (d.archived_at || d.status !== 'offen')
    throw rule('Über diese Entscheidung wird nicht mehr abgestimmt.');
  const before = await ctx.trx
    .selectFrom('decision_votes')
    .selectAll()
    .where('decision_id', '=', id)
    .where('member_id', '=', ctx.actor.id)
    .executeTakeFirst();
  if (before?.vote === vote) return { undo_token: '', valid: false };
  // nach der Frist ohne Widerspruch gilt sie – ein später Widerspruch ändert das nicht mehr (16.4)
  if (vote === 'widerspruch' && d.consensus_until && berlinDate(ctx.now) > d.consensus_until) {
    const votes = await votesOf(ctx.trx, [id]);
    if (countVotes(votes, await activeMemberIds(ctx.trx)).objected === 0)
      throw rule('Die Frist ist ohne Widerspruch abgelaufen – die Entscheidung gilt.');
  }
  await ctx.trx
    .insertInto('decision_votes')
    .values({ decision_id: id, member_id: ctx.actor.id, vote, voted_at: iso(ctx) })
    .onConflict((oc) => oc.columns(['decision_id', 'member_id']).doUpdateSet({ vote, voted_at: iso(ctx) }))
    .execute();
  ctx.inverse.push({ kind: 'vote_restore', decision_id: id, member_id: ctx.actor.id, row: before ?? null });
  await writeHistory(ctx, 'decision', id, 'voted', { vote: { old: before?.vote ?? null, new: vote } });
  // ein Widerspruch hält sie offen und setzt sie auf die Agenda
  if (vote === 'widerspruch' && !(await isMarked(ctx.trx, id))) await addMark(ctx, id, 'aktion');
  const valid = await settle(ctx, d);
  const label = vote === 'bestaetigt' ? 'Bestätigt' : 'Widersprochen';
  return { ...(await registerUndo(ctx, 'decision', d, label)), valid };
}

/**
 * Joblauf (16.4): offene Entscheidungen, deren Frist ohne Widerspruch abgelaufen ist oder die alle aktiven Mitglieder
 * bestätigt haben (z. B. nach einer Deaktivierung), werden gültig – als „Myzel (automatisch)“, je Eintrag eine
 * Transaktion. Erst wird ohne Transaktion geprüft, damit ein Lauf ohne Arbeit nur wenige Abfragen kostet.
 */
export async function settleOpenDecisions(db: Kysely<Database>, now: Date): Promise<number> {
  const open = await db
    .selectFrom('decisions')
    .selectAll()
    .where('status', '=', 'offen')
    .where('archived_at', 'is', null)
    .execute();
  if (open.length === 0) return 0;
  const [votes, activeIds] = await Promise.all([
    votesOf(
      db,
      open.map((d) => d.id),
    ),
    activeMemberIds(db),
  ]);
  const today = berlinDate(now);
  const due = open.filter((d) =>
    consensusReached(
      d,
      countVotes(
        votes.filter((v) => v.decision_id === d.id),
        activeIds,
      ),
      today,
    ),
  );
  if (due.length === 0) return 0;
  const actor: MemberRow = await db
    .selectFrom('members')
    .selectAll()
    .where('is_system', '=', true)
    .executeTakeFirstOrThrow();
  let settled = 0;
  for (const candidate of due)
    await db.transaction().execute(async (trx) => {
      const ctx: Ctx = { trx, actor, now, inverse: [], historyIds: [], outbox: [], plenumId: null };
      // inzwischen geändert (Stimme, Ersetzen): settle prüft den gesperrten, aktuellen Stand
      const d = await findDecision(trx, candidate.id);
      if (d.status === 'offen' && !d.archived_at && (await settle(ctx, d))) settled += 1;
    });
  return settled;
}

// ── Offene Fragen ───────────────────────────────────────────────────────────

const NO_ANSWER =
  'Ohne Antwort oder festgehaltenes Ergebnis lässt sich die Frage nicht als beantwortet markieren.';

async function findQuestion(trx: Db, id: string, lock = true): Promise<QuestionRow> {
  const question = await trx
    .selectFrom('questions')
    .selectAll()
    .where('id', '=', id)
    .$if(lock, (q) => q.forUpdate())
    .executeTakeFirst();
  if (!question) throw notFound('Diese Frage');
  return question;
}

async function questionItems(trx: Db, rows: QuestionRow[]): Promise<QuestionListItem[]> {
  if (rows.length === 0) return [];
  const results = await trx
    .selectFrom('decisions')
    .select(['id', 'title', 'kind', 'status', 'source_question_id'])
    .where(
      'source_question_id',
      'in',
      rows.map((q) => q.id),
    )
    .where('archived_at', 'is', null)
    .orderBy('created_at')
    .orderBy('title')
    .execute();
  return rows.map((q) => ({
    ...q,
    results: results
      .filter((d) => d.source_question_id === q.id)
      .map((d) => ({ id: d.id, title: d.title, kind: d.kind, status: d.status })),
  }));
}

export async function listQuestions(trx: Db): Promise<QuestionListItem[]> {
  const rows = await trx.selectFrom('questions').selectAll().where('archived_at', 'is', null).execute();
  return questionItems(trx, sortQuestions(rows));
}

export async function getQuestion(trx: Db, id: string): Promise<QuestionDetail> {
  const q = await findQuestion(trx, id, false);
  const [[item], comments, history] = await Promise.all([
    questionItems(trx, [q]),
    commentsOf(trx, 'question', id),
    historyOf(trx, 'question', id),
  ]);
  return { ...item!, comments, history };
}

/** WF-FRA-01 */
export async function createQuestion(ctx: Ctx, raw: unknown): Promise<{ id: string }> {
  const input = parse(questionCreateSchema, raw);
  await checkTopic(ctx, input.topic_id);
  if (input.event_id) {
    const event = await ctx.trx
      .selectFrom('events')
      .select('id')
      .where('id', '=', input.event_id)
      .where('archived_at', 'is', null)
      .executeTakeFirst();
    if (!event)
      throw new AppError('validation', 'Diese Veranstaltung gibt es nicht mehr.', { field: 'event_id' });
  }
  const now = iso(ctx);
  const question = await ctx.trx
    .insertInto('questions')
    .values({
      title: input.title,
      description: input.description,
      topic_id: input.topic_id,
      event_id: input.event_id,
      urgency: input.urgency,
      raised_by: ctx.actor.id,
      answer: null,
      answered_in_plenum_id: null,
      archived_at: null,
      created_at: now,
      updated_at: now,
      created_by: ctx.actor.id,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const changes: HistoryChanges = { title: { old: null, new: input.title } };
  await writeHistory(ctx, 'question', question.id, 'created', changes);
  ctx.inverse.length = 0;
  return { id: question.id };
}

/** WF-FRA-06: Frage bearbeiten – Titel, Beschreibung, Thema, Veranstaltung, Dringlichkeit */
export async function updateQuestion(ctx: Ctx, id: string, raw: unknown): Promise<void> {
  const input = parse(questionUpdateSchema, raw);
  const q = await findQuestion(ctx.trx, id);
  await checkVersion(ctx, 'question', q, input.version);
  if (q.archived_at) throw rule('Archivierte Fragen lassen sich nicht bearbeiten.');
  if (input.topic_id !== q.topic_id) await checkTopic(ctx, input.topic_id);
  if (input.event_id !== q.event_id) await checkEvent(ctx, input.event_id);
  const { title, description, topic_id, event_id, urgency } = input;
  const changes = changed(q, { title, description, topic_id, event_id, urgency });
  if (Object.keys(changes).length === 0) return;
  await touch(ctx, 'questions', 'question', q, { title, description, topic_id, event_id, urgency });
  await writeHistory(ctx, 'question', id, 'updated', changes);
}

const questionState = (q: QuestionRow) =>
  ({
    kind: 'question_state',
    question_id: q.id,
    status: q.status,
    answer: q.answer,
    answered_in_plenum_id: q.answered_in_plenum_id,
  }) as const;

/**
 * WF-FRA-02 „Als beantwortet markieren“ (16.3): schließt die Frage auf Wunsch. Antwort Pflicht, solange noch kein
 * Ergebnis aus ihr festgehalten ist. Im laufenden Plenum wird es zur Stelle, an der die Frage beantwortet wurde.
 */
export async function clarifyQuestion(ctx: Ctx, id: string, raw: unknown): Promise<Undoable> {
  const input = parse(questionClarifySchema, raw);
  const q = await findQuestion(ctx.trx, id);
  await checkVersion(ctx, 'question', q, input.version);
  if (q.status !== 'offen') throw rule('Diese Frage ist nicht mehr offen.');
  if (!input.answer) {
    const result = await ctx.trx
      .selectFrom('decisions')
      .select('id')
      .where('source_question_id', '=', id)
      .where('archived_at', 'is', null)
      .executeTakeFirst();
    if (!result) throw new AppError('validation', NO_ANSWER, { field: 'answer' });
  }
  ctx.inverse.push(questionState(q));
  const changes: HistoryChanges = { status: { old: q.status, new: 'geklaert' } };
  if (input.answer) changes.answer = { old: null, new: input.answer };
  await touch(ctx, 'questions', 'question', q, {
    status: 'geklaert',
    answer: input.answer,
    answered_in_plenum_id: ctx.plenumId,
  });
  await writeHistory(ctx, 'question', id, 'clarified', changes);
  return registerUndo(ctx, 'question', q, 'Als beantwortet markiert');
}

/** WF-FRA-03 */
export async function discardQuestion(ctx: Ctx, id: string, version: number): Promise<Undoable> {
  const q = await findQuestion(ctx.trx, id);
  await checkVersion(ctx, 'question', q, version);
  if (q.status !== 'offen') throw rule('Diese Frage ist nicht mehr offen.');
  ctx.inverse.push(questionState(q));
  const changes: HistoryChanges = { status: { old: q.status, new: 'verworfen' } };
  await touch(ctx, 'questions', 'question', q, { status: 'verworfen' });
  await writeHistory(ctx, 'question', id, 'discarded', changes);
  return registerUndo(ctx, 'question', q, 'Frage verworfen');
}

/** WF-FRA-04: geklärte oder verworfene Frage wieder öffnen – die Antwort bleibt in der Historie, Ergebnisse bleiben */
export async function reopenQuestion(ctx: Ctx, id: string, version: number): Promise<Undoable> {
  const q = await findQuestion(ctx.trx, id);
  await checkVersion(ctx, 'question', q, version);
  if (q.status === 'offen') throw rule('Diese Frage ist schon offen.');
  ctx.inverse.push(questionState(q));
  const changes: HistoryChanges = { status: { old: q.status, new: 'offen' } };
  if (q.answer) changes.answer = { old: q.answer, new: null };
  await touch(ctx, 'questions', 'question', q, {
    status: 'offen',
    answer: null,
    answered_in_plenum_id: null,
  });
  await writeHistory(ctx, 'question', id, 'reopened', changes);
  return registerUndo(ctx, 'question', q, 'Wieder geöffnet');
}

// ── Dokumente ───────────────────────────────────────────────────────────────

async function findDocument(trx: Db, id: string): Promise<DocumentRow> {
  const document = await trx.selectFrom('documents').selectAll().where('id', '=', id).executeTakeFirst();
  if (!document) throw notFound('Dieses Dokument');
  return document;
}

const TARGET_NOUN: Record<DocumentLinkTarget, [one: string, many: string]> = {
  task: ['Aufgabe', 'Aufgaben'],
  event: ['Veranstaltung', 'Veranstaltungen'],
  appointment: ['Termin', 'Termine'],
  decision: ['Entscheidung', 'Entscheidungen'],
};

/** driveIndex: schon geladener Drive-Cache (aus dem Verzeichnis) – sonst lädt ihn der Hinweis „nicht mehr vorhanden“ */
export async function documentItems(
  trx: Db,
  rows: DocumentRow[],
  driveIndex?: DriveIndex,
): Promise<DocumentListItem[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((d) => d.id);
  const [links, protocols, sources, missing] = await Promise.all([
    trx.selectFrom('document_links').selectAll().where('document_id', 'in', ids).execute(),
    trx
      .selectFrom('appointments')
      .select('protocol_document_id')
      .where('protocol_document_id', 'in', ids)
      .execute(),
    trx.selectFrom('decisions').select('source_document_id').where('source_document_id', 'in', ids).execute(),
    // [P5] verknüpfte Dateien, die in Drive verschwunden sind (3.13)
    missingDriveDocuments(trx, rows, driveIndex),
  ]);
  return rows.map((d) => {
    const own = links.filter((l) => l.document_id === d.id);
    const protocolCount = protocols.filter((p) => p.protocol_document_id === d.id).length;
    const sourceCount = sources.filter((s) => s.source_document_id === d.id).length;
    const total = own.length + protocolCount + sourceCount;
    let summary: string;
    if (total === 0) summary = 'nicht verknüpft';
    else if (total === 1) {
      const only = own[0];
      summary = only
        ? `1 ${TARGET_NOUN[only.target_type][0]}`
        : protocolCount
          ? '1 Plenum'
          : '1 Entscheidung';
    } else summary = `${total} verknüpft`;
    return {
      ...d,
      link_count: total,
      link_summary: summary,
      drive_missing: missing.has(d.id),
    };
  });
}

export async function listDocuments(trx: Db): Promise<DocumentListItem[]> {
  const rows = await trx.selectFrom('documents').selectAll().where('archived_at', 'is', null).execute();
  rows.sort((a, b) => a.title.localeCompare(b.title, 'de'));
  return documentItems(trx, rows);
}

export async function linkedDocuments(
  trx: Db,
  target: DocumentLinkTarget,
  id: string,
): Promise<DocumentListItem[]> {
  const rows = await trx
    .selectFrom('documents as d')
    .innerJoin('document_links as l', 'l.document_id', 'd.id')
    .selectAll('d')
    .where('l.target_type', '=', target)
    .where('l.target_id', '=', id)
    .where('d.archived_at', 'is', null)
    .orderBy('d.created_at')
    .execute();
  return documentItems(trx, rows);
}

const TARGET_TABLE = {
  task: 'tasks',
  event: 'events',
  appointment: 'appointments',
  decision: 'decisions',
} as const;

async function targetExists(trx: Db, type: DocumentLinkTarget, id: string): Promise<boolean> {
  const table = TARGET_TABLE[type];
  if (!table) return false;
  return !!(await trx
    .selectFrom(table)
    .select('id')
    .where('id', '=', id)
    .where('archived_at', 'is', null)
    .forShare()
    .executeTakeFirst());
}

/** WF-AUF-13 / WF-WIS-06: Verknüpfung einzeln hinzufügen */
export async function linkDocument(ctx: Ctx, documentId: string, type: DocumentLinkTarget, targetId: string) {
  const document = await findDocument(ctx.trx, documentId);
  if (document.archived_at) throw rule('Archivierte Dokumente lassen sich nicht verknüpfen.');
  if (!Object.hasOwn(TARGET_TABLE, type) || !(await targetExists(ctx.trx, type, targetId)))
    throw notFound('Das Ziel der Verknüpfung');
  const inserted = await ctx.trx
    .insertInto('document_links')
    .values({ document_id: documentId, target_type: type, target_id: targetId })
    .onConflict((oc) => oc.doNothing())
    .executeTakeFirst();
  if (Number(inserted.numInsertedOrUpdatedRows ?? 0) === 0) return;
  await writeHistory(ctx, type, targetId, 'document_linked', {
    document: { old: null, new: document.title },
  });
}

export async function unlinkDocument(
  ctx: Ctx,
  documentId: string,
  type: DocumentLinkTarget,
  targetId: string,
) {
  const document = await findDocument(ctx.trx, documentId);
  if (!Object.hasOwn(TARGET_TABLE, type)) throw notFound('Das Ziel der Verknüpfung');
  const removed = await ctx.trx
    .deleteFrom('document_links')
    .where('document_id', '=', documentId)
    .where('target_type', '=', type)
    .where('target_id', '=', targetId)
    .executeTakeFirst();
  if (Number(removed.numDeletedRows) > 0)
    await writeHistory(ctx, type, targetId, 'document_unlinked', {
      document: { old: document.title, new: null },
    });
}

/** WF-WIS-06: Dokument per Link erfassen und – wenn gewünscht – gleich verknüpfen */
export async function createDocument(ctx: Ctx, raw: unknown): Promise<{ id: string; created: boolean }> {
  const input = parse(documentCreateSchema, raw);
  if (input.topic_id) await checkTopic(ctx, input.topic_id);
  // Link auf eine Datei aus dem Vereins-Drive: ein Eintrag je Datei (F-WIS-06)
  // – auch wenn der Cache die Datei gerade nicht kennt (neu oder verschoben)
  const fileId = driveFileIdFromUrl(input.url);
  const existing = fileId ? await documentForFile(ctx.trx, fileId) : undefined;
  if (existing) {
    if (input.link) await linkDocument(ctx, existing.id, input.link.target_type, input.link.target_id);
    return { id: existing.id, created: false };
  }
  const now = iso(ctx);
  const document = await ctx.trx
    .insertInto('documents')
    .values({
      title: input.title,
      url: input.url,
      drive_file_id: await visibleDriveFile(ctx.trx, input.url),
      doc_type: input.doc_type,
      topic_id: input.topic_id,
      tags: JSON.stringify([...new Set(input.tags)]),
      description: null,
      archived_at: null,
      created_at: now,
      updated_at: now,
      created_by: ctx.actor.id,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await writeHistory(ctx, 'document', document.id, 'created', { title: { old: null, new: input.title } });
  if (input.link) await linkDocument(ctx, document.id, input.link.target_type, input.link.target_id);
  return { id: document.id, created: true };
}

// ── Entscheidung oder Fakt auf die Agenda (16.1): „Stimmt das noch?“ oder „Aktion erforderlich“ (Phase 12) ──

export async function setDecisionAgenda(
  ctx: Ctx,
  id: string,
  onAgenda: boolean,
  rawReason: unknown = 'stimmt_noch',
): Promise<Undoable> {
  const reason = parse(markReasonSchema, rawReason);
  const d = await findDecision(ctx.trx, id);
  const mark = await ctx.trx
    .selectFrom('plenum_marks')
    .select('reason')
    .where('decision_id', '=', id)
    .executeTakeFirst();
  if (!onAgenda) {
    if (!mark) return { undo_token: '' };
    await dropMark(ctx, id);
    return registerUndo(ctx, 'decision', d, 'Von der Agenda genommen');
  }
  if (mark?.reason === reason) return { undo_token: '' };
  if (d.archived_at || !decisionActive(d.status))
    throw rule('Nur gültige oder offene Einträge lassen sich auf die Agenda setzen.');
  // anderer Grund: neu aufsetzen (der alte Eintrag kommt mit Rückgängig zurück)
  if (mark) await dropMark(ctx, id);
  await addMark(ctx, id, reason);
  // Rückgängig arbeitet die Gegenschritte der Reihe nach ab: erst die neue Markierung weg, dann die alte zurück
  if (mark) ctx.inverse.push(...ctx.inverse.splice(-2, 2).reverse());
  return registerUndo(ctx, 'decision', d, `Auf der Agenda: ${MARK_REASON_LABEL[reason]}`);
}

// ── Globale Suche (F-WIS-06): nur App-Daten, gruppiert nach Art ─────────────

export async function search(trx: Db, query: unknown, now: Date): Promise<SearchGroup[]> {
  const q = typeof query === 'string' ? query.trim().toLowerCase().slice(0, 100) : '';
  if (q.length < 2) return [];
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const hit = (...texts: (string | null | undefined)[]) => texts.some((t) => t?.toLowerCase().includes(q));
  const when = (isoTime: string) => formatDayMonth(new Date(isoTime));
  const today = berlinDate(now);
  const [tasks, events, appointments, decisions, questions, documents, partners] = await Promise.all([
    trx
      .selectFrom('tasks')
      .select(['id', 'title', 'description', 'status', 'due_date', 'event_id'])
      .where('archived_at', 'is', null)
      .where((eb) => eb.or([eb('title', 'ilike', like), eb('description', 'ilike', like)]))
      .orderBy('number')
      .execute(),
    trx
      .selectFrom('events')
      .select(['id', 'title', 'description', 'starts_at', 'status'])
      .where('archived_at', 'is', null)
      .orderBy('starts_at')
      .execute(),
    trx
      .selectFrom('appointments')
      .select(['id', 'title', 'location', 'notes', 'starts_at', 'format', 'status'])
      .where('archived_at', 'is', null)
      .where((eb) =>
        eb.or([eb('title', 'ilike', like), eb('location', 'ilike', like), eb('notes', 'ilike', like)]),
      )
      .orderBy('starts_at')
      .execute(),
    trx
      .selectFrom('decisions')
      .select(['id', 'title', 'description', 'kind', 'status'])
      .where('archived_at', 'is', null)
      .where((eb) => eb.or([eb('title', 'ilike', like), eb('description', 'ilike', like)]))
      .orderBy('decided_on', 'desc')
      .execute(),
    trx
      .selectFrom('questions')
      .select(['id', 'title', 'description', 'answer', 'status', 'urgency'])
      .where('archived_at', 'is', null)
      .where((eb) =>
        eb.or([eb('title', 'ilike', like), eb('description', 'ilike', like), eb('answer', 'ilike', like)]),
      )
      .orderBy('created_at')
      .execute(),
    trx.selectFrom('documents').selectAll().where('archived_at', 'is', null).orderBy('title').execute(),
    trx
      .selectFrom('partners')
      .selectAll()
      .where('archived_at', 'is', null)
      .where((eb) =>
        eb.or([
          eb('name', 'ilike', like),
          eb('kind', 'ilike', like),
          eb('description', 'ilike', like),
          eb('contact_person', 'ilike', like),
          eb('notes', 'ilike', like),
        ]),
      )
      .orderBy('name')
      .execute(),
  ]);
  const eventTitle = (id: string | null) => (id ? events.find((e) => e.id === id)?.title : undefined);
  const foundDocs = documents.filter((d) => hit(d.title, d.description, ...(d.tags as string[])));
  const docItems = await documentItems(trx, foundDocs);
  const partnerLinks = partners.length
    ? await trx
        .selectFrom('event_partners')
        .select('partner_id')
        .where(
          'partner_id',
          'in',
          partners.map((p) => p.id),
        )
        .execute()
    : [];
  const groups: [SearchGroupKey, string, SearchGroup['items']][] = [
    [
      'aufgaben',
      'Aufgaben',
      tasks.map((t) => ({
        id: t.id,
        title: t.title,
        meta: [
          TASK_STATUS_LABEL[t.status],
          t.due_date && t.due_date < today && ['neu', 'geplant', 'in_arbeit', 'blockiert'].includes(t.status)
            ? 'überfällig'
            : eventTitle(t.event_id) && `Veranstaltung ${eventTitle(t.event_id)}`,
        ]
          .filter(Boolean)
          .join(' · '),
        link: `/agenda/${t.id}`,
      })),
    ],
    [
      'events',
      'Veranstaltungen',
      events
        .filter((e) => hit(e.title, e.description))
        .map((e) => ({
          id: e.id,
          title: e.title,
          meta: `${when(e.starts_at)} · ${EVENT_STATUS_LABEL[e.status]}`,
          link: `/events/${e.id}`,
        })),
    ],
    [
      'termine',
      'Termine',
      appointments.map((a) => ({
        id: a.id,
        title: a.title,
        meta: `${when(a.starts_at)} · ${FORMAT_LABEL[a.format]} · ${APPOINTMENT_STATUS_LABEL[a.status]}`,
        link: `/termine/${a.id}`,
      })),
    ],
    [
      'beschluesse',
      'Entscheidungen & Fakten',
      decisions.map((d) => ({
        id: d.id,
        title: d.title,
        meta: `${DECISION_KIND_LABEL[d.kind]} · ${DECISION_STATUS_LABEL[d.status]}`,
        link: `/wissen/beschluesse/${d.id}`,
      })),
    ],
    [
      'fragen',
      'Fragen',
      questions.map((x) => ({
        id: x.id,
        title: x.title,
        meta: `${QUESTION_STATUS_LABEL[x.status]} · ${PRIORITY_LABEL[x.urgency]}`,
        link: `/agenda/frage/${x.id}`,
      })),
    ],
    [
      'dokumente',
      'Dokumente',
      docItems.map((d) => ({
        id: d.id,
        title: d.title,
        meta: `${DOC_TYPE_LABEL[d.doc_type]} · ${d.link_summary}`,
        link: d.url,
        external: true,
      })),
    ],
    [
      'partner',
      'Partner',
      partners.map((p) => {
        const count = partnerLinks.filter((ep) => ep.partner_id === p.id).length;
        return {
          id: p.id,
          title: p.name,
          meta: [p.kind, `${count} ${count === 1 ? 'Veranstaltung' : 'Veranstaltungen'}`]
            .filter(Boolean)
            .join(' · '),
          link: `/partner/${p.id}`,
        };
      }),
    ],
  ];
  return groups.map(([key, title, items]) => ({ key, title, items })).filter((g) => g.items.length > 0);
}
