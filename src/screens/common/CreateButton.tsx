// Ein „+“ für alle Arten aus jeder Ansicht (Umbau 10/2026, Phase 5): Aufgabe, Frage, Entscheidung, Fakt,
// Veranstaltung, Termin, Dokument, Partner – vorbelegt aus dem Kontext (in einer Veranstaltung, einem Termin oder der
// auf eine Veranstaltung gefilterten Agenda).
import { useState } from 'react';
import { useMatch, useNavigate } from 'react-router-dom';
import { useAgendaFilter } from '../../app/agendaFilter';
import { useFeedback } from '../../app/feedback';
import { useLookups } from '../../app/lookups';
import { useData } from '../../app/useData';
import { api } from '../../data';
import { cx } from '../../ui/bits';
import { IconPlus } from '../../ui/icons';
import { Sheet } from '../../ui/Sheet';
import { AppointmentFormSheet } from '../appointments/AppointmentFormSheet';
import { EventFormSheet } from '../events/EventFormSheet';
import { TemplateSheet } from '../events/TemplateSheet';
import { DocumentLinkScreen } from '../knowledge/DocumentLinkScreen';
import { DecisionSheet, QuestionSheet } from '../knowledge/KnowledgeSheets';
import { PartnerFormSheet } from '../partners/PartnersScreen';
import { TaskCreateSheet } from '../tasks/TaskCreateSheet';

type Kind = 'task' | 'question' | 'entscheidung' | 'fakt' | 'event' | 'appointment' | 'document' | 'partner';
const KINDS: [kind: Kind, label: string, wf: string][] = [
  ['task', 'Aufgabe', 'WF-AUF-03'],
  ['question', 'Frage', 'WF-FRA-01'],
  ['entscheidung', 'Entscheidung', 'WF-WIS-01'],
  ['fakt', 'Fakt', 'WF-WIS-01'],
  ['event', 'Veranstaltung', 'WF-VER-02'],
  ['appointment', 'Termin', 'WF-TER-02'],
  ['document', 'Dokument', 'WF-WIS-06'],
  ['partner', 'Partner', 'WF-VER-10'],
];

export function CreateButton({ navVisible, hidden }: { navVisible: boolean; hidden: boolean }) {
  const { barVisible } = useFeedback();
  const navigate = useNavigate();
  const { eventById } = useLookups();
  const { filter } = useAgendaFilter();
  // Kontext: geöffnete Veranstaltung, geöffneter Termin (samt seiner Veranstaltung) oder gefilterte Agenda
  const openEventId = useMatch('/events/:eventId')?.params.eventId;
  const appointmentId = useMatch('/termine/:appointmentId')?.params.appointmentId;
  const onAgenda = !!useMatch('/agenda/*');
  const onEventList = !!useMatch('/events');
  const onAppointmentList = !!useMatch('/termine');
  // dieselbe Anfrage wie die Detailansicht – kommt aus dem Zwischenspeicher
  const { data: appointment } = useData(
    appointmentId ? `appointment:${appointmentId}` : 'appointment:keiner',
    () => (appointmentId ? api.getAppointment(appointmentId) : Promise.resolve(null)),
  );
  let eventId = openEventId;
  if (appointmentId) eventId = appointment?.event_id ?? undefined;
  else if (onAgenda) eventId = filter.eventId ?? undefined;
  const event = eventId ? eventById.get(eventId) : undefined;
  const [choosing, setChoosing] = useState(false);
  const [kind, setKind] = useState<Kind | null>(null);
  const [templateFor, setTemplateFor] = useState<string | null>(null);
  const close = () => setKind(null);

  return (
    <>
      {/* WF-ALL-08 Neu anlegen – weicht der Rückgängig-Leiste */}
      {!barVisible && (
        <button
          type="button"
          data-wf="WF-ALL-08"
          onClick={() => setChoosing(true)}
          aria-label="Neu anlegen"
          className={cx(
            'bg-marke fixed right-5 z-10 size-[58px] items-center justify-center rounded-full text-grund schein-marke lg:right-auto lg:bottom-6 lg:left-[562px] lg:flex',
            navVisible
              ? 'bottom-[calc(96px+env(safe-area-inset-bottom,0px))]'
              : 'bottom-[calc(24px+env(safe-area-inset-bottom,0px))]',
            hidden ? 'hidden' : 'flex',
          )}
        >
          <IconPlus size={26} />
        </button>
      )}

      {choosing && (
        <Sheet title="Neu anlegen" onClose={() => setChoosing(false)} wf="WF-ALL-08" closeButton>
          <div className="flex flex-col gap-3">
            {appointmentId && appointment ? (
              <span className="text-[13px] leading-[1.4] text-leise">
                Aufgabe und Dokument gehören gleich zu „{appointment.title}“
                {event ? `, Frage, Entscheidung und Fakt zu „${event.title}“` : ''}.
              </span>
            ) : (
              event && (
                <span className="text-[13px] leading-[1.4] text-leise">
                  Aufgabe, Frage, Entscheidung, Fakt, Termin und Dokument gehören gleich zu „{event.title}“.
                </span>
              )
            )}
            <div role="group" aria-label="Was anlegen?" className="grid grid-cols-2 gap-2">
              {KINDS.map(([key, label, wf]) => (
                <button
                  key={key}
                  type="button"
                  data-wf={wf}
                  onClick={() => {
                    setChoosing(false);
                    setKind(key);
                  }}
                  className="hit h-12 rounded-[14px] border border-rand-stark text-[15px] text-text"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </Sheet>
      )}

      {kind === 'task' && (
        <TaskCreateSheet onClose={close} eventId={eventId ?? null} appointmentId={appointmentId ?? null} />
      )}
      {kind === 'question' && <QuestionSheet onClose={close} eventPreset={eventId} />}
      {(kind === 'entscheidung' || kind === 'fakt') && (
        <DecisionSheet initialKind={kind} eventPreset={eventId} onClose={close} />
      )}
      {kind === 'event' && (
        <EventFormSheet
          onClose={close}
          onCreated={(created) => {
            // zur neuen Veranstaltung (aus der Liste heraus bleibt die Liste) – und gleich die Vorlage anbieten (WF-VER-02)
            if (!onEventList) navigate(`/events/${created.id}`);
            setTemplateFor(created.id);
          }}
        />
      )}
      {templateFor && <TemplateSheet eventId={templateFor} onClose={() => setTemplateFor(null)} />}
      {kind === 'appointment' && (
        <AppointmentFormSheet
          eventPreset={eventId}
          onClose={close}
          onCreated={(id) => {
            if (!onAppointmentList) navigate(`/termine/${id}`);
          }}
        />
      )}
      {kind === 'document' && (
        <DocumentLinkScreen
          target={
            appointmentId && appointment
              ? { type: 'appointment', id: appointment.id, kind: 'Termin', name: appointment.title }
              : event
                ? { type: 'event', id: event.id, kind: 'Veranstaltung', name: event.title }
                : null
          }
          onClose={close}
        />
      )}
      {kind === 'partner' && (
        <PartnerFormSheet onClose={close} onCreated={(id) => navigate(`/partner/${id}`)} />
      )}
    </>
  );
}
