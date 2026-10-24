// S-55 Vorlagen bearbeiten · P4 (F-VER-07, WF-ADM-08) – im Prototyp nicht entworfen, im Stil von S-53
// abgeleitet. Für alle Mitglieder; Änderungen wirken auf künftige Vorlagen-Dialoge, schon angelegte Aufgaben
// bleiben, wie sie sind.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BarOffset } from '../../app/feedback';
import { useLookups } from '../../app/lookups';
import { useActions } from '../../app/useActions';
import { useData } from '../../app/useData';
import { api } from '../../data';
import type { TemplateWithItems } from '../../data/api';
import { formatOffsetDays } from '../../shared/format';
import { EVENT_TYPE_LABEL, PRIORITY_LABEL } from '../../shared/labels';
import { PRIORITIES, type EventTemplateItem, type Priority } from '../../shared/schema';
import { cx, FieldError, GhostButton, LightButton, ListSkeleton, LoadError } from '../../ui/bits';
import { IconBack } from '../../ui/icons';
import { Sheet } from '../../ui/Sheet';
import { TopicSelect } from '../knowledge/KnowledgeSheets';

const WF = 'WF-ADM-08';

export function Templates() {
  const { topicName } = useLookups();
  const { data: templates, error, reload } = useData('templates', () => api.listTemplates());
  const [typeId, setTypeId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{ item: EventTemplateItem | null; block?: string } | null>(null);
  const current = templates?.find((t) => t.id === typeId) ?? templates?.[0];

  return (
    <div className="mx-auto max-w-[560px] lg:max-w-[720px]">
      <BarOffset px={24} />
      <div className="sticky top-0 z-10 flex h-[60px] items-center gap-1 bg-grund px-3">
        <Link
          to="/profil"
          aria-label="Zurück zum Profil"
          className="flex size-11 items-center justify-center text-text"
        >
          <IconBack />
        </Link>
        <span className="font-mono text-[13px] text-leise">PROFIL</span>
      </div>
      <div className="flex flex-col gap-3.5 px-5 pb-24">
        <h1 className="m-0 text-[30px] leading-[1.15] font-bold tracking-[-1px]">Vorlagen</h1>
        <span className="text-[13px] leading-[1.45] text-leise">
          Aufgabenvorschläge je Veranstaltungsart, gruppiert nach Baustein. Änderungen gelten für künftige
          Vorlagen-Dialoge; schon angelegte Aufgaben bleiben, wie sie sind.
        </span>
        {error && !templates ? (
          <LoadError message={error.message} onRetry={reload} />
        ) : !templates || !current ? (
          <ListSkeleton />
        ) : (
          <>
            <div role="tablist" aria-label="Veranstaltungsart" className="flex flex-wrap gap-1.5">
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  data-wf={WF}
                  aria-selected={t.id === current.id}
                  onClick={() => setTypeId(t.id)}
                  className={cx(
                    'hit h-8 rounded-2xl border px-3 text-[13px]',
                    t.id === current.id
                      ? 'border-text bg-text font-semibold text-grund'
                      : 'border-rand text-weich',
                  )}
                >
                  {EVENT_TYPE_LABEL[t.event_type]}
                </button>
              ))}
            </div>
            {current.blocks.map(({ block, items }) => (
              <section key={block} aria-label={`Baustein ${block}`} className="flex flex-col gap-1.5">
                <div className="flex items-center">
                  <span className="label-mono flex-1">{block}</span>
                  <button
                    type="button"
                    data-wf={WF}
                    aria-label={`Aufgabe zu ${block} hinzufügen`}
                    onClick={() => setSheet({ item: null, block })}
                    className="hit h-8 px-2 text-[13px] text-pink"
                  >
                    + Aufgabe
                  </button>
                </div>
                <div className="flex flex-col overflow-hidden rounded-2xl border border-linie">
                  {items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      data-wf={WF}
                      onClick={() => setSheet({ item })}
                      className="flex min-h-[54px] flex-col justify-center gap-0.5 border-b border-erhoeht bg-flaeche px-3.5 py-2 text-left last:border-b-0"
                    >
                      <span className="text-[15px] text-text">{item.title}</span>
                      <span className="font-mono text-[11px] text-leise uppercase">
                        {formatOffsetDays(item.offset_days)} · {PRIORITY_LABEL[item.default_priority]} ·{' '}
                        {topicName(item.topic_id)}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
            <button
              type="button"
              data-wf={WF}
              onClick={() => setSheet({ item: null })}
              className="hit h-11 rounded-[14px] border border-dashed border-rand-stark text-[14px] text-weich"
            >
              + Aufgabe in neuem Baustein
            </button>
          </>
        )}
      </div>
      {sheet && current && (
        <ItemSheet
          key={sheet.item ? `${sheet.item.id}:${sheet.item.version}` : 'neu'}
          template={current}
          item={sheet.item}
          block={sheet.block}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}

function ItemSheet({
  template,
  item,
  block: presetBlock,
  onClose,
}: {
  template: TemplateWithItems;
  item: EventTemplateItem | null;
  block?: string;
  onClose: () => void;
}) {
  const act = useActions();
  const [block, setBlock] = useState(item?.block ?? presetBlock ?? '');
  const [title, setTitle] = useState(item?.title ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [offset, setOffset] = useState(String(item?.offset_days ?? -7));
  const [priority, setPriority] = useState<Priority>(item?.default_priority ?? 'mittel');
  const [topicId, setTopicId] = useState(item?.topic_id ?? '');
  const [armed, setArmed] = useState(false);
  // ein zweiter Tipp während des Speicherns legt nichts doppelt an
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ field: string | null; message: string } | null>(null);
  const days = Number(offset);
  const missing = !block.trim()
    ? 'Baustein angeben, dann speichern'
    : !title.trim()
      ? 'Titel eingeben, dann speichern'
      : offset.trim() === '' || !Number.isInteger(days)
        ? 'Abstand in Tagen angeben'
        : !topicId
          ? 'Thema wählen, dann speichern'
          : null;
  const fieldError = (f: string) => (error?.field === f ? error.message : null);

  const submit = async () => {
    if (missing || saving) return;
    setSaving(true);
    const input = {
      block,
      title,
      description,
      offset_days: days,
      default_priority: priority,
      topic_id: topicId,
    };
    const ok = item
      ? await act(() => api.updateTemplateItem(item.id, { ...input, version: item.version }), {
          subject: 'diese Vorlagenaufgabe',
          success: 'Gespeichert',
          onInvalid: setError,
        })
      : await act(() => api.createTemplateItem(template.id, input), {
          success: 'Aufgabe hinzugefügt',
          onInvalid: setError,
        });
    setSaving(false);
    if (ok) onClose();
  };

  const field =
    'h-11 rounded-xl border border-rand bg-grund px-3.5 font-sans text-[15px] text-text normal-case';
  return (
    <Sheet
      title={item ? 'Vorlagenaufgabe bearbeiten' : `Neue Aufgabe · ${template.name}`}
      onClose={onClose}
      wf={WF}
      closeButton
    >
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="label-mono flex flex-col gap-1.5">
          Baustein *
          <input
            type="text"
            data-wf={WF}
            list="vorlagen-bausteine"
            value={block}
            maxLength={60}
            onChange={(e) => setBlock(e.target.value)}
            className={field}
          />
          <datalist id="vorlagen-bausteine">
            {template.blocks.map((b) => (
              <option key={b.block} value={b.block} />
            ))}
          </datalist>
          <FieldError>{fieldError('block')}</FieldError>
        </label>
        <label className="label-mono flex flex-col gap-1.5">
          Titel *
          <input
            type="text"
            data-wf={WF}
            autoFocus={!item}
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            className={field}
          />
          <FieldError>{fieldError('title')}</FieldError>
        </label>
        <label className="label-mono flex flex-col gap-1.5">
          Frist: Tage zum Beginn * · negativ = vorher
          <input
            type="text"
            inputMode="numeric"
            data-wf={WF}
            value={offset}
            onChange={(e) => setOffset(e.target.value)}
            className={field}
          />
          <span className="text-[12px] text-leise normal-case">
            {Number.isInteger(days) && offset.trim() !== '' ? formatOffsetDays(days) : '—'}
          </span>
          <FieldError>{fieldError('offset_days')}</FieldError>
        </label>
        <div className="flex flex-col gap-1.5">
          <span className="label-mono">Priorität</span>
          <div role="group" aria-label="Priorität" className="flex gap-1.5">
            {PRIORITIES.map((p) => (
              <button
                key={p}
                type="button"
                data-wf={WF}
                aria-pressed={priority === p}
                onClick={() => setPriority(p)}
                className={cx(
                  'hit h-8 rounded-2xl border px-3 text-[13px]',
                  priority === p ? 'border-text bg-text font-semibold text-grund' : 'border-rand text-weich',
                )}
              >
                {PRIORITY_LABEL[p]}
              </button>
            ))}
          </div>
        </div>
        <TopicSelect value={topicId} onChange={setTopicId} wf={WF} />
        <label className="label-mono flex flex-col gap-1.5">
          Beschreibung
          <textarea
            data-wf={WF}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="min-h-[70px] rounded-xl border border-rand bg-grund px-3.5 py-2.5 font-sans text-[15px] leading-normal text-text normal-case"
          />
        </label>
        <FieldError>
          {error &&
            !['block', 'title', 'offset_days', 'topic_id'].includes(error.field ?? '') &&
            error.message}
        </FieldError>
        <LightButton type="submit" data-wf={WF} disabled={!!missing || saving}>
          {missing ?? 'Speichern'}
        </LightButton>
        {item && (
          <GhostButton
            data-wf={WF}
            onClick={() => {
              // endgültig entfernen erst nach einem zweiten Tipp (7.3)
              if (!armed) return setArmed(true);
              onClose();
              void act(() => api.removeTemplateItem(item.id), { success: 'Aus der Vorlage entfernt' });
            }}
          >
            {armed ? 'Wirklich aus der Vorlage entfernen?' : 'Aus der Vorlage entfernen'}
          </GhostButton>
        )}
      </form>
    </Sheet>
  );
}
