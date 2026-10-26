// Phase 3: Plenum – Ergebnis, Protokoll und Abschluss (ANFORDERUNGEN 4.3, 16.2, F-PLE-01, -04; WF-PLE-03, -19,
// -20). Wie die Testdaten-Schicht (src/data/mock/plenum.ts). Die Agenda ist seit dem Umbau 10/2026 eine eigene
// Ansicht (16.1).
import { sql } from 'kysely';
import type { PlenumDetail } from '../../src/data/api';
import { AppError } from '../../src/shared/errors';
import { hasStarted } from '../../src/shared/rules/appointments';
import {
  buildResults,
  PLENUM_ENTITY_TYPES,
  summaryText,
  type ResultGroupItems,
  type ResultSubject,
} from '../../src/shared/rules/plenum';
import { protocolSchema, type HistoryChanges } from '../../src/shared/schema';
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

/**
 * Ergebnis (16.2): je Artefakt eine Zeile – was während des Plenums angelegt oder geändert wurde oder dieses Plenum
 * als Quelle bzw. Herkunft führt. Zurückgenommene Aktionen zählen nicht. Reihenfolge: die erste Änderung zuerst.
 */
export async function results(trx: Db, plenumId: string): Promise<ResultGroupItems[]> {
  const types = sql.join(PLENUM_ENTITY_TYPES.map((t) => sql.lit(t)));
  // passend zu den Indizes history_plenum, history_undone, tasks_origin_plenum, questions_answered_in_plenum,
  // decisions_source_plenum
  const touched = await sql<{ type: string; id: string; created: boolean }>`
    select type, id, bool_or(created) as created
    from (
      select h.entity_type as type, h.entity_id as id, h.created_at as at,
             h.action in ('created', 'created_as_replacement') as created
      from history h
      where h.changes -> 'plenum_id' ->> 'new' = ${plenumId}
        and h.action not in ('undo', 'rsvp')
        and h.entity_type in (${types})
        and not (h.entity_type = 'appointment' and h.entity_id = ${plenumId}::uuid)
        and not exists (
          select 1 from history u
          where u.action = 'undo' and u.changes -> 'history_ids' -> 'old' ? h.id::text
        )
      union all select 'decision', id, created_at, false from decisions where source_plenum_id = ${plenumId}::uuid
      union all select 'task', id, created_at, false from tasks where origin_plenum_id = ${plenumId}::uuid
      union all select 'question', id, created_at, false from questions where answered_in_plenum_id = ${plenumId}::uuid
    ) x
    group by type, id
    order by min(at), type, id`.execute(trx);
  const ids = (type: string) => {
    const list = touched.rows.filter((r) => r.type === type).map((r) => r.id);
    return list.length ? list : ['00000000-0000-0000-0000-000000000000'];
  };
  const [decisions, tasks, assignees, questions, events, appointments, documents, partners] =
    await Promise.all([
      trx
        .selectFrom('decisions')
        .selectAll()
        .where('id', 'in', ids('decision'))
        .where('archived_at', 'is', null)
        .execute(),
      trx
        .selectFrom('tasks')
        .selectAll()
        .where('id', 'in', ids('task'))
        .where('archived_at', 'is', null)
        .execute(),
      trx
        .selectFrom('task_assignees as a')
        .innerJoin('members as m', 'm.id', 'a.member_id')
        .select(['a.task_id', 'm.display_name'])
        .where('a.task_id', 'in', ids('task'))
        .orderBy('a.assigned_at')
        .execute(),
      trx
        .selectFrom('questions')
        .selectAll()
        .where('id', 'in', ids('question'))
        .where('archived_at', 'is', null)
        .execute(),
      trx
        .selectFrom('events')
        .selectAll()
        .where('id', 'in', ids('event'))
        .where('archived_at', 'is', null)
        .execute(),
      trx
        .selectFrom('appointments')
        .selectAll()
        .where('id', 'in', ids('appointment'))
        .where('archived_at', 'is', null)
        .execute(),
      trx
        .selectFrom('documents')
        .selectAll()
        .where('id', 'in', ids('document'))
        .where('archived_at', 'is', null)
        .execute(),
      trx
        .selectFrom('partners')
        .selectAll()
        .where('id', 'in', ids('partner'))
        .where('archived_at', 'is', null)
        .execute(),
    ]);
  // Titel der Fragen und Nachfolgerinnen, auf die Entscheidungen verweisen
  const refIds = decisions.flatMap((d) =>
    [d.source_question_id, d.superseded_by_id].filter((x): x is string => !!x),
  );
  const [refQuestions, refDecisions] = refIds.length
    ? await Promise.all([
        trx.selectFrom('questions').select(['id', 'title']).where('id', 'in', refIds).execute(),
        trx.selectFrom('decisions').select(['id', 'title']).where('id', 'in', refIds).execute(),
      ])
    : [[], []];

  const subjects: ResultSubject[] = [];
  for (const { type, id, created } of touched.rows) {
    if (type === 'decision') {
      const row = decisions.find((x) => x.id === id);
      if (row)
        subjects.push({
          type,
          row,
          created,
          question_title: refQuestions.find((q) => q.id === row.source_question_id)?.title ?? null,
          successor_title: refDecisions.find((d) => d.id === row.superseded_by_id)?.title ?? null,
        });
    } else if (type === 'task') {
      const row = tasks.find((x) => x.id === id);
      if (row)
        subjects.push({
          type,
          row,
          created,
          assignee_names: assignees.filter((a) => a.task_id === id).map((a) => a.display_name),
        });
    } else if (type === 'question') {
      const row = questions.find((x) => x.id === id);
      if (row) subjects.push({ type, row, created });
    } else if (type === 'event') {
      const row = events.find((x) => x.id === id);
      if (row) subjects.push({ type, row, created });
    } else if (type === 'appointment') {
      const row = appointments.find((x) => x.id === id);
      if (row) subjects.push({ type, row, created });
    } else if (type === 'document') {
      const row = documents.find((x) => x.id === id);
      if (row) subjects.push({ type, row, created });
    } else if (type === 'partner') {
      const row = partners.find((x) => x.id === id);
      if (row) subjects.push({ type, row, created });
    }
  }
  return buildResults(subjects);
}

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
  const text = summaryText(plenum.title, await results(ctx.trx, plenum.id));
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
