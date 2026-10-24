// Phase 2 – Erinnerungen (ANFORDERUNGEN 3.11, 6): Outbox, Joblauf, Push-Abos, Telegram-Verknüpfung, Systemstatus.
// Wie die Testdaten-Schicht (src/data/mock/notify.ts), nur gegen die Datenbank und mit echtem Versand über `Senders`.
// Bis P6 feste Voreinstellungen (6.1): Push, sobald auf einem Gerät aktiv; Telegram, sobald verknüpft; eigene
// Statusänderungen nie.
import { sql, type ExpressionBuilder, type Kysely } from 'kysely';
import { z } from 'zod';
import type { NotificationSettings, SystemStatus } from '../../src/data/api';
import { appointmentReminderMessages, yesAndOpen } from '../../src/shared/rules/appointments';
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
import { weeklyRebuild } from '../p5/drive';

type Db = Kysely<Database>;
export const TELEGRAM_CODE_MINUTES = 15;
/** so lange gehört eine Nachricht dem Joblauf, der sie gerade verschickt */
const CLAIM_MS = 2 * 60_000;
/** je Lauf höchstens so viele Nachrichten beanspruchen */
const BATCH = 40;
/** Zeitbudget je Lauf für den Versand – eine Netlify Function hat 10 Sekunden, ein Aufruf nach außen höchstens 4 */
const SEND_BUDGET_MS = 4_500;
/** [P5] Ende des ganzen Laufs (Drive nach dem Versand); weniger Restzeit als DRIVE_MIN_MS: Drive beim nächsten Lauf */
const JOB_BUDGET_MS = 9_000;
const DRIVE_MIN_MS = 3_000;
/** gesendete und fehlgeschlagene Nachrichten, Jobläufe: so lange aufbewahren (Datensparsamkeit, 9) */
const KEEP_DAYS = 30;
const OPEN_STATUSES = ['neu', 'geplant', 'in_arbeit', 'blockiert'] as const;

export type SendResult = 'ok' | 'gone';

/** Versand nach außen; in Tests ersetzt (server/p2/senders.ts für den Betrieb) */
export interface Senders {
  /** „gone“: das Abo ist ungültig (HTTP 404/410) und wird entfernt (6.1); sonst Fehler werfen */
  push(
    sub: { endpoint: string; p256dh: string; auth: string },
    message: { text: string; link: string },
  ): Promise<SendResult>;
  /** „gone“: der Chat ist nicht mehr erreichbar (Bot blockiert, Chat gelöscht) – die Verknüpfung endet */
  telegram(chatId: string, message: { text: string; link: string }): Promise<SendResult>;
}

/** Vorübergehend zu viele Nachrichten (Telegram 429): später noch einmal, ohne dass es als Versuch zählt */
export class RetryLater extends Error {}

const chunks = <T>(items: readonly T[], size = 500): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

/**
 * Alles läuft über die Outbox; der dedupe_key verhindert Doppelversand (6.1). `collect` merkt sich die neuen IDs.
 * Mengenweise: je Tabelle eine Abfrage, ein Insert – auch bei vielen Fristerinnerungen in einem Lauf.
 */
export async function enqueue(
  trx: Trx,
  now: Date,
  messages: readonly Message[],
  collect?: string[],
): Promise<number> {
  if (messages.length === 0) return 0;
  const memberIds = [...new Set(messages.map((m) => m.member_id))];
  const [active, push, telegram] = await Promise.all([
    trx
      .selectFrom('members')
      .select('id')
      .where('id', 'in', memberIds)
      .where('active', '=', true)
      .where('is_system', '=', false)
      .execute(),
    trx.selectFrom('push_subscriptions').select('member_id').where('member_id', 'in', memberIds).execute(),
    trx.selectFrom('telegram_links').select('member_id').where('member_id', 'in', memberIds).execute(),
  ]);
  const isActive = new Set(active.map((r) => r.id));
  const hasPush = new Set(push.map((r) => r.member_id));
  const hasTelegram = new Set(telegram.map((r) => r.member_id));
  // je Anlass nur einmal: wer später einen weiteren Kanal einschaltet, bekommt nichts nachgeliefert
  const allKeys = messages.flatMap((m) => NOTIFICATION_CHANNELS.map((c) => `${m.dedupe_key}:${c}`));
  const known = new Set<string>();
  for (const part of chunks(allKeys)) {
    const rows = await trx
      .selectFrom('notification_outbox')
      .select('dedupe_key')
      .where('dedupe_key', 'in', part)
      .execute();
    for (const r of rows) known.add(r.dedupe_key.slice(0, r.dedupe_key.lastIndexOf(':')));
  }
  const rows = [];
  for (const m of messages) {
    if (!isActive.has(m.member_id) || known.has(m.dedupe_key)) continue;
    known.add(m.dedupe_key);
    const channels: NotificationChannel[] = [];
    if (hasPush.has(m.member_id)) channels.push('push');
    if (hasTelegram.has(m.member_id)) channels.push('telegram');
    for (const channel of channels)
      rows.push({
        dedupe_key: `${m.dedupe_key}:${channel}`,
        member_id: m.member_id,
        event_type: m.event_type,
        channel,
        text: m.text,
        link: m.link,
        created_at: now.toISOString(),
      });
  }
  let added = 0;
  for (const part of chunks(rows, 200)) {
    const inserted = await trx
      .insertInto('notification_outbox')
      .values(part)
      .onConflict((oc) => oc.column('dedupe_key').doNothing())
      .returning('id')
      .execute();
    collect?.push(...inserted.map((r) => r.id));
    added += inserted.length;
  }
  return added;
}

/** Nachrichten einer Aktion: in derselben Transaktion, „Rückgängig“ zieht sie zurück */
export const notify = (ctx: Ctx, messages: readonly Message[]) =>
  enqueue(ctx.trx, ctx.now, messages, ctx.outbox);

/**
 * Fristerinnerungen (6.2): jeder Lauf ab 9 Uhr in Köln reiht ein, was heute ansteht; der dedupe_key (Aufgabe,
 * Person, Frist) macht wiederholte Läufe harmlos.
 */
async function enqueueDueReminders(db: Db, now: Date): Promise<number> {
  if (berlinHour(now) < DAILY_REMINDER_HOUR) return 0;
  return db.transaction().execute(async (trx) => {
    const tasks = await trx
      .selectFrom('tasks')
      .select(['id', 'title', 'due_date', 'status', 'archived_at'])
      .where('due_date', 'is not', null)
      .where('archived_at', 'is', null)
      .where('status', 'in', OPEN_STATUSES)
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

/**
 * [P3] Termin-Erinnerungen 3 Tage und 1 Stunde vorher an Zusagen und ohne Antwort (6.2) – jeder Lauf, höchstens
 * 15 Minuten Abweichung; der dedupe_key (Termin, Person, Beginn) verhindert Wiederholungen.
 */
async function enqueueAppointmentReminders(db: Db, now: Date): Promise<number> {
  return db.transaction().execute(async (trx) => {
    const soon = new Date(now.getTime() + 3 * 24 * 3_600_000).toISOString();
    const appointments = await trx
      .selectFrom('appointments')
      .selectAll()
      .where('archived_at', 'is', null)
      .where('status', '=', 'geplant')
      .where('starts_at', '>', now.toISOString())
      .where('starts_at', '<=', soon)
      .execute();
    if (appointments.length === 0) return 0;
    const [people, rsvps] = await Promise.all([
      trx
        .selectFrom('members')
        .select('id')
        .where('active', '=', true)
        .where('is_system', '=', false)
        .execute(),
      trx
        .selectFrom('appointment_rsvps')
        .selectAll()
        .where(
          'appointment_id',
          'in',
          appointments.map((a) => a.id),
        )
        .execute(),
    ]);
    const ids = people.map((p) => p.id);
    const items = appointments.map((appointment) => ({
      appointment,
      recipientIds: yesAndOpen(
        rsvps.filter((r) => r.appointment_id === appointment.id),
        ids,
      ),
    }));
    return enqueue(trx, now, appointmentReminderMessages(items, now));
  });
}

/**
 * Nachrichten für diesen Lauf beanspruchen – ohne das, was eine Aktion noch per „Rückgängig“ zurücknehmen kann.
 * Gezählt wird ein Versuch erst beim Versand; was nach drei Versuchen noch wartet, gilt als fehlgeschlagen.
 */
async function claim(db: Db, now: Date) {
  return db.transaction().execute(async (trx) => {
    const free = (eb: ExpressionBuilder<Database, 'notification_outbox'>) =>
      eb.or([eb('locked_until', 'is', null), eb('locked_until', '<', now.toISOString())]);
    await trx
      .updateTable('notification_outbox')
      .set({ status: 'fehlgeschlagen', last_error: 'Nach drei Versuchen aufgegeben.', locked_until: null })
      .where('status', '=', 'wartet')
      .where('attempts', '>=', MAX_SEND_ATTEMPTS)
      .where(free)
      .execute();
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
      .where(free)
      .$if(undoable.length > 0, (q) => q.where('id', 'not in', undoable))
      .orderBy('created_at')
      .limit(BATCH)
      .forUpdate()
      .skipLocked()
      .execute();
    if (rows.length === 0) return [];
    await trx
      .updateTable('notification_outbox')
      .set({ locked_until: new Date(now.getTime() + CLAIM_MS).toISOString() })
      .where(
        'id',
        'in',
        rows.map((r) => r.id),
      )
      .execute();
    return rows;
  });
}

type Entry = Awaited<ReturnType<typeof claim>>[number];
type Outcome =
  | { status: 'gesendet' }
  | { status: 'fehlgeschlagen'; error: string }
  | { status: 'nochmal'; error: string; counts: boolean };

const reason = (e: unknown) => (e instanceof Error ? e.message.slice(0, 300) : 'Unbekannter Fehler');

async function deliver(db: Db, senders: Senders, entry: Entry, attempt: number): Promise<Outcome> {
  const message = { text: entry.text, link: entry.link };
  const again = (e: unknown): Outcome =>
    e instanceof RetryLater
      ? { status: 'nochmal', error: reason(e), counts: false }
      : attempt >= MAX_SEND_ATTEMPTS
        ? { status: 'fehlgeschlagen', error: reason(e) }
        : { status: 'nochmal', error: reason(e), counts: true };
  if (entry.channel === 'telegram') {
    const link = await db
      .selectFrom('telegram_links')
      .select(['member_id', 'chat_id'])
      .where('member_id', '=', entry.member_id)
      .executeTakeFirst();
    if (!link) return { status: 'fehlgeschlagen', error: 'Telegram ist nicht mehr verknüpft.' };
    try {
      if ((await senders.telegram(link.chat_id, message)) === 'ok') return { status: 'gesendet' };
    } catch (e) {
      return again(e);
    }
    // Bot blockiert oder Chat weg: diese Verknüpfung endet (eine inzwischen neue bleibt), das Profil zeigt wieder
    // „Verknüpfen“; die übrigen wartenden Telegram-Nachrichten der Person gehen nicht mehr raus
    const ended = await db
      .deleteFrom('telegram_links')
      .where('member_id', '=', link.member_id)
      .where('chat_id', '=', link.chat_id)
      .executeTakeFirst();
    if (Number(ended.numDeletedRows) > 0)
      await db.transaction().execute((trx) => dropWaiting(trx, link.member_id, 'telegram', entry.id));
    return { status: 'fehlgeschlagen', error: 'Telegram-Chat nicht mehr erreichbar – Verknüpfung beendet.' };
  }
  // an jedes Gerät der Person höchstens einmal: was schon zugestellt ist, bleibt bei einer Wiederholung aus
  const done = new Set(entry.delivered_to as string[]);
  const subs = await db
    .selectFrom('push_subscriptions')
    .select(['id', 'endpoint', 'p256dh', 'auth'])
    .where('member_id', '=', entry.member_id)
    .execute();
  let failure: unknown = null;
  // alle Geräte gleichzeitig – ein hängender Push-Dienst kostet nur einmal die Zeitgrenze
  const open = subs.filter((sub) => !done.has(sub.endpoint));
  const results = await Promise.allSettled(open.map((sub) => senders.push(sub, message)));
  for (const [i, result] of results.entries()) {
    const sub = open[i]!;
    if (result.status === 'rejected') failure = result.reason;
    // ungültige Abos (404/410) werden entfernt (6.1)
    else if (result.value === 'gone')
      await db.deleteFrom('push_subscriptions').where('id', '=', sub.id).execute();
    else done.add(sub.endpoint);
  }
  await db
    .updateTable('notification_outbox')
    .set({ delivered_to: JSON.stringify([...done]) })
    .where('id', '=', entry.id)
    .execute();
  if (failure) {
    const outcome = again(failure);
    // nach dem letzten Versuch zählt, dass wenigstens ein Gerät sie bekommen hat
    return outcome.status === 'fehlgeschlagen' && done.size > 0 ? { status: 'gesendet' } : outcome;
  }
  return done.size > 0
    ? { status: 'gesendet' }
    : { status: 'fehlgeschlagen', error: 'Kein gültiges Push-Abo mehr.' };
}

/** Aufräumen (Datensparsamkeit, 9): alte Nachrichten und Läufe, benutzte und abgelaufene Telegram-Codes */
async function cleanUp(db: Db, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - KEEP_DAYS * 24 * 3_600_000).toISOString();
  await db
    .deleteFrom('notification_outbox')
    .where('status', '<>', 'wartet')
    .where('created_at', '<', cutoff)
    .execute();
  await db.deleteFrom('job_runs').where('started_at', '<', cutoff).execute();
  await db
    .deleteFrom('telegram_link_codes')
    .where((eb) => eb.or([eb('used_at', 'is not', null), eb('expires_at', '<', now.toISOString())]))
    .execute();
}

/**
 * Ein Joblauf (alle 15 Minuten, E-07): Fristerinnerungen ab 9 Uhr, dann die Outbox abarbeiten, mit bis zu drei
 * Versuchen je Nachricht und einem Zeitbudget. Idempotent – fällt ein Lauf aus, holt der nächste nach, ohne etwas
 * doppelt zu schicken. Ein Fehler beim Einreihen hält den Versand nicht auf.
 */
export async function runJob(db: Db, now: Date, senders: Senders): Promise<JobRun> {
  const started = now.toISOString();
  const jobStart = Date.now();
  const deadline = jobStart + SEND_BUDGET_MS;
  const sent: Record<NotificationChannel, number> = { push: 0, telegram: 0 };
  let reminders = 0;
  let retries = 0;
  const errors: string[] = [];
  try {
    reminders = await enqueueDueReminders(db, now);
  } catch (e) {
    console.error(e);
    errors.push(`Fristerinnerungen: ${reason(e)}`);
  }
  try {
    reminders += await enqueueAppointmentReminders(db, now);
  } catch (e) {
    console.error(e);
    errors.push(`Termin-Erinnerungen: ${reason(e)}`);
  }
  try {
    const claimed = await claim(db, now);
    for (const [i, entry] of claimed.entries()) {
      if (Date.now() > deadline) {
        // Zeit um: der Rest bleibt für den nächsten Lauf
        await db
          .updateTable('notification_outbox')
          .set({ locked_until: null })
          .where(
            'id',
            'in',
            claimed.slice(i).map((r) => r.id),
          )
          .execute();
        break;
      }
      const attempt = entry.attempts + 1;
      await db
        .updateTable('notification_outbox')
        .set({ attempts: attempt })
        .where('id', '=', entry.id)
        .execute();
      let outcome: Outcome;
      try {
        outcome = await deliver(db, senders, entry, attempt);
      } catch (e) {
        outcome = { status: 'nochmal', error: reason(e), counts: true };
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
          ...(outcome.status === 'nochmal' && !outcome.counts ? { attempts: entry.attempts } : {}),
        })
        .where('id', '=', entry.id)
        .execute();
    }
    await cleanUp(db, now);
  } catch (e) {
    console.error(e);
    errors.push(`Versand: ${reason(e)}`);
  }
  // [P5] Drive-Cache wöchentlich vollständig neu (3.13 Nr. 4) – nach dem Versand, mit dem restlichen Zeitbudget;
  // reicht es nicht, kommt der nächste Lauf dran
  const driveDeadline = jobStart + JOB_BUDGET_MS;
  if (driveDeadline - Date.now() >= DRIVE_MIN_MS)
    try {
      await weeklyRebuild(db, now, driveDeadline);
    } catch (e) {
      console.error(e);
      errors.push(`Drive: ${reason(e)}`);
    }
  const error = errors.length > 0 ? errors.join(' · ').slice(0, 500) : null;
  const total = sent.push + sent.telegram;
  const count = `${total} ${total === 1 ? 'Nachricht' : 'Nachrichten'} verschickt`;
  const run = {
    started_at: started,
    finished_at: new Date(Math.max(Date.now(), now.getTime())).toISOString(),
    result: error ? ('fehler' as const) : ('ok' as const),
    summary: error
      ? total > 0
        ? `Mit Fehler, ${count}`
        : 'Lauf mit Fehler'
      : total === 0
        ? 'Nichts zu tun'
        : reminders > 0
          ? `${reminders} Erinnerungen eingereiht, ${count}`
          : count,
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
  };
}

const CHANNEL_OFF = 'Kanal abgeschaltet.';

const botLink = (botUsername: string, code: string) => `https://t.me/${botUsername}?start=${code}`;

/** Kanal abgeschaltet: wartende Nachrichten dieses Kanals gehen nicht mehr raus, bleiben aber als Anlass stehen */
async function dropWaiting(
  trx: Trx,
  memberId: string,
  channel: NotificationChannel,
  exceptId?: string,
): Promise<void> {
  await trx
    .updateTable('notification_outbox')
    .set({ status: 'fehlgeschlagen', last_error: CHANNEL_OFF })
    .where('member_id', '=', memberId)
    .where('channel', '=', channel)
    .where('status', '=', 'wartet')
    .$if(!!exceptId, (q) => q.where('id', '<>', exceptId!))
    .execute();
}

/**
 * Nur Adressen der bekannten Push-Dienste (Google, Mozilla, Apple, Microsoft) – der Joblauf ruft sie später auf,
 * eine beliebige Adresse dürfte er nicht anfragen.
 */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /\.push\.services\.mozilla\.com$/,
  /^web\.push\.apple\.com$/,
  /\.notify\.windows\.com$/,
];
const invalidPush = 'Dieses Push-Abo ist ungültig.';
/** Schlüssel des Browsers: base64url, p256dh 65 Bytes (öffentlicher Schlüssel), auth 16 Bytes */
const keyOfBytes = (bytes: number) =>
  z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/, invalidPush)
    .refine((v) => Buffer.from(v, 'base64url').length === bytes, invalidPush);
const pushSubscriptionInput = z.object({
  endpoint: z
    .url({ protocol: /^https$/, error: invalidPush })
    .max(1000)
    .refine((v) => PUSH_HOSTS.some((host) => host.test(new URL(v).hostname)), invalidPush),
  keys: z.object({ p256dh: keyOfBytes(65), auth: keyOfBytes(16) }),
});

/** WF-PRO-02: Push-Abo dieses Geräts speichern (ein Gerät gehört immer der Person, die zuletzt eingeschaltet hat) */
export async function savePushSubscription(ctx: Ctx, raw: unknown): Promise<void> {
  const input = parse(pushSubscriptionInput, raw);
  // dasselbe Gerät (gleiche Schlüssel) wechselt die Person; fremde Schlüssel für einen bekannten Endpoint nicht
  const existing = await ctx.trx
    .selectFrom('push_subscriptions')
    .select(['member_id', 'p256dh', 'auth'])
    .where('endpoint', '=', input.endpoint)
    .executeTakeFirst();
  if (existing && (existing.p256dh !== input.keys.p256dh || existing.auth !== input.keys.auth))
    throw rule(invalidPush);
  await ctx.trx.deleteFrom('push_subscriptions').where('endpoint', '=', input.endpoint).execute();
  // wer damit kein Gerät mehr hat, bekommt wartende Push-Nachrichten nicht mehr (sie gingen sonst an dieses Gerät)
  if (existing && existing.member_id !== ctx.actor.id)
    await dropWaitingIfNoDevice(ctx.trx, existing.member_id);
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
  await dropWaitingIfNoDevice(ctx.trx, ctx.actor.id);
}

async function dropWaitingIfNoDevice(trx: Trx, memberId: string): Promise<void> {
  const left = await trx
    .selectFrom('push_subscriptions')
    .select('id')
    .where('member_id', '=', memberId)
    .executeTakeFirst();
  if (!left) await dropWaiting(trx, memberId, 'push');
}

/** Einmal-Code für /start: 16 Zeichen aus einem Zufallsgenerator, den Telegram als start-Parameter erlaubt */
function newCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  // ohne Verzerrung: nur Bytes unterhalb des größten Vielfachen der Alphabetlänge
  const limit = 256 - (256 % alphabet.length);
  let code = '';
  while (code.length < 16)
    for (const b of crypto.getRandomValues(new Uint8Array(32)))
      if (b < limit && code.length < 16) code += alphabet[b % alphabet.length];
  return code;
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
  const [runs, lastOk, waiting, failed, pushSubs, linked, members] = await Promise.all([
    ctx.trx.selectFrom('job_runs').selectAll().orderBy('started_at', 'desc').limit(5).execute(),
    ctx.trx
      .selectFrom('job_runs')
      .select('started_at')
      .where('result', '=', 'ok')
      .orderBy('started_at', 'desc')
      .executeTakeFirst(),
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
        .where((eb) => eb.or([eb('last_error', 'is', null), eb('last_error', '<>', CHANNEL_OFF)]))
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
    // die Warnung nach 2 Stunden richtet sich nach dem letzten Lauf ohne Fehler
    last_run_at: lastOk?.started_at ?? null,
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
