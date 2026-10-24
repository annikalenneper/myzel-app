// Statusmodell Aufgabe (ANFORDERUNGEN 4.1)
import type { TaskStatus } from '../schema';

export const ACTIVE_TASK_STATUSES: readonly TaskStatus[] = ['neu', 'geplant', 'in_arbeit', 'blockiert'];
export const FINAL_TASK_STATUSES: readonly TaskStatus[] = ['erledigt', 'verworfen'];

export function isActiveTaskStatus(status: TaskStatus): boolean {
  return ACTIVE_TASK_STATUSES.includes(status);
}

/**
 * Erlaubte Übergänge. Kein Übergang führt zurück zu „neu“; aus erledigt/verworfen
 * geht es nur über „Wieder öffnen“ nach geplant oder in_arbeit.
 */
const TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  neu: ['geplant', 'in_arbeit', 'blockiert', 'erledigt', 'verworfen'],
  geplant: ['in_arbeit', 'blockiert', 'erledigt', 'verworfen'],
  in_arbeit: ['geplant', 'blockiert', 'erledigt', 'verworfen'],
  blockiert: ['geplant', 'in_arbeit', 'erledigt', 'verworfen'],
  erledigt: ['geplant', 'in_arbeit'],
  verworfen: ['geplant', 'in_arbeit'],
};

export function allowedTaskTransitions(from: TaskStatus): readonly TaskStatus[] {
  return TRANSITIONS[from];
}

export function canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** blockiert ⇒ Grund oder mindestens eine Abhängigkeit („wartet auf“) (7.2). */
export function blockReasonMissing(
  to: TaskStatus,
  reason: string | null | undefined,
  hasBlockers = false,
): boolean {
  return to === 'blockiert' && !reason?.trim() && !hasBlockers;
}

export const LAST_BLOCKER =
  'Ohne Grund braucht „Blockiert“ mindestens eine Aufgabe, auf die gewartet wird. Bitte erst einen Grund eintragen oder die Blockade lösen.';
export const BLOCK_REASON_MISSING =
  'Bitte einen Grund angeben oder eine Aufgabe wählen, auf die gewartet wird.';

/** Fällt die letzte bearbeitende Person weg, geht „In Arbeit“ zurück auf „Geplant“. */
export function statusAfterLastAssigneeLeft(status: TaskStatus): TaskStatus {
  return status === 'in_arbeit' ? 'geplant' : status;
}
