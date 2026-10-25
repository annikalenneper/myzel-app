// Datenbank-Verbindung in Betrieb: Supabase-Pooler (Transaction-Modus) über DATABASE_URL, nur in den Netlify Functions.
// TLS mit Prüfung des Zertifikats gegen das Supabase-Stammzertifikat; DATABASE_URL ohne „sslmode“ (pg würde sonst
// diese Einstellung überschreiben).
import { Kysely, PostgresDialect, type PostgresPool } from 'kysely';
import pg from 'pg';
import { countQuery } from '../api/timing';
import { SUPABASE_ROOT_CA } from './supabaseCa';
import type { Database } from './types';

// Zeitstempel als ISO-Text, Datumsfelder als YYYY-MM-DD – wie in der Oberfläche und in PGlite (localDb.ts)
pg.types.setTypeParser(pg.types.builtins.TIMESTAMPTZ, (v) => new Date(v).toISOString());
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

/** ab so langer Ruhe wird eine Verbindung vor der Nutzung geprüft – die Function kann dazwischen eingefroren sein */
const CHECK_AFTER_IDLE_MS = 30_000;
const CHECK_TIMEOUT_MS = 2_000;

/**
 * Verbindungen bleiben offen (16.6): ein Neuaufbau kostet zwischen Function und Datenbank 600 bis 900 ms. Wer länger
 * ruhte, wird vor der Nutzung mit „select 1“ geprüft; eine tote Verbindung wird verworfen und ersetzt. Die Prüfung
 * liegt vor jeder Transaktion, ein Fehlschlag kann also nichts halb schreiben.
 */
function checkedPool(pool: pg.Pool): PostgresPool {
  const lastUsed = new WeakMap<pg.PoolClient, number>();
  pool.on('release', (_err: Error | undefined, client: pg.PoolClient) => lastUsed.set(client, Date.now()));
  // eine ruhende Verbindung, die der Server schließt, darf die Function nicht beenden
  pool.on('error', (e) => console.warn('[db] ruhende Verbindung geschlossen:', e.message));
  return {
    options: pool.options,
    end: () => pool.end(),
    async connect() {
      for (let attempt = 1; attempt <= 3; attempt++) {
        const client = await pool.connect();
        const since = lastUsed.get(client);
        if (since === undefined || Date.now() - since < CHECK_AFTER_IDLE_MS) return client;
        try {
          await Promise.race([
            client.query('select 1'),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Prüfung zu langsam')), CHECK_TIMEOUT_MS),
            ),
          ]);
          return client;
        } catch (e) {
          client.release(e instanceof Error ? e : true);
        }
      }
      return pool.connect();
    },
  };
}

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
      pool: checkedPool(
        new pg.Pool({
          connectionString,
          max: 4,
          // unter der Grenze, nach der AWS ruhende Verbindungen kappt (350 s)
          idleTimeoutMillis: 300_000,
          keepAlive: true,
          ssl: { ca: SUPABASE_ROOT_CA, rejectUnauthorized: true },
        }),
      ),
    }),
    // Messung je Anfrage (server/api/timing.ts)
    log: (event) => countQuery(event.queryDurationMillis),
  });
  return instance;
}
