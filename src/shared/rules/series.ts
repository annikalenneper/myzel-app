// Serien [P6] (ANFORDERUNGEN 3.6, F-TER-02, -03): Regel als RRULE, verständlich beschriftet.
// Unterstützt wird bewusst nur, was die Auswahl anbietet (Annahme A58): wöchentlich bzw. alle zwei Wochen an
// einem Wochentag, monatlich am n-ten oder letzten Wochentag, monatlich an einem Tag des Monats.
import { addDays } from './due';

/** Termine entstehen rollierend so weit im Voraus (3.6) */
export const SERIES_HORIZON_MONTHS = 3;
/** Einladung zu Serienterminen ca. 2 Wochen vorher (6.2) */
export const SERIES_INVITE_DAYS = 14;

const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
type Day = (typeof DAYS)[number];
const DAY_LABEL: Record<Day, string> = {
  MO: 'Montag',
  TU: 'Dienstag',
  WE: 'Mittwoch',
  TH: 'Donnerstag',
  FR: 'Freitag',
  SA: 'Samstag',
  SU: 'Sonntag',
};
const ORDINAL: Record<number, string> = { 1: '1.', 2: '2.', 3: '3.', 4: '4.', [-1]: 'letzten' };

export type SeriesRule =
  | { freq: 'weekly'; interval: 1 | 2; day: Day }
  | { freq: 'monthly_weekday'; day: Day; pos: 1 | 2 | 3 | 4 | -1 }
  | { freq: 'monthly_day'; monthDay: number };

export function parseRule(rrule: string): SeriesRule | null {
  const parts = new Map(
    rrule
      .replace(/^RRULE:/, '')
      .split(';')
      .map((p) => p.split('=') as [string, string]),
  );
  const freq = parts.get('FREQ');
  const day = parts.get('BYDAY') as Day | undefined;
  if (freq === 'WEEKLY' && day && DAYS.includes(day)) {
    const interval = Number(parts.get('INTERVAL') ?? 1);
    if (interval !== 1 && interval !== 2) return null;
    if ([...parts.keys()].some((k) => !['FREQ', 'BYDAY', 'INTERVAL'].includes(k))) return null;
    return { freq: 'weekly', interval, day };
  }
  if (freq === 'MONTHLY' && day && DAYS.includes(day) && parts.has('BYSETPOS')) {
    const pos = Number(parts.get('BYSETPOS'));
    if (![1, 2, 3, 4, -1].includes(pos) || parts.size !== 3) return null;
    return { freq: 'monthly_weekday', day, pos: pos as 1 | 2 | 3 | 4 | -1 };
  }
  if (freq === 'MONTHLY' && parts.has('BYMONTHDAY') && parts.size === 2) {
    const monthDay = Number(parts.get('BYMONTHDAY'));
    if (!Number.isInteger(monthDay) || monthDay < 1 || monthDay > 28) return null;
    return { freq: 'monthly_day', monthDay };
  }
  return null;
}

export function formatRule(rule: SeriesRule): string {
  if (rule.freq === 'weekly')
    return rule.interval === 1 ? `FREQ=WEEKLY;BYDAY=${rule.day}` : `FREQ=WEEKLY;INTERVAL=2;BYDAY=${rule.day}`;
  if (rule.freq === 'monthly_weekday') return `FREQ=MONTHLY;BYDAY=${rule.day};BYSETPOS=${rule.pos}`;
  return `FREQ=MONTHLY;BYMONTHDAY=${rule.monthDay}`;
}

/** „jeden 3. Samstag im Monat“, „jeden Dienstag“, „alle 2 Wochen dienstags“, „jeden 15. im Monat“ */
export function ruleLabel(rrule: string): string {
  const rule = parseRule(rrule);
  if (!rule) return 'Wiederkehrend';
  if (rule.freq === 'weekly')
    return rule.interval === 1
      ? `jeden ${DAY_LABEL[rule.day]}`
      : `alle 2 Wochen ${DAY_LABEL[rule.day].toLowerCase()}s`;
  if (rule.freq === 'monthly_weekday') return `jeden ${ORDINAL[rule.pos]} ${DAY_LABEL[rule.day]} im Monat`;
  return `jeden ${rule.monthDay}. im Monat`;
}

const parse = (isoDate: string) => {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
};
const iso = (d: Date) => d.toISOString().slice(0, 10);
const dayOf = (isoDate: string): Day => DAYS[parse(isoDate).getUTCDay()]!;

/**
 * Die Auswahl zum gewählten ersten Termin (F-TER-02: verständlich statt RRULE): passend zu diesem Datum, z. B.
 * Sa 17.10. → jeden Samstag · alle 2 Wochen · jeden 3. Samstag im Monat · jeden 17. im Monat.
 */
export function ruleChoices(firstDate: string): { rrule: string; label: string }[] {
  const date = parse(firstDate);
  const day = dayOf(firstDate);
  const monthDay = date.getUTCDate();
  const nth = Math.ceil(monthDay / 7);
  const last = parse(addDays(firstDate, 7)).getUTCMonth() !== date.getUTCMonth();
  const rules: SeriesRule[] = [
    { freq: 'weekly', interval: 1, day },
    { freq: 'weekly', interval: 2, day },
  ];
  if (nth <= 4) rules.push({ freq: 'monthly_weekday', day, pos: nth as 1 | 2 | 3 | 4 });
  if (last) rules.push({ freq: 'monthly_weekday', day, pos: -1 });
  if (monthDay <= 28) rules.push({ freq: 'monthly_day', monthDay });
  return rules.map((r) => ({ rrule: formatRule(r), label: ruleLabel(formatRule(r)) }));
}

function matches(rule: SeriesRule, isoDate: string, anchor: string): boolean {
  const d = parse(isoDate);
  if (rule.freq === 'monthly_day') return d.getUTCDate() === rule.monthDay;
  if (dayOf(isoDate) !== rule.day) return false;
  if (rule.freq === 'weekly') {
    if (rule.interval === 1) return true;
    const weeks = Math.round((d.getTime() - parse(anchor).getTime()) / (7 * 86_400_000));
    return Math.abs(weeks) % 2 === 0;
  }
  if (rule.pos === -1) return parse(addDays(isoDate, 7)).getUTCMonth() !== d.getUTCMonth();
  return Math.ceil(d.getUTCDate() / 7) === rule.pos;
}

/**
 * Tage der Serie von `from` bis einschließlich `until` (ISO-Daten). `anchor` legt nur den Takt fest
 * („alle 2 Wochen“ zählt ab dort, in beide Richtungen); die Untergrenze ist allein `from`.
 */
export function seriesDates(rrule: string, anchor: string, from: string, until: string): string[] {
  const rule = parseRule(rrule);
  if (!rule) return [];
  const out: string[] = [];
  for (let day = from; day <= until; day = addDays(day, 1)) if (matches(rule, day, anchor)) out.push(day);
  return out;
}

/** bis wann die Serie Termine anlegt: 3 Monate ab heute (am Monatsende höchstens bis zum letzten Tag), höchstens bis valid_until */
export function seriesHorizon(today: string, validUntil: string | null): string {
  const d = parse(today);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + SERIES_HORIZON_MONTHS);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  const horizon = iso(d);
  return validUntil && validUntil < horizon ? validUntil : horizon;
}

/**
 * Taktanker einer Regel ab `from`: der erste passende Wochentag. „Alle 2 Wochen“ zählt ab dort – so bleibt bei
 * einem Regelwechsel der nächste Termin erhalten, statt in den anderen Takt zu kippen.
 */
export function ruleAnchor(rrule: string, from: string): string {
  const rule = parseRule(rrule);
  if (!rule || rule.freq === 'monthly_day') return from;
  let day = from;
  while (dayOf(day) !== rule.day) day = addDays(day, 1);
  return day;
}
