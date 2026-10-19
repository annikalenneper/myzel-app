// Testdaten-Schicht, Phase 6: Telegram-Buttons (ANFORDERUNGEN 6.4). In Schritt C ruft der Webhook diese Logik auf;
// handelnde Person ist das Mitglied, mit dem der Chat verknüpft ist. Jede Aktion läuft über dieselben
// Server-Funktionen wie die App (Prüfungen, Historie, Benachrichtigungen), ist idempotent und antwortet mit
// einem Satz für den Chat. Geht sie nicht mehr, kommt ein freundlicher Hinweis statt eines Fehlers.
import { AppError, isAppError } from '../../shared/errors';
import { TASK_STATUS_LABEL } from '../../shared/labels';
import { declinedMessages } from '../../shared/rules/notifications';
import { linkTarget, telegramButtons, type TelegramButtonKey } from '../../shared/rules/telegram';
import type { TaskStatus } from '../../shared/schema';
import { findAppointment, setRsvp } from './appointments';
import { enqueue } from './notify';
import { findTask, notFound, removeAssignee, rule, setTaskStatus, type Ctx } from './server';

export interface TelegramReply {
  /** false: nichts geändert – der Text erklärt, warum */
  ok: boolean;
  text: string;
}

const quoted = (t: string) => `„${t}“`;

export function pressTelegramButton(ctx: Ctx, outboxId: string, key: TelegramButtonKey): TelegramReply {
  const entry = ctx.db.notification_outbox.find(
    (o) => o.id === outboxId && o.channel === 'telegram' && o.member_id === ctx.actor.id,
  );
  if (!entry) throw notFound('Diese Nachricht');
  if (!ctx.db.telegram_links.some((l) => l.member_id === ctx.actor.id))
    throw rule('Dieser Chat ist nicht mehr mit Myzel verbunden. Verknüpfe Telegram im Profil neu.');
  const button = telegramButtons(entry.event_type).find((b) => b.key === key);
  const target = linkTarget(entry.link);
  if (!button || button.kind !== 'action' || !target)
    throw new AppError('validation', 'Diesen Button gibt es an dieser Nachricht nicht.');
  return target.kind === 'task' ? taskAction(ctx, target.id, key) : rsvpAction(ctx, target.id, key);
}

/**
 * Antwort für den Chat, wenn die Aktion an einer Regel scheitert – dieselben Regeln wie in der App (6.4).
 * Der Aufrufer fängt den Fehler außerhalb der Transaktion ab, damit nichts halb gespeichert bleibt.
 */
export function friendlyReply(e: unknown): TelegramReply {
  if (isAppError(e) && e.code !== 'network' && e.code !== 'unauthenticated')
    return { ok: false, text: `Das geht gerade nicht: ${e.message}` };
  throw e;
}

function taskAction(ctx: Ctx, taskId: string, key: TelegramButtonKey): TelegramReply {
  const task = findTask(ctx.db, taskId);
  const name = quoted(task.title);
  const me = ctx.actor.id;
  const assigned = ctx.db.task_assignees.find((a) => a.task_id === taskId && a.member_id === me);

  const toStatus = (to: TaskStatus, done: string): TelegramReply => {
    if (task.status === to) return { ok: true, text: `${name} ist schon „${TASK_STATUS_LABEL[to]}“.` };
    // der Chat kennt keine Version: es gilt der aktuelle Stand, geprüft wird wie in der App
    setTaskStatus(ctx, taskId, { status: to, version: task.version });
    return { ok: true, text: done };
  };

  switch (key) {
    case 'uebernehme':
      if (!assigned) return { ok: false, text: `Du bist bei ${name} nicht mehr eingetragen.` };
      if (task.status === 'in_arbeit') return { ok: true, text: `${name} ist schon „In Arbeit“.` };
      // „Status → in_arbeit (falls neu/geplant)“; sonst bleibt alles, wie es ist
      if (task.status !== 'neu' && task.status !== 'geplant')
        return {
          ok: true,
          text: `Danke! ${name} ist gerade „${TASK_STATUS_LABEL[task.status]}“ – der Status bleibt.`,
        };
      return toStatus('in_arbeit', `Danke! ${name} ist jetzt „In Arbeit“.`);
    case 'passt_nicht': {
      if (!assigned) return { ok: true, text: `Du bist bei ${name} schon ausgetragen.` };
      const { status_reset } = removeAssignee(ctx, taskId, me);
      enqueue(
        ctx.db,
        ctx.now,
        declinedMessages(task, me, ctx.actor.display_name, assigned.assigned_by, ctx.now.toISOString()),
        (ctx.outbox ??= []),
      );
      return {
        ok: true,
        text: `Okay, du bist bei ${name} ausgetragen${status_reset ? ' – sie ist wieder „Geplant“' : ''}.`,
      };
    }
    case 'erledigt':
      return toStatus('erledigt', `Super! ${name} ist erledigt.`);
    case 'bin_dran':
    case 'weiter':
      return toStatus('in_arbeit', `${name} ist jetzt „In Arbeit“.`);
    default:
      throw new AppError('validation', 'Diesen Button gibt es an dieser Nachricht nicht.');
  }
}

function rsvpAction(ctx: Ctx, appointmentId: string, key: TelegramButtonKey): TelegramReply {
  const a = findAppointment(ctx.db, appointmentId);
  const answer = key === 'komme' ? 'ja' : key === 'komme_nicht' ? 'nein' : null;
  if (!answer) throw new AppError('validation', 'Diesen Button gibt es an dieser Nachricht nicht.');
  const current = ctx.db.appointment_rsvps.find(
    (r) => r.appointment_id === a.id && r.member_id === ctx.actor.id,
  );
  if (current?.answer === answer)
    return {
      ok: true,
      text:
        answer === 'ja'
          ? `Du hast für ${quoted(a.title)} schon zugesagt.`
          : `Du hast für ${quoted(a.title)} schon abgesagt.`,
    };
  setRsvp(ctx, a.id, answer);
  return {
    ok: true,
    text:
      answer === 'ja'
        ? `Schön! Zusage für ${quoted(a.title)} gespeichert.`
        : `Schade – Absage für ${quoted(a.title)} gespeichert.`,
  };
}
