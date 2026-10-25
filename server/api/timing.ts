// Messung je Anfrage (ANFORDERUNGEN 16.6): Login-Prüfung, Aktion, Zeit und Zahl der Datenbank-Abfragen.
// Geht als Server-Timing-Header an den Browser (Netzwerk-Ansicht der Entwicklerwerkzeuge) und als eine Zeile ins Log.
import { AsyncLocalStorage } from 'node:async_hooks';

export interface QueryStats {
  queries: number;
  dbMs: number;
}

const current = new AsyncLocalStorage<QueryStats>();

/** von der Datenbank-Verbindung nach jeder Abfrage aufgerufen; außerhalb einer Messung ohne Wirkung */
export function countQuery(ms: number): void {
  const stats = current.getStore();
  if (!stats) return;
  stats.queries += 1;
  stats.dbMs += ms;
}

export interface Timing {
  action: string;
  loginMs: number;
  actionMs: number;
  queries: number;
  dbMs: number;
}

/** führt `fn` aus und zählt dabei die Abfragen in `stats` – auch, wenn `fn` mit einem Fehler endet */
export function countingQueries<T>(stats: QueryStats, fn: () => Promise<T>): Promise<T> {
  return current.run(stats, fn);
}

const ms = (n: number) => Math.round(n * 10) / 10;

export function serverTimingHeader(t: Timing): string {
  return [
    `login;dur=${ms(t.loginMs)}`,
    `aktion;dur=${ms(t.actionMs)};desc="${t.action}"`,
    `db;dur=${ms(t.dbMs)};desc="${t.queries} Abfragen"`,
  ].join(', ');
}

export function logTiming(t: Timing): void {
  console.log(
    `[timing] ${t.action} gesamt=${ms(t.loginMs + t.actionMs)}ms login=${ms(t.loginMs)}ms aktion=${ms(t.actionMs)}ms db=${ms(t.dbMs)}ms abfragen=${t.queries}`,
  );
}
