// Testdaten-Schicht, Phase 3: Plenum – Ergebnis, Protokoll und Abschluss (ANFORDERUNGEN 4.3, 16.2,
// F-PLE-01, -04; WF-PLE-03, -19, -20). Die Agenda ist seit dem Umbau 10/2026 eine eigene Ansicht (16.1).
import { AppError } from '../../shared/errors';
import { hasStarted } from '../../shared/rules/appointments';
import {
  protocolSchema,
  RESULT_GROUPS,
  type Appointment,
  type HistoryChanges,
  type ResultGroup,
} from '../../shared/schema';
import type { PlenumDetail } from '../api';
import * as appts from './appointments';
import { enqueue } from './notify';
import { checkVersion, parse, rule, touch, writeHistory, type Ctx, type Db } from './server';

function findPlenum(db: Db, id: string): Appointment {
  const plenum = appts.findAppointment(db, id);
  if (!appts.isPlenum(db, plenum)) throw rule('Das geht nur bei einem Plenum.');
  return plenum;
}

/** Abschließen geht, solange das Plenum weder abgeschlossen noch abgesagt ist. */
function openPlenum(ctx: Ctx, id: string): Appointment {
  const plenum = findPlenum(ctx.db, id);
  if (plenum.status === 'abgeschlossen') throw rule('Dieses Plenum ist schon abgeschlossen.');
  if (plenum.status === 'abgesagt') throw rule('Dieses Plenum wurde abgesagt.');
  return plenum;
}

// ── Ergebnis: was in diesem Plenum passiert ist (F-PLE-04) ──────────────────

interface Line {
  group: ResultGroup;
  text: string;
}

export function results(db: Db, plenumId: string): { group: ResultGroup; lines: string[] }[] {
  // zurückgenommene Aktionen zählen nicht
  const undone = new Set(
    db.history.flatMap((h) =>
      h.action === 'undo' ? ((h.changes.history_ids?.old as string[] | undefined) ?? []) : [],
    ),
  );
  const lines = db.history
    .filter((h) => h.changes.plenum_id?.new === plenumId && h.changes.plenum_line && !undone.has(h.id))
    .map((h) => h.changes.plenum_line!.new as Line);
  return RESULT_GROUPS.map((group) => ({
    group,
    lines: lines.filter((l) => l.group === group).map((l) => l.text),
  })).filter((g) => g.lines.length > 0);
}

export const RESULT_TITLE: Record<ResultGroup, string> = {
  beschluesse: 'Entscheidungen & Fakten',
  aufgaben: 'Aufgaben',
  fragen: 'Fragen',
  termine: 'Veranstaltungen & Termine',
  besprochen: 'Besprochen',
};

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

/** Zusammenfassung an alle aktiven Mitglieder (F-PLE-04): kurz, mit Link */
export function summaryText(db: Db, plenum: Appointment): string {
  const groups = results(db, plenum.id);
  if (groups.length === 0)
    return `${plenum.title} ist abgeschlossen – es wurde nichts beschlossen oder besprochen.`;
  const parts = groups.map((g) => `${RESULT_TITLE[g.group]}: ${g.lines.join('; ')}`);
  return `${plenum.title} ist abgeschlossen. ${parts.join(' · ')}`;
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
  const text = summaryText(db, plenum);
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
