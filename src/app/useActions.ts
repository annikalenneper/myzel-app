import { useCallback, useEffect, useRef } from 'react';
import { useFeedback, type RunOptions } from './feedback';
import { dataSettled, showOptimistic, type OptimisticPatch } from './useData';

export interface ActOptions<T> extends RunOptions<T> {
  /** erwartete Wirkung, sofort angezeigt – bis der neue Stand geladen ist oder die Aktion scheitert (16.6) */
  optimistic?: OptimisticPatch[];
}

// Eine Reihe für alle Aktionen mit Versionsprüfung – auch „Rückgängig“ stellt sich hier an.
let queue: Promise<unknown> = Promise.resolve();

/** Stellt eine Aktion hinten an; die nächste startet erst, wenn der neue Stand geladen ist. */
export function enqueueAction(action: () => Promise<boolean>): Promise<boolean> {
  const next = queue.then(async () => {
    const ok = await action();
    if (ok) await dataSettled();
    return ok;
  });
  queue = next.catch(() => false);
  return next;
}

/**
 * Schreibende Aktionen einer Detailansicht laufen nacheinander: Die nächste startet erst, wenn der
 * neue Stand (und damit die neue version) geladen ist – sonst gäbe es Konflikte mit sich selbst.
 * Schnelle Tipps hintereinander gehen nicht verloren, sie warten in der Reihe. Aktionen lesen die
 * version erst beim Start (siehe `useLatest`), nicht beim Tippen.
 */
export function useActions() {
  const { run, dismissNetwork } = useFeedback();
  return useCallback(
    function act<T>(action: () => Promise<T>, options: ActOptions<T> = {}): Promise<boolean> {
      // Wer bei offener Netzfehler-Meldung weitermacht, verzichtet auf „Nochmal“ – sonst bliebe der
      // neue Tipp ohne sichtbare Wirkung hinter der Meldung hängen.
      dismissNetwork();
      const { optimistic, ...runOptions } = options;
      const shown = optimistic?.length ? showOptimistic(...optimistic) : null;
      const hide = () => shown?.hide();
      return enqueueAction(async () => {
        let ok = false;
        await run(
          async () => {
            const result = await action();
            ok = true;
            return result;
          },
          {
            ...runOptions,
            onFailed: () => {
              hide();
              runOptions.onFailed?.();
            },
          },
        );
        if (ok) shown?.settle();
        else hide();
        return ok;
      }).catch((e: unknown) => {
        hide();
        throw e;
      });
    },
    [run, dismissNetwork],
  );
}

/** Immer der Wert des letzten Renderns – für Aktionen, die erst später an die Reihe kommen. */
export function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}
