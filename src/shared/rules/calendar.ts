// Termine in den eigenen Kalender übernehmen (16.5): Link „In Google Kalender eintragen“ und .ics-Datei.
// Zeiten in UTC – der Kalender rechnet sie in die eigene Zeitzone um.
import type { Appointment } from '../schema';
import { PLENUM_DEFAULT_HOURS } from './plenum';

type CalendarAppointment = Pick<
  Appointment,
  'id' | 'title' | 'starts_at' | 'ends_at' | 'format' | 'location' | 'online_url' | 'description' | 'version'
> & { is_plenum: boolean };

/** Beschreibung im Google-Link höchstens so lang – sonst wird die Adresse zu lang für Google */
export const GOOGLE_DETAILS_MAX = 1500;

/** Ohne Ende: ein Plenum dauert 3 Stunden (wie beim laufenden Plenum, U4), alle anderen Termine 1 Stunde */
export function calendarEnd(a: Pick<CalendarAppointment, 'starts_at' | 'ends_at' | 'is_plenum'>): string {
  if (a.ends_at) return a.ends_at;
  const hours = a.is_plenum ? PLENUM_DEFAULT_HOURS : 1;
  return new Date(new Date(a.starts_at).getTime() + hours * 3_600_000).toISOString();
}

/** „20261030T170000Z“ */
const utc = (iso: string) =>
  new Date(iso)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

const place = (a: CalendarAppointment) =>
  a.format === 'online' ? (a.online_url ?? '') : (a.location ?? a.online_url ?? '');

/** Beschreibung im Kalender: Text des Termins, Link zum Call, Link in Myzel */
function details(a: CalendarAppointment, appLink: string, max = Infinity): string {
  const text = a.description?.trim() ?? '';
  return [
    text.length > max ? `${text.slice(0, max - 1)}…` : text,
    a.online_url && a.format !== 'vor_ort' ? `Call: ${a.online_url}` : null,
    appLink,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Link, der Google Kalender mit vorausgefülltem Termin öffnet */
export function googleCalendarUrl(a: CalendarAppointment, appLink: string): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: a.title,
    dates: `${utc(a.starts_at)}/${utc(calendarEnd(a))}`,
    details: details(a, appLink, GOOGLE_DETAILS_MAX),
  });
  const where = place(a);
  if (where) params.set('location', where);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Text in iCalendar (RFC 5545): Backslash, Semikolon, Komma und Zeilenumbruch maskieren */
const escapeText = (text: string) =>
  text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Zeilen höchstens 75 Bytes, Fortsetzung mit Leerzeichen am Anfang (RFC 5545, 3.1) – Umlaute zählen doppelt */
function fold(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    // die Fortsetzungszeilen beginnen mit einem Leerzeichen und haben ein Byte weniger Platz
    if (bytes + size > (parts.length === 0 ? 75 : 74)) {
      parts.push(current);
      current = '';
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

/**
 * .ics-Datei mit genau diesem Termin. UID und SEQUENCE (die Version) erlauben Kalendern, einen erneut importierten
 * Termin zu aktualisieren – ob sie es tun, hängt vom Kalender ab (U20).
 */
export function icsFile(a: CalendarAppointment, appLink: string, now: Date): string {
  const where = place(a);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Myzel//Termine//DE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${a.id}@myzel`,
    `DTSTAMP:${utc(now.toISOString())}`,
    `DTSTART:${utc(a.starts_at)}`,
    `DTEND:${utc(calendarEnd(a))}`,
    `SEQUENCE:${a.version}`,
    `SUMMARY:${escapeText(a.title)}`,
    ...(where ? [`LOCATION:${escapeText(where)}`] : []),
    `DESCRIPTION:${escapeText(details(a, appLink))}`,
    `URL:${appLink}`,
    // abgesagte Termine bieten die App nicht zum Eintragen an
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

/** Dateiname ohne Sonderzeichen: „Plenum-Oktober.ics“ */
export function icsFileName(title: string): string {
  const base = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${base || 'Termin'}.ics`;
}
