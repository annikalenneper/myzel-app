// S-41 Frage – Detail · P3 (WF-FRA-02 bis -05); steht seit dem Umbau 10/2026 in der Agenda (16.1). Aus einer Frage
// können mehrere Entscheidungen und Fakten entstehen; als beantwortet markiert sie die Person selbst (16.3).
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
import {
  DECISION_KIND_LABEL,
  DECISION_STATUS_LABEL,
  QUESTION_STATUS_LABEL,
} from '../../shared/rules/knowledge';
import { cx, FieldError, LightButton, ListSkeleton, LoadError } from '../../ui/bits';
import { Sheet } from '../../ui/Sheet';
import { EventAgendaLink } from '../agenda/EventAgendaLink';
import {
  ActionBar,
  BACK_TO_AGENDA,
  DetailTopBar,
  KnowledgeHistory,
  NotFound,
  StatusPill,
} from './DetailParts';
import { CommentsSection } from '../../ui/Comments';
import { DecisionSheet, QuestionEditSheet } from './KnowledgeSheets';

export function QuestionDetail({ questionId }: { questionId: string }) {
  const { data, error, reload } = useData(`question:${questionId}`, () => api.getQuestion(questionId));
  if (!data)
    return (
      <div className="flex min-h-dvh flex-col lg:min-h-0">
        <DetailTopBar label="Frage" back={BACK_TO_AGENDA} />
        <div className="px-5 py-[18px]">
          {error?.code === 'not_found' ? (
            <NotFound text="Diese Frage gibt es nicht" back={BACK_TO_AGENDA} />
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

function Loaded({ q }: { q: Detail }) {
  const act = useActions();
  const latest = useLatest(q.version);
  const { topicName, memberById, eventById } = useLookups();
  const [sheet, setSheet] = useState<'result' | 'answer' | 'edit' | null>(null);
  const open = q.status === 'offen';
  const event = q.event_id ? eventById.get(q.event_id) : undefined;

  return (
    <div className="flex min-h-dvh flex-col lg:min-h-0">
      <BarOffset px={128} />
      <DetailTopBar
        label="Frage"
        back={BACK_TO_AGENDA}
        onEdit={q.archived_at ? undefined : () => setSheet('edit')}
        editWf="WF-FRA-06"
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
        {event && <EventAgendaLink eventId={event.id} />}
        {q.description && (
          <div className="text-[15px] leading-normal whitespace-pre-wrap text-weich">{q.description}</div>
        )}
        {q.status === 'geklaert' && q.answer && (
          <div className="flex flex-col gap-2 rounded-[14px] border border-linie bg-flaeche px-3.5 py-3">
            <span className="font-mono text-[11px] text-gruen">ANTWORT</span>
            <span className="text-[15px] leading-normal whitespace-pre-wrap">{q.answer}</span>
          </div>
        )}
        {q.status === 'verworfen' && (
          <div className="rounded-[14px] border border-linie bg-flaeche px-3.5 py-3 text-[14px] text-weich">
            Verworfen. Steht weiter in der Historie.
          </div>
        )}

        {/* 16.3: alles, was aus der Frage festgehalten wurde */}
        <section aria-label="Ergebnisse" className="flex flex-col gap-2">
          <span className="label-mono">Ergebnisse · {q.results.length}</span>
          {q.results.map((r) => (
            <Link
              key={r.id}
              to={`/agenda/eintrag/${r.id}`}
              className={cx(
                'flex flex-col gap-1 rounded-[14px] border border-linie bg-flaeche px-3.5 py-2.5 text-text no-underline',
                r.status !== 'gueltig' && 'opacity-60',
              )}
            >
              <span className="label-mono">
                {DECISION_KIND_LABEL[r.kind]} · {DECISION_STATUS_LABEL[r.status]}
              </span>
              <span className="text-[15px] leading-[1.35] font-medium">{r.title}</span>
            </Link>
          ))}
          {q.results.length === 0 && (
            <span className="text-[14px] leading-[1.45] text-leise">
              Noch nichts festgehalten.{open && ' Jede Entscheidung und jeder Fakt dazu kommt hierher.'}
            </span>
          )}
        </section>
        <CommentsSection target="question" targetId={q.id} comments={q.comments} archived={!!q.archived_at} />
        <KnowledgeHistory history={q.history} noun="Frage" />
      </div>

      {open ? (
        <ActionBar hint="Die Frage bleibt offen, bis du sie als beantwortet markierst – auch mit mehreren Ergebnissen.">
          {/* WF-FRA-05 Ergebnis festhalten – beliebig oft */}
          <button
            type="button"
            data-wf="WF-FRA-05"
            onClick={() => setSheet('result')}
            className="h-11 flex-[1.4] rounded-[22px] bg-geplant text-[15px] font-semibold text-grund"
          >
            Ergebnis festhalten
          </button>
          {/* WF-FRA-02 Als beantwortet markieren */}
          <button
            type="button"
            data-wf="WF-FRA-02"
            onClick={() => setSheet('answer')}
            className="h-11 flex-1 rounded-[22px] border border-rand-stark text-[15px] text-text"
          >
            Beantwortet
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
      ) : (
        <ActionBar>
          {/* WF-FRA-04 Wieder öffnen – Antwort bleibt in der Historie, Ergebnisse bleiben */}
          <button
            type="button"
            data-wf="WF-FRA-04"
            onClick={() =>
              void act(() => api.reopenQuestion(q.id, latest.current), {
                subject: 'diese Frage',
                success: 'Wieder geöffnet',
                undo: (r) => r.undo_token,
              })
            }
            className="h-11 flex-1 rounded-[22px] border border-rand-stark text-[15px] text-text"
          >
            Wieder öffnen
          </button>
        </ActionBar>
      )}

      {sheet === 'result' && (
        <DecisionSheet
          question={{ id: q.id, title: q.title, topic_id: q.topic_id }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'edit' && <QuestionEditSheet q={q} onClose={() => setSheet(null)} />}
      {sheet === 'answer' && (
        <AnswerSheet
          title={q.title}
          hasResults={q.results.length > 0}
          draftKey={`frage:${q.id}:antwort`}
          onClose={() => setSheet(null)}
          onConfirm={async (answer) => {
            let message: string | null = null;
            const ok = await act(() => api.clarifyQuestion(q.id, { answer, version: latest.current }), {
              subject: 'diese Frage',
              ownInput: answer || undefined,
              success: 'Als beantwortet markiert',
              undo: (r) => r.undo_token,
              onInvalid: (e) => (message = e.message),
            });
            if (ok) {
              clearDraft(`frage:${q.id}:antwort`);
              setSheet(null);
            }
            return message;
          }}
        />
      )}
    </div>
  );
}

/** WF-FRA-02 „Als beantwortet markieren“: Antwort Pflicht, solange nichts festgehalten ist (16.3) */
function AnswerSheet({
  title,
  hasResults,
  draftKey,
  onClose,
  onConfirm,
}: {
  title: string;
  hasResults: boolean;
  /** lokaler Entwurf der Antwort (7.3), z. B. „frage:<id>:antwort“ */
  draftKey: string;
  onClose: () => void;
  onConfirm: (answer: string) => Promise<string | null>;
}) {
  const [answer, setAnswer] = useState(() => readDraft(draftKey) ?? '');
  const [error, setError] = useState<string | null>(null);
  const missing = !answer.trim() && !hasResults ? 'Antwort eingeben, dann speichern' : null;

  return (
    <Sheet title="Als beantwortet markieren" onClose={onClose} wf="WF-FRA-02" closeButton>
      <form
        className="flex flex-col gap-3.5"
        onSubmit={async (e) => {
          e.preventDefault();
          if (missing) return;
          setError(await onConfirm(answer));
        }}
      >
        <span className="text-[14px] leading-[1.4] text-weich">{title}</span>
        <label className="label-mono flex flex-col gap-1.5">
          {hasResults ? 'Antwort · optional, fasst die Ergebnisse zusammen' : 'Antwort *'}
          <textarea
            data-wf="WF-FRA-02"
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
        <FieldError>{error}</FieldError>
        <LightButton type="submit" data-wf="WF-FRA-02" disabled={!!missing}>
          {missing ?? 'Als beantwortet speichern'}
        </LightButton>
      </form>
    </Sheet>
  );
}
