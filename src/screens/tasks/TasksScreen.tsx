// S-10 Aufgabenliste · P1 – am Desktop mit der Detailansicht daneben
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ListDetailLayout } from '../../app/AppShell';
import { BarOffset, useFeedback } from '../../app/feedback';
import { useLookups } from '../../app/lookups';
import { useMe } from '../../app/session';
import { applyTaskFilter, DEFAULT_TASK_FILTER, useTaskFilter, type TaskScope } from '../../app/taskFilter';
import { useData } from '../../app/useData';
import { api } from '../../data';
import { TASK_STATUS_LABEL } from '../../shared/labels';
import { isOverdue, toIsoDate } from '../../shared/rules/due';
import { sortTasks } from '../../shared/rules/taskSort';
import { ACTIVE_TASK_STATUSES, FINAL_TASK_STATUSES, isActiveTaskStatus } from '../../shared/rules/taskStatus';
import type { TaskStatus } from '../../shared/schema';
import { Avatar, ListSkeleton, LoadError, Pill } from '../../ui/bits';
import { IconPlus } from '../../ui/icons';
import { Menu, type MenuOption } from '../../ui/Menu';
import { SearchButton } from '../../ui/SearchOverlay';
import { TaskCard } from './TaskCard';
import { TaskCreateSheet } from './TaskCreateSheet';
import { TaskDetail } from './TaskDetail';

const SCOPES: [TaskScope, string][] = [
  ['alle', 'Alle'],
  ['meine', 'Meine'],
  ['folge', 'Folge ich'],
];
const ALL = '__alle__';

type OpenMenu = 'scope' | 'thema' | 'status' | 'event' | null;

export function TasksScreen() {
  const { taskId } = useParams();
  return (
    <ListDetailLayout
      detailOpen={!!taskId}
      list={<TaskList selectedId={taskId ?? null} />}
      detail={taskId ? <TaskDetail key={taskId} taskId={taskId} /> : null}
    />
  );
}

function TaskList({ selectedId }: { selectedId: string | null }) {
  const me = useMe();
  const { barVisible } = useFeedback();
  const { topics, topicName, events, eventById } = useLookups();
  const { filter, setFilter } = useTaskFilter();
  const { data: tasks, error, reload } = useData('tasks', () => api.listTasks());
  const [menu, setMenu] = useState<OpenMenu>(null);
  const [creating, setCreating] = useState(false);
  const today = toIsoDate(new Date());

  const visible = useMemo(
    () => sortTasks(applyTaskFilter(tasks ?? [], filter, me.id, topics), today),
    [tasks, filter, me.id, topics, today],
  );
  const open = (tasks ?? []).filter((t) => isActiveTaskStatus(t.status));
  const summary = `${open.length} OFFEN · ${open.filter((t) => isOverdue(t.due_date, t.status, today)).length} ÜBERFÄLLIG · ${open.filter((t) => t.status === 'blockiert').length} BLOCKIERT`;

  const scopeLabel = SCOPES.find(([k]) => k === filter.scope)![1];
  const toggleMenu = (m: OpenMenu) => setMenu((current) => (current === m ? null : m));

  const menus: Record<
    Exclude<OpenMenu, null>,
    { label: string; options: MenuOption[]; pick: (key: string) => void }
  > = {
    scope: {
      label: 'Grundmenge',
      options: SCOPES.map(([key, label]) => ({ key, label, selected: filter.scope === key })),
      pick: (key) => setFilter({ scope: key as TaskScope }),
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
      label: 'Status',
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

  const narrowed =
    filter.scope === 'folge' || filter.done || !!filter.topicId || !!filter.status || !!filter.eventId;
  const empty: [title: string, text: string] =
    filter.plenum && !filter.done
      ? [
          'Nichts fürs Plenum markiert',
          'Tippe auf das Lesezeichen einer Aufgabe, damit sie auf die nächste Agenda kommt.',
        ]
      : narrowed
        ? ['Nichts gefunden', 'Mit diesen Filtern gibt es gerade keine Aufgaben.']
        : filter.scope === 'meine'
          ? ['Du hast gerade keine Aufgaben', 'Übernimm etwas aus der Liste oder leg eine neue Aufgabe an.']
          : ['Noch keine Aufgaben', 'Hier ist gerade nichts. Leg eine neue Aufgabe an.'];
  const filtered = filter.plenum || narrowed || filter.scope !== 'alle';

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
          <h1 className="m-0 text-[32px] leading-[1.15] font-bold tracking-[-1px]">Aufgaben</h1>
          <div className="font-mono text-[12px] text-leise">{tasks ? summary : ' '}</div>
        </div>
        {/* WF-AUF-01 Filter – speichert nichts */}
        <div className="relative">
          <div className="no-scrollbar -mx-5 -mt-1 flex gap-2 overflow-x-auto px-5 pt-1 pb-1">
            <Pill
              data-wf="WF-AUF-01"
              on={filter.scope !== 'alle'}
              aria-expanded={menu === 'scope'}
              aria-haspopup="true"
              onClick={() => toggleMenu('scope')}
            >
              {scopeLabel} ▾
            </Pill>
            <Pill
              data-wf="WF-AUF-01"
              on={filter.plenum}
              onClick={() => {
                setMenu(null);
                setFilter({ plenum: !filter.plenum });
              }}
            >
              Fürs Plenum
            </Pill>
            <Pill
              data-wf="WF-AUF-01"
              on={!!filter.topicId}
              aria-expanded={menu === 'thema'}
              aria-haspopup="true"
              onClick={() => toggleMenu('thema')}
            >
              {filter.topicId ? topicName(filter.topicId) : 'Thema'} ▾
            </Pill>
            <Pill
              data-wf="WF-AUF-01"
              on={!!filter.status}
              aria-expanded={menu === 'status'}
              aria-haspopup="true"
              onClick={() => toggleMenu('status')}
            >
              {filter.status ? TASK_STATUS_LABEL[filter.status] : 'Status'} ▾
            </Pill>
            <Pill
              data-wf="WF-AUF-01"
              on={!!filter.eventId}
              aria-expanded={menu === 'event'}
              aria-haspopup="true"
              onClick={() => toggleMenu('event')}
            >
              {(filter.eventId && eventById.get(filter.eventId)?.title) || 'Veranstaltung'} ▾
            </Pill>
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
              wf="WF-AUF-01"
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
        {!tasks && !error && <ListSkeleton />}
        {!tasks && error && <LoadError message={error.message} onRetry={reload} />}
        {visible.map((t) => (
          <TaskCard key={t.id} task={t} today={today} selected={t.id === selectedId} />
        ))}
        {/* WF-ALL-05 Leerzustand */}
        {tasks && visible.length === 0 && (
          <div data-wf="WF-ALL-05" className="flex flex-col items-center gap-3 px-4 py-10 text-center">
            <span className="text-[16px] font-semibold">{empty[0]}</span>
            <span className="text-[14px] leading-normal text-leise">{empty[1]}</span>
            <div className="flex flex-wrap justify-center gap-2">
              {filtered && (
                <button
                  type="button"
                  data-wf="WF-AUF-01"
                  onClick={() => setFilter(DEFAULT_TASK_FILTER)}
                  className="hit flex h-[42px] items-center rounded-[21px] border border-rand-stark px-[18px] text-[14px] text-text"
                >
                  Filter zurücksetzen
                </button>
              )}
              {!filter.done && (
                <button
                  type="button"
                  data-wf="WF-AUF-03"
                  onClick={() => setCreating(true)}
                  className="hit flex h-[42px] items-center rounded-[21px] border border-rand-stark px-[18px] text-[14px] text-text"
                >
                  + Neue Aufgabe
                </button>
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
          onClick={() => setCreating(true)}
          aria-label="Aufgabe anlegen"
          className="bg-marke fixed right-5 bottom-[calc(96px+env(safe-area-inset-bottom,0px))] z-10 flex size-[58px] items-center justify-center rounded-full text-grund shadow-[0_8px_24px_rgba(157,110,240,0.45)] lg:right-auto lg:bottom-6 lg:left-[562px]"
        >
          <IconPlus size={26} />
        </button>
      )}
      {creating && <TaskCreateSheet onClose={() => setCreating(false)} />}
    </div>
  );
}
