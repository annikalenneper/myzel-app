// Phase 2 auf dem Server: echter Versand über Senders – Wiederholungen, ungültige Push-Abos, 9 Uhr in Köln,
// gleichzeitige Jobläufe, Telegram-Bot. Die fachlichen Regeln prüft src/data/mock/notify.test.ts auf beiden Schichten.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleAction } from '../api/handle';
import { TEST_PUSH_KEYS } from '../api/serverApi';
import { createFirstAdmin } from '../db/firstAdmin';
import { createLocalDb, type LocalDb } from '../db/localDb';
import { RetryLater, runJob, type Senders } from './notify';
import { handleTelegramUpdate } from './telegramBot';

let local: LocalDb;
process.env.TELEGRAM_BOT_USERNAME ??= 'myzel_bot';
// Sommerzeit: 10:00 in Köln
let now = new Date('2026-07-10T08:00:00Z');
const LEA = { authUserId: '11111111-1111-4111-8111-111111111111', email: 'lea@example.org' };
const JULE = { authUserId: '22222222-2222-4222-8222-222222222222', email: 'jule@example.org' };
const as = (login: typeof LEA, action: string, ...args: unknown[]) =>
  handleAction(local.db, login, action, args, now);
const later = (ms: number) => (now = new Date(now.getTime() + ms));

let juleId: string;
let topicId: string;

beforeEach(async () => {
  now = new Date('2026-07-10T08:00:00Z');
  local = await createLocalDb();
  await createFirstAdmin(local.db, LEA.email, now);
  await as(LEA, 'getSession');
  juleId = (
    (await as(LEA, 'createMember', { display_name: 'Jule', short: 'JU', email: JULE.email })) as {
      id: string;
    }
  ).id;
  await as(JULE, 'getSession');
  topicId = ((await as(LEA, 'createTopic', { name: 'Werkstatt' })) as { id: string }).id;
  // Jule hat Push auf einem Gerät und Telegram
  await as(JULE, 'savePushSubscription', {
    endpoint: 'https://fcm.googleapis.com/fcm/send/jule',
    keys: TEST_PUSH_KEYS,
  });
  await local.pg.query(`insert into telegram_links (member_id, chat_id) values ($1, 'chat-jule')`, [juleId]);
});
afterEach(async () => {
  await local.db.destroy();
});

const outbox = () => local.db.selectFrom('notification_outbox').selectAll().orderBy('channel').execute();

async function assignJule(due_date?: string) {
  const { id } = (await as(LEA, 'createTask', { title: 'Kabel kaufen', topic_id: topicId, due_date })) as {
    id: string;
  };
  await as(LEA, 'addAssignee', id, juleId);
  return id;
}

const recorder = (push: Senders['push'] = async () => 'ok') => {
  const sent: string[] = [];
  const senders: Senders = {
    push: async (sub, m) => {
      const result = await push(sub, m);
      sent.push(`push:${m.text}`);
      return result;
    },
    telegram: async (chat, m) => {
      sent.push(`telegram:${chat}:${m.link}`);
      return 'ok';
    },
  };
  return { sent, senders };
};

describe('Joblauf mit echtem Versand', () => {
  it('verschickt nach dem Rückgängig-Fenster einmal je Kanal und protokolliert den Lauf', async () => {
    const id = await assignJule();
    const { sent, senders } = recorder();
    await runJob(local.db, now, senders);
    expect(sent).toEqual([]);
    later(31_000);
    const run = await runJob(local.db, now, senders);
    expect(sent.sort()).toEqual([
      'push:Du bist jetzt bei „Kabel kaufen“ eingetragen.',
      `telegram:chat-jule:/aufgaben/${id}`,
    ]);
    expect(run).toMatchObject({
      result: 'ok',
      sent_push: 1,
      sent_telegram: 1,
      summary: '2 Nachrichten verschickt',
    });
    await runJob(local.db, now, senders);
    expect(sent).toHaveLength(2);
    expect((await outbox()).map((o) => o.status)).toEqual(['gesendet', 'gesendet']);
  });

  it('versucht es höchstens dreimal und hält den Grund fest', async () => {
    await assignJule();
    later(31_000);
    const { senders } = recorder(async () => {
      throw new Error('Push-Dienst antwortet 500.');
    });
    for (let i = 0; i < 4; i++) {
      await runJob(local.db, now, senders);
      later(15 * 60_000);
    }
    const push = (await outbox()).find((o) => o.channel === 'push')!;
    expect(push).toMatchObject({
      status: 'fehlgeschlagen',
      attempts: 3,
      last_error: 'Push-Dienst antwortet 500.',
    });
  });

  it('entfernt ungültige Push-Abos (404/410)', async () => {
    await assignJule();
    later(31_000);
    await runJob(local.db, now, recorder(async () => 'gone').senders);
    expect(await local.db.selectFrom('push_subscriptions').select('id').execute()).toEqual([]);
    expect((await outbox()).find((o) => o.channel === 'push')!.status).toBe('fehlgeschlagen');
  });

  it('lässt aus, was ein gleichzeitiger Lauf gerade verschickt', async () => {
    await assignJule();
    later(31_000);
    await local.db
      .updateTable('notification_outbox')
      .set({ locked_until: new Date(now.getTime() + 60_000).toISOString() })
      .execute();
    const { sent, senders } = recorder();
    await runJob(local.db, now, senders);
    expect(sent).toEqual([]);
    later(2 * 60_000);
    await runJob(local.db, now, senders);
    expect(sent).toHaveLength(2);
  });

  it('Fristerinnerungen ab 9 Uhr in Köln – der Server läuft in UTC', async () => {
    await assignJule('2026-07-10');
    // 08:30 in Köln (06:30 UTC): noch nichts
    now = new Date('2026-07-10T06:30:00Z');
    await runJob(local.db, now, recorder().senders);
    expect((await outbox()).some((o) => o.event_type === 'frist_heute')).toBe(false);
    // 09:05 in Köln
    now = new Date('2026-07-10T07:05:00Z');
    await runJob(local.db, now, recorder().senders);
    expect((await outbox()).filter((o) => o.event_type === 'frist_heute').map((o) => o.channel)).toEqual([
      'push',
      'telegram',
    ]);
  });

  it('Deaktivieren entfernt Push-Abos, Telegram und wartende Nachrichten', async () => {
    await assignJule();
    await as(LEA, 'deactivateMember', juleId);
    expect(await local.db.selectFrom('push_subscriptions').select('id').execute()).toEqual([]);
    expect(await local.db.selectFrom('telegram_links').select('chat_id').execute()).toEqual([]);
    expect(await outbox()).toEqual([]);
  });
});

describe('Review Phase 2: robuster Versand', () => {
  it('abgebrochene Läufe verbrauchen keine Versuche; ausgeschöpfte Nachrichten werden „fehlgeschlagen“', async () => {
    await assignJule();
    later(31_000);
    // ein Lauf beansprucht und bricht ab (Timeout der Function): Sperre gesetzt, kein Versuch gezählt
    await local.db
      .updateTable('notification_outbox')
      .set({ locked_until: new Date(now.getTime() + 120_000).toISOString() })
      .execute();
    expect((await outbox()).map((o) => o.attempts)).toEqual([0, 0]);
    later(3 * 60_000);
    const { sent, senders } = recorder();
    await runJob(local.db, now, senders);
    expect(sent).toHaveLength(2);
    // drei echte Fehlversuche, dann bleibt nichts im Wartezustand hängen
    await local.db
      .updateTable('notification_outbox')
      .set({ status: 'wartet', attempts: 3, locked_until: null })
      .execute();
    await runJob(local.db, now, senders);
    expect((await outbox()).map((o) => o.status)).toEqual(['fehlgeschlagen', 'fehlgeschlagen']);
  });

  it('viele Fristerinnerungen: wenige Abfragen, nichts doppelt', async () => {
    for (let i = 0; i < 30; i++) {
      const { id } = (await as(LEA, 'createTask', {
        title: `Aufgabe ${i}`,
        topic_id: topicId,
        due_date: '2026-07-05',
      })) as { id: string };
      await as(LEA, 'addAssignee', id, juleId);
    }
    later(31_000);
    const started = Date.now();
    await runJob(local.db, now, recorder().senders);
    await runJob(local.db, now, recorder().senders);
    expect(Date.now() - started).toBeLessThan(15_000);
    const overdue = (await outbox()).filter((o) => o.event_type === 'frist_ueberschritten');
    expect(overdue).toHaveLength(60);
    expect(new Set(overdue.map((o) => o.dedupe_key)).size).toBe(60);
  });

  it('Telegram: blockierter Bot beendet die Verknüpfung, 429 zählt nicht als Versuch', async () => {
    await assignJule();
    later(31_000);
    const busy: Senders = {
      push: async () => 'ok',
      telegram: async () => {
        throw new RetryLater('Telegram: zu viele Nachrichten, später noch einmal.');
      },
    };
    await runJob(local.db, now, busy);
    const waiting = (await outbox()).find((o) => o.channel === 'telegram')!;
    expect([waiting.status, waiting.attempts]).toEqual(['wartet', 0]);
    await runJob(local.db, now, { push: async () => 'ok', telegram: async () => 'gone' });
    expect((await outbox()).find((o) => o.channel === 'telegram')!.status).toBe('fehlgeschlagen');
    expect(await local.db.selectFrom('telegram_links').select('chat_id').execute()).toEqual([]);
  });

  it('mehrere Geräte: scheitert eines, bekommt das andere die Nachricht trotzdem nur einmal', async () => {
    await as(JULE, 'savePushSubscription', {
      endpoint: 'https://fcm.googleapis.com/fcm/send/jule-tablet',
      keys: TEST_PUSH_KEYS,
    });
    await assignJule();
    later(31_000);
    const sentTo: string[] = [];
    const flaky: Senders = {
      push: async (sub) => {
        if (sub.endpoint.endsWith('tablet')) throw new Error('Push-Dienst antwortet 500.');
        sentTo.push(sub.endpoint);
        return 'ok';
      },
      telegram: async () => 'ok',
    };
    for (let i = 0; i < 3; i++) {
      await runJob(local.db, now, flaky);
      later(15 * 60_000);
    }
    expect(sentTo).toEqual(['https://fcm.googleapis.com/fcm/send/jule']);
    expect((await outbox()).find((o) => o.channel === 'push')!.status).toBe('gesendet');
  });

  it('Systemstatus warnt, wenn nur noch fehlerhafte Läufe kommen', async () => {
    await local.pg.exec(`
      insert into job_runs (started_at, result, summary) values (now() - interval '3 hours', 'ok', 'Nichts zu tun');
      insert into job_runs (started_at, result, summary, error) values (now(), 'fehler', 'Lauf mit Fehler', 'x');
    `);
    const status = (await handleAction(local.db, LEA, 'getSystemStatus', [], new Date())) as {
      last_run_at: string;
      runs: unknown[];
    };
    expect(status.runs).toHaveLength(2);
    expect(Date.now() - new Date(status.last_run_at).getTime()).toBeGreaterThan(2 * 3_600_000);
  });

  it('Push-Abos nur von bekannten Push-Diensten, mit gültigen Schlüsseln, ohne fremde Geräte zu übernehmen', async () => {
    const code = (p: Promise<unknown>) =>
      p.then(
        () => null,
        (e: { code: string }) => e.code,
      );
    expect(
      await code(
        as(JULE, 'savePushSubscription', { endpoint: 'https://10.0.0.1/intern', keys: TEST_PUSH_KEYS }),
      ),
    ).toBe('validation');
    expect(
      await code(
        as(JULE, 'savePushSubscription', {
          endpoint: 'https://fcm.googleapis.com/fcm/send/x',
          keys: { p256dh: 'k', auth: 'a' },
        }),
      ),
    ).toBe('validation');
    const other = { p256dh: Buffer.alloc(65, 9).toString('base64url'), auth: TEST_PUSH_KEYS.auth };
    expect(
      await code(
        as(LEA, 'savePushSubscription', {
          endpoint: 'https://fcm.googleapis.com/fcm/send/jule',
          keys: other,
        }),
      ),
    ).toBe('rule');
    // nachgebaute Adressen, die nur so aussehen wie ein Push-Dienst
    for (const endpoint of [
      'https://fcm-googleapis.com/x',
      'https://evilpush-services-mozilla.com/x',
      'https://web-push-apple.com/x',
    ])
      expect(await code(as(JULE, 'savePushSubscription', { endpoint, keys: TEST_PUSH_KEYS }))).toBe(
        'validation',
      );
    for (const endpoint of [
      'https://updates.push.services.mozilla.com/wpush/v2/x',
      'https://web.push.apple.com/x',
      'https://wns2-par02p.notify.windows.com/w/?token=x',
    ])
      expect(await code(as(JULE, 'savePushSubscription', { endpoint, keys: TEST_PUSH_KEYS }))).toBeNull();
    // dasselbe Gerät mit denselben Schlüsseln: wechselt zur Person, die sich dort zuletzt eingeschaltet hat
    expect(
      await code(
        as(LEA, 'savePushSubscription', {
          endpoint: 'https://fcm.googleapis.com/fcm/send/jule',
          keys: TEST_PUSH_KEYS,
        }),
      ),
    ).toBeNull();
  });
});

describe('Phase 3: Termine im Joblauf', () => {
  it('Einladung beim Anlegen, Erinnerung 3 Tage vorher genau einmal – an Zusagen und ohne Antwort', async () => {
    const type = await local.db
      .selectFrom('appointment_types')
      .select('id')
      .where('label', '=', 'Bautag')
      .executeTakeFirstOrThrow();
    // Sa 12.07.2026, 10:00 in Köln – zwei Tage nach „jetzt“
    await as(LEA, 'createAppointment', {
      type_id: type.id,
      title: 'Bautag Juli',
      starts_at: '2026-07-12T08:00:00.000Z',
      ends_at: null,
      format: 'vor_ort',
      location: 'Lager',
      online_url: null,
      event_id: null,
    });
    const invitation = (await outbox()).filter((o) => o.event_type === 'termin_einladung');
    expect(invitation.map((o) => o.text)).toEqual([
      'Bautag Juli am So, 12.07., 10 Uhr (vor Ort) – kommst du?',
      'Bautag Juli am So, 12.07., 10 Uhr (vor Ort) – kommst du?',
    ]);
    later(31_000);
    await runJob(local.db, now, recorder().senders);
    await runJob(local.db, now, recorder().senders);
    const reminders = (await outbox()).filter((o) => o.event_type === 'termin_erinnerung');
    expect(reminders.map((o) => o.channel)).toEqual(['push', 'telegram']);
    expect(reminders[0]!.text).toBe('Nicht vergessen: Bautag Juli am So, 12.07., 10 Uhr.');
  });
});

describe('Telegram-Bot (6.4)', () => {
  const replies: string[] = [];
  const update = (chat: string, text: string) =>
    handleTelegramUpdate(
      local.db,
      { message: { chat: { id: chat, type: 'private' }, text } },
      now,
      'https://app',
      async (_c, t) => {
        replies.push(t);
      },
    );

  beforeEach(() => {
    replies.length = 0;
  });

  it('verknüpft über den Einmal-Code genau einmal', async () => {
    await as(JULE, 'unlinkTelegram');
    const { url } = (await as(JULE, 'startTelegramLink')) as { url: string };
    const code = new URL(url).searchParams.get('start')!;
    await update('4711', `/start ${code}`);
    expect(replies.pop()).toMatch(/^Hallo Jule, Telegram ist jetzt mit Myzel verbunden/);
    expect((await as(JULE, 'getNotificationSettings', null)) as { telegram: string }).toMatchObject({
      telegram: 'verbunden',
    });
    await update('4712', `/start ${code}`);
    expect(replies.pop()).toMatch(/abgelaufen oder wurde schon verwendet/);
  });

  it('unverknüpfte Chats bekommen nur einen Hinweis', async () => {
    await update('999', 'hallo');
    expect(replies.pop()).toBe(
      'Dieser Chat ist nicht mit Myzel verbunden. Verknüpfen kannst du ihn im Profil der App: https://app/profil',
    );
    await update('chat-jule', 'hallo');
    expect(replies.pop()).toMatch(/^Hier kommen deine Erinnerungen aus Myzel/);
  });

  it('ein abgelaufener Code verknüpft nichts', async () => {
    await as(JULE, 'unlinkTelegram');
    const { url } = (await as(JULE, 'startTelegramLink')) as { url: string };
    later(16 * 60_000);
    await update('4711', `/start ${new URL(url).searchParams.get('start')}`);
    expect(replies.pop()).toMatch(/abgelaufen/);
    expect(await local.db.selectFrom('telegram_links').select('chat_id').execute()).toEqual([]);
  });
});
