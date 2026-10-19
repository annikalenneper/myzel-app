// S-51 Verwaltung: Mitglieder · P1 · nur Admins
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BarOffset, useFeedback } from '../../app/feedback';
import { useLookups } from '../../app/lookups';
import { useMe } from '../../app/session';
import { useData } from '../../app/useData';
import { api } from '../../data';
import { TASK_STATUS_LABEL } from '../../shared/labels';
import { suggestShort } from '../../shared/rules/members';
import type { Member } from '../../shared/schema';
import { Avatar, CheckBox, FieldError, GhostButton, LightButton, ListSkeleton } from '../../ui/bits';
import { IconBack } from '../../ui/icons';
import { Sheet } from '../../ui/Sheet';

type SheetState =
  { kind: 'new' } | { kind: 'edit'; member: Member } | { kind: 'deactivate'; member: Member } | null;

export function AdminTopBar() {
  return (
    <div className="sticky top-0 z-10 flex h-[60px] items-center gap-1 bg-grund px-3">
      <Link
        to="/profil"
        aria-label="Zurück zum Profil"
        className="flex size-11 items-center justify-center text-text"
      >
        <IconBack />
      </Link>
      <span className="font-mono text-[13px] text-leise">VERWALTUNG</span>
    </div>
  );
}

export function Members() {
  const { run } = useFeedback();
  const { members, memberById, ready } = useLookups();
  const [sheet, setSheet] = useState<SheetState>(null);

  const people = members.filter((m) => !m.is_system);
  const system = members.find((m) => m.is_system);
  const active = people.filter((m) => m.active);
  const inactive = people.filter((m) => !m.active);
  const activeAdmins = active.filter((m) => m.is_admin).length;
  // immer der frische Stand: nach „Neu laden“ im Konflikt startet das Formular mit der neuen version
  const selected = sheet && 'member' in sheet ? (memberById.get(sheet.member.id) ?? sheet.member) : null;

  return (
    <div className="mx-auto max-w-[560px] lg:mx-0">
      <BarOffset px={24} />
      <AdminTopBar />
      <div className="flex flex-col gap-3.5 px-5 pb-24">
        <div className="flex items-center">
          <h1 className="m-0 flex-1 text-[30px] leading-[1.15] font-bold tracking-[-1px]">Mitglieder</h1>
          {/* WF-ADM-01 Mitglied anlegen */}
          <button
            type="button"
            data-wf="WF-ADM-01"
            onClick={() => setSheet({ kind: 'new' })}
            className="hit h-10 rounded-[20px] bg-geplant px-3.5 text-[14px] font-semibold text-grund"
          >
            + Mitglied
          </button>
        </div>
        {!ready ? (
          <ListSkeleton />
        ) : (
          <>
            <span className="label-mono">Aktiv · {active.length}</span>
            <div className="flex flex-col overflow-hidden rounded-2xl border border-linie">
              {active.map((m) => (
                // WF-ADM-02 Mitglied bearbeiten
                <button
                  key={m.id}
                  type="button"
                  data-wf="WF-ADM-02"
                  onClick={() => setSheet({ kind: 'edit', member: m })}
                  className="flex min-h-[58px] items-center gap-3 border-b border-erhoeht bg-flaeche px-3.5 py-2 text-left text-text"
                >
                  <Avatar member={m} size={34} />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-[15px] font-semibold">{m.display_name}</span>
                    <span className="truncate font-mono text-[11px] text-leise">{m.email}</span>
                  </span>
                  {m.is_admin && (
                    <span className="rounded-full border border-violett px-2 py-0.5 font-mono text-[10px] text-violett">
                      ADMIN
                    </span>
                  )}
                  <span className="text-leise" aria-hidden="true">
                    ›
                  </span>
                </button>
              ))}
              {system && (
                <div className="flex min-h-[52px] items-center gap-3 bg-nav px-3.5 py-2 text-leise">
                  <span
                    aria-hidden="true"
                    className="flex size-[34px] items-center justify-center rounded-full border border-dashed border-rand-stark text-[13px]"
                  >
                    ⚙
                  </span>
                  <span className="flex-1 text-[14px]">{system.display_name}</span>
                  <span className="font-mono text-[10px]">SYSTEM</span>
                </div>
              )}
            </div>

            <span className="label-mono pt-1.5">Deaktiviert · {inactive.length}</span>
            <div className="flex flex-col overflow-hidden rounded-2xl border border-linie">
              {inactive.map((m) => (
                <div
                  key={m.id}
                  className="flex min-h-14 items-center gap-3 border-b border-erhoeht bg-nav py-2 pr-2 pl-3.5 last:border-b-0"
                >
                  <Avatar member={m} size={34} />
                  <span className="flex-1 text-[15px] text-leise">{m.display_name}</span>
                  {/* WF-ADM-04 Reaktivieren */}
                  <button
                    type="button"
                    data-wf="WF-ADM-04"
                    onClick={() =>
                      void run(() => api.reactivateMember(m.id), {
                        success: `${m.display_name} ist wieder aktiv – frühere Einträge wurden nicht wiederhergestellt.`,
                      })
                    }
                    className="hit h-[34px] rounded-[17px] border border-rand-stark px-3 text-[13px] text-text"
                  >
                    Reaktivieren
                  </button>
                </div>
              ))}
              {inactive.length === 0 && (
                <div data-wf="WF-ALL-05" className="p-4 text-[14px] text-leise">
                  Niemand deaktiviert.
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {(sheet?.kind === 'new' || sheet?.kind === 'edit') && (
        <MemberForm
          key={selected ? `${selected.id}:${selected.version}` : 'new'}
          member={selected}
          takenShorts={people.map((m) => m.short)}
          lastAdmin={!!selected && selected.is_admin && activeAdmins <= 1}
          onClose={() => setSheet(null)}
          onDeactivate={(member) => setSheet({ kind: 'deactivate', member })}
        />
      )}
      {sheet?.kind === 'deactivate' && selected && (
        <DeactivateSheet member={selected} onClose={() => setSheet(null)} />
      )}
    </div>
  );
}

/** WF-ADM-01 / WF-ADM-02 Formular */
function MemberForm({
  member,
  takenShorts,
  lastAdmin,
  onClose,
  onDeactivate,
}: {
  member: Member | null;
  takenShorts: string[];
  lastAdmin: boolean;
  onClose: () => void;
  onDeactivate: (member: Member) => void;
}) {
  const { run } = useFeedback();
  const me = useMe();
  const wf = member ? 'WF-ADM-02' : 'WF-ADM-01';
  const [name, setName] = useState(member?.display_name ?? '');
  const [short, setShort] = useState(member?.short ?? '');
  const [shortTouched, setShortTouched] = useState(!!member);
  const [email, setEmail] = useState(member?.email ?? '');
  const [isAdmin, setIsAdmin] = useState(member?.is_admin ?? false);
  const [error, setError] = useState<{ field: string | null; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const fieldError = (field: string) => error?.field === field && error.message;
  const complete = name.trim() && short.trim() && email.trim();

  const save = async () => {
    if (!complete || saving) return;
    setSaving(true);
    setError(null);
    const input = { display_name: name, short, email, is_admin: isAdmin };
    const ok = await run(
      () =>
        member
          ? api.updateMember(member.id, { ...input, version: member.version }).then(() => true)
          : api.createMember(input).then(() => true),
      {
        subject: 'dieses Mitglied',
        ownInput: member ? `${name} · ${short} · ${email}${isAdmin ? ' · Admin' : ''}` : undefined,
        success: member ? 'Gespeichert' : 'Angelegt – kann sich jetzt anmelden.',
        onInvalid: (e) => setError({ field: e.field, message: e.message }),
      },
    );
    setSaving(false);
    if (ok) onClose();
  };

  const input = 'h-[46px] rounded-xl border border-rand bg-grund px-3.5 text-text normal-case';
  return (
    <Sheet
      title={member ? `${member.display_name} bearbeiten` : 'Neues Mitglied'}
      onClose={onClose}
      wf={wf}
      closeButton
    >
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="label-mono flex flex-col gap-1.5">
          Name *
          <input
            type="text"
            data-wf={wf}
            autoFocus={!member}
            value={name}
            maxLength={60}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
              // Kürzel aus dem Namen vorschlagen, solange es niemand von Hand geändert hat
              if (!shortTouched) setShort(suggestShort(e.target.value, takenShorts));
            }}
            className={`${input} font-sans text-[16px]`}
          />
        </label>
        <FieldError>{fieldError('display_name')}</FieldError>
        <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-2.5">
          <label className="label-mono flex flex-col gap-1.5">
            Kürzel *
            <input
              type="text"
              data-wf={wf}
              value={short}
              maxLength={3}
              onChange={(e) => {
                setShort(e.target.value.toUpperCase());
                setError(null);
                setShortTouched(true);
              }}
              className={`${input} font-mono text-[16px]`}
            />
          </label>
          <label className="label-mono flex flex-col gap-1.5">
            Google-Mail *
            <input
              type="email"
              data-wf={wf}
              value={email}
              autoComplete="off"
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
              }}
              className={`${input} font-sans text-[15px]`}
            />
          </label>
        </div>
        <FieldError>{fieldError('short') || fieldError('email')}</FieldError>
        <span className="label-mono">Kürzel und Mail müssen eindeutig sein</span>
        {member?.id === me.id && email.trim().toLowerCase() !== (member.email ?? '') && (
          <span className="text-[13px] leading-[1.4] text-bernstein">
            Das ist deine eigene Adresse: Nach dem Speichern meldest du dich mit der neuen an.
          </span>
        )}
        <button
          type="button"
          role="checkbox"
          aria-checked={isAdmin}
          data-wf={wf}
          // die letzte Person mit Admin-Rechten behält sie
          onClick={() => setIsAdmin(lastAdmin ? true : !isAdmin)}
          className="flex h-12 items-center gap-3 rounded-xl border border-linie bg-grund px-3.5 text-left text-[15px] text-text"
        >
          <CheckBox checked={isAdmin} />
          Admin-Rechte
        </button>
        <FieldError>
          {error && !['display_name', 'short', 'email'].includes(error.field ?? '') && error.message}
        </FieldError>
        <LightButton type="submit" data-wf={wf} disabled={!complete || saving}>
          {!complete ? 'Name, Kürzel und Mail ausfüllen' : member ? 'Speichern' : 'Anlegen'}
        </LightButton>
        {member && !lastAdmin && (
          // WF-ADM-03 Deaktivieren → Dialog
          <button
            type="button"
            data-wf="WF-ADM-03"
            onClick={() => onDeactivate(member)}
            className="h-[46px] rounded-[23px] border border-rot-rand text-[15px] text-rot-hell"
          >
            Deaktivieren …
          </button>
        )}
        {member && lastAdmin && (
          <span className="text-[13px] text-leise">
            Letzte Person mit Admin-Rechten – kann nicht deaktiviert werden.
          </span>
        )}
      </form>
    </Sheet>
  );
}

/** WF-ADM-03: Folgen auflisten, dann in einer Transaktion aufräumen (wächst bis P4) */
function DeactivateSheet({ member, onClose }: { member: Member; onClose: () => void }) {
  const { run } = useFeedback();
  const me = useMe();
  const [saving, setSaving] = useState(false);
  const { data: impact, error } = useData(`deactivation:${member.id}`, () =>
    api.getDeactivationImpact(member.id),
  );
  const name = member.display_name;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  const confirm = async () => {
    if (saving) return;
    setSaving(true);
    const result = await run(() => api.deactivateMember(member.id), {
      success: (r) => {
        const reset = r.tasks_without_assignee.filter((t) => t.status !== t.status_after).length;
        return reset
          ? `Deaktiviert – ${plural(reset, 'Aufgabe', 'Aufgaben')} ohne Bearbeitende ${reset === 1 ? 'steht' : 'stehen'} jetzt auf Geplant.`
          : 'Deaktiviert – überall ausgetragen.';
      },
    });
    setSaving(false);
    if (result) onClose();
  };

  return (
    <Sheet title={`${name} deaktivieren?`} onClose={onClose} wf="WF-ADM-03">
      <span className="text-[15px] leading-normal text-weich">
        {name} wird überall ausgetragen. Das passiert dabei:
      </span>
      {!impact && !error && <ListSkeleton />}
      {error && <FieldError>{error.message}</FieldError>}
      {impact && (
        <>
          {impact.tasks_without_assignee.length > 0 && (
            <div className="flex flex-col gap-2 rounded-[14px] border border-rot-rand bg-rot-flaeche px-3.5 py-3">
              <span className="font-mono text-[11px] text-rot-hell uppercase">
                {plural(impact.tasks_without_assignee.length, 'Aufgabe', 'Aufgaben')} ohne Bearbeitende danach
              </span>
              {impact.tasks_without_assignee.map((t) => (
                <span key={t.id} className="text-[14px]">
                  {t.title}{' '}
                  <span className="text-leise">
                    ·{' '}
                    {t.status === t.status_after
                      ? TASK_STATUS_LABEL[t.status]
                      : `${TASK_STATUS_LABEL[t.status]} → ${TASK_STATUS_LABEL[t.status_after]}`}
                  </span>
                </span>
              ))}
            </div>
          )}
          <div className="flex flex-col gap-1.5 rounded-[14px] border border-linie bg-grund px-3.5 py-3 text-[14px] text-weich">
            {impact.tasks_without_assignee.length === 0 && (
              <span>Keine Aufgabe bleibt ohne Bearbeitende.</span>
            )}
            <span>
              {plural(impact.tasks_shared_count, 'Aufgabe', 'Aufgaben')} mit weiteren Bearbeitenden –
              unkritisch
            </span>
            <span>
              Folgt {plural(impact.following_count, 'Aufgabe', 'Aufgaben')} –{' '}
              {impact.following_count ? 'wird entfernt' : 'nichts zu entfernen'}
            </span>
            <span>
              {plural(impact.future_rsvp_count, 'Antwort', 'Antworten')} für künftige Termine –{' '}
              {impact.future_rsvp_count
                ? impact.future_rsvp_count === 1
                  ? 'wird entfernt'
                  : 'werden entfernt'
                : 'nichts zu entfernen'}
            </span>
            <span>
              Hauptverantwortlich bei {plural(impact.lead_count, 'Veranstaltung', 'Veranstaltungen')} –{' '}
              {impact.lead_count ? 'wird ausgetragen' : 'nichts auszutragen'}
            </span>
            <span>
              Interne Kontaktperson bei {plural(impact.partner_contact_count, 'Partner', 'Partnern')} –{' '}
              {impact.partner_contact_count ? 'wird ausgetragen' : 'nichts auszutragen'}
            </span>
          </div>
        </>
      )}
      <span className="text-[13px] leading-[1.4] text-leise">
        Reaktivieren trägt {name} nicht automatisch wieder ein. Alles steht in der Historie.
      </span>
      {member.id === me.id && (
        <span className="text-[13px] leading-[1.4] text-bernstein">
          Das bist du selbst: Du wirst dabei sofort abgemeldet und kommst nicht mehr rein.
        </span>
      )}
      <button
        type="button"
        data-wf="WF-ADM-03"
        disabled={!impact || saving}
        onClick={() => void confirm()}
        className="h-[50px] rounded-[25px] bg-rot text-[16px] font-bold text-grund disabled:bg-erhoeht disabled:text-leise"
      >
        {name} deaktivieren
      </button>
      <GhostButton onClick={onClose}>Abbrechen</GhostButton>
    </Sheet>
  );
}
