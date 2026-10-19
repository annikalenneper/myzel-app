// Datums-Kachel wie im Prototyp („FRIST · Di, 20.10.“ bzw. „Datum wählen“): Das native Datumsfeld
// liegt unsichtbar über der Kachel, damit auf dem Handy der gewohnte Datumswähler aufgeht.
import { useEffect, useRef, useState } from 'react';
import { formatDateWithWeekday } from '../shared/format';
import { isPlausibleDate } from '../shared/rules/due';
import { cx } from './bits';

export function DateTile({
  label,
  value,
  onChange,
  wf,
  tone = 'text-text',
  surface = 'bg-flaeche',
}: {
  label: string;
  /** YYYY-MM-DD oder leer */
  value: string;
  onChange: (value: string) => void;
  wf: string;
  /** Textfarbe des Werts, z. B. rot bei überfällig */
  tone?: string;
  surface?: string;
}) {
  // Zwischenstand des Feldes. Die Auswahl im Datumswähler wird sofort weitergegeben; beim Tippen über
  // die Tastatur entstehen Zwischenwerte (leer, 0002-11-06, falscher Monat) – dann zählt erst der
  // Stand beim Verlassen des Feldes oder bei Enter (7.3).
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const [synced, setSynced] = useState(value);
  const typing = useRef(false);
  // Der Browser meldet ein halb ausgefülltes Feld („TT.11.2026“) als leer mit badInput – das ist
  // kein Löschen, und was er beim Verlassen daraus ergänzt, ist keine Eingabe.
  const incomplete = useRef(false);
  const keyed = useRef(false);
  if (value !== synced) {
    setSynced(value);
    if (!focused) setDraft(value);
  }
  const usable = (v: string) => v === '' || isPlausibleDate(v);
  const shown = usable(draft) ? draft : value;

  const commit = (next: string) => {
    typing.current = false;
    if (!usable(next)) return setDraft(value);
    if (next !== value) onChange(next);
  };

  // Verschwindet die Ansicht mitten in der Eingabe, geht ein vollständiges Datum nicht verloren
  const latest = useRef({ draft, value, onChange });
  useEffect(() => {
    latest.current = { draft, value, onChange };
  });
  useEffect(
    () => () => {
      const now = latest.current;
      if (typing.current && !incomplete.current && now.draft !== now.value && isPlausibleDate(now.draft))
        now.onChange(now.draft);
    },
    [],
  );

  return (
    <div
      className={cx(
        'relative flex min-h-[68px] flex-col gap-1.5 rounded-[14px] border border-linie px-3.5 py-3 focus-within:border-violett',
        surface,
      )}
    >
      <span className="label-mono">{label}</span>
      <span className={cx('text-[15px]', shown ? tone : 'text-leise')}>
        {shown ? formatDateWithWeekday(shown) : 'Datum wählen'}
      </span>
      <input
        type="date"
        data-wf={wf}
        aria-label={label}
        value={draft}
        onFocus={() => setFocused(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (!incomplete.current) commit(draft);
          } else if (
            e.key.length === 1 ||
            e.key === 'Backspace' ||
            e.key === 'Delete' ||
            e.key.startsWith('Arrow')
          ) {
            typing.current = true;
            keyed.current = true;
          }
        }}
        onChange={(e) => {
          const next = e.target.value;
          // Nur ein Tastendruck kann das Feld vervollständigen: Was der Browser beim Verlassen aus
          // einer halben Eingabe ergänzt (Tag „0“ wird „01“), zählt nicht.
          if (keyed.current || !incomplete.current) incomplete.current = e.target.validity.badInput;
          keyed.current = false;
          setDraft(next);
          if (!typing.current && !incomplete.current) commit(next);
        }}
        onBlur={() => {
          setFocused(false);
          if (incomplete.current) {
            incomplete.current = false;
            typing.current = false;
            setDraft(value);
          } else if (typing.current) commit(draft);
          else if (!usable(draft)) setDraft(value);
        }}
        onClick={(e) => {
          try {
            e.currentTarget.showPicker();
          } catch {
            // ältere Browser: das Feld öffnet seinen Wähler selbst
          }
        }}
        className="absolute inset-0 size-full cursor-pointer opacity-0"
      />
      {shown && (
        <button
          type="button"
          data-wf={wf}
          aria-label={`${label} entfernen`}
          onClick={() => {
            typing.current = false;
            incomplete.current = false;
            setDraft('');
            if (value !== '') onChange('');
          }}
          className="hit absolute top-2 right-2 size-7 rounded-full text-[16px] text-leise"
        >
          ×
        </button>
      )}
    </div>
  );
}
