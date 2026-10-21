// Phase 2 – Erinnerungen (ANFORDERUNGEN 3.11, 6): Outbox, Joblauf, Push-Abos, Telegram-Verknüpfung, Systemstatus.
// Wie die Testdaten-Schicht (src/data/mock/notify.ts), nur gegen die Datenbank und mit echtem Versand über `Senders`.
// Bis P6 feste Voreinstellungen (6.1): Push, sobald auf einem Gerät aktiv; Telegram, sobald verknüpft; eigene
// Statusänderungen nie.
import { sql, type Kysely } from 'kysely';
import { z } from 'zod';
import type { NotificationSettings, SystemStatus } from '../../src/data/api';
import { berlinDate, berlinHour } from '../../src/shared/rules/due';
import {
  DAILY_REMINDER_HOUR,
  dueReminderMessages,
  MAX_SEND_ATTEMPTS,
  NOTIFICATION_GROUPS,
  type Message,
} from '../../src/shared/rules/notifications';
import { UNDO_WINDOW_MS } from '../../src/shared/rules/undo';
import { NOTIFICATION_CHANNELS, type JobRun, type NotificationChannel } from '../../src/shared/schema';
import { parse, requireAdmin, rule, type Ctx, type Trx } from '../core/context';
import type { Database } from '../db/types';

type Db = Kysely<Database>;
export const TELEGRAM_CODE_MINUTES = 15;
/** so lange gehört eine Nachricht dem Joblauf, der sie gerade verschickt */
const CLAIM_MS = 2 * 60_000;
/** je Lauf höchstens so viele Nachrichten – eine Function hat nur wenige Sekunden */
const BATCH = 40;

/** Versand nach außen; in Tests ersetzt (server/p2/senders.ts für den Betrieb) */
export interface Senders {
  /** „gone“: das Abo ist ungültig (HTTP 404/410) und wird entfernt (6.1); sonst Fehler werfen */
  push(
    sub: { endpoint: string; p256dh: string; auth: string },
    message: { text: string; link: string },
  ): Promise<'ok' | 'gone'>;
  telegram(chatId: string, message: { text: string; link: string }): Promise<void>;
}

/** Alles läuft über die Outbox; der dedupe_key verhindert Doppelversand (6.1). `collect` merkt sich die neuen IDs. */
export async function enqueue(
  trx: Trx,
  now: Date,
  messages: readonly Message[],
  collect?: string[],
): Promise<number> {
  let added = 0;
  for (const m of messages) {
    // eigene Statusänderungen erst mit den Einstellungen ab P6 (6.2)
    if (m.own) continue;
    const member = await trx
      .selectFrom('members')
      .select(['id'])
      .where('id', '=', m.member_id)
      .where('active', '=', true)
      .where('is_system', '=', false)
      .executeTakeFirst();
    if (!member) continue;
    // je Anlass nur einmal: wer später einen weiteren Kanal einschaltet, bekommt nichts nachgeliefert
    const keys = NOTIFICATION_CHANNELS.map((c) => `${m.dedupe_key}:${c}`);
    const known = await trx
      .selectFrom('notification_outbox')
      .select('id')
      .where('dedupe_key', 'in', keys)
      .executeTakeFirst();
    if (known) continue;
    const channels: NotificationChannel[] = [];
    const [push, telegram] = await Promise.all([
      trx
        .selectFrom('push_subscriptions')
        .select('id')
        .where('member_id', '=', m.member_id)
        .executeTakeFirst(),
      trx
        .selectFrom('telegram_links')
        .select('member_id')
        .where('member_id', '=', m.member_id)
        .executeTakeFirst(),
    ]);
    if (push) channels.push('push');
    if (telegram) channels.push('telegram');
    for (const channel of channels) {
      const row = await trx
        .insertInto('notification_outbox')
        .values({
          dedupe_key: `${m.dedupe_key}:${channel}`,
          member_id: m.member_id,
          event_type: m.event_type,
          channel,
          text: m.text,
          link: m.link,
          created_at: now.toISOString(),
        })
        .onConflict((oc) => oc.column('dedupe_key').doNothing())
        .returning('id')
        .executeTakeFirst();
      if (!row) continue;
      collect?.push(row.id);
      added += 1;
    }
  }
  return added;
}

/** Nachrichten einer Aktion: in derselben Transaktion, „Rückgängig“ zieht sie zurück */
export const notify = (ctx: Ctx, messages: readonly Message[]) =>
  enqueue(ctx.trx, ctx.now, messages, ctx.outbox);

/** Fristerinnerungen des Tages (6.2): ab 9 Uhr in Köln; der dedupe_key macht wiederholte Läufe harmlos */
async function enqueueDueReminders(db: Db, now: Date): Promise<number> {
  if (berlinHour(now) < DAILY_REMINDER_HOUR) return 0;
  return db.transaction().execute(async (trx) => {
    const tasks = await trx
      .selectFrom('tasks')
      .select(['id', 'title', 'due_date', 'status', 'archived_at'])
      .where('due_date', 'is not', null)
      .where('archived_at', 'is', null)
      .where('status', 'in', ['neu', 'geplant', 'in_arbeit', 'blockiert'])
      .execute();
    if (tasks.length === 0) return 0;
    const ids = tasks.map((t) => t.id);
    const [assignees, followers] = await Promise.all([
      trx
        .selectFrom('task_assignees as a')
        .innerJoin('members as m', 'm.id', 'a.member_id')
        .select(['a.task_id', 'm.id', 'm.reminder_lead_days'])
        .where('a.task_id', 'in', ids)
        .execute(),
      trx.selectFrom('task_followers').select(['task_id', 'member_id']).where('task_id', 'in', ids).execute(),
    ]);
    const items = tasks.map((task) => ({
      task,
      assignees: assignees
        .filter((a) => a.task_id === task.id)
        .map((a) => ({ id: a.id, reminder_lead_days: a.reminder_lead_days })),
      followerIds: followers.filter((f) => f.task_id === task.id).map((f) => f.member_id),
    }));
    return enqueue(trx, now, dueReminderMessages(items, berlinDate(now)));
  });
}

/** Nachrichten für diesen Lauf beanspruchen – ohne das, was eine Aktion noch per „Rückgängig“ zurücknehmen kann */
async function claim(db: Db, now: Date) {
  return db.transaction().execute(async (trx) => {
    const settled = new Date(now.getTime() - UNDO_WINDOW_MS).toISOString();
    const recent = await trx
      .selectFrom('undo_actions')
      .select('outbox_ids')
      .where('created_at', '>=', settled)
      .execute();
    const undoable = recent.flatMap((r) => r.outbox_ids as string[]);
    const rows = await trx
      .selectFrom('notification_outbox')
      .selectAll()
      .where('status', '=', 'wartet')
      .where('attempts', '<', MAX_SEND_ATTEMPTS)
      .where((eb) => eb.or([eb('locked_until', 'is', null), eb('locked_until', '<', now.toISOString())]))
      .$if(undoable.length > 0, (q) => q.where('id', 'not in', undoable))
      .orderBy('created_at')
      .limit(BATCH)
      .forUpdate()
      .skipLocked()
      .execute();
    if (rows.length === 0) return [];
    await trx
      .updateTable('notification_outbox')
      .set((eb) => ({
        attempts: eb('attempts', '+', 1),
        locked_until: new Date(now.getTime() + CLAIM_MS).toISOString(),
      }))
      .where(
        'id',
        'in',
        rows.map((r) => r.id),
      )
      .execute();
    return rows.map((r) => ({ ...r, attempts: r.attempts + 1 }));
  });
}

type Outcome =
  { status: 'gesendet' } | { status: 'fehlgeschlagen'; error: string } | { status: 'nochmal'; error: string };

async function deliver(
  db: Db,
  senders: Senders,
  entry: Awaited<ReturnType<typeof claim>>[number],
): Promise<Outcome> {
  const message = { text: entry.text, link: entry.link };
  if (entry.channel === 'telegram') {
    const link = await db
      .selectFrom('telegram_links')
      .select('chat_id')
      .where('member_id', '=', entry.member_id)
      .executeTakeFirst();
    if (!link) return { status: 'fehlgeschlagen', error: 'Telegram ist nicht mehr verknüpft.' };
    await senders.telegram(link.chat_id, message);
    return { status: 'gesendet' };
  }
  const subs = await db
    .selectFrom('push_subscriptions')
    .select(['id', 'endpoint', 'p256dh', 'auth'])
    .where('member_id', '=', entry.member_id)
    .execute();
  let delivered = false;
  for (const sub of subs) {
    // ungültige Abos (404/410) werden entfernt (6.1)
    if ((await senders.push(sub, message)) === 'gone')
      await db.deleteFrom('push_subscriptions').where('id', '=', sub.id).execute();
    else delivered = true;
  }
  return delivered
    ? { status: 'gesendet' }
    : { status: 'fehlgeschlagen', error: 'Kein gültiges Push-Abo mehr.' };
}

/**
 * Ein Joblauf (alle 15 Minuten, E-07): Fristerinnerungen ab 9 Uhr, dann die Outbox abarbeiten, mit bis zu drei
 * Versuchen je Nachricht. Idempotent – fällt ein Lauf aus, holt der nächste nach, ohne etwas doppelt zu schicken.
 */
export async function runJob(db: Db, now: Date, senders: Senders): Promise<JobRun> {
  const started = now.toISOString();
  const sent: Record<NotificationChannel, number> = { push: 0, telegram: 0 };
  let reminders = 0;
  let retries = 0;
  let error: string | null = null;
  try {
    reminders = await enqueueDueReminders(db, now);
    for (const entry of await claim(db, now)) {
      let outcome: Outcome;
      try {
        outcome = await deliver(db, senders, entry);
      } catch (e) {
        const reason = e instanceof Error ? e.message.slice(0, 300) : 'Unbekannter Fehler';
        outcome =
          entry.attempts >= MAX_SEND_ATTEMPTS
            ? { status: 'fehlgeschlagen', error: reason }
            : { status: 'nochmal', error: reason };
      }
      if (outcome.status === 'nochmal') retries += 1;
      if (outcome.status === 'gesendet') sent[entry.channel] += 1;
      await db
        .updateTable('notification_outbox')
        .set({
          status: outcome.status === 'nochmal' ? 'wartet' : outcome.status,
          last_error: outcome.status === 'gesendet' ? null : outcome.error,
          sent_at: outcome.status === 'gesendet' ? new Date().toISOString() : null,
          locked_until: null,
        })
        .where('id', '=', entry.id)
        .execute();
    }
  } catch (e) {
    console.error(e);
    error = e instanceof Error ? e.message.slice(0, 300) : 'Unbekannter Fehler';
  }
  const total = sent.push + sent.telegram;
  const run = {
    started_at: started,
    finished_at: new Date(Math.max(Date.now(), now.getTime())).toISOString(),
    result: error ? ('fehler' as const) : ('ok' as const),
    summary: error
      ? 'Lauf abgebrochen'
      : total === 0
        ? 'Nichts zu tun'
        : reminders > 0
          ? `Fristerinnerungen: ${Math.min(reminders, total)} verschickt${total > reminders ? `, dazu ${total - reminders} weitere` : ''}`
          : `${total} ${total === 1 ? 'Nachricht' : 'Nachrichten'} verschickt`,
    error,
    sent_push: sent.push,
    sent_telegram: sent.telegram,
    retries,
  };
  const { id } = await db.insertInto('job_runs').values(run).returning('id').executeTakeFirstOrThrow();
  return { id, ...run };
}

// ── Profil: Push und Telegram (WF-PRO-02, WF-PRO-03) ─────────────────────────

export async function notificationSettings(
  ctx: Ctx,
  endpoint: string | null,
  botUsername: string | null,
): Promise<NotificationSettings> {
  const me = ctx.actor.id;
  const [push, link, code] = await Promise.all([
    endpoint
      ? ctx.trx
          .selectFrom('push_subscriptions')
          .select('id')
          .where('member_id', '=', me)
          .where('endpoint', '=', endpoint)
          .executeTakeFirst()
      : undefined,
    ctx.trx.selectFrom('telegram_links').select('member_id').where('member_id', '=', me).executeTakeFirst(),
    ctx.trx
      .selectFrom('telegram_link_codes')
      .select('code')
      .where('member_id', '=', me)
      .where('used_at', 'is', null)
      .where('expires_at', '>', ctx.now.toISOString())
      .orderBy('expires_at', 'desc')
      .executeTakeFirst(),
  ]);
  return {
    push: !!push,
    telegram: link ? 'verbunden' : code ? 'wartet' : 'aus',
    telegram_url: code && botUsername ? botLink(botUsername, code.code) : null,
    // [P6] Schalter-Matrix: bis dahin alles an
    matrix: NOTIFICATION_GROUPS.map((g) => ({ key: g.key, push: true, telegram: true })),
    reminder_lead_days: ctx.actor.reminder_lead_days,
    own_status: false,
  };
}

const botLink = (botUsername: string, code: string) => `https://t.me/${botUsername}?start=${code}`;

/** Kanal abgeschaltet: wartende Nachrichten dieses Kanals gehen nicht mehr raus, bleiben aber als Anlass stehen */
async function dropWaiting(trx: Trx, memberId: string, channel: NotificationChannel): Promise<void> {
  await trx
    .updateTable('notification_outbox')
    .set({ status: 'fehlgeschlagen', last_error: 'Kanal abgeschaltet.' })
    .where('member_id', '=', memberId)
    .where('channel', '=', channel)
    .where('status', '=', 'wartet')
    .execute();
}

const pushSubscriptionInput = z.object({
  endpoint: z.url({ protocol: /^https$/, error: 'Dieses Push-Abo ist ungültig.' }).max(1000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

/** WF-PRO-02: Push-Abo dieses Geräts speichern (ein Gerät gehört immer der Person, die zuletzt eingeschaltet hat) */
export async function savePushSubscription(ctx: Ctx, raw: unknown): Promise<void> {
  const input = parse(pushSubscriptionInput, raw);
  await ctx.trx.deleteFrom('push_subscriptions').where('endpoint', '=', input.endpoint).execute();
  await ctx.trx
    .insertInto('push_subscriptions')
    .values({
      member_id: ctx.actor.id,
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      created_at: ctx.now.toISOString(),
    })
    .execute();
}

/** WF-PRO-02, WF-LOG-03: Push auf diesem Gerät aus bzw. beim Abmelden */
export async function removePushSubscription(ctx: Ctx, endpoint: unknown): Promise<void> {
  if (typeof endpoint !== 'string' || endpoint.length === 0) return;
  await ctx.trx
    .deleteFrom('push_subscriptions')
    .where('endpoint', '=', endpoint)
    .where('member_id', '=', ctx.actor.id)
    .execute();
  const left = await ctx.trx
    .selectFrom('push_subscriptions')
    .select('id')
    .where('member_id', '=', ctx.actor.id)
    .executeTakeFirst();
  if (!left) await dropWaiting(ctx.trx, ctx.actor.id, 'push');
}

/** Einmal-Code für /start: 16 Zeichen aus einem Zufallsgenerator, den Telegram als start-Parameter erlaubt */
function newCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/** WF-PRO-03: Einmal-Code, 15 Minuten gültig, einmal verwendbar */
export async function startTelegramLink(
  ctx: Ctx,
  botUsername: string | null,
): Promise<{ url: string; expires_at: string }> {
  if (!botUsername) throw rule('Telegram ist noch nicht eingerichtet.');
  const linked = await ctx.trx
    .selectFrom('telegram_links')
    .select('member_id')
    .where('member_id', '=', ctx.actor.id)
    .executeTakeFirst();
  if (linked) throw rule('Telegram ist schon verbunden.');
  await ctx.trx.deleteFrom('telegram_link_codes').where('member_id', '=', ctx.actor.id).execute();
  const code = newCode();
  const expires_at = new Date(ctx.now.getTime() + TELEGRAM_CODE_MINUTES * 60_000).toISOString();
  await ctx.trx
    .insertInto('telegram_link_codes')
    .values({ code, member_id: ctx.actor.id, expires_at, used_at: null })
    .execute();
  return { url: botLink(botUsername, code), expires_at };
}

/** Was der Bot nach /start <code> tut: Code prüfen, einmal verwenden, Chat verknüpfen. Gibt den Namen zurück. */
export async function redeemTelegramCode(db: Db, now: Date, code: string, chatId: string): Promise<string> {
  return db.transaction().execute(async (trx) => {
    const entry = await trx
      .selectFrom('telegram_link_codes')
      .selectAll()
      .where('code', '=', code)
      .forUpdate()
      .executeTakeFirst();
    if (!entry || entry.used_at || new Date(entry.expires_at) <= now)
      throw rule('Der Link ist abgelaufen oder wurde schon verwendet. Bitte im Profil neu verknüpfen.');
    const member = await trx
      .selectFrom('members')
      .select(['id', 'display_name', 'active'])
      .where('id', '=', entry.member_id)
      .forShare()
      .executeTakeFirst();
    if (!member?.active) throw rule('Dieses Mitglied ist nicht aktiv.');
    await trx
      .updateTable('telegram_link_codes')
      .set({ used_at: now.toISOString() })
      .where('code', '=', code)
      .execute();
    // ein Chat gehört genau einem Mitglied: eine frühere Verknüpfung dieses Chats oder dieser Person endet
    await trx
      .deleteFrom('telegram_links')
      .where((eb) => eb.or([eb('member_id', '=', member.id), eb('chat_id', '=', chatId)]))
      .execute();
    await trx
      .insertInto('telegram_links')
      .values({ member_id: member.id, chat_id: chatId, linked_at: now.toISOString() })
      .execute();
    return member.display_name;
  });
}

/** Ist dieser Chat mit einem aktiven Mitglied verknüpft? (Webhook: unverknüpfte Chats bekommen nur einen Hinweis) */
export async function memberForChat(db: Db, chatId: string): Promise<string | null> {
  const row = await db
    .selectFrom('telegram_links as l')
    .innerJoin('members as m', 'm.id', 'l.member_id')
    .select('m.display_name')
    .where('l.chat_id', '=', chatId)
    .where('m.active', '=', true)
    .executeTakeFirst();
  return row?.display_name ?? null;
}

export async function unlinkTelegram(ctx: Ctx): Promise<void> {
  await ctx.trx.deleteFrom('telegram_links').where('member_id', '=', ctx.actor.id).execute();
  await ctx.trx.deleteFrom('telegram_link_codes').where('member_id', '=', ctx.actor.id).execute();
  await dropWaiting(ctx.trx, ctx.actor.id, 'telegram');
}

/** Deaktivierte behalten keine Push-Abos und keine Telegram-Verknüpfung (personenbezogen, Abschnitt 9) */
export async function dropChannels(trx: Trx, memberId: string): Promise<void> {
  await trx.deleteFrom('push_subscriptions').where('member_id', '=', memberId).execute();
  await trx.deleteFrom('telegram_links').where('member_id', '=', memberId).execute();
  await trx.deleteFrom('telegram_link_codes').where('member_id', '=', memberId).execute();
  await trx
    .deleteFrom('notification_outbox')
    .where('member_id', '=', memberId)
    .where('status', '=', 'wartet')
    .execute();
}

/** WF-ADM-07: letzte Jobläufe und Kennzahlen, nur für Admins */
export async function systemStatus(ctx: Ctx): Promise<SystemStatus> {
  requireAdmin(ctx);
  const dayAgo = new Date(ctx.now.getTime() - 24 * 3_600_000).toISOString();
  const count = (q: { executeTakeFirstOrThrow(): Promise<{ n: number | string | bigint }> }) =>
    q.executeTakeFirstOrThrow().then((r) => Number(r.n));
  const [runs, waiting, failed, pushSubs, linked, members] = await Promise.all([
    ctx.trx.selectFrom('job_runs').selectAll().orderBy('started_at', 'desc').limit(5).execute(),
    count(
      ctx.trx
        .selectFrom('notification_outbox')
        .select((eb) => eb.fn.countAll().as('n'))
        .where('status', '=', 'wartet'),
    ),
    // bewusst abgeschaltete Kanäle sind kein Zustellfehler (nie versucht)
    count(
      ctx.trx
        .selectFrom('notification_outbox')
        .select((eb) => eb.fn.countAll().as('n'))
        .where('status', '=', 'fehlgeschlagen')
        .where('attempts', '>', 0)
        .where('created_at', '>=', dayAgo),
    ),
    count(
      ctx.trx
        .selectFrom('push_subscriptions as s')
        .innerJoin('members as m', 'm.id', 's.member_id')
        .select((eb) => eb.fn.countAll().as('n'))
        .where('m.active', '=', true),
    ),
    count(
      ctx.trx
        .selectFrom('telegram_links as l')
        .innerJoin('members as m', 'm.id', 'l.member_id')
        .select((eb) => eb.fn.countAll().as('n'))
        .where('m.active', '=', true),
    ),
    count(
      ctx.trx
        .selectFrom('members')
        .select((eb) => eb.fn.countAll().as('n'))
        .where('active', '=', true)
        .where('is_system', '=', false),
    ),
  ]);
  return {
    runs,
    last_run_at: runs[0]?.started_at ?? null,
    outbox_waiting: waiting,
    failed_24h: failed,
    push_subscriptions: pushSubs,
    telegram_linked: linked,
    active_members: members,
  };
}

/** Nur für Tests und die Demo-Werkzeuge: die letzten Nachrichten an eine Person */
export async function messagesFor(db: Db, memberId: string) {
  return db
    .selectFrom('notification_outbox')
    .select([
      'id',
      'dedupe_key',
      'member_id',
      'event_type',
      'channel',
      'text',
      'link',
      'status',
      'attempts',
      'created_at',
      'sent_at',
    ])
    .where('member_id', '=', memberId)
    .orderBy('created_at', 'desc')
    .orderBy(sql`id`)
    .limit(8)
    .execute();
}
