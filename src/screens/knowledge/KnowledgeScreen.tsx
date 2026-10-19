// S-40 Wissen · P3: Beschlüsse (Entscheidungen und Fakten), Fragen, Dokumente; P5: Drive-Verzeichnis.
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ListDetailLayout } from '../../app/AppShell';
import { BarOffset, useFeedback } from '../../app/feedback';
import { useLookups } from '../../app/lookups';
import { useData } from '../../app/useData';
import { api } from '../../data';
import type { DecisionListItem, DocumentListItem, DriveEntry, QuestionListItem } from '../../data/api';
import { PRIORITY_LABEL } from '../../shared/labels';
import { DECISION_KIND_LABEL, DECISION_STATUS_LABEL, DOC_TYPE_LABEL } from '../../shared/rules/knowledge';
import { topicFilterIds } from '../../shared/rules/topics';
import type { DecisionKind, DecisionStatus } from '../../shared/schema';
import { cx, ListSkeleton, Pill } from '../../ui/bits';
import { IconBookmark, IconPlus } from '../../ui/icons';
import { Menu, type MenuOption } from '../../ui/Menu';
import { SearchButton } from '../../ui/SearchOverlay';
import { DecisionDetail } from './DecisionDetail';
import { DocumentLinkScreen } from './DocumentLinkScreen';
import { DriveBrowser, useDriveSync } from './Drive';
import { DriveMissing } from './LinkedDocuments';
import { DecisionSheet, QuestionSheet } from './KnowledgeSheets';
import { QuestionDetail } from './QuestionDetail';

/** Link „Finanzen in MeinVerein“ – URL konfigurierbar (F-WIS-07) */
const MEINVEREIN_URL: string = import.meta.env.VITE_MEINVEREIN_URL ?? 'https://www.meinverein.de/';

export type KnowledgeTab = 'beschluesse' | 'fragen' | 'dokumente' | 'drive';
const TABS: [KnowledgeTab, string][] = [
  ['beschluesse', 'Beschlüsse'],
  ['fragen', 'Fragen'],
  ['dokumente', 'Dokumente'],
  ['drive', 'Drive'],
];
const ALL = '__alle__';

export function KnowledgeScreen({ detail, drive }: { detail?: 'decision' | 'question'; drive?: boolean }) {
  const { id } = useParams();
  return (
    <ListDetailLayout
      detailOpen={!!detail && !!id}
      list={
        <KnowledgeList
          initialTab={detail === 'question' ? 'fragen' : 'beschluesse'}
          drive={!!drive}
          selectedId={id ?? null}
        />
      }
      detail={
        !id ? null : detail === 'decision' ? (
          <DecisionDetail key={id} decisionId={id} />
        ) : (
          <QuestionDetail key={id} questionId={id} />
        )
      }
    />
  );
}

export function MarkButton({
  marked,
  onToggle,
  title,
}: {
  marked: boolean;
  onToggle: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      data-wf="WF-WIS-05"
      onClick={onToggle}
      aria-pressed={marked}
      aria-label={marked ? 'Markierung „Fürs Plenum“ entfernen' : `Fürs Plenum markieren: ${title}`}
      className={cx(
        'hit absolute top-2 right-2 flex size-10 items-center justify-center rounded-full',
        marked ? 'text-pink' : 'text-leise',
      )}
    >
      <IconBookmark filled={marked} />
    </button>
  );
}

/** WF-WIS-05: Markierung „Fürs Plenum“ an Entscheidung, Frage, Dokument */
export function useMark() {
  const { run } = useFeedback();
  return (target: 'decision' | 'question' | 'document' | 'event' | 'partner', id: string, marked: boolean) =>
    void run(() => api.setMark(target, id, !marked), {
      success: marked ? 'Markierung entfernt' : 'Fürs Plenum markiert',
      undo: (r) => r.undo_token,
    });
}

function KnowledgeList({
  initialTab,
  drive,
  selectedId,
}: {
  initialTab: KnowledgeTab;
  /** Drive-Reiter: eigene Adresse /wissen/drive, damit Ordner, Zurück und „im Drive suchen“ funktionieren */
  drive: boolean;
  selectedId: string | null;
}) {
  const { barVisible } = useFeedback();
  const navigate = useNavigate();
  const [appTab, setAppTab] = useState<KnowledgeTab>(initialTab);
  const tab = drive ? 'drive' : appTab;
  const setTab = (key: KnowledgeTab) => {
    if (key === 'drive') return navigate('/wissen/drive');
    setAppTab(key);
    if (drive) navigate('/wissen');
  };
  const [sheet, setSheet] = useState<'decision' | 'question' | 'document' | null>(null);
  const [driveFile, setDriveFile] = useState<DriveEntry | null>(null);
  const fab: Record<
    Exclude<KnowledgeTab, 'drive'>,
    [wf: string, label: string, kind: 'decision' | 'question' | 'document']
  > = {
    beschluesse: ['WF-WIS-01', 'Entscheidung oder Fakt anlegen', 'decision'],
    fragen: ['WF-FRA-01', 'Frage stellen', 'question'],
    dokumente: ['WF-WIS-06', 'Dokument per Link erfassen', 'document'],
  };

  return (
    <div className="flex min-h-dvh flex-col lg:min-h-0">
      <BarOffset px={92} />
      <div className="flex flex-col gap-4 px-5 pt-5">
        <div className="flex items-center gap-2.5">
          <img src="/myzel-logo.png" alt="Myzel" className="h-11 w-[66px] object-contain lg:hidden" />
          <span className="flex-1" />
          {/* WF-WIS-07 Link „Finanzen in MeinVerein“ */}
          <a
            href={MEINVEREIN_URL}
            target="_blank"
            rel="noreferrer"
            data-wf="WF-WIS-07"
            className="hit flex h-10 items-center rounded-[20px] border border-rand px-3 font-mono text-[11px] text-weich no-underline"
          >
            FINANZEN · MEINVEREIN ↗
          </a>
          <SearchButton first="beschluesse" />
        </div>
        <h1 className="m-0 text-[32px] leading-[1.15] font-bold tracking-[-1px]">Wissen</h1>
        <div role="tablist" className="grid grid-cols-4 gap-1 rounded-xl border border-linie bg-flaeche p-1">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={cx(
                'hit h-10 rounded-lg text-[14px]',
                tab === key ? 'bg-text font-semibold text-grund' : 'text-weich',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div role="tabpanel" className="flex flex-1 flex-col gap-3 px-5 pt-3.5 pb-[180px] lg:pb-28">
        {tab === 'beschluesse' && <Decisions selectedId={selectedId} onCreate={() => setSheet('decision')} />}
        {tab === 'fragen' && <Questions selectedId={selectedId} onCreate={() => setSheet('question')} />}
        {tab === 'dokumente' && <Documents onCreate={() => setSheet('document')} />}
        {tab === 'drive' && <DriveTab onLink={setDriveFile} />}
      </div>

      {/* Kontextabhängiges „+“: Entscheidung/Fakt · Frage · Dokument per Link */}
      {!barVisible && tab !== 'drive' && (
        <button
          type="button"
          data-wf={fab[tab][0]}
          onClick={() => setSheet(fab[tab][2])}
          aria-label={fab[tab][1]}
          className="bg-marke fixed right-5 bottom-[calc(96px+env(safe-area-inset-bottom,0px))] z-10 flex size-[58px] items-center justify-center rounded-full text-grund shadow-[0_8px_24px_rgba(157,110,240,0.45)] lg:right-auto lg:bottom-6 lg:left-[562px]"
        >
          <IconPlus size={26} />
        </button>
      )}
      {sheet === 'decision' && <DecisionSheet onClose={() => setSheet(null)} />}
      {sheet === 'question' && <QuestionSheet onClose={() => setSheet(null)} />}
      {sheet === 'document' && <DocumentLinkScreen target={null} onClose={() => setSheet(null)} />}
      {/* WF-WIS-09 Datei aus dem Verzeichnis verknüpfen: S-43 mit dieser Datei, Ziel frei wählbar */}
      {driveFile && (
        <DocumentLinkScreen
          wf="WF-WIS-09"
          target={null}
          driveFile={driveFile}
          onClose={() => setDriveFile(null)}
        />
      )}
    </div>
  );
}

type DecisionMenu = 'art' | 'status' | 'thema' | null;

function Decisions({ selectedId, onCreate }: { selectedId: string | null; onCreate: () => void }) {
  const mark = useMark();
  const { topics } = useLookups();
  const { data: decisions } = useData('decisions', () => api.listDecisions());
  // WF-WIS-04 Filter Thema, Art, Status – kombinierbar, speichern nichts; Standard: nur gültige
  const [kind, setKind] = useState<DecisionKind | null>(null);
  const [status, setStatus] = useState<DecisionStatus | 'alle'>('gueltig');
  const [topicId, setTopicId] = useState<string | null>(null);
  const [menu, setMenu] = useState<DecisionMenu>(null);

  const topicIds = topicId ? topicFilterIds(topicId, topics) : null;
  const shown = (decisions ?? []).filter(
    (d) =>
      (status === 'alle' || d.status === status) &&
      (!kind || d.kind === kind) &&
      (!topicIds || topicIds.has(d.topic_id)),
  );
  const filtered = kind !== null || status !== 'gueltig' || topicId !== null;
  const topLevel = topics.filter((t) => !t.parent_id && (!t.archived_at || t.id === topicId));

  const menus: Record<
    Exclude<DecisionMenu, null>,
    { label: string; options: MenuOption[]; pick: (k: string) => void }
  > = {
    art: {
      label: 'Art',
      options: [
        { key: ALL, label: 'Entscheidungen und Fakten', selected: !kind },
        { key: 'entscheidung', label: 'Nur Entscheidungen', selected: kind === 'entscheidung' },
        { key: 'fakt', label: 'Nur Fakten', selected: kind === 'fakt' },
      ],
      pick: (k) => setKind(k === ALL ? null : (k as DecisionKind)),
    },
    status: {
      label: 'Status',
      options: [
        ...(['gueltig', 'ersetzt', 'aufgehoben'] as const).map((s) => ({
          key: s,
          label: DECISION_STATUS_LABEL[s],
          selected: status === s,
        })),
        { key: 'alle', label: 'Alle', selected: status === 'alle' },
      ],
      pick: (k) => setStatus(k as DecisionStatus | 'alle'),
    },
    thema: {
      label: 'Thema',
      options: [
        { key: ALL, label: 'Alle Themen', selected: !topicId },
        ...topLevel.map((t) => ({ key: t.id, label: t.name, selected: topicId === t.id })),
      ],
      pick: (k) => setTopicId(k === ALL ? null : k),
    },
  };
  const pills: [Exclude<DecisionMenu, null>, string, boolean][] = [
    ['art', kind ? (kind === 'fakt' ? 'Fakten' : 'Entscheidungen') : 'Art', kind !== null],
    ['status', status === 'alle' ? 'Alle Status' : DECISION_STATUS_LABEL[status], status !== 'gueltig'],
    ['thema', topicId ? (topics.find((t) => t.id === topicId)?.name ?? 'Thema') : 'Thema', topicId !== null],
  ];

  if (!decisions) return <ListSkeleton />;
  return (
    <>
      <div className="relative flex flex-col gap-2">
        <div className="no-scrollbar -mx-5 -mt-1 flex gap-2 overflow-x-auto px-5 pt-1 pb-1">
          {pills.map(([key, label, on]) => (
            <Pill
              key={key}
              data-wf="WF-WIS-04"
              on={on}
              aria-expanded={menu === key}
              aria-haspopup="true"
              onClick={() => setMenu(menu === key ? null : key)}
            >
              {label} ▾
            </Pill>
          ))}
        </div>
        {menu && (
          <Menu
            wf="WF-WIS-04"
            label={menus[menu].label}
            options={menus[menu].options}
            onClose={() => setMenu(null)}
            onPick={(k) => {
              menus[menu].pick(k);
              setMenu(null);
            }}
          />
        )}
        <div className="flex min-h-8 items-center justify-between">
          <span className="label-mono">
            {shown.length} {shown.length === 1 ? 'Eintrag' : 'Einträge'}
          </span>
          {filtered && (
            <button
              type="button"
              data-wf="WF-WIS-04"
              onClick={() => {
                setKind(null);
                setStatus('gueltig');
                setTopicId(null);
              }}
              className="hit h-8 text-[13px] text-pink"
            >
              Filter zurücksetzen
            </button>
          )}
        </div>
      </div>
      {shown.map((d) => (
        <DecisionCard
          key={d.id}
          d={d}
          selected={d.id === selectedId}
          onMark={() => mark('decision', d.id, d.marked)}
        />
      ))}
      {shown.length === 0 && (
        <Empty
          text={
            filtered
              ? 'Mit diesen Filtern gibt es keine Einträge.'
              : 'Noch nichts festgehalten. Halte die erste Entscheidung oder den ersten Fakt fest.'
          }
          action={filtered ? undefined : ['WF-WIS-01', '+ Entscheidung oder Fakt', onCreate]}
        />
      )}
    </>
  );
}

function DecisionCard({
  d,
  selected,
  onMark,
}: {
  d: DecisionListItem;
  selected: boolean;
  onMark: () => void;
}) {
  const valid = d.status === 'gueltig';
  return (
    <article
      className={cx('relative rounded-2xl border border-linie', selected ? 'bg-erhoeht' : 'bg-flaeche')}
    >
      <Link
        to={`/wissen/beschluesse/${d.id}`}
        className={cx('flex flex-col gap-2 py-3.5 pr-14 pl-4 text-text no-underline', !valid && 'opacity-60')}
      >
        <span className="label-mono flex items-center gap-2">
          {DECISION_KIND_LABEL[d.kind]}
          <span className={valid ? 'text-gruen' : 'text-leise'}>{DECISION_STATUS_LABEL[d.status]}</span>
        </span>
        <span className={cx('text-[17px] leading-[1.3] font-semibold', !valid && 'line-through')}>
          {d.title}
        </span>
        {d.superseded_by_title && (
          <span className="text-[13px] leading-[1.4] text-weich">
            → ersetzt durch: <b>{d.superseded_by_title}</b>
          </span>
        )}
        <span className="label-mono">Quelle: {d.source_label}</span>
      </Link>
      {/* nur gültige sind markierbar */}
      {valid && <MarkButton marked={d.marked} onToggle={onMark} title={d.title} />}
    </article>
  );
}

function Questions({ selectedId, onCreate }: { selectedId: string | null; onCreate: () => void }) {
  const mark = useMark();
  const { topicName, eventById } = useLookups();
  const { data: questions } = useData('questions', () => api.listQuestions());
  const [now] = useState(() => Date.now());
  if (!questions) return <ListSkeleton />;
  const open = questions.filter((q) => q.status === 'offen');
  const clarified = questions
    .filter((q) => q.status === 'geklaert')
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, 5);

  const meta = (q: QuestionListItem) => {
    const days = Math.floor((now - new Date(q.created_at).getTime()) / 86_400_000);
    const event = q.event_id ? eventById.get(q.event_id)?.title : null;
    return [
      PRIORITY_LABEL[q.urgency],
      days <= 0 ? 'seit heute' : days === 1 ? 'seit gestern' : `seit ${days} Tagen`,
      event ? `Event ${event}` : topicName(q.topic_id),
      q.marked && 'fürs Plenum',
    ]
      .filter(Boolean)
      .join(' · ');
  };

  return (
    <>
      <span className="label-mono">Offen · nach Dringlichkeit und Alter</span>
      {open.map((q) => (
        <article
          key={q.id}
          className={cx(
            'relative rounded-2xl border border-linie',
            q.id === selectedId ? 'bg-erhoeht' : 'bg-flaeche',
          )}
        >
          <Link
            to={`/wissen/fragen/${q.id}`}
            className="flex flex-col gap-2 py-3.5 pr-14 pl-4 text-text no-underline"
          >
            <span className={cx('label-mono', q.urgency === 'hoch' && 'text-bernstein')}>{meta(q)}</span>
            <span className="text-[17px] leading-[1.3] font-semibold">{q.title}</span>
          </Link>
          <MarkButton marked={q.marked} onToggle={() => mark('question', q.id, q.marked)} title={q.title} />
        </article>
      ))}
      {open.length === 0 && (
        <Empty
          text="Keine offenen Fragen. Stell eine, wenn etwas zu klären ist."
          action={['WF-FRA-01', '+ Frage', onCreate]}
        />
      )}
      {clarified.length > 0 && <span className="label-mono pt-2">Zuletzt geklärt</span>}
      {clarified.map((q) => (
        <Link
          key={q.id}
          to={`/wissen/fragen/${q.id}`}
          className="flex flex-col gap-1.5 rounded-2xl border border-linie px-4 py-3 text-text no-underline"
        >
          <span className="text-[15px] leading-[1.35] text-weich">{q.title}</span>
          <span className="text-[13px] leading-[1.4] text-leise">
            →{' '}
            {q.resulting_decision
              ? `${DECISION_KIND_LABEL[q.resulting_decision.kind]}: ${q.resulting_decision.title}`
              : q.answer}
          </span>
        </Link>
      ))}
    </>
  );
}

function Documents({ onCreate }: { onCreate: () => void }) {
  const mark = useMark();
  const { data: documents } = useData('documents', () => api.listDocuments());
  if (!documents) return <ListSkeleton />;
  const meta = (d: DocumentListItem) =>
    [
      DOC_TYPE_LABEL[d.doc_type],
      d.drive_file_id || /drive\.google\.com|docs\.google\.com/.test(d.url) ? 'Drive' : 'Link',
      d.marked ? 'fürs Plenum' : d.link_summary,
    ].join(' · ');
  return (
    <>
      <span className="text-[13px] leading-[1.45] text-leise">
        Dokumente, die mit etwas verknüpft sind. Die Dateien selbst bleiben im Drive oder an ihrer Adresse.
      </span>
      {documents.length > 0 && (
        <div className="flex flex-col overflow-hidden rounded-2xl border border-linie">
          {documents.map((d) => (
            <div
              key={d.id}
              className="relative flex min-h-[60px] items-center border-b border-erhoeht bg-flaeche last:border-b-0"
            >
              <a
                href={d.url}
                target="_blank"
                rel="noreferrer"
                className="flex min-w-0 flex-1 flex-col gap-0.5 py-2 pr-14 pl-4 text-text no-underline"
              >
                <span className="text-[15px] font-medium">{d.title} ↗</span>
                <span className="label-mono">{meta(d)}</span>
                <DriveMissing doc={d} />
              </a>
              <MarkButton
                marked={d.marked}
                onToggle={() => mark('document', d.id, d.marked)}
                title={d.title}
              />
            </div>
          ))}
        </div>
      )}
      {documents.length === 0 && (
        <Empty
          text="Noch kein Dokument erfasst. Füge das erste per Link hinzu."
          action={['WF-WIS-06', '+ Dokument', onCreate]}
        />
      )}
    </>
  );
}

/** WF-WIS-08 Drive-Verzeichnis: Ordner in der Adresse, Suchwort als ?q= (Übergang aus der globalen Suche) */
function DriveTab({ onLink }: { onLink: (e: DriveEntry) => void }) {
  const navigate = useNavigate();
  const { folderId } = useParams();
  const [params, setParams] = useSearchParams();
  useDriveSync();
  return (
    <DriveBrowser
      wf="WF-WIS-08"
      mode="browse"
      folderId={folderId ?? null}
      onFolder={(id) => navigate(id ? `/wissen/drive/${id}` : '/wissen/drive')}
      query={params.get('q') ?? ''}
      onQuery={(q) => setParams(q ? { q } : {}, { replace: true })}
      onLink={onLink}
    />
  );
}

function Empty({
  text,
  action,
}: {
  text: string;
  action?: [wf: string, label: string, onClick: () => void];
}) {
  return (
    <div data-wf="WF-ALL-05" className="flex flex-col items-center gap-3 px-4 py-10 text-center">
      <span className="text-[14px] leading-normal text-leise">{text}</span>
      {action && (
        <button
          type="button"
          data-wf={action[0]}
          onClick={action[2]}
          className="hit flex h-[42px] items-center rounded-[21px] border border-rand-stark px-[18px] text-[14px] text-text"
        >
          {action[1]}
        </button>
      )}
    </div>
  );
}
