// Kachel für Datum mit Uhrzeit (Beginn/Ende) als natives Feld
import { cx } from './bits';

export function DateTimeTile({
  id,
  label,
  value,
  onChange,
  wf,
  invalid,
}: {
  id: string;
  label: string;
  /** Wert eines <input type="datetime-local"> */
  value: string;
  onChange: (value: string) => void;
  wf: string;
  invalid?: boolean;
}) {
  return (
    <label
      htmlFor={id}
      className={cx(
        'flex flex-col gap-1.5 rounded-[14px] border bg-grund px-3 py-2.5 focus-within:border-violett',
        invalid ? 'border-rot' : 'border-linie',
      )}
    >
      <span className="label-mono">{label}</span>
      <input
        id={id}
        type="datetime-local"
        data-wf={wf}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cx('h-8 w-full min-w-0 bg-transparent text-[14px]', value ? 'text-text' : 'text-leise')}
      />
    </label>
  );
}
