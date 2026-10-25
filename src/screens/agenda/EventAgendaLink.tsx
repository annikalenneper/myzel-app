// 16.3: Aufgaben und offene Fragen einer Veranstaltung – die Agenda, gefiltert auf diese Veranstaltung
import { useNavigate } from 'react-router-dom';
import { DEFAULT_AGENDA_FILTER, useAgendaFilter } from '../../app/agendaFilter';

/** setzt den Filter der Agenda auf die Veranstaltung und öffnet sie */
export function useShowEventOnAgenda() {
  const navigate = useNavigate();
  const { setFilter } = useAgendaFilter();
  return (eventId: string) => {
    setFilter({ ...DEFAULT_AGENDA_FILTER, eventId });
    navigate('/agenda');
  };
}

export function EventAgendaLink({ eventId }: { eventId: string }) {
  const show = useShowEventOnAgenda();
  return (
    <button
      type="button"
      data-wf="WF-AGE-02"
      onClick={() => show(eventId)}
      className="hit flex min-h-11 items-center self-start text-left text-[14px] text-pink"
    >
      Aufgaben und offene Fragen zu diesem Event →
    </button>
  );
}
