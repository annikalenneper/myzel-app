// S-22 Veranstaltung – Detailbereiche · P4 (F-VER-04, WF-VER-08): aufklappbar mit Kurzzusammenfassung,
// offene Punkte in Bernstein. Kurze Felder speichern beim Verlassen, Auswahlen sofort, die Nachbereitung
// mit Speichern/Abbrechen und lokalem Entwurf (7.3).
import { useState, type ReactNode } from 'react';
import { clearDraft, readDraft, writeDraft } from '../../app/drafts';
import { useActions, useLatest } from '../../app/useActions';
import { api } from '../../data';
import type { EventDetail } from '../../data/api';
import {
  BAR_MODE_LABEL,
  BOOKING_ACT_TYPE_LABEL,
  BOOKING_FEE_STATUS_LABEL,
  BOOKING_STATUS_LABEL,
  DETAIL_SECTION_LABEL,
  ENTRY_MODE_LABEL,
  feeText,
  LOCATION_CONFIRMATION_LABEL,
  parseGermanNumber,
  type DetailSection,
} from '../../shared/rules/eventDetails';
import {
  BAR_MODES,
  BOOKING_ACT_TYPES,
  BOOKING_FEE_STATUSES,
  BOOKING_STATUSES,
  ENTRY_MODES,
  LOCATION_CONFIRMATIONS,
  type EventBooking,
  type EventDetailField,
} from '../../shared/schema';
import { cx, FieldError, GhostButton, LightButton } from '../../ui/bits';
import { DateTile } from '../../ui/DateTile';
import { Sheet } from '../../ui/Sheet';
import { DecisionSheet } from '../knowledge/KnowledgeSheets';
import { EventPartners } from './EventPartners';

const WF = 'WF-VER-08';
const SUBJECT = 'diese Veranstaltung';
const input =
  'h-11 w-full min-w-0 rounded-xl border border-rand bg-grund px-3 font-sans text-[15px] text-text normal-case';

interface SaveOptions {
  /** Wert, von dem die Eingabe ausging – Konflikt nur, wenn genau dieses Feld inzwischen geändert wurde */
  expected?: unknown;
  /** Meldung am Feld; ohne erscheint sie in der Leiste */
  onInvalid?: (message: string) => void;
}
type Save = (field: EventDetailField, value: unknown, options?: SaveOptions) => Promise<boolean>;

function useSave(event: EventDetail): Save {
  const act = useActions();
  const latest = useLatest(event.version);
  return (field, value, { expected, onInvalid } = {}) =>
    act(() => api.updateEventDetail(event.id, { field, value, expected, version: latest.current }), {
      subject: SUBJECT,
      success: 'Gespeichert',
      ownInput: value === null || value === undefined ? undefined : String(value),
      onInvalid: onInvalid && ((e) => onInvalid(e.message)),
    });
}

const germanNumber = (n: number) =>
  n.toLocaleString('de-DE', { useGrouping: false, maximumFractionDigits: 2 });

/** Kurzes Feld: speichert beim Verlassen; Enter verlässt, Escape verwirft */
function ShortField({
  label,
  field,
  value,
  save,
  number,
  wide,
  ariaLabel,
}: {
  label: string;
  field: EventDetailField;
  value: string | number | null;
  save: Save;
  number?: boolean;
  wide?: boolean;
  /** eindeutiger Name, wenn die sichtbare Beschriftung mehrfach vorkommt */
  ariaLabel?: string;
}) {
  const shown = value === null ? '' : typeof value === 'number' ? germanNumber(value) : value;
  const [draft, setDraft] = useState(shown);
  const [synced, setSynced] = useState(shown);
  // der Wert beim Hineintippen – gespeichert wird gegen ihn, nicht gegen einen inzwischen neueren
  const [base, setBase] = useState<{ value: string | number | null; shown: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // ein neuer Stand von außen ersetzt das Feld, solange niemand darin tippt
  if (shown !== synced) {
    setSynced(shown);
    // eine abgelehnte Eingabe bleibt mit ihrer Meldung stehen, bis sie korrigiert oder verworfen wird
    if (!base && !error) setDraft(shown);
  }
  const commit = async () => {
    const start = base ?? { value, shown };
    if (draft.trim() === start.shown.trim()) {
      setBase(null);
      return setDraft(shown);
    }
    let next: unknown = draft;
    if (number) {
      next = parseGermanNumber(draft);
      // die Eingabe bleibt mit Meldung stehen – und mit dem Wert, von dem sie ausging
      if (Number.isNaN(next)) return setError('Bitte eine Zahl eingeben.');
    }
    setError(null);
    setBase(null);
    await save(field, next, {
      expected: start.value,
      onInvalid: (message) => {
        setError(message);
        setBase(start);
      },
    });
  };
  return (
    <label className={cx('label-mono flex min-w-0 flex-col gap-1.5', wide && 'col-span-2')}>
      {label}
      <input
        type="text"
        inputMode={number ? 'decimal' : undefined}
        aria-label={ariaLabel}
        data-wf={WF}
        value={draft}
        // nach einer abgelehnten Eingabe bleibt der ursprüngliche Ausgangswert – sonst würde ein inzwischen
        // fremder Wert unbemerkt zur Grundlage
        onFocus={() => setBase((b) => b ?? { value, shown })}
        onChange={(e) => {
          setDraft(e.target.value);
          setError(null);
        }}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setDraft(shown);
            setError(null);
            // der Fokus bleibt im Feld: weitertippen geht vom jetzt angezeigten Wert aus
            setBase({ value, shown });
          }
        }}
        className={cx(input, error && 'border-rot')}
      />
      <FieldError>{error}</FieldError>
    </label>
  );
}

/** Auswahl, die sofort speichert; ein zweiter Tipp auf die gewählte nimmt sie zurück (wenn erlaubt) */
function Choice<T extends string>({
  label,
  field,
  value,
  options,
  labels,
  save,
  clearable = true,
  hideLabel = false,
}: {
  label: string;
  field: EventDetailField;
  value: T | null;
  options: readonly T[];
  labels: Record<T, string>;
  save: Save;
  clearable?: boolean;
  /** nur für Screenreader – wenn die Überschrift des Bereichs dasselbe sagt */
  hideLabel?: boolean;
}) {
  return (
    <div className="col-span-2 flex flex-col gap-1.5">
      {!hideLabel && <span className="label-mono">{label}</span>}
      <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = value === o;
          return (
            <button
              key={o}
              type="button"
              data-wf={WF}
              aria-pressed={on}
              onClick={() => {
                if (on && !clearable) return;
                void save(field, on ? null : o, { expected: value });
              }}
              className={cx(
                'hit h-8 rounded-2xl border px-3 text-[13px]',
                on ? 'border-text bg-text font-semibold text-grund' : 'border-rand text-weich',
              )}
            >
              {labels[o]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const grid = 'grid grid-cols-2 gap-3 px-4 pb-4';

function LocationFields({ event, save }: { event: EventDetail; save: Save }) {
  const l = event.details.location;
  return (
    <div className={grid}>
      <ShortField label="Name" field="location.name" value={l.name} save={save} wide />
      <ShortField label="Adresse" field="location.address" value={l.address} save={save} wide />
      <ShortField label="Kontakt" field="location.contact" value={l.contact} save={save} wide />
      <ShortField label="Kapazität" field="location.capacity" value={l.capacity} save={save} number />
      <ShortField label="Kosten (€)" field="location.cost" value={l.cost} save={save} number />
      <Choice
        label="Bestätigung"
        field="location.confirmation"
        value={l.confirmation}
        options={LOCATION_CONFIRMATIONS}
        labels={LOCATION_CONFIRMATION_LABEL}
        save={save}
      />
      <ShortField
        label="Barrierefreiheit"
        field="location.accessibility_notes"
        value={l.accessibility_notes}
        save={save}
        wide
      />
    </div>
  );
}

function BarFields({ event, save }: { event: EventDetail; save: Save }) {
  const b = event.details.bar;
  return (
    <div className={grid}>
      <Choice
        label="Bar"
        field="bar.mode"
        value={b.mode}
        options={BAR_MODES}
        labels={BAR_MODE_LABEL}
        save={save}
        hideLabel
      />
      <ShortField
        label="Getränkeplanung"
        field="bar.drinks_planning"
        value={b.drinks_planning}
        save={save}
        wide
      />
      <ShortField label="Notizen" field="bar.notes" value={b.notes} save={save} wide />
    </div>
  );
}

function EntryFields({ event, save }: { event: EventDetail; save: Save }) {
  const e = event.details.entry;
  return (
    <div className={grid}>
      <Choice
        label="Eintritt"
        field="entry.mode"
        value={e.mode}
        options={ENTRY_MODES}
        labels={ENTRY_MODE_LABEL}
        save={save}
        hideLabel
      />
      {/* frei: keine Felder; Spende: Empfehlung; fester Preis: Preis – beide mit Verantwortung für die Kasse */}
      {(e.mode === 'spende' || e.mode === 'fester_preis') && (
        <>
          <ShortField
            label={e.mode === 'spende' ? 'Empfehlung' : 'Preis'}
            field="entry.price"
            value={e.price}
            save={save}
            wide
          />
          <ShortField
            label="Verantwortung Kasse"
            field="entry.cashier_notes"
            value={e.cashier_notes}
            save={save}
            wide
          />
        </>
      )}
    </div>
  );
}

function CommunicationFields({ event, save }: { event: EventDetail; save: Save }) {
  const c = event.details.communication;
  return (
    <div className={grid}>
      <div className="col-span-2">
        <DateTile
          label="Ankündigung am"
          value={c.announcement_date ?? ''}
          onChange={(v) =>
            void save('communication.announcement_date', v || null, { expected: c.announcement_date })
          }
          wf={WF}
          surface="bg-grund"
        />
      </div>
      <ShortField
        label="Kanäle und Notizen"
        field="communication.channels"
        value={c.channels}
        save={save}
        wide
      />
    </div>
  );
}

function NumberFields({ event, save }: { event: EventDetail; save: Save }) {
  const n = event.details.numbers;
  return (
    <div className={grid}>
      <ShortField
        label="Budget (€)"
        field="numbers.budget_planned"
        value={n.budget_planned}
        save={save}
        number
        wide
      />
      <ShortField
        label="Erwartet"
        field="numbers.expected_visitors"
        value={n.expected_visitors}
        save={save}
        number
      />
      <ShortField
        label="Gekommen"
        field="numbers.actual_visitors"
        value={n.actual_visitors}
        save={save}
        number
      />
      <span className="col-span-2 text-[12px] leading-[1.4] text-leise">
        Die Abrechnung bleibt in MeinVerein.
      </span>
    </div>
  );
}

/** Nachbereitung: langer Text mit Speichern/Abbrechen; daraus können Entscheidungen entstehen (3.4) */
function Retrospective({ event }: { event: EventDetail }) {
  const act = useActions();
  const latest = useLatest(event.version);
  const draftKey = `event:${event.id}:nachbereitung`;
  // Stand, von dem der Entwurf ausging – ein fremder neuerer Text wird nicht still überschrieben
  const baseKey = `${draftKey}:basis`;
  const [draft, setDraft] = useState(() => readDraft(draftKey));
  const [base, setBaseState] = useState(() => readDraft(baseKey));
  const setBase = (value: string | null) => {
    if (value === null) clearDraft(baseKey);
    else writeDraft(baseKey, value);
    setBaseState(value);
  };
  const [deciding, setDeciding] = useState(false);
  const editing = draft !== null;
  const text = event.details.retrospective;

  const open = () => {
    setBase(text ?? '');
    setDraft(text ?? '');
  };
  const cancel = () => {
    clearDraft(draftKey);
    setBase(null);
    setDraft(null);
  };
  // jemand hat den Text geändert, während der Entwurf offen war (z. B. nach „Neu laden“ im Konfliktdialog)
  const changedMeanwhile = editing && base !== null && (base || null) !== text;
  /** `rebase`: bewusst den eigenen Entwurf über den inzwischen gespeicherten Text legen */
  const save = async (rebase = false) => {
    const value = draft ?? '';
    const expected = rebase || base === null ? text : base || null;
    const ok = await act(
      () =>
        api.updateEventDetail(event.id, { field: 'retrospective', value, expected, version: latest.current }),
      { subject: SUBJECT, success: 'Gespeichert', ownInput: value, draftKept: true },
    );
    if (ok) cancel();
  };

  return (
    <div className="flex flex-col gap-2.5 px-4 pb-4">
      {editing ? (
        <>
          <textarea
            data-wf={WF}
            aria-label="Nachbereitung"
            autoFocus
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              writeDraft(draftKey, e.target.value);
            }}
            className="min-h-[120px] resize-y rounded-[14px] border border-violett bg-grund px-3.5 py-3 font-sans text-[14px] leading-normal text-text"
          />
          {changedMeanwhile && (
            <div
              role="note"
              className="flex flex-col gap-2 rounded-xl border border-bernstein/40 bg-flaeche px-3 py-2.5 text-[13px] leading-[1.45] text-weich"
            >
              <span>Inzwischen gespeicherter Text:</span>
              <span className="whitespace-pre-wrap text-text">{text ?? '—'}</span>
              <button
                type="button"
                data-wf={WF}
                onClick={() => void save(true)}
                className="hit self-start text-[13px] font-semibold text-pink"
              >
                Meinen Entwurf speichern – ersetzt diesen Text
              </button>
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            <span className="label-mono flex-1 text-matt">Entwurf lokal gesichert</span>
            <button type="button" onClick={cancel} className="hit h-9 px-3.5 text-[14px] text-leise">
              Abbrechen
            </button>
            <button
              type="button"
              data-wf={WF}
              disabled={changedMeanwhile}
              onClick={() => void save()}
              className={cx(
                'hit h-9 rounded-[18px] px-4 text-[14px] font-semibold',
                changedMeanwhile ? 'bg-linie text-matt' : 'bg-geplant text-grund',
              )}
            >
              Speichern
            </button>
          </div>
        </>
      ) : (
        <>
          {text ? (
            <div className="text-[14px] leading-normal whitespace-pre-wrap text-weich">{text}</div>
          ) : (
            <span className="text-[14px] text-leise">Was lief gut, was nehmen wir mit?</span>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              data-wf={WF}
              onClick={open}
              className="hit h-[34px] rounded-[17px] border border-rand-stark px-3 text-[13px] text-text"
            >
              {text ? 'Bearbeiten' : 'Schreiben'}
            </button>
            <button
              type="button"
              data-wf="WF-WIS-01"
              onClick={() => setDeciding(true)}
              className="hit h-[34px] rounded-[17px] border border-rand-stark px-3 text-[13px] text-text"
            >
              Entscheidung daraus festhalten
            </button>
          </div>
        </>
      )}
      {deciding && (
        <DecisionSheet
          sourceNote={`Nachbereitung ${event.title}`}
          onClose={() => setDeciding(false)}
          onCreated={() => setDeciding(false)}
        />
      )}
    </div>
  );
}

// ── Booking ─────────────────────────────────────────────────────────────────

const BOOKING_DOT: Record<EventBooking['status'], string> = {
  angefragt: 'bg-bernstein',
  zugesagt: 'bg-gruen',
  abgesagt: 'bg-matt',
};

function Bookings({ event }: { event: EventDetail }) {
  const [sheet, setSheet] = useState<EventBooking | 'new' | null>(null);
  return (
    <div className="flex flex-col gap-2 px-4 pb-4">
      {event.bookings.map((b) => (
        <button
          key={b.id}
          type="button"
          data-wf={WF}
          aria-label={`Act bearbeiten: ${b.act_name}`}
          onClick={() => setSheet(b)}
          className="flex min-h-11 items-center gap-2.5 rounded-xl bg-grund px-3 py-2.5 text-left text-text"
        >
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className={cx('text-[15px] font-semibold', b.status === 'abgesagt' && 'line-through')}>
              {b.act_name}
            </span>
            <span className="font-mono text-[11px] text-leise uppercase">
              {[BOOKING_ACT_TYPE_LABEL[b.act_type], feeText(b), b.tech_requirements]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </span>
          <span className="flex items-center gap-1.5 text-[12px]">
            <span className={cx('size-[7px] rounded-full', BOOKING_DOT[b.status])} />
            {BOOKING_STATUS_LABEL[b.status]}
          </span>
        </button>
      ))}
      <button
        type="button"
        data-wf={WF}
        onClick={() => setSheet('new')}
        className="hit h-10 rounded-xl border border-dashed border-rand-stark text-[14px] text-leise"
      >
        + Act hinzufügen
      </button>
      {sheet && (
        <BookingSheet
          key={sheet === 'new' ? 'new' : `${sheet.id}:${sheet.version}`}
          eventId={event.id}
          booking={sheet === 'new' ? null : sheet}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}

function BookingSheet({
  eventId,
  booking,
  onClose,
}: {
  eventId: string;
  booking: EventBooking | null;
  onClose: () => void;
}) {
  const act = useActions();
  const [name, setName] = useState(booking?.act_name ?? '');
  const [type, setType] = useState<EventBooking['act_type'] | null>(booking?.act_type ?? null);
  const [status, setStatus] = useState<EventBooking['status']>(booking?.status ?? 'angefragt');
  const [contact, setContact] = useState(booking?.contact ?? '');
  const [feeStatus, setFeeStatus] = useState<EventBooking['fee_status']>(booking?.fee_status ?? 'offen');
  const [fee, setFee] = useState(booking?.fee ?? '');
  const [tech, setTech] = useState(booking?.tech_requirements ?? '');
  const [notes, setNotes] = useState(booking?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const missing = !name.trim()
    ? 'Namen eingeben, dann speichern'
    : !type
      ? 'Art wählen, dann speichern'
      : null;

  const submit = async () => {
    if (missing || !type) return;
    const fields = {
      act_name: name,
      act_type: type,
      status,
      contact,
      fee_status: feeStatus,
      fee,
      tech_requirements: tech,
      notes,
    };
    const ok = booking
      ? await act(() => api.updateBooking(booking.id, { ...fields, version: booking.version }), {
          subject: 'diesen Act',
          success: 'Gespeichert',
          onInvalid: (e) => setError(e.message),
        })
      : await act(() => api.addBooking(eventId, fields), {
          success: `Act angelegt: ${name.trim()}`,
          undo: (r) => r.undo_token,
          onInvalid: (e) => setError(e.message),
        });
    if (ok) onClose();
  };

  const chips = <T extends string>(
    label: string,
    options: readonly T[],
    labels: Record<T, string>,
    value: T | null,
    set: (v: T) => void,
  ) => (
    <div className="flex flex-col gap-1.5">
      <span className="label-mono">{label}</span>
      <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            data-wf={WF}
            aria-pressed={value === o}
            onClick={() => set(o)}
            className={cx(
              'hit h-8 rounded-2xl border px-3 text-[13px]',
              value === o ? 'border-text bg-text font-semibold text-grund' : 'border-rand text-weich',
            )}
          >
            {labels[o]}
          </button>
        ))}
      </div>
    </div>
  );
  const text = (label: string, value: string, set: (v: string) => void, autoFocus = false) => (
    <label className="label-mono flex flex-col gap-1.5">
      {label}
      <input
        type="text"
        data-wf={WF}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => {
          set(e.target.value);
          setError(null);
        }}
        className={input}
      />
    </label>
  );

  return (
    <Sheet title={booking ? 'Act bearbeiten' : 'Neuer Act'} onClose={onClose} wf={WF} closeButton>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {text('Name *', name, setName, !booking)}
        {chips('Art *', BOOKING_ACT_TYPES, BOOKING_ACT_TYPE_LABEL, type, setType)}
        {chips('Status', BOOKING_STATUSES, BOOKING_STATUS_LABEL, status, setStatus)}
        {text('Kontakt', contact, setContact)}
        {chips('Gage', BOOKING_FEE_STATUSES, BOOKING_FEE_STATUS_LABEL, feeStatus, setFeeStatus)}
        {/* Betrag nur bei Gage „ja“ */}
        {feeStatus === 'ja' && text('Betrag', fee, setFee)}
        {text('Technik', tech, setTech)}
        {text('Notizen', notes, setNotes)}
        <FieldError>{error}</FieldError>
        <LightButton type="submit" data-wf={WF} disabled={!!missing}>
          {missing ?? 'Speichern'}
        </LightButton>
        {booking && (
          <GhostButton
            data-wf={WF}
            onClick={() => {
              onClose();
              void act(() => api.removeBooking(booking.id), {
                success: `Act entfernt: ${booking.act_name}`,
                undo: (r) => r.undo_token,
              });
            }}
          >
            Act entfernen
          </GhostButton>
        )}
      </form>
    </Sheet>
  );
}

// ── Liste der Bereiche ──────────────────────────────────────────────────────

export function EventSections({ event }: { event: EventDetail }) {
  const [open, setOpen] = useState<DetailSection | null>(null);
  const save = useSave(event);
  const content: Record<DetailSection, ReactNode> = {
    location: <LocationFields event={event} save={save} />,
    booking: <Bookings event={event} />,
    bar: <BarFields event={event} save={save} />,
    entry: <EntryFields event={event} save={save} />,
    communication: <CommunicationFields event={event} save={save} />,
    numbers: <NumberFields event={event} save={save} />,
    retrospective: <Retrospective event={event} />,
    partner: <EventPartners event={event} />,
  };
  return (
    <div data-wf={WF} className="flex flex-col overflow-hidden rounded-2xl border border-linie">
      {event.summaries.map((s) => {
        const isOpen = open === s.section;
        const label = DETAIL_SECTION_LABEL[s.section];
        return (
          <section
            key={s.section}
            aria-label={label}
            className={cx('flex flex-col border-b border-linie last:border-b-0', isOpen && 'bg-flaeche')}
          >
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : s.section)}
              className="flex min-h-[54px] items-center gap-3 px-4 py-2.5 text-left text-text"
            >
              <span
                className={cx(
                  'w-[104px] flex-none font-mono text-[11px] uppercase',
                  s.open ? 'text-bernstein' : 'text-leise',
                )}
              >
                {label}
                {s.open && <span className="sr-only"> – offene Punkte</span>}
              </span>
              <span className="min-w-0 flex-1 text-[14px] text-weich">{s.text}</span>
              <span aria-hidden="true" className="text-[14px] text-leise">
                {isOpen ? '–' : '+'}
              </span>
            </button>
            {isOpen && content[s.section]}
          </section>
        );
      })}
    </div>
  );
}
