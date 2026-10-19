// S-22 Bereich „Partner“ · P4 (WF-VER-10): verknüpfte Partner, verknüpfen per Suche oder neu anlegen
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useActions } from '../../app/useActions';
import { useData } from '../../app/useData';
import { api } from '../../data';
import type { EventDetail } from '../../data/api';
import { cx } from '../../ui/bits';
import { Sheet } from '../../ui/Sheet';
import { PartnerFormSheet } from '../partners/PartnersScreen';

const WF = 'WF-VER-10';
const count = (n: number) => `${n} ${n === 1 ? 'EVENT' : 'EVENTS'} ›`;

export function EventPartners({ event }: { event: EventDetail }) {
  const act = useActions();
  const [linking, setLinking] = useState(false);
  return (
    <div data-wf={WF} className="flex flex-col gap-2 px-4 pb-4">
      {event.partners.map((p) => (
        <div key={p.id} className="flex items-center gap-2 rounded-xl bg-grund py-1 pr-1 pl-3">
          <Link
            to={`/partner/${p.id}`}
            className="flex min-h-11 min-w-0 flex-1 flex-col justify-center text-text no-underline"
          >
            <span className="flex items-center gap-2">
              <span className="flex-1 truncate text-[15px] font-semibold">{p.name}</span>
              <span className="font-mono text-[11px] text-leise">{count(p.event_count)}</span>
            </span>
            {(p.role_note || p.kind) && (
              <span className="font-mono text-[11px] text-leise uppercase">
                {[p.kind, p.role_note].filter(Boolean).join(' · ')}
              </span>
            )}
          </Link>
          <button
            type="button"
            data-wf={WF}
            aria-label={`Partner entfernen: ${p.name}`}
            onClick={() =>
              void act(() => api.unlinkPartner(event.id, p.id), {
                success: `Partner entfernt: ${p.name}`,
                undo: (r) => r.undo_token,
              })
            }
            className="hit size-9 flex-none rounded-full text-[18px] text-leise"
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        data-wf={WF}
        onClick={() => setLinking(true)}
        className="hit h-10 rounded-xl border border-dashed border-rand-stark text-[14px] text-leise"
      >
        + Partner verknüpfen
      </button>
      <Link to="/partner" className="hit self-start text-[13px] text-pink">
        Alle Partner ›
      </Link>
      {linking && <LinkSheet event={event} onClose={() => setLinking(false)} />}
    </div>
  );
}

/** Partner suchen und verknüpfen – oder gleich neu anlegen */
function LinkSheet({ event, onClose }: { event: EventDetail; onClose: () => void }) {
  const act = useActions();
  const { data: partners } = useData('partners', () => api.listPartners());
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [role, setRole] = useState('');
  const [creating, setCreating] = useState(false);
  const linked = new Set(event.partners.map((p) => p.id));
  const q = query.trim().toLowerCase();
  const shown = (partners ?? [])
    .filter((p) => !linked.has(p.id))
    .filter((p) => !q || [p.name, p.kind, p.contact_person].some((v) => v?.toLowerCase().includes(q)))
    .slice(0, 8);

  const link = (partnerId: string) => {
    onClose();
    void act(() => api.linkPartner(event.id, partnerId, role || null), {
      success: 'Partner verknüpft',
      undo: (r) => r.undo_token,
    });
  };

  if (creating)
    return <PartnerFormSheet initialName={query.trim()} onClose={onClose} onCreated={(id) => link(id)} />;

  return (
    <Sheet title="Partner verknüpfen" onClose={onClose} wf={WF} closeButton>
      <input
        type="search"
        data-wf={WF}
        aria-label="Partner suchen"
        placeholder="Partner suchen …"
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="h-11 rounded-xl border border-rand bg-grund px-3.5 text-[15px] text-text"
      />
      <div role="radiogroup" aria-label="Partner" className="flex flex-col gap-1.5">
        {shown.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={picked === p.id}
            data-wf={WF}
            onClick={() => setPicked(p.id)}
            className={cx(
              'flex min-h-11 items-center gap-2.5 rounded-xl border px-3 py-1.5 text-left text-[14px] text-text',
              picked === p.id ? 'border-rand-stark bg-erhoeht font-semibold' : 'border-linie bg-grund',
            )}
          >
            <span className="flex-1">{p.name}</span>
            <span className="label-mono">{p.kind}</span>
            <span className="text-gruen">{picked === p.id ? '✓' : ''}</span>
          </button>
        ))}
        {partners && shown.length === 0 && (
          <span className="text-[13px] text-leise">Kein passender Partner.</span>
        )}
      </div>
      <label className="label-mono flex flex-col gap-1.5">
        Rolle bei dieser Veranstaltung · optional
        <input
          type="text"
          data-wf={WF}
          value={role}
          maxLength={200}
          onChange={(e) => setRole(e.target.value)}
          className="h-11 rounded-xl border border-rand bg-grund px-3.5 font-sans text-[15px] text-text normal-case"
        />
      </label>
      <button
        type="button"
        data-wf={WF}
        disabled={!picked}
        onClick={() => picked && link(picked)}
        className={cx(
          'h-12 rounded-3xl text-[15px] font-bold',
          picked ? 'bg-geplant text-grund' : 'bg-linie text-matt',
        )}
      >
        {picked ? 'Verknüpfen' : 'Partner wählen'}
      </button>
      <button
        type="button"
        data-wf={WF}
        onClick={() => setCreating(true)}
        className="hit h-10 rounded-xl border border-dashed border-rand-stark text-[14px] text-weich"
      >
        + Neuen Partner anlegen{query.trim() ? ` „${query.trim()}“` : ''}
      </button>
    </Sheet>
  );
}
