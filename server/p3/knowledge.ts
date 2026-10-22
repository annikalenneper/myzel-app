// Phase 3: Wissen – Entscheidungen und Fakten, offene Fragen, Dokumente, Markierungen, Suche
// (ANFORDERUNGEN 3.7 bis 3.9, 4.4, 4.5, 5.5, 5.6). Wie die Testdaten-Schicht (src/data/mock/knowledge.ts).
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
import { isFinalEventStatus } from '../../src/shared/rules/eventStatus';
import {
  canSupersede,
  DECISION_KIND_LABEL,
  DECISION_STATUS_LABEL,
  DOC_TYPE_LABEL,
  QUESTION_STATUS_LABEL,
  sortQuestions,
} from '../../src/shared/rules/knowledge';
import {
  decisionCreateSchema,
  decisionReplaceSchema,
  documentCreateSchema,
  questionClarifySchema,
  questionCreateSchema,
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
  type Trx,
} from '../core/context';
import { addMark, dropMark, isMarked } from '../core/marks';
import type { DecisionRow, DocumentRow, QuestionRow } from '../db/types';
import { historyOf } from '../p1/reads';
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

async function findDecision(trx: Trx, id: string, lock = true): Promise<DecisionRow> {
  const decision = await trx
    .selectFrom('decisions')
    .selectAll()
    .where('id', '=', id)
    .$if(lock, (q) => q.forUpdate())
    .executeTakeFirst();
  if (!decision) throw notFound('Diesen Eintrag');
  return decision;
}

async function decisionItems(trx: Trx, rows: DecisionRow[]): Promise<DecisionListItem[]> {
  if (rows.length === 0) return [];
  const plenumIds = rows.flatMap((d) => (d.source_plenum_id ? [d.source_plenum_id] : []));
  const docIds = rows.flatMap((d) => (d.source_document_id ? [d.source_document_id] : []));
  const successorIds = rows.flatMap((d) => (d.superseded_by_id ? [d.superseded_by_id] : []));
  const [plenums, docs, successors, marks] = await Promise.all([
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
      .select('decision_id')
      .where(
        'decision_id',
        'in',
        rows.map((d) => d.id),
      )
      .execute(),
  ]);
  return rows.map((d) => {
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
    };
  });
}

export async function listDecisions(trx: Trx): Promise<DecisionListItem[]> {
  const rows = await trx
    .selectFrom('decisions')
    .selectAll()
    .where('archived_at', 'is', null)
    .orderBy('decided_on', 'desc')
    .orderBy('created_at', 'desc')
    .execute();
  return decisionItems(trx, rows);
}

export async function getDecision(trx: Trx, id: string): Promise<DecisionDetail> {
  const d = await findDecision(trx, id, false);
  const [[item], plenum, doc, replaces, documents, history] = await Promise.all([
    decisionItems(trx, [d]),
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
    historyOf(trx, 'decision', id),
  ]);
  return {
    ...item!,
    source_plenum: plenum ?? null,
    source_document: doc ?? null,
    replaces,
    documents,
    history,
  };
}

interface Sources {
  source_plenum_id: string | null;
  source_document_id: string | null;
  source_note: string | null;
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
  const now = iso(ctx);
  const decision = await ctx.trx
    .insertInto('decisions')
    .values({
      title: input.title,
      description: input.description,
      kind: input.kind,
      topic_id: input.topic_id,
      decided_on: input.decided_on ?? berlinDate(ctx.now),
      superseded_by_id: null,
      source_plenum_id: input.source_plenum_id,
      source_document_id: input.source_document_id,
      source_note: input.source_note,
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
  });
  return decision;
}

/** WF-WIS-01 */
export async function createDecision(ctx: Ctx, raw: unknown): Promise<{ id: string }> {
  const decision = await insertDecision(ctx, parse(decisionCreateSchema, raw));
  ctx.inverse.length = 0;
  return { id: decision.id };
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
  if (old.status !== 'gueltig') throw rule('Nur gültige Einträge lassen sich ersetzen.');
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
        source_plenum_id: input.source_plenum_id,
        source_document_id: input.source_document_id,
        source_note: input.source_note,
      },
      'created_as_replacement',
    );
  }
  ctx.inverse.push(decisionState(old));
  const changes: HistoryChanges = {
    status: { old: old.status, new: 'ersetzt' },
    superseded_by_id: { old: null, new: successor.id },
  };
  await dropMark(ctx, 'decision', id, changes);
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
  plenumId: string | null = null,
): Promise<Undoable> {
  const text = typeof note === 'string' ? note.trim().slice(0, 2000) : '';
  const d = await findDecision(ctx.trx, id);
  await checkVersion(ctx, 'decision', d, version);
  if (d.status !== 'gueltig') throw rule('Nur gültige Einträge lassen sich aufheben.');
  ctx.inverse.push(decisionState(d));
  const changes: HistoryChanges = { status: { old: d.status, new: 'aufgehoben' } };
  if (text) changes.note = { old: null, new: text };
  if (plenumId) changes.plenum_id = { old: null, new: plenumId };
  await dropMark(ctx, 'decision', id, changes);
  await touch(ctx, 'decisions', 'decision', d, { status: 'aufgehoben' });
  await writeHistory(ctx, 'decision', id, 'revoked', changes);
  return registerUndo(ctx, 'decision', d, 'Aufgehoben');
}

// ── Offene Fragen ───────────────────────────────────────────────────────────

async function findQuestion(trx: Trx, id: string, lock = true): Promise<QuestionRow> {
  const question = await trx
    .selectFrom('questions')
    .selectAll()
    .where('id', '=', id)
    .$if(lock, (q) => q.forUpdate())
    .executeTakeFirst();
  if (!question) throw notFound('Diese Frage');
  return question;
}

async function questionItems(trx: Trx, rows: QuestionRow[]): Promise<QuestionListItem[]> {
  if (rows.length === 0) return [];
  const decisionIds = rows.flatMap((q) => (q.resulting_decision_id ? [q.resulting_decision_id] : []));
  const [marks, decisions] = await Promise.all([
    trx
      .selectFrom('plenum_marks')
      .select('question_id')
      .where(
        'question_id',
        'in',
        rows.map((q) => q.id),
      )
      .execute(),
    decisionIds.length
      ? trx.selectFrom('decisions').select(['id', 'title', 'kind']).where('id', 'in', decisionIds).execute()
      : [],
  ]);
  return rows.map((q) => ({
    ...q,
    marked: marks.some((m) => m.question_id === q.id),
    resulting_decision: decisions.find((d) => d.id === q.resulting_decision_id) ?? null,
  }));
}

export async function listQuestions(trx: Trx): Promise<QuestionListItem[]> {
  const rows = await trx.selectFrom('questions').selectAll().where('archived_at', 'is', null).execute();
  return questionItems(trx, sortQuestions(rows));
}

export async function getQuestion(trx: Trx, id: string): Promise<QuestionDetail> {
  const q = await findQuestion(trx, id, false);
  const [[item], history] = await Promise.all([questionItems(trx, [q]), historyOf(trx, 'question', id)]);
  return { ...item!, history };
}

/** WF-FRA-01 */
export async function createQuestion(
  ctx: Ctx,
  raw: unknown,
  originPlenumId: string | null = null,
): Promise<{ id: string }> {
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
      resulting_decision_id: null,
      archived_at: null,
      created_at: now,
      updated_at: now,
      created_by: ctx.actor.id,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const changes: HistoryChanges = { title: { old: null, new: input.title } };
  if (input.mark_for_plenum) {
    await addMark(ctx, 'question', question.id);
    changes.plenum_mark = { old: false, new: true };
  }
  if (originPlenumId) changes.plenum_id = { old: null, new: originPlenumId };
  await writeHistory(ctx, 'question', question.id, 'created', changes);
  ctx.inverse.length = 0;
  return { id: question.id };
}

const questionState = (q: QuestionRow) =>
  ({
    kind: 'question_state',
    question_id: q.id,
    status: q.status,
    answer: q.answer,
    answered_in_plenum_id: q.answered_in_plenum_id,
    resulting_decision_id: q.resulting_decision_id,
  }) as const;

/**
 * WF-FRA-02 / WF-PLE-11: klären – Antwort Pflicht; Ergebnis nur Antwort, Entscheidung oder Fakt.
 * Im Plenum ist das Plenum die Quelle, außerhalb eine Notiz oder ein Dokument. Eine Transaktion.
 */
export async function clarifyQuestion(
  ctx: Ctx,
  id: string,
  raw: unknown,
  plenumId: string | null = null,
): Promise<Undoable & { decision_id: string | null }> {
  const input = parse(questionClarifySchema, raw);
  const q = await findQuestion(ctx.trx, id);
  await checkVersion(ctx, 'question', q, input.version);
  if (q.status !== 'offen') throw rule('Diese Frage ist nicht mehr offen.');
  ctx.inverse.push(questionState(q));
  const changes: HistoryChanges = {
    status: { old: q.status, new: 'geklaert' },
    answer: { old: null, new: input.answer },
  };
  let decision: DecisionRow | null = null;
  if (input.result !== 'antwort') {
    decision = await insertDecision(
      ctx,
      {
        title: input.decision_title || q.title,
        description: input.answer,
        kind: input.result,
        topic_id: q.topic_id,
        decided_on: null,
        source_plenum_id: plenumId,
        source_document_id: plenumId ? null : input.source_document_id,
        source_note: plenumId ? null : input.source_note,
      },
      'created_from_question',
    );
    changes.resulting_decision_id = { old: null, new: decision.id };
  }
  if (plenumId) changes.plenum_id = { old: null, new: plenumId };
  await dropMark(ctx, 'question', id, changes);
  await touch(ctx, 'questions', 'question', q, {
    status: 'geklaert',
    answer: input.answer,
    answered_in_plenum_id: plenumId,
    resulting_decision_id: decision?.id ?? null,
  });
  await writeHistory(ctx, 'question', id, 'clarified', changes);
  return {
    ...(await registerUndo(ctx, 'question', q, 'Als geklärt gespeichert')),
    decision_id: decision?.id ?? null,
  };
}

/** WF-FRA-03 / WF-PLE-12 */
export async function discardQuestion(
  ctx: Ctx,
  id: string,
  version: number,
  plenumId: string | null = null,
): Promise<Undoable> {
  const q = await findQuestion(ctx.trx, id);
  await checkVersion(ctx, 'question', q, version);
  if (q.status !== 'offen') throw rule('Diese Frage ist nicht mehr offen.');
  ctx.inverse.push(questionState(q));
  const changes: HistoryChanges = { status: { old: q.status, new: 'verworfen' } };
  if (plenumId) changes.plenum_id = { old: null, new: plenumId };
  await dropMark(ctx, 'question', id, changes);
  await touch(ctx, 'questions', 'question', q, { status: 'verworfen' });
  await writeHistory(ctx, 'question', id, 'discarded', changes);
  return registerUndo(ctx, 'question', q, 'Frage verworfen');
}

// ── Dokumente ───────────────────────────────────────────────────────────────

async function findDocument(trx: Trx, id: string): Promise<DocumentRow> {
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
  trx: Trx,
  rows: DocumentRow[],
  driveIndex?: DriveIndex,
): Promise<DocumentListItem[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((d) => d.id);
  const [links, protocols, sources, marks, missing] = await Promise.all([
    trx.selectFrom('document_links').selectAll().where('document_id', 'in', ids).execute(),
    trx
      .selectFrom('appointments')
      .select('protocol_document_id')
      .where('protocol_document_id', 'in', ids)
      .execute(),
    trx.selectFrom('decisions').select('source_document_id').where('source_document_id', 'in', ids).execute(),
    trx.selectFrom('plenum_marks').select('document_id').where('document_id', 'in', ids).execute(),
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
      marked: marks.some((m) => m.document_id === d.id),
      drive_missing: missing.has(d.id),
    };
  });
}

export async function listDocuments(trx: Trx): Promise<DocumentListItem[]> {
  const rows = await trx.selectFrom('documents').selectAll().where('archived_at', 'is', null).execute();
  rows.sort((a, b) => a.title.localeCompare(b.title, 'de'));
  return documentItems(trx, rows);
}

export async function linkedDocuments(
  trx: Trx,
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

async function targetExists(trx: Trx, type: DocumentLinkTarget, id: string): Promise<boolean> {
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

// ── Markierung „Fürs Plenum“ für Entscheidungen, Fragen, Dokumente, Veranstaltungen ──

type KnowledgeTarget = 'decision' | 'question' | 'document' | 'event' | 'partner';
const MARK_TABLE = {
  decision: 'decisions',
  question: 'questions',
  document: 'documents',
  event: 'events',
  partner: 'partners',
} as const;

export async function setMark(ctx: Ctx, target: unknown, id: string, marked: boolean): Promise<Undoable> {
  if (typeof target !== 'string' || !Object.hasOwn(MARK_TABLE, target))
    throw rule('Das kommt mit einer späteren Phase.');
  const kind = target as KnowledgeTarget;
  const entity = (await ctx.trx
    .selectFrom(MARK_TABLE[kind])
    .selectAll()
    .where('id', '=', id)
    .forUpdate()
    .executeTakeFirst()) as
    ({ id: string; version: number; status?: string } & Record<string, unknown>) | undefined;
  if (!entity) throw notFound('Diesen Eintrag');
  if ((await isMarked(ctx.trx, kind, id)) === marked) return { undo_token: '' };
  if (marked) {
    if (entity.archived_at) throw rule('Archivierte Einträge lassen sich nicht fürs Plenum markieren.');
    if (kind === 'decision' && entity.status !== 'gueltig')
      throw rule('Nur gültige Einträge lassen sich fürs Plenum markieren.');
    if (kind === 'question' && entity.status !== 'offen')
      throw rule('Nur offene Fragen lassen sich fürs Plenum markieren.');
    if (kind === 'event' && isFinalEventStatus(entity.status as never))
      throw rule('Abgeschlossene und abgesagte Veranstaltungen lassen sich nicht markieren.');
    await addMark(ctx, kind, id);
    await writeHistory(ctx, kind, id, 'marked', { plenum_mark: { old: false, new: true } });
    return registerUndo(ctx, kind, entity, 'Fürs Plenum markiert');
  }
  const changes: HistoryChanges = {};
  await dropMark(ctx, kind, id, changes);
  await writeHistory(ctx, kind, id, 'unmarked', changes);
  return registerUndo(ctx, kind, entity, 'Markierung entfernt');
}

// ── Globale Suche (F-WIS-06): nur App-Daten, gruppiert nach Art ─────────────

export async function search(trx: Trx, query: unknown, now: Date): Promise<SearchGroup[]> {
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
        link: `/aufgaben/${t.id}`,
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
        link: `/wissen/fragen/${x.id}`,
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
