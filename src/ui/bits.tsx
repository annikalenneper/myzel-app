// Kleine Bausteine im Stil D (ANFORDERUNGEN 8.2): Pillen, Pegel, Initialen-Blasen, Häkchen
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { bubbleColor, PRIORITY_BARS, PRIORITY_LABEL } from '../shared/labels';
import type { Member, Priority } from '../shared/schema';

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');
export { cx };

/** Filter- und Auswahl-Pille */
export function Pill({
  on,
  size = 'md',
  className,
  children,
  ...rest
}: { on: boolean; size?: 'md' | 'sm' } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-pressed={on}
      className={cx(
        'hit flex-none rounded-full border whitespace-nowrap',
        size === 'md' ? 'h-9 px-3.5 text-[14px]' : 'h-[34px] px-3 text-[13px]',
        on ? 'border-text bg-text font-semibold text-grund' : 'border-rand bg-transparent text-weich',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Priorität als Pegel mit 1–3 Balken */
export function PriorityBars({ priority, small }: { priority: Priority; small?: boolean }) {
  const heights = small ? [6, 10, 14] : [8, 12, 16];
  return (
    <span
      className="flex items-end gap-0.5"
      role="img"
      aria-label={`Priorität ${PRIORITY_LABEL[priority].toLowerCase()}`}
    >
      {heights.map((h, i) => (
        <span
          key={h}
          className={cx(
            'rounded-sm',
            small ? 'w-[3px]' : 'w-1',
            i < PRIORITY_BARS[priority] ? 'bg-text' : 'bg-rand',
          )}
          style={{ height: h }}
        />
      ))}
    </span>
  );
}

/** Person als farbige Initialen-Blase */
export function Avatar({
  member,
  size = 28,
  fontSize,
  className,
}: {
  member: Pick<Member, 'id' | 'short' | 'active' | 'display_name'> | undefined;
  size?: number;
  /** Schriftgröße der Initialen, wenn sie vom Standard abweicht */
  fontSize?: number;
  className?: string;
}) {
  const inactive = !member || !member.active;
  return (
    <span
      title={member?.display_name}
      className={cx(
        'flex flex-none items-center justify-center rounded-full font-mono font-semibold',
        inactive ? 'bg-linie text-leise' : 'text-grund',
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: fontSize ?? Math.max(9, Math.round(size * 0.34)),
        background: inactive ? undefined : bubbleColor(member.id),
      }}
    >
      {member?.short ?? '?'}
    </span>
  );
}

/** Zeile mit Häkchen-Kästchen wie „Ich übernehme das“ */
export function CheckRow({
  checked,
  onChange,
  children,
  hint,
  ...rest
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  children: ReactNode;
  hint?: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'>) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex h-12 items-center gap-3 rounded-[14px] border border-linie bg-grund px-3.5 text-left text-[15px] text-text"
      {...rest}
    >
      <CheckBox checked={checked} />
      <span className="flex-1">{children}</span>
      {hint && <span className="label-mono">{hint}</span>}
    </button>
  );
}

export function CheckBox({ checked, size = 22 }: { checked: boolean; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'flex flex-none items-center justify-center rounded-md border-2 text-[14px] font-bold text-grund',
        checked ? 'border-text bg-text' : 'border-rand-stark bg-transparent',
      )}
      style={{ width: size, height: size }}
    >
      {checked ? '✓' : ''}
    </span>
  );
}

/** Meldung direkt am Feld (5.8: Pflichtfeld fehlt oder Regel verletzt) */
export function FieldError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <span role="alert" className="text-[13px] leading-[1.4] text-rot-hell">
      {children}
    </span>
  );
}

export function PrimaryButton({ className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cx(
        'h-[52px] rounded-[26px] text-[16px] font-bold',
        rest.disabled ? 'bg-erhoeht text-[15px] font-semibold text-leise' : 'bg-marke-quer text-grund',
        className,
      )}
      {...rest}
    />
  );
}

export function LightButton({ className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cx(
        'h-[50px] rounded-[25px] text-[16px] font-bold',
        rest.disabled ? 'bg-erhoeht text-leise' : 'bg-geplant text-grund',
        className,
      )}
      {...rest}
    />
  );
}

export function GhostButton({ className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cx(
        'h-[46px] rounded-[23px] border border-rand-stark bg-transparent text-[15px] text-text',
        className,
      )}
      {...rest}
    />
  );
}

/** Platzhalter beim Laden (S-90) */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cx('animate-pulse rounded-[14px] bg-[#1E1A2A]', className)} />;
}

export function ListSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Lädt …">
      <Skeleton className="h-24" />
      <Skeleton className="h-24" />
      <Skeleton className="h-24" />
    </div>
  );
}

/** Daten ließen sich nicht laden: Meldung auf Deutsch und neuer Versuch (WF-ALL-03) */
export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-4 py-10 text-center">
      <span className="text-[16px] font-semibold">Das hat nicht geklappt</span>
      <span className="text-[14px] leading-normal text-leise">{message}</span>
      <button
        type="button"
        onClick={onRetry}
        className="hit h-[42px] rounded-[21px] border border-rand-stark px-[18px] text-[14px]"
      >
        Nochmal versuchen
      </button>
    </div>
  );
}
