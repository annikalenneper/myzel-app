// Veranstaltung: Detailbereiche [P4] (ANFORDERUNGEN 3.4, F-VER-04) – Beschriftungen, leere Werte und
// Kurzzusammenfassungen; offene Punkte werden in Bernstein hervorgehoben.
import type { EventBooking, EventDetails, EventStatus, FrameItem, FrameStatus } from '../schema';
import { FRAME_ITEMS } from '../schema';
import { berlinDate } from './due';

export const LOCATION_CONFIRMATION_LABEL = {
  offen: 'Offen',
  angefragt: 'Angefragt',
  zugesagt: 'Zugesagt',
  vertrag: 'Vertrag',
} as const;
export const BOOKING_ACT_TYPE_LABEL = { dj: 'DJ', band: 'Band', sonstiges: 'Sonstiges' } as const;
export const BOOKING_STATUS_LABEL = {
  angefragt: 'Angefragt',
  zugesagt: 'Zugesagt',
  abgesagt: 'Abgesagt',
} as const;
export const BAR_MODE_LABEL = { selbst: 'Machen wir selbst', extern: 'Extern', keine: 'Keine Bar' } as const;
export const ENTRY_MODE_LABEL = { frei: 'Frei', spende: 'Spende', fester_preis: 'Fester Preis' } as const;
export const FRAME_ITEM_LABEL: Record<FrameItem, string> = {
  permits: 'Genehmigungen',
  insurance: 'Versicherung',
  gema: 'GEMA',
  youth_protection: 'Jugendschutz',
  awareness_concept: 'Awareness-Konzept',
  awareness_team: 'Awareness-Team',
};
export const FRAME_STATUS_LABEL: Record<FrameStatus, string> = {
  offen: 'Offen',
  erledigt: 'Erledigt',
  entfaellt: 'Entfällt',
};

export function emptyEventDetails(eventId: string): EventDetails {
  return {
    event_id: eventId,
    location: {
      name: null,
      address: null,
      contact: null,
      capacity: null,
      cost: null,
      confirmation: null,
      accessibility_notes: null,
    },
    bar: { mode: null, drinks_planning: null, notes: null },
    entry: { mode: null, price: null, cashier_notes: null },
    frame: Object.fromEntries(
      FRAME_ITEMS.map((item) => [item, { status: 'offen', note: null }]),
    ) as EventDetails['frame'],
    communication: { announcement_date: null, channels: null },
    numbers: { budget_planned: null, expected_visitors: null, actual_visitors: null },
    retrospective: null,
  };
}

export type DetailSection =
  | 'location'
  | 'booking'
  | 'bar'
  | 'entry'
  | 'frame'
  | 'communication'
  | 'numbers'
  | 'retrospective'
  | 'partner';

export const DETAIL_SECTION_LABEL: Record<DetailSection, string> = {
  location: 'Location',
  booking: 'Booking',
  bar: 'Bar',
  entry: 'Eintritt',
  frame: 'Rahmen',
  communication: 'Kommunikation',
  numbers: 'Zahlen',
  retrospective: 'Nachbereitung',
  partner: 'Partner',
};

export interface SectionSummary {
  section: DetailSection;
  /** Kurzzusammenfassung, „—“ wenn noch nichts eingetragen ist */
  text: string;
  /** offene Punkte: in Bernstein */
  open: boolean;
}

const euro = (n: number) => `${n.toLocaleString('de-DE')} €`;

/** Kurzzusammenfassungen aller Bereiche (F-VER-04) */
export function sectionSummaries(
  details: EventDetails,
  bookings: readonly EventBooking[],
  partners: readonly { name: string }[] = [],
): SectionSummary[] {
  const { location: l, bar, entry, frame, communication: c, numbers: n } = details;

  const locationParts = [
    l.name,
    // Status steht immer auch als Text da (8.1) – nicht nur in Bernstein
    l.confirmation && l.confirmation !== 'offen'
      ? LOCATION_CONFIRMATION_LABEL[l.confirmation]
      : l.name || l.confirmation
        ? 'Bestätigung offen'
        : null,
    l.capacity ? `bis ${l.capacity} Personen` : null,
  ].filter(Boolean);
  const locationOpen =
    !!(l.name || l.confirmation) &&
    (l.confirmation === null || l.confirmation === 'offen' || l.confirmation === 'angefragt');

  const active = bookings.filter((b) => b.status !== 'abgesagt');
  const confirmed = active.filter((b) => b.status === 'zugesagt').length;
  const asked = active.length - confirmed;

  const openFrame = FRAME_ITEMS.filter((item) => frame[item].status === 'offen');
  const doneFrame = FRAME_ITEMS.length - openFrame.length;
  const frameTouched = FRAME_ITEMS.some((item) => frame[item].status !== 'offen' || frame[item].note);

  return [
    {
      section: 'location',
      text: locationParts.length ? locationParts.join(' · ') : '—',
      open: locationOpen,
    },
    {
      section: 'booking',
      text: active.length
        ? [confirmed && `${confirmed} zugesagt`, asked && `${asked} angefragt`].filter(Boolean).join(' · ')
        : '—',
      open: asked > 0,
    },
    {
      section: 'bar',
      text: bar.mode ? [BAR_MODE_LABEL[bar.mode], bar.drinks_planning].filter(Boolean).join(' · ') : '—',
      open: false,
    },
    {
      section: 'entry',
      text: entry.mode ? [ENTRY_MODE_LABEL[entry.mode], entry.price].filter(Boolean).join(' ') : '—',
      open: false,
    },
    {
      section: 'frame',
      text: frameTouched
        ? openFrame.length
          ? `${openFrame
              .map((i) => FRAME_ITEM_LABEL[i])
              .slice(0, 2)
              .join(
                ', ',
              )}${openFrame.length > 2 ? ` +${openFrame.length - 2}` : ''} offen · ${doneFrame} von ${FRAME_ITEMS.length} geklärt`
          : 'Alles geklärt'
        : '—',
      open: frameTouched && openFrame.length > 0,
    },
    {
      section: 'communication',
      text:
        [c.announcement_date && `Ankündigung ${formatDate(c.announcement_date)}`, c.channels]
          .filter(Boolean)
          .join(' · ') || '—',
      open: false,
    },
    {
      section: 'numbers',
      text:
        [
          n.budget_planned !== null && `Budget ${euro(n.budget_planned)}`,
          n.expected_visitors !== null && `${n.expected_visitors} erwartet`,
          n.actual_visitors !== null && `${n.actual_visitors} da`,
        ]
          .filter(Boolean)
          .join(' · ') || '—',
      open: false,
    },
    {
      section: 'retrospective',
      text: details.retrospective ? firstLine(details.retrospective) : '—',
      open: false,
    },
    {
      section: 'partner',
      text: partners.length ? partners.map((p) => p.name).join(', ') : '—',
      open: false,
    },
  ];
}

const formatDate = (iso: string) => {
  const [, m, d] = iso.split('-');
  return `${d}.${m}.`;
};
const firstLine = (text: string) => {
  const line = text.split('\n')[0]!.trim();
  return line.length > 60 ? `${line.slice(0, 57)}…` : line;
};

/**
 * WF-VER-07: Am Tag nach der Veranstaltung schlägt die App „In Nachbereitung“ vor – solange sie noch
 * „bestätigt“ ist. Maßgeblich ist das Ende, ohne Ende der Beginn.
 */
export function suggestsFollowUp(
  event: { status: EventStatus; starts_at: string; ends_at: string | null },
  now: Date,
): boolean {
  if (event.status !== 'bestaetigt') return false;
  // „am Tag danach“ nach Kölner Kalender, auch auf dem Server
  return berlinDate(now) > berlinDate(new Date(event.ends_at ?? event.starts_at));
}

/** Ab so vielen Tagen in Nachbereitung zeigt die Liste einen Hinweis (4.2) */
export const LONG_FOLLOW_UP_DAYS = 30;

/** Zahl in deutscher Schreibweise: „2.500“ und „2.500,50“ wie „2500“ und „2500,5“ */
export function parseGermanNumber(text: string): number | null {
  const t = text.trim().replace(/\s/g, '');
  if (t === '') return null;
  const plain = /^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t) ? t.replace(/\./g, '') : t;
  const n = Number(plain.replace(',', '.'));
  return Number.isNaN(n) ? NaN : n;
}
