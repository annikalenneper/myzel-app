// S-24 Partner · P4 (F-VER-05, WF-VER-10, WF-VER-13) – im Prototyp nicht entworfen, im Stil von S-20/S-22
// abgeleitet. Partner sind zentral gespeichert und haben keine eigene Navigation (3.5): Man erreicht sie
// über die Veranstaltung, die Suche und das Plenum.
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ListDetailLayout } from '../../app/AppShell';
import { BarOffset, useFeedback } from '../../app/feedback';
import { useLookups } from '../../app/lookups';
import { entityHistorySentence } from '../../shared/entityHistory';
import { CommentsSection } from '../../ui/Comments';
import { HistoryList } from '../../ui/HistoryList';
import { useActions } from '../../app/useActions';
import { useData } from '../../app/useData';
import { api } from '../../data';
import type { PartnerDetail as Detail, PartnerListItem } from '../../data/api';
import { formatEventRange } from '../../shared/format';
import { EVENT_STATUS_LABEL } from '../../shared/labels';
import { Avatar, cx, FieldError, LightButton, ListSkeleton, LoadError, PrimaryButton } from '../../ui/bits';
import { IconBack, IconEdit, IconPlus } from '../../ui/icons';
import { Sheet } from '../../ui/Sheet';

const WF_LIST = 'WF-VER-13';

export function PartnersScreen() {
  const { partnerId } = useParams();
  return (
    <ListDetailLayout
      detailOpen={!!partnerId}
      list={<PartnerList selectedId={partnerId ?? null} />}
      detail={partnerId ? <PartnerDetail key={partnerId} partnerId={partnerId} /> : null}
    />
  );
}

const count = (n: number) => `${n} ${n === 1 ? 'Veranstaltung' : 'Veranstaltungen'}`;

function PartnerList({ selectedId }: { selectedId: string | null }) {
  const navigate = useNavigate();
  const { data: partners, error, reload } = useData('partners', () => api.listPartners());
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const q = query.trim().toLowerCase();
  const shown = (partners ?? []).filter(
    (p) => !q || [p.name, p.kind, p.contact_person].some((v) => v?.toLowerCase().includes(q)),
  );

  return (
    <div className="flex min-h-dvh flex-col lg:min-h-0">
      <BarOffset px={24} />
      <div className="flex items-center gap-1 px-3 pt-3">
        <Link
          to="/events"
          aria-label="Zurück zu Veranstaltungen"
          className="flex size-11 items-center justify-center text-text"
        >
          <IconBack />
        </Link>
        <span className="font-mono text-[13px] text-leise">EVENTS</span>
      </div>
      <div className="flex flex-col gap-3 px-5 pt-1 pb-24">
        <h1 className="m-0 text-[30px] leading-[1.15] font-bold tracking-[-1px]">Partner</h1>
        <input
          type="search"
          data-wf={WF_LIST}
          aria-label="Partner suchen"
          placeholder="Name, Art, Kontakt …"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-11 rounded-xl border border-rand bg-flaeche px-3.5 text-[15px] text-text"
        />
        {!partners && !error && <ListSkeleton />}
        {!partners && error && <LoadError message={error.message} onRetry={reload} />}
        {shown.map((p) => (
          <PartnerCard key={p.id} p={p} selected={p.id === selectedId} />
        ))}
        {partners && shown.length === 0 && (
          <div data-wf="WF-ALL-05" className="py-8 text-center text-[14px] text-leise">
            {q ? 'Kein Partner passt zur Suche.' : 'Noch keine Partner. Leg den ersten an.'}
          </div>
        )}
      </div>
      <button
        type="button"
        data-wf="WF-VER-10"
        aria-label="Partner anlegen"
        onClick={() => setCreating(true)}
        className="bg-marke fixed right-5 bottom-[calc(24px+env(safe-area-inset-bottom,0px))] z-10 flex size-[58px] items-center justify-center rounded-full text-grund shadow-[0_8px_24px_rgba(157,110,240,0.45)] lg:right-auto lg:bottom-6 lg:left-[562px]"
      >
        <IconPlus size={26} />
      </button>
      {creating && (
        <PartnerFormSheet onClose={() => setCreating(false)} onCreated={(id) => navigate(`/partner/${id}`)} />
      )}
    </div>
  );
}

function PartnerCard({ p, selected }: { p: PartnerListItem; selected: boolean }) {
  return (
    <Link
      to={`/partner/${p.id}`}
      className={cx(
        'flex flex-col gap-1 rounded-2xl border border-linie px-4 py-3 text-text no-underline',
        selected ? 'bg-erhoeht' : 'bg-flaeche',
      )}
    >
      <span className="flex items-center gap-2">
        <span className="flex-1 text-[17px] font-semibold">{p.name}</span>
      </span>
      <span className="font-mono text-[11px] text-leise uppercase">
        {[p.kind, p.contact_person, count(p.event_count)].filter(Boolean).join(' · ')}
      </span>
    </Link>
  );
}

function PartnerDetail({ partnerId }: { partnerId: string }) {
  const { data, error, reload } = useData(`partner:${partnerId}`, () => api.getPartner(partnerId));
  if (!data)
    return (
      <div className="flex min-h-dvh flex-col lg:min-h-0">
        <DetailTop />
        <div className="px-5 py-[18px]">
          {error?.code === 'not_found' ? (
            <div data-wf="WF-ALL-05" className="flex flex-col items-center gap-3 py-10 text-center">
              <span className="text-[16px] font-semibold">Diesen Partner gibt es nicht</span>
              <Link to="/partner" className="hit text-[14px] text-pink">
                Zu den Partnern
              </Link>
            </div>
          ) : error ? (
            <LoadError message={error.message} onRetry={reload} />
          ) : (
            <ListSkeleton />
          )}
        </div>
      </div>
    );
  return <Loaded p={data} />;
}

function DetailTop({ children }: { children?: React.ReactNode }) {
  return (
    <div className="sticky top-0 z-10 flex h-[60px] flex-none items-center gap-1 bg-grund px-3">
      <Link
        to="/partner"
        aria-label="Zurück zu Partnern"
        className="flex size-11 items-center justify-center text-text"
      >
        <IconBack />
      </Link>
      <span className="font-mono text-[13px] text-leise">PARTNER</span>
      <span className="flex-1" />
      {children}
    </div>
  );
}

function Loaded({ p }: { p: Detail }) {
  const { memberById } = useLookups();
  const [editing, setEditing] = useState(false);
  const contact = p.internal_contact_member_id ? memberById.get(p.internal_contact_member_id) : undefined;
  const rows: [string, React.ReactNode][] = [
    ['Kontakt', p.contact_person],
    ['Mail', p.email && <a href={`mailto:${p.email}`}>{p.email}</a>],
    ['Telefon', p.phone && <a href={`tel:${p.phone.replace(/\s/g, '')}`}>{p.phone}</a>],
    [
      'Website',
      p.website && (
        <a
          href={p.website.startsWith('http') ? p.website : `https://${p.website}`}
          target="_blank"
          rel="noreferrer"
        >
          {p.website} ↗
        </a>
      ),
    ],
  ];
  return (
    <div className="flex min-h-dvh flex-col lg:min-h-0">
      <BarOffset px={24} />
      <DetailTop>
        <button
          type="button"
          data-wf="WF-VER-13"
          onClick={() => setEditing(true)}
          aria-label="Bearbeiten"
          className="flex size-11 items-center justify-center text-text"
        >
          <IconEdit size={20} />
        </button>
      </DetailTop>
      <div className="flex flex-col gap-4 px-5 pt-1 pb-10">
        <div className="flex flex-col gap-2">
          {p.kind && <span className="label-mono">{p.kind}</span>}
          <h1 className="m-0 text-[30px] leading-[1.15] font-bold tracking-[-1px]">{p.name}</h1>
          {p.description && (
            <p className="m-0 text-[15px] leading-normal whitespace-pre-wrap text-weich">{p.description}</p>
          )}
        </div>
        <div className="flex flex-col gap-0.5 rounded-2xl border border-linie bg-flaeche px-4 py-2">
          {rows.map(([label, value]) => (
            <div key={label} className="flex min-h-10 items-center gap-3 text-[14px]">
              <span className="label-mono w-[76px] flex-none">{label}</span>
              <span className={cx('min-w-0 flex-1 break-words', value ? 'text-text' : 'text-matt')}>
                {value || '—'}
              </span>
            </div>
          ))}
          <div className="flex min-h-10 items-center gap-3 text-[14px]">
            <span className="label-mono w-[76px] flex-none">Bei uns</span>
            {contact ? (
              <span className="flex items-center gap-2">
                <Avatar member={contact} size={24} />
                {contact.display_name}
              </span>
            ) : (
              <span className="text-matt">—</span>
            )}
          </div>
        </div>
        {p.notes && (
          <div className="flex flex-col gap-1.5">
            <span className="label-mono">Notizen</span>
            <div className="text-[14px] leading-normal whitespace-pre-wrap text-weich">{p.notes}</div>
          </div>
        )}
        <div className="flex flex-col gap-2">
          <span className="label-mono">Beteiligt an · {count(p.event_count)}</span>
          {p.events.map((e) => (
            <Link
              key={e.id}
              to={`/events/${e.id}`}
              className="flex min-h-11 flex-col gap-0.5 rounded-xl border border-linie bg-flaeche px-3.5 py-2.5 text-text no-underline"
            >
              <span className="text-[15px] font-semibold">{e.title}</span>
              <span className="font-mono text-[11px] text-leise uppercase">
                {[formatEventRange(e.starts_at, null), EVENT_STATUS_LABEL[e.status], e.role_note]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </Link>
          ))}
          {p.events.length === 0 && (
            <span className="text-[14px] text-leise">Noch bei keiner Veranstaltung dabei.</span>
          )}
        </div>
        <CommentsSection target="partner" targetId={p.id} comments={p.comments} archived={!!p.archived_at} />
        <HistoryList
          entries={p.history}
          sentence={(h) =>
            entityHistorySentence(h, 'Partner', {
              memberName: (id) => memberById.get(id)?.display_name ?? 'Jemand',
            })
          }
        />
      </div>
      {editing && <PartnerFormSheet key={p.version} partner={p} onClose={() => setEditing(false)} />}
    </div>
  );
}

/** Partner anlegen (WF-VER-10) oder bearbeiten (WF-VER-13) */
export function PartnerFormSheet({
  partner,
  initialName = '',
  onClose,
  onCreated,
}: {
  partner?: Detail;
  initialName?: string;
  onClose: () => void;
  onCreated?: (id: string) => void;
}) {
  const { run } = useFeedback();
  const act = useActions();
  const { activeMembers } = useLookups();
  const wf = partner ? 'WF-VER-13' : 'WF-VER-10';
  const [f, setF] = useState({
    name: partner?.name ?? initialName,
    kind: partner?.kind ?? '',
    description: partner?.description ?? '',
    contact_person: partner?.contact_person ?? '',
    email: partner?.email ?? '',
    phone: partner?.phone ?? '',
    website: partner?.website ?? '',
    notes: partner?.notes ?? '',
    internal_contact_member_id: partner?.internal_contact_member_id ?? '',
  });
  const [error, setError] = useState<{ field: string | null; message: string } | null>(null);
  const set = (key: keyof typeof f) => (value: string) => {
    setF({ ...f, [key]: value });
    setError(null);
  };
  const missing = !f.name.trim() ? `Namen eingeben, dann ${partner ? 'speichern' : 'anlegen'}` : null;
  const fieldError = (field: string) => (error?.field === field ? error.message : null);

  const submit = async () => {
    if (missing) return;
    const input = { ...f, internal_contact_member_id: f.internal_contact_member_id || null };
    const onInvalid = (e: { field: string | null; message: string }) => setError(e);
    if (partner) {
      const ok = await act(() => api.updatePartner(partner.id, { ...input, version: partner.version }), {
        subject: 'diesen Partner',
        success: 'Gespeichert',
        onInvalid,
      });
      if (ok) onClose();
    } else {
      const created = await run(() => api.createPartner(input), { success: 'Partner angelegt', onInvalid });
      if (created) {
        onClose();
        onCreated?.(created.id);
      }
    }
  };

  const field =
    'h-11 rounded-xl border border-rand bg-grund px-3.5 font-sans text-[15px] text-text normal-case';
  const text = (label: string, key: keyof typeof f, type = 'text', autoFocus = false) => (
    <label className="label-mono flex flex-col gap-1.5">
      {label}
      <input
        type={type}
        data-wf={wf}
        autoFocus={autoFocus}
        value={f[key]}
        onChange={(e) => set(key)(e.target.value)}
        className={cx(field, fieldError(key) && 'border-rot')}
      />
      <FieldError>{fieldError(key)}</FieldError>
    </label>
  );

  return (
    <Sheet title={partner ? 'Partner bearbeiten' : 'Neuer Partner'} onClose={onClose} wf={wf} closeButton>
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {text('Name *', 'name', 'text', !partner)}
        {text('Art', 'kind')}
        {text('Kontaktperson', 'contact_person')}
        {text('Mail', 'email', 'email')}
        {text('Telefon', 'phone', 'tel')}
        {text('Website', 'website')}
        <label className="label-mono flex flex-col gap-1.5">
          Interne Kontaktperson
          <select
            data-wf={wf}
            value={f.internal_contact_member_id}
            onChange={(e) => set('internal_contact_member_id')(e.target.value)}
            className={cx(field, 'text-[15px]')}
          >
            <option value="">niemand</option>
            {activeMembers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.display_name}
              </option>
            ))}
          </select>
        </label>
        <label className="label-mono flex flex-col gap-1.5">
          Beschreibung
          <textarea
            data-wf={wf}
            value={f.description}
            onChange={(e) => set('description')(e.target.value)}
            className="min-h-[70px] rounded-xl border border-rand bg-grund px-3.5 py-2.5 font-sans text-[15px] leading-normal text-text normal-case"
          />
        </label>
        <label className="label-mono flex flex-col gap-1.5">
          Notizen
          <textarea
            data-wf={wf}
            value={f.notes}
            onChange={(e) => set('notes')(e.target.value)}
            className="min-h-[70px] rounded-xl border border-rand bg-grund px-3.5 py-2.5 font-sans text-[15px] leading-normal text-text normal-case"
          />
        </label>
        {/* Felder ohne eigene Meldung (Beschreibung, Notizen, Kontaktperson) zeigen sie hier */}
        <FieldError>
          {error &&
            !['name', 'kind', 'contact_person', 'email', 'phone', 'website'].includes(error.field ?? '') &&
            error.message}
        </FieldError>
        {partner ? (
          <LightButton type="submit" data-wf={wf} disabled={!!missing}>
            {missing ?? 'Speichern'}
          </LightButton>
        ) : (
          <PrimaryButton type="submit" data-wf={wf} disabled={!!missing}>
            {missing ?? 'Anlegen'}
          </PrimaryButton>
        )}
      </form>
    </Sheet>
  );
}
