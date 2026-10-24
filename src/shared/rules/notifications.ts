// Benachrichtigungslogik (ANFORDERUNGEN 6.1, 6.2): wer bekommt was, mit welchem Text – und der
// dedupe_key, der Doppelversand verhindert. Jede Nachricht nennt Titel, Datum und einen Direktlink.
import { formatDayMonth } from '../format';
import { TASK_STATUS_LABEL } from '../labels';
import type { NotificationEvent, Task, TaskStatus } from '../schema';
import { daysUntil } from './due';
import { isActiveTaskStatus } from './taskStatus';

export interface Message {
  member_id: string;
  event_type: NotificationEvent;
  text: string;
  /** Pfad in der App, den Push und Telegram öffnen (WF-ALL-04) */
  link: string;
  /** eindeutig je Empfänger und Anlass; die Outbox hängt noch den Kanal an */
  dedupe_key: string;
  /** eigene Statusänderung: geht nur raus, wenn die Person das eingeschaltet hat (6.2) */
  own?: boolean;
}

/** [P6] Zeilen der Schalter-Matrix im Profil (F-PRO-02) und die Ereignisse dahinter (6.2) */
export const NOTIFICATION_GROUPS = [
  { key: 'zuweisung', label: 'Zuweisung', hint: null, events: ['zuweisung', 'zuweisung_abgelehnt'] },
  { key: 'kommentar', label: 'Neuer Kommentar', hint: null, events: ['kommentar'] },
  { key: 'status', label: 'Statusänderung', hint: null, events: ['status'] },
  { key: 'blockade', label: 'Blockade aufgehoben', hint: null, events: ['blockade_aufgehoben'] },
  {
    key: 'frist',
    label: 'Frist',
    hint: 'Vorher · am Tag · überfällig',
    events: ['frist_naht', 'frist_heute', 'frist_ueberschritten'],
  },
  {
    key: 'termine',
    label: 'Termine',
    hint: 'Einladung · 3 Tage und 1 Stunde vorher · Änderung',
    events: ['termin_einladung', 'termin_erinnerung', 'termin_geaendert'],
  },
  { key: 'zusammenfassung', label: 'Plenum-Zusammenfassung', hint: null, events: ['plenum_zusammenfassung'] },
] as const satisfies readonly {
  key: string;
  label: string;
  hint: string | null;
  events: readonly NotificationEvent[];
}[];
export type NotificationGroupKey = (typeof NOTIFICATION_GROUPS)[number]['key'];

/** Ist der Kanal für dieses Ereignis an? Ohne Eintrag: nein – Benachrichtigungen sind standardmäßig aus (F-PRO-02). */
export function channelEnabled(
  prefs: readonly { member_id: string; event_type: NotificationEvent; channel: string; enabled: boolean }[],
  memberId: string,
  event: NotificationEvent,
  channel: string,
): boolean {
  return (
    prefs.find((p) => p.member_id === memberId && p.event_type === event && p.channel === channel)?.enabled ??
    false
  );
}

type TaskRef = Pick<Task, 'id' | 'title' | 'due_date'>;

const day = (isoDate: string) => {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return formatDayMonth(new Date(y, m - 1, d));
};
const title = (task: TaskRef) => `„${task.title}“`;
export const taskLink = (taskId: string) => `/aufgaben/${taskId}`;
const unique = (ids: readonly string[]) => [...new Set(ids)];

/** Zuweisung: an die neu zugewiesene Person, nicht an sich selbst. */
export function assignmentMessages(
  task: TaskRef,
  assigneeId: string,
  actorId: string,
  at: string,
): Message[] {
  if (assigneeId === actorId) return [];
  const due = task.due_date ? ` Frist: ${day(task.due_date)}` : '';
  return [
    {
      member_id: assigneeId,
      event_type: 'zuweisung',
      text: `Du bist jetzt bei ${title(task)} eingetragen.${due}`,
      link: taskLink(task.id),
      dedupe_key: `zuweisung:${task.id}:${assigneeId}:${at}`,
    },
  ];
}

/** [P6] „Passt nicht“ per Telegram: die Person, die zugewiesen hat, erfährt es (6.4) – nicht, wer sich selbst eintrug. */
export function declinedMessages(
  task: TaskRef,
  declinerId: string,
  declinerName: string,
  assignedBy: string | null,
  at: string,
): Message[] {
  if (!assignedBy || assignedBy === declinerId) return [];
  return [
    {
      member_id: assignedBy,
      event_type: 'zuweisung_abgelehnt',
      text: `${declinerName} passt ${title(task)} nicht – die Aufgabe braucht jemand anderen.`,
      link: taskLink(task.id),
      dedupe_key: `zuweisung_abgelehnt:${task.id}:${declinerId}:${at}`,
    },
  ];
}

/** Kommentar: an Bearbeitende und Folgende außer Autor*in. */
export function commentMessages(
  task: TaskRef,
  comment: { id: string; body: string },
  authorId: string,
  authorName: string,
  assigneeIds: readonly string[],
  followerIds: readonly string[],
): Message[] {
  const excerpt = comment.body.length > 120 ? `${comment.body.slice(0, 117)}…` : comment.body;
  return unique([...assigneeIds, ...followerIds])
    .filter((id) => id !== authorId)
    .map((member_id) => ({
      member_id,
      event_type: 'kommentar' as const,
      text: `Neuer Kommentar von ${authorName} bei ${title(task)}: ${excerpt}`,
      link: taskLink(task.id),
      dedupe_key: `kommentar:${comment.id}:${member_id}`,
    }));
}

/** Statusänderung: an Bearbeitende und Folgende; eigene Änderungen sind standardmäßig aus. */
export function statusMessages(
  task: TaskRef,
  to: TaskStatus,
  actorId: string,
  assigneeIds: readonly string[],
  followerIds: readonly string[],
  at: string,
): Message[] {
  // die eigene Änderung ist markiert: ob sie rausgeht, entscheidet die Einstellung der Person
  return unique([...assigneeIds, ...followerIds]).map((member_id) => ({
    member_id,
    event_type: 'status' as const,
    text: `${title(task)} ist jetzt „${TASK_STATUS_LABEL[to]}“.`,
    link: taskLink(task.id),
    dedupe_key: `status:${task.id}:${to}:${member_id}:${at}`,
    ...(member_id === actorId ? { own: true } : {}),
  }));
}

/** Blockade aufgehoben: an die Bearbeitenden der Aufgabe, die auf die erledigte gewartet hat. */
export function unblockedMessages(
  doneTask: TaskRef,
  waitingTask: TaskRef,
  waitingAssigneeIds: readonly string[],
  actorId: string,
  at: string,
): Message[] {
  // wer die blockierende Aufgabe selbst erledigt, weiß es schon (6.1)
  return unique(waitingAssigneeIds.filter((id) => id !== actorId)).map((member_id) => ({
    member_id,
    event_type: 'blockade_aufgehoben' as const,
    text: `${title(doneTask)} ist erledigt – ${title(waitingTask)} ist nicht mehr blockiert.`,
    link: taskLink(waitingTask.id),
    dedupe_key: `blockade:${doneTask.id}:${waitingTask.id}:${member_id}:${at}`,
  }));
}

export interface ReminderInput {
  task: Pick<Task, 'id' | 'title' | 'due_date' | 'status' | 'archived_at'>;
  assignees: { id: string; reminder_lead_days: number }[];
  followerIds: readonly string[];
}

/**
 * Fristerinnerungen eines Tages: Vorlauf (Standard 3 Tage), am Tag selbst und einmal bei
 * Überschreitung. Die Schlüssel hängen nur an Aufgabe, Person und Frist – ein nachgeholter oder
 * doppelter Joblauf erzeugt nichts doppelt, eine verschobene Frist erinnert neu.
 */
export function dueReminderMessages(items: readonly ReminderInput[], today: string): Message[] {
  const out: Message[] = [];
  for (const { task, assignees, followerIds } of items) {
    if (!task.due_date || task.archived_at || !isActiveTaskStatus(task.status)) continue;
    const days = daysUntil(task.due_date, today);
    const link = taskLink(task.id);
    const key = (kind: string, memberId: string) => `${kind}:${task.id}:${memberId}:${task.due_date}`;
    // „überfällig“ nur in den ersten Tagen danach – genug, um ausgefallene Jobläufe nachzuholen; danach kommt
    // nichts mehr, auch wenn die Outbox alte Einträge schon aufgeräumt hat (einmalig, 6.2)
    if (days < -OVERDUE_CATCH_UP_DAYS) continue;
    if (days < 0) {
      // einmalig an Bearbeitende, dazu die Folgenden
      for (const member_id of unique([...assignees.map((a) => a.id), ...followerIds]))
        out.push({
          member_id,
          event_type: 'frist_ueberschritten',
          text: `${title(task)} ist seit ${day(task.due_date)} überfällig.`,
          link,
          dedupe_key: key('frist_ueberschritten', member_id),
        });
      continue;
    }
    for (const a of assignees) {
      if (days === 0)
        out.push({
          member_id: a.id,
          event_type: 'frist_heute',
          text: `${title(task)} ist heute fällig.`,
          link,
          dedupe_key: key('frist_heute', a.id),
        });
      else if (days <= a.reminder_lead_days)
        out.push({
          member_id: a.id,
          event_type: 'frist_naht',
          text: `${title(task)} muss bis ${day(task.due_date)} erledigt sein – noch ${days} ${days === 1 ? 'Tag' : 'Tage'}.`,
          link,
          dedupe_key: key('frist_naht', a.id),
        });
    }
  }
  return out;
}

/** So viele Tage nach der Frist kommt „überfällig“ noch – länger als die Outbox Einträge aufbewahrt, nie */
export const OVERDUE_CATCH_UP_DAYS = 7;

/** Fristerinnerungen gehen einmal täglich gegen 9:00 Uhr (Europe/Berlin) raus. */
export const DAILY_REMINDER_HOUR = 9;
/** Ohne Joblauf seit so vielen Minuten warnt die Statusanzeige (E-07). */
export const JOB_WARNING_MINUTES = 120;
export const JOB_INTERVAL_MINUTES = 15;
export const MAX_SEND_ATTEMPTS = 3;

export function isJobOverdue(lastRunAt: string | null, now: Date): boolean {
  if (!lastRunAt) return true;
  return now.getTime() - new Date(lastRunAt).getTime() > JOB_WARNING_MINUTES * 60_000;
}
