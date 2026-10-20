// Lokale Datenbank ohne Docker (Entscheidung 20.10.2026): PGlite mit nachgebildetem Supabase-Auth-Schema, darauf
// alle Migrationen aus supabase/migrations in Reihenfolge. Für Tests und lokale Entwicklung der Server-Funktionen.
import { PGlite, types } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Kysely } from 'kysely';
import type { Database } from './types';
import { PGliteDialect } from './pgliteDialect';

const MIGRATIONS = join(import.meta.dirname, '..', '..', 'supabase', 'migrations');

/**
 * Was Supabase vor den Migrationen bereitstellt: Rollen anon und authenticated, auth.uid() aus dem JWT, und dass
 * beide Rollen auf neue Tabellen in public grundsätzlich zugreifen dürfen – geschützt wird über RLS.
 */
const SUPABASE_STUB = `
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create role anon nologin;
  create role authenticated nologin;
  grant usage on schema public, auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated;
`;

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

export interface LocalDb {
  pg: PGlite;
  db: Kysely<Database>;
}

export async function createLocalDb(): Promise<LocalDb> {
  // wie in Betrieb (server/db/connection.ts): Zeitstempel als ISO-Text, Datumsfelder als YYYY-MM-DD
  const pg = new PGlite({
    parsers: {
      [types.TIMESTAMPTZ]: (v: string) => new Date(v).toISOString(),
      [types.DATE]: (v: string) => v,
    },
  });
  await pg.exec(SUPABASE_STUB);
  for (const file of migrationFiles()) {
    try {
      await pg.exec(readFileSync(join(MIGRATIONS, file), 'utf8'));
    } catch (e) {
      throw new Error(`Migration ${file} schlägt fehl: ${(e as Error).message}`, { cause: e });
    }
  }
  return { pg, db: new Kysely<Database>({ dialect: new PGliteDialect(pg) }) };
}

/** Abfragen so, wie die App sie über Supabase stellt: als Rolle authenticated mit der ID aus dem Login */
export async function asUser<T>(pg: PGlite, authUserId: string | null, fn: () => Promise<T>): Promise<T> {
  await pg.exec(`set role ${authUserId ? 'authenticated' : 'anon'}`);
  await pg.query(`select set_config('request.jwt.claim.sub', $1, false)`, [authUserId ?? '']);
  try {
    return await fn();
  } finally {
    await pg.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}
