// Konsistenzprüfung: auf sauberem Bestand ohne Befund; jede eingeschleuste Verletzung wird gefunden und benannt.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleAction } from '../api/handle';
import { createFirstAdmin } from '../db/firstAdmin';
import { createLocalDb, type LocalDb } from '../db/localDb';
import { report, runChecks } from './checks';

let local: LocalDb;
const now = new Date(2026, 9, 21, 12);
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
});
afterEach(async () => {
  await local.db.destroy();
});

describe('check:integrity', () => {
  it('auf einem über die Server-Funktionen entstandenen Bestand ohne Befund', async () => {
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
    expect(
      found[
        'Jede Aufgabe, Veranstaltung, jedes Mitglied und Thema hat ihren Eintrag „angelegt“ in der Historie'
      ],
    ).toEqual(['Aufgabe „Ohne Spur“ ohne Historie']);
    expect(report(await runChecks(local.db))).toMatch(/FEHLER .*Zyklen[\s\S]*3 Prüfung\(en\) mit Fehlern/);
  });

  it('findet deaktivierte Bearbeitende, Markierungen an erledigten Aufgaben und fehlende Admins', async () => {
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
    await act('setPlenumMark', taskB, true);
    await local.pg.exec(`
      update members set active = false where not is_system;
      update tasks set status = 'erledigt' where id = '${taskB}';
    `);
    const found = Object.fromEntries(await failing());
    expect(found['Keine deaktivierten Bearbeitenden oder Folgenden']).toEqual([
      '#1 Regal bauen: Lea (bearbeitet)',
      '#1 Regal bauen: Lea (folgt)',
      '#2 Holz holen: Lea (folgt)',
    ]);
    expect(found['Markierung „Fürs Plenum“ nur an aktiven Aufgaben']).toEqual(['#2 Holz holen (erledigt)']);
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
    expect(found['Joblauf in den letzten 2 Stunden']).toEqual(['noch kein Lauf']);
  });

  it('läuft nur lesend', async () => {
    const before = await local.db.selectFrom('history').select('id').execute();
    await runChecks(local.db);
    expect(await local.db.selectFrom('history').select('id').execute()).toHaveLength(before.length);
  });
});
