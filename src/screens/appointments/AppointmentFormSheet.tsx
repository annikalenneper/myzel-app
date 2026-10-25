// S-31 Termin anlegen (WF-TER-02; mit Terminart Plenum = WF-PLE-01; als Serie WF-TER-09) und
// bearbeiten/verschieben (WF-TER-04; Serientermin: nur dieser oder die ganze Serie, WF-TER-10)
import { useState } from 'react';
import { useFeedback } from '../../app/feedback';
import { useLookups } from '../../app/lookups';
import { useData } from '../../app/useData';
import { api } from '../../data';
import type { AppointmentDetail } from '../../data/api';
import { fromLocalInput, toLocalInput } from '../../shared/format';
import { FORMAT_LABEL } from '../../shared/rules/appointments';
import { APPOINTMENT_FORMATS, type AppointmentFormat } from '../../shared/schema';
import { cx, FieldError, LightButton, Pill, PrimaryButton } from '../../ui/bits';
import { DateTimeTile } from '../../ui/DateTimeTile';
import { DateTile } from '../../ui/DateTile';
import { Sheet } from '../../ui/Sheet';
import { RepeatSelect, SERIES_HINT, SeriesSheet } from './SeriesSheet';

export function AppointmentFormSheet({
  appointment,
  onClose,
  onCreated,
}: {
  /** vorhandenen Termin bearbeiten; ohne: neu anlegen */
  appointment?: AppointmentDetail;
  onClose: () => void;
  onCreated?: (id: string) => void;
}) {
  const { run } = useFeedback();
  const { topicName, events } = useLookups();
  const { data: allTypes } = useData('appointment-types', () => api.listAppointmentTypes());
  const types = (allTypes ?? []).filter((t) => !t.archived_at);
  const wf = appointment ? 'WF-TER-04' : 'WF-TER-02';

  const [typeId, setTypeId] = useState<string | null>(appointment?.type_id ?? null);
  const [title, setTitle] = useState(appointment?.title ?? '');
  const [openedAt] = useState(() => Date.now());
  const [titleTouched, setTitleTouched] = useState(!!appointment);
  const [startsAt, setStartsAt] = useState(toLocalInput(appointment?.starts_at ?? null));
  const [endsAt, setEndsAt] = useState(toLocalInput(appointment?.ends_at ?? null));
  const [format, setFormat] = useState<AppointmentFormat>(appointment?.format ?? 'vor_ort');
  const [location, setLocation] = useState(appointment?.location ?? '');
  const [onlineUrl, setOnlineUrl] = useState(appointment?.online_url ?? '');
  const [eventId, setEventId] = useState(appointment?.event_id ?? '');
  const [error, setError] = useState<{ field: string | null; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  /** [P6] beim Anlegen: Regel der Serie, leer = einmalig */
  const [repeat, setRepeat] = useState('');
  const [until, setUntil] = useState('');
  /** [P6] Serientermin bearbeiten: nur diesen oder die ganze Serie (WF-TER-10) */
  const [scope, setScope] = useState<'one' | 'series'>('one');
  const isSeries = !appointment && !!repeat;
  // eine Serie hat Uhrzeiten, kein mehrtägiges Ende
  const multiDay = isSeries && !!endsAt && endsAt.slice(0, 10) !== startsAt.slice(0, 10);

  const type = (allTypes ?? []).find((t) => t.id === typeId);
  const needsPlace = format !== 'online';
  const needsLink = format !== 'vor_ort';
  const endBeforeStart = !!startsAt && !!endsAt && new Date(endsAt) <= new Date(startsAt);
  const blocked = endBeforeStart || multiDay;
  const fieldError = (field: string) => error?.field === field && error.message;

  /** Die Terminart belegt Titel, Format und Ort vor – im Einzelfall änderbar (3.6) */
  const pickType = (id: string) => {
    const next = types.find((t) => t.id === id)!;
    setTypeId(id);
    setFormat(next.default_format);
    setLocation(next.default_location ?? '');
    if (!titleTouched) setTitle(next.label);
    setError(null);
  };

  const verb = appointment ? 'speichern' : 'anlegen';
  const missing = !typeId
    ? `Terminart wählen, dann ${verb}`
    : !title.trim()
      ? `Titel eingeben, dann ${verb}`
      : !startsAt
        ? `Beginn wählen, dann ${verb}`
        : needsPlace && !location.trim()
          ? `Ort angeben, dann ${verb}`
          : needsLink && !onlineUrl.trim()
            ? `Link zum Call angeben, dann ${verb}`
            : null;

  // Zeit oder Ort geändert: Zusagen und alle ohne Antwort bekommen eine Nachricht (WF-TER-04)
  const moved =
    !!appointment &&
    appointment.status === 'geplant' &&
    (startsAt !== toLocalInput(appointment.starts_at) ||
      endsAt !== toLocalInput(appointment.ends_at) ||
      format !== appointment.format ||
      (needsPlace && location.trim() !== (appointment.location ?? '')) ||
      (needsLink && onlineUrl.trim() !== (appointment.online_url ?? '')));

  // nachgetragene Termine laden niemanden ein
  const startIso = fromLocalInput(startsAt);
  const inPast = !!startIso && new Date(startIso).getTime() <= openedAt;

  const submit = async () => {
    if (missing || blocked || saving) return;
    setSaving(true);
    setError(null);
    if (isSeries) {
      const created = await run(
        () =>
          api.createSeries({
            type_id: typeId!,
            title,
            format,
            location,
            online_url: onlineUrl,
            start_time: startsAt.slice(11, 16),
            end_time: endsAt ? endsAt.slice(11, 16) : null,
            rrule: repeat,
            valid_from: startsAt.slice(0, 10),
            valid_until: until || null,
          }),
        {
          success: (r) => `Serie angelegt · ${r.created} ${r.created === 1 ? 'Termin' : 'Termine'}`,
          onInvalid: (e) => setError({ field: e.field, message: e.message }),
        },
      );
      setSaving(false);
      if (created) onClose();
      return;
    }
    const input = {
      type_id: typeId!,
      title,
      starts_at: fromLocalInput(startsAt) ?? '',
      ends_at: fromLocalInput(endsAt),
      format,
      location,
      online_url: onlineUrl,
      event_id: eventId || null,
    };
    const onInvalid = (e: { field: string | null; message: string }) =>
      setError({ field: e.field, message: e.message });
    if (appointment) {
      const result = await run(
        () => api.updateAppointment(appointment.id, { ...input, version: appointment.version }),
        {
          subject: 'diesen Termin',
          ownInput: `${title} · ${startsAt.replace('T', ' ')}${needsPlace ? ` · ${location}` : ''}`,
          success: (r) => (r.notified ? 'Geändert – Benachrichtigung geht raus' : 'Gespeichert'),
          onInvalid,
        },
      );
      if (result) onClose();
    } else {
      const created = await run(() => api.createAppointment(input), {
        success: inPast ? 'Termin nachgetragen' : 'Termin angelegt – Einladung geht raus',
        onInvalid,
      });
      if (created) {
        onClose();
        onCreated?.(created.id);
      }
    }
    setSaving(false);
  };

  const input =
    'h-[46px] rounded-xl border border-rand bg-grund px-3.5 font-sans text-[16px] text-text normal-case';
  if (appointment?.series_id && scope === 'series')
    return <SeriesSheet seriesId={appointment.series_id} onClose={onClose} />;
  return (
    <Sheet title={appointment ? 'Termin bearbeiten' : 'Neuer Termin'} onClose={onClose} wf={wf} closeButton>
      <form
        noValidate
        className="flex flex-col gap-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {/* WF-TER-10 Serientermin: nur diesen Termin ändern (wird zur Ausnahme) oder die ganze Serie */}
        {appointment?.series_id && appointment.series?.active && (
          <div
            role="group"
            aria-label="Was ändern?"
            className="grid grid-cols-2 gap-1 rounded-xl border border-linie bg-grund p-1"
          >
            {(
              [
                ['one', 'Nur dieser Termin'],
                ['series', 'Ganze Serie'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                data-wf="WF-TER-10"
                aria-pressed={scope === k}
                onClick={() => setScope(k)}
                className={cx(
                  'hit h-9 rounded-lg text-[14px]',
                  scope === k ? 'bg-text font-semibold text-grund' : 'text-weich',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {appointment?.series_id && (
          <span className="-mt-1.5 text-[13px] leading-[1.4] text-leise">
            {appointment.series?.active
              ? 'Nur dieser Termin: Er wird zur Ausnahme, spätere Änderungen der Serie lassen ihn in Ruhe.'
              : 'Die Serie ist beendet – Änderungen gelten nur für diesen Termin.'}
          </span>
        )}
        {!appointment && (
          <div className="flex flex-col gap-2">
            <span id="termin-art" className="label-mono">
              Terminart *
            </span>
            <div role="group" aria-labelledby="termin-art" className="flex flex-wrap gap-2">
              {types.map((t) => (
                <Pill
                  key={t.id}
                  data-wf={wf}
                  on={typeId === t.id}
                  onClick={() => pickType(t.id)}
                  className="flex items-center gap-2"
                >
                  <span className="size-2 rounded-full" style={{ background: t.color }} />
                  {t.label}
                </Pill>
              ))}
            </div>
            {type && (
              <span className="label-mono">
                Vorbelegt: Thema {topicName(type.default_topic_id)} · Format · Ort – änderbar
              </span>
            )}
            <FieldError>{fieldError('type_id')}</FieldError>
          </div>
        )}
        {!appointment && type?.has_plenum_features && (
          // WF-PLE-01 Plenum anlegen
          <span
            data-wf="WF-PLE-01"
            className="rounded-[14px] border border-rand bg-grund px-3.5 py-2.5 text-[13px] leading-normal text-weich"
          >
            Plenum: Ins Ergebnis kommt alles, was während des Plenums angelegt oder geändert wird. Ein
            Drive-Protokoll ist nicht nötig.
          </span>
        )}
        <label className="label-mono flex flex-col gap-1.5">
          Titel *
          <input
            type="text"
            data-wf={wf}
            value={title}
            maxLength={200}
            onChange={(e) => {
              setTitle(e.target.value);
              setTitleTouched(true);
            }}
            className={input}
          />
        </label>
        <FieldError>{fieldError('title')}</FieldError>
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2.5">
            <DateTimeTile
              id="termin-beginn"
              label="Beginn *"
              wf={wf}
              value={startsAt}
              onChange={(v) => {
                // eine Regel gilt für den gewählten Tag; ein anderer Tag braucht eine neue Wahl
                if (repeat && v.slice(0, 10) !== startsAt.slice(0, 10)) setRepeat('');
                setStartsAt(v);
              }}
            />
            <DateTimeTile
              id="termin-ende"
              label="Ende"
              wf={wf}
              value={endsAt}
              onChange={setEndsAt}
              invalid={endBeforeStart}
            />
          </div>
          <FieldError>
            {endBeforeStart
              ? 'Das Ende muss nach dem Beginn liegen.'
              : multiDay
                ? 'Bei einer Serie endet der Termin am selben Tag.'
                : fieldError('starts_at') || fieldError('ends_at') || fieldError('end_time')}
          </FieldError>
        </div>
        {/* WF-TER-09 Serie anlegen: Auswahl passend zum gewählten Tag */}
        {!appointment && (
          <RepeatSelect
            firstDate={startsAt.slice(0, 10)}
            value={repeat}
            onChange={setRepeat}
            wf="WF-TER-09"
            allowOnce
          />
        )}
        {isSeries && (
          <>
            <DateTile
              label="Bis (optional)"
              value={until}
              onChange={setUntil}
              wf="WF-TER-09"
              surface="bg-grund"
            />
            <FieldError>{fieldError('valid_until') || fieldError('rrule')}</FieldError>
          </>
        )}
        <div className="flex flex-col gap-2">
          <span id="termin-format" className="label-mono">
            Format *
          </span>
          <div
            role="group"
            aria-labelledby="termin-format"
            className="grid grid-cols-3 gap-1 rounded-xl border border-linie bg-grund p-1"
          >
            {APPOINTMENT_FORMATS.map((f) => (
              <button
                key={f}
                type="button"
                data-wf={wf}
                aria-pressed={format === f}
                onClick={() => setFormat(f)}
                className={cx(
                  'hit h-9 rounded-lg text-[14px]',
                  format === f ? 'bg-text font-semibold text-grund' : 'text-weich',
                )}
              >
                {FORMAT_LABEL[f]}
              </button>
            ))}
          </div>
        </div>
        {needsPlace && (
          <label className="label-mono flex flex-col gap-1.5">
            Ort *
            <input
              type="text"
              data-wf={wf}
              value={location}
              placeholder="z. B. Lager"
              onChange={(e) => setLocation(e.target.value)}
              className={input}
            />
          </label>
        )}
        <FieldError>{fieldError('location')}</FieldError>
        {needsLink && (
          <label className="label-mono flex flex-col gap-1.5">
            Link zum Call *
            <input
              type="url"
              data-wf={wf}
              value={onlineUrl}
              placeholder="https://"
              onChange={(e) => {
                setOnlineUrl(e.target.value);
                setError(null);
              }}
              className={input}
            />
          </label>
        )}
        <FieldError>{fieldError('online_url')}</FieldError>
        {!isSeries && (
          <label className="flex min-h-12 items-center gap-2 rounded-xl border border-linie bg-grund px-3.5">
            <span className="label-mono flex-none">Veranstaltung ·</span>
            <select
              data-wf={wf}
              value={eventId}
              onChange={(e) => setEventId(e.target.value)}
              className="h-11 min-w-0 flex-1 bg-grund text-[14px] text-text"
            >
              <option value="">keine</option>
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <FieldError>
          {error &&
            ![
              'type_id',
              'title',
              'starts_at',
              'ends_at',
              'end_time',
              'valid_until',
              'rrule',
              'location',
              'online_url',
            ].includes(error.field ?? '') &&
            error.message}
        </FieldError>
        {moved && (
          <span className="text-[13px] leading-[1.4] text-bernstein">
            Zeit oder Ort geändert: {appointment.yes_ids.length}{' '}
            {appointment.yes_ids.length === 1 ? 'Zusage' : 'Zusagen'} und {appointment.open_ids.length} ohne
            Antwort bekommen eine Nachricht.
          </span>
        )}
        {!appointment && (
          <span className="text-[13px] leading-[1.4] text-leise">
            {isSeries
              ? SERIES_HINT
              : inPast
                ? 'Liegt in der Vergangenheit: Der Termin wird nachgetragen, niemand bekommt eine Einladung.'
                : 'Alle aktiven Mitglieder bekommen eine Einladung und können zu- oder absagen.'}
          </span>
        )}
        {appointment ? (
          <LightButton type="submit" data-wf={wf} disabled={!!missing || blocked || saving}>
            {missing ?? 'Speichern'}
          </LightButton>
        ) : (
          <PrimaryButton
            type="submit"
            data-wf={isSeries ? 'WF-TER-09' : wf}
            disabled={!!missing || blocked || saving}
          >
            {missing ?? (isSeries ? 'Serie anlegen' : inPast ? 'Nachtragen' : 'Anlegen und einladen')}
          </PrimaryButton>
        )}
      </form>
    </Sheet>
  );
}
