// Anlegen in Wissen: Entscheidung oder Fakt (WF-WIS-01) und offene Frage (WF-FRA-01)
import { useState } from 'react';
import { useFeedback } from '../../app/feedback';
import { useLookups } from '../../app/lookups';
import { belongsToPlenum, runningPlenum } from '../../app/plenum';
import { useSession } from '../../app/session';
import { api } from '../../data';
import { PRIORITY_LABEL } from '../../shared/labels';
import { DECISION_KIND_LABEL } from '../../shared/rules/knowledge';
import { toIsoDate } from '../../shared/rules/due';
import { DECISION_KINDS, PRIORITIES, type DecisionKind, type Priority } from '../../shared/schema';
import { cx, FieldError, LightButton } from '../../ui/bits';
import { DateTile } from '../../ui/DateTile';
import { Sheet } from '../../ui/Sheet';
import { EMPTY_SOURCE, SourceFields, sourceReady, type SourceValue } from './SourceFields';

const field =
  'h-[46px] rounded-xl border border-rand bg-grund px-3.5 font-sans text-[16px] text-text normal-case';

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  wf,
}: {
  label: string;
  options: readonly (readonly [T, string])[];
  value: T;
  onChange: (next: T) => void;
  wf: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="grid auto-cols-fr grid-flow-col gap-1 rounded-xl border border-linie bg-grund p-1"
    >
      {options.map(([key, text]) => (
        <button
          key={key}
          type="button"
          data-wf={wf}
          aria-pressed={value === key}
          onClick={() => onChange(key)}
          className={cx(
            'hit h-9 rounded-lg text-[14px]',
            value === key ? 'bg-text font-semibold text-grund' : 'text-weich',
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export function TopicSelect({
  value,
  onChange,
  wf,
  label = 'Thema *',
}: {
  value: string;
  onChange: (id: string) => void;
  wf: string;
  label?: string;
}) {
  const { topics, topicName } = useLookups();
  return (
    <label className="label-mono flex min-w-0 flex-col gap-1.5">
      {label}
      <select
        data-wf={wf}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cx(field, 'min-w-0 text-[15px]')}
      >
        <option value="">wählen</option>
        {topics
          .filter((t) => !t.archived_at)
          .map((t) => (
            <option key={t.id} value={t.id}>
              {topicName(t.id)}
            </option>
          ))}
      </select>
    </label>
  );
}

/**
 * WF-WIS-01 – mindestens eine Quelle ist Pflicht. Aus einer Frage heraus (WF-FRA-05, 16.3) ist es ein Ergebnis der
 * Frage; die Frage bleibt offen. Läuft gerade ein Plenum, zu dem meine Änderungen gehören, ist es die Quelle.
 */
export function DecisionSheet({
  onClose,
  sourceNote,
  initialKind = 'entscheidung',
  question,
  onCreated,
}: {
  onClose: () => void;
  /** vorausgewählte Art, z. B. im Reiter „Fakten“ */
  initialKind?: DecisionKind;
  /** vorbelegte Notiz als Quelle, z. B. „Nachbereitung Winterrave“ */
  sourceNote?: string;
  /** Ergebnis dieser Frage: Titel und Thema vorbelegt */
  question?: { id: string; title: string; topic_id: string };
  onCreated?: () => void;
}) {
  const WF = question ? 'WF-FRA-05' : 'WF-WIS-01';
  const { run } = useFeedback();
  const { topics } = useLookups();
  const session = useSession();
  const [kind, setKind] = useState<DecisionKind>(initialKind);
  const [title, setTitle] = useState(question?.title ?? '');
  const [topicId, setTopicId] = useState(
    () =>
      question?.topic_id ?? topics.find((t) => t.name === 'Organisatorisches' && !t.archived_at)?.id ?? '',
  );
  const [decidedOn, setDecidedOn] = useState(() => toIsoDate(new Date()));
  const [source, setSource] = useState<SourceValue>(() => {
    const plenum = runningPlenum(session, new Date());
    if (plenum && belongsToPlenum(plenum) !== false) return { ...EMPTY_SOURCE, plenumId: plenum.id };
    return sourceNote ? { ...EMPTY_SOURCE, note: sourceNote } : EMPTY_SOURCE;
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const missing = !title.trim()
    ? 'Titel eingeben, dann festhalten'
    : !topicId
      ? 'Thema wählen, dann festhalten'
      : !sourceReady(source)
        ? 'Quelle angeben, dann festhalten'
        : null;

  const save = async () => {
    if (missing || saving) return;
    setSaving(true);
    setError(null);
    const created = await run(
      () =>
        api.createDecision({
          title,
          kind,
          topic_id: topicId,
          decided_on: decidedOn || null,
          source_plenum_id: source.plenumId,
          source_document_id: source.documentId,
          source_note: source.note,
          source_question_id: question?.id ?? null,
        }),
      {
        success: kind === 'fakt' ? 'Fakt festgehalten' : 'Entscheidung festgehalten',
        onInvalid: (e) => setError(e.message),
      },
    );
    setSaving(false);
    if (created) {
      onClose();
      onCreated?.();
    }
  };

  return (
    <Sheet title={question ? 'Ergebnis festhalten' : 'Neu festhalten'} onClose={onClose} wf={WF} closeButton>
      <form
        className="flex flex-col gap-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {question && (
          <span className="text-[14px] leading-[1.4] text-weich">
            Aus der Frage „{question.title}“ – die Frage bleibt offen.
          </span>
        )}
        <Segmented
          label="Art"
          wf={WF}
          value={kind}
          onChange={setKind}
          options={DECISION_KINDS.map((k) => [k, DECISION_KIND_LABEL[k]] as const)}
        />
        <label className="label-mono flex flex-col gap-1.5">
          Titel *
          <input
            type="text"
            data-wf={WF}
            autoFocus
            value={title}
            maxLength={200}
            placeholder="Was gilt ab jetzt?"
            onChange={(e) => setTitle(e.target.value)}
            className={field}
          />
        </label>
        <div className="grid grid-cols-2 gap-2.5">
          <TopicSelect value={topicId} onChange={setTopicId} wf={WF} />
          <DateTile label="Datum" wf={WF} value={decidedOn} onChange={setDecidedOn} surface="bg-grund" />
        </div>
        <div className="flex flex-col gap-2">
          <span className={cx('label-mono', !sourceReady(source) && 'text-bernstein')}>
            Quelle * · mindestens eine
          </span>
          <SourceFields value={source} onChange={setSource} wf={WF} />
          {!sourceReady(source) && (
            <span className="text-[13px] leading-[1.4] text-bernstein">
              Ohne Quelle lässt sich nichts festhalten.
            </span>
          )}
        </div>
        <FieldError>{error}</FieldError>
        <LightButton type="submit" data-wf={WF} disabled={!!missing || saving}>
          {missing ?? 'Festhalten'}
        </LightButton>
      </form>
    </Sheet>
  );
}

/** WF-FRA-01 – offene Fragen stehen von selbst auf der Agenda (16.1) */
export function QuestionSheet({ onClose, wf = 'WF-FRA-01' }: { onClose: () => void; wf?: string }) {
  const { run } = useFeedback();
  const { events } = useLookups();
  const [title, setTitle] = useState('');
  const [topicId, setTopicId] = useState('');
  const [eventId, setEventId] = useState('');
  const [urgency, setUrgency] = useState<Priority>('mittel');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const missing = !title.trim()
    ? 'Frage eingeben, dann stellen'
    : !topicId
      ? 'Thema wählen, dann stellen'
      : null;

  const save = async () => {
    if (missing || saving) return;
    setSaving(true);
    setError(null);
    const created = await run(
      () =>
        api.createQuestion({
          title,
          topic_id: topicId,
          event_id: eventId || null,
          urgency,
        }),
      { success: 'Frage gestellt', onInvalid: (e) => setError(e.message) },
    );
    setSaving(false);
    if (created) onClose();
  };

  return (
    <Sheet title="Neue Frage" onClose={onClose} wf={wf} closeButton>
      <form
        className="flex flex-col gap-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="label-mono flex flex-col gap-1.5">
          Frage *
          <input
            type="text"
            data-wf={wf}
            autoFocus
            value={title}
            maxLength={200}
            placeholder="Was müssen wir klären?"
            onChange={(e) => setTitle(e.target.value)}
            className={field}
          />
        </label>
        <div className="grid grid-cols-2 gap-2.5">
          <TopicSelect value={topicId} onChange={setTopicId} wf={wf} />
          <label className="label-mono flex min-w-0 flex-col gap-1.5">
            Veranstaltung
            <select
              data-wf={wf}
              value={eventId}
              onChange={(e) => setEventId(e.target.value)}
              className={cx(field, 'min-w-0 text-[15px]')}
            >
              <option value="">keine</option>
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-col gap-2">
          <span className="label-mono">Dringlichkeit</span>
          <Segmented
            label="Dringlichkeit"
            wf={wf}
            value={urgency}
            onChange={setUrgency}
            options={PRIORITIES.map((p) => [p, PRIORITY_LABEL[p]] as const)}
          />
        </div>
        <FieldError>{error}</FieldError>
        <LightButton type="submit" data-wf={wf} disabled={!!missing || saving}>
          {missing ?? 'Frage stellen'}
        </LightButton>
      </form>
    </Sheet>
  );
}
