// Gemeinsame Bausteine der Detailansichten S-41 Frage und S-42 Entscheidung
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useLookups } from '../../app/lookups';
import { useData } from '../../app/useData';
import { api } from '../../data';
import { formatHistoryTime } from '../../shared/format';
import { knowledgeHistorySentence } from '../../shared/knowledgeHistory';
import type { HistoryEntry } from '../../shared/schema';
import { cx } from '../../ui/bits';
import { IconBack, IconBookmark, IconEdit } from '../../ui/icons';
import { useModal } from '../../ui/Sheet';

/** Wohin „Zurück“ führt: aus Wissen nach Wissen, aus der Agenda zur Agenda */
export interface BackTarget {
  to: string;
  label: string;
}
export const BACK_TO_KNOWLEDGE: BackTarget = { to: '/wissen', label: 'Wissen' };
export const BACK_TO_AGENDA: BackTarget = { to: '/agenda', label: 'Agenda' };

export function DetailTopBar({
  label,
  back = BACK_TO_KNOWLEDGE,
  agenda,
  onEdit,
  editWf,
  children,
}: {
  label: string;
  back?: BackTarget;
  /** weitere Aktionen am Ende, z. B. Löschen (Phase 9) */
  children?: ReactNode;
  /** Entscheidung oder Fakt auf die Agenda setzen (WF-AGE-03) – nur bei gültigen Einträgen */
  agenda?: { on: boolean; onToggle: () => void };
  /** Titel, Beschreibung und Zuordnung bearbeiten (16.3) */
  onEdit?: () => void;
  editWf?: string;
}) {
  return (
    <div className="sticky top-0 z-10 flex h-[60px] flex-none items-center gap-1 bg-grund px-3">
      <Link
        to={back.to}
        aria-label={`Zurück zu ${back.label}`}
        className="flex size-11 items-center justify-center text-text"
      >
        <IconBack />
      </Link>
      <span className="font-mono text-[13px] text-leise uppercase">{label}</span>
      <span className="flex-1" />
      {onEdit && (
        <button
          type="button"
          data-wf={editWf}
          onClick={onEdit}
          aria-label="Bearbeiten"
          className="flex size-11 items-center justify-center text-leise"
        >
          <IconEdit />
        </button>
      )}
      {agenda && (
        <button
          type="button"
          data-wf="WF-AGE-03"
          onClick={agenda.onToggle}
          aria-pressed={agenda.on}
          aria-label={agenda.on ? 'Von der Agenda nehmen' : 'Auf die Agenda setzen'}
          className={cx(
            'hit mr-2 flex h-[34px] items-center gap-1.5 rounded-[17px] border px-3 font-mono text-[12px] whitespace-nowrap',
            agenda.on ? 'border-pink text-pink' : 'border-rand text-leise',
          )}
        >
          <IconBookmark filled={agenda.on} size={14} />
          {agenda.on ? 'Auf der Agenda' : 'Auf die Agenda'}
        </button>
      )}
      {children}
    </div>
  );
}

export function StatusPill({ label, tone }: { label: string; tone: 'gruen' | 'bernstein' | 'leise' }) {
  const color = {
    gruen: 'border-gruen text-gruen',
    bernstein: 'border-bernstein text-bernstein',
    leise: 'border-rand-stark text-leise',
  };
  return (
    <span className={cx('rounded-full border px-2 py-px font-mono text-[10px] uppercase', color[tone])}>
      {label}
    </span>
  );
}

/** Verlauf in lesbaren Sätzen mit Person und Zeit */
export function KnowledgeHistory({
  history,
  noun,
  heading = true,
}: {
  history: HistoryEntry[];
  noun: 'Entscheidung' | 'Fakt' | 'Frage';
  /** ohne Überschrift, wenn ein Reiter sie schon nennt */
  heading?: boolean;
}) {
  const { memberById, topicName, eventById } = useLookups();
  const { data: appointments } = useData('appointments', () => api.listAppointments());
  const look = {
    memberName: (id: string) => memberById.get(id)?.display_name ?? 'Jemand',
    plenumTitle: (id: string) => appointments?.find((a) => a.id === id)?.title ?? '',
    topicName,
    eventTitle: (id: string) => eventById.get(id)?.title ?? 'unbekannt',
  };
  return (
    <div className="flex flex-col gap-2">
      {heading && <span className="label-mono">Verlauf</span>}
      <div className="flex flex-col">
        {history.map((h) => (
          <div key={h.id} className="flex gap-3 border-b border-erhoeht py-2.5 last:border-b-0">
            <span className="w-[88px] flex-none font-mono text-[11px] leading-[20px] whitespace-nowrap text-leise">
              {formatHistoryTime(h.created_at)}
            </span>
            <span className="text-[14px] leading-[1.4] text-weich">
              {knowledgeHistorySentence(h, noun, look)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Unten fixierte Aktionen einer Detailansicht */
export function ActionBar({ hint, children }: { hint?: string; children: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 flex flex-none flex-col gap-2.5 border-t border-linie bg-nav px-4 pt-3 pb-[calc(18px+env(safe-area-inset-bottom,0px))]">
      {hint && <span className="text-[13px] leading-[1.4] text-leise">{hint}</span>}
      <div className="flex gap-2.5">{children}</div>
    </div>
  );
}

export function NotFound({ text, back = BACK_TO_KNOWLEDGE }: { text: string; back?: BackTarget }) {
  return (
    <div data-wf="WF-ALL-05" className="flex flex-col items-center gap-3 py-10 text-center">
      <span className="text-[16px] font-semibold">{text}</span>
      <Link to={back.to} className="hit text-[14px] text-pink">
        Zu {back.label}
      </Link>
    </div>
  );
}

/** Bestätigungsdialog in der Mitte (z. B. Aufheben) */
export function ConfirmDialog({
  label,
  wf,
  onClose,
  children,
}: {
  label: string;
  wf: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useModal(onClose);
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-[rgba(6,5,10,0.72)] p-5">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={label}
        data-wf={wf}
        className="flex w-full max-w-[420px] flex-col gap-3.5 rounded-[22px] border border-rand bg-flaeche p-5"
      >
        {children}
      </div>
    </div>
  );
}
