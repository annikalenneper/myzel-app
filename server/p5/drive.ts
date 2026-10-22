// Phase 5: Drive-Cache mit Abgleich (ANFORDERUNGEN 3.13, F-WIS-04, -05, -08, F-VER-03). Wie die Testdaten-Schicht
// (src/data/mock/drive.ts): Anzeige immer sofort aus dem Cache, Abgleich über die Changes-API höchstens einmal pro
// Minute, vollständiger Neuaufbau bei ungültigem Token, auf Wunsch („Neu einlesen“) und wöchentlich im Joblauf.
import type { Kysely } from 'kysely';
import type { DriveEntry, DriveFolder, EventDetail } from '../../src/data/api';
import { AppError } from '../../src/shared/errors';
import {
  DRIVE_RECENT_LIMIT,
  driveCheckDue,
  driveFileIdFromUrl,
  driveFullSyncDue,
  driveKind,
  reachableDriveIds,
} from '../../src/shared/rules/drive';
import { DRIVE_FOLDER_MIME, driveLinkSchema, type DriveItem } from '../../src/shared/schema';
import { checkVersion, iso, notFound, parse, rule, writeHistory, type Ctx, type Trx } from '../core/context';
import type { Database, DocumentRow } from '../db/types';
import { findEvent } from '../p1/events';
import { documentItems, linkDocument } from '../p3/knowledge';
import { touchEvent } from '../p4/events';
import { driveSource, DriveUnavailable, excludedFolderIds, type RemoteItem } from './source';

type Db = Trx | Kysely<Database>;
type Item = Omit<DriveItem, 'synced_at'>;

interface DriveIndex {
  rootId: string;
  /** nur sichtbare Einträge: nicht gelöscht, nicht ausgeschlossen und über sichtbare Ordner an der Wurzel */
  byId: Map<string, Item>;
  children: Map<string, Item[]>;
  /** alle Einträge im Cache, auch gelöschte – für „In Drive nicht mehr vorhanden“ */
  known: Map<string, Item>;
  sync: { last_checked_at: string | null; last_full_sync_at: string | null };
}

const isFolder = (i: { mime_type: string }) => i.mime_type === DRIVE_FOLDER_MIME;

async function loadIndex(db: Db): Promise<DriveIndex> {
  const [rows, state] = await Promise.all([
    db
      .selectFrom('drive_items')
      .select(['file_id', 'parent_id', 'name', 'mime_type', 'modified_time', 'web_url', 'trashed'])
      .execute(),
    db.selectFrom('drive_sync_state').selectAll().executeTakeFirst(),
  ]);
  // noch nie eingelesen: leeres Verzeichnis unter der eingerichteten Wurzel
  const rootId = state?.root_folder_id ?? driveSource().rootId;
  const excluded = excludedFolderIds();
  const ids = reachableDriveIds(
    rows.map((r) => (excluded.has(r.file_id) ? { ...r, trashed: true } : r)),
    rootId,
  );
  const index: DriveIndex = {
    rootId,
    byId: new Map(),
    children: new Map(),
    known: new Map(rows.map((r) => [r.file_id, r])),
    sync: {
      last_checked_at: state?.last_checked_at ?? null,
      last_full_sync_at: state?.last_full_sync_at ?? null,
    },
  };
  for (const i of rows) {
    if (!ids.has(i.file_id)) continue;
    index.byId.set(i.file_id, i);
    if (!i.parent_id) continue;
    const list = index.children.get(i.parent_id);
    if (list) list.push(i);
    else index.children.set(i.parent_id, [i]);
  }
  return index;
}

/** Ordner von der Wurzel bis einschließlich `item` */
function pathTo(index: DriveIndex, item: Item): Item[] {
  const out: Item[] = [];
  let current: Item | undefined = item;
  // höchstens so tief, wie es Einträge gibt – schützt vor fehlerhaften Elternverweisen
  for (let n = 0; current && n <= index.byId.size; n++) {
    out.unshift(current);
    current = current.parent_id ? index.byId.get(current.parent_id) : undefined;
  }
  return out;
}

/** Datei-ID eines Dokuments – auch aus dem Link, wenn es „Per Link“ erfasst wurde, bevor der Cache die Datei kannte */
const fileIdOf = (d: Pick<DocumentRow, 'drive_file_id' | 'url'>) =>
  d.drive_file_id ?? driveFileIdFromUrl(d.url);

/** Dokumente zu den Drive-Dateien, die gerade gezeigt werden – samt Verknüpfungen für das Kennzeichen */
async function entries(db: Db, index: DriveIndex, items: Item[]): Promise<DriveEntry[]> {
  const files = new Set(items.filter((i) => !isFolder(i)).map((i) => i.file_id));
  const docs = files.size
    ? (await db.selectFrom('documents').selectAll().where('archived_at', 'is', null).execute()).filter((d) =>
        files.has(fileIdOf(d) ?? ''),
      )
    : [];
  const summaries = await documentItems(db as Trx, docs);
  const byFile = new Map<string, (typeof summaries)[number]>();
  for (const s of summaries) {
    const id = fileIdOf(s)!;
    if (!byFile.has(id)) byFile.set(id, s);
  }
  return items.map((item) => {
    const folder = isFolder(item);
    // Ordner lassen sich nicht verknüpfen – auch ein Link auf einen Ordner zählt nicht als Dokument
    const doc = folder ? undefined : byFile.get(item.file_id);
    return {
      file_id: item.file_id,
      parent_id: item.parent_id,
      name: item.name,
      kind: driveKind(item.mime_type),
      modified_time: item.modified_time,
      web_url: item.web_url,
      child_count: folder ? (index.children.get(item.file_id)?.length ?? 0) : null,
      document_id: doc?.id ?? null,
      link_summary: doc ? (doc.link_count ? doc.link_summary : 'erfasst') : null,
      path: pathTo(index, item)
        .slice(1, -1)
        .map((i) => i.name)
        .join(' / '),
    };
  });
}

/** Ordner zuerst, dann nach Namen – wie in Drive */
const itemOrder = (a: Item, b: Item) =>
  Number(isFolder(b)) - Number(isFolder(a)) || a.name.localeCompare(b.name, 'de');

const childEntries = (db: Db, index: DriveIndex, folderId: string) =>
  entries(db, index, [...(index.children.get(folderId) ?? [])].sort(itemOrder));

/** WF-WIS-08: Ordner öffnen – sofort aus dem Cache */
export async function getDriveFolder(db: Db, folderId: unknown): Promise<DriveFolder> {
  if (folderId !== null && typeof folderId !== 'string') throw notFound('Diesen Ordner im Drive');
  const index = await loadIndex(db);
  const id = folderId ?? index.rootId;
  const folder = index.byId.get(id);
  if (!folder && id === index.rootId && index.byId.size === 0)
    // noch nie eingelesen: der Abgleich beim Öffnen füllt das Verzeichnis
    return {
      folder: { file_id: id, name: 'Drive', web_url: `https://drive.google.com/drive/folders/${id}` },
      path: [{ file_id: id, name: 'Drive' }],
      entries: [],
      sync: index.sync,
    };
  if (!folder || !isFolder(folder)) throw notFound('Diesen Ordner im Drive');
  return {
    folder: { file_id: folder.file_id, name: folder.name, web_url: folder.web_url },
    path: pathTo(index, folder).map((i) => ({ file_id: i.file_id, name: i.name })),
    entries: await childEntries(db, index, folder.file_id),
    sync: index.sync,
  };
}

/** F-WIS-08: Suche über die Namen im ganzen Verzeichnis */
export async function searchDrive(db: Db, query: unknown): Promise<DriveEntry[]> {
  const q = typeof query === 'string' ? query.trim().toLowerCase() : '';
  if (q.length < 2) return [];
  const index = await loadIndex(db);
  const hits = [...index.byId.values()]
    .filter((i) => i.parent_id && i.name.toLowerCase().includes(q))
    .sort(itemOrder)
    .slice(0, 50);
  return entries(db, index, hits);
}

/** F-WIS-08: „Zuletzt geändert“ – nur Dateien, neueste zuerst */
export async function recentDrive(db: Db): Promise<DriveEntry[]> {
  const index = await loadIndex(db);
  const recent = [...index.byId.values()]
    .filter((i) => !isFolder(i))
    .sort((a, b) => b.modified_time.localeCompare(a.modified_time))
    .slice(0, DRIVE_RECENT_LIMIT);
  return entries(db, index, recent);
}

// ── Abgleich (3.13) ─────────────────────────────────────────────────────────

/** Drive nicht erreichbar: verständlich melden, Einzelheiten nur ins Protokoll */
async function fromDrive<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (e) {
    if (!(e instanceof DriveUnavailable)) throw e;
    console.error(e.message);
    throw new AppError('network', 'Das Drive ist gerade nicht erreichbar. Angezeigt wird der letzte Stand.');
  }
}

/** Stand des Abgleichs sperren – gleichzeitige Abgleiche warten aufeinander und fragen Drive nicht doppelt */
async function lockState(trx: Trx) {
  await trx
    .insertInto('drive_sync_state')
    .values({ root_folder_id: driveSource().rootId })
    .onConflict((oc) => oc.column('id').doNothing())
    .execute();
  return trx.selectFrom('drive_sync_state').selectAll().forUpdate().executeTakeFirstOrThrow();
}

const row = (i: RemoteItem, at: string) => ({ ...i, synced_at: at });

async function rebuild(trx: Trx, now: Date): Promise<number> {
  const source = driveSource();
  const { items, token } = await fromDrive(() => source.listAll());
  const at = now.toISOString();
  await trx.deleteFrom('drive_items').execute();
  for (let i = 0; i < items.length; i += 500)
    await trx
      .insertInto('drive_items')
      .values(items.slice(i, i + 500).map((item) => row(item, at)))
      .execute();
  await trx
    .updateTable('drive_sync_state')
    .set({
      root_folder_id: source.rootId,
      changes_page_token: token,
      last_checked_at: at,
      last_full_sync_at: at,
    })
    .execute();
  return (await loadIndex(trx)).byId.size;
}

/** Vollständiger Neuaufbau: „Neu einlesen“ (WF-WIS-10) */
export async function rebuildDrive(ctx: Ctx): Promise<{ count: number }> {
  await lockState(ctx.trx);
  return { count: await rebuild(ctx.trx, ctx.now) };
}

/**
 * Abgleich im Hintergrund: nur geänderte Einträge aktualisieren, neuen Token speichern.
 * Liegt der letzte Abgleich keine Minute zurück, passiert nichts.
 */
export async function syncDrive(ctx: Ctx): Promise<{ changed: number }> {
  const state = await lockState(ctx.trx);
  if (!driveCheckDue(state.last_checked_at, ctx.now)) return { changed: 0 };
  const source = driveSource();
  // ohne gültigen Token (oder mit anderer Wurzel) weiß niemand, was sich geändert hat: vollständig neu
  const result =
    state.changes_page_token && state.root_folder_id === source.rootId
      ? await fromDrive(() => source.changes(state.changes_page_token!))
      : null;
  if (!result) {
    await rebuild(ctx.trx, ctx.now);
    return { changed: 1 };
  }
  const at = iso(ctx);
  const present = result.changed.filter((c) => c.item).map((c) => row(c.item!, at));
  const gone = result.changed.filter((c) => !c.item).map((c) => c.file_id);
  for (let i = 0; i < present.length; i += 500)
    await ctx.trx
      .insertInto('drive_items')
      .values(present.slice(i, i + 500))
      .onConflict((oc) =>
        oc.column('file_id').doUpdateSet((eb) => ({
          parent_id: eb.ref('excluded.parent_id'),
          name: eb.ref('excluded.name'),
          mime_type: eb.ref('excluded.mime_type'),
          modified_time: eb.ref('excluded.modified_time'),
          web_url: eb.ref('excluded.web_url'),
          trashed: eb.ref('excluded.trashed'),
          synced_at: eb.ref('excluded.synced_at'),
        })),
      )
      .execute();
  // in Drive endgültig gelöscht oder nicht mehr freigegeben: im Cache als gelöscht führen
  if (gone.length)
    await ctx.trx
      .updateTable('drive_items')
      .set({ trashed: true, synced_at: at })
      .where('file_id', 'in', gone)
      .execute();
  await ctx.trx
    .updateTable('drive_sync_state')
    .set({ changes_page_token: result.token, last_checked_at: at })
    .execute();
  return { changed: result.changed.length };
}

/** Joblauf: wöchentlicher Neuaufbau (3.13 Nr. 4); ohne eingerichtetes Drive passiert nichts */
export async function weeklyRebuild(db: Kysely<Database>, now: Date): Promise<boolean> {
  if (!driveSource().configured) return false;
  return db.transaction().execute(async (trx) => {
    const state = await lockState(trx);
    if (!driveFullSyncDue(state.last_full_sync_at, now)) return false;
    await rebuild(trx, now);
    return true;
  });
}

// ── Dokumente zu Drive-Dateien (F-WIS-05, F-WIS-06) ─────────────────────────

/** ein Eintrag je Datei: das erfasste Dokument zu einer Drive-Datei */
export async function documentForFile(trx: Trx, fileId: string): Promise<DocumentRow | undefined> {
  const docs = await trx
    .selectFrom('documents')
    .selectAll()
    .where('archived_at', 'is', null)
    .where((eb) => eb.or([eb('drive_file_id', '=', fileId), eb('url', 'like', `%${fileId}%`)]))
    .orderBy('created_at')
    .execute();
  return docs.find((d) => fileIdOf(d) === fileId);
}

/** Drive-Datei zu einem Link, wenn der Cache sie als Datei kennt – für drive_file_id beim Erfassen „Per Link“ */
export async function visibleDriveFile(trx: Trx, url: string): Promise<string | null> {
  const id = driveFileIdFromUrl(url);
  if (!id) return null;
  const item = (await loadIndex(trx)).byId.get(id);
  return item && !isFolder(item) ? item.file_id : null;
}

/**
 * Verknüpfte Dateien, die in Drive verschwunden sind (3.13). Ein „Per Link“ erfasstes Dokument ohne drive_file_id
 * zählt nur, wenn seine Datei zum Vereins-Drive gehört, also irgendwann im Cache stand.
 */
export async function missingDriveDocuments(
  db: Db,
  docs: Pick<DocumentRow, 'id' | 'url' | 'drive_file_id'>[],
): Promise<Set<string>> {
  const withFile = docs.filter((d) => fileIdOf(d));
  if (withFile.length === 0) return new Set();
  const index = await loadIndex(db);
  return new Set(
    withFile
      .filter((d) =>
        d.drive_file_id
          ? !index.byId.has(d.drive_file_id)
          : index.known.has(fileIdOf(d)!) && !index.byId.has(fileIdOf(d)!),
      )
      .map((d) => d.id),
  );
}

/** WF-WIS-09: Datei aus dem Verzeichnis verknüpfen – der Dokument-Eintrag entsteht beim ersten Verknüpfen */
export async function linkDriveFile(
  ctx: Ctx,
  raw: unknown,
): Promise<{ document_id: string; created: boolean }> {
  const input = parse(driveLinkSchema, raw);
  const item = (await loadIndex(ctx.trx)).byId.get(input.file_id);
  if (!item) throw notFound('Diese Datei im Drive');
  if (isFolder(item)) throw rule('Ordner lassen sich nicht verknüpfen – bitte eine Datei wählen.');
  let doc = await documentForFile(ctx.trx, item.file_id);
  const created = !doc;
  if (!doc) {
    const now = iso(ctx);
    doc = await ctx.trx
      .insertInto('documents')
      .values({
        title: item.name,
        url: item.web_url,
        drive_file_id: item.file_id,
        doc_type: input.doc_type,
        topic_id: null,
        tags: JSON.stringify([]),
        description: null,
        archived_at: null,
        created_at: now,
        updated_at: now,
        created_by: ctx.actor.id,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await writeHistory(ctx, 'document', doc.id, 'created', {
      title: { old: null, new: doc.title },
      drive_file_id: { old: null, new: item.file_id },
    });
  } else if (!doc.drive_file_id) {
    // vorher „Per Link“ erfasst, als der Cache die Datei noch nicht kannte: jetzt als Drive-Datei führen
    await ctx.trx
      .updateTable('documents')
      .set({ drive_file_id: item.file_id, version: doc.version + 1, updated_at: iso(ctx) })
      .where('id', '=', doc.id)
      .execute();
    await writeHistory(ctx, 'document', doc.id, 'updated', {
      drive_file_id: { old: null, new: item.file_id },
    });
  }
  if (input.link) await linkDocument(ctx, doc.id, input.link.target_type, input.link.target_id);
  return { document_id: doc.id, created };
}

// ── Drive-Ordner der Veranstaltung (F-VER-03, WF-VER-14) ─────────────────────

export async function eventDriveFolder(
  db: Db,
  folderId: string | null,
): Promise<EventDetail['drive_folder']> {
  if (!folderId) return null;
  const index = await loadIndex(db);
  const folder = index.byId.get(folderId);
  return {
    file_id: folderId,
    // verschwundener Ordner: letzter bekannter Name aus dem Cache
    name: folder?.name ?? index.known.get(folderId)?.name ?? 'Drive-Ordner',
    web_url: folder?.web_url ?? null,
    missing: !folder,
    entries: folder ? await childEntries(db, index, folderId) : [],
  };
}

/** WF-VER-14: Drive-Ordner wählen oder entfernen – nur Ordner aus dem Cache */
export async function setEventDriveFolder(
  ctx: Ctx,
  eventId: string,
  folderId: unknown,
  version: number,
): Promise<void> {
  const invalid = () =>
    new AppError('validation', 'Diesen Ordner gibt es im Drive nicht mehr.', { field: 'drive_folder_id' });
  if (folderId !== null && typeof folderId !== 'string') throw invalid();
  const event = await findEvent(ctx, eventId);
  await checkVersion(ctx, 'event', event, version);
  if (folderId) {
    const item = (await loadIndex(ctx.trx)).byId.get(folderId);
    if (!item || !isFolder(item)) throw invalid();
  }
  if (event.drive_folder_id === folderId) return;
  await writeHistory(ctx, 'event', eventId, 'updated', {
    drive_folder_id: { old: event.drive_folder_id, new: folderId },
  });
  await touchEvent(ctx, event, { drive_folder_id: folderId });
}
