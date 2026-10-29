// WF-TER-12: Wer eingeladen ist (nur bei Auswahl beim Anlegen) und „Weitere einladen“
import { useState } from 'react';
import { useLookups } from '../../app/lookups';
import { useActions } from '../../app/useActions';
import { useNow } from '../../app/useNow';
import { api } from '../../data';
import type { AppointmentDetail } from '../../data/api';
import { canInviteMore } from '../../shared/rules/appointments';
import { Pill, PrimaryButton } from '../../ui/bits';
import { Sheet } from '../../ui/Sheet';

export function Invitees({ a }: { a: AppointmentDetail }) {
  const { memberById, activeMembers } = useLookups();
  const now = useNow();
  const [open, setOpen] = useState(false);
  if (a.invitee_ids.length === 0) return null;
  const invited = [a.created_by, ...a.invitee_ids];
  const rest = activeMembers.filter((m) => !invited.includes(m.id));
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="text-[13px] leading-[1.4] text-leise">
        Eingeladen: {invited.map((id) => memberById.get(id)?.display_name ?? 'Unbekannt').join(', ')}
      </span>
      {canInviteMore(a, a.invitee_ids, now) && rest.length > 0 && (
        <button
          type="button"
          data-wf="WF-TER-12"
          onClick={() => setOpen(true)}
          className="hit text-[13px] font-medium text-pink"
        >
          Weitere einladen
        </button>
      )}
      {open && <InviteSheet a={a} candidates={rest} onClose={() => setOpen(false)} />}
    </div>
  );
}

function InviteSheet({
  a,
  candidates,
  onClose,
}: {
  a: AppointmentDetail;
  candidates: { id: string; display_name: string }[];
  onClose: () => void;
}) {
  const act = useActions();
  const [ids, setIds] = useState<string[]>([]);
  const everyone = ids.length === candidates.length;
  return (
    <Sheet title="Weitere einladen" onClose={onClose} wf="WF-TER-12" closeButton>
      <div className="flex flex-col gap-3.5">
        <span className="text-[14px] leading-normal text-weich">
          Wer hier ausgewählt wird, bekommt jetzt eine Einladung zu „{a.title}“.
        </span>
        <div role="group" aria-label="Weitere einladen" className="flex flex-wrap gap-2">
          <Pill
            data-wf="WF-TER-12"
            on={everyone}
            onClick={() => setIds(everyone ? [] : candidates.map((m) => m.id))}
            className="font-medium"
          >
            Alle übrigen
          </Pill>
          {candidates.map((m) => (
            <Pill
              key={m.id}
              data-wf="WF-TER-12"
              on={ids.includes(m.id)}
              onClick={() => setIds((x) => (x.includes(m.id) ? x.filter((id) => id !== m.id) : [...x, m.id]))}
            >
              {m.display_name}
            </Pill>
          ))}
        </div>
        <PrimaryButton
          type="button"
          data-wf="WF-TER-12"
          disabled={ids.length === 0}
          onClick={() => {
            onClose();
            void act(() => api.inviteToAppointment(a.id, ids), {
              subject: 'diesen Termin',
              success: ids.length === 1 ? 'Eingeladen' : `${ids.length} Personen eingeladen`,
            });
          }}
        >
          {ids.length === 0 ? 'Personen wählen, dann einladen' : 'Einladen'}
        </PrimaryButton>
      </div>
    </Sheet>
  );
}
