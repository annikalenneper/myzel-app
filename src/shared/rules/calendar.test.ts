import { describe, expect, it } from 'vitest';
import { calendarEnd, GOOGLE_DETAILS_MAX, googleCalendarUrl, icsFile, icsFileName } from './calendar';

const plenum = {
  id: 'a1',
  title: 'Plenum Oktober; mit Gästen, offen',
  starts_at: '2026-10-30T17:00:00.000Z',
  ends_at: null,
  format: 'hybrid' as const,
  location: 'Lager',
  online_url: 'https://meet.example.org/myzel',
  description: 'Bitte Protokoll\nmitbringen',
  version: 3,
  is_plenum: true,
};
const link = 'https://myzel.example.org/termine/a1';
const encoder = new TextEncoder();
const unfold = (ics: string) => ics.replace(/\r\n /g, '');

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

  it('online: der Call ist der Ort; vor Ort: kein Call; ohne Ort kein location', () => {
    const online = new URL(googleCalendarUrl({ ...plenum, format: 'online', location: null }, link));
    expect(online.searchParams.get('location')).toBe('https://meet.example.org/myzel');
    expect(online.searchParams.get('details')).toContain('Call: https://meet.example.org/myzel');
    const here = new URL(googleCalendarUrl({ ...plenum, format: 'vor_ort', online_url: null }, link));
    expect(here.searchParams.get('details')).not.toContain('Call:');
    const nowhere = { ...plenum, format: 'vor_ort' as const, location: null, online_url: null };
    expect(new URL(googleCalendarUrl(nowhere, link)).searchParams.has('location')).toBe(false);
    expect(icsFile(nowhere, link, new Date())).not.toContain('LOCATION:');
  });

  it('Google-Link: lange Beschreibung gekürzt, Call und Link in Myzel bleiben', () => {
    const url = new URL(googleCalendarUrl({ ...plenum, description: 'Ä'.repeat(10_000) }, link));
    const details = url.searchParams.get('details')!;
    expect(details.startsWith(`${'Ä'.repeat(GOOGLE_DETAILS_MAX - 1)}…`)).toBe(true);
    expect(details.endsWith(link)).toBe(true);
    expect(url.toString().length).toBeLessThan(16_000);
  });

  it('.ics: maskierter Text, Version als SEQUENCE, Zeilen höchstens 75 Bytes – auch mit Emoji', () => {
    const text = `${'Ä'.repeat(40)}👩‍👩‍👧${'x'.repeat(30)}🎉`;
    const ics = icsFile({ ...plenum, description: text }, link, new Date('2026-10-28T10:00:00Z'));
    expect(ics).toContain('UID:a1@myzel\r\n');
    expect(ics).toContain('DTSTART:20261030T170000Z\r\n');
    expect(ics).toContain('SEQUENCE:3\r\n');
    expect(ics).toContain('SUMMARY:Plenum Oktober\\; mit Gästen\\, offen\r\n');
    for (const line of ics.split('\r\n')) expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    // entfaltet ergibt sich wieder der ganze Text
    expect(unfold(ics)).toContain(`DESCRIPTION:${text}\\n\\nCall:`);
  });

  it('Dateiname ohne Sonderzeichen', () => {
    expect(icsFileName('Plenum Oktober: Straßenfest & Bühne')).toBe('Plenum-Oktober-Strassenfest-Buhne.ics');
    expect(icsFileName('!!!')).toBe('Termin.ics');
  });
});
