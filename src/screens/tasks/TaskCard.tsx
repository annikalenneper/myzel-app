// Karte einer Aufgabe in der Liste (F-AUF-02)
import { Link } from 'react-router-dom';
import { useLookups } from '../../app/lookups';
import type { TaskListItem } from '../../data/api';
import { formatDueLabel } from '../../shared/format';
import { TASK_STATUS_COLOR, TASK_STATUS_LABEL } from '../../shared/labels';
import { dueState } from '../../shared/rules/due';
import { Avatar, cx, PriorityBars } from '../../ui/bits';
import { IconBlocked, IconComment } from '../../ui/icons';

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
  const { topicName, eventById, memberById, activeMembers } = useLookups();
  // Phase 9: viele Bearbeitende sprengen die Karte nicht – höchstens drei Köpfe, dann „+n“ bzw. „Alle“
  const everyone = activeMembers.length > 1 && activeMembers.every((m) => task.assignee_ids.includes(m.id));
  const shownIds = task.assignee_ids.slice(0, task.assignee_ids.length > 4 ? 3 : 4);
  const more = task.assignee_ids.length - shownIds.length;
  const due = dueState(task.due_date, task.status, today);
  const event = task.event_id ? eventById.get(task.event_id) : undefined;
  const blocked = task.status === 'blockiert';

  return (
    <article
      className={cx(
        'relative rounded-2xl border',
        selected ? 'bg-erhoeht' : 'bg-flaeche',
        due === 'overdue' ? 'border-rot-rand' : 'border-linie',
      )}
    >
      <Link
        to={`/agenda/${task.id}`}
        className="flex flex-col gap-2.5 py-3.5 pr-4 pl-4 text-text no-underline"
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
        <div className="flex min-w-0 items-center gap-3">
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
          {everyone ? (
            <span className="flex-none font-mono text-[12px] text-weich">ALLE</span>
          ) : (
            task.assignee_ids.length > 0 && (
              <span
                className="flex flex-none items-center pl-1.5"
                aria-label={`${task.assignee_ids.length} ${task.assignee_ids.length === 1 ? 'Person' : 'Personen'}`}
              >
                {shownIds.map((id) => (
                  <Avatar
                    key={id}
                    member={memberById.get(id)}
                    size={26}
                    className={cx('-ml-1.5 border-2', selected ? 'border-erhoeht' : 'border-flaeche')}
                  />
                ))}
                {more > 0 && <span className="pl-1 font-mono text-[12px] text-leise">+{more}</span>}
              </span>
            )
          )}
        </div>
      </Link>
    </article>
  );
}
