// S-41 Frage – Detail · P3 (WF-FRA-02, WF-FRA-03, WF-WIS-05)
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { clearDraft, readDraft, writeDraft } from '../../app/drafts';
import { BarOffset } from '../../app/feedback';
import { useLookups } from '../../app/lookups';
import { useActions, useLatest } from '../../app/useActions';
import { useData } from '../../app/useData';
import { api } from '../../data';
import type { QuestionDetail as Detail } from '../../data/api';
import { formatDayMonth } from '../../shared/format';
import { PRIORITY_LABEL } from '../../shared/labels';
import { DECISION_KIND_LABEL, QUESTION_STATUS_LABEL } from '../../shared/rules/knowledge';
import { cx, FieldError, LightButton, ListSkeleton, LoadError } from '../../ui/bits';
import { Sheet } from '../../ui/Sheet';
import { ActionBar, DetailTopBar, KnowledgeHistory, NotFound, StatusPill } from './DetailParts';
import { useMark } from './KnowledgeScreen';
import { Segmented } from './KnowledgeSheets';
import { EMPTY_SOURCE, SourceFields, sourceReady, type SourceValue } from './SourceFields';

export function QuestionDetail({ questionId }: { questionId: string }) {
  const { data, error, reload } = useData(`question:${questionId}`, () => api.getQuestion(questionId));
  if (!data)
    return (
      <div className="flex min-h-dvh flex-col lg:min-h-0">
        <DetailTopBar label="Fragen" />
        <div className="px-5 py-[18px]">
          {error?.code === 'not_found' ? (
            <NotFound text="Diese Frage gibt es nicht" />
          ) : error ? (
            <LoadError message={error.message} onRetry={reload} />
          ) : (
            <ListSkeleton />
          )}
        </div>
      </div>
    );
  return <Loaded q={data} />;
}

type Result = 'antwort' | 'entscheidung' | 'fakt';

function Loaded({ q }: { q: Detail }) {
  const mark = useMark();
  const act = useActions();
  const latest = useLatest(q.version);
  const { topicName, memberById, eventById } = useLookups();
  const [clarifying, setClarifying] = useState(false);
  const open = q.status === 'offen';
  const event = q.event_id ? eventById.get(q.event_id) : undefined;

  return (
    <div className="flex min-h-dvh flex-col lg:min-h-0">
      <BarOffset px={open ? 128 : 24} />
      <DetailTopBar
        label="Fragen"
        mark={open ? { marked: q.marked, onToggle: () => mark('question', q.id, q.marked) } : undefined}
      />
      <div className="flex flex-1 flex-col gap-4 px-5 pt-1 pb-10">
        <div className="flex flex-col gap-2">
          <span className="label-mono flex flex-wrap items-center gap-2">
            <span className={cx(q.urgency === 'hoch' && open && 'text-bernstein')}>
              Dringlichkeit {PRIORITY_LABEL[q.urgency]}
            </span>
            <StatusPill
              label={QUESTION_STATUS_LABEL[q.status]}
              tone={q.status === 'offen' ? 'bernstein' : q.status === 'geklaert' ? 'gruen' : 'leise'}
            />
          </span>
          <h1
            className={cx(
              'm-0 text-[28px] leading-[1.2] font-bold tracking-[-0.5px]',
              q.status === 'verworfen' && 'line-through',
            )}
          >
            {q.title}
          </h1>
          <span className="label-mono leading-[1.5]">
            {topicName(q.topic_id)}
            {event && ` · Event ${event.title}`} · gestellt von{' '}
            {memberById.get(q.raised_by)?.display_name ?? 'jemandem'} ·{' '}
            {formatDayMonth(new Date(q.created_at))}
          </span>
        </div>
        {q.description && (
          <div className="text-[15px] leading-normal whitespace-pre-wrap text-weich">{q.description}</div>
        )}
        {q.status === 'geklaert' && (
          <div className="flex flex-col gap-2 rounded-[14px] border border-linie bg-flaeche px-3.5 py-3">
            <span className="font-mono text-[11px] text-gruen">ANTWORT</span>
            <span className="text-[15px] leading-normal whitespace-pre-wrap">{q.answer}</span>
            {q.resulting_decision && (
              <Link
                to={`/wissen/beschluesse/${q.resulting_decision.id}`}
                className="hit self-start text-[14px]"
              >
                → {DECISION_KIND_LABEL[q.resulting_decision.kind]}: {q.resulting_decision.title} ↗
              </Link>
            )}
          </div>
        )}
        {q.status === 'verworfen' && (
          <div className="rounded-[14px] border border-linie bg-flaeche px-3.5 py-3 text-[14px] text-weich">
            Verworfen. Steht weiter in der Historie.
          </div>
        )}
        <KnowledgeHistory history={q.history} noun="Frage" />
      </div>

      {open && (
        <ActionBar hint="Im Plenum geklärt, wird das Plenum automatisch zur Quelle.">
          {/* WF-FRA-02 Klären außerhalb des Plenums */}
          <button
            type="button"
            data-wf="WF-FRA-02"
            onClick={() => setClarifying(true)}
            className="h-11 flex-1 rounded-[22px] bg-geplant text-[15px] font-semibold text-grund"
          >
            Klären
          </button>
          {/* WF-FRA-03 Verwerfen */}
          <button
            type="button"
            data-wf="WF-FRA-03"
            onClick={() =>
              void act(() => api.discardQuestion(q.id, latest.current), {
                subject: 'diese Frage',
                success: 'Frage verworfen',
                undo: (r) => r.undo_token,
              })
            }
            className="h-11 flex-1 rounded-[22px] border border-rand-stark text-[15px] text-text"
          >
            Verwerfen
          </button>
        </ActionBar>
      )}

      {clarifying && (
        <ClarifySheet
          title={q.title}
          draftKey={`frage:${q.id}:antwort`}
          onClose={() => setClarifying(false)}
          onConfirm={async (answer, result, source) => {
            let message: string | null = null;
            const ok = await act(
              () =>
                api.clarifyQuestion(q.id, {
                  answer,
                  result,
                  source_document_id: source.documentId,
                  source_note: source.note,
                  version: latest.current,
                }),
              {
                subject: 'diese Frage',
                ownInput: answer,
                success: 'Als geklärt gespeichert',
                undo: (r) => r.undo_token,
                onInvalid: (e) => (message = e.message),
              },
            );
            if (ok) {
              clearDraft(`frage:${q.id}:antwort`);
              setClarifying(false);
            }
            return message;
          }}
        />
      )}
    </div>
  );
}

/** WF-FRA-02 Dialog Klären: Antwort Pflicht, Ergebnis, Quelle Notiz oder Dokument */
export function ClarifySheet({
  title,
  onClose,
  onConfirm,
  inPlenum,
  draftKey,
  wf = 'WF-FRA-02',
}: {
  title: string;
  /** lokaler Entwurf der Antwort (7.3), z. B. „frage:<id>:antwort“ */
  draftKey: string;
  onClose: () => void;
  onConfirm: (answer: string, result: Result, source: SourceValue) => Promise<string | null>;
  /** im Plenum ist das Plenum die Quelle – keine Auswahl nötig */
  inPlenum?: boolean;
  wf?: string;
}) {
  const [answer, setAnswer] = useState(() => readDraft(draftKey) ?? '');
  const [result, setResult] = useState<Result>('antwort');
  const [source, setSource] = useState<SourceValue>({ ...EMPTY_SOURCE, note: '' });
  const [error, setError] = useState<string | null>(null);
  const needsSource = result !== 'antwort' && !inPlenum;
  const missing = !answer.trim()
    ? 'Antwort eingeben, dann speichern'
    : needsSource && !sourceReady(source)
      ? 'Quelle angeben, dann speichern'
      : null;

  return (
    <Sheet title="Frage klären" onClose={onClose} wf={wf} closeButton>
      <form
        className="flex flex-col gap-3.5"
        onSubmit={async (e) => {
          e.preventDefault();
          if (missing) return;
          setError(await onConfirm(answer, result, needsSource ? source : EMPTY_SOURCE));
        }}
      >
        <span className="text-[14px] leading-[1.4] text-weich">{title}</span>
        <label className="label-mono flex flex-col gap-1.5">
          Antwort *
          <textarea
            data-wf={wf}
            autoFocus
            value={answer}
            onChange={(e) => {
              setAnswer(e.target.value);
              writeDraft(draftKey, e.target.value);
              setError(null);
            }}
            className="min-h-20 rounded-[14px] border border-rand bg-grund px-3.5 py-3 font-sans text-[15px] leading-normal text-text normal-case"
          />
        </label>
        <div className="flex flex-col gap-2">
          <span className="label-mono">Ergebnis</span>
          <Segmented
            label="Ergebnis"
            wf={wf}
            value={result}
            onChange={setResult}
            options={[
              ['antwort', 'Nur Antwort'],
              ['entscheidung', 'Entscheidung'],
              ['fakt', 'Fakt'],
            ]}
          />
        </div>
        {needsSource && (
          <div className="flex flex-col gap-2">
            <span className="label-mono">Quelle * · außerhalb des Plenums</span>
            <SourceFields value={source} onChange={setSource} wf={wf} kinds={['notiz', 'dokument']} />
          </div>
        )}
        {inPlenum && result !== 'antwort' && (
          <span className="text-[13px] leading-[1.4] text-leise">Quelle ist dieses Plenum.</span>
        )}
        <FieldError>{error}</FieldError>
        <LightButton type="submit" data-wf={wf} disabled={!!missing}>
          {missing ?? 'Als geklärt speichern'}
        </LightButton>
      </form>
    </Sheet>
  );
}
