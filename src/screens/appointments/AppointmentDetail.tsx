// S-32 Termin – Detail · P3 (Serien kommen in P6)
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useNow } from '../../app/useNow';
import { BarOffset, useFeedback } from '../../app/feedback';
import { useLookups } from '../../app/lookups';
import { useActions, useLatest } from '../../app/useActions';
import { useData } from '../../app/useData';
import { api } from '../../data';
import type { AppointmentDetail as Detail } from '../../data/api';
import { formatEventRange } from '../../shared/format';
import { TASK_STATUS_COLOR, TASK_STATUS_LABEL } from '../../shared/labels';
import {
  APPOINTMENT_STATUS_COLOR,
  APPOINTMENT_STATUS_LABEL,
  canMarkAppointment,
  canMarkHappened,
  canRsvp,
  FORMAT_LABEL,
  whenText,
} from '../../shared/rules/appointments';
import { Avatar, cx, GhostButton, ListSkeleton, LoadError } from '../../ui/bits';
import { IconBack, IconBookmark } from '../../ui/icons';
import { ConfirmDialog } from '../knowledge/DetailParts';
import { LinkedDocuments } from '../knowledge/LinkedDocuments';
import { TaskCreateSheet } from '../tasks/TaskCreateSheet';
import { AppointmentFormSheet } from './AppointmentFormSheet';
import { rsvpButton, useRsvp } from './AppointmentsScreen';
import { PlenumDetail } from './PlenumDetail';
import { SeriesSheet } from './SeriesSheet';

export function AppointmentDetail({ appointmentId }: { appointmentId: string }) {
  const { data, error, reload } = useData(`appointment:${appointmentId}`, () =>
    api.getAppointment(appointmentId),
  );
  if (!data) {
    return (
      <div className="flex min-h-dvh flex-col lg:min-h-0">
        <TopBar />
        <div className="px-5 py-[18px]">
          {error?.code === 'not_found' ? (
            <div data-wf="WF-ALL-05" className="flex flex-col items-center gap-3 py-10 text-center">
              <span className="text-[16px] font-semibold">Diesen Termin gibt es nicht</span>
              <Link to="/termine" className="hit text-[14px] text-pink">
                Zu den Terminen
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
  return data.is_plenum ? <PlenumDetail plenumId={data.id} /> : <Loaded a={data} />;
}

export function TopBar({ children }: { children?: React.ReactNode }) {
  return (
    <div className="sticky top-0 z-10 flex h-[60px] flex-none items-center gap-1 bg-grund px-3">
      <Link
        to="/termine"
        aria-label="Zurück zu Termine"
        className="flex size-11 items-center justify-center text-text"
      >
        <IconBack />
      </Link>
      <span className="font-mono text-[13px] text-leise">TERMINE</span>
      <span className="flex-1" />
      {children}
    </div>
  );
}

function Loaded({ a }: { a: Detail }) {
  const { run } = useFeedback();
  const act = useActions();
  const latest = useLatest(a.version);
  const rsvp = useRsvp();
  const { memberById, activeMembers, topicName } = useLookups();
  const [sheet, setSheet] = useState<'edit' | 'task' | 'cancel' | 'series' | null>(null);
  const now = useNow();
  const { data: documents } = useData(`appointment-documents:${a.id}`, () =>
    api.listLinkedDocuments('appointment', a.id),
  );
  // Teilnahme: aus den Zusagen vorbefüllt (F-TER-04)
  const [here, setHere] = useState<string[] | null>(null);
  const present = here ?? a.yes_ids;

  const planned = a.status === 'geplant';
  const cancelled = a.status === 'abgesagt';
  const happened = a.status === 'stattgefunden' || a.status === 'abgeschlossen';
  const answerable = canRsvp(a, now);

  const groups: [label: string, color: string, ids: string[]][] = [
    ['Kommen', 'text-gruen', a.yes_ids],
    ['Nicht', 'text-leise', a.no_ids],
    ['Offen', 'text-bernstein', a.open_ids],
  ];

  const toggleMark = () =>
    void run(() => api.setAppointmentMark(a.id, !a.marked), {
      success: a.marked ? 'Markierung entfernt' : 'Fürs Plenum markiert',
      undo: (r) => r.undo_token,
    });

  const place = a.format === 'online' ? null : a.format === 'hybrid' ? `${a.location} + Call` : a.location;

  return (
    <div className="flex min-h-dvh flex-col lg:min-h-0">
      <BarOffset px={cancelled ? 24 : 92} />
      <TopBar>
        {/* WF-TER-08 – nur geplant, nie bei Plenum-Terminen */}
        {canMarkAppointment(a, a.is_plenum) && (
          <button
            type="button"
            data-wf="WF-TER-08"
            onClick={toggleMark}
            aria-pressed={a.marked}
            aria-label={a.marked ? 'Markierung „Fürs Plenum“ entfernen' : 'Fürs Plenum markieren'}
            className={cx(
              'hit mr-2 flex h-[34px] items-center gap-1.5 rounded-[17px] border px-3 font-mono text-[12px]',
              a.marked ? 'border-pink text-pink' : 'border-rand text-leise',
            )}
          >
            <IconBookmark filled={a.marked} size={14} />
            {a.marked ? 'FÜRS PLENUM' : 'MARKIEREN'}
          </button>
        )}
      </TopBar>

      <div className="flex flex-1 flex-col gap-4 px-5 pt-1 pb-10">
        <div className="flex flex-col gap-2">
          <span className="label-mono flex flex-wrap items-center gap-2">
            <span className="size-2 flex-none rounded-full" style={{ background: a.type_color }} />
            {a.type_label}
            <span
              className="rounded-full border px-2 py-px text-[10px]"
              style={{
                borderColor: APPOINTMENT_STATUS_COLOR[a.status],
                color: APPOINTMENT_STATUS_COLOR[a.status],
              }}
            >
              {APPOINTMENT_STATUS_LABEL[a.status]}
            </span>
          </span>
          <h1
            className={cx(
              'm-0 text-[30px] leading-[1.15] font-bold tracking-[-1px]',
              cancelled && 'line-through',
            )}
          >
            {a.title}
          </h1>
          <span className="font-mono text-[13px] text-weich">{formatEventRange(a.starts_at, a.ends_at)}</span>
          <span className="font-mono text-[12px] leading-[1.5] text-leise uppercase">
            {FORMAT_LABEL[a.format]}
            {place && ` · ${place}`} · Thema {topicName(a.topic_id)}
          </span>
          {/* WF-TER-09 Serie: Regel sehen, bearbeiten, beenden */}
          {a.series && (
            <button
              type="button"
              data-wf="WF-TER-09"
              onClick={() => setSheet('series')}
              className="hit flex h-8 items-center self-start rounded-2xl border border-dashed border-rand-stark px-3 font-mono text-[11px] text-leise uppercase"
            >
              Serie · {a.series.label}
              {a.series.active ? (a.is_exception ? ' · einzeln geändert' : ' ›') : ' · beendet'}
            </button>
          )}
          {a.online_url && !cancelled && (
            <a
              href={a.online_url}
              target="_blank"
              rel="noreferrer"
              className="hit self-start text-[14px] break-all"
            >
              Zum Call ↗
            </a>
          )}
        </div>

        {cancelled && (
          <div className="rounded-[14px] border border-rot-rand bg-rot-flaeche px-3.5 py-3 text-[14px] leading-normal">
            Abgesagt. Alle mit Zusage und ohne Antwort wurden benachrichtigt.
          </div>
        )}

        {/* WF-TER-03 Zu-/Absage im Detail */}
        <div className="flex flex-col gap-3 rounded-2xl border border-linie bg-flaeche px-4 py-3.5">
          <span className="label-mono">Kommst du?</span>
          <div
            className={cx('grid grid-cols-2 gap-2', !answerable && 'pointer-events-none opacity-40')}
            inert={!answerable}
          >
            <button
              type="button"
              data-wf="WF-TER-03"
              onClick={() => rsvp(a, 'ja')}
              aria-pressed={a.my_answer === 'ja'}
              className={cx(rsvpButton(a.my_answer === 'ja', 'ja'), 'h-11 rounded-[22px] text-[15px]')}
            >
              Komme
            </button>
            <button
              type="button"
              data-wf="WF-TER-03"
              onClick={() => rsvp(a, 'nein')}
              aria-pressed={a.my_answer === 'nein'}
              className={cx(rsvpButton(a.my_answer === 'nein', 'nein'), 'h-11 rounded-[22px] text-[15px]')}
            >
              Komme nicht
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {groups.map(([label, color, ids]) => (
              <div key={label} className="flex items-center gap-3">
                <span className={cx('w-[92px] flex-none font-mono text-[11px] uppercase', color)}>
                  {label} · {ids.length}
                </span>
                <span className="flex flex-wrap gap-1">
                  {ids.map((id) => (
                    <Avatar key={id} member={memberById.get(id)} size={26} />
                  ))}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* WF-TER-07 Aufgaben am Termin */}
        <div className="flex flex-col gap-2">
          <span className="label-mono">Aufgaben zum Termin · {a.tasks.length}</span>
          {a.tasks.map((t) => (
            <Link
              key={t.id}
              to={`/aufgaben/${t.id}`}
              className="flex min-h-11 items-center gap-2.5 rounded-xl border border-linie bg-flaeche px-3 py-1.5 text-text no-underline"
            >
              <span
                className="size-2 flex-none rounded-full"
                style={{ background: TASK_STATUS_COLOR[t.status] }}
              />
              <span className="flex-1 text-[14px]">{t.title}</span>
              {t.assignee_ids.length ? (
                <span className="flex">
                  {t.assignee_ids.map((id) => (
                    <Avatar key={id} member={memberById.get(id)} size={24} className="-ml-1" />
                  ))}
                </span>
              ) : (
                <span className="label-mono">{TASK_STATUS_LABEL[t.status]}</span>
              )}
            </Link>
          ))}
          <button
            type="button"
            data-wf="WF-TER-07"
            onClick={() => setSheet('task')}
            className="flex h-11 items-center justify-center rounded-xl border border-dashed border-rand-stark text-[14px] text-leise"
          >
            + Aufgabe zum Termin
          </button>
        </div>

        {/* F-WIS-05 Dokumente am Termin */}
        <LinkedDocuments
          wf="WF-WIS-06"
          target={{ type: 'appointment', id: a.id, kind: 'Termin', name: a.title }}
          documents={documents}
        />

        {/* WF-TER-06 „Hat stattgefunden“ + Teilnahme – erst nach Beginn */}
        {!cancelled && !a.is_plenum && (
          <div className="flex flex-col gap-2.5">
            <span className="label-mono">Nach dem Termin</span>
            {planned && !canMarkHappened(a, now) && (
              <>
                <button
                  type="button"
                  data-wf="WF-TER-06"
                  disabled
                  className="h-11 rounded-[22px] bg-erhoeht text-[15px] font-semibold text-leise"
                >
                  Hat stattgefunden
                </button>
                <span className="text-[13px] text-leise">Möglich ab {whenText(a.starts_at)}.</span>
              </>
            )}
            {(canMarkHappened(a, now) || happened) && (
              <>
                <span className="text-[13px] text-leise">
                  {happened
                    ? `Hat stattgefunden · ${a.attendee_ids.length} waren da. Korrekturen bleiben möglich.`
                    : 'Wer war da? Aus den Zusagen vorbefüllt.'}
                </span>
                <div role="group" aria-label="Teilnahme" className="flex flex-wrap gap-2">
                  {activeMembers.map((m) => {
                    const on = happened ? a.attendee_ids.includes(m.id) : present.includes(m.id);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        data-wf="WF-TER-06"
                        aria-pressed={on}
                        aria-label={`${m.display_name} war da`}
                        onClick={() =>
                          happened
                            ? void act(() => api.setAttendee(a.id, m.id, !on), { success: 'Gespeichert' })
                            : setHere(on ? present.filter((id) => id !== m.id) : [...present, m.id])
                        }
                        className={cx(
                          'hit h-9 min-w-11 rounded-[18px] border px-2.5 font-mono text-[12px] font-semibold',
                          on ? 'border-gruen bg-gruen text-grund' : 'border-rand-stark text-weich',
                        )}
                      >
                        {m.short}
                      </button>
                    );
                  })}
                </div>
                {!happened && (
                  <button
                    type="button"
                    data-wf="WF-TER-06"
                    onClick={() =>
                      void act(() => api.markAppointmentHappened(a.id, present, latest.current), {
                        subject: 'diesen Termin',
                        success: 'Als stattgefunden gespeichert',
                        undo: (r) => r.undo_token,
                      })
                    }
                    className="h-11 rounded-[22px] bg-geplant text-[15px] font-semibold text-grund"
                  >
                    Hat stattgefunden · {present.length} da
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* unten fixierte Aktionen */}
      {!cancelled && (
        <div className="sticky bottom-0 z-10 flex flex-none gap-2.5 border-t border-linie bg-nav px-4 pt-3 pb-[calc(18px+env(safe-area-inset-bottom,0px))]">
          {/* WF-TER-04 Bearbeiten / verschieben */}
          <button
            type="button"
            data-wf="WF-TER-04"
            onClick={() => setSheet('edit')}
            className="h-11 flex-1 rounded-[22px] border border-rand-stark text-[15px] text-text"
          >
            Bearbeiten
          </button>
          {/* WF-TER-05 Absagen – nur im Status geplant */}
          {planned && (
            <button
              type="button"
              data-wf="WF-TER-05"
              onClick={() => setSheet('cancel')}
              className="h-11 flex-1 rounded-[22px] border border-rot-rand text-[15px] text-rot-hell"
            >
              Absagen
            </button>
          )}
        </div>
      )}

      {sheet === 'edit' && (
        <AppointmentFormSheet key={a.version} appointment={a} onClose={() => setSheet(null)} />
      )}
      {sheet === 'series' && a.series && (
        <SeriesSheet seriesId={a.series.id} onClose={() => setSheet(null)} />
      )}
      {sheet === 'task' && (
        <TaskCreateSheet appointmentId={a.id} wf="WF-TER-07" onClose={() => setSheet(null)} />
      )}
      {sheet === 'cancel' && (
        <ConfirmDialog label="Termin absagen" wf="WF-TER-05" onClose={() => setSheet(null)}>
          <h2 className="m-0 text-[20px] leading-[1.25] font-bold">{a.title} absagen?</h2>
          <span className="text-[15px] leading-normal text-weich">
            Alle mit Zusage und ohne Antwort bekommen eine Nachricht. Eine Markierung „Fürs Plenum“ wird
            entfernt.
          </span>
          <button
            type="button"
            data-wf="WF-TER-05"
            autoFocus
            onClick={() => {
              setSheet(null);
              void act(() => api.cancelAppointment(a.id, latest.current), {
                subject: 'diesen Termin',
                success: 'Abgesagt – Benachrichtigung geht raus',
              });
            }}
            className="h-12 rounded-3xl bg-rot text-[15px] font-bold text-grund"
          >
            Absagen und benachrichtigen
          </button>
          <GhostButton onClick={() => setSheet(null)}>Doch nicht</GhostButton>
        </ConfirmDialog>
      )}
    </div>
  );
}
