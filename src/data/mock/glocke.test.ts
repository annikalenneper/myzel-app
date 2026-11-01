// Verbesserungen 31.10.2026: Glocke (WF-ALL-10) und Kategorie eines Dokuments (WF-WIS-15).
// Mit MYZEL_API=server laufen dieselben Tests gegen die echten Server-Funktionen auf PGlite.
import { beforeEach, describe, expect, it } from 'vitest';
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
let clock: Date;
const login = (name: string) => api.demo!.signInAs(`${name}@example.org`);
const inboxOf = async (name: string) => {
  await login(name);
  const inbox = await api.listInbox();
  await login('mo');
  return inbox;
};

beforeEach(async () => {
  clock = new Date(2026, 9, 11, 12, 0, 0);
  api =
    process.env.MYZEL_API === 'server'
      ? await (await import('../../../server/api/serverApi')).createServerApi({ now: () => clock })
      : createMockApi({ storage: memoryStorage(), now: () => clock });
  await login('mo');
});

describe('Glocke (WF-ALL-10)', () => {
  it('zeigt Änderungen anderer seit dem letzten Blick; eigene Aktionen nicht', async () => {
    const task = (await api.listTasks()).find((t) => t.title.startsWith('Getränke'))!;
    await login('jule');
    await api.markInboxSeen();
    expect((await api.listInbox()).unread).toBe(0);
    await login('mo');
    clock = new Date(clock.getTime() + 60_000);
    await api.setTaskStatus(task.id, { status: 'in_arbeit', version: task.version });
    const jule = await inboxOf('jule');
    expect(jule.unread).toBe(1);
    expect(jule.entries[0]).toMatchObject({ link: `/agenda/${task.id}`, event_type: 'status' });
    expect(jule.entries[0]!.text).toContain('In Arbeit');
    // die handelnde Person bekommt keinen Eintrag für die eigene Aktion
    expect((await api.listInbox()).entries.some((e) => e.event_type === 'eigene_aktion')).toBe(false);

    clock = new Date(clock.getTime() + 60_000);
    await login('jule');
    await api.markInboxSeen();
    const seen = await api.listInbox();
    expect(seen.unread).toBe(0);
    expect(seen.entries.length).toBe(jule.entries.length);
  });

  it('„Rückgängig“ zieht den Eintrag zurück', async () => {
    const task = (await api.listTasks()).find((t) => t.title.startsWith('Getränke'))!;
    const before = (await inboxOf('jule')).entries.length;
    const { undo_token } = await api.setTaskStatus(task.id, { status: 'in_arbeit', version: task.version });
    expect((await inboxOf('jule')).entries.length).toBe(before + 1);
    await api.undo(undo_token);
    expect((await inboxOf('jule')).entries.length).toBe(before);
  });
});

describe('Kategorie eines Dokuments (WF-WIS-15)', () => {
  it('ändert die Art mit Versionsprüfung und Rückgängig', async () => {
    const doc = (await api.listDocuments()).find((d) => d.doc_type !== 'vorlage')!;
    const { undo_token } = await api.setDocumentType(doc.id, 'vorlage', doc.version);
    const changed = (await api.listDocuments()).find((d) => d.id === doc.id)!;
    expect(changed.doc_type).toBe('vorlage');
    await expect(api.setDocumentType(doc.id, 'protokoll', doc.version)).rejects.toMatchObject({
      code: 'conflict',
    });
    await expect(api.setDocumentType(doc.id, 'irgendwas' as never, changed.version)).rejects.toMatchObject({
      code: 'validation',
    });
    await api.undo(undo_token);
    expect((await api.listDocuments()).find((d) => d.id === doc.id)!.doc_type).toBe(doc.doc_type);
  });
});
