// S-10 Agenda (16.1): offene Aufgaben und Fragen, dazu Entscheidungen und Fakten, die jemand ausdrücklich aufgesetzt
// hat („Stimmt das noch?“). Eigene Hauptansicht, nicht mehr Teil des Plenums; am Desktop mit der Detailansicht daneben.
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  applyQuestionFilter,
  applyTaskFilter,
  DEFAULT_AGENDA_FILTER,
  useAgendaFilter,
  type AgendaKind,
  type AgendaScope,
} from '../../app/agendaFilter';
import { ListDetailLayout } from '../../app/AppShell';
import { BarOffset, useFeedback } from '../../app/feedback';
import { useLookups } from '../../app/lookups';
import { useMe } from '../../app/session';
import { useData } from '../../app/useData';
import { api } from '../../data';
import type { DecisionListItem, QuestionListItem } from '../../data/api';
import { PRIORITY_LABEL, TASK_STATUS_LABEL } from '../../shared/labels';
import { isOverdue, toIsoDate } from '../../shared/rules/due';
import { DECISION_KIND_LABEL, QUESTION_STATUS_LABEL, sortQuestions } from '../../shared/rules/knowledge';
import { sortTasks } from '../../shared/rules/taskSort';
import { ACTIVE_TASK_STATUSES, FINAL_TASK_STATUSES, isActiveTaskStatus } from '../../shared/rules/taskStatus';
import { topicFilterIds } from '../../shared/rules/topics';
import type { TaskStatus } from '../../shared/schema';
import { Avatar, cx, ListSkeleton, LoadError, Pill } from '../../ui/bits';
import { IconPlus } from '../../ui/icons';
import { Menu, type MenuOption } from '../../ui/Menu';
import { SearchButton } from '../../ui/SearchOverlay';
import { DecisionDetail } from '../knowledge/DecisionDetail';
import { BACK_TO_AGENDA } from '../knowledge/DetailParts';
import { QuestionSheet } from '../knowledge/KnowledgeSheets';
import { QuestionDetail } from '../knowledge/QuestionDetail';
import { TaskCard } from '../tasks/TaskCard';
import { TaskCreateSheet } from '../tasks/TaskCreateSheet';
import { TaskDetail } from '../tasks/TaskDetail';

const KINDS: [AgendaKind, string][] = [
  ['alles', 'Alles'],
  ['aufgaben', 'Aufgaben'],
  ['fragen', 'Fragen'],
];
const SCOPES: [AgendaScope, string][] = [
  ['alle', 'Alle'],
  ['meine', 'Meine'],
  ['folge', 'Folge ich'],
];
const ALL = '__alle__';

type OpenMenu = 'art' | 'scope' | 'thema' | 'status' | 'event' | null;

/** Was rechts offen ist: Aufgabe, Frage oder ein Eintrag „Stimmt das noch?“ */
export type AgendaDetail = 'task' | 'question' | 'decision';

export function AgendaScreen({ detail = 'task' }: { detail?: AgendaDetail }) {
  const { id } = useParams();
  return (
    <ListDetailLayout
      detailOpen={!!id}
      list={<AgendaList selectedId={id ?? null} />}
      detail={
        !id ? null : detail === 'question' ? (
          <QuestionDetail key={id} questionId={id} />
        ) : detail === 'decision' ? (
          <DecisionDetail key={id} decisionId={id} back={BACK_TO_AGENDA} />
        ) : (
          <TaskDetail key={id} taskId={id} />
        )
      }
    />
  );
}

function AgendaList({ selectedId }: { selectedId: string | null }) {
  const me = useMe();
  const { barVisible } = useFeedback();
  const { topics, topicName, events, eventById } = useLookups();
  const { filter, setFilter } = useAgendaFilter();
  const { data: tasks, error, reload } = useData('tasks', () => api.listTasks());
  const {
    data: questions,
    error: questionsError,
    reload: reloadQuestions,
  } = useData('questions', () => api.listQuestions());
  const loadError = (!tasks && error) || (!questions && questionsError) || null;
  const { data: decisions } = useData('decisions', () => api.listDecisions());
  const [menu, setMenu] = useState<OpenMenu>(null);
  const [creating, setCreating] = useState<'task' | 'question' | null>(null);
  const today = toIsoDate(new Date());

  const visibleTasks = useMemo(
    () => sortTasks(applyTaskFilter(tasks ?? [], filter, me.id, topics), today),
    [tasks, filter, me.id, topics, today],
  );
  const visibleQuestions = useMemo(() => {
    const shown = applyQuestionFilter(questions ?? [], filter, me.id, topics);
    return filter.done
      ? [...shown].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      : sortQuestions(shown);
  }, [questions, filter, me.id, topics]);
  // „Stimmt das noch?“: nur in der offenen Agenda, ohne Einschränkung auf Personen, Status oder Veranstaltung
  const toReview = useMemo(() => {
    if (filter.kind !== 'alles' || filter.done || filter.scope !== 'alle' || filter.status || filter.eventId)
      return [];
    const topicIds = filter.topicId ? topicFilterIds(filter.topicId, topics) : null;
    return (decisions ?? []).filter(
      (d) => d.marked && d.status === 'gueltig' && (!topicIds || topicIds.has(d.topic_id)),
    );
  }, [decisions, filter, topics]);

  const open = (tasks ?? []).filter((t) => isActiveTaskStatus(t.status));
  const openQuestions = (questions ?? []).filter((q) => q.status === 'offen').length;
  const summary = [
    `${open.length} AUFGABEN OFFEN`,
    `${open.filter((t) => isOverdue(t.due_date, t.status, today)).length} ÜBERFÄLLIG`,
    `${open.filter((t) => t.status === 'blockiert').length} BLOCKIERT`,
    `${openQuestions} ${openQuestions === 1 ? 'FRAGE' : 'FRAGEN'}`,
  ].join(' · ');

  const toggleMenu = (m: OpenMenu) => setMenu((current) => (current === m ? null : m));
  const menus: Record<
    Exclude<OpenMenu, null>,
    { label: string; options: MenuOption[]; pick: (key: string) => void }
  > = {
    art: {
      label: 'Art',
      options: KINDS.map(([key, label]) => ({ key, label, selected: filter.kind === key })),
      pick: (key) =>
        setFilter(
          key === 'fragen'
            ? { kind: 'fragen', status: null, scope: filter.scope === 'folge' ? 'alle' : filter.scope }
            : { kind: key as AgendaKind },
        ),
    },
    scope: {
      label: 'Grundmenge',
      options: SCOPES.map(([key, label]) => ({ key, label, selected: filter.scope === key })),
      pick: (key) => setFilter({ scope: key as AgendaScope }),
    },
    thema: {
      label: 'Thema',
      options: [
        { key: ALL, label: 'Alle Themen', selected: !filter.topicId },
        ...topics
          .filter((t) => !t.archived_at || t.id === filter.topicId)
          .map((t) => ({
            key: t.id,
            label: t.name,
            selected: filter.topicId === t.id,
            indent: !!t.parent_id,
          })),
      ],
      pick: (key) => setFilter({ topicId: key === ALL ? null : key }),
    },
    status: {
      label: 'Status einer Aufgabe',
      options: [
        { key: ALL, label: 'Jeder Status', selected: !filter.status },
        ...(filter.done ? FINAL_TASK_STATUSES : ACTIVE_TASK_STATUSES).map((s) => ({
          key: s,
          label: TASK_STATUS_LABEL[s],
          selected: filter.status === s,
        })),
      ],
      pick: (key) => setFilter({ status: key === ALL ? null : (key as TaskStatus) }),
    },
    event: {
      label: 'Veranstaltung',
      options: [
        { key: ALL, label: 'Alle Veranstaltungen', selected: !filter.eventId },
        ...[...events]
          .sort((a, b) => b.starts_at.localeCompare(a.starts_at))
          .map((e) => ({ key: e.id, label: e.title, selected: filter.eventId === e.id })),
      ],
      pick: (key) => setFilter({ eventId: key === ALL ? null : key }),
    },
  };
  const pills: [Exclude<OpenMenu, null>, string, boolean][] = [
    [
      'art',
      filter.kind === 'alles' ? 'Art' : KINDS.find(([k]) => k === filter.kind)![1],
      filter.kind !== 'alles',
    ],
    ['scope', SCOPES.find(([k]) => k === filter.scope)![1], filter.scope !== 'alle'],
    ['thema', filter.topicId ? topicName(filter.topicId) : 'Thema', !!filter.topicId],
    ['status', filter.status ? TASK_STATUS_LABEL[filter.status] : 'Status', !!filter.status],
    ['event', (filter.eventId && eventById.get(filter.eventId)?.title) || 'Veranstaltung', !!filter.eventId],
  ];

  const filtered =
    filter.kind !== 'alles' ||
    filter.scope !== 'alle' ||
    filter.done ||
    !!filter.topicId ||
    !!filter.status ||
    !!filter.eventId;
  const loaded = !!tasks && !!questions;
  const nothing = loaded && visibleTasks.length + visibleQuestions.length + toReview.length === 0;
  const empty: [title: string, text: string] = filtered
    ? ['Nichts gefunden', 'Mit diesen Filtern steht gerade nichts auf der Agenda.']
    : ['Die Agenda ist leer', 'Keine offenen Aufgaben und Fragen. Leg etwas Neues an.'];
  const showTasks = filter.kind !== 'fragen';
  const showQuestions = filter.kind !== 'aufgaben' && !filter.status && filter.scope !== 'folge';
  const sections = filter.kind === 'alles';

  return (
    <div className="flex min-h-dvh flex-col lg:min-h-0">
      <BarOffset px={92} />
      <div className="flex flex-col gap-4 px-5 pt-5">
        <div className="flex items-center lg:justify-end">
          <img src="/myzel-logo.png" alt="Myzel" className="h-11 w-[66px] object-contain lg:hidden" />
          <span className="flex-1" />
          <SearchButton first="aufgaben" />
          <Link to="/profil" aria-label="Profil" className="hit ml-2.5 flex size-10 no-underline">
            <Avatar member={me} size={40} fontSize={13} />
          </Link>
        </div>
        <div className="flex flex-col gap-1">
          <h1 className="m-0 text-[32px] leading-[1.15] font-bold tracking-[-1px]">Agenda</h1>
          <div className="font-mono text-[12px] text-leise">{loaded ? summary : ' '}</div>
        </div>
        {/* WF-AUF-01 / WF-AGE-01 Filter – speichern nichts */}
        <div className="relative">
          <div className="no-scrollbar -mx-5 -mt-1 flex gap-2 overflow-x-auto px-5 pt-1 pb-1">
            {pills.map(([key, label, on]) => (
              <Pill
                key={key}
                data-wf={key === 'art' ? 'WF-AGE-01' : 'WF-AUF-01'}
                on={on}
                aria-expanded={menu === key}
                aria-haspopup="true"
                onClick={() => toggleMenu(key)}
              >
                {label} ▾
              </Pill>
            ))}
            <Pill
              data-wf="WF-AUF-01"
              on={filter.done}
              onClick={() => {
                setMenu(null);
                setFilter({ done: !filter.done });
              }}
            >
              Abgeschlossene
            </Pill>
          </div>
          {menu && (
            <Menu
              wf={menu === 'art' ? 'WF-AGE-01' : 'WF-AUF-01'}
              label={menus[menu].label}
              options={menus[menu].options}
              onClose={() => setMenu(null)}
              onPick={(key) => {
                menus[menu].pick(key);
                setMenu(null);
              }}
            />
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 px-5 pt-3.5 pb-[180px] lg:pb-28">
        {!loaded && !loadError && <ListSkeleton />}
        {loadError && (
          <LoadError
            message={loadError.message}
            onRetry={() => {
              reload();
              reloadQuestions();
            }}
          />
        )}

        {toReview.length > 0 && (
          <>
            <span className="label-mono">Stimmt das noch?</span>
            {toReview.map((d) => (
              <ReviewCard key={d.id} d={d} selected={d.id === selectedId} />
            ))}
          </>
        )}

        {loaded && showTasks && (
          <>
            {sections && visibleTasks.length > 0 && (toReview.length > 0 || visibleQuestions.length > 0) && (
              <span className="label-mono pt-1">{filter.done ? 'Abgeschlossene Aufgaben' : 'Aufgaben'}</span>
            )}
            {visibleTasks.map((t) => (
              <TaskCard key={t.id} task={t} today={today} selected={t.id === selectedId} />
            ))}
          </>
        )}

        {loaded && showQuestions && (visibleQuestions.length > 0 || filter.kind === 'fragen') && (
          <>
            <div className="flex min-h-8 items-center justify-between pt-1">
              <span className="label-mono">
                {filter.done
                  ? 'Geklärte und verworfene Fragen'
                  : 'Offene Fragen · nach Dringlichkeit und Alter'}
              </span>
              {!filter.done && (
                <button
                  type="button"
                  data-wf="WF-FRA-01"
                  onClick={() => setCreating('question')}
                  className="hit h-8 text-[13px] text-pink"
                >
                  + Frage
                </button>
              )}
            </div>
            {visibleQuestions.map((q) => (
              <QuestionCard key={q.id} q={q} selected={q.id === selectedId} />
            ))}
          </>
        )}

        {/* WF-ALL-05 Leerzustand */}
        {nothing && (
          <div data-wf="WF-ALL-05" className="flex flex-col items-center gap-3 px-4 py-10 text-center">
            <span className="text-[16px] font-semibold">{empty[0]}</span>
            <span className="text-[14px] leading-normal text-leise">{empty[1]}</span>
            <div className="flex flex-wrap justify-center gap-2">
              {filtered && (
                <button
                  type="button"
                  data-wf="WF-AUF-01"
                  onClick={() => setFilter(DEFAULT_AGENDA_FILTER)}
                  className="hit flex h-[42px] items-center rounded-[21px] border border-rand-stark px-[18px] text-[14px] text-text"
                >
                  Filter zurücksetzen
                </button>
              )}
              {!filter.done && (
                <>
                  <button
                    type="button"
                    data-wf="WF-AUF-03"
                    onClick={() => setCreating('task')}
                    className="hit flex h-[42px] items-center rounded-[21px] border border-rand-stark px-[18px] text-[14px] text-text"
                  >
                    + Neue Aufgabe
                  </button>
                  <button
                    type="button"
                    data-wf="WF-FRA-01"
                    onClick={() => setCreating('question')}
                    className="hit flex h-[42px] items-center rounded-[21px] border border-rand-stark px-[18px] text-[14px] text-text"
                  >
                    + Frage
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* WF-AUF-03 Schnellanlage öffnen – weicht der Rückgängig-Leiste */}
      {!barVisible && (
        <button
          type="button"
          data-wf="WF-AUF-03"
          onClick={() => setCreating('task')}
          aria-label="Aufgabe anlegen"
          className="bg-marke fixed right-5 bottom-[calc(96px+env(safe-area-inset-bottom,0px))] z-10 flex size-[58px] items-center justify-center rounded-full text-grund shadow-[0_8px_24px_rgba(157,110,240,0.45)] lg:right-auto lg:bottom-6 lg:left-[562px]"
        >
          <IconPlus size={26} />
        </button>
      )}
      {creating === 'task' && <TaskCreateSheet onClose={() => setCreating(null)} />}
      {creating === 'question' && <QuestionSheet onClose={() => setCreating(null)} />}
    </div>
  );
}

/** Karte einer Frage auf der Agenda */
function QuestionCard({ q, selected }: { q: QuestionListItem; selected: boolean }) {
  const { topicName, eventById } = useLookups();
  const [now] = useState(() => Date.now());
  const open = q.status === 'offen';
  const days = Math.floor((now - new Date(q.created_at).getTime()) / 86_400_000);
  const event = q.event_id ? eventById.get(q.event_id)?.title : null;
  const meta = [
    'Frage',
    open ? PRIORITY_LABEL[q.urgency] : QUESTION_STATUS_LABEL[q.status],
    open && (days <= 0 ? 'seit heute' : days === 1 ? 'seit gestern' : `seit ${days} Tagen`),
    event ? `Event ${event}` : topicName(q.topic_id),
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Link
      to={`/agenda/frage/${q.id}`}
      data-wf="WF-AGE-01"
      className={cx(
        'flex flex-col gap-2 rounded-2xl border border-linie px-4 py-3.5 text-text no-underline',
        selected ? 'bg-erhoeht' : 'bg-flaeche',
      )}
    >
      <span className={cx('label-mono', open && q.urgency === 'hoch' && 'text-bernstein')}>{meta}</span>
      <span className={cx('text-[17px] leading-[1.3] font-semibold', !open && 'text-weich')}>{q.title}</span>
      {q.results.length > 0 && (
        <span className="text-[13px] leading-[1.4] text-leise">
          {q.results.length === 1
            ? `→ ${DECISION_KIND_LABEL[q.results[0]!.kind]}: ${q.results[0]!.title}`
            : `→ ${q.results.length} Ergebnisse festgehalten`}
        </span>
      )}
      {q.status === 'geklaert' && q.answer && (
        <span className="text-[13px] leading-[1.4] text-leise">Antwort: {q.answer}</span>
      )}
    </Link>
  );
}

/** 16.1: Entscheidung oder Fakt, ausdrücklich auf die Agenda gesetzt – „Stimmt das noch?“ */
function ReviewCard({ d, selected }: { d: DecisionListItem; selected: boolean }) {
  const { topicName } = useLookups();
  return (
    <Link
      to={`/agenda/eintrag/${d.id}`}
      data-wf="WF-AGE-03"
      className={cx(
        'flex flex-col gap-2 rounded-2xl border border-pink px-4 py-3.5 text-text no-underline',
        selected ? 'bg-erhoeht' : 'bg-flaeche',
      )}
    >
      <span className="label-mono">
        {DECISION_KIND_LABEL[d.kind]} · {topicName(d.topic_id)}
      </span>
      <span className="text-[17px] leading-[1.3] font-semibold">{d.title}</span>
      <span className="text-[13px] text-pink">Stimmt das noch?</span>
    </Link>
  );
}
