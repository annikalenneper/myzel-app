// Konsistenzprüfung: auf sauberem Bestand ohne Befund; jede eingeschleuste Verletzung wird gefunden und benannt.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleAction } from '../api/handle';
import { createFirstAdmin } from '../db/firstAdmin';
import { createLocalDb, type LocalDb } from '../db/localDb';
import { report, runChecks } from './checks';

let local: LocalDb;
// echte Uhrzeit: einige Prüfungen vergleichen mit now() der Datenbank (z. B. abgelaufene Rückgängig-Einträge)
const now = new Date();
const LEA_AUTH = '11111111-1111-4111-8111-111111111111';
const lea = { authUserId: LEA_AUTH, email: 'lea@example.org' };
const act = (action: string, ...args: unknown[]) => handleAction(local.db, lea, action, args, now);

const failing = async () =>
  (await runChecks(local.db))
    .filter((r) => r.findings.length > 0)
    .map((r) => [r.check.name, r.findings] as const);

let topicId: string;
let taskA: string;
let taskB: string;

beforeEach(async () => {
  local = await createLocalDb();
  await createFirstAdmin(local.db, 'lea@example.org', now);
  await act('getSession');
  topicId = ((await act('createTopic', { name: 'Werkstatt' })) as { id: string }).id;
  taskA = ((await act('createTask', { title: 'Regal bauen', topic_id: topicId })) as { id: string }).id;
  taskB = ((await act('createTask', { title: 'Holz holen', topic_id: topicId })) as { id: string }).id;
  await act('addBlocker', taskA, taskB);
  await local.pg.exec(
    `insert into job_runs (started_at, result, summary) values (now(), 'ok', 'Nichts zu tun')`,
  );
  await act('createEvent', { title: 'Soli-Abend', type: 'soli', starts_at: '2026-11-01T18:00:00.000Z' });
  // Drive gerade eingelesen (leeres Vereinsverzeichnis)
  await local.pg.exec(
    `insert into drive_sync_state (root_folder_id, last_checked_at, last_full_sync_at) values ('wurzel', now(), now())`,
  );
});
afterEach(async () => {
  await local.db.destroy();
});

describe('check:integrity', () => {
  it('auf einem über die Server-Funktionen entstandenen Bestand ohne Befund', async () => {
    // ersetzte Entscheidungen: die Nachfolgerin entsteht mit „created_as_replacement“
    const { id } = (await act('createDecision', {
      title: 'Werkstatt ist mittwochs offen',
      kind: 'entscheidung',
      topic_id: topicId,
      source_note: 'Absprache',
    })) as { id: string };
    await act('replaceDecision', id, {
      title: 'Werkstatt ist donnerstags offen',
      source_note: 'Absprache',
      version: 1,
    });
    expect(await failing()).toEqual([]);
    expect(report(await runChecks(local.db))).toContain('Alles in Ordnung.');
  });

  it('findet Zyklen, archivierte Themen mit aktiven Aufgaben und Aufgaben ohne Historie', async () => {
    // an den Server-Funktionen vorbei, wie es nur ein Fehler oder ein Eingriff im Dashboard könnte
    await local.pg.exec(`
      insert into task_blockers (task_id, blocker_task_id) values ('${taskB}', '${taskA}');
      update topics set archived_at = now() where id = '${topicId}';
      insert into tasks (title, topic_id, created_by)
        select 'Ohne Spur', '${topicId}', id from members where not is_system;
    `);
    const found = Object.fromEntries(await failing());
    expect(found['Keine Zyklen bei Abhängigkeiten']).toHaveLength(2);
    expect(found['Keine aktive Aufgabe in einem archivierten Thema']).toHaveLength(3);
    expect(found['Alles Angelegte hat seinen Eintrag „angelegt“ in der Historie']).toEqual([
      'Aufgabe „Ohne Spur“ ohne Historie',
    ]);
    expect(report(await runChecks(local.db))).toMatch(/FEHLER .*Zyklen[\s\S]*3 Prüfung\(en\) mit Fehlern/);
  });

  it('findet deaktivierte Bearbeitende, aufgehobene Einträge auf der Agenda und fehlende Admins', async () => {
    await act(
      'addAssignee',
      taskA,
      (
        await local.db
          .selectFrom('members')
          .select('id')
          .where('is_system', '=', false)
          .executeTakeFirstOrThrow()
      ).id,
    );
    await local.pg.exec(`
      insert into decisions (title, kind, topic_id, decided_on, status, source_note, created_by)
        select 'Alte Regel', 'entscheidung', '${topicId}', current_date, 'aufgehoben', 'Notiz', id
        from members where not is_system;
      insert into plenum_marks (decision_id, position, marked_by)
        select id, 1, created_by from decisions where title = 'Alte Regel';
      update members set active = false where not is_system;
    `);
    const found = Object.fromEntries(await failing());
    expect(found['Keine deaktivierten Bearbeitenden oder Folgenden']).toEqual([
      '#1 Regal bauen: Lea (bearbeitet)',
      '#1 Regal bauen: Lea (folgt)',
      '#2 Holz holen: Lea (folgt)',
    ]);
    expect(found['Auf der Agenda nur gültige oder offene Entscheidungen und Fakten']).toEqual([
      'Eintrag „Alte Regel“ (aufgehoben)',
    ]);
    expect(found['Mindestens eine aktive Person mit Admin-Rechten']).toEqual(['keine aktive Admin-Person']);
  });

  it('Phase 2: alte wartende Nachrichten, Kanäle Deaktivierter, ausgefallener Joblauf', async () => {
    await local.pg.exec(`
      insert into push_subscriptions (member_id, endpoint, p256dh, auth)
        select id, 'https://push.example.org/x', 'k', 'a' from members where not is_system;
      insert into notification_outbox (dedupe_key, member_id, event_type, channel, text, link, created_at)
        select 'alt:push', id, 'zuweisung', 'push', 'Text', '/', now() - interval '25 hours'
        from members where not is_system;
      update members set active = false where not is_system;
      delete from job_runs;
    `);
    const found = Object.fromEntries(await failing());
    expect(found['Keine Nachricht wartet länger als 24 Stunden in der Outbox']![0]).toMatch(
      /^1 Nachricht, die älteste von/,
    );
    expect(found['Deaktivierte haben keine Push-Abos und keine Telegram-Verknüpfung']).toEqual([
      'Lea (Push)',
    ]);
    expect(found['Erfolgreicher Joblauf in den letzten 2 Stunden']).toEqual(['noch kein Lauf']);
  });

  it('Phase 5: alter Drive-Cache, verschwundene verknüpfte Dateien und Ordner', async () => {
    await local.pg.exec(`
      update drive_sync_state set last_full_sync_at = now() - interval '9 days';
      insert into drive_items (file_id, parent_id, name, mime_type, modified_time, web_url, trashed, synced_at) values
        ('wurzel', null, 'Myzel', 'application/vnd.google-apps.folder', now(), 'https://drive.google.com/drive/folders/wurzel', false, now()),
        ('ordner', 'wurzel', 'Soli', 'application/vnd.google-apps.folder', now(), 'https://drive.google.com/drive/folders/ordner', true, now()),
        ('datei', 'ordner', 'Plan', 'application/pdf', now(), 'https://drive.google.com/file/d/datei', false, now()),
        ('da', 'wurzel', 'Satzung', 'application/pdf', now(), 'https://drive.google.com/file/d/da', false, now());
      insert into documents (title, url, drive_file_id, doc_type, tags, created_by)
        select 'Plan', 'https://drive.google.com/file/d/datei', 'datei', 'sonstiges', '[]', id from members where email = 'lea@example.org';
      insert into documents (title, url, drive_file_id, doc_type, tags, created_by)
        select 'Satzung', 'https://drive.google.com/file/d/da', 'da', 'sonstiges', '[]', id from members where email = 'lea@example.org';
      update events set drive_folder_id = 'ordner';
    `);
    const found = Object.fromEntries(await failing());
    expect(found['Drive-Cache in den letzten 8 Tagen vollständig neu eingelesen']![0]).toMatch(/^zuletzt /);
    // der Inhalt eines gelöschten Ordners zählt mit als verschwunden
    expect(found['Verknüpfte Drive-Dateien und Ordner der Veranstaltungen sind im Drive vorhanden']).toEqual([
      'Dokument „Plan“',
      'Ordner der Veranstaltung „Soli-Abend“',
    ]);
  });

  it('Phase 5: meldet ein nie eingelesenes Drive', async () => {
    await local.pg.exec(`delete from drive_sync_state`);
    expect(
      Object.fromEntries(await failing())['Drive-Cache in den letzten 8 Tagen vollständig neu eingelesen'],
    ).toEqual(['noch nie']);
  });

  it('läuft nur lesend', async () => {
    const before = await local.db.selectFrom('history').select('id').execute();
    await runChecks(local.db);
    expect(await local.db.selectFrom('history').select('id').execute()).toHaveLength(before.length);
  });
});
