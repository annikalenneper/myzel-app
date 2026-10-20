// Kysely-Anbindung an PGlite (eingebettetes Postgres, ohne Docker) für lokale Entwicklung und Tests.
// In Betrieb läuft dieselbe Kysely-Schicht über den PostgresDialect gegen den Supabase-Pooler.
import { types, type PGliteInterface as PGlite } from '@electric-sql/pglite';
import {
  CompiledQuery,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type DatabaseConnection,
  type Dialect,
  type Driver,
  type Kysely,
  type QueryResult,
} from 'kysely';

/** wie in Betrieb (connection.ts): Zeitstempel als ISO-Text, Datumsfelder als YYYY-MM-DD – je Abfrage, weil
 * geklonte Datenbanken die Einstellungen der Vorlage nicht übernehmen */
export const PGLITE_PARSERS = {
  [types.TIMESTAMPTZ]: (v: string) => new Date(v).toISOString(),
  [types.DATE]: (v: string) => v,
};

class PGliteConnection implements DatabaseConnection {
  constructor(private readonly db: PGlite) {}

  async executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
    const result = await this.db.query<R>(query.sql, query.parameters as unknown[], {
      parsers: PGLITE_PARSERS,
    });
    return {
      rows: result.rows,
      numAffectedRows: result.affectedRows === undefined ? undefined : BigInt(result.affectedRows),
    };
  }

  // eslint-disable-next-line require-yield
  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new Error('PGlite: Streaming wird nicht unterstützt.');
  }
}

/** PGlite hat genau eine Verbindung: Abfragen und Transaktionen laufen nacheinander. */
class PGliteDriver implements Driver {
  private queue: Promise<void> = Promise.resolve();
  private readonly connection: PGliteConnection;

  constructor(private readonly db: PGlite) {
    this.connection = new PGliteConnection(db);
  }

  async init(): Promise<void> {}

  async acquireConnection(): Promise<DatabaseConnection> {
    let release!: () => void;
    const previous = this.queue;
    this.queue = new Promise((resolve) => (release = resolve));
    await previous;
    (this.connection as PGliteConnection & { release?: () => void }).release = release;
    return this.connection;
  }

  async beginTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw('begin'));
  }

  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw('commit'));
  }

  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw('rollback'));
  }

  async releaseConnection(connection: DatabaseConnection): Promise<void> {
    (connection as PGliteConnection & { release?: () => void }).release?.();
  }

  async destroy(): Promise<void> {
    await this.db.close();
  }
}

export class PGliteDialect implements Dialect {
  constructor(private readonly db: PGlite) {}
  createAdapter() {
    return new PostgresAdapter();
  }
  createDriver(): Driver {
    return new PGliteDriver(this.db);
  }
  createQueryCompiler() {
    return new PostgresQueryCompiler();
  }
  createIntrospector(db: Kysely<unknown>) {
    return new PostgresIntrospector(db);
  }
}
