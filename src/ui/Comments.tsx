// Kommentare an allen Artefakten (16.3): eine Zeile je Kommentar, unten das Eingabefeld. Gemeinsam für Aufgabe,
// Frage, Entscheidung/Fakt, Veranstaltung, Termin und Partner.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { clearDraft, readDraft, writeDraft } from '../app/drafts';
import { useLookups } from '../app/lookups';
import { useMe } from '../app/session';
import { useActions } from '../app/useActions';
import { api } from '../data';
import { formatCommentTime } from '../shared/format';
import {
  REACTION_EMOJI,
  REACTIONS,
  type CommentItem,
  type CommentTarget,
  type Member,
  type Reaction,
} from '../shared/schema';
import { Avatar, cx, FieldError } from './bits';
import { IconSend } from './icons';

type Act = ReturnType<typeof useActions>;

/** Ein Kommentar; eigene lassen sich mit Speichern/Abbrechen bearbeiten (7.3) */
export function CommentRow({
  comment,
  author,
  own,
  act,
  wf,
}: {
  comment: CommentItem;
  author: Member | undefined;
  own: boolean;
  act: Act;
  wf: string;
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
            <Reactions comment={comment} act={act} wf={wf}>
              {own && (
                <button
                  type="button"
                  data-wf={wf}
                  onClick={() => setDraft(comment.body)}
                  className="hit h-[26px] text-[12px] text-leise"
                >
                  Bearbeiten
                </button>
              )}
            </Reactions>
          </>
        ) : (
          <div className="flex flex-col gap-2">
            <textarea
              data-wf={wf}
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
                data-wf={wf}
                onClick={() => setDraft(null)}
                className="hit h-9 px-3.5 text-[14px] text-leise"
              >
                Abbrechen
              </button>
              <button
                type="button"
                data-wf={wf}
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

/**
 * Phase 12: Reaktionen unter einem Kommentar – vorhandene mit Anzahl (eigene hervorgehoben, antippen nimmt sie
 * zurück), dazu „☺ +“ für die Auswahl ❤️ 👍 👎 ❓ 😂 💀 🍀.
 */
function Reactions({
  comment,
  act,
  wf,
  children,
}: {
  comment: CommentItem;
  act: Act;
  wf: string;
  children?: ReactNode;
}) {
  const me = useMe();
  const { memberById } = useLookups();
  const [picking, setPicking] = useState(false);
  const toggle = (reaction: Reaction, on: boolean) => {
    setPicking(false);
    void act(() => api.setReaction(comment.id, reaction, on), {});
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {comment.reactions.map(({ reaction, member_ids }) => {
          const mine = member_ids.includes(me.id);
          const names = member_ids.map((id) => memberById.get(id)?.display_name ?? 'Jemand').join(', ');
          return (
            <button
              key={reaction}
              type="button"
              data-wf={wf}
              aria-pressed={mine}
              aria-label={`${REACTION_EMOJI[reaction]} ${member_ids.length}: ${names}`}
              title={names}
              onClick={() => toggle(reaction, !mine)}
              className={cx(
                'hit flex h-7 items-center gap-1 rounded-[14px] border px-2 text-[13px]',
                mine ? 'border-violett bg-erhoeht text-text' : 'border-linie text-weich',
              )}
            >
              <span aria-hidden>{REACTION_EMOJI[reaction]}</span>
              <span className="font-mono text-[11px]">{member_ids.length}</span>
            </button>
          );
        })}
        <button
          type="button"
          data-wf={wf}
          aria-label="Reagieren"
          aria-expanded={picking}
          onClick={() => setPicking(!picking)}
          className="hit flex h-7 items-center rounded-[14px] border border-linie px-2 text-[13px] text-leise"
        >
          ☺ +
        </button>
        {children}
      </div>
      {picking && (
        <div role="group" aria-label="Reaktion wählen" className="flex flex-wrap gap-1">
          {REACTIONS.map((reaction) => {
            const mine = comment.reactions.some(
              (r) => r.reaction === reaction && r.member_ids.includes(me.id),
            );
            return (
              <button
                key={reaction}
                type="button"
                data-wf={wf}
                aria-pressed={mine}
                aria-label={REACTION_EMOJI[reaction]}
                onClick={() => toggle(reaction, !mine)}
                className={cx(
                  'flex size-11 items-center justify-center rounded-full text-[20px]',
                  mine ? 'bg-erhoeht' : 'bg-transparent',
                )}
              >
                {REACTION_EMOJI[reaction]}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Kommentar senden – unten fixiert; bei leerem Feld gesperrt; der Text bleibt als Entwurf auf dem Gerät */
export function CommentBar({
  target,
  targetId,
  following = false,
  act,
  wf,
  onSent,
  inline = false,
}: {
  target: CommentTarget;
  targetId: string;
  /** nur Aufgaben: wer kommentiert, folgt */
  following?: boolean;
  act: Act;
  wf: string;
  onSent?: () => void;
  /** im Inhalt statt unten fixiert – wenn unten schon Aktionen stehen */
  inline?: boolean;
}) {
  const draftKey = `${target}:${targetId}:kommentar`;
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
        const result = await api.addComment(target, targetId, text);
        // nur den gesendeten Text entfernen – was inzwischen weitergetippt wurde, bleibt stehen
        // (Tastendrücke können sich mit dem Leeren kreuzen – deshalb merkt sich das Feld, was weg soll)
        sent.current = text;
        const rest = strip(field.current?.value ?? '');
        if (rest) writeDraft(draftKey, rest);
        else clearDraft(draftKey);
        setText(rest);
        onSent?.();
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
      className={cx(
        'flex flex-none items-center gap-2.5',
        !inline &&
          'sticky bottom-0 z-10 border-t border-linie bg-nav px-4 pt-3 pb-[calc(18px+env(safe-area-inset-bottom,0px))]',
      )}
    >
      <label htmlFor="kommentar" className="sr-only">
        Kommentar schreiben
      </label>
      <input
        id="kommentar"
        ref={field}
        type="text"
        data-wf={wf}
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
        data-wf={wf}
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

/** Kommentare in einer Detailansicht (16.3): Liste und Eingabefeld darunter */
export function CommentsSection({
  target,
  targetId,
  comments,
  archived = false,
  wf = 'WF-ALL-07',
  heading = true,
}: {
  target: CommentTarget;
  targetId: string;
  comments: CommentItem[];
  /** archiviert: nur lesen */
  archived?: boolean;
  wf?: string;
  /** ohne Überschrift, wenn ein Reiter sie schon nennt */
  heading?: boolean;
}) {
  const act = useActions();
  const me = useMe();
  const { memberById } = useLookups();
  return (
    <section aria-label="Kommentare" className="flex flex-col gap-3">
      {heading && <span className="label-mono">Kommentare · {comments.length}</span>}
      {comments.length === 0 && (
        <span className="text-[14px] text-leise">
          Noch keine Kommentare.{!archived && ' Schreib den ersten unten ins Feld.'}
        </span>
      )}
      {comments.map((c) => (
        <CommentRow
          key={c.id}
          comment={c}
          author={memberById.get(c.author_id)}
          own={c.author_id === me.id && !archived}
          act={act}
          wf={wf}
        />
      ))}
      {!archived && <CommentBar target={target} targetId={targetId} act={act} wf={wf} inline />}
    </section>
  );
}

/**
 * Phase 9: Kommentare und Verlauf in zwei Reitern wie bei Aufgaben – für alle Detailansichten. Der Verlauf kommt
 * fertig gerendert (je Art eigene Sätze).
 */
export function CommentsAndHistory({
  target,
  targetId,
  comments,
  archived = false,
  history,
  historyWf = 'WF-ALL-07',
}: {
  target: CommentTarget;
  targetId: string;
  comments: CommentItem[];
  archived?: boolean;
  history: ReactNode;
  historyWf?: string;
}) {
  const [tab, setTab] = useState<'comments' | 'history'>('comments');
  return (
    <div className="flex flex-col gap-3.5">
      <div role="tablist" className="flex gap-[22px] border-b border-linie">
        {(
          [
            ['comments', 'WF-ALL-07', `KOMMENTARE · ${comments.length}`],
            ['history', historyWf, 'VERLAUF'],
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
      <div role="tabpanel">
        {tab === 'comments' ? (
          <CommentsSection
            target={target}
            targetId={targetId}
            comments={comments}
            archived={archived}
            heading={false}
          />
        ) : (
          history
        )}
      </div>
    </div>
  );
}
