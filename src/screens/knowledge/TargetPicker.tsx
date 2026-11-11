// Ziel einer Dokument-Verknüpfung suchen: Aufgabe, Veranstaltung, Termin oder Entscheidung (WF-WIS-06, WF-WIS-14).
// Einmal gebaut für „Dokument verknüpfen“ und „Zuordnen“, damit beide gleich aussehen (Phase 14).
import { useData } from '../../app/useData';
import { api } from '../../data';
import type { SearchGroupKey } from '../../data/api';
import type { DocumentLinkTarget } from '../../shared/schema';
import { ChoiceList, ChoiceRow, SearchField } from '../../ui/bits';

export interface LinkTarget {
  type: DocumentLinkTarget;
  id: string;
  /** „Aufgabe“, „Veranstaltung“, „Termin“, „Entscheidung“ */
  kind: string;
  name: string;
}

const GROUP_TARGET: Partial<Record<SearchGroupKey, [DocumentLinkTarget, string]>> = {
  aufgaben: ['task', 'Aufgabe'],
  events: ['event', 'Veranstaltung'],
  termine: ['appointment', 'Termin'],
  beschluesse: ['decision', 'Entscheidung'],
};

export function TargetPicker({
  wf,
  query,
  onQuery,
  selected,
  onPick,
  pinned,
  allowNone,
  limit = 8,
  autoFocus,
}: {
  wf: string;
  query: string;
  onQuery: (q: string) => void;
  /** gewähltes Ziel; null = ohne Verknüpfung */
  selected: LinkTarget | null;
  onPick: (target: LinkTarget | null) => void;
  /** steht immer oben, z. B. das Ziel aus dem aufrufenden Screen */
  pinned?: LinkTarget | null;
  /** „Ohne Verknüpfung“ anbieten */
  allowNone?: boolean;
  limit?: number;
  autoFocus?: boolean;
}) {
  const term = query.trim();
  const { data: hits } = useData(`ziel-suche:${term}`, () => api.search(term));
  const found = (hits ?? []).flatMap((g) => {
    const map = GROUP_TARGET[g.key];
    return map ? g.items.map((i) => ({ type: map[0], kind: map[1], id: i.id, name: i.title })) : [];
  });
  const shown = [
    ...(pinned ? [pinned] : []),
    ...(term ? found : []).filter((t) => t.id !== pinned?.id),
  ].slice(0, limit);
  return (
    <div className="flex flex-col gap-2">
      <SearchField
        wf={wf}
        label="Ziel suchen"
        placeholder="Aufgabe, Event, Termin, Entscheidung …"
        value={query}
        onChange={onQuery}
        autoFocus={autoFocus}
      />
      {(shown.length > 0 || allowNone) && (
        <ChoiceList label="Ziel">
          {shown.map((t) => (
            <ChoiceRow
              key={`${t.type}:${t.id}`}
              wf={wf}
              kicker={t.kind}
              title={t.name}
              selected={selected?.type === t.type && selected.id === t.id}
              onClick={() => onPick(t)}
            />
          ))}
          {allowNone && (
            <ChoiceRow
              wf={wf}
              kicker="Nur erfassen"
              title="Ohne Verknüpfung"
              selected={!selected}
              onClick={() => onPick(null)}
            />
          )}
        </ChoiceList>
      )}
      {term && hits && found.length === 0 && (
        <span className="px-1 text-[13px] text-leise">Nichts gefunden zu „{term}“.</span>
      )}
      {!term && !pinned && <span className="px-1 text-[13px] text-leise">Tippe, um zu suchen.</span>}
    </div>
  );
}
