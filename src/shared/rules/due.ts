// Fristberechnung (F-AUF-02): rot überfällig, bernstein ≤ 3 Tage
import type { TaskStatus } from '../schema';
import { isActiveTaskStatus } from './taskStatus';

export const DUE_SOON_DAYS = 3;

export type DueState = 'none' | 'overdue' | 'soon' | 'normal';

/** Lokales Kalenderdatum als YYYY-MM-DD. */
export function toIsoDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

const BERLIN = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Berlin',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Kalenderdatum in Köln (Europe/Berlin) als YYYY-MM-DD – unabhängig von der Zeitzone des Rechners. Für „heute“ auf dem
 * Server (Netlify läuft in UTC): zwischen 0 und 2 Uhr ist dort sonst noch gestern.
 */
export function berlinDate(d: Date): string {
  return BERLIN.format(d);
}

const BERLIN_HOUR = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Berlin',
  hour: '2-digit',
  hourCycle: 'h23',
});

/** Stunde in Köln (0 bis 23) – für „Fristerinnerungen gegen 9:00 Uhr (Europe/Berlin)“ auf dem Server (6.1) */
export function berlinHour(d: Date): number {
  return Number(BERLIN_HOUR.format(d));
}

export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return toIsoDate(new Date(y, m - 1, d + days));
}

/** Ganze Tage von `today` bis `dueDate` (negativ = überfällig). */
export function daysUntil(dueDate: string, today: string): number {
  const utc = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((utc(dueDate) - utc(today)) / 86_400_000);
}

/** Fristen zählen nur bei aktiven Aufgaben; erledigte und verworfene sind nie überfällig. */
export function dueState(dueDate: string | null, status: TaskStatus, today: string): DueState {
  if (!dueDate) return 'none';
  if (!isActiveTaskStatus(status)) return 'normal';
  const days = daysUntil(dueDate, today);
  if (days < 0) return 'overdue';
  if (days <= DUE_SOON_DAYS) return 'soon';
  return 'normal';
}

export function isOverdue(dueDate: string | null, status: TaskStatus, today: string): boolean {
  return dueState(dueDate, status, today) === 'overdue';
}

/** Fristen liegen zwischen 2000 und 2100 – fängt Tippfehler und halb eingegebene Jahre ab. */
export function isPlausibleDate(isoDate: string): boolean {
  const year = Number(isoDate.slice(0, 4));
  return /^\d{4}-\d{2}-\d{2}$/.test(isoDate) && year >= 2000 && year <= 2100;
}
