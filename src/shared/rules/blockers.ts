// Abhängigkeiten zwischen Aufgaben: keine Selbstreferenz, keine Zyklen (3.3, 7.2)
import type { TaskBlocker } from '../schema';

/**
 * Würde „taskId hängt ab von blockerId“ einen Zyklus schließen?
 * Das ist der Fall, wenn blockerId (direkt oder über Ketten) schon von taskId abhängt.
 */
export function wouldCreateBlockerCycle(
  edges: readonly TaskBlocker[],
  taskId: string,
  blockerId: string,
): boolean {
  if (taskId === blockerId) return true;
  const dependsOn = new Map<string, string[]>();
  for (const e of edges) {
    const list = dependsOn.get(e.task_id) ?? [];
    list.push(e.blocker_task_id);
    dependsOn.set(e.task_id, list);
  }
  const seen = new Set<string>();
  const stack = [blockerId];
  while (stack.length) {
    const current = stack.pop()!;
    if (current === taskId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(dependsOn.get(current) ?? []));
  }
  return false;
}
