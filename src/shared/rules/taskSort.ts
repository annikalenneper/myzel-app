// Sortierung der Aufgabenliste (F-AUF-01): überfällige zuerst, dann Priorität,
// dann Frist (früheste zuerst, ohne Frist ans Ende), dann Erstelldatum.
import type { Priority, Task } from '../schema';
import { isOverdue } from './due';

const PRIORITY_RANK: Record<Priority, number> = { hoch: 0, mittel: 1, niedrig: 2 };

type Sortable = Pick<Task, 'priority' | 'due_date' | 'status' | 'created_at'>;

export function compareTasks(a: Sortable, b: Sortable, today: string): number {
  const overdueA = isOverdue(a.due_date, a.status, today) ? 0 : 1;
  const overdueB = isOverdue(b.due_date, b.status, today) ? 0 : 1;
  if (overdueA !== overdueB) return overdueA - overdueB;
  const prio = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (prio !== 0) return prio;
  if (a.due_date !== b.due_date) {
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return a.due_date < b.due_date ? -1 : 1;
  }
  return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
}

export function sortTasks<T extends Sortable>(tasks: readonly T[], today: string): T[] {
  return [...tasks].sort((a, b) => compareTasks(a, b, today));
}
