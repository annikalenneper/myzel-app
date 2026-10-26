// Eine Aktion mit geprüftem Login ausführen – gemeinsam für die Netlify Function und die Tests.
// Die handelnde Person kommt allein aus dem Login (7.2); mitgeschickte IDs in den Argumenten ändern daran nichts.
import type { Kysely } from 'kysely';
import { AppError } from '../../src/shared/errors';
import { OUTSIDE_PLENUM_ACTIONS } from '../../src/shared/rules/plenum';
import { inTransaction, resolveActor, type PlenumAnswer } from '../core/context';
import type { Database } from '../db/types';
import { sessionFor } from '../p1/session';
import { READ_ACTIONS, WRITE_ACTIONS } from './actions';

export interface Login {
  authUserId: string;
  /** bestätigte Mail-Adresse aus Supabase Auth – nur für die Verknüpfung beim ersten Login */
  email: string | null;
}

export async function handleAction(
  db: Kysely<Database>,
  login: Login | null,
  action: string,
  args: unknown[],
  now: Date,
  /** Antwort der App auf „Gehört das zum Plenum?“ (16.2) */
  plenumAnswer: PlenumAnswer | null = null,
): Promise<unknown> {
  if (action === 'getSession') return sessionFor(db, login, now);
  // nur eigene Einträge – kein Treffer über die Prototyp-Kette (z. B. „toString“)
  const read = Object.hasOwn(READ_ACTIONS, action) ? READ_ACTIONS[action] : undefined;
  if (read) {
    const actor = await resolveActor(db, login?.authUserId ?? null);
    return read(db, args, now, actor);
  }
  const write = Object.hasOwn(WRITE_ACTIONS, action) ? WRITE_ACTIONS[action] : undefined;
  if (write)
    return inTransaction(
      db,
      login?.authUserId ?? null,
      now,
      (ctx) => write(ctx, args),
      plenumAnswer,
      OUTSIDE_PLENUM_ACTIONS.has(action),
    );
  throw new AppError('rule', 'Das kommt mit einer späteren Phase.');
}

/**
 * Hat die Aktion Daten geändert? Danach lädt die App ihre Ansichten neu (16.6). Lesen ändert nichts – außer dem
 * Drive-Abgleich, wenn er wirklich bei Drive nachgefragt hat, und dem Neu-Einlesen.
 */
export function changesData(action: string, result: unknown): boolean {
  if (action === 'rebuildDrive') return true;
  if (action === 'syncDrive') return (result as { checked?: boolean } | null)?.checked === true;
  return action !== 'getSession' && !Object.hasOwn(READ_ACTIONS, action);
}

/** Fehler als Antwort für die App: immer ein deutscher Satz, nie ein Stacktrace */
export function errorBody(e: unknown): { status: number; body: { error: Record<string, unknown> } } {
  if (e instanceof AppError) {
    const status = {
      validation: 400,
      rule: 409,
      conflict: 409,
      forbidden: 403,
      not_found: 404,
      unauthenticated: 401,
      network: 503,
    }[e.code];
    return {
      status,
      body: { error: { code: e.code, message: e.message, field: e.field, conflict: e.conflict } },
    };
  }
  console.error(e);
  return {
    status: 500,
    body: {
      error: {
        code: 'network',
        message: 'Da ist auf dem Server etwas schiefgegangen. Bitte versuch es noch einmal.',
      },
    },
  };
}
