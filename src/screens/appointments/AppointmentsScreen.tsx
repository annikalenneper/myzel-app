// S-30 Termine · P3 – am Desktop mit der Detailansicht daneben
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ListDetailLayout } from '../../app/AppShell';
import { BarOffset, useFeedback } from '../../app/feedback';
import { useMe } from '../../app/session';
import { useData } from '../../app/useData';
import { api } from '../../data';
import type { AppointmentListItem } from '../../data/api';
import { formatTime } from '../../shared/format';
import { appointmentEnd, canRsvp, FORMAT_LABEL } from '../../shared/rules/appointments';
import type { RsvpAnswer } from '../../shared/schema';
import { Avatar, cx, ListSkeleton, LoadError, Pill } from '../../ui/bits';
import { IconPlus } from '../../ui/icons';
import { SearchButton } from '../../ui/SearchOverlay';
import { AppointmentDetail } from './AppointmentDetail';
import { AppointmentFormSheet } from './AppointmentFormSheet';

const WEEKDAYS = ['SO', 'MO', 'DI', 'MI', 'DO', 'FR', 'SA'] as const;
const MONTHS = [
  'JANUAR',
  'FEBRUAR',
  'MÄRZ',
  'APRIL',
  'MAI',
  'JUNI',
  'JULI',
  'AUGUST',
  'SEPTEMBER',
  'OKTOBER',
  'NOVEMBER',
  'DEZEMBER',
] as const;

/** „19:00 · ONLINE · LINK IM TERMIN“ / „10:00–16:00 · VOR ORT · LAGER“ / „18:30 · HYBRID · LAGER + CALL“ */
export function appointmentMeta(a: AppointmentListItem): string {
  const start = formatTime(new Date(a.starts_at));
  const time = a.ends_at ? `${start}–${formatTime(new Date(a.ends_at))}` : start;
  const place =
    a.format === 'online'
      ? 'Link im Termin'
      : a.format === 'hybrid'
        ? `${a.location} + Call`
        : (a.location ?? '');
  return `${time} · ${FORMAT_LABEL[a.format]} · ${place}`;
}

export function AppointmentsScreen() {
  const { appointmentId } = useParams();
  return (
    <ListDetailLayout
      detailOpen={!!appointmentId}
      list={<AppointmentList selectedId={appointmentId ?? null} />}
      detail={appointmentId ? <AppointmentDetail key={appointmentId} appointmentId={appointmentId} /> : null}
    />
  );
}

/** WF-TER-03: Zu-/Absage; ein zweiter Tipp nimmt die Antwort zurück */
export function useRsvp() {
  const { run } = useFeedback();
  return (a: Pick<AppointmentListItem, 'id' | 'title' | 'my_answer'>, answer: RsvpAnswer) => {
    const next = a.my_answer === answer ? null : answer;
    void run(() => api.setRsvp(a.id, next), {
      success:
        next === 'ja'
          ? `Zugesagt: ${a.title}`
          : next === 'nein'
            ? `Abgesagt: ${a.title}`
            : 'Antwort zurückgenommen',
      undo: (r) => r.undo_token,
    });
  };
}

export const rsvpButton = (on: boolean, kind: RsvpAnswer) =>
  cx(
    'hit h-[34px] flex-none rounded-[17px] border px-3 text-[13px] font-medium whitespace-nowrap',
    on
      ? kind === 'ja'
        ? 'border-gruen bg-gruen text-grund'
        : 'border-text bg-text text-grund'
      : 'border-rand text-weich',
  );

function AppointmentList({ selectedId }: { selectedId: string | null }) {
  const me = useMe();
  const { barVisible } = useFeedback();
  const rsvp = useRsvp();
  const { data: appointments, error, reload } = useData('appointments', () => api.listAppointments());
  const { data: types } = useData('appointment-types', () => api.listAppointmentTypes());
  const [typeId, setTypeId] = useState<string | null>(null);
  const [past, setPast] = useState(false);
  const [creating, setCreating] = useState(false);
  const [now] = useState(() => new Date());

  const upcoming = (appointments ?? []).filter((a) => appointmentEnd(a) >= now.getTime());
  const shown = (appointments ?? [])
    .filter((a) => appointmentEnd(a) < now.getTime() === past)
    .filter((a) => !typeId || a.type_id === typeId)
    .sort((a, b) => (new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()) * (past ? -1 : 1));
  const open = upcoming.filter((a) => canRsvp(a, now) && !a.my_answer).length;

  // WF-TER-01: nach Monat gruppiert
  const months: { name: string; items: AppointmentListItem[] }[] = [];
  for (const a of shown) {
    const d = new Date(a.starts_at);
    const name = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    if (months.at(-1)?.name === name) months.at(-1)!.items.push(a);
    else months.push({ name, items: [a] });
  }

  return (
    <div className="flex min-h-dvh flex-col lg:min-h-0">
      <BarOffset px={92} />
      <div className="flex flex-col gap-4 px-5 pt-5">
        <div className="flex items-center lg:justify-end">
          <img src="/myzel-logo.png" alt="Myzel" className="h-11 w-[66px] object-contain lg:hidden" />
          <span className="flex-1" />
          <SearchButton first="termine" />
          <Link to="/profil" aria-label="Profil" className="hit ml-2.5 flex size-10 no-underline">
            <Avatar member={me} size={40} fontSize={13} />
          </Link>
        </div>
        <div className="flex flex-col gap-1">
          <h1 className="m-0 text-[32px] leading-[1.15] font-bold tracking-[-1px]">Termine</h1>
          <div className="font-mono text-[12px] text-leise">
            {appointments ? `${open} OHNE DEINE ANTWORT` : ' '}
          </div>
        </div>
        {/* WF-TER-01 Filter Terminart – speichert nichts */}
        <div className="no-scrollbar -mx-5 -mt-1 flex gap-2 overflow-x-auto px-5 pt-1 pb-1">
          <Pill data-wf="WF-TER-01" on={!typeId} onClick={() => setTypeId(null)}>
            Alle
          </Pill>
          {(types ?? [])
            .filter((t) => !t.archived_at || t.id === typeId)
            .map((t) => (
              <Pill
                key={t.id}
                data-wf="WF-TER-01"
                on={typeId === t.id}
                onClick={() => setTypeId(typeId === t.id ? null : t.id)}
              >
                {t.label}
              </Pill>
            ))}
          <Pill data-wf="WF-TER-01" on={past} onClick={() => setPast(!past)}>
            Vergangene
          </Pill>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 px-5 pt-3.5 pb-[180px] lg:pb-28">
        {!appointments && !error && <ListSkeleton />}
        {!appointments && error && <LoadError message={error.message} onRetry={reload} />}
        {months.map((m) => (
          <section key={m.name} className="flex flex-col gap-3" aria-label={m.name}>
            <h2 className="label-mono m-0 pt-1 font-normal">{m.name}</h2>
            {m.items.map((a) => {
              const d = new Date(a.starts_at);
              const cancelled = a.status === 'abgesagt';
              return (
                <article
                  key={a.id}
                  className={cx(
                    'relative flex gap-3.5 rounded-2xl border border-linie px-4 py-3.5',
                    a.id === selectedId ? 'bg-erhoeht' : 'bg-flaeche',
                  )}
                >
                  <div className="flex h-[58px] w-[52px] flex-none flex-col items-center justify-center gap-0.5 rounded-xl bg-grund">
                    <span className="font-mono text-[11px] text-leise">{WEEKDAYS[d.getDay()]}</span>
                    <span className="text-[22px] leading-[1.2] font-bold">
                      {String(d.getDate()).padStart(2, '0')}
                    </span>
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5 pr-9">
                    <span className="label-mono flex items-center gap-1.5">
                      <span className="size-2 flex-none rounded-full" style={{ background: a.type_color }} />
                      {a.type_label}
                      {a.series && <span> · Serie</span>}
                      {cancelled && <span className="text-rot"> · Abgesagt</span>}
                    </span>
                    <Link
                      to={`/termine/${a.id}`}
                      className="hit text-[17px] leading-[1.3] font-semibold text-text no-underline"
                    >
                      <span className={cx(cancelled && 'line-through')}>{a.title}</span>
                    </Link>
                    <span className="font-mono text-[12px] leading-[1.4] text-leise uppercase">
                      {appointmentMeta(a)}
                    </span>
                    {/* WF-TER-03 Zu-/Absage auf der Karte */}
                    <div className="flex items-center gap-2 pt-1">
                      {canRsvp(a, now) && (
                        <>
                          <button
                            type="button"
                            data-wf="WF-TER-03"
                            onClick={() => rsvp(a, 'ja')}
                            aria-pressed={a.my_answer === 'ja'}
                            className={rsvpButton(a.my_answer === 'ja', 'ja')}
                          >
                            Komme
                          </button>
                          <button
                            type="button"
                            data-wf="WF-TER-03"
                            onClick={() => rsvp(a, 'nein')}
                            aria-pressed={a.my_answer === 'nein'}
                            className={rsvpButton(a.my_answer === 'nein', 'nein')}
                          >
                            Komme nicht
                          </button>
                        </>
                      )}
                      <span className="flex-1" />
                      <span
                        className="flex-none font-mono text-[12px] whitespace-nowrap text-leise"
                        aria-label={`${a.yes_count} ${a.yes_count === 1 ? 'Zusage' : 'Zusagen'}`}
                      >
                        {a.yes_count} ✓
                      </span>
                    </div>
                  </div>
                </article>
              );
            })}
          </section>
        ))}
        {/* WF-ALL-05 Leerzustand */}
        {appointments && shown.length === 0 && (
          <div data-wf="WF-ALL-05" className="flex flex-col items-center gap-3 px-4 py-10 text-center">
            <span className="text-[14px] leading-normal text-leise">
              {past
                ? 'Noch keine vergangenen Termine.'
                : typeId
                  ? 'Keine Termine dieser Art geplant.'
                  : 'Noch keine Termine geplant. Leg den nächsten an.'}
            </span>
            {!past && (
              <button
                type="button"
                data-wf="WF-TER-02"
                onClick={() => setCreating(true)}
                className="hit flex h-[42px] items-center rounded-[21px] border border-rand-stark px-[18px] text-[14px] text-text"
              >
                + Termin
              </button>
            )}
          </div>
        )}
      </div>

      {/* WF-TER-02 Termin anlegen */}
      {!barVisible && (
        <button
          type="button"
          data-wf="WF-TER-02"
          onClick={() => setCreating(true)}
          aria-label="Termin anlegen"
          className="bg-marke fixed right-5 bottom-[calc(96px+env(safe-area-inset-bottom,0px))] z-10 flex size-[58px] items-center justify-center rounded-full text-grund shadow-[0_8px_24px_rgba(157,110,240,0.45)] lg:right-auto lg:bottom-6 lg:left-[562px]"
        >
          <IconPlus size={26} />
        </button>
      )}
      {creating && (
        <AppointmentFormSheet
          onClose={() => setCreating(false)}
          onCreated={() => {
            setTypeId(null);
            setPast(false);
          }}
        />
      )}
    </div>
  );
}
