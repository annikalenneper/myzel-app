import type { ZodError } from 'zod';

/**
 * Fehler der Server-Funktionen. `message` ist immer ein deutscher Satz für die Oberfläche.
 * - validation: Pflichtfeld fehlt / Eingabe ungültig (Meldung am Feld `field`)
 * - rule: fachliche Regel verletzt (Statusübergang, Zyklus, letzter Admin …)
 * - conflict: veraltete version (WF-ALL-01)
 * - forbidden: keine Berechtigung
 * - not_found: Objekt gibt es nicht (mehr)
 * - network: Verbindung fehlgeschlagen (WF-ALL-03)
 * - unauthenticated: keine gültige Sitzung
 */
export type AppErrorCode =
  'validation' | 'rule' | 'conflict' | 'forbidden' | 'not_found' | 'network' | 'unauthenticated';

export interface ConflictInfo {
  changed_by_name: string | null;
  changed_at: string | null;
}

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly field: string | null;
  readonly conflict: ConflictInfo | null;

  constructor(
    code: AppErrorCode,
    message: string,
    options: { field?: string; conflict?: ConflictInfo } = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.field = options.field ?? null;
    this.conflict = options.conflict ?? null;
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

export function validationErrorFromZod(error: ZodError): AppError {
  const issue = error.issues[0];
  const field = issue?.path.length ? String(issue.path[0]) : undefined;
  return new AppError('validation', issue?.message ?? 'Die Eingabe ist ungültig.', { field });
}
