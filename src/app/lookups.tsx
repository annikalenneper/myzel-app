import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { api } from '../data';
import type { EventListItem, TopicWithUsage } from '../data/api';
import { orderTopics, topicLabel } from '../shared/rules/topics';
import type { Member } from '../shared/schema';
import { useData } from './useData';

export interface Lookups {
  ready: boolean;
  /** alle Mitglieder, auch deaktivierte und der Systemeintrag (für Namen in der Historie) */
  members: Member[];
  /** aktive Mitglieder ohne Systemeintrag – nur sie stehen zur Auswahl */
  activeMembers: Member[];
  memberById: Map<string, Member>;
  /** Oberthemen mit ihren Unterkategorien, auch archivierte */
  topics: TopicWithUsage[];
  topicById: Map<string, TopicWithUsage>;
  /** „Verein · Versicherung & Recht“ */
  topicName(id: string): string;
  events: EventListItem[];
  eventById: Map<string, EventListItem>;
}

const LookupsContext = createContext<Lookups | null>(null);

export function LookupsProvider({ children }: { children: ReactNode }) {
  const members = useData('members', () => api.listMembers()).data;
  const topics = useData('topics', () => api.listTopics()).data;
  const events = useData('events', () => api.listEvents()).data;

  const value = useMemo<Lookups>(() => {
    const m = members ?? [];
    const t = orderTopics(topics ?? []);
    const e = events ?? [];
    const topicById = new Map(t.map((x) => [x.id, x]));
    return {
      ready: !!members && !!topics && !!events,
      members: m,
      activeMembers: m.filter((x) => x.active && !x.is_system),
      memberById: new Map(m.map((x) => [x.id, x])),
      topics: t,
      topicById,
      topicName: (id) => {
        const topic = topicById.get(id);
        return topic ? topicLabel(topic, topicById) : '–';
      },
      events: e,
      eventById: new Map(e.map((x) => [x.id, x])),
    };
  }, [members, topics, events]);

  return <LookupsContext.Provider value={value}>{children}</LookupsContext.Provider>;
}

export function useLookups(): Lookups {
  const value = useContext(LookupsContext);
  if (!value) throw new Error('useLookups außerhalb des Mitgliederbereichs');
  return value;
}
