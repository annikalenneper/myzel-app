// Schritt C: die Schnittstelle MyzelApi gegen Supabase (Login) und die Netlify Functions (/api/<aktion>).
// Fehler kommen als dieselben AppErrors wie in der Testdaten-Schicht – die Oberfläche merkt keinen Unterschied.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppError, type AppErrorCode, type ConflictInfo } from '../../shared/errors';
import { emailInputSchema } from '../../shared/schema';
import type { MyzelApi, Session } from '../api';

/** Aktionen, die Phase 1 auf dem Server kennt – alles Weitere kommt mit späteren Phasen */
const P1_ACTIONS = [
  'listMembers',
  'listTopics',
  'listTasks',
  'getTask',
  'listEvents',
  'getEvent',
  'createTask',
  'updateTaskFields',
  'updateTaskDescription',
  'setTaskStatus',
  'addAssignee',
  'removeAssignee',
  'addFollower',
  'removeFollower',
  'addBlocker',
  'removeBlocker',
  'setPlenumMark',
  'addComment',
  'updateComment',
  'archiveTask',
  'restoreTask',
  'undo',
  'createEvent',
  'updateEvent',
  'setEventStatus',
  'updateOwnName',
  'createMember',
  'updateMember',
  'getDeactivationImpact',
  'deactivateMember',
  'reactivateMember',
  'createTopic',
  'updateTopic',
  'archiveTopic',
  'restoreTopic',
  'deleteTopic',
] as const;
/** schreibende Aktionen melden sich danach bei allen Ansichten (subscribe) */
const READS = new Set([
  'listMembers',
  'listTopics',
  'listTasks',
  'getTask',
  'listEvents',
  'getEvent',
  'getDeactivationImpact',
]);

export interface RemoteOptions {
  supabaseUrl: string;
  anonKey: string;
  /** Basis der Server-Funktionen, Standard: dieselbe Adresse wie die App */
  apiBase?: string;
}

export function createRemoteApi(options: RemoteOptions): MyzelApi {
  const supabase: SupabaseClient = createClient(options.supabaseUrl, options.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
  });
  const apiBase = options.apiBase ?? '/api';
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') emit();
  });

  async function call<T>(action: string, args: unknown[]): Promise<T> {
    const { data } = await supabase.auth.getSession();
    let response: Response;
    try {
      response = await fetch(`${apiBase}/${action}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(data.session ? { authorization: `Bearer ${data.session.access_token}` } : {}),
        },
        body: JSON.stringify({ args }),
      });
    } catch {
      throw new AppError('network', 'Keine Verbindung – nicht gespeichert.');
    }
    const body = (await response.json().catch(() => null)) as
      | { result: T }
      | {
          error: {
            code: AppErrorCode;
            message: string;
            field?: string | null;
            conflict?: ConflictInfo | null;
          };
        }
      | null;
    if (!body)
      throw new AppError('network', 'Der Server hat nicht geantwortet. Bitte versuch es noch einmal.');
    if ('error' in body)
      throw new AppError(body.error.code, body.error.message, {
        field: body.error.field ?? undefined,
        conflict: body.error.conflict ?? undefined,
      });
    if (!READS.has(action)) emit();
    return body.result;
  }

  const authError = (message: string): never => {
    throw new AppError('network', message);
  };

  const base: Partial<MyzelApi> = {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSession: () => call<Session>('getSession', []),
    async signInWithGoogle() {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      });
      if (error) authError('Die Anmeldung mit Google hat nicht geklappt. Bitte versuch es noch einmal.');
    },
    async requestMagicLink(email) {
      const parsed = emailInputSchema.safeParse(email);
      if (!parsed.success)
        throw new AppError('validation', parsed.error.issues[0]!.message, { field: 'email' });
      // die Antwort ist immer gleich – egal, ob die Adresse bekannt ist (WF-LOG-02)
      const { error } = await supabase.auth.signInWithOtp({
        email: parsed.data,
        options: { emailRedirectTo: window.location.origin },
      });
      if (error && error.status === 429)
        authError('Gerade wurden zu viele Links verschickt. Bitte warte ein paar Minuten.');
      if (error) authError('Der Link konnte nicht verschickt werden. Bitte versuch es noch einmal.');
    },
    async signOut() {
      await supabase.auth.signOut();
      emit();
    },
  };
  for (const action of P1_ACTIONS)
    (base as Record<string, unknown>)[action] = (...args: unknown[]) => call(action, args);

  // was erst spätere Phasen bringen, meldet sich verständlich statt still zu fehlen
  return new Proxy(base as MyzelApi, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && prop !== 'then' && prop !== 'demo' && !(prop in target))
        return () => Promise.reject(new AppError('rule', 'Das kommt mit einer späteren Phase.'));
      return Reflect.get(target, prop, receiver);
    },
  });
}
