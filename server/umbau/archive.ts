// Phase 9: Alle Artefakte lassen sich löschen – Löschen ist Archivieren (wiederherstellbar), mit Versionsprüfung,
// Historie und Rückgängig. Aufgaben haben ihr eigenes Archivieren (server/p1/tasks.ts). Wie die Testdaten-Schicht
// (src/data/mock/archive.ts).
import { ARCHIVE_TARGETS, type ArchiveTarget } from '../../src/shared/schema';
import {
  checkVersion,
  iso,
  notFound,
  registerUndo,
  rule,
  writeHistory,
  type Ctx,
  type Undoable,
} from '../core/context';
import { dropMark } from '../core/marks';

export const ARCHIVE_TABLE = {
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
export async function archiveArtifact(
  ctx: Ctx,
  rawType: unknown,
  id: string,
  version: number,
): Promise<Undoable> {
  if (typeof rawType !== 'string' || !(ARCHIVE_TARGETS as readonly string[]).includes(rawType))
    throw rule('Das lässt sich nicht löschen.');
  const type = rawType as ArchiveTarget;
  const table = ARCHIVE_TABLE[type];
  const row = await ctx.trx
    .selectFrom(table)
    .select(['id', 'version', 'archived_at'])
    .where('id', '=', id)
    .forUpdate()
    .executeTakeFirst();
  if (!row) throw notFound(NOUN[type]);
  await checkVersion(ctx, type, row, version);
  if (row.archived_at) return { undo_token: '' };
  // Entscheidungen und Fakten gehen dabei von der Agenda (mit Gegenschritt)
  if (type === 'decision') await dropMark(ctx, id);
  const at = iso(ctx);
  ctx.inverse.push({ kind: 'archive_restore', table, id });
  await ctx.trx
    .updateTable(table)
    .set({ archived_at: at, version: row.version + 1, updated_at: at } as never)
    .where('id', '=', id)
    .where('version', '=', row.version)
    .execute();
  await writeHistory(ctx, type, id, 'archived', { archived_at: { old: null, new: at } });
  return registerUndo(ctx, type, { id, version: row.version + 1 }, 'Gelöscht');
}
