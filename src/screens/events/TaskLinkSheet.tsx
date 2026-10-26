// Phase 9: „+ Aufgabe“ im Event – eine bestehende Aufgabe mit der Veranstaltung verknüpfen (WF-VER-05). Neu anlegen
// geht über die Schnellanlage mit vorbelegter Veranstaltung.
import { useState } from 'react';
import { useActions } from '../../app/useActions';
import { useLookups } from '../../app/lookups';
import { useData } from '../../app/useData';
import { api } from '../../data';
import { TASK_STATUS_LABEL } from '../../shared/labels';
import { isActiveTaskStatus } from '../../shared/rules/taskStatus';
import { GhostButton } from '../../ui/bits';
import { Sheet } from '../../ui/Sheet';

export function TaskLinkSheet({
  eventId,
  onCreate,
  onClose,
}: {
  eventId: string;
  /** stattdessen eine neue Aufgabe anlegen */
  onCreate: () => void;
  onClose: () => void;
}) {
  const act = useActions();
  const { eventById } = useLookups();
  const event = eventById.get(eventId);
  const { data: tasks } = useData('tasks', () => api.listTasks());
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  // offene Aufgaben, die noch nicht zu dieser Veranstaltung gehören
  const candidates = (tasks ?? [])
    .filter((t) => isActiveTaskStatus(t.status) && t.event_id !== eventId)
    .filter((t) => !q || t.title.toLowerCase().includes(q))
    .slice(0, 12);

  return (
    <Sheet title="Aufgabe zum Event" onClose={onClose} wf="WF-VER-05" closeButton>
      <div className="flex flex-col gap-3">
        <button
          type="button"
          data-wf="WF-VER-05"
          onClick={onCreate}
          className="flex h-12 items-center justify-center rounded-[14px] border border-rand-stark text-[15px] font-semibold text-text"
        >
          + Neue Aufgabe anlegen
        </button>
        <span className="label-mono pt-1">oder bestehende verknüpfen</span>
        <input
          type="search"
          data-wf="WF-VER-05"
          aria-label="Offene Aufgabe suchen"
          placeholder="Offene Aufgabe suchen …"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-11 rounded-xl border border-rand bg-grund px-3.5 text-[15px] text-text"
        />
        {candidates.map((t) => {
          const other = t.event_id ? eventById.get(t.event_id) : undefined;
          return (
            <button
              key={t.id}
              type="button"
              data-wf="WF-VER-05"
              onClick={async () => {
                const ok = await act(() => api.updateTaskFields(t.id, { event_id: eventId }, t.version), {
                  subject: 'diese Aufgabe',
                  success: `Verknüpft mit ${event?.title ?? 'dem Event'}: ${t.title}`,
                });
                if (ok) onClose();
              }}
              className="flex min-h-12 flex-col items-start justify-center gap-0.5 rounded-xl border border-linie bg-grund px-3 py-2 text-left text-[15px] text-text"
            >
              <span>{t.title}</span>
              <span className="font-mono text-[11px] text-leise uppercase">
                {TASK_STATUS_LABEL[t.status]}
                {other && ` · jetzt bei ${other.title} – wird umgehängt`}
              </span>
            </button>
          );
        })}
        {tasks && candidates.length === 0 && (
          <span className="text-[14px] text-leise">
            {q ? 'Keine offene Aufgabe gefunden.' : 'Alle offenen Aufgaben gehören schon zu diesem Event.'}
          </span>
        )}
        <GhostButton onClick={onClose}>Abbrechen</GhostButton>
      </div>
    </Sheet>
  );
}
