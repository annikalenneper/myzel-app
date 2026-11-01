// Glocke (Verbesserungen, Nutzerin 31.10.2026): alle relevanten Änderungen seit dem letzten Besuch – dieselben Anlässe
// wie Push und Telegram, aber unabhängig davon, ob ein Kanal eingerichtet ist. Öffnen gilt als gesehen.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../app/useData';
import { api } from '../data';
import type { Inbox } from '../data/api';
import { formatCommentTime } from '../shared/format';
import { cx, ListSkeleton } from './bits';
import { IconBell } from './icons';
import { Sheet } from './Sheet';

const WF = 'WF-ALL-10';

export function BellButton() {
  const [open, setOpen] = useState(false);
  const { data, reload } = useData('inbox', () => api.listInbox());
  const unread = data?.unread ?? 0;
  return (
    <>
      <button
        type="button"
        data-wf={WF}
        onClick={() => setOpen(true)}
        aria-label={unread ? `Benachrichtigungen, ${unread} neu` : 'Benachrichtigungen'}
        className="hit relative ml-2.5 flex size-10 flex-none items-center justify-center rounded-full border border-rand text-weich"
      >
        <IconBell size={20} />
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute -top-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-pink px-1 font-mono text-[10px] font-semibold text-grund"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <BellSheet
          inbox={data}
          onClose={() => {
            setOpen(false);
            reload();
          }}
        />
      )}
    </>
  );
}

function BellSheet({ inbox, onClose }: { inbox: Inbox | undefined; onClose: () => void }) {
  // was beim Öffnen neu war, bleibt markiert, solange die Glocke offen ist
  const [seenBefore] = useState(() => inbox?.seen_at ?? null);
  const [now] = useState(() => new Date());
  const loaded = !!inbox;
  useEffect(() => {
    // gesehen: ohne Rückmeldung – schlägt es fehl, ist die Glocke beim nächsten Mal einfach noch einmal neu
    if (loaded) void api.markInboxSeen().catch(() => undefined);
  }, [loaded]);
  const isNew = (createdAt: string) => !seenBefore || createdAt > seenBefore;
  return (
    <Sheet title="Benachrichtigungen" onClose={onClose} wf={WF} closeButton>
      {!inbox && <ListSkeleton />}
      {inbox && inbox.entries.length === 0 && (
        <span className="text-[14px] leading-normal text-leise">
          Noch nichts – hier steht, was sich an deinen Aufgaben, Terminen, Events und Fragen ändert.
        </span>
      )}
      {inbox && inbox.entries.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {inbox.entries.map((e) => (
            <li key={e.id}>
              <Link
                to={e.link}
                onClick={onClose}
                className={cx(
                  'flex flex-col gap-1 rounded-xl border px-3.5 py-2.5 text-text no-underline',
                  isNew(e.created_at) ? 'border-rand-stark bg-erhoeht' : 'border-linie bg-grund',
                )}
              >
                <span className="label-mono flex gap-2">
                  {isNew(e.created_at) && <span className="text-pink">Neu</span>}
                  {formatCommentTime(e.created_at, now)}
                </span>
                <span className="text-[15px] leading-[1.4] whitespace-pre-line">{e.text}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
