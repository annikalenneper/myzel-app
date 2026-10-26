import { describe, expect, it } from 'vitest';
import { calendarEnd, googleCalendarUrl, icsFile, icsFileName } from './calendar';

const plenum = {
  id: 'a1',
  title: 'Plenum Oktober; mit Gästen, offen',
  starts_at: '2026-10-30T17:00:00.000Z',
  ends_at: null,
  format: 'hybrid' as const,
  location: 'Lager',
  online_url: 'https://meet.example.org/myzel',
  description: 'Bitte Protokoll\nmitbringen',
  status: 'geplant' as const,
  is_plenum: true,
};
const link = 'https://myzel.example.org/termine/a1';

describe('Termin in den Kalender (16.5)', () => {
  it('ohne Ende: Plenum 3 Stunden, sonst 1 Stunde', () => {
    expect(calendarEnd(plenum)).toBe('2026-10-30T20:00:00.000Z');
    expect(calendarEnd({ ...plenum, is_plenum: false })).toBe('2026-10-30T18:00:00.000Z');
  });

  it('Google-Link mit Titel, Zeit in UTC, Ort und Beschreibung samt Call und Link in Myzel', () => {
    const url = new URL(googleCalendarUrl(plenum, link));
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(url.searchParams.get('text')).toBe(plenum.title);
    expect(url.searchParams.get('dates')).toBe('20261030T170000Z/20261030T200000Z');
    expect(url.searchParams.get('location')).toBe('Lager');
    expect(url.searchParams.get('details')).toBe(
      `Bitte Protokoll\nmitbringen\n\nCall: https://meet.example.org/myzel\n\n${link}`,
    );
  });

  it('.ics: maskierter Text, Zeilen höchstens 75 Bytes, abgesagt als CANCELLED', () => {
    const ics = icsFile({ ...plenum, description: 'Ä'.repeat(60) }, link, new Date('2026-10-28T10:00:00Z'));
    expect(ics).toContain('UID:a1@myzel\r\n');
    expect(ics).toContain('DTSTART:20261030T170000Z\r\n');
    expect(ics).toContain('SUMMARY:Plenum Oktober\\; mit Gästen\\, offen\r\n');
    expect(ics).toContain('STATUS:CONFIRMED');
    const encoder = new TextEncoder();
    for (const line of ics.split('\r\n')) expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    // entfaltet ergibt sich wieder der ganze Text
    expect(ics.replace(/\r\n /g, '')).toContain(`DESCRIPTION:${'Ä'.repeat(60)}\\n\\nCall:`);
    expect(icsFile({ ...plenum, status: 'abgesagt' }, link, new Date())).toContain('STATUS:CANCELLED');
  });

  it('Dateiname ohne Sonderzeichen', () => {
    expect(icsFileName('Plenum Oktober: Straßenfest & Bühne')).toBe('Plenum-Oktober-Strassenfest-Buhne.ics');
    expect(icsFileName('!!!')).toBe('Termin.ics');
  });
});
