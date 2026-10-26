// Testdaten-Schicht, Phase 3: Plenum – Ergebnis, Protokoll und Abschluss (ANFORDERUNGEN 4.3, 16.2,
// F-PLE-01, -04; WF-PLE-03, -19, -20). Die Agenda ist seit dem Umbau 10/2026 eine eigene Ansicht (16.1).
import { AppError } from '../../shared/errors';
import { hasStarted } from '../../shared/rules/appointments';
import {
  buildResults,
  countsForPlenum,
  isPlenumRunning,
  plenumEnd,
  SESSION_PLENUM_LOOKAHEAD_MS,
  summaryText,
  type ResultGroupItems,
  type ResultSubject,
  type SessionPlenum,
} from '../../shared/rules/plenum';
import { protocolSchema, type Appointment, type HistoryChanges } from '../../shared/schema';
import type { PlenumDetail } from '../api';
import * as appts from './appointments';
import { enqueue } from './notify';
import { checkVersion, parse, rule, touch, writeHistory, type Ctx, type Db } from './server';

const isPlenum = appts.isPlenum;

function findPlenum(db: Db, id: string): Appointment {
  const plenum = appts.findAppointment(db, id);
  if (!isPlenum(db, plenum)) throw rule('Das geht nur bei einem Plenum.');
  return plenum;
}

/** Abschließen geht, solange das Plenum weder abgeschlossen noch abgesagt ist. */
function openPlenum(ctx: Ctx, id: string): Appointment {
  const plenum = findPlenum(ctx.db, id);
  if (plenum.status === 'abgeschlossen') throw rule('Dieses Plenum ist schon abgeschlossen.');
  if (plenum.status === 'abgesagt') throw rule('Dieses Plenum wurde abgesagt.');
  return plenum;
}

// ── Laufendes Plenum (16.2) ─────────────────────────────────────────────────

const isParticipant = (db: Db, plenumId: string, memberId: string) =>
  db.appointment_rsvps.some(
    (r) => r.appointment_id === plenumId && r.member_id === memberId && r.answer === 'ja',
  ) || db.appointment_attendees.some((a) => a.appointment_id === plenumId && a.member_id === memberId);

/** laufende Plenen, neueste zuerst */
function running(db: Db, now: Date): Appointment[] {
  return db.appointments
    .filter((a) => !a.archived_at && isPlenum(db, a) && isPlenumRunning(a, now))
    .sort((a, b) => b.starts_at.localeCompare(a.starts_at));
}

/** Für die Transaktion: das laufende Plenum und ob die Person auf der Teilnehmerliste steht */
export function runningPlenum(
  db: Db,
  memberId: string,
  now: Date,
): { id: string; participant: boolean } | null {
  const plenum = running(db, now)[0];
  return plenum ? { id: plenum.id, participant: isParticipant(db, plenum.id, memberId) } : null;
}

/** Für die Sitzung: das laufende oder nächste Plenum der kommenden 24 Stunden */
export function sessionPlenum(db: Db, memberId: string, now: Date): SessionPlenum | null {
  const plenum =
    running(db, now)[0] ??
    db.appointments
      .filter(
        (a) =>
          !a.archived_at &&
          isPlenum(db, a) &&
          (a.status === 'geplant' || a.status === 'stattgefunden') &&
          new Date(a.starts_at).getTime() > now.getTime() &&
          new Date(a.starts_at).getTime() <= now.getTime() + SESSION_PLENUM_LOOKAHEAD_MS,
      )
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
  if (!plenum) return null;
  return {
    id: plenum.id,
    title: plenum.title,
    starts_at: plenum.starts_at,
    ends_at: plenumEnd(plenum),
    participant: isParticipant(db, plenum.id, memberId),
  };
}

// ── Ergebnis: was in diesem Plenum passiert ist (F-PLE-04) ──────────────────

/** zurückgenommene Aktionen zählen nicht */
function undoneIds(db: Db): Set<string> {
  return new Set(
    db.history.flatMap((h) =>
      h.action === 'undo' ? ((h.changes.history_ids?.old as string[] | undefined) ?? []) : [],
    ),
  );
}

const CREATED = new Set(['created', 'created_as_replacement']);

/**
 * Ergebnis (16.2): je Artefakt eine Zeile – was während des Plenums angelegt oder geändert wurde oder dieses Plenum
 * als Quelle bzw. Herkunft führt. Reihenfolge: die erste Änderung zuerst.
 */
export function results(db: Db, plenumId: string): ResultGroupItems[] {
  const undone = undoneIds(db);
  const order: string[] = [];
  const created = new Set<string>();
  const add = (type: string, id: string) => {
    const key = `${type}:${id}`;
    if (!order.includes(key)) order.push(key);
    return key;
  };
  for (const h of db.history) {
    if (h.changes.plenum_id?.new !== plenumId || h.action === 'undo' || undone.has(h.id)) continue;
    if (!countsForPlenum(h.entity_type, h.entity_id, h.action, plenumId)) continue;
    const key = add(h.entity_type, h.entity_id);
    if (CREATED.has(h.action)) created.add(key);
  }
  for (const d of db.decisions) if (d.source_plenum_id === plenumId) add('decision', d.id);
  for (const t of db.tasks) if (t.origin_plenum_id === plenumId) add('task', t.id);
  for (const q of db.questions) if (q.answered_in_plenum_id === plenumId) add('question', q.id);

  const subjects: ResultSubject[] = [];
  for (const key of order) {
    const [type, id] = key.split(':') as [string, string];
    const isNew = created.has(key);
    if (type === 'decision') {
      const row = db.decisions.find((x) => x.id === id);
      if (!row || row.archived_at) continue;
      subjects.push({
        type,
        row,
        created: isNew,
        question_title: db.questions.find((q) => q.id === row.source_question_id)?.title ?? null,
        successor_title: db.decisions.find((x) => x.id === row.superseded_by_id)?.title ?? null,
      });
    } else if (type === 'task') {
      const row = db.tasks.find((x) => x.id === id);
      if (!row || row.archived_at) continue;
      const names = db.task_assignees
        .filter((a) => a.task_id === id)
        .map((a) => db.members.find((m) => m.id === a.member_id)?.display_name)
        .filter((n): n is string => !!n);
      subjects.push({ type, row, created: isNew, assignee_names: names });
    } else if (type === 'question') {
      const row = db.questions.find((x) => x.id === id);
      if (row && !row.archived_at) subjects.push({ type, row, created: isNew });
    } else if (type === 'event') {
      const row = db.events.find((x) => x.id === id);
      if (row && !row.archived_at) subjects.push({ type, row, created: isNew });
    } else if (type === 'appointment') {
      const row = db.appointments.find((x) => x.id === id);
      if (row && !row.archived_at) subjects.push({ type, row, created: isNew });
    } else if (type === 'document') {
      const row = db.documents.find((x) => x.id === id);
      if (row && !row.archived_at) subjects.push({ type, row, created: isNew });
    } else if (type === 'partner') {
      const row = db.partners.find((x) => x.id === id);
      if (row && !row.archived_at) subjects.push({ type, row, created: isNew });
    }
  }
  return buildResults(subjects);
}

export function getPlenum(db: Db, id: string, meId: string): PlenumDetail {
  const plenum = findPlenum(db, id);
  const doc = plenum.protocol_document_id
    ? db.documents.find((d) => d.id === plenum.protocol_document_id)
    : undefined;
  const summary = db.history.find(
    (h) => h.entity_type === 'appointment' && h.entity_id === id && h.action === 'closed',
  );
  return {
    ...appts.getAppointment(db, id, meId),
    results: results(db, id),
    protocol_document: doc ? { id: doc.id, title: doc.title, url: doc.url } : null,
    summary_recipients: summary ? Number(summary.changes.recipients?.new ?? 0) : null,
  };
}

/** WF-PLE-03 Protokoll */
export function updateProtocol(ctx: Ctx, plenumId: string, raw: unknown): void {
  const input = parse(protocolSchema, raw);
  const plenum = findPlenum(ctx.db, plenumId);
  checkVersion(ctx, 'appointment', plenum, input.version);
  if (
    input.protocol_member_id &&
    !ctx.db.members.some((m) => m.id === input.protocol_member_id && !m.is_system)
  )
    throw new AppError('validation', 'Diese Person gibt es nicht.', { field: 'protocol_member_id' });
  if (input.protocol_document_id && !ctx.db.documents.some((d) => d.id === input.protocol_document_id))
    throw new AppError('validation', 'Dieses Dokument gibt es nicht mehr.', {
      field: 'protocol_document_id',
    });
  const changes: HistoryChanges = {};
  for (const key of ['protocol_member_id', 'notes', 'protocol_document_id'] as const) {
    if (plenum[key] === input[key]) continue;
    changes[key] = { old: plenum[key], new: input[key] };
    plenum[key] = input[key];
  }
  if (Object.keys(changes).length === 0) return;
  touch(ctx, plenum);
  writeHistory(ctx, 'appointment', plenumId, 'protocol', changes);
}

/**
 * WF-PLE-20 „Plenum abschließen“: setzt „stattgefunden“ mit, hält die Teilnahme fest und verschickt die
 * Zusammenfassung. Eine Transaktion.
 */
export function closePlenum(
  ctx: Ctx,
  plenumId: string,
  attendeeIds: readonly string[],
  version: number,
): { recipients: number } {
  const plenum = openPlenum(ctx, plenumId);
  checkVersion(ctx, 'appointment', plenum, version);
  if (!hasStarted(plenum, ctx.now)) throw rule('Abschließen geht erst, wenn das Plenum begonnen hat.');
  const db = ctx.db;
  for (const id of attendeeIds)
    if (!db.members.some((m) => m.id === id && !m.is_system))
      throw rule('Unbekannte Person in der Teilnahmeliste.');
  db.appointment_attendees = db.appointment_attendees
    .filter((x) => x.appointment_id !== plenumId)
    .concat([...new Set(attendeeIds)].map((member_id) => ({ appointment_id: plenumId, member_id })));
  const recipients = db.members.filter((m) => m.active && !m.is_system);
  const text = summaryText(plenum.title, results(db, plenum.id));
  enqueue(
    db,
    ctx.now,
    recipients.map((m) => ({
      member_id: m.id,
      event_type: 'plenum_zusammenfassung' as const,
      text,
      link: `/termine/${plenumId}`,
      dedupe_key: `plenum_zusammenfassung:${plenumId}:${m.id}`,
    })),
  );
  const from = plenum.status;
  plenum.status = 'abgeschlossen';
  touch(ctx, plenum);
  writeHistory(ctx, 'appointment', plenumId, 'closed', {
    status: { old: from, new: 'abgeschlossen' },
    attendees: { old: null, new: attendeeIds.length },
    recipients: { old: null, new: recipients.length },
  });
  return { recipients: recipients.length };
}
