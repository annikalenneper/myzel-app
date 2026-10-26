// 16.3: Aufgaben und offene Fragen einer Veranstaltung – die Agenda, gefiltert auf die Veranstaltung (Link im
// Event-Detail). Aus Aufgabe, Frage oder Entscheidung führt ein Link zur Veranstaltung selbst (Phase 9).
import { Link, useNavigate } from 'react-router-dom';
import { DEFAULT_AGENDA_FILTER, useAgendaFilter } from '../../app/agendaFilter';
import { useLookups } from '../../app/lookups';

/** setzt den Filter der Agenda auf die Veranstaltung und öffnet sie */
export function useShowEventOnAgenda() {
  const navigate = useNavigate();
  const { setFilter } = useAgendaFilter();
  return (eventId: string) => {
    setFilter({ ...DEFAULT_AGENDA_FILTER, eventId });
    navigate('/agenda');
  };
}

/** „Zum Event: Winterrave ›“ – aus einem Eintrag zur Veranstaltung, zu der er gehört */
export function EventLink({ eventId }: { eventId: string }) {
  const { eventById } = useLookups();
  const event = eventById.get(eventId);
  if (!event) return null;
  return (
    <Link
      to={`/events/${event.id}`}
      data-wf="WF-VER-01"
      className="hit flex min-h-11 items-center self-start text-left text-[14px] text-pink no-underline"
    >
      Zum Event: {event.title} ›
    </Link>
  );
}
