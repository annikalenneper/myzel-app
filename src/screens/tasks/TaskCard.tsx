// Karte einer Aufgabe in der Liste (F-AUF-02)
import { Link } from 'react-router-dom';
import { useFeedback } from '../../app/feedback';
import { useLookups } from '../../app/lookups';
import { api } from '../../data';
import type { TaskListItem } from '../../data/api';
import { formatDueLabel } from '../../shared/format';
import { TASK_STATUS_COLOR, TASK_STATUS_LABEL } from '../../shared/labels';
import { dueState } from '../../shared/rules/due';
import { isActiveTaskStatus } from '../../shared/rules/taskStatus';
import { Avatar, cx, PriorityBars } from '../../ui/bits';
import { IconBlocked, IconBookmark, IconComment } from '../../ui/icons';

const DUE_COLOR = { overdue: 'text-rot', soon: 'text-bernstein', normal: 'text-leise', none: 'text-leise' };

export function TaskCard({
  task,
  today,
  selected,
}: {
  task: TaskListItem;
  today: string;
  selected: boolean;
}) {
  const { run } = useFeedback();
  const { topicName, eventById, memberById } = useLookups();
  const due = dueState(task.due_date, task.status, today);
  const event = task.event_id ? eventById.get(task.event_id) : undefined;
  const blocked = task.status === 'blockiert';

  const toggleMark = () =>
    void run(() => api.setPlenumMark(task.id, !task.marked), {
      success: task.marked ? 'Markierung entfernt' : 'Fürs Plenum markiert',
      undo: (r) => r.undo_token,
    });

  return (
    <article
      className={cx(
        'relative rounded-2xl border',
        selected ? 'bg-erhoeht' : 'bg-flaeche',
        due === 'overdue' ? 'border-rot-rand' : 'border-linie',
      )}
    >
      <Link
        to={`/aufgaben/${task.id}`}
        className="flex flex-col gap-2.5 py-3.5 pr-14 pl-4 text-text no-underline"
      >
        <div className="flex items-center gap-2.5">
          <span className="label-mono">
            {topicName(task.topic_id)}
            {event && <span className="text-violett"> · {event.title}</span>}
          </span>
          <PriorityBars priority={task.priority} />
        </div>
        <div className="text-[17px] leading-[1.3] font-semibold">{task.title}</div>
        {blocked && (
          <div className="flex items-start gap-1.5 font-mono text-[12px] leading-[1.35] text-rot-hell uppercase">
            <IconBlocked size={16} className="flex-none" />
            <span>
              {task.blocker_titles.length
                ? `Wartet auf: ${task.blocker_titles.join(', ')}`
                : `Blockiert: ${task.block_reason ?? ''}`}
            </span>
          </div>
        )}
        <div className="flex items-center gap-3">
          <span className="flex flex-none items-center gap-1.5 text-[13px] font-medium whitespace-nowrap">
            <span className="size-2 rounded-full" style={{ background: TASK_STATUS_COLOR[task.status] }} />
            {TASK_STATUS_LABEL[task.status]}
          </span>
          <span className={cx('font-mono text-[12px] whitespace-nowrap', DUE_COLOR[due])}>
            {formatDueLabel(task.due_date, task.status, today)}
          </span>
          <span className="flex-1" />
          {task.comment_count > 0 && (
            <span
              className="flex items-center gap-1 font-mono text-[12px] text-leise"
              aria-label={`${task.comment_count} ${task.comment_count === 1 ? 'Kommentar' : 'Kommentare'}`}
            >
              <IconComment size={15} />
              {task.comment_count}
            </span>
          )}
          {task.assignee_ids.length > 0 && (
            <span className="flex pl-1.5">
              {task.assignee_ids.map((id) => (
                <Avatar
                  key={id}
                  member={memberById.get(id)}
                  size={26}
                  className={cx('-ml-1.5 border-2', selected ? 'border-erhoeht' : 'border-flaeche')}
                />
              ))}
            </span>
          )}
        </div>
      </Link>
      {/* WF-AUF-02 – nicht bei abgeschlossenen Aufgaben */}
      {isActiveTaskStatus(task.status) && (
        <button
          type="button"
          data-wf="WF-AUF-02"
          onClick={toggleMark}
          aria-pressed={task.marked}
          aria-label={task.marked ? 'Markierung „Fürs Plenum“ entfernen' : 'Fürs Plenum markieren'}
          className={cx(
            'hit absolute top-2 right-2 flex size-10 items-center justify-center rounded-full',
            task.marked ? 'text-pink' : 'text-leise',
          )}
        >
          <IconBookmark filled={task.marked} />
        </button>
      )}
    </article>
  );
}
