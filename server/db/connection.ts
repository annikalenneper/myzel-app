// Datenbank-Verbindung in Betrieb: Supabase-Pooler (Transaction-Modus) über DATABASE_URL, nur in den Netlify Functions.
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { Database } from './types';

// Zeitstempel als ISO-Text, Datumsfelder als YYYY-MM-DD – wie in der Oberfläche und in PGlite (localDb.ts)
pg.types.setTypeParser(pg.types.builtins.TIMESTAMPTZ, (v) => new Date(v).toISOString());
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

let instance: Kysely<Database> | null = null;

/**
 * TLS mit Prüfung des Server-Zertifikats, wenn das CA-Zertifikat von Supabase hinterlegt ist (Dashboard › Database
 * › SSL Configuration; als PEM, Zeilenumbrüche auch als „\n“). Ohne es bleibt die Verbindung verschlüsselt, aber
 * ungeprüft – für Produktion muss es gesetzt sein.
 */
function ssl() {
  const ca = process.env.DATABASE_CA_CERT?.replace(/\\n/g, '\n').trim();
  if (ca) return { ca, rejectUnauthorized: true };
  console.warn('DATABASE_CA_CERT fehlt: Datenbank-Zertifikat wird nicht geprüft.');
  return { rejectUnauthorized: false };
}

export function database(): Kysely<Database> {
  if (instance) return instance;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL fehlt.');
  instance = new Kysely<Database>({
    dialect: new PostgresDialect({
      // eine Verbindung je Function-Instanz; der Pooler verteilt
      pool: new pg.Pool({ connectionString, max: 1, ssl: ssl() }),
    }),
  });
  return instance;
}
