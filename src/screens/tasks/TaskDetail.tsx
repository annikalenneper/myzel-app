// S-12 Aufgabe – Detail · P1
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { clearDraft, readDraft, writeDraft } from '../../app/drafts';
import { BarOffset, useFeedback } from '../../app/feedback';
import { useLookups } from '../../app/lookups';
import { useMe } from '../../app/session';
import { useActions, useLatest } from '../../app/useActions';
import { optimisticPatch, useData } from '../../app/useData';
import { api } from '../../data';
import type { TaskDetail as TaskDetailData, TaskListItem } from '../../data/api';
import { formatCommentTime, formatHistoryTime } from '../../shared/format';
import { taskHistorySentence } from '../../shared/historyText';
import { PRIORITY_LABEL, TASK_STATUS_COLOR, TASK_STATUS_LABEL } from '../../shared/labels';
import { dueState, toIsoDate } from '../../shared/rules/due';
import { canTransitionTask, isActiveTaskStatus } from '../../shared/rules/taskStatus';
import { PRIORITIES, TASK_STATUSES, type Comment, type Member, type TaskStatus } from '../../shared/schema';
import { Avatar, cx, FieldError, ListSkeleton, LoadError, PriorityBars } from '../../ui/bits';
import { DateTile } from '../../ui/DateTile';
import { IconBack, IconBookmark, IconMore, IconSend } from '../../ui/icons';
import { LinkedDocuments } from '../knowledge/LinkedDocuments';
import { ArchiveSheet, BlockSheet, DiscardSheet, PeopleSheet, PickerSheet } from './sheets';

type SheetKind =
  | 'appointment'
  | 'document'
  | 'block'
  | 'discard'
  | 'assign'
  | 'followers'
  | 'archive'
  | 'topic'
  | 'priority'
  | 'event'
  | 'blocker';

const SUBJECT = 'diese Aufgabe';

export function TaskDetail({ taskId }: { taskId: string }) {
  const { data: task, error, reload } = useData(`task:${taskId}`, () => api.getTask(taskId));

  if (!task) {
    return (
      <div className="flex min-h-dvh flex-col lg:min-h-0">
        <TopBar />
        <div className="px-5 py-[18px]">
          {error?.code === 'not_found' ? (
            <div data-wf="WF-ALL-05" className="flex flex-col items-center gap-3 py-10 text-center">
              <span className="text-[16px] font-semibold">Diese Aufgabe gibt es nicht</span>
              <Link to="/aufgaben" className="hit text-[14px] text-pink">
                Zur Aufgabenliste
              </Link>
            </div>
          ) : error ? (
            <LoadError message={error.message} onRetry={reload} />
          ) : (
            <ListSkeleton />
          )}
        </div>
      </div>
    );
  }
  return <Loaded task={task} />;
}

function TopBar({ label, children }: { label?: string; children?: React.ReactNode }) {
  return (
    <div className="sticky top-0 z-10 flex h-[60px] flex-none items-center gap-1 border-b border-linie bg-grund px-3">
      <Link
        to="/aufgaben"
        aria-label="Zurück zu Aufgaben"
        className="flex size-11 items-center justify-center text-text"
      >
        <IconBack />
      </Link>
      <span className="font-mono text-[13px] whitespace-nowrap text-leise">{label}</span>
      <span className="flex-1" />
      {children}
    </div>
  );
}

function Loaded({ task }: { task: TaskDetailData }) {
  const me = useMe();
  const navigate = useNavigate();
  const { activeMembers, memberById, topics, topicName, topicById, events, eventById } = useLookups();
  const act = useActions();
  const { notify } = useFeedback();
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  const [menu, setMenu] = useState(false);
  const [tab, setTab] = useState<'comments' | 'history'>('comments');
  const { data: allTasks } = useData('tasks', () => api.listTasks());
  const { data: appointments } = useData('appointments', () => api.listAppointments());
  const { data: documents } = useData(`task-documents:${task.id}`, () =>
    api.listLinkedDocuments('task', task.id),
  );
  const appointment = task.appointment_id
    ? appointments?.find((x) => x.id === task.appointment_id)
    : undefined;

  const archived = !!task.archived_at;
  const active = isActiveTaskStatus(task.status);
  const following = task.follower_ids.includes(me.id);
  const today = toIsoDate(new Date());
  const due = dueState(task.due_date, task.status, today);
  const event = task.event_id ? eventById.get(task.event_id) : undefined;
  // die version wird erst beim Start einer Aktion gelesen – Aktionen können in der Reihe warten
  const latest = useLatest(task.version);

  /** erwartete Wirkung auf Detail und Liste – sofort sichtbar, bis der Server bestätigt (16.6) */
  const onTask = (change: (t: TaskListItem) => Partial<TaskListItem>) => [
    optimisticPatch<TaskDetailData>(`task:${task.id}`, (t) => ({ ...t, ...change(t) })),
    optimisticPatch<TaskListItem[]>('tasks', (list) =>
      list.map((t) => (t.id === task.id ? { ...t, ...change(t) } : t)),
    ),
  ];
  const withId = (ids: string[], id: string) => (ids.includes(id) ? ids : [...ids, id]);
  const withoutId = (ids: string[], id: string) => ids.filter((x) => x !== id);

  const setStatus = (status: TaskStatus) =>
    act(() => api.setTaskStatus(task.id, { status, version: latest.current }), {
      subject: SUBJECT,
      // wer ändert, folgt; wer loslegt, wird Bearbeitende*r (4.1)
      optimistic: onTask((t) => ({
        status,
        follower_ids: withId(t.follower_ids, me.id),
        ...(status === 'in_arbeit' && { assignee_ids: withId(t.assignee_ids, me.id) }),
      })),
      success: (r) =>
        `${task.status === 'blockiert' && isActiveTaskStatus(status) ? 'Blockade gelöst · ' : 'Status: '}${TASK_STATUS_LABEL[status]}${r.self_assigned ? ' · du bist eingetragen' : ''}`,
      undo: (r) => r.undo_token,
    });

  const pickStatus = (status: TaskStatus) => {
    if (status === task.status || !canTransitionTask(task.status, status)) return;
    if (status === 'blockiert') setSheet('block');
    else if (status === 'verworfen') setSheet('discard');
    else void setStatus(status);
  };

  const saveFields = (fields: Parameters<typeof api.updateTaskFields>[1], ownInput?: string) =>
    act(() => api.updateTaskFields(task.id, fields, latest.current), {
      subject: SUBJECT,
      success: 'Gespeichert',
      ownInput,
    });

  const toggleMark = () =>
    void act(() => api.setPlenumMark(task.id, !task.marked), {
      success: task.marked ? 'Markierung entfernt' : 'Fürs Plenum markiert',
      undo: (r) => r.undo_token,
    });

  const archive = () =>
    void act(() => api.archiveTask(task.id, latest.current), {
      subject: SUBJECT,
      success: 'Archiviert',
      undo: (r) => r.undo_token,
    });

  const toggleFollow = () =>
    void act(() => (following ? api.removeFollower(task.id, me.id) : api.addFollower(task.id, me.id)), {
      optimistic: onTask((t) => ({
        follower_ids: following ? withoutId(t.follower_ids, me.id) : withId(t.follower_ids, me.id),
      })),
      success: following ? 'Du folgst nicht mehr' : 'Du folgst jetzt',
      undo: (r) => r.undo_token,
    });

  const addPerson = (kind: 'assign' | 'followers', m: Member) =>
    void act(() => (kind === 'assign' ? api.addAssignee(task.id, m.id) : api.addFollower(task.id, m.id)), {
      subject: SUBJECT,
      optimistic: onTask((t) =>
        kind === 'assign'
          ? { assignee_ids: withId(t.assignee_ids, m.id) }
          : { follower_ids: withId(t.follower_ids, m.id) },
      ),
      success: `${m.display_name} eingetragen`,
      undo: (r) => r.undo_token,
    });

  const removePerson = (kind: 'assign' | 'followers', m: Pick<Member, 'id' | 'display_name'>) =>
    void act<{ undo_token: string; status_reset?: boolean }>(
      () => (kind === 'assign' ? api.removeAssignee(task.id, m.id) : api.removeFollower(task.id, m.id)),
      {
        subject: SUBJECT,
        optimistic: onTask((t) =>
          kind === 'assign'
            ? { assignee_ids: withoutId(t.assignee_ids, m.id) }
            : { follower_ids: withoutId(t.follower_ids, m.id) },
        ),
        success: (r) => `${m.display_name} entfernt${r.status_reset ? ' · Status zurück auf Geplant' : ''}`,
        undo: (r) => r.undo_token,
      },
    );

  const blockerCandidates = useMemo(() => {
    const taken = new Set(task.blockers.map((b) => b.id));
    return (allTasks ?? [])
      .filter((t) => t.id !== task.id && !taken.has(t.id) && isActiveTaskStatus(t.status))
      .sort((a, b) => Number(b.event_id === task.event_id) - Number(a.event_id === task.event_id));
  }, [allTasks, task.blockers, task.id, task.event_id]);

  const look = useMemo(
    () => ({
      memberName: (id: string) => memberById.get(id)?.display_name ?? 'Jemand',
      topicName,
      eventTitle: (id: string) => eventById.get(id)?.title ?? 'eine Veranstaltung',
      taskTitle: (id: string) => (allTasks ?? []).find((t) => t.id === id)?.title ?? 'eine andere Aufgabe',
    }),
    [memberById, topicName, eventById, allTasks],
  );

  const blockerRows = (
    <>
      {task.blockers.map((b) => (
        <div key={b.id} className="flex items-center gap-1 rounded-[10px] bg-flaeche pr-1 pl-3">
          <Link
            to={`/aufgaben/${b.id}`}
            className="flex min-h-11 flex-1 items-center gap-2.5 py-1.5 text-text no-underline"
          >
            <span className="label-mono flex-none">Wartet auf</span>
            <span className="flex-1 text-[14px] font-medium">{b.title}</span>
            <span
              className="size-2 flex-none rounded-full"
              role="img"
              aria-label={TASK_STATUS_LABEL[b.status]}
              style={{ background: TASK_STATUS_COLOR[b.status] }}
            />
          </Link>
          <button
            type="button"
            data-wf="WF-AUF-07"
            aria-label={`Abhängigkeit entfernen: ${b.title}`}
            onClick={() =>
              void act(() => api.removeBlocker(task.id, b.id), { success: 'Abhängigkeit entfernt' })
            }
            className="hit size-7 flex-none rounded-full text-[16px] text-leise"
          >
            ×
          </button>
        </div>
      ))}
    </>
  );

  return (
    <div className="flex min-h-dvh flex-col lg:min-h-0">
      <BarOffset px={archived ? 24 : 88} />
      <TopBar label={`AUFGABE #${String(task.number).padStart(3, '0')}`}>
        {!archived && (
          <button
            type="button"
            data-wf="WF-AUF-11"
            onClick={toggleFollow}
            aria-pressed={following}
            className={cx(
              'hit h-[34px] flex-none rounded-[17px] border px-3 font-mono text-[12px] whitespace-nowrap text-text',
              following ? 'border-violett' : 'border-rand',
            )}
          >
            {following ? '✓ FOLGE ICH' : 'FOLGEN'}
          </button>
        )}
        {!archived && (
          <div className="relative">
            <button
              type="button"
              data-wf="WF-AUF-14"
              onClick={() => setMenu(!menu)}
              aria-label="Weitere Aktionen"
              aria-expanded={menu}
              className="flex size-11 items-center justify-center text-text"
            >
              <IconMore />
            </button>
            {menu && (
              <>
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label="Menü schließen"
                  onClick={() => setMenu(false)}
                  className="fixed inset-0 z-[5] cursor-default"
                />
                <div className="absolute top-full right-1 z-[6] flex w-[200px] flex-col gap-0.5 rounded-[14px] border border-rand bg-erhoeht p-1.5 shadow-[0_12px_28px_rgba(0,0,0,0.5)]">
                  {/* WF-AUF-14: Bestätigung nur bei Kommentaren, sonst sofort mit Rückgängig */}
                  <button
                    type="button"
                    data-wf="WF-AUF-14"
                    onClick={() => {
                      setMenu(false);
                      if (task.comments.length > 0) setSheet('archive');
                      else archive();
                    }}
                    className="flex min-h-11 items-center rounded-[10px] px-3 text-left text-[15px] text-rot-hell"
                  >
                    Archivieren
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </TopBar>

      <div className="flex flex-1 flex-col gap-[18px] px-5 pt-[18px] pb-10">
        {archived && (
          <div className="flex items-center gap-2.5 rounded-[14px] border border-rand bg-erhoeht px-3.5 py-3">
            <span className="flex-1 text-[14px] text-weich">Archiviert – nicht mehr in den Listen.</span>
            <button
              type="button"
              data-wf="WF-AUF-14"
              onClick={() =>
                void act(() => api.restoreTask(task.id, latest.current), {
                  subject: SUBJECT,
                  success: 'Wiederhergestellt',
                })
              }
              className="hit h-[34px] rounded-[17px] border border-rand-stark px-3 text-[13px] text-text"
            >
              Wiederherstellen
            </button>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <TitleField
            key={task.title}
            title={task.title}
            disabled={archived}
            onSave={(title) => saveFields({ title }, title)}
          />
          {/* WF-AUF-02 – nur bei aktiven, nicht archivierten Aufgaben */}
          {active && !archived && (
            <button
              type="button"
              data-wf="WF-AUF-02"
              onClick={toggleMark}
              aria-pressed={task.marked}
              className={cx(
                'hit flex h-8 items-center gap-1.5 self-start rounded-2xl border px-3 text-[13px]',
                task.marked ? 'border-pink bg-[rgba(240,98,192,0.14)] text-pink' : 'border-rand text-weich',
              )}
            >
              <IconBookmark filled={task.marked} size={14} strokeWidth={2} />
              {task.marked ? 'Fürs Plenum markiert' : 'Fürs Plenum markieren'}
            </button>
          )}
        </div>

        <div
          className={cx('flex flex-col gap-[18px]', archived && 'pointer-events-none opacity-45')}
          inert={archived}
        >
          <div className="flex flex-col gap-2">
            <span id="status-label" className="label-mono">
              Status
            </span>
            {!active && (
              <span className="text-[13px] text-leise">Wieder öffnen über „Geplant“ oder „In Arbeit“.</span>
            )}
            {/* WF-AUF-06 Status-Chips; Blockiert → WF-AUF-07; Erledigt/Verworfen/Wieder öffnen → WF-AUF-09 */}
            <div role="group" aria-labelledby="status-label" className="flex flex-wrap gap-1.5">
              {TASK_STATUSES.map((s) => {
                const on = task.status === s;
                const allowed = canTransitionTask(task.status, s);
                return (
                  <button
                    key={s}
                    type="button"
                    data-wf={
                      s === 'blockiert'
                        ? 'WF-AUF-07'
                        : s === 'erledigt' || s === 'verworfen' || !active
                          ? 'WF-AUF-09'
                          : task.status === 'blockiert'
                            ? 'WF-AUF-08'
                            : 'WF-AUF-06'
                    }
                    onClick={() => pickStatus(s)}
                    aria-pressed={on}
                    aria-disabled={!on && !allowed}
                    className={cx(
                      'hit flex h-[34px] items-center gap-1.5 rounded-[17px] border px-3 text-[13px] font-medium',
                      on ? 'border-text bg-text text-grund' : 'border-rand text-weich',
                      !on && !allowed && 'cursor-default opacity-35',
                    )}
                  >
                    <span className="size-[7px] rounded-full" style={{ background: TASK_STATUS_COLOR[s] }} />
                    {TASK_STATUS_LABEL[s]}
                  </button>
                );
              })}
            </div>
          </div>

          {task.status === 'blockiert' && (
            <div className="flex flex-col gap-2.5 rounded-[14px] border border-rot-rand bg-rot-flaeche p-3.5">
              <div className="font-mono text-[11px] text-rot-hell">
                {task.block_reason ? 'BLOCKIERT – GRUND' : 'BLOCKIERT – WARTET AUF'}
              </div>
              {task.block_reason && (
                <div className="text-[15px] leading-[1.45] whitespace-pre-wrap">{task.block_reason}</div>
              )}
              {blockerRows}
              {/* WF-AUF-08 Blockade lösen */}
              <div className="flex items-center gap-2">
                <span className="flex-1 text-[13px] text-weich">Blockade lösen →</span>
                <button
                  type="button"
                  data-wf="WF-AUF-08"
                  onClick={() => void setStatus('geplant')}
                  className="hit h-[34px] rounded-[17px] border border-rand-stark px-3 text-[13px] text-text"
                >
                  Geplant
                </button>
                <button
                  type="button"
                  data-wf="WF-AUF-08"
                  onClick={() => void setStatus('in_arbeit')}
                  className="hit h-[34px] rounded-[17px] bg-geplant px-3 text-[13px] font-semibold text-grund"
                >
                  In Arbeit
                </button>
              </div>
            </div>
          )}

          {task.status === 'verworfen' && (
            <div className="rounded-[14px] border border-linie bg-flaeche px-3.5 py-3 text-[14px] leading-[1.45] text-weich">
              Verworfen{task.discard_reason ? ` – Grund: ${task.discard_reason.replace(/[.!?]+$/, '')}` : ''}.
              Über „Geplant“ oder „In Arbeit“ wieder öffnen.
            </div>
          )}

          {/* WF-AUF-04 Felder: Thema, Priorität, Frist, Veranstaltung */}
          <div className="grid grid-cols-2 gap-2.5">
            <FieldTile label="Thema" span2 onClick={() => setSheet('topic')}>
              {topicName(task.topic_id)}
              {topicById.get(task.topic_id)?.archived_at && <span className="text-leise"> · archiviert</span>}
            </FieldTile>
            <FieldTile label="Priorität" onClick={() => setSheet('priority')}>
              <span className="flex items-center gap-2">
                <PriorityBars priority={task.priority} small />
                {PRIORITY_LABEL[task.priority]}
              </span>
            </FieldTile>
            {/* der Datumswähler liefert vollständige Werte: gespeichert wird bei der Auswahl */}
            <DateTile
              label="Frist"
              wf="WF-AUF-04"
              value={task.due_date ?? ''}
              tone={due === 'overdue' ? 'text-rot' : due === 'soon' ? 'text-bernstein' : 'text-text'}
              onChange={(value) => {
                if ((value || null) !== task.due_date) void saveFields({ due_date: value || null });
              }}
            />
            <FieldTile label="Veranstaltung" onClick={() => setSheet('event')}>
              {event ? (
                <span className="text-violett">{event.title}</span>
              ) : (
                <span className="text-leise">–</span>
              )}
            </FieldTile>
            <FieldTile label="Termin" onClick={() => setSheet('appointment')}>
              {appointment ? (
                <span className="text-violett">{appointment.title}</span>
              ) : (
                <span className="text-leise">–</span>
              )}
            </FieldTile>
          </div>

          <Description task={task} act={act} />

          {(
            [
              ['assign', 'WF-AUF-10', 'Bearbeitet von', 'Bearbeitende', task.assignee_ids],
              ['followers', 'WF-AUF-11', 'Folgen', 'Folgende', task.follower_ids],
            ] as const
          ).map(([kind, wf, title, noun, ids]) => (
            <div key={kind} className="flex flex-col gap-2">
              <span className="label-mono">{title}</span>
              <div className="flex flex-wrap items-center gap-2">
                {ids.map((id) => {
                  const m = memberById.get(id);
                  const name = m?.display_name ?? 'Unbekannt';
                  return (
                    <span
                      key={id}
                      className="flex h-11 items-center gap-2 rounded-[22px] border border-linie bg-flaeche px-1 text-[14px]"
                    >
                      <Avatar member={m} size={28} />
                      {name}
                      <button
                        type="button"
                        data-wf={wf}
                        onClick={() => removePerson(kind, { id, display_name: name })}
                        aria-label={`${noun} entfernen: ${name}`}
                        className="hit size-7 rounded-full text-[16px] text-leise"
                      >
                        ×
                      </button>
                    </span>
                  );
                })}
                <button
                  type="button"
                  data-wf={wf}
                  onClick={() => setSheet(kind)}
                  aria-label={`${noun} hinzufügen`}
                  className="hit size-9 rounded-full border border-dashed border-rand-stark text-[18px] text-leise"
                >
                  +
                </button>
              </div>
            </div>
          ))}

          {/* WF-AUF-13 Dokumente verknüpfen/lösen */}
          <LinkedDocuments
            wf="WF-AUF-13"
            target={{ type: 'task', id: task.id, kind: 'Aufgabe', name: task.title }}
            documents={documents}
          />

          {/* Abhängigkeiten (F-AUF-05), unabhängig vom Status „Blockiert“ (3.3) */}
          <div className="flex flex-col gap-2">
            <span className="label-mono">Hängt ab von</span>
            {task.status !== 'blockiert' && blockerRows}
            <button
              type="button"
              data-wf="WF-AUF-07"
              onClick={() => setSheet('blocker')}
              className="flex h-11 items-center justify-center rounded-xl border border-dashed border-rand-stark text-[14px] text-leise"
            >
              + Aufgabe, auf die diese wartet
            </button>
          </div>
        </div>

        {/* Reiter Kommentare (WF-AUF-12) / Verlauf (WF-AUF-15) */}
        <div role="tablist" className="flex gap-[22px] border-b border-linie">
          {(
            [
              ['comments', 'WF-AUF-12', `KOMMENTARE · ${task.comments.length}`],
              ['history', 'WF-AUF-15', 'VERLAUF'],
            ] as const
          ).map(([key, wf, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              data-wf={wf}
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={cx(
                '-mb-px min-h-11 border-b-2 py-2.5 font-mono text-[12px]',
                tab === key ? 'border-pink text-text' : 'border-transparent text-leise',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'comments' && (
          <div role="tabpanel" className="flex flex-col gap-3.5">
            {task.comments.length === 0 && (
              <span data-wf="WF-ALL-05" className="py-4 text-center text-[14px] text-leise">
                Noch keine Kommentare.{!archived && ' Schreib den ersten unten ins Feld.'}
              </span>
            )}
            {task.comments.map((c) => (
              <CommentRow
                key={c.id}
                comment={c}
                author={memberById.get(c.author_id)}
                own={c.author_id === me.id && !archived}
                act={act}
              />
            ))}
          </div>
        )}
        {tab === 'history' && (
          <div role="tabpanel" className="flex flex-col">
            {task.history.map((h) => (
              <div key={h.id} className="flex gap-3 border-b border-erhoeht py-2.5">
                <span className="w-[88px] flex-none font-mono text-[11px] whitespace-nowrap leading-[20px] text-leise">
                  {formatHistoryTime(h.created_at)}
                </span>
                <span className="text-[14px] leading-[1.4] text-weich">{taskHistorySentence(h, look)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {!archived && (
        <CommentBar taskId={task.id} following={following} act={act} onSent={() => setTab('comments')} />
      )}

      {sheet === 'block' && (
        <BlockSheet
          taskId={task.id}
          candidates={blockerCandidates}
          onClose={() => setSheet(null)}
          onConfirm={async (reason, blockerIds) => {
            let message: string | null = null;
            const ok = await act(
              () =>
                api.setTaskStatus(task.id, {
                  status: 'blockiert',
                  block_reason: reason,
                  blocker_ids: blockerIds,
                  version: latest.current,
                }),
              {
                subject: SUBJECT,
                ownInput: reason,
                draftKept: true,
                success: 'Blockiert',
                undo: (r) => r.undo_token,
                onInvalid: (e) => (message = e.message),
              },
            );
            if (ok) setSheet(null);
            return ok ? 'ok' : (message ?? 'failed');
          }}
        />
      )}
      {sheet === 'discard' && (
        <DiscardSheet
          onClose={() => setSheet(null)}
          onConfirm={(reason) => {
            setSheet(null);
            void act(
              () =>
                api.setTaskStatus(task.id, {
                  status: 'verworfen',
                  discard_reason: reason,
                  version: latest.current,
                }),
              {
                subject: SUBJECT,
                ownInput: reason || undefined,
                success: 'Verworfen',
                undo: (r) => r.undo_token,
              },
            );
          }}
        />
      )}
      {(sheet === 'assign' || sheet === 'followers') && (
        <PeopleSheet
          title={sheet === 'assign' ? 'Wer bearbeitet?' : 'Wer folgt?'}
          wf={sheet === 'assign' ? 'WF-AUF-10' : 'WF-AUF-11'}
          members={activeMembers}
          selectedIds={sheet === 'assign' ? task.assignee_ids : task.follower_ids}
          onClose={() => setSheet(null)}
          onToggle={(m, selected) => (selected ? removePerson(sheet, m) : addPerson(sheet, m))}
        />
      )}
      {sheet === 'archive' && (
        <ArchiveSheet
          commentCount={task.comments.length}
          onClose={() => setSheet(null)}
          onConfirm={() => {
            setSheet(null);
            archive();
          }}
        />
      )}
      {sheet === 'topic' && (
        <PickerSheet
          title="Thema"
          wf="WF-AUF-04"
          onClose={() => setSheet(null)}
          options={topics
            .filter((t) => !t.archived_at || t.id === task.topic_id)
            .map((t) => ({
              key: t.id,
              label: t.name,
              selected: t.id === task.topic_id,
              indent: !!t.parent_id,
            }))}
          onPick={(topic_id) => {
            setSheet(null);
            if (topic_id !== task.topic_id) void saveFields({ topic_id });
          }}
        />
      )}
      {sheet === 'priority' && (
        <PickerSheet
          title="Priorität"
          wf="WF-AUF-04"
          onClose={() => setSheet(null)}
          options={PRIORITIES.map((p) => ({
            key: p,
            selected: p === task.priority,
            label: (
              <>
                <PriorityBars priority={p} small />
                {PRIORITY_LABEL[p]}
              </>
            ),
          }))}
          onPick={(key) => {
            setSheet(null);
            const priority = PRIORITIES.find((p) => p === key)!;
            if (priority !== task.priority) void saveFields({ priority });
          }}
        />
      )}
      {sheet === 'event' && (
        <PickerSheet
          title="Veranstaltung"
          wf="WF-AUF-04"
          onClose={() => setSheet(null)}
          options={[
            { key: '', label: 'Keine Veranstaltung', selected: !task.event_id },
            ...[...events]
              .sort((a, b) => b.starts_at.localeCompare(a.starts_at))
              .map((e) => ({ key: e.id, label: e.title, selected: e.id === task.event_id })),
          ]}
          onPick={(key) => {
            setSheet(null);
            if ((key || null) !== task.event_id) void saveFields({ event_id: key || null });
          }}
          footer={
            event && (
              <button
                type="button"
                onClick={() => navigate(`/events/${event.id}`)}
                className="mt-1.5 h-11 flex-none text-[14px] text-violett"
              >
                {event.title} öffnen ↗
              </button>
            )
          }
        />
      )}
      {sheet === 'appointment' && (
        <PickerSheet
          title="Termin"
          wf="WF-AUF-04"
          onClose={() => setSheet(null)}
          options={[
            { key: '', label: 'Kein Termin', selected: !task.appointment_id },
            ...(appointments ?? [])
              .filter((x) => x.status === 'geplant' || x.id === task.appointment_id)
              .sort((x, y) => x.starts_at.localeCompare(y.starts_at))
              .map((x) => ({
                key: x.id,
                selected: x.id === task.appointment_id,
                label: (
                  <>
                    <span className="flex-1">{x.title}</span>
                    <span className="label-mono">{formatHistoryTime(x.starts_at).slice(0, 6)}</span>
                  </>
                ),
              })),
          ]}
          onPick={(key) => {
            setSheet(null);
            if ((key || null) !== task.appointment_id) void saveFields({ appointment_id: key || null });
          }}
          footer={
            appointment && (
              <button
                type="button"
                onClick={() => navigate(`/termine/${appointment.id}`)}
                className="mt-1.5 h-11 flex-none text-[14px] text-violett"
              >
                {appointment.title} öffnen ↗
              </button>
            )
          }
        />
      )}
      {sheet === 'blocker' && (
        <BlockerPicker
          candidates={blockerCandidates}
          onClose={() => setSheet(null)}
          onPick={(blockerId) => {
            setSheet(null);
            void act(() => api.addBlocker(task.id, blockerId), {
              success: 'Abhängigkeit eingetragen',
              onInvalid: (e) => notify(e.message),
            });
          }}
        />
      )}
    </div>
  );
}

type Act = ReturnType<typeof useActions>;

/** Blockierende Aufgabe per Suche wählen (F-AUF-07) */
function BlockerPicker({
  candidates,
  onPick,
  onClose,
}: {
  candidates: TaskListItem[];
  onPick: (taskId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = candidates.filter((t) => !q || t.title.toLowerCase().includes(q)).slice(0, 12);
  return (
    <PickerSheet
      title="Wartet auf …"
      wf="WF-AUF-07"
      onClose={onClose}
      onPick={onPick}
      header={
        <input
          type="search"
          data-wf="WF-AUF-07"
          aria-label="Aufgabe suchen"
          placeholder="Aufgabe suchen …"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-11 flex-none rounded-xl border border-rand bg-grund px-3.5 text-[14px] text-text"
        />
      }
      options={shown.map((t) => ({
        key: t.id,
        selected: false,
        label: (
          <>
            <span className="flex-1">{t.title}</span>
            <span className="label-mono">{TASK_STATUS_LABEL[t.status]}</span>
          </>
        ),
      }))}
      footer={
        shown.length === 0 && (
          <span className="py-3 text-center text-[14px] text-leise">
            {q ? 'Keine passende Aufgabe.' : 'Keine weiteren offenen Aufgaben.'}
          </span>
        )
      }
    />
  );
}

function FieldTile({
  label,
  span2,
  onClick,
  children,
}: {
  label: string;
  span2?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      data-wf="WF-AUF-04"
      onClick={onClick}
      className={cx(
        'flex min-h-[68px] flex-col items-start gap-1.5 rounded-[14px] border border-linie bg-flaeche px-3.5 py-3 text-left text-text',
        span2 && 'col-span-2',
      )}
    >
      <span className="label-mono">{label}</span>
      <span className="text-[15px]">{children}</span>
    </button>
  );
}

/** WF-AUF-04 Titel: antippen, bearbeiten, speichert beim Verlassen des Feldes */
function TitleField({
  title,
  disabled,
  onSave,
}: {
  title: string;
  disabled: boolean;
  onSave: (title: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const [error, setError] = useState<string | null>(null);

  if (!editing) {
    return (
      <button
        type="button"
        data-wf="WF-AUF-04"
        disabled={disabled}
        aria-label={`Titel bearbeiten: ${title}`}
        onClick={() => setEditing(true)}
        className="min-h-11 text-left text-[26px] leading-[1.2] font-bold tracking-[-0.5px] text-text"
      >
        {title}
      </button>
    );
  }
  const commit = async () => {
    const next = value.trim();
    if (!next) return setError('Bitte einen Titel eingeben.');
    if (next !== title) await onSave(next);
    setEditing(false);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <input
        type="text"
        data-wf="WF-AUF-04"
        aria-label="Titel"
        autoFocus
        value={value}
        maxLength={200}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setValue(title);
            setEditing(false);
          }
        }}
        className="h-12 rounded-xl border border-violett bg-grund px-3.5 text-[20px] font-semibold text-text"
      />
      <FieldError>{error}</FieldError>
      <span className="label-mono">Speichert beim Verlassen des Feldes</span>
    </div>
  );
}

/** WF-AUF-05 Beschreibung mit Speichern/Abbrechen und lokalem Entwurf */
function Description({ task, act }: { task: TaskDetailData; act: Act }) {
  const draftKey = `task:${task.id}:beschreibung`;
  const latest = useLatest(task.version);
  const [draft, setDraft] = useState(() => readDraft(draftKey));
  const editing = draft !== null;

  const cancel = () => {
    clearDraft(draftKey);
    setDraft(null);
  };
  const save = async () => {
    const text = draft ?? '';
    const ok = await act(() => api.updateTaskDescription(task.id, text, latest.current), {
      subject: SUBJECT,
      success: 'Gespeichert',
      ownInput: text,
      draftKept: true,
    });
    if (ok) cancel();
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-h-[30px] items-center">
        <span id="beschreibung-label" className="label-mono flex-1">
          Beschreibung
        </span>
        {!editing && (
          <button
            type="button"
            data-wf="WF-AUF-05"
            onClick={() => setDraft(task.description ?? '')}
            className="hit h-[30px] px-2.5 text-[13px] text-pink"
          >
            {task.description ? 'Bearbeiten' : 'Hinzufügen'}
          </button>
        )}
      </div>
      {!editing &&
        (task.description ? (
          <div className="text-[15px] leading-normal whitespace-pre-wrap text-weich">{task.description}</div>
        ) : (
          <div className="text-[14px] text-leise">Noch keine Beschreibung.</div>
        ))}
      {editing && (
        <div className="flex flex-col gap-2">
          <textarea
            data-wf="WF-AUF-05"
            aria-labelledby="beschreibung-label"
            autoFocus
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              writeDraft(draftKey, e.target.value);
            }}
            className="min-h-24 resize-y rounded-[14px] border border-violett bg-grund px-3.5 py-3 text-[15px] leading-normal text-text"
          />
          <div className="flex items-center justify-end gap-2">
            <span className="label-mono flex-1">Entwurf lokal gesichert</span>
            <button
              type="button"
              data-wf="WF-AUF-05"
              onClick={cancel}
              className="hit h-9 px-3.5 text-[14px] text-leise"
            >
              Abbrechen
            </button>
            <button
              type="button"
              data-wf="WF-AUF-05"
              onClick={() => void save()}
              className="hit h-9 rounded-[18px] bg-geplant px-4 text-[14px] font-semibold text-grund"
            >
              Speichern
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** WF-AUF-12 – nur eigene Kommentare sind bearbeitbar */
function CommentRow({
  comment,
  author,
  own,
  act,
}: {
  comment: Comment;
  author: Member | undefined;
  own: boolean;
  act: Act;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const edited = comment.updated_at !== comment.created_at;

  const save = async () => {
    const text = draft ?? '';
    const ok = await act(() => api.updateComment(comment.id, text), {
      success: 'Gespeichert',
      ownInput: text,
      onInvalid: (e) => setError(e.message),
    });
    if (ok) setDraft(null);
  };

  return (
    <div className="flex gap-2.5">
      <Avatar member={author} size={30} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-[13px] font-semibold">
          {author?.display_name ?? 'Unbekannt'}{' '}
          <span className="font-mono text-[11px] font-normal text-leise">
            {formatCommentTime(comment.created_at, new Date())}
            {edited && ' · BEARBEITET'}
          </span>
        </span>
        {draft === null ? (
          <>
            <span className="text-[15px] leading-[1.45] break-words whitespace-pre-wrap text-weich">
              {comment.body}
            </span>
            {own && (
              <button
                type="button"
                data-wf="WF-AUF-12"
                onClick={() => setDraft(comment.body)}
                className="hit h-[26px] self-start text-[12px] text-leise"
              >
                Bearbeiten
              </button>
            )}
          </>
        ) : (
          <div className="flex flex-col gap-2">
            <textarea
              data-wf="WF-AUF-12"
              aria-label="Kommentar bearbeiten"
              autoFocus
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setError(null);
              }}
              className="min-h-20 rounded-[14px] border border-violett bg-grund px-3.5 py-2.5 text-[15px] leading-normal text-text"
            />
            <FieldError>{error}</FieldError>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                data-wf="WF-AUF-12"
                onClick={() => setDraft(null)}
                className="hit h-9 px-3.5 text-[14px] text-leise"
              >
                Abbrechen
              </button>
              <button
                type="button"
                data-wf="WF-AUF-12"
                disabled={!draft.trim()}
                onClick={() => void save()}
                className="hit h-9 rounded-[18px] bg-geplant px-4 text-[14px] font-semibold text-grund disabled:bg-erhoeht disabled:text-leise"
              >
                Speichern
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** WF-AUF-12 Kommentar senden – unten fixiert; bei leerem Feld gesperrt */
function CommentBar({
  taskId,
  following,
  act,
  onSent,
}: {
  taskId: string;
  following: boolean;
  act: Act;
  onSent: () => void;
}) {
  const draftKey = `task:${taskId}:kommentar`;
  const [text, setText] = useState(() => readDraft(draftKey) ?? '');
  const [sending, setSending] = useState(false);
  const lock = useRef(false);
  const field = useRef<HTMLInputElement>(null);
  const sent = useRef<string | null>(null);
  const strip = (value: string) =>
    sent.current && value.startsWith(sent.current) ? value.slice(sent.current.length) : value;
  useEffect(() => {
    // das Feld zeigt den gekürzten Text – ab jetzt gilt wieder, was dasteht
    if (sent.current && !field.current?.value.startsWith(sent.current)) sent.current = null;
  }, [text]);

  const send = async () => {
    // während des Sendens gesperrt – ein Doppeltipp legt keinen zweiten Kommentar an
    if (!text.trim() || lock.current) return;
    lock.current = true;
    setSending(true);
    await act(
      async () => {
        const result = await api.addComment(taskId, text);
        // nur den gesendeten Text entfernen – was inzwischen weitergetippt wurde, bleibt stehen
        // (Tastendrücke können sich mit dem Leeren kreuzen – deshalb merkt sich das Feld, was weg soll)
        sent.current = text;
        const rest = strip(field.current?.value ?? '');
        if (rest) writeDraft(draftKey, rest);
        else clearDraft(draftKey);
        setText(rest);
        onSent();
        return result;
      },
      {
        ownInput: text,
        draftKept: true,
        success: (r) => (r.now_following && !following ? 'Gesendet · du folgst jetzt' : 'Gesendet'),
      },
    );
    lock.current = false;
    setSending(false);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
      className="sticky bottom-0 z-10 flex flex-none items-center gap-2.5 border-t border-linie bg-nav px-4 pt-3 pb-[calc(18px+env(safe-area-inset-bottom,0px))]"
    >
      <label htmlFor="kommentar" className="sr-only">
        Kommentar schreiben
      </label>
      <input
        id="kommentar"
        ref={field}
        type="text"
        data-wf="WF-AUF-12"
        autoComplete="off"
        placeholder="Kommentar schreiben …"
        value={text}
        onChange={(e) => {
          const next = strip(e.target.value);
          setText(next);
          writeDraft(draftKey, next);
        }}
        className="h-11 min-w-0 flex-1 rounded-[22px] border border-rand bg-flaeche px-4 text-[15px] text-text"
      />
      <button
        type="submit"
        data-wf="WF-AUF-12"
        disabled={!text.trim() || sending}
        aria-label="Senden"
        className={cx(
          'flex size-11 flex-none items-center justify-center rounded-full',
          text.trim() && !sending ? 'bg-marke text-grund' : 'bg-erhoeht text-leise',
        )}
      >
        <IconSend size={20} />
      </button>
    </form>
  );
}
