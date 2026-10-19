// Bottom-Sheet (mobil) bzw. zentrierter Dialog (Desktop) wie in den Prototyp-Screens
import { useEffect, useRef, type ReactNode } from 'react';
import { IconClose } from './icons';

let openSheets = 0;

/** Für Vollbild-Dialoge ohne Sheet: Hintergrund sperren, Leiste nach oben, Escape schließt. */
export function useModal(onClose: () => void): void {
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
    };
    document.addEventListener('keydown', onKey);
    openSheets += 1;
    document.documentElement.dataset.sheet = '';
    return () => {
      document.removeEventListener('keydown', onKey);
      openSheets -= 1;
      if (openSheets === 0) delete document.documentElement.dataset.sheet;
    };
  }, []);
}

export function Sheet({
  title,
  onClose,
  wf,
  closeButton,
  children,
}: {
  title: string;
  onClose: () => void;
  /** Workflow-ID des Dialogs (data-wf) */
  wf?: string;
  closeButton?: boolean;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
    };
    document.addEventListener('keydown', onKey);
    openSheets += 1;
    document.documentElement.dataset.sheet = '';
    const previous = document.activeElement as HTMLElement | null;
    if (!panel.current?.contains(document.activeElement)) panel.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      openSheets -= 1;
      if (openSheets === 0) delete document.documentElement.dataset.sheet;
      previous?.focus?.();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-30 bg-[rgba(6,5,10,0.72)]">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Schließen"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-wf={wf}
        tabIndex={-1}
        className="absolute inset-x-0 bottom-0 flex max-h-[92dvh] flex-col gap-4 overflow-y-auto rounded-t-[26px] border-t border-rand bg-flaeche px-5 pt-2.5 pb-[calc(24px+env(safe-area-inset-bottom,0px))] outline-none lg:inset-x-auto lg:top-1/2 lg:bottom-auto lg:left-1/2 lg:w-[480px] lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-[26px] lg:border lg:pb-6"
      >
        <div
          aria-hidden="true"
          className="h-1 w-10 flex-none self-center rounded-sm bg-rand-stark lg:invisible"
        />
        <div className="flex items-center justify-between">
          <h2 className="m-0 text-[20px] leading-[1.25] font-bold tracking-[-0.3px]">{title}</h2>
          {closeButton && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Schließen"
              className="hit flex size-10 items-center justify-center text-leise"
            >
              <IconClose size={22} />
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
