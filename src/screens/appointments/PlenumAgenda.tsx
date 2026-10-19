// S-33 Plenum – Agenda · P3 (F-PLE-03, F-PLE-05; WF-PLE-04 bis -19)
import { useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { clearDraft, readDraft, writeDraft } from '../../app/drafts';
import { useFeedback } from '../../app/feedback';
import { useLookups } from '../../app/lookups';
import { useActions } from '../../app/useActions';
import { useData } from '../../app/useData';
import { api } from '../../data';
import type { AgendaItem, PlenumDetail, SearchGroupKey } from '../../data/api';
import { fromLocalInput } from '../../shared/format';
import { toIsoDate } from '../../shared/rules/due';
import { allowedEventTransitions } from '../../shared/rules/eventStatus';
import type { EventStatus, MarkTarget, PlenumActionInput, PlenumAddInput } from '../../shared/schema';
import { CheckRow, cx, FieldError } from '../../ui/bits';
import { DateTile } from '../../ui/DateTile';
import { DateTimeTile } from '../../ui/DateTimeTile';
import { TopicSelect } from '../knowledge/KnowledgeSheets';

const TONE: Record<AgendaItem['tone'], string> = {
  rot: 'text-rot',
  grau: 'text-leise',
  bernstein: 'text-bernstein',
  gruen: 'text-gruen',
  violett: 'text-violett',
  blau: 'text-blau',
  hell: 'text-geplant',
};

const DETAIL_LINK: Record<Exclude<MarkTarget, 'document'>, (id: string) => string> = {
  task: (id) => `/aufgaben/${id}`,
  question: (id) => `/wissen/fragen/${id}`,
  decision: (id) => `/wissen/beschluesse/${id}`,
  event: (id) => `/events/${id}`,
  appointment: (id) => `/termine/${id}`,
  partner: (id) => `/partner/${id}`,
};

type Panel =
  | 'plan'
  | 'replan'
  | 'sub'
  | 'unblock'
  | 'clarify'
  | 'replace'
  | 'revoke'
  | 'move'
  | 'cancel'
  | 'close_event';

interface Action {
  label: string;
  wf: string;
  /** öffnet ein Feld zum Ausfüllen oder Bestätigen */
  panel?: Panel;
  input?: PlenumActionInput;
  success?: string;
}

const EVENT_STEP: Partial<Record<EventStatus, { to: EventStatus; label: string }>> = {
  idee: { to: 'in_planung', label: 'In Planung nehmen' },
  in_planung: { to: 'bestaetigt', label: 'Bestätigen' },
  in_nachbereitung: { to: 'abgeschlossen', label: 'Abschließen' },
};

/** Hauptaktion und die Aktionen unter „⋯“ je Art und Zustand (Tabelle in F-PLE-05) */
function actionsFor(item: AgendaItem): { primary: Action; more: Action[] } {
  const { id, version, target } = item;
  const discussed: Action = {
    label: '✓ Besprochen',
    wf: 'WF-PLE-18',
    input: { kind: 'discussed', target, id },
    success: 'Besprochen',
  };
  const subTask: Action = { label: 'Aufgabe dazu anlegen', wf: 'WF-PLE-17', panel: 'sub' };
  const discardTask: Action = {
    label: 'Verwerfen',
    wf: 'WF-PLE-10',
    input: { kind: 'task_finish', id, version, to: 'verworfen' },
    success: 'Verworfen',
  };
  switch (target) {
    case 'task':
      if (item.task_status === 'neu')
        return { primary: { label: 'Einplanen', wf: 'WF-PLE-07', panel: 'plan' }, more: [discardTask] };
      if (item.task_status === 'blockiert')
        return {
          primary: { label: 'Blockade lösen', wf: 'WF-PLE-09', panel: 'unblock' },
          more: [discussed, discardTask],
        };
      return {
        primary: discussed,
        more: [
          { label: 'Umplanen', wf: 'WF-PLE-08', panel: 'replan' },
          {
            label: 'Erledigt',
            wf: 'WF-PLE-10',
            input: { kind: 'task_finish', id, version, to: 'erledigt' },
            success: 'Erledigt',
          },
          discardTask,
        ],
      };
    case 'question':
      return {
        primary: { label: 'Klären', wf: 'WF-PLE-11', panel: 'clarify' },
        more: [
          {
            label: 'Verwerfen',
            wf: 'WF-PLE-12',
            input: { kind: 'question_discard', id, version },
            success: 'Frage verworfen',
          },
          { ...discussed, label: 'Besprochen, bleibt offen' },
        ],
      };
    case 'decision':
      return {
        primary: discussed,
        more: [
          { label: 'Ersetzen', wf: 'WF-PLE-13', panel: 'replace' },
          { label: 'Aufheben', wf: 'WF-PLE-14', panel: 'revoke' },
        ],
      };
    case 'event': {
      const status = item.event_status!;
      const step = EVENT_STEP[status];
      const primary: Action = !step
        ? discussed
        : step.to === 'abgeschlossen' && item.open_tasks
          ? { label: step.label, wf: 'WF-PLE-15', panel: 'close_event' }
          : {
              label: step.label,
              wf: 'WF-PLE-15',
              input: { kind: 'event_status', id, version, to: step.to },
              success: step.label === 'Bestätigen' ? 'Bestätigt' : `Status: ${step.label}`,
            };
      const more: Action[] = [];
      if (allowedEventTransitions(status).includes('abgesagt'))
        more.push({ label: 'Absagen', wf: 'WF-PLE-15', panel: 'cancel' });
      more.push(subTask);
      if (step) more.push(discussed);
      return { primary, more };
    }
    case 'appointment':
      return {
        primary: discussed,
        more: [
          { label: 'Verschieben', wf: 'WF-PLE-16', panel: 'move' },
          { label: 'Absagen', wf: 'WF-PLE-16', panel: 'cancel' },
          subTask,
        ],
      };
    default:
      return { primary: discussed, more: [subTask] };
  }
}

const chipClass = (on: boolean) =>
  cx(
    'hit h-8 rounded-2xl border px-3 text-[13px]',
    on ? 'border-geplant bg-geplant font-semibold text-grund' : 'border-rand-stark text-text',
  );

function Chip({
  on,
  onClick,
  children,
  mono,
  wf,
  label,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
  mono?: boolean;
  wf?: string;
  label?: string;
}) {
  return (
    <button
      type="button"
      data-wf={wf}
      aria-pressed={on}
      aria-label={label}
      onClick={onClick}
      className={cx(chipClass(on), mono && 'font-mono text-[12px]')}
    >
      {children}
    </button>
  );
}

function PanelButtons({
  onCancel,
  confirm,
  disabled,
  danger,
  wf,
  cancelLabel = 'Abbrechen',
}: {
  onCancel: () => void;
  confirm: string;
  disabled?: boolean;
  danger?: boolean;
  wf: string;
  cancelLabel?: string;
}) {
  return (
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onCancel} className="hit h-9 px-3.5 text-[14px] text-leise">
        {cancelLabel}
      </button>
      <button
        type="submit"
        data-wf={wf}
        disabled={disabled}
        className={cx(
          'hit h-9 rounded-[18px] px-4 text-[14px] font-semibold',
          disabled ? 'bg-linie text-matt' : danger ? 'bg-rot font-bold text-grund' : 'bg-geplant text-grund',
        )}
      >
        {confirm}
      </button>
    </div>
  );
}

const inDays = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
};

/** „Wer übernimmt? Bis wann?“ – beides optional */
function WhoWhen({
  who,
  setWho,
  due,
  setDue,
  wf,
}: {
  who: string | null;
  setWho: (id: string | null) => void;
  due: string;
  setDue: (d: string) => void;
  wf: string;
}) {
  const { activeMembers } = useLookups();
  return (
    <>
      <span className="label-mono">Wer übernimmt? · optional</span>
      <div role="group" aria-label="Wer übernimmt?" className="flex flex-wrap gap-1.5">
        {activeMembers.map((m) => (
          <Chip
            key={m.id}
            mono
            wf={wf}
            on={who === m.id}
            label={m.display_name}
            onClick={() => setWho(who === m.id ? null : m.id)}
          >
            {m.short}
          </Chip>
        ))}
      </div>
      <span className="label-mono">Bis wann? · optional</span>
      <div className="flex flex-wrap gap-1.5">
        {(
          [
            [7, 'In 1 Woche'],
            [14, 'In 2 Wochen'],
          ] as const
        ).map(([days, label]) => (
          <Chip
            key={days}
            wf={wf}
            on={due === inDays(days)}
            onClick={() => setDue(due === inDays(days) ? '' : inDays(days))}
          >
            {label}
          </Chip>
        ))}
      </div>
      <DateTile label="Frist" value={due} onChange={setDue} wf={wf} surface="bg-grund" />
    </>
  );
}

function AgendaCard({
  item,
  plenum,
  index,
  count,
  dragging,
  onGrab,
  onMove,
}: {
  item: AgendaItem;
  plenum: PlenumDetail;
  index: number;
  count: number;
  dragging: boolean;
  onGrab: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onMove: (to: number) => void;
}) {
  const act = useActions();
  const { primary, more } = actionsFor(item);
  const [menu, setMenu] = useState(false);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [who, setWho] = useState<string | null>(null);
  const [due, setDue] = useState('');
  const [title, setTitle] = useState('');
  const [to, setTo] = useState<'geplant' | 'in_arbeit'>('geplant');
  const draftKey = `plenum:frage:${item.id}:antwort`;
  const [answer, setAnswer] = useState(() => readDraft(draftKey) ?? '');
  const [result, setResult] = useState<'antwort' | 'entscheidung' | 'fakt'>('antwort');
  const [followUp, setFollowUp] = useState(false);
  const [note, setNote] = useState('');
  const [when, setWhen] = useState('');
  const { memberById } = useLookups();
  const textKey = `plenum:ersetzen:${item.id}:text`;
  const [text, setText] = useState(() => readDraft(textKey) ?? '');
  const [error, setError] = useState<string | null>(null);

  const open = (p: Panel) => {
    setMenu(false);
    setError(null);
    setWho(null);
    // Umplanen zeigt die bisherige Frist; wer gewählt wird, ersetzt die bisherigen Bearbeitenden
    setDue(p === 'replan' ? (item.due_date ?? '') : '');
    setTitle(p === 'sub' ? `Zu „${item.title}“: `.slice(0, 200) : '');
    setTo('geplant');
    setResult('antwort');
    setFollowUp(false);
    setNote('');
    setWhen('');
    setPanel(p);
  };
  /** Abbrechen verwirft auch den lokalen Entwurf (7.3) */
  const cancel = () => {
    if (panel === 'clarify') {
      clearDraft(draftKey);
      setAnswer('');
    }
    if (panel === 'replace') {
      clearDraft(textKey);
      setText('');
    }
    setPanel(null);
  };
  const run = (action: Action) => {
    if (action.panel) return open(action.panel);
    setMenu(false);
    void act(() => api.plenumAction(plenum.id, action.input!), {
      success: action.success,
      undo: (r) => r.undo_token,
    });
  };
  const submit = (input: PlenumActionInput, success: string, after?: () => void) =>
    void act(() => api.plenumAction(plenum.id, input), {
      success,
      undo: (r) => r.undo_token,
      onInvalid: (e) => setError(e.message),
    }).then((ok) => {
      if (!ok) return;
      after?.();
      setPanel(null);
    });

  const { id, version } = item;
  const whoWhen = { assignee_id: who, due_date: due || null };
  const confirm = (): void => {
    switch (panel) {
      case 'plan':
        return submit({ kind: 'task_plan', id, version, ...whoWhen }, 'Eingeplant');
      case 'replan':
        return submit({ kind: 'task_replan', id, version, ...whoWhen }, 'Umgeplant');
      case 'sub':
        return submit(
          {
            kind: 'sub_task',
            target: item.target as 'event' | 'appointment' | 'document',
            id,
            title,
            ...whoWhen,
          },
          'Aufgabe eingeplant',
        );
      case 'unblock':
        return submit({ kind: 'task_unblock', id, version, to }, 'Blockade gelöst');
      case 'clarify':
        return submit(
          { kind: 'question_clarify', id, version, answer, result, follow_up: followUp },
          'Geklärt',
          () => clearDraft(draftKey),
        );
      case 'replace':
        return submit({ kind: 'decision_replace', id, version, title, description: text }, 'Ersetzt', () =>
          clearDraft(textKey),
        );
      case 'revoke':
        return submit({ kind: 'decision_revoke', id, version, note }, 'Aufgehoben');
      case 'move': {
        const startsAt = fromLocalInput(when);
        if (!startsAt) return setError('Bitte ein neues Datum wählen.');
        return submit(
          { kind: 'appointment_move', id, version, starts_at: startsAt },
          'Verschoben – Benachrichtigung geht raus',
        );
      }
      case 'cancel':
        return item.target === 'event'
          ? submit({ kind: 'event_status', id, version, to: 'abgesagt' }, 'Abgesagt')
          : submit({ kind: 'appointment_cancel', id, version }, 'Abgesagt – Benachrichtigung geht raus');
      case 'close_event':
        return submit({ kind: 'event_status', id, version, to: 'abgeschlossen' }, 'Abgeschlossen');
    }
  };

  const ready =
    panel === 'clarify'
      ? !!answer.trim()
      : panel === 'replace' || panel === 'sub'
        ? !!title.trim()
        : panel === 'move'
          ? !!when
          : true;
  const confirmLabel: Record<Panel, string> = {
    plan: 'Einplanen',
    replan: 'Speichern',
    sub: 'Einplanen',
    unblock: 'Blockade lösen',
    clarify: 'Klären',
    replace: 'Ersetzen',
    revoke: 'Aufheben',
    move: 'Verschieben',
    cancel: 'Absagen',
    close_event: 'Abschließen',
  };
  const panelWf: Record<Panel, string> = {
    plan: 'WF-PLE-07',
    replan: 'WF-PLE-08',
    sub: 'WF-PLE-17',
    unblock: 'WF-PLE-09',
    clarify: 'WF-PLE-11',
    replace: 'WF-PLE-13',
    revoke: 'WF-PLE-14',
    move: 'WF-PLE-16',
    cancel: item.target === 'event' ? 'WF-PLE-15' : 'WF-PLE-16',
    close_event: 'WF-PLE-15',
  };

  return (
    <article
      aria-label={item.title}
      className={cx(
        'flex flex-col gap-2 rounded-[14px] border py-2 pr-2 pl-1',
        dragging
          ? 'border-pink bg-erhoeht shadow-[0_8px_24px_rgba(0,0,0,0.4)]'
          : panel
            ? 'border-rand-stark bg-erhoeht'
            : 'border-linie bg-flaeche',
      )}
    >
      <div className="flex items-center gap-1">
        {/* WF-PLE-04 Ziehgriff – ziehen oder mit den Pfeiltasten verschieben */}
        <button
          type="button"
          data-wf="WF-PLE-04"
          aria-label={`Verschieben: ${item.title} (Platz ${index + 1} von ${count})`}
          onPointerDown={onGrab}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' && index > 0) {
              e.preventDefault();
              onMove(index - 1);
            } else if (e.key === 'ArrowDown' && index < count - 1) {
              e.preventDefault();
              onMove(index + 1);
            }
          }}
          className={cx(
            'flex size-11 flex-none cursor-grab touch-none items-center justify-center',
            dragging ? 'text-pink' : 'text-rand-stark',
          )}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            {[6, 12, 18].map((y) => (
              <g key={y}>
                <circle cx="9" cy={y} r="1.6" />
                <circle cx="15" cy={y} r="1.6" />
              </g>
            ))}
          </svg>
        </button>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className={cx('font-mono text-[11px] uppercase', TONE[item.tone])}>{item.label}</span>
          {item.target === 'document' ? (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="text-[15px] leading-[1.3] font-medium text-text no-underline"
            >
              {item.title} ↗
            </a>
          ) : (
            <Link
              to={DETAIL_LINK[item.target](item.id)}
              className="text-[15px] leading-[1.3] font-medium text-text no-underline"
            >
              {item.title}
            </Link>
          )}
        </span>
        <button
          type="button"
          data-wf={primary.wf}
          onClick={() => run(primary)}
          className="hit h-[34px] flex-none rounded-[17px] border border-rand-stark px-3 text-[13px] font-semibold whitespace-nowrap text-text"
        >
          {primary.label}
        </button>
        <button
          type="button"
          aria-label={`Weitere Aktionen: ${item.title}`}
          aria-expanded={menu}
          onClick={() => {
            setMenu(!menu);
            setPanel(null);
          }}
          className="hit size-[34px] flex-none rounded-[17px] text-[18px] text-leise"
        >
          ⋯
        </button>
      </div>

      {menu && !panel && (
        <div className="flex flex-wrap gap-1.5 pr-1.5 pb-1 pl-[38px]">
          {more.map((m) => (
            <button
              key={m.label}
              type="button"
              data-wf={m.wf}
              onClick={() => run(m)}
              className="hit h-8 rounded-2xl border border-rand bg-grund px-3 text-[13px] text-weich"
            >
              {m.label}
            </button>
          ))}
        </div>
      )}

      {panel && (
        <form
          data-wf={panelWf[panel]}
          aria-label={confirmLabel[panel]}
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) confirm();
          }}
          className={cx(
            'flex flex-col gap-2 py-1 pr-1.5 pl-3',
            (panel === 'cancel' || panel === 'close_event') &&
              'mx-1.5 mb-1 rounded-xl border border-rot-rand bg-rot-flaeche px-3 py-2.5',
          )}
        >
          {(panel === 'plan' || panel === 'replan' || panel === 'sub') && (
            <>
              <span className="text-[13px] text-weich">
                {panel === 'plan'
                  ? 'Einplanen → Geplant · Herkunft: dieses Plenum'
                  : panel === 'replan'
                    ? `Umplanen – der Status bleibt. Eingetragen: ${
                        (item.assignee_ids ?? []).map((m) => memberById.get(m)?.display_name).join(', ') ||
                        'niemand'
                      }. Wer hier gewählt wird, ersetzt die Eingetragenen.`
                    : 'Neue Aufgabe – Herkunft: dieses Plenum. Der Punkt bleibt auf der Agenda.'}
              </span>
              {panel === 'sub' && (
                <label className="label-mono flex flex-col gap-1.5">
                  Titel *
                  <input
                    type="text"
                    autoFocus
                    value={title}
                    maxLength={200}
                    onChange={(e) => setTitle(e.target.value)}
                    className="h-11 rounded-xl border border-violett bg-grund px-3 font-sans text-[15px] text-text normal-case"
                  />
                </label>
              )}
              <WhoWhen who={who} setWho={setWho} due={due} setDue={setDue} wf={panelWf[panel]} />
            </>
          )}

          {panel === 'unblock' && (
            <>
              <span className="label-mono">Weiter mit Status</span>
              <div className="flex gap-1.5">
                <Chip wf="WF-PLE-09" on={to === 'geplant'} onClick={() => setTo('geplant')}>
                  Geplant
                </Chip>
                <Chip wf="WF-PLE-09" on={to === 'in_arbeit'} onClick={() => setTo('in_arbeit')}>
                  In Arbeit
                </Chip>
              </div>
            </>
          )}

          {panel === 'clarify' && (
            <>
              <label className="label-mono flex flex-col gap-1.5">
                Antwort · Pflicht
                <textarea
                  autoFocus
                  value={answer}
                  onChange={(e) => {
                    setAnswer(e.target.value);
                    writeDraft(draftKey, e.target.value);
                    setError(null);
                  }}
                  className="min-h-20 rounded-xl border border-rand bg-grund px-3 py-2.5 font-sans text-[14px] leading-[1.4] text-text normal-case"
                />
              </label>
              <span className="label-mono">Ergebnis</span>
              <div role="group" aria-label="Ergebnis" className="flex flex-wrap gap-1.5">
                {(
                  [
                    ['antwort', 'Nur Antwort'],
                    ['entscheidung', 'Als Entscheidung'],
                    ['fakt', 'Als Fakt'],
                  ] as const
                ).map(([key, label]) => (
                  <Chip key={key} wf="WF-PLE-11" on={result === key} onClick={() => setResult(key)}>
                    {label}
                  </Chip>
                ))}
              </div>
              {result !== 'antwort' && (
                <span className="text-[13px] text-leise">
                  Quelle ist dieses Plenum; die Frage verweist darauf.
                </span>
              )}
              <CheckRow checked={followUp} onChange={setFollowUp}>
                Folgeaufgabe anlegen
              </CheckRow>
            </>
          )}

          {panel === 'replace' && (
            <>
              <label className="label-mono flex flex-col gap-1.5">
                Neue Fassung · Titel *
                <input
                  type="text"
                  autoFocus
                  value={title}
                  maxLength={200}
                  onChange={(e) => setTitle(e.target.value)}
                  className="h-11 rounded-xl border border-violett bg-grund px-3 font-sans text-[15px] text-text normal-case"
                />
              </label>
              <label className="label-mono flex flex-col gap-1.5">
                Text · optional
                <textarea
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    writeDraft(textKey, e.target.value);
                  }}
                  className="min-h-20 rounded-xl border border-rand bg-grund px-3 py-2.5 font-sans text-[14px] leading-[1.4] text-text normal-case"
                />
              </label>
              <span className="text-[13px] text-leise">
                Quelle: dieses Plenum. Die alte Fassung bleibt sichtbar, durchgestrichen mit Verweis.
              </span>
            </>
          )}

          {panel === 'revoke' && (
            <label className="label-mono flex flex-col gap-1.5">
              Notiz · optional
              <input
                type="text"
                autoFocus
                value={note}
                maxLength={500}
                onChange={(e) => setNote(e.target.value)}
                className="h-11 rounded-xl border border-rand bg-grund px-3 font-sans text-[15px] text-text normal-case"
              />
            </label>
          )}

          {panel === 'move' && (
            <>
              <DateTimeTile
                id={`neu-${item.id}`}
                label="Neues Datum *"
                value={when}
                onChange={setWhen}
                wf="WF-PLE-16"
              />
              <span className="text-[13px] text-leise">Zusagen und ohne Antwort werden benachrichtigt.</span>
            </>
          )}

          {panel === 'cancel' && (
            <span className="text-[14px] leading-[1.45]">
              {item.target === 'event'
                ? `„${item.title}“ absagen? Offene Aufgaben bleiben bestehen.`
                : `„${item.title}“ absagen? Zusagen und ohne Antwort bekommen eine Nachricht.`}
            </span>
          )}

          {panel === 'close_event' && (
            <span className="text-[14px] leading-[1.45]">
              „{item.title}“ hat noch {item.open_tasks} offene{' '}
              {item.open_tasks === 1 ? 'Aufgabe' : 'Aufgaben'}. Trotzdem abschließen? Die Aufgaben bleiben
              bestehen.
            </span>
          )}

          <FieldError>{error}</FieldError>
          <PanelButtons
            wf={panelWf[panel]}
            onCancel={cancel}
            cancelLabel={panel === 'cancel' || panel === 'close_event' ? 'Doch nicht' : 'Abbrechen'}
            confirm={confirmLabel[panel]}
            disabled={!ready}
            danger={panel === 'cancel'}
          />
        </form>
      )}
    </article>
  );
}

/** Agenda mit Ziehgriff: Während des Ziehens ordnet sich die Liste lokal, beim Loslassen wird gespeichert. */
export function Agenda({ plenum }: { plenum: PlenumDetail }) {
  const act = useActions();
  const list = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ markId: string; order: string[]; saving?: boolean } | null>(null);
  const byMark = new Map(plenum.agenda.map((a) => [a.mark_id, a]));
  const order = drag?.order ?? plenum.agenda.map((a) => a.mark_id);
  const items = order.map((m) => byMark.get(m)).filter((a): a is AgendaItem => !!a);

  /** Die neue Reihenfolge bleibt sichtbar, bis sie gespeichert und neu geladen ist. */
  const save = (markId: string, next: string[]) => {
    setDrag({ markId, order: next, saving: true });
    void act(() => api.moveAgendaItem(markId, next.indexOf(markId))).then(() => setDrag(null));
  };
  const moveTo = (markId: string, to: number) => {
    const without = order.filter((m) => m !== markId);
    save(markId, [...without.slice(0, to), markId, ...without.slice(to)]);
  };

  const grab = (markId: string) => (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || drag?.saving) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    let current = plenum.agenda.map((a) => a.mark_id);
    const start = current.indexOf(markId);
    setDrag({ markId, order: current });
    // Mitten der übrigen Karten beim Start, relativ zur Seite – die Liste ordnet sich während des Ziehens um
    const cards = [...(list.current?.querySelectorAll<HTMLElement>(':scope > article') ?? [])];
    const middles = cards
      .filter((_, i) => current[i] !== markId)
      .map((c) => {
        const r = c.getBoundingClientRect();
        return r.top + window.scrollY + r.height / 2;
      });
    const onMove = (ev: PointerEvent) => {
      // Zielplatz: hinter allen Karten, deren Mitte über dem Zeiger liegt
      const to = middles.filter((m) => m < ev.clientY + window.scrollY).length;
      const without = current.filter((m) => m !== markId);
      const next = [...without.slice(0, to), markId, ...without.slice(to)];
      if (next.join() !== current.join()) {
        current = next;
        setDrag({ markId, order: next });
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (current.indexOf(markId) !== start) save(markId, current);
      else setDrag(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  return (
    <div className="flex flex-col gap-2">
      <span role="status" className="text-[13px] leading-[1.4] text-leise">
        {drag?.saving
          ? 'Reihenfolge wird gespeichert …'
          : 'Alles, was „Fürs Plenum“ markiert ist. Reihenfolge per Ziehgriff (für alle gleich), weitere Aktionen unter ⋯.'}
      </span>
      <div ref={list} className="flex flex-col gap-2">
        {items.map((item, i) => (
          <AgendaCard
            key={item.mark_id}
            item={item}
            plenum={plenum}
            index={i}
            count={items.length}
            dragging={drag?.markId === item.mark_id && !drag.saving}
            onGrab={grab(item.mark_id)}
            onMove={(to) => !drag?.saving && moveTo(item.mark_id, to)}
          />
        ))}
      </div>
      {items.length === 0 && (
        <span className="py-4 text-center text-[14px] text-leise">Agenda leer – alles besprochen.</span>
      )}
      <AddPanel plenum={plenum} />
    </div>
  );
}

const ADD_KINDS: [PlenumAddInput['kind'], string][] = [
  ['aufgabe', 'Aufgabe'],
  ['frage', 'Frage'],
  ['entscheidung', 'Entscheidung'],
  ['fakt', 'Fakt'],
];

const SEARCH_TARGET: Record<SearchGroupKey, MarkTarget> = {
  aufgaben: 'task',
  events: 'event',
  termine: 'appointment',
  beschluesse: 'decision',
  fragen: 'question',
  dokumente: 'document',
  partner: 'partner',
};

function markFor(target: MarkTarget, id: string) {
  if (target === 'task') return api.setPlenumMark(id, true);
  if (target === 'appointment') return api.setAppointmentMark(id, true);
  return api.setMark(target, id, true);
}

/** WF-PLE-05 / -06: neu anlegen oder Vorhandenes dazuholen */
function AddPanel({ plenum }: { plenum: PlenumDetail }) {
  const { run } = useFeedback();
  const act = useActions();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<PlenumAddInput['kind'] | null>(null);
  const [title, setTitle] = useState('');
  const [topicId, setTopicId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const q = query.trim();
  const { data: hits } = useData(`agenda-suche:${q}`, () =>
    q.length >= 2 ? api.search(q) : Promise.resolve([]),
  );
  const onAgenda = new Set(plenum.agenda.map((a) => a.id));
  const toAgenda = kind === 'aufgabe' || kind === 'frage';

  if (!open)
    return (
      <button
        type="button"
        data-wf="WF-PLE-05"
        onClick={() => setOpen(true)}
        className="h-11 rounded-[14px] border border-dashed border-rand-stark text-[14px] text-weich"
      >
        + Hinzufügen
      </button>
    );

  const reset = () => {
    setKind(null);
    setTitle('');
    setTopicId('');
    setError(null);
  };
  const ready = !!kind && !!title.trim() && !!topicId;

  return (
    <div
      data-wf="WF-PLE-05"
      className="flex flex-col gap-2.5 rounded-[14px] border border-rand-stark bg-flaeche px-3.5 py-3"
    >
      <span className="label-mono leading-normal">
        Neu anlegen · Aufgaben und Fragen kommen auf die Agenda, Entscheidungen und Fakten ins Ergebnis
      </span>
      <div className="flex flex-wrap gap-2">
        {ADD_KINDS.map(([key, label]) => (
          <Chip key={key} wf="WF-PLE-05" on={kind === key} onClick={() => setKind(kind === key ? null : key)}>
            {label}
          </Chip>
        ))}
      </div>
      {kind && (
        <form
          aria-label={`Neu: ${ADD_KINDS.find(([k]) => k === kind)![1]}`}
          className="flex flex-col gap-2 rounded-xl border border-rand bg-grund px-3 py-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!ready) return;
            void act(() => api.plenumAdd(plenum.id, { kind, title, topic_id: topicId }), {
              success: toAgenda ? 'Auf der Agenda' : 'Im Ergebnis',
              onInvalid: (err) => setError(err.message),
            }).then((ok) => ok && reset());
          }}
        >
          <span className="label-mono">
            {toAgenda
              ? 'Kommt auf die Agenda · Herkunft: dieses Plenum'
              : 'Quelle: dieses Plenum · geht direkt ins Ergebnis'}
          </span>
          <label className="label-mono flex flex-col gap-1.5">
            Titel *
            <input
              type="text"
              autoFocus
              data-wf="WF-PLE-05"
              value={title}
              maxLength={200}
              placeholder={kind === 'frage' ? 'Was müssen wir klären?' : 'Kurz und klar'}
              onChange={(e) => {
                setTitle(e.target.value);
                setError(null);
              }}
              className="h-11 rounded-xl border border-violett bg-flaeche px-3 font-sans text-[15px] text-text normal-case"
            />
          </label>
          <TopicSelect value={topicId} onChange={setTopicId} wf="WF-PLE-05" />
          <FieldError>{error}</FieldError>
          <button
            type="submit"
            data-wf="WF-PLE-05"
            disabled={!ready}
            className={cx(
              'hit h-10 rounded-[20px] text-[14px] font-bold',
              ready ? 'bg-geplant text-grund' : 'bg-linie text-matt',
            )}
          >
            {!title.trim() ? 'Titel eingeben' : !topicId ? 'Thema wählen' : 'Anlegen'}
          </button>
        </form>
      )}

      {/* WF-PLE-06 Vorhandenes suchen und markieren */}
      <span className="label-mono pt-1">Vorhandenes dazuholen</span>
      <input
        type="search"
        data-wf="WF-PLE-06"
        aria-label="Vorhandenes suchen"
        placeholder="Suchen: Aufgaben, Events, Termine, Dokumente …"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="h-11 rounded-xl border border-rand bg-grund px-3 text-[14px] text-text"
      />
      {q.length >= 2 &&
        (hits ?? []).map((g) => (
          <div key={g.key} className="flex flex-col gap-1">
            <span className="label-mono">{g.title}</span>
            {g.items.map((hit) => {
              const marked = onAgenda.has(hit.id);
              return (
                <div
                  key={hit.id}
                  className="flex min-h-11 items-center gap-2 rounded-xl border border-linie bg-grund px-3 py-1"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[14px]">{hit.title}</span>
                    <span className="truncate font-mono text-[11px] text-leise uppercase">{hit.meta}</span>
                  </span>
                  {marked ? (
                    <span className="label-mono">auf der Agenda</span>
                  ) : (
                    <button
                      type="button"
                      data-wf="WF-PLE-06"
                      aria-label={`Auf die Agenda: ${hit.title}`}
                      onClick={() =>
                        void run(() => markFor(SEARCH_TARGET[g.key], hit.id), {
                          success: 'Auf der Agenda',
                          undo: (r) => r.undo_token || undefined,
                        })
                      }
                      className="hit h-8 flex-none rounded-2xl border border-rand-stark px-3 text-[13px] text-text"
                    >
                      + Agenda
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      {q.length >= 2 && hits && hits.length === 0 && (
        <span className="text-[13px] text-leise">Nichts gefunden.</span>
      )}
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          reset();
          setQuery('');
        }}
        className="hit h-8 self-end text-[13px] text-leise"
      >
        Schließen
      </button>
    </div>
  );
}
