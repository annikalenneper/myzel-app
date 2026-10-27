// S-40 Wissen · P3: Entscheidungen, Fakten, Dokumente; P5: Drive-Verzeichnis. Fragen stehen seit dem Umbau 10/2026
// in der Agenda (16.1).
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ListDetailLayout } from '../../app/AppShell';
import { BarOffset, useFeedback } from '../../app/feedback';
import { useLookups } from '../../app/lookups';
import { useData } from '../../app/useData';
import { api } from '../../data';
import type { DecisionListItem, DocumentListItem, DriveEntry } from '../../data/api';
import { formatDayMonth } from '../../shared/format';
import {
  DECISION_STATUS_LABEL,
  decisionActive,
  DOC_TYPE_LABEL,
  MARK_REASON_LABEL,
} from '../../shared/rules/knowledge';
import { topicFilterIds } from '../../shared/rules/topics';
import type { DecisionKind, DecisionStatus, MarkReason } from '../../shared/schema';
import { cx, ListSkeleton, Pill } from '../../ui/bits';
import { IconBookmark } from '../../ui/icons';
import { Menu, type MenuOption } from '../../ui/Menu';
import { SearchButton } from '../../ui/SearchOverlay';
import { DeleteAction, useDeleteArtifact } from '../common/DeleteAction';
import { DecisionDetail } from './DecisionDetail';
import { AgendaReasonSheet } from './DetailParts';
import { DocumentLinkScreen } from './DocumentLinkScreen';
import { DriveBrowser, useDriveSync } from './Drive';
import { DriveMissing } from './LinkedDocuments';
import { DecisionSheet } from './KnowledgeSheets';

/** Link „Finanzen in MeinVerein“ – URL konfigurierbar (F-WIS-07) */
// eine leer angelegte Variable gilt wie eine fehlende
const MEINVEREIN_URL: string = import.meta.env.VITE_MEINVEREIN_URL?.trim() || 'https://www.meinverein.de/';

type KnowledgeTab = 'entscheidungen' | 'fakten' | 'dokumente' | 'drive';
const TABS: [KnowledgeTab, string][] = [
  ['entscheidungen', 'Entscheidungen'],
  ['fakten', 'Fakten'],
  ['dokumente', 'Dokumente'],
  ['drive', 'Drive'],
];
const ALL = '__alle__';

export function KnowledgeScreen({ detail, drive }: { detail?: 'decision'; drive?: boolean }) {
  const { id } = useParams();
  return (
    <ListDetailLayout
      detailOpen={!!detail && !!id}
      list={<KnowledgeList drive={!!drive} selectedId={id ?? null} />}
      detail={id ? <DecisionDetail key={id} decisionId={id} /> : null}
    />
  );
}

/** WF-AGE-03: Entscheidung oder Fakt auf die Agenda setzen – das Lesezeichen an der Karte */
function AgendaButton({ on, onToggle, title }: { on: boolean; onToggle: () => void; title: string }) {
  return (
    <button
      type="button"
      data-wf="WF-AGE-03"
      onClick={onToggle}
      aria-pressed={on}
      aria-label={on ? `Von der Agenda nehmen: ${title}` : `Auf die Agenda setzen: ${title}`}
      className={cx(
        'hit absolute top-2 right-2 flex size-10 items-center justify-center rounded-full',
        on ? 'text-pink' : 'text-leise',
      )}
    >
      <IconBookmark filled={on} />
    </button>
  );
}

/** Lesezeichen: herunternehmen sofort, aufsetzen mit Wahl „Stimmt das noch?“ / „Aktion erforderlich“ (Phase 12) */
function useAgendaToggle(): [(d: DecisionListItem) => void, ReactNode] {
  const { run } = useFeedback();
  const [choosing, setChoosing] = useState<DecisionListItem | null>(null);
  const set = (d: DecisionListItem, on: boolean, reason?: MarkReason) =>
    void run(() => api.setDecisionAgenda(d.id, on, reason), {
      success: on && reason ? `Auf der Agenda: ${MARK_REASON_LABEL[reason]}` : 'Von der Agenda genommen',
      undo: (r) => r.undo_token,
    });
  const sheet = choosing && (
    <AgendaReasonSheet
      title={choosing.title}
      onClose={() => setChoosing(null)}
      onPick={(reason) => {
        setChoosing(null);
        set(choosing, true, reason);
      }}
    />
  );
  return [(d) => (d.marked ? set(d, false) : setChoosing(d)), sheet];
}

function KnowledgeList({
  drive,
  selectedId,
}: {
  /** Drive-Reiter: eigene Adresse /wissen/drive, damit Ordner, Zurück und „im Drive suchen“ funktionieren */
  drive: boolean;
  selectedId: string | null;
}) {
  const navigate = useNavigate();
  // gewählter Reiter; solange keiner gewählt ist, steht ein geöffneter Fakt im Reiter „Fakten“
  const [picked, setAppTab] = useState<KnowledgeTab | null>(null);
  const { data: decisions } = useData('decisions', () => api.listDecisions());
  const openKind = decisions?.find((d) => d.id === selectedId)?.kind;
  const appTab = picked ?? (openKind === 'fakt' ? 'fakten' : 'entscheidungen');
  const tab = drive ? 'drive' : appTab;
  const setTab = (key: KnowledgeTab) => {
    if (key === 'drive') return navigate('/wissen/drive');
    setAppTab(key);
    if (drive) navigate('/wissen');
  };
  const [sheet, setSheet] = useState<'entscheidung' | 'fakt' | 'document' | null>(null);
  const [driveFile, setDriveFile] = useState<DriveEntry | null>(null);
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
        {tab === 'entscheidungen' && (
          <Decisions kind="entscheidung" selectedId={selectedId} onCreate={() => setSheet('entscheidung')} />
        )}
        {tab === 'fakten' && (
          <Decisions kind="fakt" selectedId={selectedId} onCreate={() => setSheet('fakt')} />
        )}
        {tab === 'dokumente' && <Documents onCreate={() => setSheet('document')} />}
        {tab === 'drive' && <DriveTab onLink={setDriveFile} />}
      </div>

      {(sheet === 'entscheidung' || sheet === 'fakt') && (
        <DecisionSheet initialKind={sheet} onClose={() => setSheet(null)} />
      )}
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

type DecisionMenu = 'status' | 'thema' | null;
type StatusFilter = DecisionStatus | 'aktuell' | 'alle';
const STATUS_FILTER_LABEL: Record<StatusFilter, string> = {
  ...DECISION_STATUS_LABEL,
  aktuell: 'Offen & gültig',
  alle: 'Alle Status',
};

/** „bis 18.10. · 4/11 bestätigt“ oder „Widerspruch“ (16.4) */
function consensusLine(d: DecisionListItem): string | null {
  if (d.status !== 'offen' || !d.consensus || !d.consensus_until) return null;
  const [y, m, day] = d.consensus_until.split('-').map(Number) as [number, number, number];
  const until = formatDayMonth(new Date(y, m - 1, day));
  const count = `${d.consensus.confirmed}/${d.consensus.total} bestätigt`;
  return d.consensus.objected > 0 ? `Widerspruch · ${count}` : `bis ${until} · ${count}`;
}

function Decisions({
  kind,
  selectedId,
  onCreate,
}: {
  kind: DecisionKind;
  selectedId: string | null;
  onCreate: () => void;
}) {
  const [toggleAgenda, agendaSheet] = useAgendaToggle();
  const { topics } = useLookups();
  const { data: decisions } = useData('decisions', () => api.listDecisions());
  // WF-WIS-04 Filter Thema und Status – kombinierbar, speichern nichts; Standard: gültige und offene (16.4)
  const [status, setStatus] = useState<StatusFilter>('aktuell');
  const [topicId, setTopicId] = useState<string | null>(null);
  const [menu, setMenu] = useState<DecisionMenu>(null);

  const topicIds = topicId ? topicFilterIds(topicId, topics) : null;
  const shown = (decisions ?? []).filter(
    (d) =>
      (status === 'alle' || (status === 'aktuell' ? decisionActive(d.status) : d.status === status)) &&
      d.kind === kind &&
      (!topicIds || topicIds.has(d.topic_id)),
  );
  const filtered = status !== 'aktuell' || topicId !== null;
  const topLevel = topics.filter((t) => !t.parent_id && (!t.archived_at || t.id === topicId));

  const menus: Record<
    Exclude<DecisionMenu, null>,
    { label: string; options: MenuOption[]; pick: (k: string) => void }
  > = {
    status: {
      label: 'Status',
      options: [
        { key: 'aktuell', label: STATUS_FILTER_LABEL.aktuell, selected: status === 'aktuell' },
        ...(['offen', 'gueltig', 'ersetzt', 'aufgehoben'] as const).map((s) => ({
          key: s,
          label: DECISION_STATUS_LABEL[s],
          selected: status === s,
        })),
        { key: 'alle', label: 'Alle', selected: status === 'alle' },
      ],
      pick: (k) => setStatus(k as StatusFilter),
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
    ['status', STATUS_FILTER_LABEL[status], status !== 'aktuell'],
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
                setStatus('aktuell');
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
        <DecisionCard key={d.id} d={d} selected={d.id === selectedId} onAgenda={() => toggleAgenda(d)} />
      ))}
      {agendaSheet}
      {shown.length === 0 && (
        <Empty
          text={
            filtered
              ? 'Mit diesen Filtern gibt es keine Einträge.'
              : kind === 'fakt'
                ? 'Noch kein Fakt festgehalten.'
                : 'Noch keine Entscheidung festgehalten.'
          }
          action={
            filtered ? undefined : ['WF-WIS-01', kind === 'fakt' ? '+ Fakt' : '+ Entscheidung', onCreate]
          }
        />
      )}
    </>
  );
}

function DecisionCard({
  d,
  selected,
  onAgenda,
}: {
  d: DecisionListItem;
  selected: boolean;
  onAgenda: () => void;
}) {
  const valid = d.status === 'gueltig';
  const active = decisionActive(d.status);
  const consensus = consensusLine(d);
  return (
    <article
      className={cx('relative rounded-2xl border border-linie', selected ? 'bg-erhoeht' : 'bg-flaeche')}
    >
      <Link
        to={`/wissen/beschluesse/${d.id}`}
        className={cx(
          'flex flex-col gap-2 py-3.5 pr-14 pl-4 text-text no-underline',
          !active && 'opacity-60',
        )}
      >
        <span className="label-mono flex flex-wrap items-center gap-x-2">
          <span className={valid ? 'text-gruen' : active ? 'text-bernstein' : 'text-leise'}>
            {DECISION_STATUS_LABEL[d.status]}
          </span>
          {consensus && (
            <span className={d.consensus!.objected > 0 ? 'text-pink' : 'text-weich'}>{consensus}</span>
          )}
          {d.marked && <span className="text-pink">Auf der Agenda</span>}
        </span>
        <span className={cx('text-[17px] leading-[1.3] font-semibold', !active && 'line-through')}>
          {d.title}
        </span>
        {/* 16.4: der Text steht auf der Karte, nicht nur der Titel */}
        {d.description && (
          <span className="line-clamp-3 text-[14px] leading-[1.45] break-words text-weich">
            {d.description}
          </span>
        )}
        {d.superseded_by_title && (
          <span className="text-[13px] leading-[1.4] text-weich">
            → ersetzt durch: <b>{d.superseded_by_title}</b>
          </span>
        )}
        <span className="label-mono">Quelle: {d.source_label}</span>
      </Link>
      {/* nur gültige und offene lassen sich auf die Agenda setzen */}
      {active && <AgendaButton on={d.marked} onToggle={onAgenda} title={d.title} />}
    </article>
  );
}

/** Dokumente haben keine Detailansicht (U15) – gelöscht wird in der Liste */
function DocumentDelete({ doc }: { doc: DocumentListItem }) {
  const remove = useDeleteArtifact('document', doc.id, () => doc.version, null);
  return (
    <DeleteAction
      noun="Dokument"
      consequence="Die Datei selbst bleibt im Drive bzw. an ihrer Adresse; Verknüpfungen verschwinden aus den Listen."
      onConfirm={() => void remove()}
    />
  );
}

function Documents({ onCreate }: { onCreate: () => void }) {
  const { data: documents } = useData('documents', () => api.listDocuments());
  if (!documents) return <ListSkeleton />;
  const meta = (d: DocumentListItem) =>
    [
      DOC_TYPE_LABEL[d.doc_type],
      d.drive_file_id || /drive\.google\.com|docs\.google\.com/.test(d.url) ? 'Drive' : 'Link',
      d.link_summary,
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
                className="flex min-w-0 flex-1 flex-col gap-0.5 py-2 pr-4 pl-4 text-text no-underline"
              >
                <span className="text-[15px] font-medium">{d.title} ↗</span>
                <span className="label-mono">{meta(d)}</span>
                <DriveMissing doc={d} />
              </a>
              {/* WF-ALL-09 Löschen (Phase 9) – die Datei selbst bleibt im Drive bzw. an ihrer Adresse */}
              <DocumentDelete doc={d} />
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
