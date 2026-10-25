// S-53 Verwaltung: Terminarten · P3 · nur Admins (WF-ADM-06)
import { useState } from 'react';
import { BarOffset, useFeedback } from '../../app/feedback';
import { useLookups } from '../../app/lookups';
import { useData } from '../../app/useData';
import { api } from '../../data';
import type { AppointmentTypeWithUsage } from '../../data/api';
import { FORMAT_LABEL } from '../../shared/rules/appointments';
import { APPOINTMENT_FORMATS, TYPE_COLORS, type AppointmentFormat } from '../../shared/schema';
import { CheckBox, cx, FieldError, GhostButton, LightButton, ListSkeleton } from '../../ui/bits';
import { Sheet } from '../../ui/Sheet';
import { AdminTopBar } from './Members';

const WF = 'WF-ADM-06';
const COLOR_NAME: Record<(typeof TYPE_COLORS)[number], string> = {
  '#F062C0': 'Pink',
  '#B59AF5': 'Lavendel',
  '#8FA6FF': 'Blau',
  '#E2DCF0': 'Hell',
  '#A69FB8': 'Grau',
};

export function AppointmentTypes() {
  const { topicName } = useLookups();
  const { data: types } = useData('appointment-types', () => api.listAppointmentTypes());
  const [sheet, setSheet] = useState<{ id: string | null } | null>(null);
  const selected = sheet?.id ? (types?.find((t) => t.id === sheet.id) ?? null) : null;

  return (
    <div className="mx-auto max-w-[560px] lg:max-w-[720px]">
      <BarOffset px={24} />
      <AdminTopBar />
      <div className="flex flex-col gap-3.5 px-5 pb-24">
        <div className="flex items-center">
          <h1 className="m-0 flex-1 text-[30px] leading-[1.15] font-bold tracking-[-1px]">Terminarten</h1>
          <button
            type="button"
            data-wf={WF}
            onClick={() => setSheet({ id: null })}
            className="hit h-10 rounded-[20px] bg-geplant px-3.5 text-[14px] font-semibold text-grund"
          >
            + Terminart
          </button>
        </div>
        <span className="text-[13px] leading-[1.45] text-leise">
          Vorbelegungen gelten beim Anlegen eines Termins und lassen sich dort im Einzelfall ändern.
        </span>
        {!types ? (
          <ListSkeleton />
        ) : (
          <div className="flex flex-col overflow-hidden rounded-2xl border border-linie">
            {types.map((t) => (
              <button
                key={t.id}
                type="button"
                data-wf={WF}
                onClick={() => setSheet({ id: t.id })}
                className={cx(
                  'flex min-h-[62px] items-center gap-3 border-b border-erhoeht px-3.5 py-2 text-left last:border-b-0',
                  t.archived_at ? 'bg-nav text-leise' : 'bg-flaeche text-text',
                )}
              >
                <span className="size-2.5 flex-none rounded-full" style={{ background: t.color }} />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
                    {t.label}
                    {t.has_plenum_features && (
                      <span className="rounded-full border border-pink px-2 py-px font-mono text-[10px] font-normal text-pink">
                        PLENUM-FUNKTIONEN
                      </span>
                    )}
                  </span>
                  <span className="label-mono">
                    {topicName(t.default_topic_id)} · {FORMAT_LABEL[t.default_format]}
                    {t.default_location && ` · ${t.default_location}`}
                  </span>
                </span>
                <span className="label-mono flex-none">
                  {t.archived_at
                    ? 'Archiviert'
                    : t.appointment_count
                      ? `${t.appointment_count} ${t.appointment_count === 1 ? 'Termin' : 'Termine'}`
                      : 'Unbenutzt'}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      {sheet && (
        <TypeSheet
          key={selected ? `${selected.id}:${selected.version}` : 'new'}
          type={selected}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}

function TypeSheet({ type, onClose }: { type: AppointmentTypeWithUsage | null; onClose: () => void }) {
  const { run } = useFeedback();
  const { topics, topicName } = useLookups();
  const [label, setLabel] = useState(type?.label ?? '');
  const [topicId, setTopicId] = useState(
    type?.default_topic_id ?? topics.find((t) => t.name === 'Organisatorisches' && !t.archived_at)?.id ?? '',
  );
  const [format, setFormat] = useState<AppointmentFormat>(type?.default_format ?? 'vor_ort');
  const [place, setPlace] = useState(type?.default_location ?? '');
  const [color, setColor] = useState<(typeof TYPE_COLORS)[number]>(
    TYPE_COLORS.find((c) => c === type?.color) ?? '#B59AF5',
  );
  const [plenum, setPlenum] = useState(type?.has_plenum_features ?? false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [armed, setArmed] = useState(false);
  const onInvalid = (e: { message: string }) => setError(e.message);

  const save = async () => {
    if (!label.trim() || !topicId || saving) return;
    setSaving(true);
    setError(null);
    const input = {
      label,
      default_topic_id: topicId,
      default_format: format,
      default_location: place,
      color,
    };
    const ok = await run(
      () =>
        type
          ? api.updateAppointmentType(type.id, { ...input, version: type.version }).then(() => true)
          : api.createAppointmentType({ ...input, has_plenum_features: plenum }).then(() => true),
      {
        subject: 'diese Terminart',
        ownInput: type ? label : undefined,
        success: type ? 'Gespeichert' : 'Terminart angelegt',
        onInvalid,
      },
    );
    setSaving(false);
    if (ok) onClose();
  };

  // archivieren (mit Terminen belegt), löschen (unbenutzt) oder wiederherstellen
  const used = !!type && type.appointment_count > 0;
  const state = !type
    ? null
    : type.archived_at
      ? {
          label: 'Wiederherstellen',
          hint: 'Archiviert – steht bei neuen Terminen nicht mehr zur Auswahl.',
          done: 'Terminart wiederhergestellt',
          action: () => api.restoreAppointmentType(type.id, type.version),
        }
      : used
        ? {
            label: 'Archivieren',
            hint: 'Mit Terminen belegt – deshalb nur archivierbar.',
            done: 'Terminart archiviert',
            action: () => api.archiveAppointmentType(type.id, type.version),
          }
        : {
            label: 'Löschen',
            hint: 'Noch nirgends benutzt.',
            done: 'Terminart gelöscht',
            action: () => api.deleteAppointmentType(type.id),
          };

  const field =
    'h-[46px] rounded-xl border border-rand bg-grund px-3.5 font-sans text-[16px] text-text normal-case';
  return (
    <Sheet title={type ? 'Terminart bearbeiten' : 'Neue Terminart'} onClose={onClose} wf={WF} closeButton>
      <form
        className="flex flex-col gap-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="label-mono flex flex-col gap-1.5">
          Name *
          <input
            type="text"
            data-wf={WF}
            autoFocus={!type}
            value={label}
            maxLength={60}
            onChange={(e) => {
              setLabel(e.target.value);
              setError(null);
            }}
            className={field}
          />
        </label>
        <div className="grid grid-cols-2 gap-2.5">
          <label className="label-mono flex flex-col gap-1.5">
            Thema *
            <select
              data-wf={WF}
              value={topicId}
              onChange={(e) => setTopicId(e.target.value)}
              className={field}
            >
              {topics
                .filter((t) => !t.archived_at || t.id === topicId)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {topicName(t.id)}
                  </option>
                ))}
            </select>
          </label>
          <label className="label-mono flex flex-col gap-1.5">
            Ort
            <input
              type="text"
              data-wf={WF}
              value={place}
              placeholder="–"
              onChange={(e) => setPlace(e.target.value)}
              className={field}
            />
          </label>
        </div>
        <div className="flex flex-col gap-2">
          <span id="art-format" className="label-mono">
            Format
          </span>
          <div
            role="group"
            aria-labelledby="art-format"
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
        </div>
        <div className="flex flex-col gap-2">
          <span id="art-farbe" className="label-mono">
            Farbe
          </span>
          <div role="group" aria-labelledby="art-farbe" className="flex gap-2">
            {TYPE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                data-wf={WF}
                aria-pressed={color === c}
                aria-label={`Farbe ${COLOR_NAME[c]}`}
                onClick={() => setColor(c)}
                className={cx(
                  'flex size-11 items-center justify-center rounded-full border-2',
                  color === c ? 'border-text' : 'border-transparent',
                )}
              >
                <span className="size-7 rounded-full" style={{ background: c }} />
              </button>
            ))}
          </div>
        </div>
        {/* nach dem Anlegen nicht mehr änderbar (3.6) */}
        <button
          type="button"
          role="checkbox"
          aria-checked={plenum}
          aria-disabled={!!type}
          data-wf={WF}
          onClick={() => !type && setPlenum(!plenum)}
          className={cx(
            'flex min-h-14 items-center gap-3 rounded-xl border border-linie bg-grund px-3.5 py-2 text-left text-[15px] text-text',
            type && 'cursor-default opacity-55',
          )}
        >
          <CheckBox checked={plenum} />
          <span className="flex flex-col gap-0.5">
            Plenum-Funktionen
            <span className="text-[12px] leading-[1.4] text-leise">
              {type
                ? 'Nach dem Anlegen nicht mehr änderbar.'
                : 'Ergebnis, Protokoll und Abschluss – nur beim Anlegen festlegbar.'}
            </span>
          </span>
        </button>
        <FieldError>{error}</FieldError>
        <LightButton type="submit" data-wf={WF} disabled={!label.trim() || !topicId || saving}>
          {label.trim() ? 'Speichern' : 'Name eingeben, dann speichern'}
        </LightButton>
        {state && (
          <div className="flex flex-col gap-1.5">
            <GhostButton
              data-wf={WF}
              onClick={async () => {
                if (saving) return;
                // endgültiges Löschen erst nach einem zweiten Tipp (7.3)
                if (state.label === 'Löschen' && !armed) return setArmed(true);
                setSaving(true);
                const ok = await run(() => state.action().then(() => true), {
                  subject: 'diese Terminart',
                  success: state.done,
                  onInvalid,
                });
                setSaving(false);
                if (ok) onClose();
              }}
            >
              {armed ? 'Wirklich endgültig löschen?' : state.label}
            </GhostButton>
            <span className="text-center text-[12px] leading-[1.4] text-leise">
              {armed ? 'Lässt sich nicht rückgängig machen. Zum Löschen nochmal tippen.' : state.hint}
            </span>
          </div>
        )}
      </form>
    </Sheet>
  );
}
