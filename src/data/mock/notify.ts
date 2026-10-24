// Testdaten-Schicht, Phase 2: Outbox, Joblauf, Push-Abos und Telegram-Verknüpfung (ANFORDERUNGEN 3.11, 6).
// Verschickt wird hier nichts – „gesendet“ heißt nur, dass der Joblauf die Nachricht abgearbeitet hat.
import { AppError } from '../../shared/errors';
import { appointmentReminderMessages, yesAndOpen } from '../../shared/rules/appointments';
import { toIsoDate } from '../../shared/rules/due';
import {
  channelEnabled,
  DAILY_REMINDER_HOUR,
  dueReminderMessages,
  MAX_SEND_ATTEMPTS,
  NOTIFICATION_GROUPS,
  type Message,
  type NotificationGroupKey,
} from '../../shared/rules/notifications';
import {
  NOTIFICATION_CHANNELS,
  reminderLeadSchema,
  type JobRun,
  type NotificationChannel,
  type NotificationEvent,
  type OutboxEntry,
} from '../../shared/schema';
import type { NotificationSettings, SystemStatus } from '../api';
import { UNDO_WINDOW_MS } from '../../shared/rules/undo';
import { parse, touch, writeHistory, type Ctx, type Db } from './server';

const uuid = () => crypto.randomUUID();
export const TELEGRAM_CODE_MINUTES = 15;
const BOT_URL = 'https://t.me/myzo_the_bot';

/** Alles läuft über die Outbox; der dedupe_key verhindert Doppelversand (6.1). */
/** `collect` sammelt die neuen Einträge, damit ein „Rückgängig“ sie zurückziehen kann. */
export function enqueue(db: Db, now: Date, messages: readonly Message[], collect?: string[]): number {
  let added = 0;
  for (const m of messages) {
    const member = db.members.find((x) => x.id === m.member_id);
    if (!member || !member.active || member.is_system) continue;
    // Bis P6 feste Voreinstellungen: Push, sobald auf einem Gerät aktiv; Telegram, sobald verknüpft
    // Je Anlass nur einmal: Wer später einen weiteren Kanal einschaltet, bekommt nichts nachgeliefert
    if (
      NOTIFICATION_CHANNELS.some((c) =>
        db.notification_outbox.some((o) => o.dedupe_key === `${m.dedupe_key}:${c}`),
      )
    )
      continue;
    // eigene Statusänderungen nur, wenn die Person das eingeschaltet hat (6.2)
    if (m.own && !member.notify_own_status) continue;
    // [P6] Schalter-Matrix: je Ereignis und Kanal; ohne Eintrag aus (Rückmeldung vom 22.10.2026)
    const on = (c: NotificationChannel) =>
      channelEnabled(db.notification_preferences, member.id, m.event_type, c);
    const channels: NotificationChannel[] = [];
    if (on('push') && db.push_subscriptions.some((s) => s.member_id === member.id)) channels.push('push');
    if (on('telegram') && db.telegram_links.some((l) => l.member_id === member.id)) channels.push('telegram');
    for (const channel of channels) {
      const dedupe_key = `${m.dedupe_key}:${channel}`;
      const id = uuid();
      collect?.push(id);
      db.notification_outbox.push({
        id,
        dedupe_key,
        member_id: member.id,
        event_type: m.event_type,
        channel,
        text: m.text,
        link: m.link,
        status: 'wartet',
        attempts: 0,
        created_at: now.toISOString(),
        sent_at: null,
      });
      added += 1;
    }
  }
  return added;
}

/**
 * Ein Joblauf (alle 15 Minuten, E-07): Fristerinnerungen ab 9 Uhr, dann die Outbox abarbeiten.
 * Idempotent – fällt ein Lauf aus, holt der nächste nach, ohne etwas doppelt zu schicken.
 */
export function runJob(db: Db, now: Date): JobRun {
  const started = now.getTime();
  let reminders = 0;
  if (now.getHours() >= DAILY_REMINDER_HOUR) {
    const items = db.tasks.map((task) => ({
      task,
      assignees: db.task_assignees
        .filter((a) => a.task_id === task.id)
        .map((a) => db.members.find((m) => m.id === a.member_id))
        .filter((m) => !!m)
        .map((m) => ({ id: m.id, reminder_lead_days: m.reminder_lead_days })),
      followerIds: db.task_followers.filter((f) => f.task_id === task.id).map((f) => f.member_id),
    }));
    reminders = enqueue(db, now, dueReminderMessages(items, toIsoDate(now)));
  }
  const people = db.members.filter((m) => m.active && !m.is_system).map((m) => m.id);
  enqueue(
    db,
    now,
    appointmentReminderMessages(
      db.appointments
        .filter((a) => !a.archived_at)
        .map((appointment) => ({
          appointment,
          recipientIds: yesAndOpen(
            db.appointment_rsvps.filter((r) => r.appointment_id === appointment.id),
            people,
          ),
        })),
      now,
    ),
  );
  const sent: Record<NotificationChannel, number> = { push: 0, telegram: 0 };
  // Nachrichten einer Aktion, die noch per „Rückgängig“ zurückgenommen werden kann, warten bis zum
  // nächsten Lauf; Erinnerungen des Joblaufs selbst gehen sofort raus
  const settled = started - UNDO_WINDOW_MS;
  const undoable = new Set(
    // dieselbe Grenze wie in undo(): bis einschließlich 30 Sekunden nimmt der Server es noch an
    db.undo.filter((u) => new Date(u.created_at).getTime() >= settled).flatMap((u) => u.outbox_ids),
  );
  for (const entry of db.notification_outbox) {
    if (entry.status !== 'wartet' || entry.attempts >= MAX_SEND_ATTEMPTS) continue;
    if (undoable.has(entry.id)) continue;
    entry.attempts += 1;
    entry.status = 'gesendet';
    entry.sent_at = now.toISOString();
    sent[entry.channel] += 1;
  }
  const total = sent.push + sent.telegram;
  const run: JobRun = {
    id: uuid(),
    started_at: now.toISOString(),
    finished_at: new Date(started + 400 + total * 300).toISOString(),
    result: 'ok',
    summary:
      total === 0
        ? 'Nichts zu tun'
        : reminders > 0
          ? `Fristerinnerungen: ${Math.min(reminders, total)} verschickt${total > reminders ? `, dazu ${total - reminders} weitere` : ''}`
          : `${total} ${total === 1 ? 'Nachricht' : 'Nachrichten'} verschickt`,
    error: null,
    sent_push: sent.push,
    sent_telegram: sent.telegram,
    retries: 0,
  };
  db.job_runs.push(run);
  if (db.job_runs.length > 200) db.job_runs = db.job_runs.slice(-200);
  return run;
}

export function notificationSettings(ctx: Ctx, deviceId: string): NotificationSettings {
  const db = ctx.db;
  const code = db.telegram_link_codes
    .filter((c) => c.member_id === ctx.actor.id && !c.used_at && new Date(c.expires_at) > ctx.now)
    .at(-1);
  return {
    push: db.push_subscriptions.some((s) => s.member_id === ctx.actor.id && s.endpoint === deviceId),
    telegram: db.telegram_links.some((l) => l.member_id === ctx.actor.id)
      ? 'verbunden'
      : code
        ? 'wartet'
        : 'aus',
    telegram_url: code ? `${BOT_URL}?start=${code.code}` : null,
    matrix: NOTIFICATION_GROUPS.map((g) => ({
      key: g.key,
      // eine Zeile gilt als an, solange eines ihrer Ereignisse an ist – gesetzt wird immer die ganze Zeile
      push: g.events.some((e) => channelEnabled(db.notification_preferences, ctx.actor.id, e, 'push')),
      telegram: g.events.some((e) =>
        channelEnabled(db.notification_preferences, ctx.actor.id, e, 'telegram'),
      ),
    })),
    reminder_lead_days: ctx.actor.reminder_lead_days,
    own_status: ctx.actor.notify_own_status,
  };
}

/**
 * Kanal abgeschaltet: Wartende Nachrichten dieses Kanals gehen nicht mehr raus. Sie bleiben als
 * „fehlgeschlagen“ stehen, damit der Anlass nicht später noch einmal eingereiht wird.
 */
function dropWaiting(
  db: Db,
  memberId: string,
  channel: NotificationChannel,
  events?: readonly NotificationEvent[],
): void {
  for (const o of db.notification_outbox)
    if (
      o.member_id === memberId &&
      o.channel === channel &&
      o.status === 'wartet' &&
      (!events || events.includes(o.event_type))
    )
      o.status = 'fehlgeschlagen';
}

/**
 * WF-PRO-04: eine Zeile der Matrix für einen Kanal an- oder abschalten – wirkt sofort, auch auf Nachrichten,
 * die noch auf den nächsten Joblauf warten.
 */
export function setNotificationPreference(
  ctx: Ctx,
  group: NotificationGroupKey,
  channel: NotificationChannel,
  enabled: boolean,
): void {
  const def = NOTIFICATION_GROUPS.find((g) => g.key === group);
  if (!def || !NOTIFICATION_CHANNELS.includes(channel))
    throw new AppError('validation', 'Diese Einstellung gibt es nicht.');
  const me = ctx.actor.id;
  for (const event_type of def.events) {
    ctx.db.notification_preferences = ctx.db.notification_preferences.filter(
      (p) => !(p.member_id === me && p.event_type === event_type && p.channel === channel),
    );
    ctx.db.notification_preferences.push({ member_id: me, event_type, channel, enabled });
  }
  if (!enabled) dropWaiting(ctx.db, me, channel, def.events);
}

/** WF-PRO-04: Vorlauf für Fristerinnerungen (1, 3 oder 7 Tage) */
export function setReminderLeadDays(ctx: Ctx, days: number): void {
  const value = parse(reminderLeadSchema, days);
  const me = ctx.db.members.find((m) => m.id === ctx.actor.id)!;
  if (me.reminder_lead_days === value) return;
  writeHistory(ctx, 'member', me.id, 'updated', {
    reminder_lead_days: { old: me.reminder_lead_days, new: value },
  });
  me.reminder_lead_days = value;
  touch(ctx, me);
}

/** 6.2: Statusänderungen auch, wenn man sie selbst vorgenommen hat */
export function setOwnStatusNotifications(ctx: Ctx, on: boolean): void {
  const me = ctx.db.members.find((m) => m.id === ctx.actor.id)!;
  if (me.notify_own_status === on) return;
  writeHistory(ctx, 'member', me.id, 'updated', {
    notify_own_status: { old: me.notify_own_status, new: on },
  });
  me.notify_own_status = on;
  touch(ctx, me);
}

/** WF-PRO-02: Push-Abo für dieses Gerät anlegen bzw. entfernen */
export function setPush(ctx: Ctx, deviceId: string, on: boolean): void {
  const db = ctx.db;
  db.push_subscriptions = db.push_subscriptions.filter((s) => s.endpoint !== deviceId);
  if (!on && !db.push_subscriptions.some((s) => s.member_id === ctx.actor.id))
    dropWaiting(db, ctx.actor.id, 'push');
  if (on)
    db.push_subscriptions.push({
      id: uuid(),
      member_id: ctx.actor.id,
      endpoint: deviceId,
      created_at: ctx.now.toISOString(),
    });
}

/** WF-PRO-03: Einmal-Code, 15 Minuten gültig, einmal verwendbar */
export function startTelegramLink(ctx: Ctx): { url: string; expires_at: string } {
  const db = ctx.db;
  if (db.telegram_links.some((l) => l.member_id === ctx.actor.id))
    throw new AppError('rule', 'Telegram ist schon verbunden.');
  db.telegram_link_codes = db.telegram_link_codes.filter((c) => c.member_id !== ctx.actor.id);
  const code = uuid().replace(/-/g, '').slice(0, 16);
  const expires_at = new Date(ctx.now.getTime() + TELEGRAM_CODE_MINUTES * 60_000).toISOString();
  db.telegram_link_codes.push({ code, member_id: ctx.actor.id, expires_at, used_at: null });
  return { url: `${BOT_URL}?start=${code}`, expires_at };
}

/** Was der Bot nach /start <code> tut: Code prüfen, einmal verwenden, Chat verknüpfen. */
export function redeemTelegramCode(db: Db, now: Date, code: string, chatId: string): void {
  const entry = db.telegram_link_codes.find((c) => c.code === code);
  if (!entry || entry.used_at || new Date(entry.expires_at) <= now)
    throw new AppError('rule', 'Der Link ist abgelaufen oder wurde schon verwendet. Bitte neu verknüpfen.');
  const member = db.members.find((m) => m.id === entry.member_id);
  if (!member || !member.active) throw new AppError('rule', 'Dieses Mitglied ist nicht aktiv.');
  entry.used_at = now.toISOString();
  db.telegram_links = db.telegram_links.filter((l) => l.member_id !== member.id);
  db.telegram_links.push({ member_id: member.id, chat_id: chatId, linked_at: now.toISOString() });
}

export function unlinkTelegram(ctx: Ctx): void {
  ctx.db.telegram_links = ctx.db.telegram_links.filter((l) => l.member_id !== ctx.actor.id);
  dropWaiting(ctx.db, ctx.actor.id, 'telegram');
  ctx.db.telegram_link_codes = ctx.db.telegram_link_codes.filter((c) => c.member_id !== ctx.actor.id);
}

/** WF-ADM-07: letzte Jobläufe und Kennzahlen, nur für Admins */
export function systemStatus(ctx: Ctx): SystemStatus {
  if (!ctx.actor.is_admin) throw new AppError('forbidden', 'Das dürfen nur Personen mit Admin-Rechten.');
  const db = ctx.db;
  const runs = [...db.job_runs].sort((a, b) => b.started_at.localeCompare(a.started_at));
  const dayAgo = ctx.now.getTime() - 24 * 3_600_000;
  const people = db.members.filter((m) => m.active && !m.is_system);
  return {
    runs: runs.slice(0, 5),
    // wie auf dem Server: maßgeblich ist der letzte Lauf ohne Fehler
    last_run_at: runs.find((r) => r.result === 'ok')?.started_at ?? null,
    outbox_waiting: db.notification_outbox.filter((o) => o.status === 'wartet').length,
    failed_24h: db.notification_outbox.filter(
      // bewusst abgeschaltete Kanäle sind kein Zustellfehler (nie versucht)
      (o) => o.status === 'fehlgeschlagen' && o.attempts > 0 && new Date(o.created_at).getTime() >= dayAgo,
    ).length,
    push_subscriptions: db.push_subscriptions.filter((x) => people.some((m) => m.id === x.member_id)).length,
    telegram_linked: db.telegram_links.filter((l) => people.some((m) => m.id === l.member_id)).length,
    active_members: people.length,
  };
}

export function messagesFor(db: Db, memberId: string): OutboxEntry[] {
  return db.notification_outbox
    .filter((o) => o.member_id === memberId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 8);
}

/** Deaktivierte Mitglieder behalten keine Push-Abos und keine Telegram-Verknüpfung (personenbezogen, Abschnitt 9). */
export function dropChannels(db: Db, memberId: string): void {
  db.push_subscriptions = db.push_subscriptions.filter((x) => x.member_id !== memberId);
  db.telegram_links = db.telegram_links.filter((x) => x.member_id !== memberId);
  db.telegram_link_codes = db.telegram_link_codes.filter((x) => x.member_id !== memberId);
  db.notification_outbox = db.notification_outbox.filter(
    (o) => !(o.member_id === memberId && o.status === 'wartet'),
  );
}
