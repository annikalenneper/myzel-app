import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../data';
import { AppError, isAppError } from '../shared/errors';

const refreshListeners = new Set<() => void>();

// ── Zwischenspeicher (16.6) ─────────────────────────────────────────────────
// Der letzte geladene Stand je Schlüssel: Eine Ansicht zeigt ihn beim Wiederöffnen sofort und lädt im Hintergrund
// neu. Nach jeder Änderung dieser Sitzung fällt alles heraus, was gerade nicht angezeigt wird – sonst könnte eine
// Ansicht kurz eine veraltete version anbieten. Angezeigte Ansichten laden ohnehin neu.

const cache = new Map<string, unknown>();
/** wie viele eingebundene Ansichten je Schlüssel gerade laden bzw. anzeigen */
const mounted = new Map<string, number>();
/** zählt die Änderungen; eine laufende Anfrage teilt sich nur, wer nach derselben Änderung fragt */
let generation = 0;
const pending = new Map<string, { generation: number; promise: Promise<unknown> }>();
/** wem der Zwischenspeicher gehört (Sitzung) – beim Wechsel der Person fällt alles heraus */
let owner: string | null = null;

function invalidate(): void {
  generation += 1;
  for (const key of cache.keys()) if (!mounted.get(key)) cache.delete(key);
}

api.subscribe(invalidate);

/** Beim Wechsel der angemeldeten Person (oder Abmelden) gilt nichts Gespeichertes mehr – außer der Sitzung selbst. */
export function setDataOwner(next: string): void {
  if (owner === next) return;
  if (owner !== null) for (const key of [...cache.keys()]) if (key !== 'session') cache.delete(key);
  owner = next;
}

/** gleichzeitige Anfragen mit demselben Schlüssel laufen nur einmal */
function loadShared<T>(key: string, load: () => Promise<T>): Promise<T> {
  const running = pending.get(key);
  if (running && running.generation === generation) return running.promise as Promise<T>;
  const promise = load();
  pending.set(key, { generation, promise });
  const done = () => {
    if (pending.get(key)?.promise === promise) pending.delete(key);
  };
  promise.then(done, done);
  return promise;
}

/** Lädt alle sichtbaren Daten neu, z. B. nach „Neu laden“ im Konfliktdialog. */
export function refreshAll(): void {
  invalidate();
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
 * `key` bestimmt, wann es um andere Daten geht (dann verschwindet der alte Stand sofort – es sei denn, der
 * Zwischenspeicher kennt den neuen schon).
 */
export function useData<T>(key: string, load: () => Promise<T>): DataState<T> {
  const [state, setState] = useState<{ key: string; data: T | undefined; error: AppError | null }>(() => ({
    key,
    data: cache.get(key) as T | undefined,
    error: null,
  }));
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
    mounted.set(key, (mounted.get(key) ?? 0) + 1);
    return () => {
      const n = (mounted.get(key) ?? 1) - 1;
      if (n > 0) mounted.set(key, n);
      else mounted.delete(key);
    };
  }, [key]);

  useEffect(() => {
    let cancelled = false;
    // was eine vor der letzten Änderung gestartete Anfrage liefert, kommt nicht in den Zwischenspeicher
    const startedAt = generation;
    inflight += 1;
    loadShared(key, () => loadRef.current()).then(
      (data) => {
        loadDone();
        if (startedAt === generation || mounted.get(key)) cache.set(key, data);
        if (!cancelled) setState({ key, data, error: null });
      },
      (e: unknown) => {
        loadDone();
        if (cancelled) return;
        const error = isAppError(e) ? e : new AppError('network', 'Die Daten konnten nicht geladen werden.');
        setState((prev) => ({
          key,
          data: prev.key === key ? prev.data : (cache.get(key) as T | undefined),
          error,
        }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key, tick]);

  const current = state.key === key ? state : { data: cache.get(key) as T | undefined, error: null };
  return {
    data: current.data,
    error: current.error,
    loading: current.data === undefined && !current.error,
    reload,
  };
}
