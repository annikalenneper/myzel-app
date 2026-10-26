// Dialoge der Aufgaben-Detailansicht: S-13 Blockieren, Verwerfen, Personen, Auswahl, Archivieren
import { useState, type ReactNode } from 'react';
import { clearDraft, readDraft, writeDraft } from '../../app/drafts';
import type { TaskListItem } from '../../data/api';
import { TASK_STATUS_LABEL } from '../../shared/labels';
import { BLOCK_REASON_MISSING } from '../../shared/rules/taskStatus';
import type { Member } from '../../shared/schema';
import { Avatar, CheckBox, cx, FieldError, GhostButton, LightButton } from '../../ui/bits';
import { Sheet } from '../../ui/Sheet';

/** S-13 Dialog Blockieren · WF-AUF-07: Grund ist Pflicht, blockierende Aufgaben per Suche */
export function BlockSheet({
  taskId,
  candidates,
  onClose,
  onConfirm,
}: {
  taskId: string;
  /** Aufgaben, die als „wartet auf“ in Frage kommen */
  candidates: TaskListItem[];
  onClose: () => void;
  /** 'ok' = gespeichert; 'failed' = Netzfehler oder Konflikt (Dialog bleibt offen); sonst Meldung fürs Feld */
  onConfirm: (reason: string, blockerIds: string[]) => Promise<string>;
}) {
  const draftKey = `task:${taskId}:blockgrund`;
  const [reason, setReason] = useState(() => readDraft(draftKey) ?? '');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  // Ausgewählte bleiben sichtbar; dazu Treffer der Suche bzw. ohne Suchwort ein paar Vorschläge
  const shown = [
    ...candidates.filter((t) => picked.includes(t.id)),
    ...candidates
      .filter((t) => !picked.includes(t.id) && (!q || t.title.toLowerCase().includes(q)))
      .slice(0, q ? 8 : 4),
  ];

  return (
    <Sheet title="Blockieren" onClose={onClose} wf="WF-AUF-07">
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          // Grund oder mindestens eine Aufgabe, auf die gewartet wird
          if (!reason.trim() && picked.length === 0) {
            setError(BLOCK_REASON_MISSING);
            return;
          }
          const result = await onConfirm(reason, picked);
          // der Entwurf bleibt, bis wirklich gespeichert ist
          if (result === 'ok') clearDraft(draftKey);
          else if (result !== 'failed') setError(result);
        }}
      >
        <label htmlFor="block-grund" className="label-mono">
          {picked.length ? 'Grund (optional)' : 'Grund *'}
        </label>
        <textarea
          id="block-grund"
          data-wf="WF-AUF-07"
          required={picked.length === 0}
          autoFocus
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setError(null);
            writeDraft(draftKey, e.target.value);
          }}
          className="min-h-20 rounded-[14px] border border-rand bg-grund px-3.5 py-3 text-[15px] leading-normal text-text"
        />
        <FieldError>{error}</FieldError>
        <span className="label-mono">Wartet auf – statt eines Grunds</span>
        <input
          type="search"
          data-wf="WF-AUF-07"
          aria-label="Aufgabe suchen"
          placeholder="Aufgabe suchen …"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-[42px] rounded-xl border border-rand bg-grund px-3.5 text-[14px] text-text"
        />
        {shown.map((t) => {
          const on = picked.includes(t.id);
          return (
            <button
              key={t.id}
              type="button"
              role="checkbox"
              aria-checked={on}
              data-wf="WF-AUF-07"
              onClick={() => setPicked(on ? picked.filter((id) => id !== t.id) : [...picked, t.id])}
              className="flex min-h-11 items-center gap-2.5 rounded-xl border border-linie bg-grund px-3 py-1.5 text-left text-[14px] text-text"
            >
              <CheckBox checked={on} size={20} />
              <span className="flex-1">{t.title}</span>
              <span className="label-mono">{TASK_STATUS_LABEL[t.status]}</span>
            </button>
          );
        })}
        {q && shown.length === 0 && <span className="text-[13px] text-leise">Keine passende Aufgabe.</span>}
        <button
          type="submit"
          data-wf="WF-AUF-07"
          disabled={!reason.trim() && picked.length === 0}
          className={cx(
            'h-[50px] rounded-[25px] text-[16px] font-bold',
            reason.trim() || picked.length
              ? 'bg-rot text-grund'
              : 'bg-erhoeht text-[15px] font-semibold text-leise',
          )}
        >
          {reason.trim() || picked.length ? 'Blockieren' : 'Grund oder Aufgabe wählen, dann blockieren'}
        </button>
      </form>
    </Sheet>
  );
}

/** WF-AUF-09 Verwerfen mit optionalem Grund */
export function DiscardSheet({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <Sheet title="Aufgabe verwerfen" onClose={onClose} wf="WF-AUF-09">
      <label htmlFor="verwerfen-grund" className="label-mono">
        Grund (optional)
      </label>
      <textarea
        id="verwerfen-grund"
        data-wf="WF-AUF-09"
        autoFocus
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="min-h-[70px] rounded-[14px] border border-rand bg-grund px-3.5 py-3 text-[15px] text-text"
      />
      <LightButton data-wf="WF-AUF-09" onClick={() => onConfirm(reason)}>
        Verwerfen
      </LightButton>
    </Sheet>
  );
}

/** WF-AUF-10 / WF-AUF-11 Personenauswahl: nur aktive Mitglieder, jeder Tipp speichert einzeln */
export function PeopleSheet({
  title,
  wf,
  members,
  selectedIds,
  onToggle,
  onAll,
  onClose,
}: {
  title: string;
  wf: string;
  members: Member[];
  selectedIds: string[];
  onToggle: (member: Member, selected: boolean) => void;
  /** Phase 9: „Alle“ trägt alle ein, die noch fehlen */
  onAll?: (missing: Member[]) => void;
  onClose: () => void;
}) {
  const missing = members.filter((m) => !selectedIds.includes(m.id));
  return (
    <Sheet title={title} onClose={onClose} wf={wf}>
      <div className="flex flex-col gap-1.5">
        {onAll && (
          <button
            type="button"
            data-wf={wf}
            disabled={missing.length === 0}
            onClick={() => onAll(missing)}
            className="flex h-12 flex-none items-center gap-3 rounded-xl border border-rand-stark bg-grund px-3 text-left text-[15px] font-semibold text-text disabled:opacity-50"
          >
            <span className="flex-1">Alle</span>
            <span className="font-mono text-[12px] font-normal text-leise">
              {missing.length === 0 ? 'alle eingetragen' : `${missing.length} dazu`}
            </span>
          </button>
        )}
        {members.map((m) => {
          const on = selectedIds.includes(m.id);
          return (
            <button
              key={m.id}
              type="button"
              role="checkbox"
              aria-checked={on}
              data-wf={wf}
              onClick={() => onToggle(m, on)}
              className="flex h-12 flex-none items-center gap-3 rounded-xl border border-linie bg-grund px-3 text-left text-[15px] text-text"
            >
              <Avatar member={m} size={30} />
              <span className="flex-1">{m.display_name}</span>
              <span className="text-[16px] text-gruen">{on ? '✓' : ''}</span>
            </button>
          );
        })}
        <GhostButton className="mt-1.5 flex-none" onClick={onClose}>
          Fertig
        </GhostButton>
      </div>
    </Sheet>
  );
}

export interface PickerOption {
  key: string;
  label: ReactNode;
  selected: boolean;
  indent?: boolean;
}

/** Auswahl für die Feld-Kacheln (Thema, Priorität, Veranstaltung): ein Tipp wählt und schließt */
export function PickerSheet({
  title,
  wf,
  options,
  onPick,
  onClose,
  header,
  footer,
}: {
  title: string;
  wf: string;
  options: PickerOption[];
  onPick: (key: string) => void;
  onClose: () => void;
  /** z. B. ein Suchfeld über der Liste */
  header?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Sheet title={title} onClose={onClose} wf={wf} closeButton>
      <div className="flex flex-col gap-1.5">
        {header}
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            data-wf={wf}
            aria-pressed={o.selected}
            onClick={() => onPick(o.key)}
            className={cx(
              'flex min-h-12 flex-none items-center gap-3 rounded-xl border px-3 py-1.5 text-left text-[15px] text-text',
              o.selected ? 'border-rand-stark bg-erhoeht font-semibold' : 'border-linie bg-grund',
              o.indent && 'ml-5',
            )}
          >
            <span className="flex flex-1 items-center gap-2.5">{o.label}</span>
            <span className="text-[16px] text-gruen">{o.selected ? '✓' : ''}</span>
          </button>
        ))}
        {footer}
      </div>
    </Sheet>
  );
}

/** WF-AUF-14 Archivieren – bei Aufgaben mit Kommentaren mit Bestätigung */
export function ArchiveSheet({
  commentCount,
  onClose,
  onConfirm,
}: {
  commentCount: number;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Sheet title="Aufgabe archivieren" onClose={onClose} wf="WF-AUF-14">
      <span className="text-[14px] leading-normal text-weich">
        {commentCount > 0 &&
          `Die Aufgabe hat ${commentCount} ${commentCount === 1 ? 'Kommentar' : 'Kommentare'}. `}
        Archivierte Aufgaben verschwinden aus allen Listen, lassen sich aber wiederherstellen.
      </span>
      <LightButton data-wf="WF-AUF-14" onClick={onConfirm}>
        {commentCount > 0 ? 'Trotzdem archivieren' : 'Archivieren'}
      </LightButton>
      <GhostButton onClick={onClose}>Abbrechen</GhostButton>
    </Sheet>
  );
}
