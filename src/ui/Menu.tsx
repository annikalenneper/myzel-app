// Aufklappmenü unter den Filter-Pillen (S-10, WF-AUF-01)
import { useEffect } from 'react';
import { cx } from './bits';

export interface MenuOption {
  key: string;
  label: string;
  selected: boolean;
  indent?: boolean;
}

export function Menu({
  label,
  options,
  onPick,
  onClose,
  wf,
}: {
  label: string;
  options: MenuOption[];
  onPick: (key: string) => void;
  onClose: () => void;
  wf?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <button
        type="button"
        tabIndex={-1}
        aria-label="Menü schließen"
        onClick={onClose}
        className="fixed inset-0 z-[5] cursor-default"
      />
      <div
        role="group"
        aria-label={label}
        className="absolute top-full left-5 z-[6] mt-1 flex max-h-[60dvh] w-[240px] flex-col gap-0.5 overflow-y-auto rounded-[14px] border border-rand bg-erhoeht p-1.5 shadow-[0_12px_28px_rgba(0,0,0,0.5)]"
      >
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            data-wf={wf}
            aria-pressed={o.selected}
            onClick={() => onPick(o.key)}
            className={cx(
              'flex min-h-11 flex-none items-center justify-between gap-2 rounded-[10px] px-3 py-1.5 text-left text-[15px] text-text',
              o.selected ? 'bg-linie font-semibold' : 'bg-transparent',
              o.indent && 'pl-7',
            )}
          >
            {o.label}
            <span className="font-mono text-[13px] text-pink">{o.selected ? '✓' : ''}</span>
          </button>
        ))}
      </div>
    </>
  );
}
