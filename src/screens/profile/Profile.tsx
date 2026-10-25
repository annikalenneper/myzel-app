// S-50 Profil · P1 (Push/Telegram kommen in P2, die Benachrichtigungs-Matrix in P6)
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BarOffset, useFeedback } from '../../app/feedback';
import { useLookups } from '../../app/lookups';
import { useMe } from '../../app/session';
import { DEFAULT_AGENDA_FILTER, useAgendaFilter } from '../../app/agendaFilter';
import { useData } from '../../app/useData';
import { api } from '../../data';
import { isJobOverdue } from '../../shared/rules/notifications';
import { Avatar, cx, FieldError } from '../../ui/bits';
import { IconEdit } from '../../ui/icons';
import { NotificationMatrix } from './NotificationMatrix';
import { Reachability } from './Reachability';
import { formatSince } from './SystemStatus';

export function Profile() {
  const me = useMe();
  const { run } = useFeedback();
  const { activeMembers, topics } = useLookups();
  const { setFilter } = useAgendaFilter();
  const [name, setName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const saveName = async () => {
    const next = (name ?? '').trim();
    if (!next) return setError('Bitte einen Namen eingeben.');
    if (next === me.display_name) return setName(null);
    const ok = await run(() => api.updateOwnName(next).then(() => true), {
      success: 'Gespeichert',
      ownInput: next,
      onInvalid: (e) => setError(e.message),
    });
    if (ok) setName(null);
  };

  // Statusanzeige der Jobläufe: warnt nach 2 Stunden ohne Lauf (E-07)
  const { data: system } = useData(me.is_admin ? 'system-status' : 'system-status:kein-admin', () =>
    me.is_admin ? api.getSystemStatus() : Promise.resolve(null),
  );
  const systemMeta = !system
    ? '›'
    : isJobOverdue(system.last_run_at, new Date())
      ? 'WARNUNG ›'
      : `OK · VOR ${formatSince(system.last_run_at!, new Date()).replace('Minuten', 'MIN').replace('Minute', 'MIN').toUpperCase()} ›`;

  const { data: types } = useData('appointment-types', () => api.listAppointmentTypes());
  const admin = [
    { to: '/profil/mitglieder', label: 'Mitglieder', meta: `${activeMembers.length} ›` },
    { to: '/profil/themen', label: 'Themen', meta: `${topics.filter((t) => !t.archived_at).length} ›` },
    { to: '/profil/system', label: 'Systemstatus', meta: systemMeta },
    {
      to: '/profil/terminarten',
      label: 'Terminarten',
      meta: `${(types ?? []).filter((t) => !t.archived_at).length} ›`,
    },
  ];

  return (
    <div className="mx-auto flex max-w-[560px] flex-col gap-[18px] px-5 pt-6 pb-[140px] lg:max-w-[720px] lg:pb-10">
      <BarOffset px={92} />
      <div className="flex items-center gap-3.5">
        <Avatar member={me} size={56} fontSize={18} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="m-0 text-[26px] leading-[1.2] font-bold tracking-[-0.5px] break-words">
            {me.display_name}
          </h1>
          <span className="font-mono text-[12px] break-all text-leise">
            {me.email}
            {me.is_admin && ' · ADMIN'}
          </span>
        </div>
        {/* WF-PRO-01 Name ändern */}
        <button
          type="button"
          data-wf="WF-PRO-01"
          onClick={() => {
            setError(null);
            setName(name === null ? me.display_name : null);
          }}
          aria-label="Name ändern"
          aria-expanded={name !== null}
          className="hit flex size-10 items-center justify-center text-text"
        >
          <IconEdit size={20} />
        </button>
      </div>
      {name !== null && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <label htmlFor="profil-name" className="sr-only">
              Name
            </label>
            <input
              id="profil-name"
              type="text"
              data-wf="WF-PRO-01"
              autoFocus
              value={name}
              maxLength={60}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              onBlur={() => void saveName()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') setName(null);
              }}
              className="h-11 min-w-0 flex-1 rounded-xl border border-violett bg-grund px-3.5 text-[16px] text-text"
            />
            <span className="label-mono w-[92px] flex-none">Speichert beim Verlassen</span>
          </div>
          <FieldError>{error}</FieldError>
        </div>
      )}

      <Reachability />
      <NotificationMatrix />

      {me.is_admin && (
        <div className="flex flex-col gap-1.5">
          {/* nur Admins sehen den Block; die Workflows liegen auf S-51 und S-52 */}
          <span className="label-mono px-1">Verwaltung (Admin)</span>
          <div className="flex flex-col overflow-hidden rounded-2xl border border-linie">
            {admin.map((a) => (
              <Link
                key={a.to}
                to={a.to}
                className="flex h-[50px] items-center border-b border-erhoeht bg-flaeche px-3.5 text-[14px] text-text no-underline last:border-b-0"
              >
                <span className="flex-1">{a.label}</span>
                <span
                  className={cx(
                    'font-mono text-[12px]',
                    a.meta.startsWith('WARNUNG') ? 'text-rot' : 'text-leise',
                  )}
                >
                  {a.meta}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col overflow-hidden rounded-2xl border border-linie">
        {/* WF-ADM-08 Vorlagen bearbeiten – für alle Mitglieder */}
        <Link
          to="/profil/vorlagen"
          data-wf="WF-ADM-08"
          className="flex h-[50px] items-center border-b border-erhoeht bg-flaeche px-3.5 text-[14px] text-text no-underline"
        >
          <span className="flex-1">Veranstaltungsvorlagen</span>
          <span className="font-mono text-[12px] text-leise">›</span>
        </Link>
        <Link
          to="/datenschutz"
          className="flex h-[50px] items-center bg-flaeche px-3.5 text-[14px] text-text no-underline"
        >
          <span className="flex-1">Datenschutz</span>
          <span className="font-mono text-[12px] text-leise">›</span>
        </Link>
      </div>

      {/* WF-LOG-03 Abmelden */}
      <button
        type="button"
        data-wf="WF-LOG-03"
        onClick={() => {
          setFilter(DEFAULT_AGENDA_FILTER);
          void run(() => api.signOut());
        }}
        className="flex h-[46px] items-center justify-center rounded-[23px] border border-rand text-[15px] text-weich"
      >
        Abmelden
      </button>
    </div>
  );
}
