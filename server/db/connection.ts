// Datenbank-Verbindung in Betrieb: Supabase-Pooler (Transaction-Modus) über DATABASE_URL, nur in den Netlify Functions.
// TLS mit Prüfung des Zertifikats gegen das Supabase-Stammzertifikat; DATABASE_URL ohne „sslmode“ (pg würde sonst
// diese Einstellung überschreiben).
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
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
      // eine Verbindung je Function-Instanz; der Pooler verteilt
      pool: new pg.Pool({
        connectionString,
        max: 1,
        ssl: { ca: SUPABASE_ROOT_CA, rejectUnauthorized: true },
      }),
    }),
  });
  return instance;
}
