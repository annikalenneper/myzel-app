// Phase 5: Quelle des Drive-Caches (ANFORDERUNGEN 3.13). In Betrieb Google Drive über das Dienstkonto (nur lesend,
// drive.readonly), in Tests und lokal ein nachgebautes Drive mit denselben Testdaten wie die Testdaten-Schicht.
import { createSign } from 'node:crypto';
import { DRIVE_FOLDER_MIME, type DriveItem } from '../../src/shared/schema';
import type { DriveRemote } from '../../src/data/mock/server';

export type RemoteItem = Omit<DriveItem, 'synced_at'>;

export interface DriveChanges {
  /** geänderte Einträge; item null: in Drive endgültig gelöscht oder nicht mehr freigegeben */
  changed: { file_id: string; item: RemoteItem | null }[];
  token: string;
}

export interface DriveSource {
  /** eingerichtet (Dienstkonto und Wurzelordner bekannt) – sonst bleibt der Joblauf beim Drive still */
  readonly configured: boolean;
  /** Wurzelordner des Vereins-Drives */
  readonly rootId: string;
  /** alle Einträge, die das Dienstkonto sieht, samt Wurzel – dazu der Token für spätere Änderungen */
  listAll(): Promise<{ items: RemoteItem[]; token: string }>;
  /** Änderungen seit dem Token; null: Token ungültig, der Cache muss vollständig neu aufgebaut werden */
  changes(token: string): Promise<DriveChanges | null>;
}

/** Drive ist nicht eingerichtet oder nicht erreichbar – die App zeigt weiter den letzten Stand */
export class DriveUnavailable extends Error {}

let current: DriveSource | null = null;

/** In Betrieb: Google Drive aus den Umgebungsvariablen. Tests setzen vorher ein FakeDrive. */
export function driveSource(): DriveSource {
  current ??= googleDrive();
  return current;
}

export function setDriveSource(source: DriveSource): void {
  current = source;
}

/** Ordner, die im Verzeichnis nicht erscheinen sollen (samt Inhalt) */
export function excludedFolderIds(): Set<string> {
  return new Set(
    (process.env.GOOGLE_DRIVE_EXCLUDED_FOLDER_IDS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

// ── Nachgebautes Drive (Tests, lokale Entwicklung) ───────────────────────────

/** Wie das simulierte Drive der Testdaten-Schicht: Änderungen fortlaufend nummeriert, der Token ist die Nummer. */
export class FakeDrive implements DriveSource {
  readonly configured = true;
  items: RemoteItem[];
  changeLog: { seq: number; file_id: string }[];
  seq: number;
  /** ab dieser Nummer gelten ältere Token als abgelaufen */
  private oldestValid = 0;

  constructor(
    remote: DriveRemote,
    readonly rootId: string,
  ) {
    this.items = structuredClone(remote.items);
    this.changeLog = structuredClone(remote.changes);
    this.seq = remote.seq;
  }

  async listAll(): Promise<{ items: RemoteItem[]; token: string }> {
    return { items: structuredClone(this.items), token: String(this.seq) };
  }

  async changes(token: string): Promise<DriveChanges | null> {
    if (!/^\d+$/.test(token) || Number(token) > this.seq || Number(token) < this.oldestValid) return null;
    const ids = [...new Set(this.changeLog.filter((c) => c.seq > Number(token)).map((c) => c.file_id))];
    return {
      changed: ids.map((file_id) => ({
        file_id,
        item: structuredClone(this.items.find((i) => i.file_id === file_id) ?? null),
      })),
      token: String(this.seq),
    };
  }

  put(item: Omit<RemoteItem, 'trashed'>): void {
    this.items = this.items.filter((i) => i.file_id !== item.file_id);
    this.items.push({ ...item, trashed: false });
    this.log(item.file_id);
  }

  trash(fileId: string): void {
    const item = this.items.find((i) => i.file_id === fileId);
    if (!item) return;
    item.trashed = true;
    this.log(fileId);
  }

  /** alle bisherigen Token verfallen lassen (wie bei Drive nach langer Pause) */
  expireTokens(): void {
    this.oldestValid = this.seq + 1;
    this.log(this.items[0]!.file_id);
  }

  private log(fileId: string): void {
    this.seq += 1;
    this.changeLog.push({ seq: this.seq, file_id: fileId });
  }
}

// ── Google Drive über das Dienstkonto ───────────────────────────────────────

const API = 'https://www.googleapis.com/drive/v3';
const FILE_FIELDS = 'id,name,mimeType,parents,modifiedTime,webViewLink,trashed';
/** je Aufruf bei Google: danach lieber den letzten Stand zeigen als die App warten lassen */
const CALL_TIMEOUT_MS = 8_000;

interface GoogleFile {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  modifiedTime: string;
  webViewLink?: string;
  trashed?: boolean;
}

function toItem(f: GoogleFile, rootId: string): RemoteItem {
  const folder = f.mimeType === DRIVE_FOLDER_MIME;
  return {
    file_id: f.id,
    // die Wurzel hat keinen Elternordner – auch wenn Drive einen nennt, den das Dienstkonto nicht sieht
    parent_id: f.id === rootId ? null : (f.parents?.[0] ?? null),
    name: f.name,
    mime_type: f.mimeType,
    modified_time: new Date(f.modifiedTime).toISOString(),
    web_url:
      f.webViewLink ??
      (folder ? `https://drive.google.com/drive/folders/${f.id}` : `https://drive.google.com/file/d/${f.id}`),
    trashed: f.trashed === true,
  };
}

export function googleDrive(): DriveSource {
  const rootId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID?.trim() ?? '';
  let token: { value: string; expires: number } | null = null;

  async function accessToken(): Promise<string> {
    if (token && token.expires > Date.now() + 60_000) return token.value;
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (!raw) throw new DriveUnavailable('GOOGLE_SERVICE_ACCOUNT_JSON fehlt');
    let key: { client_email: string; private_key: string };
    try {
      key = JSON.parse(raw) as typeof key;
    } catch {
      throw new DriveUnavailable('GOOGLE_SERVICE_ACCOUNT_JSON ist kein gültiges JSON');
    }
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
      iss: key.client_email,
      scope: 'https://www.googleapis.com/auth/drive.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(key.private_key, 'base64url');
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${unsigned}.${signature}`,
      }),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
    if (!res.ok || !body.access_token) throw new DriveUnavailable(`Anmeldung bei Google: HTTP ${res.status}`);
    token = { value: body.access_token, expires: Date.now() + (body.expires_in ?? 3600) * 1000 };
    return token.value;
  }

  /** GET an die Drive-API; liefert den HTTP-Status mit, damit ungültige Token erkennbar sind */
  async function get<T>(path: string, params: Record<string, string>): Promise<{ status: number; body: T }> {
    const url = `${API}/${path}?${new URLSearchParams({ supportsAllDrives: 'true', ...params })}`;
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { authorization: `Bearer ${await accessToken()}` },
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
    } catch (e) {
      if (e instanceof DriveUnavailable) throw e;
      throw new DriveUnavailable(`Drive nicht erreichbar: ${(e as Error).name}`);
    }
    const body = (await res.json().catch(() => ({}))) as T;
    return { status: res.status, body };
  }

  async function ok<T>(path: string, params: Record<string, string>): Promise<T> {
    const { status, body } = await get<T & { error?: { message?: string } }>(path, params);
    if (status !== 200)
      throw new DriveUnavailable(`Drive: HTTP ${status} ${body.error?.message ?? ''}`.trim());
    return body;
  }

  return {
    configured: !!rootId && !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
    rootId,

    async listAll() {
      if (!rootId) throw new DriveUnavailable('GOOGLE_DRIVE_ROOT_FOLDER_ID fehlt');
      // Token vor dem Einlesen holen: was sich währenddessen ändert, kommt mit dem nächsten Abgleich
      const { startPageToken } = await ok<{ startPageToken: string }>('changes/startPageToken', {});
      const root = await ok<GoogleFile>(`files/${encodeURIComponent(rootId)}`, { fields: FILE_FIELDS });
      const files: GoogleFile[] = [];
      let pageToken: string | undefined;
      // alles, was das Dienstkonto sieht – erreichbar von der Wurzel ist nur der Vereinsordner (reachableDriveIds)
      do {
        const page = await ok<{ files: GoogleFile[]; nextPageToken?: string }>('files', {
          q: 'trashed = false',
          fields: `nextPageToken,files(${FILE_FIELDS})`,
          pageSize: '1000',
          includeItemsFromAllDrives: 'true',
          ...(pageToken ? { pageToken } : {}),
        });
        files.push(...page.files);
        pageToken = page.nextPageToken;
      } while (pageToken);
      const items = files.filter((f) => f.id !== rootId).map((f) => toItem(f, rootId));
      return { items: [toItem(root, rootId), ...items], token: startPageToken };
    },

    async changes(since) {
      const changed = new Map<string, RemoteItem | null>();
      let pageToken = since;
      for (;;) {
        const { status, body } = await get<{
          changes?: { fileId: string; removed?: boolean; file?: GoogleFile }[];
          nextPageToken?: string;
          newStartPageToken?: string;
          error?: { message?: string };
        }>('changes', {
          pageToken,
          fields: `nextPageToken,newStartPageToken,changes(fileId,removed,file(${FILE_FIELDS}))`,
          pageSize: '1000',
          includeRemoved: 'true',
          includeItemsFromAllDrives: 'true',
          spaces: 'drive',
        });
        // abgelaufener oder fremder Token: vollständig neu einlesen
        if (status === 400 || status === 404 || status === 410) return null;
        if (status !== 200)
          throw new DriveUnavailable(`Drive: HTTP ${status} ${body.error?.message ?? ''}`.trim());
        for (const c of body.changes ?? [])
          changed.set(c.fileId, c.removed || !c.file ? null : toItem(c.file, rootId));
        if (body.newStartPageToken) {
          return {
            changed: [...changed].map(([file_id, item]) => ({ file_id, item })),
            token: body.newStartPageToken,
          };
        }
        if (!body.nextPageToken) throw new DriveUnavailable('Drive: Antwort ohne Token');
        pageToken = body.nextPageToken;
      }
    },
  };
}
