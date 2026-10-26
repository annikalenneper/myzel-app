// Gemeinsame Teile der Listen mit Datum (Termine, Events): Reiter Kommend/Vergangen, Monats-Überschriften und
// die Datumskachel mit Wochentag und Tag – der Monat steht in der Überschrift.
import type { ReactNode } from 'react';
import { cx } from './bits';

const WEEKDAYS = ['SO', 'MO', 'DI', 'MI', 'DO', 'FR', 'SA'] as const;
const MONTHS = [
  'JANUAR',
  'FEBRUAR',
  'MÄRZ',
  'APRIL',
  'MAI',
  'JUNI',
  'JULI',
  'AUGUST',
  'SEPTEMBER',
  'OKTOBER',
  'NOVEMBER',
  'DEZEMBER',
] as const;

export type TimeTab = 'kommend' | 'vergangen';

/** Reiter KOMMEND / VERGANGEN */
export function TimeTabs({
  value,
  onChange,
  wf,
}: {
  value: TimeTab;
  onChange: (t: TimeTab) => void;
  wf: string;
}) {
  return (
    <div role="tablist" className="flex gap-[22px] border-b border-linie">
      {(
        [
          ['kommend', 'KOMMEND'],
          ['vergangen', 'VERGANGEN'],
        ] as const
      ).map(([key, label]) => (
        <button
          key={key}
          type="button"
          role="tab"
          data-wf={wf}
          aria-selected={value === key}
          onClick={() => onChange(key)}
          className={cx(
            '-mb-px min-h-11 border-b-2 py-2.5 font-mono text-[12px]',
            value === key ? 'border-pink text-text' : 'border-transparent text-leise',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** „OKTOBER 2026“ – Gruppen in der Reihenfolge der Einträge */
export function byMonth<T>(items: readonly T[], date: (item: T) => string): { name: string; items: T[] }[] {
  const months: { name: string; items: T[] }[] = [];
  for (const item of items) {
    const d = new Date(date(item));
    const name = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    if (months.at(-1)?.name === name) months.at(-1)!.items.push(item);
    else months.push({ name, items: [item] });
  }
  return months;
}

/** Monat mit Überschrift */
export function MonthSection({ name, children }: { name: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3" aria-label={name}>
      <h2 className="label-mono m-0 pt-1 font-normal">{name}</h2>
      {children}
    </section>
  );
}

/** Kachel „DI 21“ – Wochentag und Tag */
export function DateBadge({ iso }: { iso: string }) {
  const d = new Date(iso);
  return (
    <div className="flex h-[58px] w-[52px] flex-none flex-col items-center justify-center gap-0.5 rounded-xl bg-grund">
      <span className="font-mono text-[11px] text-leise">{WEEKDAYS[d.getDay()]}</span>
      <span className="text-[22px] leading-[1.2] font-bold">{String(d.getDate()).padStart(2, '0')}</span>
    </div>
  );
}
