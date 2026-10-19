// S-21 Veranstaltung anlegen · WF-VER-02 und Basisfelder bearbeiten · WF-VER-03
import { useState } from 'react';
import { useFeedback } from '../../app/feedback';
import { api } from '../../data';
import type { EventListItem } from '../../data/api';
import { fromLocalInput, toLocalInput } from '../../shared/format';
import { EVENT_TYPE_LABEL } from '../../shared/labels';
import { EVENT_TYPES, type EventType } from '../../shared/schema';
import { cx, FieldError, LightButton, Pill, PrimaryButton } from '../../ui/bits';
import { Sheet } from '../../ui/Sheet';

export function EventFormSheet({
  event,
  onClose,
  onCreated,
}: {
  /** vorhandene Veranstaltung bearbeiten; ohne: neu anlegen */
  event?: EventListItem;
  onClose: () => void;
  onCreated?: (created: { id: string; starts_at: string; ends_at: string | null }) => void;
}) {
  const { run } = useFeedback();
  const wf = event ? 'WF-VER-03' : 'WF-VER-02';
  const [title, setTitle] = useState(event?.title ?? '');
  const [type, setType] = useState<EventType>(event?.type ?? 'party');
  const [startsAt, setStartsAt] = useState(toLocalInput(event?.starts_at ?? null));
  const [endsAt, setEndsAt] = useState(toLocalInput(event?.ends_at ?? null));
  const [description, setDescription] = useState(event?.description ?? '');
  // Aufbau und Abbau [P4] – nur beim Bearbeiten
  const [setupAt, setSetupAt] = useState(toLocalInput(event?.setup_at ?? null));
  const [teardownAt, setTeardownAt] = useState(toLocalInput(event?.teardown_at ?? null));
  const [error, setError] = useState<{ field: string | null; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const verb = event ? 'speichern' : 'anlegen';
  const missing = !title.trim()
    ? `Titel eingeben, dann ${verb}`
    : !startsAt
      ? `Beginn wählen, dann ${verb}`
      : null;
  // Ende nach Beginn: Meldung direkt am Feld, nichts wird gespeichert
  const endBeforeStart = !!startsAt && !!endsAt && new Date(endsAt) <= new Date(startsAt);
  const setupAfterStart = !!startsAt && !!setupAt && new Date(setupAt) > new Date(startsAt);
  const teardownBeforeEnd = !!startsAt && !!teardownAt && new Date(teardownAt) < new Date(endsAt || startsAt);
  const timesInvalid = endBeforeStart || setupAfterStart || teardownBeforeEnd;
  const fieldError = (field: string) => error?.field === field && error.message;

  const changedText = () =>
    [
      title !== event?.title && `Titel: ${title}`,
      type !== event?.type && `Art: ${EVENT_TYPE_LABEL[type]}`,
      startsAt !== toLocalInput(event?.starts_at ?? null) && `Beginn: ${startsAt.replace('T', ' ')}`,
      endsAt !== toLocalInput(event?.ends_at ?? null) && `Ende: ${endsAt.replace('T', ' ') || '–'}`,
      description !== (event?.description ?? '') && `Beschreibung: ${description}`,
      setupAt !== toLocalInput(event?.setup_at ?? null) && `Aufbau: ${setupAt.replace('T', ' ') || '–'}`,
      teardownAt !== toLocalInput(event?.teardown_at ?? null) &&
        `Abbau: ${teardownAt.replace('T', ' ') || '–'}`,
    ]
      .filter(Boolean)
      .join(String.fromCharCode(10)) || undefined;

  const submit = async () => {
    if (missing || timesInvalid || saving) return;
    setSaving(true);
    setError(null);
    const input = {
      title,
      type,
      starts_at: fromLocalInput(startsAt) ?? '',
      ends_at: fromLocalInput(endsAt),
      description,
      setup_at: fromLocalInput(setupAt),
      teardown_at: fromLocalInput(teardownAt),
    };
    const options = {
      subject: 'diese Veranstaltung',
      // im Konfliktdialog steht alles, was hier geändert wurde – das Formular lädt danach neu
      ownInput: event ? changedText() : undefined,
      onInvalid: (e: { field: string | null; message: string }) =>
        setError({ field: e.field, message: e.message }),
    };
    if (event) {
      const ok = await run(
        () => api.updateEvent(event.id, { ...input, version: event.version }).then(() => true),
        {
          ...options,
          success: 'Gespeichert',
        },
      );
      if (ok) onClose();
    } else {
      const created = await run(() => api.createEvent(input), {
        ...options,
        success: 'Veranstaltung angelegt',
      });
      if (created) {
        onClose();
        onCreated?.({ id: created.id, starts_at: input.starts_at, ends_at: input.ends_at });
      }
    }
    setSaving(false);
  };

  const dateTile = (
    id: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
    invalid: boolean,
  ) => (
    <label
      htmlFor={id}
      className={cx(
        'flex flex-col gap-1.5 rounded-[14px] border bg-grund px-3 py-2.5 focus-within:border-violett',
        invalid ? 'border-rot' : 'border-linie',
      )}
    >
      <span className="label-mono">{label}</span>
      <input
        id={id}
        type="datetime-local"
        data-wf={wf}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setError(null);
        }}
        className={cx('h-8 w-full min-w-0 bg-transparent text-[14px]', value ? 'text-text' : 'text-leise')}
      />
    </label>
  );

  return (
    <Sheet
      title={event ? 'Veranstaltung bearbeiten' : 'Neue Veranstaltung'}
      onClose={onClose}
      wf={wf}
      closeButton
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="flex flex-col gap-2">
          <label htmlFor="event-titel" className="label-mono">
            Titel *
          </label>
          <input
            id="event-titel"
            type="text"
            data-wf={wf}
            autoFocus={!event}
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            className="h-[50px] rounded-[14px] border border-rand bg-grund px-4 text-[17px] text-text"
          />
          <FieldError>{fieldError('title')}</FieldError>
        </div>
        <div className="flex flex-col gap-2">
          <span id="event-art" className="label-mono">
            Art *
          </span>
          <div role="group" aria-labelledby="event-art" className="flex flex-wrap gap-2">
            {EVENT_TYPES.map((t) => (
              <Pill key={t} data-wf={wf} on={type === t} onClick={() => setType(t)}>
                {EVENT_TYPE_LABEL[t]}
              </Pill>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2.5">
            {dateTile('event-beginn', 'Beginn *', startsAt, setStartsAt, false)}
            {dateTile('event-ende', 'Ende', endsAt, setEndsAt, endBeforeStart)}
          </div>
          <FieldError>
            {endBeforeStart
              ? 'Das Ende muss nach dem Beginn liegen.'
              : fieldError('starts_at') || fieldError('ends_at')}
          </FieldError>
        </div>
        {event && (
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-2.5">
              {dateTile('event-aufbau', 'Aufbau ab', setupAt, setSetupAt, setupAfterStart)}
              {dateTile('event-abbau', 'Abbau bis', teardownAt, setTeardownAt, teardownBeforeEnd)}
            </div>
            <FieldError>
              {setupAfterStart
                ? 'Der Aufbau muss vor dem Beginn liegen.'
                : teardownBeforeEnd
                  ? 'Der Abbau muss nach dem Ende liegen.'
                  : fieldError('setup_at') || fieldError('teardown_at')}
            </FieldError>
          </div>
        )}
        <label className="label-mono flex flex-col gap-1.5">
          Beschreibung
          <textarea
            data-wf={wf}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="min-h-[70px] rounded-xl border border-rand bg-grund px-3.5 py-2.5 font-sans text-[15px] leading-normal text-text normal-case"
          />
        </label>
        <FieldError>
          {error &&
            !['title', 'starts_at', 'ends_at', 'setup_at', 'teardown_at'].includes(error.field ?? '') &&
            error.message}
        </FieldError>
        {!event && <span className="text-[13px] leading-[1.4] text-leise">Startet als „Idee“.</span>}
        {event ? (
          <LightButton type="submit" data-wf={wf} disabled={!!missing || timesInvalid || saving}>
            {missing ?? 'Speichern'}
          </LightButton>
        ) : (
          <PrimaryButton type="submit" data-wf={wf} disabled={!!missing || timesInvalid || saving}>
            {missing ?? 'Anlegen'}
          </PrimaryButton>
        )}
      </form>
    </Sheet>
  );
}
