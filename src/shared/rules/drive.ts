// Drive-Cache [P5] (ANFORDERUNGEN 3.13, F-WIS-04, F-WIS-08): Arten von Einträgen und die Abgleich-Regeln
import { DRIVE_FOLDER_MIME } from '../schema';

/** Abgleich über die Changes-API höchstens einmal pro Minute (3.13 Nr. 2) */
export const DRIVE_CHECK_INTERVAL_MS = 60_000;
/** wöchentlicher Neuaufbau (3.13 Nr. 4) */
export const DRIVE_FULL_SYNC_DAYS = 7;
/** „Zuletzt geändert“ zeigt so viele Dateien */
export const DRIVE_RECENT_LIMIT = 20;

export type DriveKind = 'ordner' | 'dokument' | 'tabelle' | 'praesentation' | 'pdf' | 'bild' | 'datei';

export const DRIVE_KIND_LABEL: Record<DriveKind, string> = {
  ordner: 'Ordner',
  dokument: 'Dokument',
  tabelle: 'Tabelle',
  praesentation: 'Präsentation',
  pdf: 'PDF',
  bild: 'Bild',
  datei: 'Datei',
};

export function driveKind(mimeType: string): DriveKind {
  if (mimeType === DRIVE_FOLDER_MIME) return 'ordner';
  if (mimeType === 'application/vnd.google-apps.document' || mimeType.includes('wordprocessingml'))
    return 'dokument';
  if (mimeType === 'application/vnd.google-apps.spreadsheet' || mimeType.includes('spreadsheetml'))
    return 'tabelle';
  if (mimeType === 'application/vnd.google-apps.presentation' || mimeType.includes('presentationml'))
    return 'praesentation';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType.startsWith('image/')) return 'bild';
  return 'datei';
}

/** Ist der letzte Abgleich jünger als eine Minute, fragt der Server nicht erneut bei Drive nach. */
export function driveCheckDue(lastCheckedAt: string | null, now: Date): boolean {
  return !lastCheckedAt || now.getTime() - new Date(lastCheckedAt).getTime() >= DRIVE_CHECK_INTERVAL_MS;
}

export function driveFullSyncDue(lastFullSyncAt: string | null, now: Date): boolean {
  return (
    !lastFullSyncAt || now.getTime() - new Date(lastFullSyncAt).getTime() >= DRIVE_FULL_SYNC_DAYS * 86_400_000
  );
}

/**
 * Was im Verzeichnis sichtbar ist: nicht gelöscht und über nicht gelöschte Ordner mit der Wurzel verbunden.
 * Die Changes-API meldet beim Löschen oder Verschieben eines Ordners nur ihn, nicht seine Kinder.
 */
export function reachableDriveIds(
  items: readonly { file_id: string; parent_id: string | null; trashed: boolean }[],
  rootId: string,
): Set<string> {
  const children = new Map<string, string[]>();
  for (const i of items) {
    if (i.trashed || !i.parent_id) continue;
    const list = children.get(i.parent_id);
    if (list) list.push(i.file_id);
    else children.set(i.parent_id, [i.file_id]);
  }
  const root = items.find((i) => i.file_id === rootId && !i.trashed);
  const seen = new Set<string>(root ? [rootId] : []);
  const todo = root ? [rootId] : [];
  while (todo.length) {
    for (const id of children.get(todo.pop()!) ?? []) {
      if (seen.has(id)) continue;
      seen.add(id);
      todo.push(id);
    }
  }
  return seen;
}

/** Datei-ID aus einem Drive- oder Docs-Link, z. B. …/document/d/<id>/edit oder …/file/d/<id> */
export function driveFileIdFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!DRIVE_HOSTS.has(parsed.hostname)) return null;
  // „Im Web veröffentlichen“ (…/d/e/2PACX-…/pub) nennt keine Datei-ID
  if (/\/d\/e\//.test(parsed.pathname)) return null;
  const fromPath = /\/d\/([\w-]+)/.exec(parsed.pathname)?.[1];
  const fromQuery = parsed.searchParams.get('id');
  return fromPath ?? (fromQuery && /^[\w-]+$/.test(fromQuery) ? fromQuery : null);
}
const DRIVE_HOSTS = new Set(['drive.google.com', 'docs.google.com', 'drive.usercontent.google.com']);
