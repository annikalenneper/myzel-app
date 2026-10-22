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
import { seedDrive, seedFromMock } from '../db/seedFromMock';
import type { Database } from '../db/types';
import * as members from '../p1/members';
import { sessionFor } from '../p1/session';
import * as notify from '../p2/notify';
import { missingDriveDocuments } from '../p5/drive';
import type { FakeDrive } from '../p5/source';
import { DRIVE_EVENT_FOLDER_ID } from '../../src/data/mock/seed';
import { JOB_WARNING_MINUTES } from '../../src/shared/rules/notifications';
import { READ_ACTIONS, WRITE_ACTIONS } from './actions';

const OUTSIDER = 'jemand@example.org';
/** Schlüssel eines Browsers in gültiger Form (65 und 16 Bytes, base64url) */
export const TEST_PUSH_KEYS = {
  p256dh: Buffer.alloc(65, 4).toString('base64url'),
  auth: Buffer.alloc(16, 7).toString('base64url'),
};
/** Versand in den Tests: alles kommt an */
const delivered: notify.Senders = { push: async () => 'ok', telegram: async () => 'ok' };
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
  /** bekommt das nachgebaute Vereins-Drive, sobald es (neu) entsteht – Tests ändern darüber Dateien in Drive */
  onDrive?: (drive: FakeDrive) => void;
}

export async function createServerApi(options: ServerApiOptions = {}): Promise<MyzelApi> {
  const now = options.now ?? (() => new Date());
  // wie in Betrieb über TELEGRAM_BOT_USERNAME eingerichtet
  process.env.TELEGRAM_BOT_USERNAME ??= 'myzel_bot';
  /** dieses Gerät: sein Push-Abo, wie es der Browser liefert */
  const device = {
    endpoint: `https://fcm.googleapis.com/fcm/send/${crypto.randomUUID()}`,
    keys: TEST_PUSH_KEYS,
  };
  let db = await freshDb(now());
  const newDrive = () => {
    const created = seedDrive(now());
    options.onDrive?.(created);
    return created;
  };
  let drive = newDrive();
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
      // Abmelden entfernt das Push-Abo dieses Geräts (WF-LOG-03)
      if (authUserId) await write('removePushSubscription', [device.endpoint]);
      login = null;
      authUserId = null;
      emit();
    },
    getNotificationSettings: () => write('getNotificationSettings', [device.endpoint]) as never,
    setPush: async (on) => {
      await write(on ? 'savePushSubscription' : 'removePushSubscription', [on ? device : device.endpoint]);
    },
    // eigene Transaktionen auf dem Server; danach wie nach einer Änderung neu laden (wie remoteApi)
    async syncDrive() {
      const result = (await read('syncDrive', [])) as { changed: number; checked: boolean };
      if (result.checked) emit();
      return result;
    },
    async rebuildDrive() {
      const result = (await read('rebuildDrive', [])) as { count: number };
      emit();
      return result;
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
        drive = newDrive();
        emit();
      },
      async completeTelegramLink() {
        const me = await resolveActor(db, authUserId);
        const code = await db
          .selectFrom('telegram_link_codes')
          .select('code')
          .where('member_id', '=', me.id)
          .where('used_at', 'is', null)
          .executeTakeFirst();
        if (!code) throw new AppError('rule', 'Es wartet keine Verknüpfung.');
        await notify.redeemTelegramCode(db, now(), code.code, `chat-${me.short.toLowerCase()}`);
        emit();
      },
      async myMessages() {
        const me = await resolveActor(db, authUserId);
        return structuredClone(await notify.messagesFor(db, me.id)) as never;
      },
      async runJobNow() {
        await notify.runJob(db, now(), delivered);
        emit();
      },
      async setOutage(on) {
        // Ausfall: seit gut zwei Stunden kein Lauf; danach holt der nächste Lauf nach
        const cutoff = new Date(now().getTime() - (JOB_WARNING_MINUTES + 15) * 60_000).toISOString();
        if (on) await db.deleteFrom('job_runs').where('started_at', '>=', cutoff).execute();
        else await notify.runJob(db, now(), delivered);
        emit();
      },
      outage: () => false,
      async driveAddFile() {
        await resolveActor(db, authUserId);
        const n = drive.items.filter((i) => i.file_id.startsWith('drive-neu-')).length;
        const id = `drive-neu-${crypto.randomUUID()}`;
        const name = `Neue Notiz ${n + 1}`;
        drive.put({
          file_id: id,
          parent_id: DRIVE_EVENT_FOLDER_ID,
          name,
          mime_type: 'application/vnd.google-apps.document',
          modified_time: now().toISOString(),
          web_url: `https://docs.google.com/document/d/${id}`,
        });
        return name;
      },
      async driveTrashLinkedFile() {
        await resolveActor(db, authUserId);
        const docs = await db
          .selectFrom('documents')
          .select(['id', 'title', 'url', 'drive_file_id'])
          .where('drive_file_id', 'is not', null)
          .where('archived_at', 'is', null)
          .orderBy('created_at')
          .orderBy('id')
          .execute();
        const missing = await missingDriveDocuments(db, docs);
        const doc = docs.find((d) => !missing.has(d.id));
        if (!doc) return null;
        drive.trash(doc.drive_file_id!);
        return doc.title;
      },
      telegramPress: later,
      exportYaml: later,
    },
  };
  for (const name of Object.keys(READ_ACTIONS))
    if (!(name in base)) (base as Record<string, unknown>)[name] = (...args: unknown[]) => read(name, args);
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
