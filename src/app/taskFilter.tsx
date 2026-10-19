// Filter der Aufgabenliste (WF-AUF-01). Sie leben nur in der laufenden Sitzung und speichern nichts (7.3).
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { TaskListItem } from '../data/api';
import { isActiveTaskStatus } from '../shared/rules/taskStatus';
import { topicFilterIds } from '../shared/rules/topics';
import type { TaskStatus, Topic } from '../shared/schema';

export type TaskScope = 'alle' | 'meine' | 'folge';

export interface TaskFilter {
  /** Grundmenge */
  scope: TaskScope;
  /** An/Aus-Filter, kombinierbar mit der Grundmenge */
  plenum: boolean;
  /** zeigt nur erledigte und verworfene; sonst sind sie ausgeblendet */
  done: boolean;
  topicId: string | null;
  status: TaskStatus | null;
  eventId: string | null;
}

export const DEFAULT_TASK_FILTER: TaskFilter = {
  scope: 'alle',
  plenum: false,
  done: false,
  topicId: null,
  status: null,
  eventId: null,
};

export function applyTaskFilter(
  tasks: readonly TaskListItem[],
  filter: TaskFilter,
  meId: string,
  topics: readonly Pick<Topic, 'id' | 'name' | 'parent_id' | 'sort_order'>[],
): TaskListItem[] {
  const topicIds = filter.topicId ? topicFilterIds(filter.topicId, topics) : null;
  return tasks.filter((t) => {
    if (filter.done === isActiveTaskStatus(t.status)) return false;
    if (filter.scope === 'meine' && !t.assignee_ids.includes(meId)) return false;
    if (filter.scope === 'folge' && !t.follower_ids.includes(meId)) return false;
    if (filter.plenum && !t.marked) return false;
    if (topicIds && !topicIds.has(t.topic_id)) return false;
    if (filter.status && t.status !== filter.status) return false;
    if (filter.eventId && t.event_id !== filter.eventId) return false;
    return true;
  });
}

interface FilterContextValue {
  filter: TaskFilter;
  setFilter: (patch: Partial<TaskFilter>) => void;
}

const FilterContext = createContext<FilterContextValue | null>(null);

export function TaskFilterProvider({ children }: { children: ReactNode }) {
  const [filter, setState] = useState(DEFAULT_TASK_FILTER);
  const value = useMemo<FilterContextValue>(
    () => ({
      filter,
      setFilter: (patch) =>
        setState((prev) => {
          const next = { ...prev, ...patch };
          // „Abgeschlossene“ umschalten: ein Statusfilter der anderen Gruppe passt nicht mehr
          if (next.status && next.done === isActiveTaskStatus(next.status)) next.status = null;
          return next;
        }),
    }),
    [filter],
  );
  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>;
}

export function useTaskFilter(): FilterContextValue {
  const value = useContext(FilterContext);
  if (!value) throw new Error('useTaskFilter außerhalb des Mitgliederbereichs');
  return value;
}
