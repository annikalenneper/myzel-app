// Testdaten-Schicht, Phase 9: Alle Artefakte lassen sich löschen – Löschen ist Archivieren (wiederherstellbar)
import { ARCHIVE_TARGETS, type ArchiveTarget } from '../../shared/schema';
import type { Undoable } from '../api';
import {
  checkVersion,
  dropMark,
  notFound,
  registerUndo,
  rule,
  touch,
  writeHistory,
  type Ctx,
} from './server';

export const ARCHIVE_COLLECTION = {
  event: 'events',
  appointment: 'appointments',
  decision: 'decisions',
  question: 'questions',
  document: 'documents',
  partner: 'partners',
} as const satisfies Record<ArchiveTarget, string>;

const NOUN: Record<ArchiveTarget, string> = {
  event: 'Diese Veranstaltung',
  appointment: 'Diesen Termin',
  decision: 'Diesen Eintrag',
  question: 'Diese Frage',
  document: 'Dieses Dokument',
  partner: 'Diesen Partner',
};

/** WF-ALL-09: Artefakt löschen (archivieren) */
export function archiveArtifact(ctx: Ctx, rawType: unknown, id: string, version: number): Undoable {
  if (typeof rawType !== 'string' || !(ARCHIVE_TARGETS as readonly string[]).includes(rawType))
    throw rule('Das lässt sich nicht löschen.');
  const type = rawType as ArchiveTarget;
  const collection = ARCHIVE_COLLECTION[type];
  const row = (
    ctx.db[collection] as { id: string; version: number; archived_at: string | null; updated_at: string }[]
  ).find((x) => x.id === id);
  if (!row) throw notFound(NOUN[type]);
  checkVersion(ctx, type, row, version);
  if (row.archived_at) return { undo_token: '' };
  // erst wiederherstellen, dann die Markierung – das Rückgängig arbeitet die Gegenschritte der Reihe nach ab
  // ein Serientermin bleibt gelöscht: als Ausnahme holt ihn der Joblauf nicht zurück (series.ts)
  const occurrence = type === 'appointment' ? ctx.db.appointments.find((x) => x.id === id) : undefined;
  const wasException = occurrence?.is_exception;
  if (occurrence?.series_id) occurrence.is_exception = true;
  ctx.inverse.push({ kind: 'archive_restore', collection, id, is_exception: wasException });
  if (type === 'decision') dropMark(ctx, id);
  row.archived_at = ctx.now.toISOString();
  touch(ctx, row);
  writeHistory(ctx, type, id, 'archived', { archived_at: { old: null, new: row.archived_at } });
  return registerUndo(ctx, type, row, 'Gelöscht');
}
