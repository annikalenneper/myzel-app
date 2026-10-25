// S-42 Entscheidung / Fakt – Detail · P3 (WF-WIS-02, WF-WIS-03); auf die Agenda (WF-AGE-03, 16.1)
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { clearDraft, readDraft, writeDraft } from '../../app/drafts';
import { BarOffset } from '../../app/feedback';
import { useLookups } from '../../app/lookups';
import { useActions, useLatest } from '../../app/useActions';
import { useData } from '../../app/useData';
import { api } from '../../data';
import type { DecisionDetail as Detail } from '../../data/api';
import { formatDayMonth } from '../../shared/format';
import { canSupersede, DECISION_KIND_LABEL, DECISION_STATUS_LABEL } from '../../shared/rules/knowledge';
import { cx, FieldError, GhostButton, LightButton, ListSkeleton, LoadError } from '../../ui/bits';
import { Sheet } from '../../ui/Sheet';
import {
  ActionBar,
  BACK_TO_KNOWLEDGE,
  ConfirmDialog,
  DetailTopBar,
  KnowledgeHistory,
  NotFound,
  StatusPill,
  type BackTarget,
} from './DetailParts';
import { LinkedDocuments } from './LinkedDocuments';
import { Segmented } from './KnowledgeSheets';
import { EMPTY_SOURCE, SourceFields, sourceReady, type SourceValue } from './SourceFields';

const dateText = (isoDate: string) => {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return `${formatDayMonth(new Date(y, m - 1, d))}${y}`;
};

export function DecisionDetail({
  decisionId,
  back = BACK_TO_KNOWLEDGE,
}: {
  decisionId: string;
  back?: BackTarget;
}) {
  const { data, error, reload } = useData(`decision:${decisionId}`, () => api.getDecision(decisionId));
  if (!data)
    return (
      <div className="flex min-h-dvh flex-col lg:min-h-0">
        <DetailTopBar label="Beschlüsse" back={back} />
        <div className="px-5 py-[18px]">
          {error?.code === 'not_found' ? (
            <NotFound text="Diesen Eintrag gibt es nicht" back={back} />
          ) : error ? (
            <LoadError message={error.message} onRetry={reload} />
          ) : (
            <ListSkeleton />
          )}
        </div>
      </div>
    );
  return <Loaded d={data} back={back} />;
}

function Loaded({ d, back }: { d: Detail; back: BackTarget }) {
  const act = useActions();
  const latest = useLatest(d.version);
  const { topicName } = useLookups();
  const [sheet, setSheet] = useState<'replace' | 'revoke' | 'document' | null>(null);
  const [note, setNote] = useState('');
  const valid = d.status === 'gueltig';
  const noun = DECISION_KIND_LABEL[d.kind];
  const setAgenda = (on: boolean, success = on ? 'Auf der Agenda' : 'Von der Agenda genommen') =>
    void act(() => api.setDecisionAgenda(d.id, on), { success, undo: (r) => r.undo_token });

  return (
    <div className="flex min-h-dvh flex-col lg:min-h-0">
      <BarOffset px={valid ? 100 : 24} />
      <DetailTopBar
        label="Beschlüsse"
        back={back}
        agenda={valid ? { on: d.marked, onToggle: () => setAgenda(!d.marked) } : undefined}
      />
      <div className="flex flex-1 flex-col gap-4 px-5 pt-1 pb-10">
        <div className={cx('flex flex-col gap-2', !valid && 'opacity-60')}>
          <span className="label-mono flex flex-wrap items-center gap-2">
            {noun} · {topicName(d.topic_id)}
            <StatusPill label={DECISION_STATUS_LABEL[d.status]} tone={valid ? 'gruen' : 'leise'} />
          </span>
          <h1
            className={cx(
              'm-0 text-[28px] leading-[1.2] font-bold tracking-[-0.5px]',
              !valid && 'line-through',
            )}
          >
            {d.title}
          </h1>
          <span className="label-mono">
            {d.kind === 'fakt' ? 'Festgehalten' : 'Beschlossen'} am {dateText(d.decided_on)}
          </span>
        </div>
        {/* 16.1 „Stimmt das noch?“ – ausdrücklich auf die Agenda gesetzt */}
        {valid && d.marked && (
          <div className="flex flex-col gap-2.5 rounded-[14px] border border-pink px-3.5 py-3">
            <span className="text-[15px] font-semibold">Steht auf der Agenda: Stimmt das noch?</span>
            <span className="text-[13px] leading-[1.45] text-weich">
              Gilt es weiter, nimm es von der Agenda. Sonst unten ersetzen oder aufheben.
            </span>
            <button
              type="button"
              data-wf="WF-AGE-03"
              onClick={() => setAgenda(false, 'Bestätigt · von der Agenda genommen')}
              className="hit h-10 self-start rounded-[20px] border border-rand-stark px-4 text-[14px] text-text"
            >
              Stimmt noch
            </button>
          </div>
        )}
        {d.status === 'ersetzt' && d.superseded_by_id && (
          <Link
            to={`/wissen/beschluesse/${d.superseded_by_id}`}
            className="rounded-[14px] border border-linie bg-flaeche px-3.5 py-3 text-[14px] leading-[1.45] text-text no-underline"
          >
            → ersetzt durch: <b>{d.superseded_by_title}</b>
          </Link>
        )}
        {d.status === 'aufgehoben' && (
          <div className="rounded-[14px] border border-linie bg-flaeche px-3.5 py-3 text-[14px] text-weich">
            Aufgehoben. Bleibt zum Nachlesen sichtbar.
          </div>
        )}
        {d.replaces.map((old) => (
          <Link
            key={old.id}
            to={`/wissen/beschluesse/${old.id}`}
            className="text-[13px] leading-[1.4] text-leise no-underline"
          >
            ersetzt: <span className="line-through">{old.title}</span> ›
          </Link>
        ))}
        {d.description && (
          <div className="text-[15px] leading-normal whitespace-pre-wrap text-weich">{d.description}</div>
        )}

        <div className="flex flex-col gap-2">
          <span className="label-mono">Quellen</span>
          {d.source_plenum && (
            <Link
              to={`/termine/${d.source_plenum.id}`}
              className="flex min-h-11 items-center gap-2.5 rounded-xl border border-linie bg-flaeche px-3 py-1.5 text-text no-underline"
            >
              <span className="size-2 flex-none rounded-full bg-pink" />
              <span className="flex-1 text-[14px]">{d.source_plenum.title}</span>
              <span className="label-mono">{formatDayMonth(new Date(d.source_plenum.starts_at))} ›</span>
            </Link>
          )}
          {d.source_document && (
            <a
              href={d.source_document.url}
              target="_blank"
              rel="noreferrer"
              className="flex min-h-11 items-center gap-2.5 rounded-xl border border-linie bg-flaeche px-3 py-1.5 text-text no-underline"
            >
              <span className="flex-1 text-[14px]">{d.source_document.title}</span>
              <span className="label-mono">Dokument ↗</span>
            </a>
          )}
          {d.source_note && (
            <div className="rounded-xl border border-linie bg-flaeche px-3 py-2.5 text-[14px] leading-[1.45] text-weich">
              <span className="label-mono">Notiz · </span>
              {d.source_note}
            </div>
          )}
        </div>

        {/* WF-WIS-06 weitere Dokumente verknüpfen */}
        <LinkedDocuments
          wf="WF-WIS-06"
          target={{ type: 'decision', id: d.id, kind: noun, name: d.title }}
          documents={d.documents}
        />

        <KnowledgeHistory history={d.history} noun={noun} />
      </div>

      {valid && (
        <ActionBar>
          {/* WF-WIS-02 Ersetzen */}
          <button
            type="button"
            data-wf="WF-WIS-02"
            onClick={() => setSheet('replace')}
            className="h-11 flex-1 rounded-[22px] bg-geplant text-[15px] font-semibold text-grund"
          >
            Ersetzen
          </button>
          {/* WF-WIS-03 Aufheben */}
          <button
            type="button"
            data-wf="WF-WIS-03"
            onClick={() => setSheet('revoke')}
            className="h-11 flex-1 rounded-[22px] border border-rand-stark text-[15px] text-text"
          >
            Aufheben
          </button>
        </ActionBar>
      )}

      {sheet === 'replace' && (
        <ReplaceSheet
          decision={d}
          onClose={() => setSheet(null)}
          onConfirm={async (input) => {
            let message: string | null = null;
            const ok = await act(() => api.replaceDecision(d.id, { ...input, version: latest.current }), {
              subject: d.kind === 'fakt' ? 'diesen Fakt' : 'diese Entscheidung',
              ownInput: input.title || undefined,
              success: 'Ersetzt',
              undo: (r) => r.undo_token,
              onInvalid: (e) => (message = e.message),
            });
            if (ok) {
              clearDraft(replaceDraftKey(d.id));
              setSheet(null);
            }
            return message;
          }}
        />
      )}
      {sheet === 'revoke' && (
        <ConfirmDialog label={`${noun} aufheben`} wf="WF-WIS-03" onClose={() => setSheet(null)}>
          <h2 className="m-0 text-[20px] leading-[1.25] font-bold">{noun} aufheben?</h2>
          <span className="text-[15px] leading-normal text-weich">
            {d.kind === 'fakt' ? 'Er' : 'Sie'} gilt dann nicht mehr, bleibt aber ausgegraut sichtbar.
          </span>
          <label className="label-mono flex flex-col gap-1.5">
            Notiz · optional
            <input
              type="text"
              data-wf="WF-WIS-03"
              value={note}
              placeholder="Warum?"
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
              className="h-11 rounded-xl border border-rand bg-grund px-3.5 font-sans text-[15px] text-text normal-case"
            />
          </label>
          <button
            type="button"
            data-wf="WF-WIS-03"
            onClick={() => {
              setSheet(null);
              void act(() => api.revokeDecision(d.id, note || null, latest.current), {
                subject: d.kind === 'fakt' ? 'diesen Fakt' : 'diese Entscheidung',
                ownInput: note || undefined,
                success: 'Aufgehoben',
                undo: (r) => r.undo_token,
              });
            }}
            className="h-12 rounded-3xl bg-geplant text-[15px] font-bold text-grund"
          >
            Aufheben
          </button>
          <GhostButton onClick={() => setSheet(null)}>Doch nicht</GhostButton>
        </ConfirmDialog>
      )}
    </div>
  );
}

interface ReplaceInput {
  successor_id: string | null;
  title: string;
  description: string;
  source_plenum_id: string | null;
  source_document_id: string | null;
  source_note: string | null;
}

/** lokaler Entwurf des Texts der neuen Fassung (7.3) */
const replaceDraftKey = (id: string) => `entscheidung:${id}:neue-fassung`;

/** WF-WIS-02: Nachfolgerin neu anlegen oder wählen; Quelle frei wählbar */
export function ReplaceSheet({
  decision,
  onClose,
  onConfirm,
  plenumId,
  wf = 'WF-WIS-02',
}: {
  decision: Pick<Detail, 'id' | 'title' | 'kind'>;
  onClose: () => void;
  onConfirm: (input: ReplaceInput) => Promise<string | null>;
  /** im Plenum ersetzt: die neue Fassung hat dieses Plenum als Quelle (WF-PLE-13) */
  plenumId?: string;
  wf?: string;
}) {
  const { data: all } = useData('decisions', () => api.listDecisions());
  const [mode, setMode] = useState<'new' | 'pick'>('new');
  const [title, setTitle] = useState('');
  const [text, setText] = useState(() => readDraft(replaceDraftKey(decision.id)) ?? '');
  const [source, setSource] = useState<SourceValue>(
    plenumId ? { ...EMPTY_SOURCE, plenumId } : { ...EMPTY_SOURCE, note: '' },
  );
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // nur gültige Einträge, keine, die schon auf diesen verweisen
  const q = query.trim().toLowerCase();
  const candidates = (all ?? [])
    .filter((x) => canSupersede(all ?? [], decision.id, x.id) === null)
    .filter((x) => !q || x.title.toLowerCase().includes(q))
    .slice(0, 8);
  const missing =
    mode === 'new'
      ? !title.trim()
        ? 'Titel eingeben, dann ersetzen'
        : !sourceReady(source)
          ? 'Quelle angeben, dann ersetzen'
          : null
      : !picked
        ? 'Eintrag wählen, dann ersetzen'
        : null;

  return (
    <Sheet title="Ersetzen durch …" onClose={onClose} wf={wf} closeButton>
      <form
        className="flex flex-col gap-3.5"
        onSubmit={async (e) => {
          e.preventDefault();
          if (missing) return;
          setError(
            await onConfirm(
              mode === 'new'
                ? {
                    successor_id: null,
                    title,
                    description: text,
                    source_plenum_id: source.plenumId,
                    source_document_id: source.documentId,
                    source_note: source.note,
                  }
                : {
                    successor_id: picked,
                    title: '',
                    description: '',
                    source_plenum_id: null,
                    source_document_id: null,
                    source_note: null,
                  },
            ),
          );
        }}
      >
        <Segmented
          label="Nachfolgerin"
          wf={wf}
          value={mode}
          onChange={setMode}
          options={[
            ['new', 'Neu anlegen'],
            ['pick', 'Vorhandene wählen'],
          ]}
        />
        {mode === 'new' ? (
          <>
            <label className="label-mono flex flex-col gap-1.5">
              Neue Fassung · Titel *
              <input
                type="text"
                data-wf={wf}
                autoFocus
                value={title}
                maxLength={200}
                onChange={(e) => setTitle(e.target.value)}
                className="h-[46px] rounded-xl border border-rand bg-grund px-3.5 font-sans text-[16px] text-text normal-case"
              />
            </label>
            <label className="label-mono flex flex-col gap-1.5">
              Text · optional
              <textarea
                data-wf={wf}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  writeDraft(replaceDraftKey(decision.id), e.target.value);
                }}
                className="min-h-20 rounded-[14px] border border-rand bg-grund px-3.5 py-3 font-sans text-[15px] leading-normal text-text normal-case"
              />
            </label>
            <span className="label-mono">Quelle *</span>
            <SourceFields value={source} onChange={setSource} wf={wf} />
          </>
        ) : (
          <>
            <input
              type="search"
              data-wf={wf}
              aria-label="Gültige Entscheidung suchen"
              placeholder="Gültige Entscheidung suchen …"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-11 rounded-xl border border-rand bg-grund px-3.5 text-[14px] text-text"
            />
            {candidates.map((x) => (
              <button
                key={x.id}
                type="button"
                role="radio"
                aria-checked={picked === x.id}
                data-wf={wf}
                onClick={() => setPicked(x.id)}
                className={cx(
                  'flex min-h-11 items-center gap-2.5 rounded-xl border px-3 py-1.5 text-left text-[14px] text-text',
                  picked === x.id ? 'border-rand-stark bg-erhoeht font-semibold' : 'border-linie bg-grund',
                )}
              >
                <span className="flex-1">{x.title}</span>
                <span className="text-gruen">{picked === x.id ? '✓' : ''}</span>
              </button>
            ))}
            <span className="text-[12px] leading-[1.4] text-leise">
              Nur gültige Einträge, keine, die schon auf diese verweisen.
            </span>
          </>
        )}
        <span className="text-[13px] leading-[1.4] text-leise">
          Die alte Fassung bleibt sichtbar – durchgestrichen und mit Verweis auf die neue.
        </span>
        <FieldError>{error}</FieldError>
        <LightButton type="submit" data-wf={wf} disabled={!!missing}>
          {missing ?? 'Ersetzen'}
        </LightButton>
      </form>
    </Sheet>
  );
}
