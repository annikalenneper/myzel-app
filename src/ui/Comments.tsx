// Kommentare an allen Artefakten (16.3): eine Zeile je Kommentar, unten das Eingabefeld. Gemeinsam für Aufgabe,
// Frage, Entscheidung/Fakt, Veranstaltung, Termin und Partner.
import { useEffect, useRef, useState } from 'react';
import { clearDraft, readDraft, writeDraft } from '../app/drafts';
import { useLookups } from '../app/lookups';
import { useMe } from '../app/session';
import { useActions } from '../app/useActions';
import { api } from '../data';
import { formatCommentTime } from '../shared/format';
import type { Comment, CommentTarget, Member } from '../shared/schema';
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
  comment: Comment;
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
            {own && (
              <button
                type="button"
                data-wf={wf}
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
}: {
  target: CommentTarget;
  targetId: string;
  comments: Comment[];
  /** archiviert: nur lesen */
  archived?: boolean;
  wf?: string;
}) {
  const act = useActions();
  const me = useMe();
  const { memberById } = useLookups();
  return (
    <section aria-label="Kommentare" className="flex flex-col gap-3">
      <span className="label-mono">Kommentare · {comments.length}</span>
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
