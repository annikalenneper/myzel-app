// S-52 Verwaltung: Themen · P1 · nur Admins
import { useState } from 'react';
import { BarOffset, useFeedback } from '../../app/feedback';
import { useLookups } from '../../app/lookups';
import { api } from '../../data';
import type { TopicWithUsage } from '../../data/api';
import { cx, FieldError, GhostButton, LightButton, ListSkeleton, Pill } from '../../ui/bits';
import { Sheet } from '../../ui/Sheet';
import { AdminTopBar } from './Members';

const WF = 'WF-ADM-05';

export function Topics() {
  const { topics, topicById, ready } = useLookups();
  const [sheet, setSheet] = useState<{ topic: TopicWithUsage | null } | null>(null);
  // immer der frische Stand: nach „Neu laden“ im Konflikt startet das Formular mit der neuen version
  const selected = sheet?.topic ? (topicById.get(sheet.topic.id) ?? sheet.topic) : null;
  const childCount = (id: string) => topics.filter((t) => t.parent_id === id).length;

  return (
    <div className="mx-auto max-w-[560px] lg:max-w-[720px]">
      <BarOffset px={24} />
      <AdminTopBar />
      <div className="flex flex-col gap-3.5 px-5 pb-24">
        <div className="flex items-center">
          <h1 className="m-0 flex-1 text-[30px] leading-[1.15] font-bold tracking-[-1px]">Themen</h1>
          <button
            type="button"
            data-wf={WF}
            onClick={() => setSheet({ topic: null })}
            className="hit h-10 rounded-[20px] bg-geplant px-3.5 text-[14px] font-semibold text-grund"
          >
            + Thema
          </button>
        </div>
        {!ready ? (
          <ListSkeleton />
        ) : (
          <div className="flex flex-col overflow-hidden rounded-2xl border border-linie">
            {topics.map((t) => (
              <button
                key={t.id}
                type="button"
                data-wf={WF}
                onClick={() => setSheet({ topic: t })}
                className={cx(
                  'flex min-h-[52px] items-center gap-2.5 border-b border-erhoeht py-2 pr-3.5 text-left text-[15px] last:border-b-0',
                  t.parent_id ? 'pl-[34px]' : 'pl-3.5',
                  t.archived_at ? 'bg-nav text-leise' : 'bg-flaeche text-text',
                )}
              >
                <span className="flex-1">{t.name}</span>
                <span className="label-mono">
                  {t.archived_at
                    ? 'Archiviert'
                    : t.task_count
                      ? `${t.task_count} ${t.task_count === 1 ? 'Aufgabe' : 'Aufgaben'}`
                      : childCount(t.id)
                        ? `${childCount(t.id)} ${childCount(t.id) === 1 ? 'Unterkategorie' : 'Unterkategorien'}`
                        : 'Unbenutzt'}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      {sheet && (
        <TopicSheet
          key={selected ? `${selected.id}:${selected.version}` : 'new'}
          topic={selected}
          all={topics}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}

function TopicSheet({
  topic,
  all,
  onClose,
}: {
  topic: TopicWithUsage | null;
  all: TopicWithUsage[];
  onClose: () => void;
}) {
  const { run } = useFeedback();
  const [name, setName] = useState(topic?.name ?? '');
  const [parentId, setParentId] = useState<string | null>(topic?.parent_id ?? null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const children = topic ? all.filter((t) => t.parent_id === topic.id) : [];
  const parents = all.filter((t) => !t.parent_id && !t.archived_at && t.id !== topic?.id);
  const onInvalid = (e: { message: string }) => setError(e.message);

  const save = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);
    const input = { name, parent_id: parentId };
    const ok = await run(
      () =>
        topic
          ? api.updateTopic(topic.id, { ...input, version: topic.version }).then(() => true)
          : api.createTopic(input).then(() => true),
      {
        subject: 'dieses Thema',
        ownInput: topic ? name : undefined,
        success: topic ? 'Gespeichert' : 'Thema angelegt',
        onInvalid,
      },
    );
    setSaving(false);
    if (ok) onClose();
  };

  // Was unten geht: wiederherstellen, löschen (nur unbenutzt) oder archivieren (nicht mit aktiven Aufgaben, 3.2)
  const openChildren = children.filter((c) => !c.archived_at).length;
  const state = !topic
    ? null
    : topic.archived_at
      ? {
          label: 'Wiederherstellen',
          hint: 'Archiviert – steht bei neuen Aufgaben nicht mehr zur Auswahl.',
          done: 'Thema wiederhergestellt',
          action: () => api.restoreTopic(topic.id, topic.version),
        }
      : topic.task_count === 0 && children.length === 0
        ? {
            label: 'Löschen',
            hint: 'Noch nirgends benutzt.',
            done: 'Thema gelöscht',
            action: () => api.deleteTopic(topic.id),
          }
        : topic.active_task_count > 0
          ? {
              label: 'Archivieren',
              hint: `Hat noch ${topic.active_task_count} ${topic.active_task_count === 1 ? 'aktive Aufgabe' : 'aktive Aufgaben'} – erst abschließen oder umhängen, dann archivieren.`,
              action: null,
            }
          : openChildren > 0
            ? {
                label: 'Archivieren',
                hint: 'Hat Unterkategorien – erst diese archivieren oder umhängen.',
                action: null,
              }
            : {
                label: 'Archivieren',
                hint: 'Wird benutzt – deshalb nur archivierbar. Bestehende Aufgaben behalten das Thema.',
                done: 'Thema archiviert',
                action: () => api.archiveTopic(topic.id, topic.version),
              };

  return (
    <Sheet title={topic ? 'Thema bearbeiten' : 'Neues Thema'} onClose={onClose} wf={WF} closeButton>
      <form
        className="flex flex-col gap-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="label-mono flex flex-col gap-1.5">
          Name *
          <input
            type="text"
            data-wf={WF}
            autoFocus={!topic}
            value={name}
            maxLength={60}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            className="h-[46px] rounded-xl border border-rand bg-grund px-3.5 font-sans text-[16px] text-text normal-case"
          />
        </label>
        {children.length === 0 ? (
          <>
            <span id="oberthema" className="label-mono">
              Oberthema (optional)
            </span>
            <div role="group" aria-labelledby="oberthema" className="flex flex-wrap gap-2">
              {parents.map((p) => (
                <Pill
                  key={p.id}
                  size="sm"
                  data-wf={WF}
                  on={parentId === p.id}
                  onClick={() => setParentId(parentId === p.id ? null : p.id)}
                >
                  {p.name}
                </Pill>
              ))}
            </div>
          </>
        ) : (
          <span className="text-[13px] leading-[1.4] text-leise">
            Hat Unterkategorien und bleibt deshalb auf der obersten Ebene.
          </span>
        )}
        <FieldError>{error}</FieldError>
        <LightButton type="submit" data-wf={WF} disabled={!name.trim() || saving}>
          {name.trim() ? 'Speichern' : 'Name eingeben, dann speichern'}
        </LightButton>
        {state && (
          <div className="flex flex-col gap-1.5">
            <GhostButton
              data-wf={WF}
              disabled={!state.action}
              className={cx(!state.action && 'border-linie text-leise')}
              onClick={async () => {
                if (!state.action || saving) return;
                setSaving(true);
                const ok = await run(() => state.action().then(() => true), {
                  subject: 'dieses Thema',
                  success: state.done,
                  onInvalid,
                });
                setSaving(false);
                if (ok) onClose();
              }}
            >
              {state.label}
            </GhostButton>
            <span className="text-center text-[12px] leading-[1.4] text-leise">{state.hint}</span>
          </div>
        )}
      </form>
    </Sheet>
  );
}
