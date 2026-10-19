// WF-TER-09 Serie bearbeiten oder beenden · P6 (F-TER-03). Änderungen wirken nur auf künftige Termine, die nicht
// einzeln geändert wurden; Zusagen bleiben erhalten. Die Auswahl „Wiederholen“ nutzt auch das Anlegen (S-31).
import { useState } from 'react';
import { useFeedback } from '../../app/feedback';
import { useData } from '../../app/useData';
import { api } from '../../data';
import type { SeriesDetail } from '../../data/api';
import { formatDateWithWeekday } from '../../shared/format';
import { toIsoDate } from '../../shared/rules/due';
import { FORMAT_LABEL } from '../../shared/rules/appointments';
import { ruleChoices, ruleLabel, SERIES_HORIZON_MONTHS, SERIES_INVITE_DAYS } from '../../shared/rules/series';
import { APPOINTMENT_FORMATS, type AppointmentFormat } from '../../shared/schema';
import { cx, FieldError, GhostButton, LightButton, ListSkeleton } from '../../ui/bits';
import { DateTile } from '../../ui/DateTile';
import { Sheet } from '../../ui/Sheet';

const WF = 'WF-TER-09';
export const SERIES_HINT = `Termine entstehen ${SERIES_HORIZON_MONTHS} Monate im Voraus; eingeladen wird jeweils etwa ${SERIES_INVITE_DAYS / 7} Wochen vorher.`;

/** „Wiederholen“: verständliche Auswahl passend zum ersten Termin (F-TER-02) */
export function RepeatSelect({
  firstDate,
  value,
  onChange,
  wf,
  allowOnce,
}: {
  /** YYYY-MM-DD */
  firstDate: string;
  value: string;
  onChange: (rrule: string) => void;
  wf: string;
  /** beim Anlegen: „Nicht wiederholen“ (leerer Wert) */
  allowOnce?: boolean;
}) {
  const choices = firstDate ? ruleChoices(firstDate) : [];
  // eine gespeicherte Regel bleibt wählbar, auch wenn sie nicht zum Datum passt
  if (value && !choices.some((c) => c.rrule === value))
    choices.unshift({ rrule: value, label: ruleLabel(value) });
  return (
    <label className="flex min-h-12 items-center gap-2 rounded-xl border border-linie bg-grund px-3.5">
      <span className="label-mono flex-none">Wiederholen ·</span>
      <select
        data-wf={wf}
        aria-label="Wiederholen"
        value={value}
        disabled={!firstDate}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 min-w-0 flex-1 bg-grund text-[14px] text-text"
      >
        {allowOnce && <option value="">nicht wiederholen</option>}
        {choices.map((c) => (
          <option key={c.rrule} value={c.rrule}>
            {c.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function TimeField({
  label,
  value,
  onChange,
  wf,
  invalid,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  wf: string;
  invalid?: boolean;
}) {
  return (
    <label className="label-mono flex flex-col gap-1.5">
      {label}
      <input
        type="time"
        data-wf={wf}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cx(
          'h-[46px] rounded-xl border bg-grund px-3.5 font-sans text-[16px] text-text',
          invalid ? 'border-rot' : 'border-rand',
        )}
      />
    </label>
  );
}

export function SeriesSheet({ seriesId, onClose }: { seriesId: string; onClose: () => void }) {
  const { data: series } = useData(`series:${seriesId}`, () => api.getSeries(seriesId));
  return (
    <Sheet title="Serie bearbeiten" onClose={onClose} wf={WF} closeButton>
      {series ? <SeriesForm key={series.version} series={series} onClose={onClose} /> : <ListSkeleton />}
    </Sheet>
  );
}

function SeriesForm({ series, onClose }: { series: SeriesDetail; onClose: () => void }) {
  const { run } = useFeedback();
  const [title, setTitle] = useState(series.title);
  const [start, setStart] = useState(series.start_time);
  const [end, setEnd] = useState(series.end_time ?? '');
  const [rrule, setRrule] = useState(series.rrule);
  const [until, setUntil] = useState(series.valid_until ?? '');
  const [format, setFormat] = useState<AppointmentFormat>(series.format);
  const [location, setLocation] = useState(series.location ?? '');
  const [onlineUrl, setOnlineUrl] = useState(series.online_url ?? '');
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<{ field: string | null; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const needsPlace = format !== 'online';
  const needsLink = format !== 'vor_ort';
  const endBeforeStart = !!end && end <= start;
  const fieldError = (field: string) => error?.field === field && error.message;
  const exceptions = series.upcoming.filter((u) => u.is_exception).length;
  // beim Beenden entfällt, was ab morgen kommt und nicht einzeln geändert wurde (ein Termin von heute bleibt)
  const today = toIsoDate(new Date());
  // wie der Server: eine noch nicht begonnene Serie behält ihren ersten Tag
  const lastKept = series.valid_from > today ? series.valid_from : today;
  const dropping = series.upcoming.filter(
    (u) => !u.is_exception && toIsoDate(new Date(u.starts_at)) > lastKept,
  ).length;
  // Grundlage der Auswahl: der nächste Termin, der der Regel folgt – eine verschobene Ausnahme liegt evtl. woanders
  const next = series.upcoming.find((u) => !u.is_exception);
  const anchor = next ? toIsoDate(new Date(next.starts_at)) : series.valid_from;
  const missing = !title.trim()
    ? 'Titel eingeben, dann speichern'
    : !start
      ? 'Beginn wählen, dann speichern'
      : needsPlace && !location.trim()
        ? 'Ort angeben, dann speichern'
        : needsLink && !onlineUrl.trim()
          ? 'Link zum Call angeben, dann speichern'
          : null;

  const save = async () => {
    if (missing || endBeforeStart || saving) return;
    setSaving(true);
    setError(null);
    const result = await run(
      () =>
        api.updateSeries(series.id, {
          type_id: series.type_id,
          title,
          format,
          location,
          online_url: onlineUrl,
          start_time: start,
          end_time: end || null,
          rrule,
          valid_from: series.valid_from,
          valid_until: until || null,
          version: series.version,
        }),
      {
        subject: 'diese Serie',
        success: (r) => (r.notified ? 'Serie geändert – Benachrichtigung geht raus' : 'Serie gespeichert'),
        onInvalid: (e) => setError({ field: e.field, message: e.message }),
      },
    );
    setSaving(false);
    if (result) onClose();
  };

  const endNow = async () => {
    setSaving(true);
    const result = await run(() => api.endSeries(series.id, series.version), {
      subject: 'diese Serie',
      success: (r) => (r.notified ? 'Serie beendet – Absagen gehen raus' : 'Serie beendet'),
    });
    setSaving(false);
    if (result) onClose();
  };

  if (!series.active)
    return (
      <span className="text-[14px] leading-normal text-weich">
        Diese Serie ({series.label}) ist beendet
        {series.valid_until ? ` – letzter Tag ${formatDateWithWeekday(series.valid_until)}` : ''}. Es
        entstehen keine neuen Termine mehr.
      </span>
    );

  if (ending)
    return (
      <div className="flex flex-col gap-3.5">
        <span className="text-[15px] leading-normal text-weich">
          {dropping === 1 ? '1 künftiger Termin entfällt.' : `${dropping} künftige Termine entfallen.`} Wer
          schon eingeladen ist oder geantwortet hat, bekommt eine Absage.
          {exceptions > 0 && ` Einzeln geänderte Termine (${exceptions}) bleiben bestehen.`}
        </span>
        <button
          type="button"
          data-wf={WF}
          disabled={saving}
          onClick={() => void endNow()}
          className="h-12 rounded-3xl bg-rot text-[15px] font-bold text-grund"
        >
          Serie beenden
        </button>
        <GhostButton onClick={() => setEnding(false)}>Doch nicht</GhostButton>
      </div>
    );

  const input =
    'h-[46px] rounded-xl border border-rand bg-grund px-3.5 font-sans text-[16px] text-text normal-case';
  return (
    <form
      noValidate
      className="flex flex-col gap-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <span className="text-[13px] leading-[1.45] text-leise">
        Gilt für alle künftigen Termine der Serie, die nicht einzeln geändert wurden
        {exceptions > 0 ? ` (${exceptions} einzeln geändert)` : ''}. Zusagen bleiben erhalten. {SERIES_HINT}
      </span>
      <label className="label-mono flex flex-col gap-1.5">
        Titel *
        <input
          type="text"
          data-wf={WF}
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          className={input}
        />
      </label>
      <FieldError>{fieldError('title')}</FieldError>
      <RepeatSelect firstDate={anchor} value={rrule} onChange={setRrule} wf={WF} />
      <FieldError>{fieldError('rrule')}</FieldError>
      <div className="grid grid-cols-2 gap-2.5">
        <TimeField label="Beginn *" value={start} onChange={setStart} wf={WF} />
        <TimeField label="Ende" value={end} onChange={setEnd} wf={WF} invalid={endBeforeStart} />
      </div>
      <FieldError>
        {endBeforeStart
          ? 'Das Ende muss nach dem Beginn liegen.'
          : fieldError('start_time') || fieldError('end_time')}
      </FieldError>
      <div className="grid grid-cols-2 gap-2.5">
        <div className="flex flex-col gap-1.5 rounded-xl border border-linie bg-grund px-3.5 py-2.5">
          <span className="label-mono">Seit</span>
          <span className="text-[14px]">{formatDateWithWeekday(series.valid_from)}</span>
        </div>
        <DateTile label="Bis (optional)" value={until} onChange={setUntil} wf={WF} surface="bg-grund" />
      </div>
      <FieldError>{fieldError('valid_until')}</FieldError>
      <div
        role="group"
        aria-label="Format"
        className="grid grid-cols-3 gap-1 rounded-xl border border-linie bg-grund p-1"
      >
        {APPOINTMENT_FORMATS.map((f) => (
          <button
            key={f}
            type="button"
            data-wf={WF}
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
      {needsPlace && (
        <label className="label-mono flex flex-col gap-1.5">
          Ort *
          <input
            type="text"
            data-wf={WF}
            value={location}
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
            data-wf={WF}
            value={onlineUrl}
            placeholder="https://"
            onChange={(e) => setOnlineUrl(e.target.value)}
            className={input}
          />
        </label>
      )}
      <FieldError>{fieldError('online_url')}</FieldError>
      <FieldError>
        {error &&
          !['title', 'rrule', 'start_time', 'end_time', 'valid_until', 'location', 'online_url'].includes(
            error.field ?? '',
          ) &&
          error.message}
      </FieldError>
      <LightButton type="submit" data-wf={WF} disabled={!!missing || endBeforeStart || saving}>
        {missing ?? 'Für künftige Termine speichern'}
      </LightButton>
      <button
        type="button"
        data-wf={WF}
        onClick={() => setEnding(true)}
        className="hit h-11 text-[14px] text-rot-hell"
      >
        Serie beenden …
      </button>
    </form>
  );
}
