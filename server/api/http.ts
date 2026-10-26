// HTTP-Schicht der Server-Funktionen: POST /api/<aktion> mit { args }, Antwort { result } oder { error }.
// Gemeinsam für die Netlify Function und den Server der Smoke-Tests – nur die Login-Prüfung unterscheidet sich.
import type { Kysely } from 'kysely';
import type { PlenumAnswer } from '../core/context';
import type { Database } from '../db/types';
import { changesData, errorBody, handleAction, type Login } from './handle';
import { countingQueries, logTiming, serverTimingHeader, type QueryStats } from './timing';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });

/** „x-myzel-plenum: <id>:ja|nein“ – die Antwort der App auf „Gehört das zum Plenum?“ (16.2) */
export function plenumAnswerFrom(req: Request): PlenumAnswer | null {
  const m = /^([0-9a-f-]{36}):(ja|nein)$/.exec(req.headers.get('x-myzel-plenum') ?? '');
  return m ? { plenumId: m[1]!, belongs: m[2] === 'ja' } : null;
}

export const bearerToken = (req: Request) =>
  req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || null;

export async function respond(
  req: Request,
  action: string,
  db: () => Kysely<Database>,
  loginFrom: (req: Request, action: string) => Promise<Login | null>,
): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: { code: 'rule', message: 'Nur POST.' } });
  let args: unknown[] = [];
  try {
    const body = (await req.json()) as { args?: unknown };
    if (Array.isArray(body.args)) args = body.args;
  } catch {
    return json(400, { error: { code: 'validation', message: 'Die Anfrage ist unvollständig.' } });
  }
  // Messung (16.6): Login-Prüfung und Aktion getrennt, dazu die Abfragen der Aktion
  const stats: QueryStats = { queries: 0, dbMs: 0 };
  const started = performance.now();
  let loginMs = 0;
  const timed = (status: number, body: unknown) => {
    const timing = { action, loginMs, actionMs: performance.now() - started - loginMs, ...stats };
    logTiming(timing);
    return json(status, body, { 'server-timing': serverTimingHeader(timing) });
  };
  try {
    const login = await loginFrom(req, action);
    loginMs = performance.now() - started;
    const result = await countingQueries(stats, () =>
      handleAction(db(), login, action, args, new Date(), plenumAnswerFrom(req)),
    );
    return timed(200, { result: result ?? null, changed: changesData(action, result) });
  } catch (e) {
    const { status, body } = errorBody(e);
    return timed(status, body);
  }
}
