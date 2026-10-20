// Nur Tests und lokale Entwicklung: die Schnittstelle MyzelApi, gebaut aus den echten Server-Funktionen gegen PGlite.
// Damit laufen die Tests der Testdaten-Schicht unverändert auch gegen den Server (Gleichheit beider Schichten).
// Anmeldung läuft hier über die Testkonten – in Betrieb über Supabase Auth (netlify/functions/api).
import { Kysely } from 'kysely';
import type { DemoAccount, MyzelApi, Session } from '../../src/data/api';
import { AppError } from '../../src/shared/errors';
import { emailInputSchema } from '../../src/shared/schema';
import { inTransaction, resolveActor } from '../core/context';
import { createLocalDb, type LocalDb } from '../db/localDb';
import { PGliteDialect } from '../db/pgliteDialect';
import { seedFromMock } from '../db/seedFromMock';
import type { Database } from '../db/types';
import * as members from '../p1/members';
import { sessionFor } from '../p1/session';
import { READ_ACTIONS, WRITE_ACTIONS } from './actions';

const OUTSIDER = 'jemand@example.org';
const templates = new Map<string, Promise<LocalDb>>();

/** Befüllte Datenbank einmal je Stichtag aufbauen, dann je Test klonen */
async function freshDb(now: Date): Promise<Kysely<Database>> {
  const key = now.toISOString().slice(0, 10);
  let template = templates.get(key);
  if (!template) {
    template = createLocalDb().then(async (local) => {
      await seedFromMock(local.db, now);
      return local;
    });
    templates.set(key, template);
  }
  const pg = await (await template).pg.clone();
  return new Kysely<Database>({ dialect: new PGliteDialect(pg) });
}

export interface ServerApiOptions {
  now?: () => Date;
}

export async function createServerApi(options: ServerApiOptions = {}): Promise<MyzelApi> {
  const now = options.now ?? (() => new Date());
  let db = await freshDb(now());
  const listeners = new Set<() => void>();
  /** wie Supabase Auth: je Mail-Adresse eine feste Login-ID, die beim ersten Login entsteht */
  const authIds = new Map<string, string>();
  let login: { authUserId: string; email: string } | null = null;
  let authUserId: string | null = null;
  let pendingMagic: string | null = null;
  let failWrites = 0;

  const emit = () => listeners.forEach((l) => l());
  const session = async (): Promise<Session> => {
    const result = await sessionFor(db, login);
    authUserId = result.state === 'member' ? login!.authUserId : null;
    return result;
  };

  const signInAs = async (email: string): Promise<Session> => {
    const key = email.toLowerCase();
    // vorhandene Verknüpfung (z. B. aus den Testdaten) übernehmen, sonst neue Login-ID wie bei Supabase
    const linked = await db
      .selectFrom('members')
      .select('auth_user_id')
      .where((eb) => eb(eb.fn('lower', ['email']), '=', key))
      .executeTakeFirst();
    const id = linked?.auth_user_id ?? authIds.get(key) ?? crypto.randomUUID();
    authIds.set(key, id);
    login = { authUserId: id, email };
    const result = await session();
    emit();
    return result;
  };

  async function read(name: string, args: unknown[]): Promise<unknown> {
    await resolveActor(db, authUserId);
    return structuredClone(await READ_ACTIONS[name]!(db, args, now()));
  }

  async function write(name: string, args: unknown[]): Promise<unknown> {
    if (failWrites > 0) {
      failWrites -= 1;
      throw new AppError('network', 'Keine Verbindung – nicht gespeichert.');
    }
    const result = await inTransaction(db, authUserId, now(), (ctx) => WRITE_ACTIONS[name]!(ctx, args));
    emit();
    return structuredClone(result);
  }

  const base: Partial<MyzelApi> = {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSession: session,
    async signInWithGoogle() {
      throw new AppError('rule', 'Die Google-Anmeldung läuft in Betrieb über Supabase.');
    },
    async requestMagicLink(email) {
      const parsed = emailInputSchema.safeParse(email);
      if (!parsed.success)
        throw new AppError('validation', parsed.error.issues[0]!.message, { field: 'email' });
      pendingMagic = parsed.data;
    },
    async signOut() {
      login = null;
      authUserId = null;
      emit();
    },
    getDeactivationImpact: (memberId) =>
      inTransaction(db, authUserId, now(), (ctx) => members.getDeactivationImpact(ctx, memberId)),
    demo: {
      accounts(): DemoAccount[] {
        return [{ email: OUTSIDER, label: 'Jemand', hint: 'nicht auf der Mitgliederliste' }];
      },
      signInAs,
      pendingMagicLink: () => pendingMagic,
      async openMagicLink() {
        if (!pendingMagic) throw new AppError('rule', 'Es wurde kein Link angefordert.');
        const email = pendingMagic;
        pendingMagic = null;
        return signInAs(email);
      },
      async simulateForeignEdit(taskId) {
        const me = await resolveActor(db, authUserId);
        const other = await db
          .selectFrom('members')
          .select('auth_user_id')
          .where('active', '=', true)
          .where('is_system', '=', false)
          .where('id', '<>', me.id)
          .orderBy('created_at')
          .executeTakeFirstOrThrow();
        const task = await db
          .selectFrom('tasks')
          .select(['priority', 'version'])
          .where('id', '=', taskId)
          .executeTakeFirstOrThrow();
        await inTransaction(db, other.auth_user_id, now(), (ctx) =>
          WRITE_ACTIONS.updateTaskFields!(ctx, [
            taskId,
            { priority: task.priority === 'hoch' ? 'mittel' : 'hoch' },
            task.version,
          ]),
        );
      },
      failNextWrites(n) {
        failWrites = n;
      },
      async reset() {
        db = await freshDb(now());
        emit();
      },
      completeTelegramLink: later,
      myMessages: later,
      runJobNow: later,
      setOutage: later,
      outage: () => false,
      driveAddFile: later,
      driveTrashLinkedFile: later,
      telegramPress: later,
      exportYaml: later,
    },
  };
  for (const name of Object.keys(READ_ACTIONS))
    (base as Record<string, unknown>)[name] = (...args: unknown[]) => read(name, args);
  for (const name of Object.keys(WRITE_ACTIONS))
    if (!(name in base)) (base as Record<string, unknown>)[name] = (...args: unknown[]) => write(name, args);

  // was erst spätere Phasen bringen, meldet sich verständlich statt still zu fehlen
  return new Proxy(base as MyzelApi, {
    get(target, prop, receiver) {
      // 'then': kein Promise – sonst hielte await die Schnittstelle selbst für eins
      if (typeof prop === 'string' && prop !== 'then' && !(prop in target)) return later;
      return Reflect.get(target, prop, receiver);
    },
  });
}

async function later(): Promise<never> {
  throw new AppError('rule', 'Das kommt mit einer späteren Phase.');
}
