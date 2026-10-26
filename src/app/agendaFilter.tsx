// Filter der Agenda (WF-AUF-01, WF-AGE-01): Aufgaben und Fragen. Sie leben nur in der laufenden Sitzung und speichern
// nichts (7.3).
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { QuestionListItem, TaskListItem } from '../data/api';
import { isActiveTaskStatus } from '../shared/rules/taskStatus';
import { topicFilterIds } from '../shared/rules/topics';
import type { TaskStatus, Topic } from '../shared/schema';

export type AgendaScope = 'alle' | 'meine' | 'folge';

export interface AgendaFilter {
  /** Grundmenge: bei Fragen heißt „Meine“ selbst gestellt; Fragen haben keine Folgenden */
  scope: AgendaScope;
  /** Reiter „Abgeschlossen“ (Phase 9): erledigte und verworfene Aufgaben, geklärte und verworfene Fragen */
  done: boolean;
  topicId: string | null;
  /** Status einer Aufgabe – dann ohne Fragen */
  status: TaskStatus | null;
  eventId: string | null;
}

export const DEFAULT_AGENDA_FILTER: AgendaFilter = {
  scope: 'alle',
  done: false,
  topicId: null,
  status: null,
  eventId: null,
};

type TopicRef = Pick<Topic, 'id' | 'name' | 'parent_id' | 'sort_order'>;

export function applyTaskFilter(
  tasks: readonly TaskListItem[],
  filter: AgendaFilter,
  meId: string,
  topics: readonly TopicRef[],
): TaskListItem[] {
  const topicIds = filter.topicId ? topicFilterIds(filter.topicId, topics) : null;
  return tasks.filter((t) => {
    if (filter.done === isActiveTaskStatus(t.status)) return false;
    if (filter.scope === 'meine' && !t.assignee_ids.includes(meId)) return false;
    if (filter.scope === 'folge' && !t.follower_ids.includes(meId)) return false;
    if (topicIds && !topicIds.has(t.topic_id)) return false;
    if (filter.status && t.status !== filter.status) return false;
    if (filter.eventId && t.event_id !== filter.eventId) return false;
    return true;
  });
}

export function applyQuestionFilter(
  questions: readonly QuestionListItem[],
  filter: AgendaFilter,
  meId: string,
  topics: readonly TopicRef[],
): QuestionListItem[] {
  if (filter.status || filter.scope === 'folge') return [];
  const topicIds = filter.topicId ? topicFilterIds(filter.topicId, topics) : null;
  return questions.filter((q) => {
    if (filter.done === (q.status === 'offen')) return false;
    if (filter.scope === 'meine' && q.raised_by !== meId) return false;
    if (topicIds && !topicIds.has(q.topic_id)) return false;
    if (filter.eventId && q.event_id !== filter.eventId) return false;
    return true;
  });
}

interface FilterContextValue {
  filter: AgendaFilter;
  setFilter: (patch: Partial<AgendaFilter>) => void;
}

const FilterContext = createContext<FilterContextValue | null>(null);

export function AgendaFilterProvider({ children }: { children: ReactNode }) {
  const [filter, setState] = useState(DEFAULT_AGENDA_FILTER);
  const value = useMemo<FilterContextValue>(
    () => ({
      filter,
      setFilter: (patch) =>
        setState((prev) => {
          const next = { ...prev, ...patch };
          // Reiter wechseln: ein Statusfilter der anderen Gruppe passt nicht mehr
          if (next.status && next.done === isActiveTaskStatus(next.status)) next.status = null;
          return next;
        }),
    }),
    [filter],
  );
  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>;
}

export function useAgendaFilter(): FilterContextValue {
  const value = useContext(FilterContext);
  if (!value) throw new Error('useAgendaFilter außerhalb des Mitgliederbereichs');
  return value;
}
