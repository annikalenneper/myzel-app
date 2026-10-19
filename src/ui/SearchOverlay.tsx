// S-44 Globale Suche (F-WIS-06, WF-WIS-11): Lupe oben rechts auf allen Hauptscreens. Treffer erscheinen beim
// Tippen, gruppiert nach Art, die Gruppe des aktuellen Screens zuerst. Durchsucht nur App-Daten; ab P5 führt
// die letzte Zeile mit dem Suchwort in den Drive-Reiter, der seine eigene Dateisuche hat.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../app/useData';
import { api } from '../data';
import type { SearchGroupKey } from '../data/api';
import { useModal } from './Sheet';

const IconSearch = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <circle cx="11" cy="11" r="6" />
    <path d="M20 20l-4.5-4.5" />
  </svg>
);

export function SearchButton({ first }: { first: SearchGroupKey }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        data-wf="WF-WIS-11"
        onClick={() => setOpen(true)}
        aria-label="Suche über alles"
        className="hit flex size-10 flex-none items-center justify-center rounded-full border border-rand text-weich"
      >
        <IconSearch />
      </button>
      {open && <SearchOverlay first={first} onClose={() => setOpen(false)} />}
    </>
  );
}

function SearchOverlay({ first, onClose }: { first: SearchGroupKey; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const term = query.trim();
  const { data } = useData(`suche:${term}`, () => api.search(term));

  useModal(onClose);

  const groups = [...(data ?? [])].sort((a, b) => Number(b.key === first) - Number(a.key === first));
  const count = groups.reduce((n, g) => n + g.items.length, 0);
  const row =
    'flex min-h-[52px] flex-col justify-center gap-0.5 border-b border-erhoeht bg-flaeche px-3.5 py-2 text-text no-underline last:border-b-0';

  return (
    <div
      data-wf="WF-WIS-11"
      role="dialog"
      aria-modal="true"
      aria-label="Suche über alles"
      className="fixed inset-0 z-30 flex flex-col bg-grund lg:left-1/2 lg:w-[560px] lg:-translate-x-1/2 lg:border-x lg:border-linie"
    >
      <div className="flex items-center gap-2 border-b border-linie py-4 pr-3 pl-5">
        <label htmlFor="globale-suche" className="sr-only">
          Suche über alles
        </label>
        <div className="flex h-11 flex-1 items-center gap-2 rounded-[22px] border border-violett bg-flaeche px-3.5 text-leise">
          <IconSearch />
          <input
            id="globale-suche"
            type="search"
            data-wf="WF-WIS-11"
            autoFocus
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-[16px] text-text"
          />
        </div>
        <button type="button" onClick={onClose} className="hit h-9 px-2 text-[15px] font-semibold text-pink">
          Abbrechen
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 pt-3 pb-6">
        <span className="label-mono leading-[1.5]" role="status">
          {term.length < 2
            ? 'Aufgaben, Events, Termine und Wissen durchsuchen'
            : !data
              ? 'Suche …'
              : `${count} Treffer · Aufgaben, Events, Termine und Wissen`}
        </span>
        {groups.map((g) => (
          <section key={g.key} className="flex flex-col gap-1.5" aria-label={g.title}>
            <h2 className="label-mono m-0 font-normal">
              {g.title} · {g.items.length}
            </h2>
            <div className="flex flex-col overflow-hidden rounded-[14px] border border-linie">
              {g.items.map((r) =>
                r.external ? (
                  <a key={r.id} href={r.link} target="_blank" rel="noreferrer" className={row}>
                    <span className="text-[15px] font-medium">{r.title} ↗</span>
                    <span className="label-mono">{r.meta}</span>
                  </a>
                ) : (
                  <Link key={r.id} to={r.link} onClick={onClose} className={row}>
                    <span className="text-[15px] font-medium">{r.title}</span>
                    <span className="label-mono">{r.meta}</span>
                  </Link>
                ),
              )}
            </div>
          </section>
        ))}
        {term.length >= 2 && data && count === 0 && (
          <span data-wf="WF-ALL-05" className="py-6 text-center text-[14px] text-leise">
            Nichts gefunden für „{term}“.
          </span>
        )}
        {term.length >= 2 && (
          <Link
            to={`/wissen/drive?q=${encodeURIComponent(term)}`}
            onClick={onClose}
            data-wf="WF-WIS-11"
            className="flex min-h-12 items-center justify-between gap-2 rounded-[14px] border border-dashed border-rand-stark px-3.5 text-[14px] text-weich no-underline"
          >
            <span>„{term}“ im Drive suchen</span>
            <span className="font-mono text-[11px] text-leise">→</span>
          </Link>
        )}
      </div>
    </div>
  );
}
