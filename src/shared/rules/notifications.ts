// Benachrichtigungslogik (ANFORDERUNGEN 6.1, 6.2): wer bekommt was, mit welchem Text – und der
// dedupe_key, der Doppelversand verhindert. Jede Nachricht nennt Titel, Datum und einen Direktlink.
import { formatDayMonth } from '../format';
import { TASK_STATUS_LABEL } from '../labels';
import type { NotificationEvent, Task, TaskStatus } from '../schema';
import { berlinHour, daysUntil } from './due';
import { isActiveTaskStatus } from './taskStatus';

export interface Message {
  member_id: string;
  event_type: NotificationEvent;
  text: string;
  /** Pfad in der App, den Push und Telegram öffnen (WF-ALL-04) */
  link: string;
  /** eindeutig je Empfänger und Anlass; die Outbox hängt noch den Kanal an */
  dedupe_key: string;
  /**
   * Bündel (Phase 14): Nachrichten mit gleichem Schlüssel an dieselbe Person, die noch nicht verschickt sind, gehen als
   * eine raus – die neueste Fassung gilt (resolveBundle). Ohne Schlüssel: einzeln wie bisher.
   */
  bundle?: string;
  /** Termin-Änderung: Text, falls die Einladung zu diesem Termin noch nicht raus ist; leer = dann gar nichts schicken */
  invite_text?: string;
  /** Phase 15: nur in die Glocke, nicht per Push/Telegram (z. B. Änderung an einem Termin in mehr als 4 Wochen) */
  inbox_only?: boolean;
}

// ── Phase 15: Nachtruhe und tägliche Zusammenfassung (Nutzerin, 12.11.2026) ─────

/** Nachtruhe in Köln: von 22 bis 8 Uhr kein Push und kein Telegram – außer „Termin in 1 Stunde“ */
export const NIGHT_START_HOUR = 22;
export const NIGHT_END_HOUR = 8;
export const isNight = (d: Date) => {
  const h = berlinHour(d);
  return h >= NIGHT_START_HOUR || h < NIGHT_END_HOUR;
};
/** darf auch nachts raus */
export const nightExempt = (dedupeKey: string) => dedupeKey.startsWith('termin_erinnerung_stunde:');
/** Termin-Änderungen weiter weg als 4 Wochen stehen nur in der Glocke */
export const FAR_APPOINTMENT_DAYS = 28;

/** Nächster Morgen um 8 Uhr in Köln (Ende der Nachtruhe) – dann geht die tägliche Zusammenfassung raus */
export function nextMorning(now: Date): string {
  const h = berlinHour(now);
  let hours = (NIGHT_END_HOUR - h + 24) % 24;
  if (hours === 0 && (now.getUTCMinutes() > 0 || now.getUTCSeconds() > 0)) hours = 24;
  const t = new Date(now.getTime() + hours * 3_600_000);
  t.setUTCMinutes(0, 0, 0);
  return t.toISOString();
}

/** In der Zusammenfassung höchstens so viele Zeilen, dann „… und n weitere“ */
const DIGEST_LINES = 8;
const DIGEST_LINE_MAX = 140;

/** Eine Nachricht für viele: „Zusammenfassung: 5 Neuigkeiten“ mit einer Zeile je Anlass, Link zur Agenda */
export function digestText(texts: readonly string[], overnight: boolean): string {
  const lines = texts
    .slice(0, DIGEST_LINES)
    .map((t) => `• ${t.replace(/\s+/g, ' ').slice(0, DIGEST_LINE_MAX)}`);
  const more = texts.length - lines.length;
  const head = overnight
    ? `Seit gestern Abend: ${texts.length} Neuigkeiten`
    : `Deine Zusammenfassung: ${texts.length} Neuigkeiten`;
  return [head, ...lines, ...(more > 0 ? [`… und ${more} weitere – alles in der Glocke`] : [])].join('\n');
}

/**
 * Phase 14 (Nutzerin, 11.11.2026: „Benachrichtigungen sollen unterstützen, nicht stören“): Anlässe, die beim Anlegen
 * und Nacharbeiten in Wellen kommen, warten, bis 10 Minuten lang nichts mehr dazukam. Kommentare, Zuweisungen und
 * Erinnerungen gehen ohne Wartezeit raus.
 */
export const BUNDLE_QUIET_MS = 10 * 60_000;
const HELD_EVENTS: readonly NotificationEvent[] = ['termin_einladung', 'termin_geaendert', 'status'];

/** eigene Bestätigungen zu zurückgehaltenen Anlässen warten mit */
const HELD_BUNDLES = ['termin:', 'status:'];

/** Ab wann eine Nachricht frühestens raus darf; null = sofort (nach dem Rückgängig-Fenster) */
export function sendAfter(m: Pick<Message, 'event_type' | 'bundle'>, now: Date): string | null {
  const held =
    HELD_EVENTS.includes(m.event_type) ||
    (m.event_type === 'eigene_aktion' && HELD_BUNDLES.some((p) => m.bundle?.startsWith(`eigene:${p}`)));
  return held && m.bundle ? new Date(now.getTime() + BUNDLE_QUIET_MS).toISOString() : null;
}

export interface BundleRow {
  event_type: NotificationEvent;
  text: string;
  invite_text: string | null;
  created_at: string;
}

/**
 * Was aus einem Bündel wartender Nachrichten (gleiche Person, gleicher Kanal, gleicher Schlüssel) rausgeht: die neueste
 * Fassung. Ist die Einladung zu einem Termin noch nicht raus, geht statt „geändert“ die Einladung mit dem neuen Stand
 * raus – und nach einer Absage gar nichts. Mehrere Kommentare: der letzte mit „(+n weitere)“. null = nichts schicken.
 */
export function resolveBundle<T extends BundleRow>(
  rows: readonly T[],
): { keep: T; event_type: NotificationEvent; text: string } | null {
  const sorted = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const last = sorted.at(-1);
  if (!last) return null;
  if (last.event_type === 'termin_geaendert' && sorted.some((r) => r.event_type === 'termin_einladung')) {
    if (last.invite_text === '') return null;
    return { keep: last, event_type: 'termin_einladung', text: last.invite_text ?? last.text };
  }
  const comments = sorted.filter((r) => r.event_type === 'kommentar').length;
  if (last.event_type === 'kommentar' && comments > 1)
    return { keep: last, event_type: 'kommentar', text: `${last.text} (+${comments - 1} weitere)` };
  return { keep: last, event_type: last.event_type, text: last.text };
}

/**
 * [P6] Zeilen der Schalter-Matrix im Profil (F-PRO-02) und die Ereignisse dahinter (6.2). digest (Phase 15): Ereignisse,
 * die statt einzeln einmal am Tag gesammelt kommen können – Erinnerungen und Fristen nie (sie sind schon täglich bzw.
 * zeitkritisch).
 */
export const NOTIFICATION_GROUPS = [
  {
    key: 'zuweisung',
    label: 'Zuweisung',
    hint: null,
    events: ['zuweisung', 'zuweisung_abgelehnt'],
    digest: ['zuweisung', 'zuweisung_abgelehnt'],
  },
  { key: 'kommentar', label: 'Neuer Kommentar', hint: null, events: ['kommentar'], digest: ['kommentar'] },
  { key: 'status', label: 'Statusänderung', hint: null, events: ['status'], digest: ['status'] },
  {
    key: 'blockade',
    label: 'Blockade aufgehoben',
    hint: null,
    events: ['blockade_aufgehoben'],
    digest: ['blockade_aufgehoben'],
  },
  {
    key: 'frist',
    label: 'Frist',
    hint: 'Vorher · am Tag · überfällig',
    events: ['frist_naht', 'frist_heute', 'frist_ueberschritten'],
    digest: [],
  },
  {
    key: 'termine',
    label: 'Termine',
    hint: 'Einladung · 3 Tage und 1 Stunde vorher · Änderung',
    events: ['termin_einladung', 'termin_erinnerung', 'termin_geaendert'],
    // Erinnerungen bleiben einzeln – „in 1 Stunde“ hilft am nächsten Morgen nicht
    digest: ['termin_einladung', 'termin_geaendert'],
  },
  {
    key: 'zusammenfassung',
    label: 'Plenum-Zusammenfassung',
    hint: null,
    events: ['plenum_zusammenfassung'],
    digest: [],
  },
  {
    key: 'eigene',
    label: 'Eigene Aktionen',
    hint: 'Wer über das, was du tust, benachrichtigt wird',
    events: ['eigene_aktion'],
    digest: ['eigene_aktion'],
  },
  {
    key: 'entscheidungen',
    label: 'Entscheidungen zum Bestätigen',
    hint: 'Neu · letzter Tag der Frist',
    events: ['entscheidung_bestaetigen', 'entscheidung_frist'],
    digest: ['entscheidung_bestaetigen'],
  },
] as const satisfies readonly {
  key: string;
  label: string;
  hint: string | null;
  events: readonly NotificationEvent[];
  digest: readonly NotificationEvent[];
}[];
export type NotificationGroupKey = (typeof NOTIFICATION_GROUPS)[number]['key'];

/**
 * Ist der Kanal für dieses Ereignis an? Ohne Eintrag: ja – alle starten mit allem an (Nutzerin, 27.10.2026). Ausnahme
 * „Eigene Aktionen“: ohne Eintrag aus (Phase 15, Nutzerin 12.11.2026).
 */
export const defaultEnabled = (event: NotificationEvent) => event !== 'eigene_aktion';

export function channelEnabled(
  prefs: readonly { member_id: string; event_type: NotificationEvent; channel: string; enabled: boolean }[],
  memberId: string,
  event: NotificationEvent,
  channel: string,
): boolean {
  return (
    prefs.find((p) => p.member_id === memberId && p.event_type === event && p.channel === channel)?.enabled ??
    defaultEnabled(event)
  );
}

/**
 * Glocke (Phase 14): Noch nicht gesehene Einträge eines Bündels erscheinen als einer – mit dem Text, den auch Push und
 * Telegram schicken würden. Gesehenes bleibt einzeln stehen. Erwartet die neuesten zuerst.
 */
export function collapseInbox<
  T extends {
    id: string;
    event_type: NotificationEvent;
    text: string;
    link: string;
    created_at: string;
    bundle_key?: string | null;
    invite_text?: string | null;
  },
>(
  entries: readonly T[],
  seenAt: string | null,
): { id: string; event_type: NotificationEvent; text: string; link: string; created_at: string }[] {
  const fresh = (e: T) => !seenAt || e.created_at > seenAt;
  const groups = new Map<string, T[]>();
  for (const e of entries)
    if (e.bundle_key && fresh(e)) groups.set(e.bundle_key, [...(groups.get(e.bundle_key) ?? []), e]);
  const out = [];
  for (const e of entries) {
    const base = { id: e.id, event_type: e.event_type, text: e.text, link: e.link, created_at: e.created_at };
    const group = e.bundle_key && fresh(e) ? groups.get(e.bundle_key) : undefined;
    if (!group || group.length === 1) {
      out.push(base);
      continue;
    }
    // nur der neueste Eintrag des Bündels steht in der Liste
    if (group[0] !== e) continue;
    // älteste zuerst – bei gleicher Zeit gilt die Reihenfolge der Liste (neueste zuerst)
    const resolved = resolveBundle(
      [...group].reverse().map((g) => ({ ...g, invite_text: g.invite_text ?? null })),
    );
    if (resolved) out.push({ ...base, event_type: resolved.event_type, text: resolved.text });
  }
  return out;
}

type TaskRef = Pick<Task, 'id' | 'title' | 'due_date'>;

const day = (isoDate: string) => {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return formatDayMonth(new Date(y, m - 1, d));
};
const title = (task: TaskRef) => `„${task.title}“`;
export const taskLink = (taskId: string) => `/agenda/${taskId}`;
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
      bundle: `zuweisung:${task.id}`,
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
      bundle: `kommentar:${task.id}`,
    }));
}

/** Statusänderung: an Bearbeitende und Folgende außer der Person, die geändert hat (6.2). */
export function statusMessages(
  task: TaskRef,
  to: TaskStatus,
  actorId: string,
  assigneeIds: readonly string[],
  followerIds: readonly string[],
  at: string,
): Message[] {
  return unique([...assigneeIds, ...followerIds])
    .filter((id) => id !== actorId)
    .map((member_id) => ({
      member_id,
      event_type: 'status' as const,
      text: `${title(task)} ist jetzt „${TASK_STATUS_LABEL[to]}“.`,
      link: taskLink(task.id),
      dedupe_key: `status:${task.id}:${to}:${member_id}:${at}`,
      bundle: `status:${task.id}`,
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

// ── Entscheidungen im Konsens (16.4, F3) ─────────────────────────────────────

type DecisionRef = { id: string; title: string; consensus_until: string };
const decisionLink = (id: string) => `/wissen/beschluesse/${id}`;

/** Neue Entscheidung zum Bestätigen: an alle aktiven Mitglieder außer der Person, die sie festgehalten hat */
export function consensusInviteMessages(
  d: DecisionRef,
  memberIds: readonly string[],
  actorId: string,
): Message[] {
  return memberIds
    .filter((id) => id !== actorId)
    .map((member_id) => ({
      member_id,
      event_type: 'entscheidung_bestaetigen' as const,
      text: `Neue Entscheidung: „${d.title}“ – bitte bis ${day(d.consensus_until)} bestätigen oder widersprechen.`,
      link: decisionLink(d.id),
      dedupe_key: `entscheidung_bestaetigen:${d.id}:${member_id}`,
    }));
}

/** Letzter Tag der Frist (ab 9 Uhr im Joblauf): an alle, die noch nicht abgestimmt haben */
export function consensusDeadlineMessages(
  items: readonly { decision: DecisionRef; pendingIds: readonly string[] }[],
  today: string,
): Message[] {
  return items
    .filter((i) => i.decision.consensus_until === today)
    .flatMap(({ decision, pendingIds }) =>
      pendingIds.map((member_id) => ({
        member_id,
        event_type: 'entscheidung_frist' as const,
        text: `Heute ist der letzte Tag für „${decision.title}“ – ohne Widerspruch gilt die Entscheidung ab morgen.`,
        link: decisionLink(decision.id),
        dedupe_key: `entscheidung_frist:${decision.id}:${member_id}:${decision.consensus_until}`,
      })),
    );
}

// ── Eigene Aktionen (Phase 12) ──────────────────────────────────────────────

/**
 * Bestätigung für die handelnde Person, aus ihrer Sicht: „Du hast „Flyer“ kommentiert. 3 Personen werden
 * benachrichtigt.“ – gezählt wird, wer die Nachricht wirklich bekommt (Kanal eingerichtet, Schalter an).
 */
export function ownActionMessage(
  actorId: string,
  what: string,
  reached: number,
  about: Pick<Message, 'link' | 'dedupe_key' | 'bundle'>,
): Message {
  const who = reached === 0 ? 'Niemand wird' : reached === 1 ? '1 Person wird' : `${reached} Personen werden`;
  return {
    member_id: actorId,
    event_type: 'eigene_aktion',
    text: `Du hast ${what}. ${who} benachrichtigt.`,
    link: about.link,
    dedupe_key: `eigene_aktion:${about.dedupe_key}`,
    ...(about.bundle ? { bundle: `eigene:${about.bundle}` } : {}),
  };
}
