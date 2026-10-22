// Drive-Cache auf dem Server: was nur hier vorkommt – Google nicht erreichbar, Wurzel gewechselt, ausgeschlossene
// Ordner, leerer Cache vor dem ersten Einlesen, aus dem Vereinsordner verschoben, gleichzeitige Abgleiche.
// Das gemeinsame Verhalten prüft src/data/mock/drive.test.ts auf beiden Schichten.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DocumentListItem, DriveEntry, DriveFolder } from '../../src/data/api';
import { AppError } from '../../src/shared/errors';
import { handleAction } from '../api/handle';
import { createLocalDb, type LocalDb } from '../db/localDb';
import { seedDrive, seedFromMock, testAuthId } from '../db/seedFromMock';
import { weeklyRebuild } from './drive';
import { DriveUnavailable, setDriveSource, type DriveSource, type FakeDrive } from './source';

let local: LocalDb;
let fake: FakeDrive;
let login: { authUserId: string; email: string };
const now = new Date(2026, 9, 11, 12);
const act = (action: string, ...args: unknown[]) => handleAction(local.db, login, action, args, now);
const folder = (id: string | null = null) => act('getDriveFolder', id) as Promise<DriveFolder>;
const search = (q: string) => act('searchDrive', q) as Promise<DriveEntry[]>;
const docs = () => act('listDocuments') as Promise<DocumentListItem[]>;
const cached = async () =>
  (await local.db.selectFrom('drive_items').select('file_id').execute()).map((r) => r.file_id);
const errorCode = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => (e instanceof AppError ? e.code : String(e)),
  );

/** zählt die Aufrufe bei Drive und reicht sie an das nachgebaute Drive weiter */
function counting(source: DriveSource) {
  const calls = { listAll: 0, changes: 0 };
  const wrapped: DriveSource = {
    configured: source.configured,
    rootId: source.rootId,
    listAll: (deadline) => (calls.listAll++, source.listAll(deadline)),
    changes: (token, deadline) => (calls.changes++, source.changes(token, deadline)),
  };
  setDriveSource(wrapped);
  return calls;
}

beforeEach(async () => {
  local = await createLocalDb();
  await seedFromMock(local.db, now);
  fake = seedDrive(now);
  const mo = await local.db
    .selectFrom('members')
    .select(['id', 'email'])
    .where('email', '=', 'mo@example.org')
    .executeTakeFirstOrThrow();
  login = { authUserId: testAuthId(mo.id), email: mo.email! };
});
afterEach(async () => {
  delete process.env.GOOGLE_DRIVE_EXCLUDED_FOLDER_IDS;
  await local.db.destroy();
});

describe('Drive auf dem Server', () => {
  it('Drive nicht erreichbar: verständlicher Fehler, Cache bleibt, erneuter Versuch erst nach einer Minute', async () => {
    const calls = { n: 0 };
    setDriveSource({
      configured: true,
      rootId: fake.rootId,
      listAll: async () => (calls.n++, Promise.reject(new DriveUnavailable('Drive: HTTP 503'))),
      changes: async () => (calls.n++, Promise.reject(new DriveUnavailable('Drive: HTTP 503'))),
    });
    expect(await errorCode(act('syncDrive'))).toBe('network');
    expect((await folder()).entries.length).toBeGreaterThan(0);
    expect(await act('syncDrive')).toEqual({ changed: 0, checked: false });
    expect(calls.n).toBe(1);
  });

  it('gleichzeitige Abgleiche fragen Drive nur einmal', async () => {
    const calls = counting(fake);
    fake.put({
      file_id: 'drive-neu-1',
      parent_id: 'drive-lager',
      name: 'Werkzeugliste',
      mime_type: 'application/vnd.google-apps.spreadsheet',
      modified_time: now.toISOString(),
      web_url: 'https://docs.google.com/spreadsheets/d/drive-neu-1',
    });
    const results = await Promise.all([act('syncDrive'), act('syncDrive'), act('syncDrive')]);
    expect(calls.changes).toBe(1);
    expect(results).toContainEqual({ changed: 1, checked: true });
    expect((await search('Werkzeug')).map((e) => e.name)).toEqual(['Werkzeugliste']);
  });

  it('noch nie eingelesen: leeres Verzeichnis, der erste Abgleich liest alles ein', async () => {
    await local.db.deleteFrom('drive_items').execute();
    await local.db.deleteFrom('drive_sync_state').execute();
    const empty = await folder();
    expect(empty).toMatchObject({ entries: [], sync: { last_checked_at: null, last_full_sync_at: null } });
    expect(await act('syncDrive')).toEqual({ changed: 1, checked: true });
    expect((await folder()).path.map((p) => p.name)).toEqual(['Myzel Drive']);
  });

  it('eine andere Wurzel führt zum vollständigen Neuaufbau', async () => {
    const calls = counting({
      configured: true,
      rootId: 'drive-veranstaltungen',
      listAll: () => fake.listAll(),
      changes: (t) => fake.changes(t),
    });
    await act('syncDrive');
    expect(calls).toEqual({ listAll: 1, changes: 0 });
    expect((await folder()).path.map((p) => p.name)).toEqual(['Veranstaltungen']);
    // nur noch der neue Ordner – Verknüpftes von außerhalb bleibt als „nicht mehr vorhanden“
    expect(await search('Inventarliste')).toEqual([]);
    expect((await docs()).find((d) => d.title === 'Code of Conduct')!.drive_missing).toBe(true);
  });

  it('ausgeschlossene Ordner erscheinen nicht und landen nicht im Cache (außer Verknüpftem)', async () => {
    process.env.GOOGLE_DRIVE_EXCLUDED_FOLDER_IDS = 'drive-verein';
    await act('rebuildDrive');
    expect(await search('Protokoll Plenum Juli')).toEqual([]);
    const ids = await cached();
    expect(ids).not.toContain('drive-protokoll-07');
    // auf den Code of Conduct verweist ein Dokument: bleibt im Cache, gilt aber als nicht mehr vorhanden
    expect(ids).toContain('drive-coc');
    expect((await docs()).find((d) => d.title === 'Code of Conduct')!.drive_missing).toBe(true);
  });

  it('aus dem Vereinsordner verschoben: verschwindet aus Verzeichnis und Cache, Verknüpftes mit Hinweis', async () => {
    const outside = (id: string) => {
      const item = fake.items.find((i) => i.file_id === id)!;
      fake.put({ ...item, parent_id: 'fremder-ordner' });
    };
    outside('drive-inventar');
    outside('drive-hausordnung');
    await act('syncDrive');
    expect(await search('Inventarliste')).toEqual([]);
    const ids = await cached();
    expect(ids).not.toContain('drive-inventar');
    expect(ids).toContain('drive-hausordnung');
    expect((await docs()).find((d) => d.title === 'Hausordnung Lager')!.drive_missing).toBe(true);
  });

  it('Joblauf: ohne eingerichtetes Drive passiert nichts', async () => {
    const calls = counting({
      configured: false,
      rootId: fake.rootId,
      listAll: () => fake.listAll(),
      changes: (t) => fake.changes(t),
    });
    expect(await weeklyRebuild(local.db, new Date(now.getTime() + 8 * 86_400_000), Date.now() + 5_000)).toBe(
      false,
    );
    expect(calls.listAll).toBe(0);
  });

  it('Joblauf: nach einem Fehlschlag erst eine Stunde später erneut', async () => {
    const calls = { n: 0 };
    setDriveSource({
      configured: true,
      rootId: fake.rootId,
      listAll: async () => (calls.n++, Promise.reject(new DriveUnavailable('Drive: HTTP 503'))),
      changes: async () => null,
    });
    const week = new Date(now.getTime() + 8 * 86_400_000);
    await expect(weeklyRebuild(local.db, week, Date.now() + 5_000)).rejects.toThrow();
    expect(await weeklyRebuild(local.db, new Date(week.getTime() + 15 * 60_000), Date.now() + 5_000)).toBe(
      false,
    );
    expect(calls.n).toBe(1);
  });

  it('ein leerer Ordnername wird nicht als Drive-Ordner gespeichert', async () => {
    const events = (await act('listEvents')) as { id: string; title: string; version: number }[];
    const soli = events.find((e) => e.title === 'Soli-Tresen Sporenflug')!;
    expect(await errorCode(act('setEventDriveFolder', soli.id, '', soli.version))).toBe('validation');
  });
});
