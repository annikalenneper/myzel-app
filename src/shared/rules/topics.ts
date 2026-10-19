// Themenbereiche: zwei Ebenen über parent_id (3.2)
import type { Topic } from '../schema';

type TopicLike = Pick<Topic, 'id' | 'name' | 'parent_id' | 'sort_order'>;

/** „Verein · Versicherung & Recht“ für Unterkategorien, sonst der Name. */
export function topicLabel(topic: TopicLike, byId: ReadonlyMap<string, TopicLike>): string {
  const parent = topic.parent_id ? byId.get(topic.parent_id) : undefined;
  return parent ? `${parent.name} · ${topic.name}` : topic.name;
}

/** Oberthemen in Reihenfolge, jeweils gefolgt von ihren Unterkategorien. */
export function orderTopics<T extends TopicLike>(topics: readonly T[]): T[] {
  const bySort = (a: T, b: T) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'de');
  const out: T[] = [];
  for (const top of topics.filter((t) => !t.parent_id).sort(bySort)) {
    out.push(top, ...topics.filter((t) => t.parent_id === top.id).sort(bySort));
  }
  return out;
}

/** Ein Filter auf einen Bereich zeigt seine Unterkategorien mit. */
export function topicFilterIds(topicId: string, topics: readonly TopicLike[]): Set<string> {
  return new Set([topicId, ...topics.filter((t) => t.parent_id === topicId).map((t) => t.id)]);
}
