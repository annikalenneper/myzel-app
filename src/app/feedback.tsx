// Querschnitt S-90: Bestätigung mit Rückgängig (WF-ALL-02), Versionskonflikt (WF-ALL-01),
// Netzfehler mit erneutem Versuch (WF-ALL-03) – auf allen Screens gleich.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api } from '../data';
import { isAppError, type AppError } from '../shared/errors';
import { formatAgo } from '../shared/format';
import { useLocation } from 'react-router-dom';
import { useSession } from './session';
import { enqueueAction } from './useActions';
import { refreshAll } from './useData';

/** So lange bleibt die Leiste mit „Rückgängig“ sichtbar. */
const BAR_MS = 6000;

export interface RunOptions<T> {
  /** Text der Bestätigung, z. B. „Status: Erledigt“ */
  success?: string | ((result: T) => string | null);
  /** Token für „Rückgängig“ aus dem Ergebnis */
  undo?: (result: T) => string | undefined;
  /** eigene Texteingabe: bleibt im Konfliktdialog zum Kopieren sichtbar */
  ownInput?: string;
  /** Pflichtfeld fehlt oder Regel verletzt: Meldung direkt am Feld statt in der Leiste */
  onInvalid?: (error: AppError) => void;
  /** der Text liegt als lokaler Entwurf auf dem Gerät – nur dann sagt die Netzfehler-Meldung das auch */
  draftKept?: boolean;
  /** wie das Objekt im Konfliktdialog heißt, z. B. „diese Aufgabe“ */
  subject?: string;
  /** die Aktion ist gescheitert (auch Netzfehler, Konflikt) – vor jeder Meldung */
  onFailed?: () => void;
}

type Bar =
  | { kind: 'done'; text: string; undoToken?: string }
  | { kind: 'error'; text: string }
  | { kind: 'network'; text: string; retry: () => void; dismiss: () => void };

interface Conflict {
  name: string | null;
  at: string | null;
  ownInput?: string;
  subject: string;
}

interface FeedbackValue {
  /** Führt eine schreibende Aktion aus und kümmert sich um Bestätigung und Fehler. */
  run<T>(action: () => Promise<T>, options?: RunOptions<T>): Promise<T | undefined>;
  /** Verwirft eine offene Netzfehler-Meldung, damit die nächste Aktion nicht dahinter wartet */
  dismissNetwork(): void;
  /** kurze Bestätigung ohne Aktion, z. B. „Gespeichert“ */
  notify(text: string): void;
  barVisible: boolean;
}

const FeedbackContext = createContext<FeedbackValue | null>(null);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [bar, setBar] = useState<Bar | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const { pathname } = useLocation();
  const session = useSession();
  const sessionKey = session?.state === 'member' ? session.member.id : (session?.state ?? 'laden');

  /** Verwirft einen offenen Netzfehler: der wartende Aufrufer erfährt, dass nichts gespeichert wurde */
  const pending = useRef<(() => void) | null>(null);

  const show = useCallback((next: Bar | null) => {
    window.clearTimeout(timer.current);
    pending.current?.();
    pending.current = null;
    setBar(next);
    if (next && next.kind !== 'network') timer.current = window.setTimeout(() => setBar(null), BAR_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Eine offene Netzfehler-Meldung gehört zur Ansicht und zur Person, die sie ausgelöst hat: Beim
  // Wechsel der Ansicht oder der Sitzung wird sie verworfen – „Nochmal“ führt nie die Aktion einer
  // anderen Person aus, und wartende Aktionen laufen weiter.
  useEffect(() => {
    setBar((current) => {
      if (current?.kind !== 'network') return current;
      pending.current?.();
      pending.current = null;
      return null;
    });
  }, [pathname, sessionKey]);

  const run = useCallback(
    async function run<T>(action: () => Promise<T>, options: RunOptions<T> = {}): Promise<T | undefined> {
      try {
        const result = await action();
        const text = typeof options.success === 'function' ? options.success(result) : options.success;
        const undoToken = options.undo?.(result);
        // leeres Token: die Aktion war schon erledigt (z. B. Doppeltipp) – die Leiste mit „Rückgängig“ bleibt
        if (text && undoToken !== '') show({ kind: 'done', text, undoToken });
        return result;
      } catch (e) {
        options.onFailed?.();
        if (!isAppError(e)) {
          console.error(e);
          show({ kind: 'error', text: 'Das hat nicht geklappt. Bitte versuch es noch einmal.' });
          return undefined;
        }
        if (e.code === 'network') {
          const kept = options.draftKept ? ' Dein Text bleibt auf diesem Gerät erhalten.' : '';
          // Der Aufrufer wartet weiter: Erst „Nochmal“ (mit Erfolg) oder das Schließen der Meldung
          // beendet die Aktion – so laufen seine Folgeschritte genau einmal.
          return new Promise<T | undefined>((resolve) => {
            const dismiss = () => resolve(undefined);
            show({
              kind: 'network',
              text: `${e.message}${kept}`,
              retry: () => {
                pending.current = null;
                show(null);
                resolve(run(action, options));
              },
              dismiss: () => show(null),
            });
            pending.current = dismiss;
          });
        } else if (e.code === 'conflict') {
          show(null);
          setConflict({
            name: e.conflict?.changed_by_name ?? null,
            at: e.conflict?.changed_at ?? null,
            ownInput: options.ownInput,
            subject: options.subject ?? 'diesen Eintrag',
          });
        } else if (e.code === 'unauthenticated') {
          refreshAll();
        } else if (options.onInvalid) {
          options.onInvalid(e);
        } else {
          show({ kind: 'error', text: e.message });
        }
        return undefined;
      }
    },
    [show],
  );

  const notify = useCallback((text: string) => show({ kind: 'done', text }), [show]);
  const dismissNetwork = useCallback(() => {
    if (pending.current) show(null);
  }, [show]);
  const value = useMemo<FeedbackValue>(
    () => ({ run, notify, dismissNetwork, barVisible: bar !== null }),
    [run, notify, dismissNetwork, bar],
  );

  const undo = (token: string) => {
    show(null);
    // in derselben Reihe wie die übrigen Aktionen: ein Tipp direkt danach wartet auf den neuen Stand
    void enqueueAction(
      async () =>
        (await run(() => api.undo(token).then(() => true), { success: 'Rückgängig gemacht' })) === true,
    );
  };

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      {bar?.kind === 'done' && (
        <div
          data-wf="WF-ALL-02"
          role="status"
          className="feedback-bar flex items-center gap-2.5 rounded-[14px] bg-leiste py-2.5 pr-2.5 pl-4 shadow-[0_8px_24px_rgba(0,0,0,0.4)]"
        >
          <span className="min-h-8 flex-1 content-center text-[14px]">{bar.text}</span>
          {bar.undoToken && (
            <button
              type="button"
              onClick={() => undo(bar.undoToken!)}
              className="hit h-8 rounded-2xl px-3 text-[14px] font-semibold text-pink"
            >
              Rückgängig
            </button>
          )}
        </div>
      )}
      {bar?.kind === 'error' && (
        <div
          role="alert"
          className="feedback-bar flex items-center gap-2.5 rounded-[14px] border border-rot-rand bg-rot-flaeche py-3 pr-2.5 pl-4"
        >
          <span className="flex-1 text-[14px] leading-[1.4]">{bar.text}</span>
          <button
            type="button"
            onClick={() => show(null)}
            className="hit h-[34px] rounded-[17px] px-3 text-[13px] text-weich"
          >
            Schließen
          </button>
        </div>
      )}
      {bar?.kind === 'network' && (
        <div
          data-wf="WF-ALL-03"
          role="alert"
          className="feedback-bar flex items-center gap-2.5 rounded-[14px] border border-rot-rand bg-rot-flaeche py-3 pr-2.5 pl-4"
        >
          <span className="flex-1 text-[14px] leading-[1.4]">{bar.text}</span>
          <button
            type="button"
            onClick={bar.retry}
            className="hit h-[34px] rounded-[17px] bg-rot px-3 text-[13px] font-semibold text-grund"
          >
            Nochmal
          </button>
          <button
            type="button"
            onClick={bar.dismiss}
            aria-label="Meldung schließen"
            className="hit size-7 flex-none rounded-full text-[16px] text-weich"
          >
            ×
          </button>
        </div>
      )}
      {conflict && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(6,5,10,0.72)] p-5">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-label="Inzwischen geändert"
            data-wf="WF-ALL-01"
            className="flex w-full max-w-[420px] flex-col gap-3.5 rounded-[22px] border border-rand bg-flaeche p-5"
          >
            <h2 className="m-0 text-[20px] font-bold">Inzwischen geändert</h2>
            <span className="text-[15px] leading-normal text-weich">
              {conflict.name ?? 'Jemand anderes'} hat {conflict.subject}{' '}
              {conflict.at ? formatAgo(conflict.at, new Date()) : 'inzwischen'} geändert. Deine Änderung wurde
              nicht gespeichert, damit nichts überschrieben wird.
            </span>
            {conflict.ownInput && (
              <div className="flex flex-col gap-1.5 rounded-xl border border-linie bg-grund px-3.5 py-3">
                <span className="label-mono">Deine Eingabe – zum Kopieren</span>
                <span className="text-[14px] leading-[1.45] whitespace-pre-wrap select-all">
                  {conflict.ownInput}
                </span>
              </div>
            )}
            <button
              type="button"
              autoFocus
              onClick={() => {
                setConflict(null);
                refreshAll();
                // die nächste Aktion wartet, bis der frische Stand geladen ist
                void enqueueAction(async () => true);
              }}
              className="h-12 rounded-3xl bg-geplant text-[15px] font-bold text-grund"
            >
              Neu laden
            </button>
          </div>
        </div>
      )}
    </FeedbackContext.Provider>
  );
}

export function useFeedback(): FeedbackValue {
  const value = useContext(FeedbackContext);
  if (!value) throw new Error('useFeedback außerhalb des FeedbackProvider');
  return value;
}

// Mehrere Ansichten können gleichzeitig eingehängt sein (Liste und Detail): es gilt die zuletzt geöffnete.
const barOffsets: { px: number }[] = [];
const applyBarOffset = () => {
  const top = barOffsets.at(-1);
  if (top) document.documentElement.style.setProperty('--bar-offset', `${top.px}px`);
  else document.documentElement.style.removeProperty('--bar-offset');
};

/** Abstand der Leiste zum unteren Rand, solange diese Ansicht offen ist (über Navigation bzw. Kommentarfeld). */
export function BarOffset({ px }: { px: number }) {
  useEffect(() => {
    const entry = { px };
    barOffsets.push(entry);
    applyBarOffset();
    return () => {
      barOffsets.splice(barOffsets.indexOf(entry), 1);
      applyBarOffset();
    };
  }, [px]);
  return null;
}
