// Phase 3: Plenum – Ergebnis, Protokoll und Abschluss (ANFORDERUNGEN 4.3, 16.2, F-PLE-01, -04; WF-PLE-03, -19,
// -20). Wie die Testdaten-Schicht (src/data/mock/plenum.ts). Die Agenda ist seit dem Umbau 10/2026 eine eigene
// Ansicht (16.1).
import { sql } from 'kysely';
import type { PlenumDetail } from '../../src/data/api';
import { AppError } from '../../src/shared/errors';
import { hasStarted } from '../../src/shared/rules/appointments';
import {
  protocolSchema,
  RESULT_GROUPS,
  type HistoryChanges,
  type ResultGroup,
} from '../../src/shared/schema';
import { checkVersion, parse, rule, writeHistory, type Ctx, type Db, type ReadCtx } from '../core/context';
import type { AppointmentRow } from '../db/types';
import { enqueue } from '../p2/notify';
import * as appts from './appointments';

async function findPlenum(trx: Db, id: string, lock = true): Promise<AppointmentRow> {
  const plenum = await appts.findAppointment(trx, id, lock);
  if (!(await appts.isPlenum(trx, plenum))) throw rule('Das geht nur bei einem Plenum.');
  return plenum;
}

/** Abschließen geht, solange das Plenum weder abgeschlossen noch abgesagt ist. */
async function openPlenum(ctx: Ctx, id: string): Promise<AppointmentRow> {
  const plenum = await findPlenum(ctx.trx, id);
  if (plenum.status === 'abgeschlossen') throw rule('Dieses Plenum ist schon abgeschlossen.');
  if (plenum.status === 'abgesagt') throw rule('Dieses Plenum wurde abgesagt.');
  return plenum;
}

// ── Ergebnis: was in diesem Plenum passiert ist (F-PLE-04) ──────────────────

interface Line {
  group: ResultGroup;
  text: string;
}

export async function results(trx: Db, plenumId: string): Promise<{ group: ResultGroup; lines: string[] }[]> {
  // zurückgenommene Aktionen zählen nicht; passend zu den Indizes history_plenum und history_undone
  const rows = await sql<{ line: Line }>`
    select h.changes -> 'plenum_line' -> 'new' as line
    from history h
    where h.changes -> 'plenum_id' ->> 'new' = ${plenumId}
      and h.changes ? 'plenum_line'
      and not exists (
        select 1 from history u
        where u.action = 'undo' and u.changes -> 'history_ids' -> 'old' ? h.id::text
      )
    order by h.created_at, h.seq`.execute(trx);
  const lines = rows.rows.map((r) => r.line);
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

export async function getPlenum(ctx: ReadCtx, id: string): Promise<PlenumDetail> {
  const plenum = await findPlenum(ctx.trx, id, false);
  const [detail, resultGroups, doc, summary] = await Promise.all([
    appts.getAppointment(ctx.trx, id, ctx.actor.id),
    results(ctx.trx, id),
    plenum.protocol_document_id
      ? ctx.trx
          .selectFrom('documents')
          .select(['id', 'title', 'url'])
          .where('id', '=', plenum.protocol_document_id)
          .executeTakeFirst()
      : undefined,
    ctx.trx
      .selectFrom('history')
      .select('changes')
      .where('entity_type', '=', 'appointment')
      .where('entity_id', '=', id)
      .where('action', '=', 'closed')
      .executeTakeFirst(),
  ]);
  return {
    ...detail,
    results: resultGroups,
    protocol_document: doc ?? null,
    summary_recipients: summary ? Number((summary.changes as HistoryChanges).recipients?.new ?? 0) : null,
  };
}

export async function updateProtocol(ctx: Ctx, plenumId: string, raw: unknown): Promise<void> {
  const input = parse(protocolSchema, raw);
  const plenum = await findPlenum(ctx.trx, plenumId);
  await checkVersion(ctx, 'appointment', plenum, input.version);
  if (input.protocol_member_id) {
    const member = await ctx.trx
      .selectFrom('members')
      .select('id')
      .where('id', '=', input.protocol_member_id)
      .where('is_system', '=', false)
      .executeTakeFirst();
    if (!member)
      throw new AppError('validation', 'Diese Person gibt es nicht.', { field: 'protocol_member_id' });
  }
  if (input.protocol_document_id) {
    const doc = await ctx.trx
      .selectFrom('documents')
      .select('id')
      .where('id', '=', input.protocol_document_id)
      .where('archived_at', 'is', null)
      .executeTakeFirst();
    if (!doc)
      throw new AppError('validation', 'Dieses Dokument gibt es nicht mehr.', {
        field: 'protocol_document_id',
      });
  }
  const changes: HistoryChanges = {};
  const set: Partial<AppointmentRow> = {};
  for (const key of ['protocol_member_id', 'notes', 'protocol_document_id'] as const) {
    if (plenum[key] === input[key]) continue;
    changes[key] = { old: plenum[key], new: input[key] };
    set[key] = input[key];
  }
  if (Object.keys(changes).length === 0) return;
  await appts.touchAppointment(ctx, plenum, set);
  await writeHistory(ctx, 'appointment', plenumId, 'protocol', changes);
}

/** Zusammenfassung an alle aktiven Mitglieder (F-PLE-04): kurz, mit Link */
export async function summaryText(trx: Db, plenum: AppointmentRow): Promise<string> {
  const groups = await results(trx, plenum.id);
  if (groups.length === 0)
    return `${plenum.title} ist abgeschlossen – es wurde nichts beschlossen oder besprochen.`;
  const parts = groups.map((g) => `${RESULT_TITLE[g.group]}: ${g.lines.join('; ')}`);
  return `${plenum.title} ist abgeschlossen. ${parts.join(' · ')}`;
}

/**
 * WF-PLE-20 „Plenum abschließen“: setzt „stattgefunden“ mit, hält die Teilnahme fest und verschickt die
 * Zusammenfassung. Eine Transaktion.
 */
export async function closePlenum(
  ctx: Ctx,
  plenumId: string,
  attendeeIds: unknown,
  version: number,
): Promise<{ recipients: number }> {
  if (!Array.isArray(attendeeIds)) throw rule('Unbekannte Person in der Teilnahmeliste.');
  const plenum = await openPlenum(ctx, plenumId);
  await checkVersion(ctx, 'appointment', plenum, version);
  if (!hasStarted(plenum, ctx.now)) throw rule('Abschließen geht erst, wenn das Plenum begonnen hat.');
  await appts.replaceAttendees(ctx, plenumId, attendeeIds);
  const recipients = await appts.activeIds(ctx.trx);
  const text = await summaryText(ctx.trx, plenum);
  await enqueue(
    ctx.trx,
    ctx.now,
    recipients.map((member_id) => ({
      member_id,
      event_type: 'plenum_zusammenfassung' as const,
      text,
      link: `/termine/${plenumId}`,
      dedupe_key: `plenum_zusammenfassung:${plenumId}:${member_id}`,
    })),
  );
  const from = plenum.status;
  await appts.touchAppointment(ctx, plenum, { status: 'abgeschlossen' });
  await writeHistory(ctx, 'appointment', plenumId, 'closed', {
    status: { old: from, new: 'abgeschlossen' },
    attendees: { old: null, new: attendeeIds.length },
    recipients: { old: null, new: recipients.length },
  });
  return { recipients: recipients.length };
}
