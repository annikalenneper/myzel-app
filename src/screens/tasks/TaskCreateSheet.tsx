// S-11 Schnellanlage · WF-AUF-03 (und WF-VER-05 mit vorbelegter Veranstaltung)
import { useState } from 'react';
import { useFeedback } from '../../app/feedback';
import { useLookups } from '../../app/lookups';
import { useData } from '../../app/useData';
import { api } from '../../data';
import { isFinalEventStatus } from '../../shared/rules/eventStatus';
import { PRIORITIES, type Priority } from '../../shared/schema';
import { CheckRow, cx, FieldError, Pill, PrimaryButton, PriorityBars } from '../../ui/bits';
import { PRIORITY_LABEL } from '../../shared/labels';
import { DateTile } from '../../ui/DateTile';
import { Sheet } from '../../ui/Sheet';

export function TaskCreateSheet({
  onClose,
  eventId = null,
  appointmentId = null,
  wf = 'WF-AUF-03',
}: {
  onClose: () => void;
  /** Veranstaltung vorbelegt (WF-VER-05) */
  eventId?: string | null;
  /** Termin vorbelegt (WF-TER-07) */
  appointmentId?: string | null;
  wf?: string;
}) {
  const { run } = useFeedback();
  const { topics, topicName, events, eventById } = useLookups();
  const [title, setTitle] = useState('');
  const [topicId, setTopicId] = useState<string | null>(null);
  /** beim Thema „Veranstaltungen“ vorgeschlagen, wenn keine Veranstaltung vorbelegt ist */
  const [pickedEventId, setPickedEventId] = useState<string | null>(null);
  const [priority, setPriority] = useState<Priority>('mittel');
  const [dueDate, setDueDate] = useState('');
  const [mine, setMine] = useState(false);
  const [plenum, setPlenum] = useState(true);
  const [error, setError] = useState<{ field: string | null; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const event = eventId ? eventById.get(eventId) : undefined;
  const topic = topics.find((t) => t.id === topicId);
  const parent = topic?.parent_id ? topics.find((t) => t.id === topic.parent_id) : undefined;
  // Thema „Veranstaltungen“ (oder eine Unterkategorie davon): gleich die Veranstaltung vorschlagen
  const suggestEvent =
    !eventId && !appointmentId && (topic?.name === 'Veranstaltungen' || parent?.name === 'Veranstaltungen');
  const suggestions = events
    .filter((e) => !isFinalEventStatus(e.status))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .slice(0, 6);
  const linkedEventId = eventId ?? (suggestEvent ? pickedEventId : null);
  const linkedEvent = linkedEventId ? eventById.get(linkedEventId) : undefined;
  const { data: appointment } = useData(
    appointmentId ? `appointment:${appointmentId}` : 'appointment:keiner',
    () => (appointmentId ? api.getAppointment(appointmentId) : Promise.resolve(null)),
  );

  const missing = !title.trim()
    ? 'Titel eingeben, dann anlegen'
    : !topicId
      ? 'Thema wählen, dann anlegen'
      : null;

  const create = async () => {
    if (missing || saving) return;
    setSaving(true);
    setError(null);
    const created = await run(
      () =>
        api.createTask({
          title,
          topic_id: topicId!,
          priority,
          due_date: dueDate || null,
          event_id: linkedEventId,
          appointment_id: appointmentId,
          assign_self: mine,
          mark_for_plenum: plenum,
        }),
      {
        success: linkedEvent
          ? `Aufgabe angelegt · ${linkedEvent.title}`
          : appointment
            ? `Aufgabe angelegt · ${appointment.title}`
            : 'Aufgabe angelegt',
        onInvalid: (e) => setError({ field: e.field, message: e.message }),
      },
    );
    setSaving(false);
    if (created) onClose();
  };

  return (
    <Sheet title="Neue Aufgabe" onClose={onClose} wf={wf} closeButton>
      <form
        className="flex flex-col gap-[18px]"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        {event && (
          <span className="self-start rounded-full border border-violett px-2.5 py-1 font-mono text-[11px] text-violett uppercase">
            Veranstaltung: {event.title}
          </span>
        )}
        {appointment && (
          <span className="self-start rounded-full border border-violett px-2.5 py-1 font-mono text-[11px] text-violett uppercase">
            Termin: {appointment.title}
          </span>
        )}
        <div className="flex flex-col gap-2">
          <label htmlFor="neu-titel" className="label-mono">
            Titel *
          </label>
          <input
            id="neu-titel"
            type="text"
            data-wf={wf}
            autoFocus
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            className="h-[50px] rounded-[14px] border border-rand bg-grund px-4 text-[17px] text-text"
          />
          <FieldError>{error?.field === 'title' && error.message}</FieldError>
        </div>

        <div className="flex flex-col gap-2">
          <span id="neu-thema" className="label-mono">
            Thema *
          </span>
          <div role="group" aria-labelledby="neu-thema" className="flex flex-wrap gap-2">
            {topics
              .filter((t) => !t.archived_at)
              .map((t) => (
                <Pill
                  key={t.id}
                  data-wf={wf}
                  on={topicId === t.id}
                  onClick={() => setTopicId(t.id)}
                  className="font-medium"
                >
                  {topicName(t.id)}
                </Pill>
              ))}
          </div>
          <FieldError>{error?.field === 'topic_id' && error.message}</FieldError>
        </div>

        {suggestEvent && suggestions.length > 0 && (
          <div className="flex flex-col gap-2">
            <span id="neu-veranstaltung" className="label-mono">
              Zu welcher Veranstaltung? (optional)
            </span>
            <div role="group" aria-labelledby="neu-veranstaltung" className="flex flex-wrap gap-2">
              {suggestions.map((e) => (
                <Pill
                  key={e.id}
                  data-wf={wf}
                  on={pickedEventId === e.id}
                  onClick={() => setPickedEventId(pickedEventId === e.id ? null : e.id)}
                  className="font-medium"
                >
                  {e.title}
                </Pill>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2.5 border-t border-linie pt-3.5">
          <span className="label-mono">Optional – geht auch später</span>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="flex flex-col gap-2 rounded-[14px] border border-linie bg-grund px-3 py-2.5">
              <span id="neu-prio" className="label-mono">
                Priorität
              </span>
              <div role="group" aria-labelledby="neu-prio" className="flex gap-1.5">
                {[...PRIORITIES].reverse().map((p) => (
                  <button
                    key={p}
                    type="button"
                    data-wf={wf}
                    onClick={() => setPriority(p)}
                    aria-pressed={priority === p}
                    aria-label={`Priorität ${PRIORITY_LABEL[p].toLowerCase()}`}
                    className={cx(
                      'hit flex h-9 flex-1 items-end justify-center rounded-[10px] border pb-[9px]',
                      priority === p ? 'border-text bg-erhoeht' : 'border-linie bg-transparent',
                    )}
                  >
                    <PriorityBars priority={p} small />
                  </button>
                ))}
              </div>
            </div>
            <DateTile label="Frist" wf={wf} value={dueDate} onChange={setDueDate} surface="bg-grund" />
          </div>
          <FieldError>{error?.field === 'due_date' && error.message}</FieldError>
          <CheckRow data-wf={wf} checked={mine} onChange={setMine}>
            Ich übernehme das
          </CheckRow>
          <CheckRow data-wf={wf} checked={plenum} onChange={setPlenum} hint="Nächste Agenda">
            Fürs Plenum
          </CheckRow>
        </div>

        <FieldError>
          {error && !['title', 'topic_id', 'due_date'].includes(error.field ?? '') && error.message}
        </FieldError>
        {/* gesperrt, bis Titel und Thema gesetzt sind */}
        {/* bleibt am unteren Rand sichtbar, auch wenn das Sheet scrollt */}
        <div className="sticky -bottom-[calc(24px+env(safe-area-inset-bottom,0px))] -mx-5 -mb-[calc(24px+env(safe-area-inset-bottom,0px))] flex flex-col bg-flaeche px-5 pt-2 pb-[calc(24px+env(safe-area-inset-bottom,0px))] lg:-bottom-6 lg:-mb-6 lg:pb-6">
          <PrimaryButton type="submit" data-wf={wf} disabled={!!missing || saving}>
            {missing ?? 'Anlegen'}
          </PrimaryButton>
        </div>
      </form>
    </Sheet>
  );
}
