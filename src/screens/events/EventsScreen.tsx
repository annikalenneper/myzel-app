// S-20 Veranstaltungsliste · P1 – am Desktop mit der Detailansicht daneben
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ListDetailLayout } from '../../app/AppShell';
import { BarOffset } from '../../app/feedback';
import { useMe } from '../../app/session';
import { useData } from '../../app/useData';
import { api } from '../../data';
import type { EventListItem } from '../../data/api';
import { EVENT_STATUS_COLOR, EVENT_STATUS_LABEL, EVENT_TYPE_LABEL } from '../../shared/labels';
import { LONG_FOLLOW_UP_DAYS } from '../../shared/rules/eventDetails';
import { Avatar, cx, ListSkeleton, LoadError } from '../../ui/bits';
import { byMonth, DateBadge, MonthSection, TimeTabs, type TimeTab } from '../../ui/DatedList';
import { SearchButton } from '../../ui/SearchOverlay';
import { EventDetail } from './EventDetail';
import { EventFormSheet } from './EventFormSheet';
import { TemplateSheet } from './TemplateSheet';

export function EventsScreen() {
  const { eventId } = useParams();
  return (
    <ListDetailLayout
      detailOpen={!!eventId}
      list={<EventList selectedId={eventId ?? null} />}
      detail={eventId ? <EventDetail key={eventId} eventId={eventId} /> : null}
    />
  );
}

/** Bis wann eine Veranstaltung als „kommend“ zählt: bis zum Ende, ohne Ende bis zum Ende ihres Tages. */
const endOf = (e: Pick<EventListItem, 'starts_at' | 'ends_at'>) => {
  if (e.ends_at) return new Date(e.ends_at).getTime();
  const day = new Date(e.starts_at);
  day.setHours(23, 59, 59, 999);
  return day.getTime();
};
const startOf = (e: EventListItem) => new Date(e.starts_at).getTime();

function EventList({ selectedId }: { selectedId: string | null }) {
  const { data: events, error, reload } = useData('events', () => api.listEvents());
  const [tab, setTab] = useState<TimeTab>('kommend');
  const [templateFor, setTemplateFor] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [now] = useState(() => Date.now());
  const me = useMe();
  // anstehend: kommende, die nicht abgesagt sind; abgeschlossen: Status „Abgeschlossen“
  const upcoming = (events ?? []).filter((e) => endOf(e) >= now && e.status !== 'abgesagt').length;
  const closed = (events ?? []).filter((e) => e.status === 'abgeschlossen').length;
  // WF-VER-01: kommende aufsteigend, vergangene absteigend nach Datum
  const shown = (events ?? [])
    .filter((e) => (tab === 'kommend' ? endOf(e) >= now : endOf(e) < now))
    .sort((a, b) => (tab === 'kommend' ? startOf(a) - startOf(b) : startOf(b) - startOf(a)));

  return (
    <div className="flex min-h-dvh flex-col lg:min-h-0">
      <BarOffset px={92} />
      {/* Kopf wie Agenda und Termine: Logo, Suche, Profil, Überschrift mit Zahlen */}
      <div className="flex flex-col gap-4 px-5 pt-5">
        <div className="flex items-center lg:justify-end">
          <img src="/myzel-logo.png" alt="Myzel" className="h-11 w-[66px] object-contain lg:hidden" />
          <span className="flex-1" />
          <SearchButton first="events" />
          <Link to="/profil" aria-label="Profil" className="hit ml-2.5 flex size-10 no-underline">
            <Avatar member={me} size={40} fontSize={13} />
          </Link>
        </div>
        <div className="flex flex-col gap-1">
          <h1 className="m-0 text-[32px] leading-[1.15] font-bold tracking-[-1px]">Events</h1>
          <div className="font-mono text-[12px] text-leise">
            {events ? `${upcoming} ANSTEHEND · ${closed} ABGESCHLOSSEN` : ' '}
          </div>
        </div>
        <TimeTabs value={tab} onChange={setTab} wf="WF-VER-01" />
      </div>

      <div role="tabpanel" className="flex flex-1 flex-col gap-3 px-5 pt-4 pb-[180px] lg:pb-28">
        {!events && !error && <ListSkeleton />}
        {!events && error && <LoadError message={error.message} onRetry={reload} />}
        {/* Phase 9: nach Monat gruppiert wie die Termine */}
        {byMonth(shown, (e) => e.starts_at).map((m) => (
          <MonthSection key={m.name} name={m.name}>
            {m.items.map((e) => {
              const pct = e.task_total ? Math.round((e.task_done / e.task_total) * 100) : 0;
              return (
                <Link
                  key={e.id}
                  to={`/events/${e.id}`}
                  className={cx(
                    'flex gap-3.5 rounded-2xl border border-linie px-4 py-3.5 text-text no-underline',
                    e.id === selectedId ? 'bg-erhoeht' : 'bg-flaeche',
                  )}
                >
                  <DateBadge iso={e.starts_at} />
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="label-mono">{EVENT_TYPE_LABEL[e.type]}</span>
                      <span
                        className="flex items-center gap-1.5 rounded-full border px-2 py-px font-mono text-[10px] uppercase"
                        style={{
                          borderColor: EVENT_STATUS_COLOR[e.status],
                          color: EVENT_STATUS_COLOR[e.status],
                        }}
                      >
                        {/* Farbpunkt wie bei den Aufgaben (Phase 9) */}
                        <span
                          className="size-1.5 rounded-full"
                          style={{ background: EVENT_STATUS_COLOR[e.status] }}
                        />
                        {EVENT_STATUS_LABEL[e.status]}
                      </span>
                    </div>
                    <span className="text-[18px] leading-[1.25] font-semibold">{e.title}</span>
                    {/* 4.2: steht sie lange in Nachbereitung, zeigt die Liste nur einen Hinweis */}
                    {e.follow_up_since &&
                      now - new Date(e.follow_up_since).getTime() > LONG_FOLLOW_UP_DAYS * 86_400_000 && (
                        <span className="text-[13px] leading-[1.4] text-bernstein">
                          Seit über {LONG_FOLLOW_UP_DAYS} Tagen in Nachbereitung
                        </span>
                      )}
                    <div className="flex items-center gap-2.5">
                      <div
                        className="h-[5px] flex-1 rounded-[3px] bg-linie"
                        role="progressbar"
                        aria-label="Erledigte Aufgaben"
                        aria-valuemin={0}
                        aria-valuemax={e.task_total}
                        aria-valuenow={e.task_done}
                      >
                        <div
                          className="bg-marke-fortschritt h-[5px] rounded-[3px]"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="font-mono text-[11px] text-leise">
                        {e.task_total ? `${e.task_done}/${e.task_total}` : 'KEINE AUFGABEN'}
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </MonthSection>
        ))}
        {/* WF-ALL-05 Leerzustand */}
        {events && shown.length === 0 && (
          <div data-wf="WF-ALL-05" className="flex flex-col items-center gap-3 px-4 py-10 text-center">
            <span className="text-[14px] leading-normal text-leise">
              {tab === 'kommend'
                ? 'Noch keine kommenden Veranstaltungen. Leg die nächste an.'
                : 'Noch keine vergangenen Veranstaltungen.'}
            </span>
            {tab === 'kommend' && (
              <button
                type="button"
                data-wf="WF-VER-02"
                onClick={() => setCreating(true)}
                className="hit flex h-[42px] items-center rounded-[21px] border border-rand-stark px-[18px] text-[14px] text-text"
              >
                + Veranstaltung
              </button>
            )}
          </div>
        )}
      </div>

      {creating && (
        <EventFormSheet
          onClose={() => setCreating(false)}
          onCreated={(created) => {
            // auf den Reiter schalten, in dem die neue Veranstaltung landet – und gleich die Vorlage anbieten (WF-VER-02)
            setTab(endOf(created) >= Date.now() ? 'kommend' : 'vergangen');
            setTemplateFor(created.id);
          }}
        />
      )}
      {templateFor && <TemplateSheet eventId={templateFor} onClose={() => setTemplateFor(null)} />}
    </div>
  );
}
