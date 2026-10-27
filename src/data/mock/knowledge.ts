// Testdaten-Schicht, Phase 3: Wissen – Entscheidungen und Fakten, Konsens, offene Fragen, Dokumente, Suche
// (ANFORDERUNGEN 3.7 bis 3.9, 4.4, 4.5, 5.5, 5.6, 16.4)
import { z } from 'zod';
import { AppError } from '../../shared/errors';
import { formatDayMonth } from '../../shared/format';
import { EVENT_STATUS_LABEL, PRIORITY_LABEL, TASK_STATUS_LABEL } from '../../shared/labels';
import { APPOINTMENT_STATUS_LABEL, FORMAT_LABEL } from '../../shared/rules/appointments';
import { driveFileIdFromUrl } from '../../shared/rules/drive';
import { toIsoDate } from '../../shared/rules/due';
import { consensusInviteMessages } from '../../shared/rules/notifications';
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
} from '../../shared/rules/knowledge';
import {
  decisionCreateSchema,
  decisionUpdateSchema,
  decisionReplaceSchema,
  decisionVoteKindSchema,
  markReasonSchema,
  documentCreateSchema,
  DRIVE_FOLDER_MIME,
  questionClarifySchema,
  questionCreateSchema,
  questionUpdateSchema,
  type Decision,
  type DocumentLinkTarget,
  type Member,
  type DocumentRow,
  type HistoryChanges,
  type Question,
} from '../../shared/schema';
import type {
  DecisionDetail,
  DecisionListItem,
  DocumentListItem,
  QuestionDetail,
  QuestionListItem,
  SearchGroup,
  SearchGroupKey,
  Undoable,
} from '../api';
import { isPlenum } from './appointments';
import { commentsOf, historyOf } from './comments';
import { documentFor, driveFileMissing, driveItem } from './drive';
import { notifyAction } from './notify';
import {
  addMark,
  checkVersion,
  dropMark,
  isMarked,
  notFound,
  parse,
  registerUndo,
  rule,
  touch,
  writeHistory,
  type Ctx,
  type Db,
} from './server';

const uuid = () => crypto.randomUUID();
const iso = (ctx: Ctx) => ctx.now.toISOString();
const dayText = (isoDate: string) => {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return `${formatDayMonth(new Date(y, m - 1, d))}${y}`;
};

// ── Entscheidungen und Fakten ───────────────────────────────────────────────

function findDecision(db: Db, id: string): Decision {
  const decision = db.decisions.find((d) => d.id === id);
  if (!decision) throw notFound('Diesen Eintrag');
  return decision;
}

/** „PLENUM 10.09.2026“, Titel des Dokuments oder „NOTIZ“ */
function sourceLabel(db: Db, d: Decision): string {
  const parts: string[] = [];
  const plenum = d.source_plenum_id ? db.appointments.find((a) => a.id === d.source_plenum_id) : undefined;
  if (plenum) parts.push(`Plenum ${dayText(toIsoDate(new Date(plenum.starts_at)))}`);
  const doc = d.source_document_id ? db.documents.find((x) => x.id === d.source_document_id) : undefined;
  if (doc) parts.push(doc.title);
  if (d.source_note && parts.length === 0) parts.push('Notiz');
  return parts.join(' · ');
}

/** aktive Mitglieder, die abstimmen (16.4) – ohne „Myzel (automatisch)“ */
const activeMemberIds = (db: Db) => db.members.filter((m) => m.active && !m.is_system).map((m) => m.id);
/** Stimmen zu einem Eintrag, neueste zuerst */
const votesOf = (db: Db, decisionId: string) =>
  db.decision_votes
    .filter((v) => v.decision_id === decisionId)
    .sort((a, b) => b.voted_at.localeCompare(a.voted_at));

function decisionItem(db: Db, d: Decision, actorId: string): DecisionListItem {
  const votes = d.consensus_until ? votesOf(db, d.id) : [];
  return {
    ...d,
    source_label: sourceLabel(db, d),
    superseded_by_title: d.superseded_by_id
      ? (db.decisions.find((x) => x.id === d.superseded_by_id)?.title ?? null)
      : null,
    marked: isMarked(db, d.id),
    mark_reason: db.plenum_marks.find((m) => m.decision_id === d.id)?.reason ?? null,
    source_question: d.source_question_id
      ? (() => {
          const q = db.questions.find((x) => x.id === d.source_question_id);
          return q ? { id: q.id, title: q.title } : null;
        })()
      : null,
    consensus: d.consensus_until
      ? {
          ...countVotes(votes, activeMemberIds(db)),
          my_vote: votes.find((v) => v.member_id === actorId)?.vote ?? null,
        }
      : null,
  };
}

export function listDecisions(db: Db, actorId: string): DecisionListItem[] {
  return db.decisions
    .filter((d) => !d.archived_at)
    .sort((a, b) => b.decided_on.localeCompare(a.decided_on) || b.created_at.localeCompare(a.created_at))
    .map((d) => decisionItem(db, d, actorId));
}

export function getDecision(db: Db, id: string, actorId: string): DecisionDetail {
  const d = findDecision(db, id);
  const activeIds = d.consensus_until ? activeMemberIds(db) : [];
  const votes = d.consensus_until ? votesOf(db, id) : [];
  const plenum = d.source_plenum_id ? db.appointments.find((a) => a.id === d.source_plenum_id) : undefined;
  const doc = d.source_document_id ? db.documents.find((x) => x.id === d.source_document_id) : undefined;
  return {
    ...decisionItem(db, d, actorId),
    source_plenum: plenum ? { id: plenum.id, title: plenum.title, starts_at: plenum.starts_at } : null,
    source_document: doc ? { id: doc.id, title: doc.title, url: doc.url } : null,
    replaces: db.decisions
      .filter((x) => x.superseded_by_id === id)
      .map((x) => ({ id: x.id, title: x.title })),
    votes: votes
      .filter((v) => activeIds.includes(v.member_id))
      .map(({ member_id, vote, voted_at }) => ({ member_id, vote, voted_at })),
    // wer noch nicht abgestimmt hat – nur, solange abgestimmt wird
    pending_ids: d.status === 'offen' ? activeIds.filter((m) => !votes.some((v) => v.member_id === m)) : [],
    documents: linkedDocuments(db, 'decision', id),
    comments: commentsOf(db, 'decision', id),
    history: historyOf(db, 'decision', id),
  };
}

interface Sources {
  source_plenum_id: string | null;
  source_document_id: string | null;
  source_note: string | null;
}

/** Mindestens eine Quelle ist Pflicht; ein Plenum als Quelle muss ein Plenum-Termin sein (3.8, 7.2). */
function checkSources(ctx: Ctx, s: Sources): void {
  if (!s.source_plenum_id && !s.source_document_id && !s.source_note)
    throw new AppError('validation', 'Ohne Quelle lässt sich nichts festhalten.', { field: 'source' });
  if (s.source_plenum_id) {
    const a = ctx.db.appointments.find((x) => x.id === s.source_plenum_id);
    if (!a || !isPlenum(ctx.db, a))
      throw new AppError('validation', 'Als Quelle geht nur ein Plenum.', { field: 'source' });
  }
  if (s.source_document_id && !ctx.db.documents.some((x) => x.id === s.source_document_id && !x.archived_at))
    throw new AppError('validation', 'Dieses Dokument gibt es nicht mehr.', { field: 'source' });
}

function checkTopic(ctx: Ctx, topicId: string): void {
  const topic = ctx.db.topics.find((t) => t.id === topicId);
  if (!topic || topic.archived_at)
    throw new AppError('validation', 'Bitte ein aktives Thema wählen.', { field: 'topic_id' });
}

export function insertDecision(
  ctx: Ctx,
  input: z.output<typeof decisionCreateSchema>,
  action = 'created',
): Decision {
  checkTopic(ctx, input.topic_id);
  checkSources(ctx, input);
  checkEvent(ctx, input.event_id);
  const question = input.source_question_id ? findQuestion(ctx.db, input.source_question_id) : null;
  if (question?.archived_at)
    throw new AppError('validation', 'Diese Frage gibt es nicht mehr.', { field: 'source_question_id' });
  const consensusUntil = consensusFor(ctx, input.kind, input.consensus_until);
  const now = iso(ctx);
  const decision: Decision = {
    id: uuid(),
    title: input.title,
    description: input.description,
    kind: input.kind,
    topic_id: input.topic_id,
    decided_on: input.decided_on ?? toIsoDate(ctx.now),
    status: initialDecisionStatus(input.kind),
    consensus_until: consensusUntil,
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
    version: 1,
  };
  ctx.db.decisions.push(decision);
  ctx.inverse.push({ kind: 'decision_delete', decision_id: decision.id });
  writeHistory(ctx, 'decision', decision.id, action, {
    title: { old: null, new: decision.title },
    ...(decision.source_plenum_id ? { source_plenum_id: { old: null, new: decision.source_plenum_id } } : {}),
    ...(question ? { source_question_id: { old: null, new: question.id } } : {}),
    ...(consensusUntil ? { consensus_until: { old: null, new: consensusUntil } } : {}),
  });
  // alle anderen erfahren, dass sie bestätigen oder widersprechen können (F3)
  if (consensusUntil)
    notifyAction(
      ctx,
      consensusInviteMessages(
        { id: decision.id, title: decision.title, consensus_until: consensusUntil },
        activeMemberIds(ctx.db),
        ctx.actor.id,
      ),
      `„${decision.title}“ zur Bestätigung festgehalten`,
    );
  // die Frage bleibt offen – als beantwortet markiert sie die Person selbst (16.3)
  if (question && action === 'created')
    writeHistory(ctx, 'question', question.id, 'result_added', {
      decision_id: { old: null, new: decision.id },
      title: { old: null, new: decision.title },
      kind: { old: null, new: decision.kind },
    });
  return decision;
}

/** Frist einer neuen Entscheidung (16.4): ohne Angabe 7 Tage, nicht in der Vergangenheit; Fakten haben keine */
function consensusFor(ctx: Ctx, kind: Decision['kind'], until: string | null): string | null {
  if (kind !== 'entscheidung') return null;
  const today = toIsoDate(ctx.now);
  if (!until) return defaultConsensusUntil(today);
  const problem = consensusUntilProblem(until, today);
  if (problem) throw new AppError('validation', problem, { field: 'consensus_until' });
  return until;
}

/** WF-WIS-01 */
export function createDecision(ctx: Ctx, raw: unknown): { id: string } {
  const decision = insertDecision(ctx, parse(decisionCreateSchema, raw));
  ctx.inverse = [];
  return { id: decision.id };
}

function checkEvent(ctx: Ctx, eventId: string | null): void {
  if (eventId && !ctx.db.events.some((e) => e.id === eventId && !e.archived_at))
    throw new AppError('validation', 'Diese Veranstaltung gibt es nicht mehr.', { field: 'event_id' });
}

/** Felder alt → neu in die Historie (3.10); gibt zurück, ob sich etwas geändert hat */
function applyChanges<T extends object, K extends keyof T>(
  row: T,
  next: Pick<T, K>,
  changes: HistoryChanges,
): boolean {
  for (const key of Object.keys(next) as K[]) {
    if (row[key] === next[key]) continue;
    changes[key as string] = { old: row[key], new: next[key] };
    row[key] = next[key];
  }
  return Object.keys(changes).length > 0;
}

/** WF-WIS-12: Titel, Text, Thema, Veranstaltung korrigieren – Inhaltliches ändert „Ersetzen“ */
export function updateDecision(ctx: Ctx, id: string, raw: unknown): void {
  const input = parse(decisionUpdateSchema, raw);
  const d = findDecision(ctx.db, id);
  checkVersion(ctx, 'decision', d, input.version);
  if (!decisionActive(d.status)) throw rule('Nur gültige oder offene Einträge lassen sich bearbeiten.');
  if (input.topic_id !== d.topic_id) checkTopic(ctx, input.topic_id);
  if (input.event_id !== d.event_id) checkEvent(ctx, input.event_id);
  const changes: HistoryChanges = {};
  const { title, description, topic_id, event_id } = input;
  if (!applyChanges(d, { title, description, topic_id, event_id }, changes)) return;
  touch(ctx, d);
  writeHistory(ctx, 'decision', id, 'updated', changes);
}

const decisionState = (d: Decision) =>
  ({
    kind: 'decision_state',
    decision_id: d.id,
    status: d.status,
    superseded_by_id: d.superseded_by_id,
  }) as const;

/** WF-WIS-02 / WF-PLE-13: ersetzen – Nachfolgerin neu anlegen oder wählen, in einer Transaktion */
export function replaceDecision(ctx: Ctx, id: string, raw: unknown): Undoable & { successor_id: string } {
  const input = parse(decisionReplaceSchema, raw);
  const old = findDecision(ctx.db, id);
  checkVersion(ctx, 'decision', old, input.version);
  if (!decisionActive(old.status)) throw rule('Nur gültige oder offene Einträge lassen sich ersetzen.');
  let successor: Decision;
  if (input.successor_id) {
    successor = findDecision(ctx.db, input.successor_id);
    const problem = canSupersede(ctx.db.decisions, old.id, successor.id);
    if (problem) throw new AppError('validation', problem, { field: 'successor_id' });
  } else {
    if (!input.title) throw new AppError('validation', 'Bitte einen Titel eingeben.', { field: 'title' });
    successor = insertDecision(
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
  old.status = 'ersetzt';
  old.superseded_by_id = successor.id;
  dropMark(ctx, id);
  touch(ctx, old);
  writeHistory(ctx, 'decision', id, 'replaced', changes);
  return { ...registerUndo(ctx, 'decision', old, 'Ersetzt'), successor_id: successor.id };
}

/** WF-WIS-03 / WF-PLE-14: aufheben, Notiz optional */
export function revokeDecision(ctx: Ctx, id: string, note: string | null, version: number): Undoable {
  const d = findDecision(ctx.db, id);
  checkVersion(ctx, 'decision', d, version);
  if (!decisionActive(d.status)) throw rule('Nur gültige oder offene Einträge lassen sich aufheben.');
  ctx.inverse.push(decisionState(d));
  const changes: HistoryChanges = { status: { old: d.status, new: 'aufgehoben' } };
  if (note?.trim()) changes.note = { old: null, new: note.trim() };
  d.status = 'aufgehoben';
  dropMark(ctx, id);
  touch(ctx, d);
  writeHistory(ctx, 'decision', id, 'revoked', changes);
  return registerUndo(ctx, 'decision', d, 'Aufgehoben');
}

// ── Entscheidungen im Konsens (16.4) ─────────────────────────────────────────

/** Gültig, wenn alle aktiven Mitglieder bestätigt haben oder die Frist ohne Widerspruch abgelaufen ist */
export function settle(ctx: Ctx, d: Decision): boolean {
  const count = countVotes(votesOf(ctx.db, d.id), activeMemberIds(ctx.db));
  if (!consensusReached(d, count, toIsoDate(ctx.now))) return false;
  ctx.inverse.push(decisionState(d));
  d.status = 'gueltig';
  touch(ctx, d);
  writeHistory(ctx, 'decision', d.id, 'consensus_reached', {
    status: { old: 'offen', new: 'gueltig' },
    confirmed: { old: null, new: count.confirmed },
    total: { old: null, new: count.total },
  });
  return true;
}

/** WF-WIS-13: bestätigen oder widersprechen – je Person eine Stimme, änderbar, solange die Entscheidung offen ist */
export function voteDecision(ctx: Ctx, id: string, raw: unknown): Undoable & { valid: boolean } {
  const vote = parse(decisionVoteKindSchema, raw);
  const d = findDecision(ctx.db, id);
  if (d.archived_at || d.status !== 'offen')
    throw rule('Über diese Entscheidung wird nicht mehr abgestimmt.');
  const before = ctx.db.decision_votes.find((v) => v.decision_id === id && v.member_id === ctx.actor.id);
  if (before?.vote === vote) return { undo_token: '', valid: false };
  // nach der Frist ohne Widerspruch gilt sie – ein später Widerspruch ändert das nicht mehr (16.4)
  if (
    vote === 'widerspruch' &&
    d.consensus_until &&
    toIsoDate(ctx.now) > d.consensus_until &&
    countVotes(votesOf(ctx.db, id), activeMemberIds(ctx.db)).objected === 0
  )
    throw rule('Die Frist ist ohne Widerspruch abgelaufen – die Entscheidung gilt.');
  ctx.db.decision_votes = ctx.db.decision_votes.filter((v) => v !== before);
  ctx.db.decision_votes.push({ decision_id: id, member_id: ctx.actor.id, vote, voted_at: iso(ctx) });
  ctx.inverse.push({ kind: 'vote_restore', decision_id: id, member_id: ctx.actor.id, row: before ?? null });
  writeHistory(ctx, 'decision', id, 'voted', { vote: { old: before?.vote ?? null, new: vote } });
  // ein Widerspruch hält sie offen und setzt sie auf die Agenda
  if (vote === 'widerspruch' && !isMarked(ctx.db, id)) addMark(ctx, id, 'aktion');
  const valid = settle(ctx, d);
  return {
    ...registerUndo(ctx, 'decision', d, vote === 'bestaetigt' ? 'Bestätigt' : 'Widersprochen'),
    valid,
  };
}

/** Joblauf (16.4): offene Entscheidungen werden gültig, wenn die Frist ohne Widerspruch abgelaufen ist – automatisch */
export function settleOpenDecisions(db: Db, system: Member, now: Date): number {
  let settled = 0;
  for (const d of db.decisions)
    if (d.status === 'offen' && !d.archived_at && settle({ db, actor: system, now, inverse: [] }, d))
      settled += 1;
  return settled;
}

// ── Offene Fragen ───────────────────────────────────────────────────────────

export const NO_ANSWER =
  'Ohne Antwort oder festgehaltenes Ergebnis lässt sich die Frage nicht als beantwortet markieren.';

function findQuestion(db: Db, id: string): Question {
  const question = db.questions.find((q) => q.id === id);
  if (!question) throw notFound('Diese Frage');
  return question;
}

const questionItem = (db: Db, q: Question): QuestionListItem => ({
  ...q,
  results: db.decisions
    .filter((d) => d.source_question_id === q.id && !d.archived_at)
    // nach Zeit, bei Gleichstand nach Titel – wie auf dem Server
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.title.localeCompare(b.title))
    .map((d) => ({ id: d.id, title: d.title, kind: d.kind, status: d.status })),
});

export function listQuestions(db: Db): QuestionListItem[] {
  return sortQuestions(db.questions.filter((q) => !q.archived_at)).map((q) => questionItem(db, q));
}

export function getQuestion(db: Db, id: string): QuestionDetail {
  const q = findQuestion(db, id);
  return {
    ...questionItem(db, q),
    comments: commentsOf(db, 'question', id),
    history: historyOf(db, 'question', id),
  };
}

/** WF-FRA-01 */
export function createQuestion(ctx: Ctx, raw: unknown): { id: string } {
  const input = parse(questionCreateSchema, raw);
  checkTopic(ctx, input.topic_id);
  if (input.event_id && !ctx.db.events.some((e) => e.id === input.event_id && !e.archived_at))
    throw new AppError('validation', 'Diese Veranstaltung gibt es nicht mehr.', { field: 'event_id' });
  const now = iso(ctx);
  const question: Question = {
    id: uuid(),
    title: input.title,
    description: input.description,
    topic_id: input.topic_id,
    event_id: input.event_id,
    urgency: input.urgency,
    status: 'offen',
    raised_by: ctx.actor.id,
    answer: null,
    answered_in_plenum_id: null,
    archived_at: null,
    created_at: now,
    updated_at: now,
    created_by: ctx.actor.id,
    version: 1,
  };
  ctx.db.questions.push(question);
  const changes: HistoryChanges = { title: { old: null, new: question.title } };
  writeHistory(ctx, 'question', question.id, 'created', changes);
  ctx.inverse = [];
  return { id: question.id };
}

/** WF-FRA-06: Frage bearbeiten – Titel, Beschreibung, Thema, Veranstaltung, Dringlichkeit */
export function updateQuestion(ctx: Ctx, id: string, raw: unknown): void {
  const input = parse(questionUpdateSchema, raw);
  const q = findQuestion(ctx.db, id);
  checkVersion(ctx, 'question', q, input.version);
  if (q.archived_at) throw rule('Archivierte Fragen lassen sich nicht bearbeiten.');
  if (input.topic_id !== q.topic_id) checkTopic(ctx, input.topic_id);
  if (input.event_id !== q.event_id) checkEvent(ctx, input.event_id);
  const changes: HistoryChanges = {};
  const { title, description, topic_id, event_id, urgency } = input;
  if (!applyChanges(q, { title, description, topic_id, event_id, urgency }, changes)) return;
  touch(ctx, q);
  writeHistory(ctx, 'question', id, 'updated', changes);
}

const questionState = (q: Question) =>
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
export function clarifyQuestion(ctx: Ctx, id: string, raw: unknown): Undoable {
  const input = parse(questionClarifySchema, raw);
  const q = findQuestion(ctx.db, id);
  checkVersion(ctx, 'question', q, input.version);
  if (q.status !== 'offen') throw rule('Diese Frage ist nicht mehr offen.');
  const hasResults = ctx.db.decisions.some((d) => d.source_question_id === id && !d.archived_at);
  if (!input.answer && !hasResults) throw new AppError('validation', NO_ANSWER, { field: 'answer' });
  ctx.inverse.push(questionState(q));
  const changes: HistoryChanges = { status: { old: q.status, new: 'geklaert' } };
  if (input.answer) changes.answer = { old: null, new: input.answer };
  q.status = 'geklaert';
  q.answer = input.answer;
  q.answered_in_plenum_id = ctx.plenumId ?? null;
  touch(ctx, q);
  writeHistory(ctx, 'question', id, 'clarified', changes);
  return registerUndo(ctx, 'question', q, 'Als beantwortet markiert');
}

/** WF-FRA-03 */
export function discardQuestion(ctx: Ctx, id: string, version: number): Undoable {
  const q = findQuestion(ctx.db, id);
  checkVersion(ctx, 'question', q, version);
  if (q.status !== 'offen') throw rule('Diese Frage ist nicht mehr offen.');
  ctx.inverse.push(questionState(q));
  const changes: HistoryChanges = { status: { old: q.status, new: 'verworfen' } };
  q.status = 'verworfen';
  touch(ctx, q);
  writeHistory(ctx, 'question', id, 'discarded', changes);
  return registerUndo(ctx, 'question', q, 'Frage verworfen');
}

/** WF-FRA-04: geklärte oder verworfene Frage wieder öffnen – die Antwort bleibt in der Historie, Ergebnisse bleiben */
export function reopenQuestion(ctx: Ctx, id: string, version: number): Undoable {
  const q = findQuestion(ctx.db, id);
  checkVersion(ctx, 'question', q, version);
  if (q.status === 'offen') throw rule('Diese Frage ist schon offen.');
  ctx.inverse.push(questionState(q));
  const changes: HistoryChanges = { status: { old: q.status, new: 'offen' } };
  if (q.answer) changes.answer = { old: q.answer, new: null };
  q.status = 'offen';
  q.answer = null;
  q.answered_in_plenum_id = null;
  touch(ctx, q);
  writeHistory(ctx, 'question', id, 'reopened', changes);
  return registerUndo(ctx, 'question', q, 'Wieder geöffnet');
}

// ── Dokumente ───────────────────────────────────────────────────────────────

function findDocument(db: Db, id: string): DocumentRow {
  const document = db.documents.find((d) => d.id === id);
  if (!document) throw notFound('Dieses Dokument');
  return document;
}

const TARGET_NOUN: Record<DocumentLinkTarget, [one: string, many: string]> = {
  task: ['Aufgabe', 'Aufgaben'],
  event: ['Veranstaltung', 'Veranstaltungen'],
  appointment: ['Termin', 'Termine'],
  decision: ['Entscheidung', 'Entscheidungen'],
};

/** Verknüpfte Dateien, die in Drive verschwinden, bleiben mit Hinweis sichtbar (3.13). */
export function driveMissing(db: Db, d: DocumentRow): boolean {
  return driveFileMissing(db, d);
}

export function documentItem(db: Db, d: DocumentRow): DocumentListItem {
  const links = db.document_links.filter((l) => l.document_id === d.id);
  const protocols = db.appointments.filter((a) => a.protocol_document_id === d.id).length;
  const sources = db.decisions.filter((x) => x.source_document_id === d.id).length;
  const total = links.length + protocols + sources;
  let summary: string;
  if (total === 0) summary = 'nicht verknüpft';
  else if (total === 1) {
    const only = links[0];
    summary = only ? `1 ${TARGET_NOUN[only.target_type][0]}` : protocols ? '1 Plenum' : '1 Entscheidung';
  } else summary = `${total} verknüpft`;
  return {
    ...d,
    link_count: total,
    link_summary: summary,
    drive_missing: driveMissing(db, d),
  };
}

export function listDocuments(db: Db): DocumentListItem[] {
  return db.documents
    .filter((d) => !d.archived_at)
    .sort((a, b) => a.title.localeCompare(b.title, 'de'))
    .map((d) => documentItem(db, d));
}

export function linkedDocuments(db: Db, target: DocumentLinkTarget, id: string): DocumentListItem[] {
  const ids = db.document_links
    .filter((l) => l.target_type === target && l.target_id === id)
    .map((l) => l.document_id);
  return db.documents.filter((d) => ids.includes(d.id) && !d.archived_at).map((d) => documentItem(db, d));
}

function targetExists(db: Db, type: DocumentLinkTarget, id: string): boolean {
  const table = { task: db.tasks, event: db.events, appointment: db.appointments, decision: db.decisions }[
    type
  ];
  return table.some((row) => row.id === id && !row.archived_at);
}

/** WF-AUF-13 / WF-WIS-06: Verknüpfung einzeln hinzufügen */
export function linkDocument(ctx: Ctx, documentId: string, type: DocumentLinkTarget, targetId: string): void {
  const document = findDocument(ctx.db, documentId);
  if (document.archived_at) throw rule('Archivierte Dokumente lassen sich nicht verknüpfen.');
  if (!targetExists(ctx.db, type, targetId)) throw notFound('Das Ziel der Verknüpfung');
  if (
    ctx.db.document_links.some(
      (l) => l.document_id === documentId && l.target_type === type && l.target_id === targetId,
    )
  )
    return;
  ctx.db.document_links.push({ document_id: documentId, target_type: type, target_id: targetId });
  writeHistory(ctx, type, targetId, 'document_linked', { document: { old: null, new: document.title } });
}

export function unlinkDocument(
  ctx: Ctx,
  documentId: string,
  type: DocumentLinkTarget,
  targetId: string,
): void {
  const document = findDocument(ctx.db, documentId);
  const before = ctx.db.document_links.length;
  ctx.db.document_links = ctx.db.document_links.filter(
    (l) => !(l.document_id === documentId && l.target_type === type && l.target_id === targetId),
  );
  if (ctx.db.document_links.length !== before)
    writeHistory(ctx, type, targetId, 'document_unlinked', { document: { old: document.title, new: null } });
}

/** WF-WIS-06: Dokument per Link erfassen und – wenn gewünscht – gleich verknüpfen */
export function createDocument(ctx: Ctx, raw: unknown): { id: string; created: boolean } {
  const input = parse(documentCreateSchema, raw);
  if (input.topic_id) checkTopic(ctx, input.topic_id);
  // Link auf eine Datei aus dem Vereins-Drive: ein Eintrag je Datei (F-WIS-06), sonst fehlten Kennzeichen
  // im Verzeichnis und der Hinweis „In Drive nicht mehr vorhanden“
  // – auch wenn der Cache die Datei gerade nicht kennt (neu oder verschoben)
  const fileId = driveFileIdFromUrl(input.url);
  const existing = fileId ? documentFor(ctx.db, fileId) : undefined;
  if (existing) {
    if (input.link) linkDocument(ctx, existing.id, input.link.target_type, input.link.target_id);
    return { id: existing.id, created: false };
  }
  const item = fileId ? driveItem(ctx.db, fileId) : undefined;
  const driveFile = item && item.mime_type !== DRIVE_FOLDER_MIME ? item : undefined;
  const now = iso(ctx);
  const document: DocumentRow = {
    id: uuid(),
    title: input.title,
    url: input.url,
    drive_file_id: driveFile?.file_id ?? null,
    doc_type: input.doc_type,
    topic_id: input.topic_id,
    tags: [...new Set(input.tags)],
    description: null,
    archived_at: null,
    created_at: now,
    updated_at: now,
    created_by: ctx.actor.id,
    version: 1,
  };
  ctx.db.documents.push(document);
  writeHistory(ctx, 'document', document.id, 'created', { title: { old: null, new: document.title } });
  if (input.link) linkDocument(ctx, document.id, input.link.target_type, input.link.target_id);
  return { id: document.id, created: true };
}

// ── Entscheidung oder Fakt auf die Agenda (16.1): „Stimmt das noch?“ ────────

export function setDecisionAgenda(
  ctx: Ctx,
  id: string,
  onAgenda: boolean,
  rawReason: unknown = 'stimmt_noch',
): Undoable {
  const reason = parse(markReasonSchema, rawReason);
  const d = findDecision(ctx.db, id);
  const mark = ctx.db.plenum_marks.find((x) => x.decision_id === id);
  if (!onAgenda) {
    if (!mark) return { undo_token: '' };
    dropMark(ctx, id);
    return registerUndo(ctx, 'decision', d, 'Von der Agenda genommen');
  }
  if (mark?.reason === reason) return { undo_token: '' };
  if (d.archived_at || !decisionActive(d.status))
    throw rule('Nur gültige oder offene Einträge lassen sich auf die Agenda setzen.');
  // anderer Grund: neu aufsetzen (der alte Eintrag kommt mit Rückgängig zurück)
  if (mark) dropMark(ctx, id);
  addMark(ctx, id, reason);
  // Rückgängig arbeitet die Gegenschritte der Reihe nach ab: erst die neue Markierung weg, dann die alte zurück
  if (mark) ctx.inverse.push(...ctx.inverse.splice(-2, 2).reverse());
  return registerUndo(ctx, 'decision', d, `Auf der Agenda: ${MARK_REASON_LABEL[reason]}`);
}

// ── Globale Suche (F-WIS-06): nur App-Daten, gruppiert nach Art ─────────────

export function search(db: Db, query: string, now: Date): SearchGroup[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const hit = (...texts: (string | null | undefined)[]) => texts.some((t) => t?.toLowerCase().includes(q));
  const eventTitle = (id: string | null) => (id ? db.events.find((e) => e.id === id)?.title : undefined);
  const when = (isoTime: string) => formatDayMonth(new Date(isoTime));
  const today = toIsoDate(now);
  const groups: [SearchGroupKey, string, SearchGroup['items']][] = [
    [
      'aufgaben',
      'Aufgaben',
      db.tasks
        .filter((t) => !t.archived_at && hit(t.title, t.description))
        .map((t) => ({
          id: t.id,
          title: t.title,
          meta: [
            TASK_STATUS_LABEL[t.status],
            t.due_date &&
            t.due_date < today &&
            ['neu', 'geplant', 'in_arbeit', 'blockiert'].includes(t.status)
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
      db.events
        .filter((e) => !e.archived_at && hit(e.title, e.description))
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
      db.appointments
        .filter((a) => !a.archived_at && hit(a.title, a.location, a.notes))
        .map((a) => ({
          id: a.id,
          title: a.title,
          meta: `${when(a.starts_at)} · ${FORMAT_LABEL[a.format]} · ${APPOINTMENT_STATUS_LABEL[a.status]}`,
          link: `/termine/${a.id}`,
        })),
    ],
    [
      'beschluesse',
      'Entscheidungen & Fakten',
      db.decisions
        .filter((d) => !d.archived_at && hit(d.title, d.description))
        .map((d) => ({
          id: d.id,
          title: d.title,
          meta: `${DECISION_KIND_LABEL[d.kind]} · ${DECISION_STATUS_LABEL[d.status]}`,
          link: `/wissen/beschluesse/${d.id}`,
        })),
    ],
    [
      'fragen',
      'Fragen',
      db.questions
        .filter((x) => !x.archived_at && hit(x.title, x.description, x.answer))
        .map((x) => ({
          id: x.id,
          title: x.title,
          meta: `${QUESTION_STATUS_LABEL[x.status]} · ${PRIORITY_LABEL[x.urgency]}`,
          link: `/agenda/frage/${x.id}`,
        })),
    ],
    [
      'dokumente',
      'Dokumente',
      db.documents
        .filter((d) => !d.archived_at && hit(d.title, d.description, ...d.tags))
        .map((d) => ({
          id: d.id,
          title: d.title,
          meta: `${DOC_TYPE_LABEL[d.doc_type]} · ${documentItem(db, d).link_summary}`,
          link: d.url,
          external: true,
        })),
    ],
    [
      'partner',
      'Partner',
      db.partners
        .filter((p) => !p.archived_at && hit(p.name, p.kind, p.description, p.contact_person, p.notes))
        .map((p) => {
          const count = db.event_partners.filter((ep) => ep.partner_id === p.id).length;
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
