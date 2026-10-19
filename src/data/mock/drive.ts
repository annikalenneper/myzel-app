// Testdaten-Schicht, Phase 5: Drive-Cache mit Abgleich (ANFORDERUNGEN 3.13, F-WIS-04, -05, -08, F-VER-03).
// Die Anzeige kommt immer sofort aus dem Cache; der Abgleich fragt das (hier simulierte) Vereins-Drive
// höchstens einmal pro Minute nach Änderungen seit dem gespeicherten Token.
import { AppError } from '../../shared/errors';
import {
  DRIVE_RECENT_LIMIT,
  driveCheckDue,
  driveFullSyncDue,
  driveFileIdFromUrl,
  driveKind,
  reachableDriveIds,
} from '../../shared/rules/drive';
import { DRIVE_FOLDER_MIME, driveLinkSchema, type DocumentRow, type DriveItem } from '../../shared/schema';
import type { DriveEntry, DriveFolder } from '../api';
import { documentItem, linkDocument } from './knowledge';
import { notFound, parse, rule, touch, writeHistory, type Ctx, type Db } from './server';

interface DriveIndex {
  /** nur sichtbare Einträge: nicht gelöscht und über nicht gelöschte Ordner an der Wurzel */
  byId: Map<string, DriveItem>;
  children: Map<string, DriveItem[]>;
}
const indexes = new WeakMap<DriveItem[], DriveIndex>();

/** Einmal je Stand des Caches berechnet – jede Änderung am Cache ersetzt das Array drive_items. */
export function driveIndex(db: Db): DriveIndex {
  const cached = indexes.get(db.drive_items);
  if (cached) return cached;
  const ids = reachableDriveIds(db.drive_items, db.drive_sync_state.root_folder_id);
  const index: DriveIndex = { byId: new Map(), children: new Map() };
  for (const i of db.drive_items) {
    if (!ids.has(i.file_id)) continue;
    index.byId.set(i.file_id, i);
    if (!i.parent_id) continue;
    const list = index.children.get(i.parent_id);
    if (list) list.push(i);
    else index.children.set(i.parent_id, [i]);
  }
  indexes.set(db.drive_items, index);
  return index;
}

const live = (db: Db) => [...driveIndex(db).byId.values()];

/** ein im Verzeichnis sichtbarer Eintrag – gelöscht oder aus dem Vereinsordner verschoben zählt nicht */
export function driveItem(db: Db, fileId: string): DriveItem | undefined {
  return driveIndex(db).byId.get(fileId);
}

const isFolder = (i: { mime_type: string }) => i.mime_type === DRIVE_FOLDER_MIME;

/** Ordner von der Wurzel bis einschließlich `item` */
function pathTo(db: Db, item: DriveItem): DriveItem[] {
  const out: DriveItem[] = [];
  let current: DriveItem | undefined = item;
  // höchstens so tief, wie es Einträge gibt – schützt vor fehlerhaften Elternverweisen
  for (let n = 0; current && n <= db.drive_items.length; n++) {
    out.unshift(current);
    current = current.parent_id ? driveItem(db, current.parent_id) : undefined;
  }
  return out;
}

/** Datei-ID eines Dokuments – auch aus dem Link, wenn es „Per Link“ erfasst wurde, bevor der Cache die Datei kannte */
const fileIdOf = (d: DocumentRow) => d.drive_file_id ?? driveFileIdFromUrl(d.url);

/** ein Eintrag je Datei (F-WIS-06): das erfasste Dokument zu einer Drive-Datei */
export function documentFor(db: Db, fileId: string): DocumentRow | undefined {
  return db.documents.find((d) => !d.archived_at && fileIdOf(d) === fileId);
}

/**
 * Verknüpfte Datei, die in Drive verschwunden ist (3.13). Ein „Per Link“ erfasstes Dokument ohne drive_file_id
 * zählt nur, wenn seine Datei zum Vereins-Drive gehört, also irgendwann im Cache stand.
 */
export function driveFileMissing(db: Db, d: DocumentRow): boolean {
  if (d.drive_file_id) return !driveItem(db, d.drive_file_id);
  const id = driveFileIdFromUrl(d.url);
  return !!id && db.drive_items.some((i) => i.file_id === id) && !driveItem(db, id);
}

/** Dokumente je Datei-ID, einmal je Anfrage */
function documentsByFile(db: Db): Map<string, DocumentRow> {
  const map = new Map<string, DocumentRow>();
  for (const d of db.documents) {
    const id = d.archived_at ? null : fileIdOf(d);
    if (id && !map.has(id)) map.set(id, d);
  }
  return map;
}

function entry(db: Db, item: DriveItem, docs = documentsByFile(db)): DriveEntry {
  // Ordner lassen sich nicht verknüpfen – auch ein Link auf einen Ordner zählt nicht als Dokument
  const doc = isFolder(item) ? undefined : docs.get(item.file_id);
  const summary = doc ? documentItem(db, doc) : null;
  const folder = isFolder(item);
  return {
    file_id: item.file_id,
    parent_id: item.parent_id,
    name: item.name,
    kind: driveKind(item.mime_type),
    modified_time: item.modified_time,
    web_url: item.web_url,
    child_count: folder ? (driveIndex(db).children.get(item.file_id)?.length ?? 0) : null,
    document_id: doc?.id ?? null,
    link_summary: summary ? (summary.link_count ? summary.link_summary : 'erfasst') : null,
    path: pathTo(db, item)
      .slice(1, -1)
      .map((i) => i.name)
      .join(' / '),
  };
}

/** Ordner zuerst, dann nach Namen – wie in Drive */
const byFolderThenName = (a: DriveEntry, b: DriveEntry) =>
  Number(b.kind === 'ordner') - Number(a.kind === 'ordner') || a.name.localeCompare(b.name, 'de');

export function childEntries(db: Db, folderId: string): DriveEntry[] {
  const docs = documentsByFile(db);
  return (driveIndex(db).children.get(folderId) ?? []).map((i) => entry(db, i, docs)).sort(byFolderThenName);
}

const itemOrder = (a: DriveItem, b: DriveItem) =>
  Number(isFolder(b)) - Number(isFolder(a)) || a.name.localeCompare(b.name, 'de');

/** WF-WIS-08: Ordner öffnen – sofort aus dem Cache */
export function getDriveFolder(db: Db, folderId: string | null): DriveFolder {
  const folder = driveItem(db, folderId ?? db.drive_sync_state.root_folder_id);
  if (!folder || !isFolder(folder)) throw notFound('Diesen Ordner im Drive');
  return {
    folder: { file_id: folder.file_id, name: folder.name, web_url: folder.web_url },
    path: pathTo(db, folder).map((i) => ({ file_id: i.file_id, name: i.name })),
    entries: childEntries(db, folder.file_id),
    sync: {
      last_checked_at: db.drive_sync_state.last_checked_at,
      last_full_sync_at: db.drive_sync_state.last_full_sync_at,
    },
  };
}

/** F-WIS-08: Suche über die Namen im ganzen Verzeichnis */
export function searchDrive(db: Db, query: string): DriveEntry[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const docs = documentsByFile(db);
  return live(db)
    .filter((i) => i.parent_id && i.name.toLowerCase().includes(q))
    .sort(itemOrder)
    .slice(0, 50)
    .map((i) => entry(db, i, docs));
}

/** F-WIS-08: „Zuletzt geändert“ – nur Dateien, neueste zuerst */
export function recentDrive(db: Db): DriveEntry[] {
  return live(db)
    .filter((i) => !isFolder(i))
    .sort((a, b) => b.modified_time.localeCompare(a.modified_time))
    .slice(0, DRIVE_RECENT_LIMIT)
    .map((i) => entry(db, i, documentsByFile(db)));
}

// ── Abgleich (3.13) ─────────────────────────────────────────────────────────

/** Vollständiger Neuaufbau: bei ungültigem Token, „Neu einlesen“, wöchentlich, beim Einrichten */
export function rebuildDrive(db: Db, now: Date): { count: number } {
  const at = now.toISOString();
  db.drive_items = db.drive_remote.items.map((i) => ({ ...i, synced_at: at }));
  db.drive_sync_state.changes_page_token = String(db.drive_remote.seq);
  db.drive_sync_state.last_checked_at = at;
  db.drive_sync_state.last_full_sync_at = at;
  return { count: live(db).length };
}

const validToken = (db: Db, token: string | null): token is string =>
  token !== null && /^\d+$/.test(token) && Number(token) <= db.drive_remote.seq;

/**
 * Abgleich im Hintergrund: nur geänderte Einträge aktualisieren, neuen Token speichern.
 * Liegt der letzte Abgleich keine Minute zurück, passiert nichts.
 */
export function syncDrive(db: Db, now: Date): { changed: number } {
  const state = db.drive_sync_state;
  if (!driveCheckDue(state.last_checked_at, now)) return { changed: 0 };
  if (!validToken(db, state.changes_page_token)) {
    // ohne gültigen Token weiß niemand, was sich geändert hat: vollständig neu, Ansicht neu laden
    rebuildDrive(db, now);
    return { changed: 1 };
  }
  const since = Number(state.changes_page_token);
  const ids = [...new Set(db.drive_remote.changes.filter((c) => c.seq > since).map((c) => c.file_id))];
  const at = now.toISOString();
  // neues Array: der Index (driveIndex) gilt je Stand und darf nicht veralten
  db.drive_items = [...db.drive_items];
  for (const id of ids) {
    const remote = db.drive_remote.items.find((i) => i.file_id === id);
    const index = db.drive_items.findIndex((i) => i.file_id === id);
    // in Drive endgültig gelöscht: im Cache als gelöscht führen
    const next = remote
      ? { ...remote, synced_at: at }
      : index >= 0
        ? { ...db.drive_items[index]!, trashed: true, synced_at: at }
        : null;
    if (!next) continue;
    if (index >= 0) db.drive_items[index] = next;
    else db.drive_items.push(next);
  }
  state.changes_page_token = String(db.drive_remote.seq);
  state.last_checked_at = at;
  return { changed: ids.length };
}

export function weeklyRebuild(db: Db, now: Date): void {
  if (driveFullSyncDue(db.drive_sync_state.last_full_sync_at, now)) rebuildDrive(db, now);
}

// ── Verknüpfen aus dem Verzeichnis (F-WIS-05, WF-WIS-09) ─────────────────────

export function linkDriveFile(ctx: Ctx, raw: unknown): { document_id: string; created: boolean } {
  const input = parse(driveLinkSchema, raw);
  const item = driveItem(ctx.db, input.file_id);
  if (!item) throw notFound('Diese Datei im Drive');
  if (isFolder(item)) throw rule('Ordner lassen sich nicht verknüpfen – bitte eine Datei wählen.');
  let doc = documentFor(ctx.db, item.file_id);
  const created = !doc;
  if (!doc) {
    const now = ctx.now.toISOString();
    doc = {
      id: crypto.randomUUID(),
      title: item.name,
      url: item.web_url,
      drive_file_id: item.file_id,
      doc_type: input.doc_type,
      topic_id: null,
      tags: [],
      description: null,
      archived_at: null,
      created_at: now,
      updated_at: now,
      created_by: ctx.actor.id,
      version: 1,
    };
    ctx.db.documents.push(doc);
    writeHistory(ctx, 'document', doc.id, 'created', {
      title: { old: null, new: doc.title },
      drive_file_id: { old: null, new: item.file_id },
    });
  } else if (!doc.drive_file_id) {
    // vorher „Per Link“ erfasst, als der Cache die Datei noch nicht kannte: jetzt als Drive-Datei führen
    writeHistory(ctx, 'document', doc.id, 'updated', { drive_file_id: { old: null, new: item.file_id } });
    doc.drive_file_id = item.file_id;
    touch(ctx, doc);
  }
  if (input.link) linkDocument(ctx, doc.id, input.link.target_type, input.link.target_id);
  return { document_id: doc.id, created };
}

/** WF-VER-14: nur Ordner aus dem Cache */
export function checkDriveFolder(db: Db, folderId: string): void {
  const item = driveItem(db, folderId);
  if (!item || !isFolder(item))
    throw new AppError('validation', 'Diesen Ordner gibt es im Drive nicht mehr.', {
      field: 'drive_folder_id',
    });
}

// ── Simuliertes Vereins-Drive (nur Testdaten-Schicht) ───────────────────────

export function remotePut(db: Db, item: Omit<DriveItem, 'synced_at' | 'trashed'>): void {
  const r = db.drive_remote;
  r.items = r.items.filter((i) => i.file_id !== item.file_id);
  r.items.push({ ...item, trashed: false });
  r.seq += 1;
  r.changes.push({ seq: r.seq, file_id: item.file_id });
}

export function remoteTrash(db: Db, fileId: string): void {
  const r = db.drive_remote;
  const item = r.items.find((i) => i.file_id === fileId);
  if (!item) return;
  item.trashed = true;
  r.seq += 1;
  r.changes.push({ seq: r.seq, file_id: fileId });
}
