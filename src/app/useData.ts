import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../data';
import { AppError, isAppError } from '../shared/errors';

const refreshListeners = new Set<() => void>();

/** Lädt alle sichtbaren Daten neu, z. B. nach „Neu laden“ im Konfliktdialog. */
export function refreshAll(): void {
  refreshListeners.forEach((l) => l());
}

let inflight = 0;
const idleWaiters = new Set<() => void>();
const loadDone = () => {
  inflight -= 1;
  if (inflight === 0) {
    // erst nach dem nächsten Rendern kennen die Ansichten den neuen Stand
    const waiting = [...idleWaiters];
    idleWaiters.clear();
    window.setTimeout(() => waiting.forEach((resolve) => resolve()), 30);
  }
};

/**
 * Wartet, bis die nach einer Änderung angestoßenen Ladevorgänge fertig sind – erst dann kennt die
 * Oberfläche die neue version. Höchstens 1,5 Sekunden.
 */
export function dataSettled(): Promise<void> {
  return new Promise((resolve) => {
    // die Ladevorgänge starten erst mit dem nächsten Rendern
    window.setTimeout(() => {
      if (inflight === 0) return resolve();
      idleWaiters.add(resolve);
      window.setTimeout(resolve, 1500);
    }, 30);
  });
}

export interface DataState<T> {
  data: T | undefined;
  error: AppError | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Lädt Daten über die API und lädt nach jeder Änderung dieser Sitzung neu.
 * `key` bestimmt, wann es um andere Daten geht (dann verschwindet der alte Stand sofort).
 */
export function useData<T>(key: string, load: () => Promise<T>): DataState<T> {
  const [state, setState] = useState<{ key: string; data: T | undefined; error: AppError | null }>({
    key,
    data: undefined,
    error: null,
  });
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    const unsubscribe = api.subscribe(reload);
    refreshListeners.add(reload);
    return () => {
      unsubscribe();
      refreshListeners.delete(reload);
    };
  }, [reload]);

  useEffect(() => {
    let cancelled = false;
    inflight += 1;
    loadRef.current().then(
      (data) => {
        loadDone();
        if (!cancelled) setState({ key, data, error: null });
      },
      (e: unknown) => {
        loadDone();
        if (cancelled) return;
        const error = isAppError(e) ? e : new AppError('network', 'Die Daten konnten nicht geladen werden.');
        setState((prev) => ({ key, data: prev.key === key ? prev.data : undefined, error }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key, tick]);

  const current = state.key === key ? state : { data: undefined, error: null };
  return {
    data: current.data,
    error: current.error,
    loading: current.data === undefined && !current.error,
    reload,
  };
}
