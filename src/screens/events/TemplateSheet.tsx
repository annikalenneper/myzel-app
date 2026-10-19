// S-23 Vorlagen-Dialog · P4 (F-VER-06, WF-VER-12) – im Prototyp nicht entworfen, im Stil der Sheets abgeleitet.
// Nach dem Anlegen einer Veranstaltung und später erneut aufrufbar: Aufgaben der Vorlage nach Baustein, per
// Häkchen an- und abwählbar, Fristen aus dem Datum; nur Ausgewähltes wird als „neu“ angelegt, ohne Duplikate.
import { useState } from 'react';
import { useActions } from '../../app/useActions';
import { useData } from '../../app/useData';
import { api } from '../../data';
import { formatDateWithWeekday, formatOffsetDays } from '../../shared/format';
import { CheckBox, cx, GhostButton, ListSkeleton, LoadError, PrimaryButton } from '../../ui/bits';
import { Sheet } from '../../ui/Sheet';

const WF = 'WF-VER-12';

export function TemplateSheet({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const { data: dialog, error, reload } = useData(`vorlage:${eventId}`, () => api.getTemplateDialog(eventId));
  if (!dialog)
    return (
      <Sheet title="Aufgaben aus der Vorlage" onClose={onClose} wf={WF} closeButton>
        {error ? <LoadError message={error.message} onRetry={reload} /> : <ListSkeleton />}
      </Sheet>
    );
  return <Loaded dialog={dialog} onClose={onClose} />;
}

function Loaded({
  dialog,
  onClose,
}: {
  dialog: Awaited<ReturnType<typeof api.getTemplateDialog>>;
  onClose: () => void;
}) {
  const act = useActions();
  const open = dialog.blocks.flatMap((b) => b.items).filter((i) => !i.task_id && !i.blocked);
  // vorausgewählt ist alles, was noch nicht angelegt ist
  const [picked, setPicked] = useState<Set<string>>(() => new Set(open.map((i) => i.id)));
  const toggle = (ids: string[], on: boolean) => {
    const next = new Set(picked);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    setPicked(next);
  };

  if (!dialog.template)
    return (
      <Sheet title="Aufgaben aus der Vorlage" onClose={onClose} wf={WF} closeButton>
        <span className="text-[15px] leading-normal text-weich">
          Für diese Veranstaltungsart gibt es keine Vorlage.
        </span>
        <GhostButton onClick={onClose}>Schließen</GhostButton>
      </Sheet>
    );

  // was inzwischen jemand anderes angelegt hat, zählt nicht mehr mit
  const count = open.filter((i) => picked.has(i.id)).length;
  return (
    <Sheet title={`Vorlage „${dialog.template.name}“`} onClose={onClose} wf={WF} closeButton>
      <span className="text-[14px] leading-[1.45] text-weich">
        Häkchen setzen, was ihr braucht – ganze Bausteine lassen sich abwählen. Angelegt wird nur
        Ausgewähltes, als „Neu“. Fristen ergeben sich aus dem Datum.
      </span>
      <div className="flex flex-col gap-3">
        {dialog.blocks.map(({ block, items }) => {
          const free = items.filter((i) => !i.task_id && !i.blocked).map((i) => i.id);
          const all = free.length > 0 && free.every((id) => picked.has(id));
          return (
            <section key={block} aria-label={`Baustein ${block}`} className="flex flex-col gap-1">
              <button
                type="button"
                role="checkbox"
                data-wf={WF}
                aria-checked={all ? true : free.some((id) => picked.has(id)) ? 'mixed' : false}
                aria-label={`Baustein ${block}`}
                disabled={free.length === 0}
                onClick={() => toggle(free, !all)}
                className="flex min-h-11 items-center gap-3 text-left"
              >
                <CheckBox checked={all} />
                <span className="flex-1 font-mono text-[12px] text-leise uppercase">{block}</span>
                <span className="label-mono">
                  {items.filter((i) => picked.has(i.id)).length}/{free.length}
                </span>
              </button>
              {items.map((item) => {
                const done = !!item.task_id || !!item.blocked;
                const on = !done && picked.has(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="checkbox"
                    data-wf={WF}
                    aria-checked={on}
                    aria-label={item.title}
                    disabled={done}
                    onClick={() => toggle([item.id], !on)}
                    className={cx(
                      'flex min-h-12 items-center gap-3 rounded-[14px] border border-linie bg-grund px-3.5 py-2 text-left',
                      done && 'opacity-60',
                    )}
                  >
                    <CheckBox checked={on} size={20} />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-[15px] text-text">{item.title}</span>
                      <span className="font-mono text-[11px] text-leise uppercase">
                        {item.task_id
                          ? 'Schon angelegt'
                          : item.blocked
                            ? item.blocked
                            : `Bis ${formatDateWithWeekday(item.due_date)} · ${formatOffsetDays(item.offset_days)}`}
                      </span>
                    </span>
                  </button>
                );
              })}
            </section>
          );
        })}
      </div>
      <PrimaryButton
        data-wf={WF}
        disabled={count === 0}
        onClick={() => {
          onClose();
          void act(
            () =>
              api.applyTemplate(
                dialog.event_id,
                open.filter((i) => picked.has(i.id)).map((i) => i.id),
              ),
            {
              success: (r) => `${r.created} ${r.created === 1 ? 'Aufgabe' : 'Aufgaben'} angelegt`,
              undo: (r) => r.undo_token || undefined,
            },
          );
        }}
      >
        {count === 0
          ? open.length === 0
            ? 'Alles schon angelegt'
            : 'Nichts ausgewählt'
          : `${count} ${count === 1 ? 'Aufgabe' : 'Aufgaben'} anlegen`}
      </PrimaryButton>
      <GhostButton data-wf={WF} onClick={onClose}>
        Überspringen
      </GhostButton>
    </Sheet>
  );
}
