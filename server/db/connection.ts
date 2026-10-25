// Datenbank-Verbindung in Betrieb: Supabase-Pooler (Transaction-Modus) über DATABASE_URL, nur in den Netlify Functions.
// TLS mit Prüfung des Zertifikats gegen das Supabase-Stammzertifikat; DATABASE_URL ohne „sslmode“ (pg würde sonst
// diese Einstellung überschreiben).
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { countQuery } from '../api/timing';
import { SUPABASE_ROOT_CA } from './supabaseCa';
import type { Database } from './types';

// Zeitstempel als ISO-Text, Datumsfelder als YYYY-MM-DD – wie in der Oberfläche und in PGlite (localDb.ts)
pg.types.setTypeParser(pg.types.builtins.TIMESTAMPTZ, (v) => new Date(v).toISOString());
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

let instance: Kysely<Database> | null = null;

export function database(): Kysely<Database> {
  if (instance) return instance;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL fehlt.');
  instance = new Kysely<Database>({
    dialect: new PostgresDialect({
      // bis zu vier Verbindungen je Function-Instanz: die Lese-Abfragen einer Aktion (Promise.all) laufen so
      // gleichzeitig statt nacheinander – bei rund 87 ms je Abfrage zwischen Function und Datenbank (16.6).
      // Eine Transaktion bleibt auf ihrer einen Verbindung; der Pooler (Transaction-Modus) verteilt.
      pool: new pg.Pool({
        connectionString,
        max: 4,
        ssl: { ca: SUPABASE_ROOT_CA, rejectUnauthorized: true },
      }),
    }),
    // Messung je Anfrage (server/api/timing.ts)
    log: (event) => countQuery(event.queryDurationMillis),
  });
  return instance;
}
