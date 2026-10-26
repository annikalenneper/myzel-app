// Datums- und Fristanzeigen im Stil des Prototyps (Europe/Berlin über die Geräte-Zeitzone)
import type { TaskStatus } from './schema';
import { daysUntil, dueState, toIsoDate } from './rules/due';

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'] as const;

const pad = (n: number) => String(n).padStart(2, '0');
const parseIsoDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
};

/** „14.10.“ */
export function formatDayMonth(d: Date): string {
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`;
}

/** „Di, 20.10.“ */
export function formatDateWithWeekday(isoDate: string): string {
  const d = parseIsoDate(isoDate);
  return `${WEEKDAYS[d.getDay()]}, ${formatDayMonth(d)}`;
}

/** Fristtext der Karte: „SEIT 09.10.“, „14.10. · 3 TAGE“, „20.10.“, „OHNE FRIST“ */
export function formatDueLabel(dueDate: string | null, status: TaskStatus, today: string): string {
  if (!dueDate) return 'OHNE FRIST';
  const text = formatDayMonth(parseIsoDate(dueDate));
  const state = dueState(dueDate, status, today);
  if (state === 'overdue') return `SEIT ${text}`;
  if (state === 'soon') {
    const days = daysUntil(dueDate, today);
    return `${text} · ${days === 0 ? 'HEUTE' : days === 1 ? 'MORGEN' : `${days} TAGE`}`;
  }
  return text;
}

/** „21:14“ */
export function formatTime(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Verlauf: „08.10. 21:14“ */
export function formatHistoryTime(iso: string): string {
  const d = new Date(iso);
  return `${formatDayMonth(d)} ${formatTime(d)}`;
}

/** Kommentare: „GERADE“, „HEUTE 10:02“, „GESTERN 21:14“, „08.10. 21:14“ */
export function formatCommentTime(iso: string, now: Date): string {
  const d = new Date(iso);
  if (now.getTime() - d.getTime() < 60_000) return 'GERADE';
  const days = daysUntil(toIsoDate(now), toIsoDate(d));
  if (days === 0) return `HEUTE ${formatTime(d)}`;
  if (days === 1) return `GESTERN ${formatTime(d)}`;
  return formatHistoryTime(iso);
}

/** Konfliktdialog: „gerade eben“, „vor 2 Minuten“, „vor 3 Stunden“, „am 08.10.“ */
export function formatAgo(iso: string, now: Date): string {
  const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'gerade eben';
  if (minutes < 60) return `vor ${minutes} ${minutes === 1 ? 'Minute' : 'Minuten'}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `vor ${hours} ${hours === 1 ? 'Stunde' : 'Stunden'}`;
  return `am ${formatDayMonth(new Date(iso))}`;
}

/** „SA 12.12. · 22:00–06:00“ bzw. mit zweitem Datum, wenn das Ende mehr als einen Tag später liegt */
export function formatEventRange(startsAt: string, endsAt: string | null): string {
  const s = new Date(startsAt);
  // das Jahr steht nur dabei, wenn es nicht das laufende ist
  const year = s.getFullYear() === new Date().getFullYear() ? '' : String(s.getFullYear());
  const head = `${WEEKDAYS[s.getDay()]!.toUpperCase()} ${formatDayMonth(s)}${year} · ${formatTime(s)}`;
  if (!endsAt) return head;
  const e = new Date(endsAt);
  const longer = e.getTime() - s.getTime() >= 24 * 3_600_000;
  return longer
    ? `${head} – ${WEEKDAYS[e.getDay()]!.toUpperCase()} ${formatDayMonth(e)} · ${formatTime(e)}`
    : `${head}–${formatTime(e)}`;
}

/** ISO-Zeitstempel → Wert für <input type="datetime-local"> und zurück */
export function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${toIsoDate(d)}T${formatTime(d)}`;
}

export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Abstand zum Beginn einer Veranstaltung: „am Tag“, „1 Tag vorher“, „14 Tage danach“ */
export function formatOffsetDays(days: number): string {
  if (days === 0) return 'am Tag';
  const n = Math.abs(days);
  return `${n} ${n === 1 ? 'Tag' : 'Tage'} ${days < 0 ? 'vorher' : 'danach'}`;
}
