// S-33 Plenum – Detail · P3: ein Termin mit Ergebnis und Protokoll (F-PLE-01, -04; 16.2). Die Agenda ist seit dem
// Umbau 10/2026 eine eigene Ansicht.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { clearDraft, readDraft, writeDraft } from '../../app/drafts';
import { useNow } from '../../app/useNow';
import { BarOffset } from '../../app/feedback';
import { useLookups } from '../../app/lookups';
import { useActions, useLatest } from '../../app/useActions';
import { useData } from '../../app/useData';
import { api } from '../../data';
import type { PlenumDetail as Detail } from '../../data/api';
import { formatEventRange } from '../../shared/format';
import { CalendarLinks, CallButton } from './CalendarLinks';
import { ArchivedNotice, DeleteDialog, useDeleteArtifact } from '../common/DeleteAction';
import {
  APPOINTMENT_STATUS_COLOR,
  APPOINTMENT_STATUS_LABEL,
  canRsvp,
  FORMAT_LABEL,
  hasStarted,
  whenText,
} from '../../shared/rules/appointments';
import { RESULT_TITLE, type ResultItem } from '../../shared/rules/plenum';
import type { Member } from '../../shared/schema';
import { Avatar, cx, FieldError, GhostButton, ListSkeleton, LoadError } from '../../ui/bits';
import { IconMore } from '../../ui/icons';
import { Sheet } from '../../ui/Sheet';
import { CommentsAndHistory } from '../../ui/Comments';
import { HistoryList } from '../../ui/HistoryList';
import { entityHistorySentence } from '../../shared/entityHistory';
import { ConfirmDialog } from '../knowledge/DetailParts';
import { DocumentPickSheet } from '../knowledge/DocumentPickSheet';
import { TopBar } from './AppointmentDetail';
import { AppointmentFormSheet } from './AppointmentFormSheet';
import { rsvpButton, useRsvp } from './AppointmentsScreen';

type Tab = 'ergebnis' | 'protokoll';

export function PlenumDetail({ plenumId }: { plenumId: string }) {
  const { data, error, reload } = useData(`plenum:${plenumId}`, () => api.getPlenum(plenumId));
  if (!data)
    return (
      <div className="flex min-h-dvh flex-col lg:min-h-0">
        <TopBar />
        <div className="px-5 py-[18px]">
          {error ? <LoadError message={error.message} onRetry={reload} /> : <ListSkeleton />}
        </div>
      </div>
    );
  return <Loaded p={data} />;
}

function Loaded({ p }: { p: Detail }) {
  const act = useActions();
  const latest = useLatest(p.version);
  const remove = useDeleteArtifact('appointment', p.id, () => latest.current, '/termine');
  const rsvp = useRsvp();
  const { memberById, activeMembers, topicName, eventById } = useLookups();
  const now = useNow();
  const closed = p.status === 'abgeschlossen';
  const cancelled = p.status === 'abgesagt';
  const open = !closed && !cancelled;
  const started = hasStarted(p, now);
  const [tab, setTab] = useState<Tab>('ergebnis');
  const [sheet, setSheet] = useState<'edit' | 'cancel' | 'close' | 'delete' | null>(null);
  const [menu, setMenu] = useState(false);
  // 16.2: nach dem Abschluss ändert sich die Anwesenheit nur nach Rückfrage (einmal je Ansicht)
  const [attendanceUnlocked, setAttendanceUnlocked] = useState(false);
  const [askAttendance, setAskAttendance] = useState<(() => void) | null>(null);
  // vergangen und nicht abgeschlossen: nur ein Hinweis (F-PLE-01), am Tag danach
  const overdue = open && now.getTime() - new Date(p.ends_at ?? p.starts_at).getTime() > 12 * 3_600_000;
  const resultCount = p.results.reduce((n, g) => n + g.items.length, 0);

  const tabs: [Tab, string][] = [
    ['ergebnis', `Ergebnis · ${resultCount}`],
    ['protokoll', 'Protokoll'],
  ];
  const people = [...p.yes_ids];

  return (
    <div className="flex min-h-dvh flex-col lg:min-h-0">
      <BarOffset px={open ? 128 : 92} />
      <TopBar>
        <div className="relative">
          <button
            type="button"
            aria-label="Weitere Aktionen zum Plenum"
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
            className="hit mr-1 flex size-11 items-center justify-center text-leise"
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
                {/* WF-TER-04 / -05 gelten für alle Terminarten, auch Plenum */}
                {p.status === 'geplant' && (
                  <>
                    <button
                      type="button"
                      data-wf="WF-TER-04"
                      onClick={() => {
                        setMenu(false);
                        setSheet('edit');
                      }}
                      className="flex min-h-11 items-center rounded-[10px] px-3 text-left text-[15px] text-text"
                    >
                      Bearbeiten
                    </button>
                    <button
                      type="button"
                      data-wf="WF-TER-05"
                      onClick={() => {
                        setMenu(false);
                        setSheet('cancel');
                      }}
                      className="flex min-h-11 items-center rounded-[10px] px-3 text-left text-[15px] text-rot-hell"
                    >
                      Plenum absagen
                    </button>
                  </>
                )}
                {/* WF-ALL-09 Löschen (Phase 9) – nicht, wenn schon gelöscht */}
                {!p.archived_at && (
                  <button
                    type="button"
                    data-wf="WF-ALL-09"
                    onClick={() => {
                      setMenu(false);
                      setSheet('delete');
                    }}
                    className="flex min-h-11 items-center rounded-[10px] px-3 text-left text-[15px] text-rot-hell"
                  >
                    Löschen …
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </TopBar>
      {sheet === 'delete' && (
        <DeleteDialog
          noun="Plenum"
          consequence="Sein Ergebnis bleibt in den Einträgen erhalten."
          onConfirm={() => void remove()}
          onClose={() => setSheet(null)}
        />
      )}

      <div className="flex flex-1 flex-col gap-4 px-5 pt-1 pb-10">
        {p.archived_at && <ArchivedNotice />}
        <div className="flex flex-col gap-2">
          <span className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-pink uppercase">
            <span className="size-2 flex-none rounded-full" style={{ background: p.type_color }} />
            {p.type_label} · {FORMAT_LABEL[p.format]}
            <span
              className="rounded-full border px-2 py-px"
              style={{
                borderColor: APPOINTMENT_STATUS_COLOR[p.status],
                color: APPOINTMENT_STATUS_COLOR[p.status],
              }}
            >
              {APPOINTMENT_STATUS_LABEL[p.status]}
            </span>
          </span>
          <h1
            className={cx(
              'm-0 text-[30px] leading-[1.15] font-bold tracking-[-1px]',
              cancelled && 'line-through',
            )}
          >
            {p.title}
          </h1>
          <span className="font-mono text-[13px] text-weich uppercase">
            {formatEventRange(p.starts_at, p.ends_at)}
          </span>
          {!cancelled && <CalendarLinks a={p} />}
        </div>

        {open && p.format !== 'vor_ort' && <CallButton url={p.online_url} />}

        {cancelled && (
          <div className="rounded-[14px] border border-rot-rand bg-rot-flaeche px-3.5 py-3 text-[14px] leading-normal">
            Abgesagt.
          </div>
        )}
        {overdue && (
          <div
            role="note"
            className="rounded-[14px] border border-bernstein/40 bg-flaeche px-3.5 py-3 text-[14px] leading-normal text-weich"
          >
            Dieses Plenum liegt zurück und ist noch nicht abgeschlossen. Wenn es stattgefunden hat: unten
            abschließen, dann geht die Zusammenfassung raus.
          </div>
        )}

        {/* Teilnehmende (F-PLE-01) – Korrekturen bleiben möglich wie bei allen Terminen (WF-TER-06) */}
        {closed && (
          <div className="flex flex-col gap-2.5 rounded-[14px] border border-linie bg-flaeche px-3.5 py-3">
            <span className="label-mono">
              Teilnahme · {p.attendee_ids.length} waren da · Korrekturen möglich
            </span>
            <div role="group" aria-label="Teilnahme" className="flex flex-wrap gap-1.5">
              {[
                ...activeMembers,
                // wer inzwischen deaktiviert ist, bleibt sichtbar und korrigierbar
                ...p.attendee_ids
                  .map((id) => memberById.get(id))
                  .filter((m): m is Member => !!m && !m.active),
              ].map((m) => {
                const on = p.attendee_ids.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    data-wf="WF-TER-06"
                    aria-pressed={on}
                    aria-label={`${m.display_name} war da`}
                    onClick={() => {
                      const change = () =>
                        void act(() => api.setAttendee(p.id, m.id, !on), {
                          success: 'Gespeichert',
                          plenum: false,
                        });
                      if (attendanceUnlocked) change();
                      else setAskAttendance(() => change);
                    }}
                    className={cx(
                      'hit h-8 min-w-11 rounded-2xl border px-2.5 font-mono text-[12px] font-semibold',
                      on ? 'border-gruen bg-gruen text-grund' : 'border-rand-stark text-weich',
                    )}
                  >
                    {m.short}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* WF-TER-03 Zu-/Absage – gilt für alle Terminarten, auch Plenum */}
        {open && (
          <div className="flex flex-col gap-2.5 rounded-[14px] border border-linie bg-flaeche px-3.5 py-3">
            <div className="flex items-center gap-3">
              <span className="flex pl-1.5">
                {people.slice(0, 4).map((id) => (
                  <Avatar
                    key={id}
                    member={memberById.get(id)}
                    size={28}
                    className="-ml-1.5 border-2 border-flaeche"
                  />
                ))}
                {people.length > 4 && (
                  <span className="-ml-1.5 flex size-7 items-center justify-center rounded-full border-2 border-flaeche bg-geplant font-mono text-[9px] font-semibold text-grund">
                    +{people.length - 4}
                  </span>
                )}
              </span>
              <span className="font-mono text-[12px] text-weich uppercase">
                {p.yes_ids.length} kommen · {p.no_ids.length} nicht · {p.open_ids.length} offen
              </span>
            </div>
            {canRsvp(p, now) && (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  data-wf="WF-TER-03"
                  aria-pressed={p.my_answer === 'ja'}
                  onClick={() => rsvp(p, 'ja')}
                  className={cx(
                    rsvpButton(p.my_answer === 'ja', 'ja'),
                    'h-[38px] rounded-[19px] text-[14px]',
                  )}
                >
                  Komme
                </button>
                <button
                  type="button"
                  data-wf="WF-TER-03"
                  aria-pressed={p.my_answer === 'nein'}
                  onClick={() => rsvp(p, 'nein')}
                  className={cx(
                    rsvpButton(p.my_answer === 'nein', 'nein'),
                    'h-[38px] rounded-[19px] text-[14px]',
                  )}
                >
                  Komme nicht
                </button>
              </div>
            )}
          </div>
        )}

        {p.description && (
          <div className="text-[15px] leading-normal whitespace-pre-wrap text-weich">{p.description}</div>
        )}
        <div role="tablist" aria-label="Plenum" className="flex gap-[22px] border-b border-linie">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={cx(
                'hit -mb-px border-b-2 py-2.5 font-mono text-[12px] uppercase',
                tab === key ? 'border-pink text-text' : 'border-transparent text-leise',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'ergebnis' && <Results p={p} />}
        {tab === 'protokoll' && <Protocol p={p} />}

        {/* 16.3: Kommentare und Verlauf wie an jedem Termin */}
        <CommentsAndHistory
          target="appointment"
          targetId={p.id}
          comments={p.comments}
          archived={!!p.archived_at}
          history={
            <HistoryList
              heading={false}
              entries={p.history}
              sentence={(h) =>
                entityHistorySentence(h, 'Termin', {
                  memberName: (id) => memberById.get(id)?.display_name ?? 'Jemand',
                  topicName,
                  eventTitle: (id) => eventById.get(id)?.title ?? 'unbekannt',
                })
              }
            />
          }
        />
      </div>

      {/* unten fixiert: Abschließen (WF-PLE-20) */}
      {!cancelled && (
        <div className="sticky bottom-0 z-10 flex flex-none flex-col gap-2 border-t border-linie bg-nav px-5 pt-2.5 pb-[calc(20px+env(safe-area-inset-bottom,0px))]">
          {closed ? (
            <span className="flex h-[52px] items-center justify-center text-center text-[15px] text-gruen">
              Abgeschlossen
              {p.summary_recipients !== null &&
                ` · Zusammenfassung an ${p.summary_recipients} Mitglieder verschickt`}
            </span>
          ) : !started ? (
            <button
              type="button"
              data-wf="WF-PLE-20"
              disabled
              className="h-[52px] rounded-[26px] bg-erhoeht text-[15px] font-semibold text-matt"
            >
              Abschließen ab {whenText(p.starts_at)}
            </button>
          ) : (
            <>
              <span className="label-mono text-center">
                Setzt „stattgefunden“ mit · sendet die Zusammenfassung an alle
              </span>
              <button
                type="button"
                data-wf="WF-PLE-20"
                onClick={() => setSheet('close')}
                className="h-[52px] rounded-[26px] bg-gradient-to-r from-pink via-violett to-blau text-[16px] font-bold text-grund"
              >
                Plenum abschließen
              </button>
            </>
          )}
        </div>
      )}

      {sheet === 'edit' && (
        <AppointmentFormSheet key={p.version} appointment={p} onClose={() => setSheet(null)} />
      )}
      {sheet === 'cancel' && (
        <ConfirmDialog label="Plenum absagen" wf="WF-TER-05" onClose={() => setSheet(null)}>
          <h2 className="m-0 text-[20px] leading-[1.25] font-bold">{p.title} absagen?</h2>
          <span className="text-[15px] leading-normal text-weich">
            Alle mit Zusage und ohne Antwort bekommen eine Nachricht.
          </span>
          <button
            type="button"
            data-wf="WF-TER-05"
            autoFocus
            onClick={() => {
              setSheet(null);
              void act(() => api.cancelAppointment(p.id, latest.current), {
                plenum: false,
                subject: 'dieses Plenum',
                success: 'Abgesagt – Benachrichtigung geht raus',
              });
            }}
            className="h-12 rounded-3xl bg-rot text-[15px] font-bold text-grund"
          >
            Absagen und benachrichtigen
          </button>
          <GhostButton onClick={() => setSheet(null)}>Doch nicht</GhostButton>
        </ConfirmDialog>
      )}
      {sheet === 'close' && <CloseSheet p={p} onClose={() => setSheet(null)} />}
      {askAttendance && (
        <ConfirmDialog label="Anwesenheit ändern" wf="WF-TER-06" onClose={() => setAskAttendance(null)}>
          <h2 className="m-0 text-[20px] leading-[1.25] font-bold">Anwesenheit ändern?</h2>
          <span className="text-[15px] leading-normal text-weich">
            Das Plenum ist bereits abgeschlossen, möchtest du die Anwesenheitsliste trotzdem ändern? Die
            Änderung steht in der Historie.
          </span>
          <button
            type="button"
            data-wf="WF-TER-06"
            autoFocus
            onClick={() => {
              setAttendanceUnlocked(true);
              askAttendance();
              setAskAttendance(null);
            }}
            className="h-12 rounded-3xl bg-geplant text-[15px] font-bold text-grund"
          >
            Trotzdem ändern
          </button>
          <GhostButton onClick={() => setAskAttendance(null)}>Doch nicht</GhostButton>
        </ConfirmDialog>
      )}
    </div>
  );
}

/** eine Zeile des Ergebnisses – führt zum Artefakt (Dokumente öffnen ihre Datei) */
function ResultLine({ item }: { item: ResultItem }) {
  const className =
    'block rounded-xl border border-linie bg-flaeche px-3.5 py-2.5 text-[14px] leading-[1.35] text-text no-underline';
  return item.link.startsWith('/') ? (
    <Link to={item.link} className={className}>
      {item.text}
    </Link>
  ) : (
    <a href={item.link} target="_blank" rel="noreferrer" className={className}>
      {item.text} ↗
    </a>
  );
}

function Results({ p }: { p: Detail }) {
  return (
    <div className="flex flex-col gap-2.5">
      {p.results.map((g) => (
        <section key={g.group} aria-label={RESULT_TITLE[g.group]} className="flex flex-col gap-1.5">
          <span className="label-mono pt-1">
            {RESULT_TITLE[g.group]} · {g.items.length}
          </span>
          {g.items.map((item, i) => (
            <ResultLine key={i} item={item} />
          ))}
        </section>
      ))}
      {p.results.length === 0 && (
        <span className="text-[14px] text-leise">
          Noch nichts – was während des Plenums angelegt oder geändert wird, landet hier.
        </span>
      )}
      <span className="pt-1.5 text-[13px] leading-[1.4] text-leise">
        {p.status === 'abgeschlossen'
          ? 'So ging es in die Zusammenfassung an alle.'
          : 'Geht beim Abschließen als Zusammenfassung an alle.'}
      </span>
    </div>
  );
}

/** WF-PLE-03: protokollierende Person, Notizen (Speichern/Abbrechen mit lokalem Entwurf), Drive-Protokoll */
function Protocol({ p }: { p: Detail }) {
  const act = useActions();
  const latest = useLatest(p.version);
  const { activeMembers, memberById } = useLookups();
  const draftKey = `plenum:${p.id}:notizen`;
  const [editing, setEditing] = useState(() => readDraft(draftKey) !== null);
  const [notes, setNotes] = useState(() => readDraft(draftKey) ?? p.notes ?? '');
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = {
    protocol_member_id: p.protocol_member_id,
    notes: p.notes,
    protocol_document_id: p.protocol_document_id,
  };
  const save = (patch: Partial<typeof current>, success: string, ownInput?: string) =>
    act(() => api.updateProtocol(p.id, { ...current, ...patch, version: latest.current }), {
      plenum: false,
      success,
      subject: 'dieses Plenum',
      ownInput,
      draftKept: ownInput !== undefined,
      onInvalid: (e) => setError(e.message),
    });
  const writer = p.protocol_member_id ? memberById.get(p.protocol_member_id) : undefined;

  return (
    <div data-wf="WF-PLE-03" className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-2">
        <span className="label-mono">Protokoll schreibt</span>
        <div role="group" aria-label="Protokoll schreibt" className="flex flex-wrap gap-1.5">
          {activeMembers.map((m) => {
            const on = p.protocol_member_id === m.id;
            return (
              <button
                key={m.id}
                type="button"
                data-wf="WF-PLE-03"
                aria-pressed={on}
                aria-label={m.display_name}
                onClick={() =>
                  void save(
                    { protocol_member_id: on ? null : m.id },
                    on ? 'Niemand eingetragen' : `Protokoll: ${m.display_name}`,
                  )
                }
                className={cx(
                  'hit h-8 rounded-2xl border px-3 font-mono text-[12px]',
                  on ? 'border-geplant bg-geplant font-semibold text-grund' : 'border-rand-stark text-text',
                )}
              >
                {m.short}
              </button>
            );
          })}
        </div>
        {writer && !writer.active && (
          <span className="text-[13px] text-leise">{writer.display_name} (deaktiviert)</span>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center">
          <span className="label-mono flex-1">Notizen</span>
          {!editing && (
            <button
              type="button"
              data-wf="WF-PLE-03"
              onClick={() => {
                setNotes(p.notes ?? '');
                setEditing(true);
              }}
              className="hit h-[30px] px-2.5 text-[13px] text-pink"
            >
              {p.notes ? 'Bearbeiten' : 'Notizen schreiben'}
            </button>
          )}
        </div>
        {!editing ? (
          p.notes ? (
            <div className="rounded-[14px] border border-linie bg-flaeche px-3.5 py-3 text-[14px] leading-normal whitespace-pre-wrap text-weich">
              {p.notes}
            </div>
          ) : (
            <span className="text-[14px] text-leise">Noch keine Notizen.</span>
          )
        ) : (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void save({ notes: notes.trim() ? notes : null }, 'Notizen gespeichert', notes).then((ok) => {
                if (!ok) return;
                clearDraft(draftKey);
                setEditing(false);
              });
            }}
          >
            <textarea
              aria-label="Protokoll-Notizen"
              autoFocus
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                writeDraft(draftKey, e.target.value);
                setError(null);
              }}
              className="min-h-[120px] resize-y rounded-[14px] border border-violett bg-grund px-3.5 py-3 font-sans text-[14px] leading-normal text-text"
            />
            <FieldError>{error}</FieldError>
            <div className="flex items-center justify-end gap-2">
              <span className="label-mono flex-1 text-matt">Entwurf lokal gesichert</span>
              <button
                type="button"
                onClick={() => {
                  clearDraft(draftKey);
                  setEditing(false);
                  setError(null);
                }}
                className="hit h-9 px-3.5 text-[14px] text-leise"
              >
                Abbrechen
              </button>
              <button
                type="submit"
                data-wf="WF-PLE-03"
                className="hit h-9 rounded-[18px] bg-geplant px-4 text-[14px] font-semibold text-grund"
              >
                Speichern
              </button>
            </div>
          </form>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className="label-mono">Drive-Protokoll · optional</span>
        {p.protocol_document ? (
          <div className="flex min-h-11 items-center gap-2 rounded-xl border border-linie bg-flaeche px-3 py-1.5">
            <a
              href={p.protocol_document.url}
              target="_blank"
              rel="noreferrer"
              className="flex-1 text-[14px] text-text no-underline"
            >
              {p.protocol_document.title} ↗
            </a>
            <button
              type="button"
              data-wf="WF-PLE-03"
              onClick={() => void save({ protocol_document_id: null }, 'Verknüpfung entfernt')}
              className="hit h-8 px-2 text-[13px] text-leise"
            >
              Entfernen
            </button>
          </div>
        ) : (
          <button
            type="button"
            data-wf="WF-PLE-03"
            onClick={() => setPicking(true)}
            className="h-10 rounded-xl border border-dashed border-rand-stark text-[14px] text-weich"
          >
            + Protokoll-Dokument verknüpfen
          </button>
        )}
      </div>

      {picking && (
        <DocumentPickSheet
          title="Protokoll verknüpfen"
          wf="WF-PLE-03"
          preferType="protokoll"
          onClose={() => setPicking(false)}
          onPick={(id) => {
            setPicking(false);
            void save({ protocol_document_id: id }, 'Protokoll verknüpft');
          }}
        />
      )}
    </div>
  );
}

/** WF-PLE-20 Bestätigung mit Teilnahme (aus den Zusagen vorbefüllt) und Vorschau der Zusammenfassung */
function CloseSheet({ p, onClose }: { p: Detail; onClose: () => void }) {
  const act = useActions();
  const latest = useLatest(p.version);
  const { activeMembers } = useLookups();
  const [present, setPresent] = useState<string[]>(p.yes_ids);
  return (
    <Sheet title="Plenum abschließen?" onClose={onClose} wf="WF-PLE-20">
      <span className="text-[14px] leading-[1.45] text-weich">
        Das Plenum gilt danach als stattgefunden und abgeschlossen.
      </span>
      <span className="label-mono">Wer war da? · aus Zusagen vorbefüllt</span>
      <div role="group" aria-label="Teilnahme" className="flex flex-wrap gap-1.5">
        {activeMembers.map((m) => {
          const on = present.includes(m.id);
          return (
            <button
              key={m.id}
              type="button"
              data-wf="WF-PLE-20"
              aria-pressed={on}
              aria-label={`${m.display_name} war da`}
              onClick={() => setPresent(on ? present.filter((id) => id !== m.id) : [...present, m.id])}
              className={cx(
                'hit h-8 min-w-11 rounded-2xl border px-2.5 font-mono text-[12px] font-semibold',
                on ? 'border-gruen bg-gruen text-grund' : 'border-rand-stark text-weich',
              )}
            >
              {m.short}
            </button>
          );
        })}
      </div>
      <span className="label-mono">Zusammenfassung · Vorschau</span>
      <div className="flex flex-col gap-1.5 rounded-[14px] border border-linie bg-grund px-3.5 py-3 text-[14px] leading-[1.45] text-weich">
        {p.results.length === 0 && <span>Noch nichts angelegt oder geändert.</span>}
        {p.results.map((g) => (
          <span key={g.group}>
            <span className="font-semibold text-text">
              {RESULT_TITLE[g.group]} · {g.items.length}:
            </span>{' '}
            {g.items.map((i) => i.text).join('; ')}
          </span>
        ))}
      </div>
      <button
        type="button"
        data-wf="WF-PLE-20"
        onClick={() => {
          onClose();
          void act(() => api.closePlenum(p.id, present, latest.current), {
            subject: 'dieses Plenum',
            plenum: false,
            success: (r) => `Abgeschlossen – Zusammenfassung an ${r.recipients} Mitglieder`,
          });
        }}
        className="h-[52px] rounded-[26px] bg-gradient-to-r from-pink via-violett to-blau text-[16px] font-bold text-grund"
      >
        Abschließen und verschicken
      </button>
      <GhostButton onClick={onClose}>Noch nicht</GhostButton>
    </Sheet>
  );
}
