// S-22 Veranstaltung – Detail · P1 (Ausbau in P3, P4; Drive-Ordner und Dokumente P5)
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BarOffset } from '../../app/feedback';
import { useActions, useLatest } from '../../app/useActions';
import { useData } from '../../app/useData';
import { api } from '../../data';
import type { EventDetail as Detail } from '../../data/api';
import { formatDayMonth, formatEventRange, formatTime } from '../../shared/format';
import { EVENT_STATUS_COLOR, EVENT_STATUS_LABEL, EVENT_TYPE_LABEL } from '../../shared/labels';
import { canTransitionEvent, isFinalEventStatus } from '../../shared/rules/eventStatus';
import { EVENT_STATUSES, type EventStatus } from '../../shared/schema';
import { Avatar, cx, GhostButton, LightButton, ListSkeleton, LoadError } from '../../ui/bits';
import { IconBack, IconEdit } from '../../ui/icons';
import { Sheet } from '../../ui/Sheet';
import { TaskCreateSheet } from '../tasks/TaskCreateSheet';
import { EventFormSheet } from './EventFormSheet';
import { EventSections } from './EventSections';
import { TaskLinkSheet } from './TaskLinkSheet';
import { ArchivedNotice, DeleteAction, useDeleteArtifact } from '../common/DeleteAction';
import { TemplateSheet } from './TemplateSheet';
import { DocumentPickSheet } from '../knowledge/DocumentPickSheet';
import { useShowEventOnAgenda } from '../agenda/EventAgendaLink';
import { LinkedDocuments } from '../knowledge/LinkedDocuments';
import { DecisionSheet, QuestionSheet } from '../knowledge/KnowledgeSheets';
import { CommentsAndHistory } from '../../ui/Comments';
import { HistoryList } from '../../ui/HistoryList';
import { entityHistorySentence } from '../../shared/entityHistory';
import { DECISION_KIND_LABEL, DECISION_STATUS_LABEL, decisionActive } from '../../shared/rules/knowledge';
import { EventDriveFolder } from './EventDrive';
import { readDraft, writeDraft } from '../../app/drafts';
import { useLookups } from '../../app/lookups';

export function EventDetail({ eventId }: { eventId: string }) {
  const { data: event, error, reload } = useData(`event:${eventId}`, () => api.getEventDetail(eventId));

  if (!event) {
    return (
      <div className="flex min-h-dvh flex-col lg:min-h-0">
        <TopBar />
        <div className="px-5 py-[18px]">
          {error?.code === 'not_found' ? (
            <div data-wf="WF-ALL-05" className="flex flex-col items-center gap-3 py-10 text-center">
              <span className="text-[16px] font-semibold">Diese Veranstaltung gibt es nicht</span>
              <Link to="/events" className="hit text-[14px] text-pink">
                Zu den Events
              </Link>
            </div>
          ) : error ? (
            <LoadError message={error.message} onRetry={reload} />
          ) : (
            <ListSkeleton />
          )}
        </div>
      </div>
    );
  }
  return <Loaded event={event} />;
}

function TopBar({ children }: { children?: React.ReactNode }) {
  return (
    <div className="sticky top-0 z-10 flex h-[60px] flex-none items-center gap-1 bg-grund px-3">
      <Link
        to="/events"
        aria-label="Zurück zu Veranstaltungen"
        className="flex size-11 items-center justify-center text-text"
      >
        <IconBack />
      </Link>
      <span className="font-mono text-[13px] text-leise">EVENTS</span>
      <span className="flex-1" />
      {children}
    </div>
  );
}

function Loaded({ event }: { event: Detail }) {
  const act = useActions();
  const latest = useLatest(event.version);
  const remove = useDeleteArtifact('event', event.id, () => latest.current, '/events');
  const [sheet, setSheet] = useState<
    | 'edit'
    | 'close'
    | 'task'
    | 'task-new'
    | 'question'
    | 'decision'
    | 'shiftplan'
    | 'lead'
    | 'template'
    | null
  >(null);
  const { memberById, topicName, eventById } = useLookups();
  const { data: documents } = useData(`event-documents:${event.id}`, () =>
    api.listLinkedDocuments('event', event.id),
  );
  // WF-VER-07: „Ausblenden“ gilt auf diesem Gerät (Annahme A41)
  const dismissKey = `event:${event.id}:nachbereitung-ausgeblendet`;
  const [dismissed, setDismissed] = useState(() => readDraft(dismissKey) !== null);

  const final = isFinalEventStatus(event.status);
  const open = event.task_total - event.task_done;
  const pct = event.task_total ? Math.round((event.task_done / event.task_total) * 100) : 0;

  const setStatus = (status: EventStatus) =>
    act(() => api.setEventStatus(event.id, status, latest.current), {
      subject: 'diese Veranstaltung',
      success: status === 'abgeschlossen' ? 'Abgeschlossen' : `Status: ${EVENT_STATUS_LABEL[status]}`,
      undo: (r) => r.undo_token,
    });

  const pickStatus = (status: EventStatus) => {
    if (status === event.status || !canTransitionEvent(event.status, status)) return;
    // Vor „abgeschlossen“ ein Hinweis mit Bestätigung, falls noch offene Aufgaben dranhängen (4.2)
    if (status === 'abgeschlossen' && open > 0) setSheet('close');
    else void setStatus(status);
  };

  const showOnAgenda = useShowEventOnAgenda();

  return (
    <div className="flex min-h-dvh flex-col lg:min-h-0">
      <BarOffset px={24} />
      <TopBar>
        <button
          type="button"
          data-wf="WF-VER-03"
          onClick={() => setSheet('edit')}
          aria-label="Bearbeiten"
          className="flex size-11 items-center justify-center text-text"
        >
          <IconEdit size={20} />
        </button>
        {!event.archived_at && (
          <DeleteAction
            noun="Veranstaltung"
            consequence="Aufgaben, Termine, Entscheidungen und Fakten bleiben erhalten."
            onConfirm={() => void remove()}
          />
        )}
      </TopBar>

      <div className="flex flex-1 flex-col gap-4 px-5 pt-1 pb-24">
        {event.archived_at && <ArchivedNotice />}
        <div className="flex flex-col gap-2">
          <span className="label-mono">{EVENT_TYPE_LABEL[event.type]}</span>
          <h1 className="m-0 text-[34px] leading-[1.15] font-bold tracking-[-1px]">{event.title}</h1>
          <div className="font-mono text-[13px] text-weich uppercase">
            {formatEventRange(event.starts_at, event.ends_at)}
            {event.setup_at && ` · Aufbau ab ${besideStart(event.setup_at, event.starts_at)}`}
            {event.teardown_at &&
              ` · Abbau bis ${besideStart(event.teardown_at, event.ends_at ?? event.starts_at)}`}
          </div>
          {event.description && (
            <p className="mt-1 mb-0 text-[15px] leading-normal whitespace-pre-wrap text-weich">
              {event.description}
            </p>
          )}
        </div>

        {/* WF-VER-04 Status; Abschließen mit offenen Aufgaben fragt nach */}
        <div className="flex flex-col gap-2">
          <span id="event-status" className="label-mono">
            Status
          </span>
          <div role="group" aria-labelledby="event-status" className="flex flex-wrap gap-1.5">
            {EVENT_STATUSES.map((s) => {
              const on = event.status === s;
              const ok = on || canTransitionEvent(event.status, s);
              return (
                <button
                  key={s}
                  type="button"
                  data-wf="WF-VER-04"
                  onClick={() => pickStatus(s)}
                  aria-pressed={on}
                  aria-disabled={!ok}
                  className={cx(
                    // wie die Status-Leiste der Aufgaben: Farbpunkt je Status (Phase 9)
                    'hit flex h-[34px] items-center gap-1.5 rounded-[17px] border px-3 text-[13px] font-medium',
                    on ? 'border-text bg-text text-grund' : 'border-rand text-weich',
                    !ok && 'cursor-default opacity-35',
                  )}
                >
                  <span className="size-[7px] rounded-full" style={{ background: EVENT_STATUS_COLOR[s] }} />
                  {EVENT_STATUS_LABEL[s]}
                </button>
              );
            })}
          </div>
          {final && (
            <span className="text-[13px] text-leise">
              {event.status === 'abgesagt' ? 'Abgesagt' : 'Abgeschlossen'} – der Status lässt sich nicht mehr
              ändern.
            </span>
          )}
        </div>

        {/* WF-VER-07 Vorschlag „In Nachbereitung?“ am Tag danach */}
        {event.suggests_follow_up && !dismissed && (
          <div
            data-wf="WF-VER-07"
            className="flex flex-wrap items-center gap-2.5 rounded-[14px] border border-bernstein/40 bg-bernstein/10 px-3.5 py-3"
          >
            <span className="min-w-0 flex-1 text-[14px] leading-[1.4]">
              Die Veranstaltung ist vorbei. Auf „In Nachbereitung“ setzen?
            </span>
            <button
              type="button"
              data-wf="WF-VER-07"
              onClick={() => void setStatus('in_nachbereitung')}
              className="hit h-[34px] rounded-[17px] bg-bernstein px-3 text-[13px] font-semibold text-grund"
            >
              Ja
            </button>
            <button
              type="button"
              data-wf="WF-VER-07"
              onClick={() => {
                writeDraft(dismissKey, '1');
                setDismissed(true);
              }}
              className="hit h-[34px] px-2 text-[13px] text-leise"
            >
              Ausblenden
            </button>
          </div>
        )}

        <div className="flex flex-col gap-2 rounded-2xl border border-linie bg-flaeche px-4 py-3.5">
          <button
            type="button"
            data-wf="WF-AGE-02"
            onClick={() => showOnAgenda(event.id)}
            aria-label="Alle Aufgaben und Fragen zum Event"
            className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1.5 text-left text-[14px] text-text"
          >
            <span className="text-pink">Alle Aufgaben und Fragen zum Event ›</span>
            <span className="font-mono text-[12px] text-leise">
              {event.task_total
                ? `${event.task_done} VON ${event.task_total} ERLEDIGT`
                : 'NOCH KEINE AUFGABEN'}
              {event.task_overdue > 0 && (
                <>
                  {' · '}
                  <span className="text-rot">{event.task_overdue} ÜBERFÄLLIG</span>
                </>
              )}
            </span>
          </button>
          <div
            className="h-1.5 rounded-[3px] bg-linie"
            role="progressbar"
            aria-label="Erledigte Aufgaben"
            aria-valuemin={0}
            aria-valuemax={event.task_total}
            aria-valuenow={event.task_done}
          >
            <div className="bg-marke-fortschritt h-1.5 rounded-[3px]" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1 flex flex-wrap gap-2">
            {/* WF-VER-05 Aufgabe zur Veranstaltung: bestehende verknüpfen oder neu anlegen (Phase 9) */}
            <button
              type="button"
              data-wf="WF-VER-05"
              onClick={() => setSheet('task')}
              className="hit h-[34px] rounded-[17px] border border-rand-stark px-3 text-[13px] text-text"
            >
              + Aufgabe
            </button>
            {/* WF-FRA-01 Frage zur Veranstaltung – steht dann auf der Agenda */}
            <button
              type="button"
              data-wf="WF-FRA-01"
              onClick={() => setSheet('question')}
              className="hit h-[34px] rounded-[17px] border border-rand-stark px-3 text-[13px] text-text"
            >
              + Frage
            </button>
            {/* WF-WIS-01 Entscheidung oder Fakt zur Veranstaltung – auch hier, nicht nur im Abschnitt unten (Phase 9) */}
            <button
              type="button"
              data-wf="WF-WIS-01"
              onClick={() => setSheet('decision')}
              className="hit h-[34px] rounded-[17px] border border-rand-stark px-3 text-[13px] text-text"
            >
              + Entscheidung / Fakt
            </button>
            {/* WF-VER-12 Vorlagen-Dialog erneut aufrufen – ohne Duplikate */}
            {!final && (
              <button
                type="button"
                data-wf="WF-VER-12"
                onClick={() => setSheet('template')}
                className="hit h-[34px] rounded-[17px] border border-rand-stark px-3 text-[13px] text-text"
              >
                Aus Vorlage …
              </button>
            )}
          </div>
        </div>

        {/* WF-VER-14 Drive-Ordner mit Inhalt aus dem Cache */}
        <EventDriveFolder event={event} />

        {/* WF-VER-11 Schichtplan als verknüpftes Dokument */}
        {event.shift_plan_document ? (
          <div className="flex min-h-[46px] items-center gap-2 rounded-[14px] border border-rand px-3.5">
            <span className="label-mono">Schichtplan</span>
            <a
              href={event.shift_plan_document.url}
              target="_blank"
              rel="noreferrer"
              className="hit min-w-0 flex-1 truncate text-[14px] text-text no-underline"
            >
              {event.shift_plan_document.title} ↗
            </a>
            <button
              type="button"
              data-wf="WF-VER-11"
              onClick={() =>
                void act(() => api.setShiftPlan(event.id, null, latest.current), {
                  subject: 'diese Veranstaltung',
                  success: 'Verknüpfung entfernt',
                })
              }
              className="hit h-8 px-2 text-[13px] text-leise"
            >
              Entfernen
            </button>
          </div>
        ) : (
          <button
            type="button"
            data-wf="WF-VER-11"
            onClick={() => setSheet('shiftplan')}
            className="flex h-[46px] items-center gap-2 rounded-[14px] border border-rand px-3.5 text-[14px] text-text"
          >
            + Schichtplan verknüpfen
          </button>
        )}

        {/* WF-VER-09 Hauptverantwortliche, eintragsweise */}
        <div
          data-wf="WF-VER-09"
          className="flex flex-wrap items-center gap-2 rounded-[14px] border border-linie bg-flaeche px-3.5 py-2"
        >
          <span className="label-mono flex-1">Hauptverantwortlich</span>
          {event.lead_ids.map((id) => {
            const m = memberById.get(id);
            return (
              <button
                key={id}
                type="button"
                data-wf="WF-VER-09"
                aria-label={`Austragen: ${m?.display_name ?? 'unbekannt'}`}
                onClick={() =>
                  void act(() => api.removeEventLead(event.id, id), {
                    success: `Ausgetragen: ${m?.display_name ?? ''}`,
                    undo: (r) => r.undo_token,
                  })
                }
                className="flex min-h-11 items-center gap-1.5 text-[14px] text-text"
              >
                <Avatar member={m} size={26} />
                {m?.display_name}
                <span aria-hidden="true" className="text-[16px] text-leise">
                  ×
                </span>
              </button>
            );
          })}
          <button
            type="button"
            data-wf="WF-VER-09"
            aria-label="Hauptverantwortliche hinzufügen"
            onClick={() => setSheet('lead')}
            className="hit size-[30px] rounded-full border border-dashed border-rand-stark text-[16px] text-leise"
          >
            +
          </button>
        </div>

        {/* WF-VER-08 Detailbereiche */}
        <EventSections event={event} />

        {/* F-WIS-05 Dokumente an der Veranstaltung – per Link, aus den Erfassten oder aus dem Drive */}
        <LinkedDocuments
          wf="WF-WIS-06"
          target={{ type: 'event', id: event.id, kind: 'Veranstaltung', name: event.title }}
          documents={documents}
        />

        {/* 16.3: Entscheidungen und Fakten zu dieser Veranstaltung direkt hier */}
        <section aria-label="Entscheidungen & Fakten" className="flex flex-col gap-2">
          <div className="flex min-h-8 items-center justify-between">
            <span className="label-mono">Entscheidungen & Fakten · {event.decisions.length}</span>
            <button
              type="button"
              data-wf="WF-WIS-01"
              onClick={() => setSheet('decision')}
              className="hit h-8 text-[13px] text-pink"
            >
              + Festhalten
            </button>
          </div>
          {event.decisions.map((d) => (
            <Link
              key={d.id}
              to={`/wissen/beschluesse/${d.id}`}
              className={cx(
                'flex flex-col gap-1 rounded-[14px] border border-linie bg-flaeche px-3.5 py-2.5 text-text no-underline',
                !decisionActive(d.status) && 'opacity-60',
              )}
            >
              <span className="label-mono">
                {DECISION_KIND_LABEL[d.kind]} · {DECISION_STATUS_LABEL[d.status]}
              </span>
              <span className="text-[15px] leading-[1.35] font-medium">{d.title}</span>
              {d.description && (
                <span className="line-clamp-3 text-[14px] leading-[1.45] break-words text-weich">
                  {d.description}
                </span>
              )}
            </Link>
          ))}
          {event.decisions.length === 0 && (
            <span className="text-[14px] text-leise">Noch nichts zu dieser Veranstaltung festgehalten.</span>
          )}
        </section>

        <CommentsAndHistory
          target="event"
          targetId={event.id}
          comments={event.comments}
          archived={!!event.archived_at}
          history={
            <HistoryList
              heading={false}
              entries={event.history}
              sentence={(h) =>
                entityHistorySentence(h, 'Veranstaltung', {
                  memberName: (id) => memberById.get(id)?.display_name ?? 'Jemand',
                  topicName,
                  eventTitle: (id) => eventById.get(id)?.title ?? 'unbekannt',
                })
              }
            />
          }
        />
      </div>

      {/* nach einer fremden Änderung (neue version) startet das Formular mit dem frischen Stand */}
      {sheet === 'edit' && (
        <EventFormSheet key={event.version} event={event} onClose={() => setSheet(null)} />
      )}
      {sheet === 'template' && <TemplateSheet eventId={event.id} onClose={() => setSheet(null)} />}
      {sheet === 'question' && <QuestionSheet eventPreset={event.id} onClose={() => setSheet(null)} />}
      {sheet === 'decision' && <DecisionSheet eventPreset={event.id} onClose={() => setSheet(null)} />}
      {sheet === 'shiftplan' && (
        <DocumentPickSheet
          title="Schichtplan verknüpfen"
          wf="WF-VER-11"
          preferType="schichtplan"
          onClose={() => setSheet(null)}
          onPick={(id) => {
            setSheet(null);
            void act(() => api.setShiftPlan(event.id, id, latest.current), {
              subject: 'diese Veranstaltung',
              success: 'Schichtplan verknüpft',
            });
          }}
        />
      )}
      {sheet === 'lead' && (
        <LeadSheet
          taken={event.lead_ids}
          onClose={() => setSheet(null)}
          onPick={(id) => {
            setSheet(null);
            void act(() => api.addEventLead(event.id, id), {
              success: `Hauptverantwortlich: ${memberById.get(id)?.display_name ?? ''}`,
              undo: (r) => r.undo_token,
            });
          }}
        />
      )}
      {sheet === 'task' && (
        <TaskLinkSheet
          eventId={event.id}
          onCreate={() => setSheet('task-new')}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'task-new' && (
        <TaskCreateSheet eventId={event.id} wf="WF-VER-05" onClose={() => setSheet(null)} />
      )}
      {sheet === 'close' && (
        <Sheet title="Veranstaltung abschließen?" onClose={() => setSheet(null)} wf="WF-VER-04">
          <span className="text-[15px] leading-normal text-weich">
            {open === 1 ? '1 Aufgabe ist' : `${open} Aufgaben sind`} noch offen. Sie{' '}
            {open === 1 ? 'bleibt' : 'bleiben'} offen und an der Veranstaltung hängen.
          </span>
          <LightButton
            data-wf="WF-VER-04"
            onClick={() => {
              setSheet(null);
              void setStatus('abgeschlossen');
            }}
          >
            Trotzdem abschließen
          </LightButton>
          <GhostButton onClick={() => setSheet(null)}>Abbrechen</GhostButton>
        </Sheet>
      )}
    </div>
  );
}

/** Aktive Mitglieder zur Auswahl als Hauptverantwortliche */
function LeadSheet({
  taken,
  onClose,
  onPick,
}: {
  taken: string[];
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  const { activeMembers } = useLookups();
  const free = activeMembers.filter((m) => !taken.includes(m.id));
  return (
    <Sheet title="Hauptverantwortlich" onClose={onClose} wf="WF-VER-09" closeButton>
      <div className="flex flex-col gap-1.5">
        {free.map((m) => (
          <button
            key={m.id}
            type="button"
            data-wf="WF-VER-09"
            onClick={() => onPick(m.id)}
            className="flex min-h-11 items-center gap-2.5 rounded-xl border border-linie bg-grund px-3 py-1.5 text-left text-[15px] text-text"
          >
            <Avatar member={m} size={26} />
            {m.display_name}
          </button>
        ))}
        {free.length === 0 && (
          <span className="text-[14px] text-leise">Alle aktiven Mitglieder sind schon eingetragen.</span>
        )}
      </div>
    </Sheet>
  );
}

/** Uhrzeit, an einem anderen Tag als Bezug mit Datum: „16:00“ bzw. „11.12. 14:00“ */
function besideStart(iso: string, reference: string): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date(reference).toDateString();
  return sameDay ? formatTime(d) : `${formatDayMonth(d)} ${formatTime(d)}`;
}
