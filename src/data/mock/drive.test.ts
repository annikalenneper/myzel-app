// Phase 5 – Drive: Verzeichnis aus dem Cache, Abgleich über Changes-API, Suche, Verknüpfen, Ordner der Veranstaltung
import { beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../../shared/errors';
import type { FakeDrive } from '../../../server/p5/source';
import type { MyzelApi } from '../api';
import { createMockApi, type KeyValueStorage } from './mockApi';

function memoryStorage(): KeyValueStorage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

let api: MyzelApi;
let storage: KeyValueStorage;
/** nur gegen den Server: das nachgebaute Vereins-Drive */
let fake: FakeDrive | null;
let clock: Date;
const onServer = process.env.MYZEL_API === 'server';
const later = (ms: number) => (clock = new Date(clock.getTime() + ms));
const expectError = async (promise: Promise<unknown>, code: AppError['code']) => {
  const error = (await promise.then(
    () => null,
    (e: unknown) => e,
  )) as AppError | null;
  expect(error?.code).toBe(code);
};
const eventId = async (title: string) => (await api.listEvents()).find((e) => e.title === title)!.id;
const rawDb = () =>
  JSON.parse(storage.getItem('myzel:mock:db:v10')!) as {
    drive_remote: {
      items: { file_id: string; name: string; web_url: string; trashed: boolean }[];
      changes: unknown[];
      seq: number;
    };
  };
const remoteItem = (name: string) =>
  (fake ? fake.items : rawDb().drive_remote.items).find((i) => i.name === name)!;
/** jemand löscht die Datei oder den Ordner in Drive */
const trashRemote = (fileId: string) => {
  if (fake) return fake.trash(fileId);
  const raw = rawDb();
  raw.drive_remote.items.find((i) => i.file_id === fileId)!.trashed = true;
  raw.drive_remote.seq += 1;
  raw.drive_remote.changes.push({ seq: raw.drive_remote.seq, file_id: fileId });
  storage.setItem('myzel:mock:db:v10', JSON.stringify(raw));
};
/** der gespeicherte Token taugt nicht mehr (Drive vergisst alte Token) */
const expireToken = () => {
  if (fake) return fake.expireTokens();
  const raw = JSON.parse(storage.getItem('myzel:mock:db:v10')!) as {
    drive_sync_state: { changes_page_token: string | null };
  };
  raw.drive_sync_state.changes_page_token = 'abgelaufen';
  storage.setItem('myzel:mock:db:v10', JSON.stringify(raw));
};
const winterrave = async () => (await api.searchDrive('Winterrave')).find((e) => e.kind === 'ordner')!;

beforeEach(async () => {
  clock = new Date(2026, 9, 11, 12);
  storage = memoryStorage();
  fake = null;
  api = onServer
    ? await (
        await import('../../../server/api/serverApi')
      ).createServerApi({ now: () => clock, onDrive: (d) => (fake = d) })
    : createMockApi({ storage, now: () => clock });
  await api.demo!.signInAs('mo@example.org');
});

describe('Inhaltsverzeichnis (F-WIS-04, WF-WIS-08)', () => {
  it('zeigt die Wurzel aus dem Cache: Ordner zuerst, mit Anzahl, und wann abgeglichen wurde', async () => {
    const root = await api.getDriveFolder(null);
    expect(root.path.map((p) => p.name)).toEqual(['Myzel Drive']);
    expect(root.entries.map((e) => e.name)).toEqual([
      'Lager & Material',
      'Veranstaltungen',
      'Verein',
      'Vorlagen',
    ]);
    expect(root.entries.every((e) => e.kind === 'ordner' && e.child_count! > 0)).toBe(true);
    expect(root.sync.last_checked_at).not.toBeNull();
  });

  it('öffnet Unterordner mit Pfad und zeigt, womit Dateien verknüpft sind', async () => {
    const folder = await api.getDriveFolder((await winterrave()).file_id);
    expect(folder.path.map((p) => p.name)).toEqual(['Myzel Drive', 'Veranstaltungen', '2026-12 Winterrave']);
    expect(folder.entries.slice(0, 2).map((e) => e.name)).toEqual(['Booking', 'Flyer & Social']);
    const flyer = await api.getDriveFolder(folder.entries[1]!.file_id);
    const v3 = flyer.entries.find((e) => e.name === 'Flyer_Winterrave_v3.pdf')!;
    expect(v3.kind).toBe('pdf');
    expect(v3.link_summary).toBe('1 Aufgabe');
    expect(flyer.entries.find((e) => e.name === 'Flyer_Winterrave_v2.pdf')!.link_summary).toBeNull();
  });

  it('meldet einen unbekannten Ordner als nicht gefunden', async () => {
    await expectError(api.getDriveFolder('gibt-es-nicht'), 'not_found');
  });
});

describe('Suche und „Zuletzt geändert“ (F-WIS-08)', () => {
  it('sucht über Dateinamen im ganzen Verzeichnis und nennt den Ordnerpfad', async () => {
    const hits = await api.searchDrive('protokoll');
    expect(hits.map((h) => h.name)).toEqual([
      'Protokolle',
      'Protokoll Plenum August',
      'Protokoll Plenum Juli',
      'Protokoll Plenum September',
    ]);
    expect(hits[1]!.path).toBe('Verein / Protokolle');
    expect(await api.searchDrive('p')).toEqual([]);
  });

  it('listet die zuletzt geänderten Dateien ohne Ordner, neueste zuerst', async () => {
    const recent = await api.recentDrive();
    expect(recent.some((e) => e.kind === 'ordner')).toBe(false);
    expect(recent[0]!.name).toBe('Schichtplan Winterrave');
    const times = recent.map((e) => e.modified_time);
    expect([...times].sort().reverse()).toEqual(times);
  });
});

describe('Abgleich (3.13)', () => {
  it('zeigt eine neue Datei nach dem nächsten Abgleich – höchstens einmal pro Minute', async () => {
    const name = await api.demo!.driveAddFile();
    const folderId = (await winterrave()).file_id;
    const names = async () => (await api.getDriveFolder(folderId)).entries.map((e) => e.name);
    // der Seed-Abgleich liegt zwei Minuten zurück: der erste Abgleich holt die Änderung
    expect(await names()).not.toContain(name);
    expect(await api.syncDrive()).toEqual({ changed: 1 });
    expect(await names()).toContain(name);

    const second = await api.demo!.driveAddFile();
    later(30_000);
    expect(await api.syncDrive()).toEqual({ changed: 0 });
    expect(await names()).not.toContain(second);
    later(30_000);
    expect(await api.syncDrive()).toEqual({ changed: 1 });
    expect(await names()).toContain(second);
  });

  it('führt verknüpfte Dateien, die in Drive verschwinden, mit Hinweis weiter', async () => {
    // welche verknüpfte Datei, hängt von der Reihenfolge der Schicht ab
    const title = (await api.demo!.driveTrashLinkedFile())!;
    expect(title).toBeTruthy();
    const before = (await api.listDocuments()).find((d) => d.title === title)!;
    expect(before.drive_missing).toBe(false);
    await api.syncDrive();
    const after = (await api.listDocuments()).find((d) => d.title === title)!;
    expect(after.drive_missing).toBe(true);
    expect((await api.searchDrive(title)).length).toBe(0);
  });

  it('nimmt mit einem gelöschten Ordner auch seinen Inhalt aus dem Verzeichnis', async () => {
    trashRemote('drive-rave-flyer');
    await api.syncDrive();
    expect(await api.searchDrive('Flyer_Winterrave')).toEqual([]);
    expect((await api.recentDrive()).map((e) => e.name)).not.toContain('Insta-Story Winterrave.png');
    const flyer = (await api.listDocuments()).find((d) => d.title === 'Flyer_Winterrave_v3.pdf')!;
    expect(flyer.drive_missing).toBe(true);
    await expectError(api.linkDriveFile({ file_id: 'drive-flyer-v2', link: null }), 'not_found');
    // auch der Neuaufbau übernimmt die Kinder nicht
    await api.rebuildDrive();
    expect(await api.searchDrive('Flyer_Winterrave')).toEqual([]);
  });

  it('meldet auch einen Abgleich ohne Änderung, damit „abgeglichen vor …“ stimmt', async () => {
    let calls = 0;
    api.subscribe(() => (calls += 1));
    later(3 * 3_600_000);
    expect(await api.syncDrive()).toEqual({ changed: 0 });
    expect(calls).toBe(1);
    expect((await api.getDriveFolder(null)).sync.last_checked_at).toBe(clock.toISOString());
  });

  it('baut bei ungültigem Token vollständig neu auf', async () => {
    const fullBefore = (await api.getDriveFolder(null)).sync.last_full_sync_at;
    expireToken();
    await api.demo!.driveAddFile();
    expect((await api.syncDrive()).changed).toBe(1);
    const sync = (await api.getDriveFolder(null)).sync;
    expect(sync.last_full_sync_at).not.toBe(fullBefore);
    expect(sync.last_full_sync_at).toBe(clock.toISOString());
  });

  it('„Neu einlesen“ baut den Cache vollständig neu auf (WF-WIS-10)', async () => {
    const name = await api.demo!.driveAddFile();
    const { count } = await api.rebuildDrive();
    expect(count).toBeGreaterThan(25);
    expect((await api.searchDrive(name)).map((e) => e.name)).toEqual([name]);
    expect((await api.getDriveFolder(null)).sync.last_full_sync_at).toBe(clock.toISOString());
  });

  it('baut wöchentlich mit dem Joblauf neu auf', async () => {
    await api.demo!.driveAddFile();
    later(7 * 86_400_000);
    await api.demo!.runJobNow();
    expect((await api.getDriveFolder(null)).sync.last_full_sync_at).toBe(clock.toISOString());
  });
});

describe('Datei aus dem Verzeichnis verknüpfen (F-WIS-05, WF-WIS-09)', () => {
  it('legt den Dokument-Eintrag beim ersten Verknüpfen an und nutzt ihn danach wieder', async () => {
    const [getraenke] = await api.searchDrive('Getränkeliste');
    const rave = await eventId('Winterrave');
    const first = await api.linkDriveFile({
      file_id: getraenke!.file_id,
      doc_type: 'sonstiges',
      link: { target_type: 'event', target_id: rave },
    });
    expect(first.created).toBe(true);
    const doc = (await api.listDocuments()).find((d) => d.id === first.document_id)!;
    expect(doc).toMatchObject({
      title: 'Getränkeliste',
      drive_file_id: getraenke!.file_id,
      url: getraenke!.web_url,
    });

    const task = (await api.listTasks()).find((t) => t.title.startsWith('Getränke'))!;
    const second = await api.linkDriveFile({
      file_id: getraenke!.file_id,
      doc_type: 'protokoll',
      link: { target_type: 'task', target_id: task.id },
    });
    expect(second).toEqual({ document_id: first.document_id, created: false });
    expect((await api.listDocuments()).filter((d) => d.title === 'Getränkeliste')).toHaveLength(1);
    // ein erfasstes Dokument behält seinen Typ
    expect((await api.listLinkedDocuments('task', task.id)).map((d) => [d.title, d.doc_type])).toContainEqual(
      ['Getränkeliste', 'sonstiges'],
    );
    expect((await api.searchDrive('Getränkeliste'))[0]!.link_summary).toBe('2 verknüpft');
    expect((await api.getTask(task.id)).history[0]!.action).toBe('document_linked');
  });

  it('ein Drive-Link „Per Link“ und dieselbe Datei „Aus Drive“ ergeben ein Dokument', async () => {
    const [plan] = await api.searchDrive('Schichtplan Winterrave');
    const rave = await eventId('Winterrave');
    const { id } = await api.createDocument({
      title: 'Schichten',
      url: `${plan!.web_url}/edit#gid=0`,
      doc_type: 'schichtplan',
      link: null,
    });
    expect((await api.searchDrive('Schichtplan Winterrave'))[0]!.link_summary).toBe('erfasst');
    const linked = await api.linkDriveFile({
      file_id: plan!.file_id,
      link: { target_type: 'event', target_id: rave },
    });
    expect(linked).toEqual({ document_id: id, created: false });
    // erneut per Link erfasst: kein zweiter Eintrag, nur die Verknüpfung
    const again = await api.createDocument({
      title: 'Nochmal',
      url: plan!.web_url,
      doc_type: 'sonstiges',
      link: { target_type: 'decision', target_id: (await api.listDecisions())[0]!.id },
    });
    expect(again.id).toBe(id);
    expect((await api.search('Schichten')).find((g) => g.key === 'dokumente')!.items).toHaveLength(1);
    expect((await api.searchDrive('Schichtplan Winterrave'))[0]!.link_summary).toBe('2 verknüpft');
  });

  it('ein Drive-Link, den der Cache noch nicht kennt, wird später als dieselbe Datei erkannt', async () => {
    const name = await api.demo!.driveAddFile();
    // der Abgleich lief gerade erst: die neue Datei steht noch nicht im Cache
    await api.syncDrive();
    const second = await api.demo!.driveAddFile();
    const remote = remoteItem(second);
    const first = await api.createDocument({
      title: 'Notiz',
      url: `${remote.web_url}/edit`,
      doc_type: 'sonstiges',
    });
    expect(first.created).toBe(true);
    expect((await api.listDocuments()).find((d) => d.id === first.id)!.drive_file_id).toBeNull();

    later(60_000);
    await api.syncDrive();
    const [hit] = await api.searchDrive(second);
    expect(hit!.link_summary).toBe('erfasst');
    expect(await api.linkDriveFile({ file_id: hit!.file_id, link: null })).toEqual({
      document_id: first.id,
      created: false,
    });
    expect((await api.listDocuments()).find((d) => d.id === first.id)!.drive_file_id).toBe(remote.file_id);
    expect(name).not.toBe(second);
  });

  it('ein „Per Link“ erfasstes Drive-Dokument bekommt den Hinweis, wenn die Datei verschwindet', async () => {
    await api.demo!.driveAddFile();
    await api.syncDrive();
    later(60_000);
    // die Datei kommt erst mit dem nächsten Abgleich – erfasst wird sie vorher per Link
    const second = await api.demo!.driveAddFile();
    const remote = remoteItem(second);
    const { id } = await api.createDocument({ title: 'Notiz', url: remote.web_url, doc_type: 'sonstiges' });
    await api.syncDrive();
    const doc = async () => (await api.listDocuments()).find((d) => d.id === id)!;
    expect(await doc()).toMatchObject({ drive_file_id: null, drive_missing: false });

    trashRemote(remote.file_id);
    later(60_000);
    await api.syncDrive();
    expect((await doc()).drive_missing).toBe(true);
    // auch dann legt ein erneuter Link keinen zweiten Eintrag an
    expect(await api.createDocument({ title: 'x', url: remote.web_url, doc_type: 'sonstiges' })).toEqual({
      id,
      created: false,
    });
  });

  it('ein Link auf einen Ordner zählt nicht als Dokument zu diesem Ordner', async () => {
    await api.createDocument({
      title: 'Ordner',
      url: 'https://drive.google.com/open?id=drive-winterrave',
      doc_type: 'sonstiges',
    });
    const [folder] = (await api.searchDrive('2026-12 Winterrave')).filter((e) => e.kind === 'ordner');
    expect(folder).toMatchObject({ document_id: null, link_summary: null });
  });

  it('erfasst auch ohne Ziel und lehnt Ordner ab', async () => {
    const [satzung] = await api.searchDrive('Satzung');
    await api.linkDriveFile({ file_id: satzung!.file_id, doc_type: 'leitlinie', link: null });
    expect((await api.searchDrive('Satzung'))[0]!.link_summary).toBe('erfasst');
    await expectError(api.linkDriveFile({ file_id: (await winterrave()).file_id, link: null }), 'rule');
    await expectError(api.linkDriveFile({ file_id: 'gibt-es-nicht', link: null }), 'not_found');
  });
});

describe('Drive-Ordner der Veranstaltung (F-VER-03, WF-VER-14)', () => {
  it('zeigt den Inhalt des Ordners aus dem Cache und lässt ihn ändern und entfernen', async () => {
    const rave = await api.getEventDetail(await eventId('Winterrave'));
    expect(rave.drive_folder?.name).toBe('2026-12 Winterrave');
    expect(rave.drive_folder?.entries.map((e) => e.name)).toContain('Schichtplan Winterrave');

    const soliId = await eventId('Soli-Tresen Sporenflug');
    const soli = await api.getEventDetail(soliId);
    expect(soli.drive_folder).toBeNull();
    const [hoffest] = await api.searchDrive('Hoffest');
    await api.setEventDriveFolder(soliId, hoffest!.file_id, soli.version);
    const updated = await api.getEventDetail(soliId);
    expect(updated.drive_folder?.entries.map((e) => e.name)).toEqual(['Abrechnung Hoffest']);
    expect(updated.version).toBe(soli.version + 1);

    await expectError(api.setEventDriveFolder(soliId, null, soli.version), 'conflict');
    await api.setEventDriveFolder(soliId, null, updated.version);
    expect((await api.getEventDetail(soliId)).drive_folder).toBeNull();
  });

  it('nimmt nur Ordner und zeigt einen verschwundenen Ordner mit Hinweis', async () => {
    const id = await eventId('Winterrave');
    const rave = await api.getEventDetail(id);
    const [file] = await api.searchDrive('Getränkeliste');
    await expectError(api.setEventDriveFolder(id, file!.file_id, rave.version), 'validation');

    trashRemote(rave.drive_folder!.file_id);
    await api.syncDrive();
    const after = await api.getEventDetail(id);
    expect(after.drive_folder).toMatchObject({ name: '2026-12 Winterrave', missing: true, entries: [] });
  });
});
