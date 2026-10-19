// S-43 Dokument verknüpfen · P3 (WF-WIS-06, WF-AUF-13); Auswahl aus dem Drive-Verzeichnis P5 (WF-WIS-09)
import { useState } from 'react';
import { useFeedback } from '../../app/feedback';
import { useData } from '../../app/useData';
import { api } from '../../data';
import type { DriveEntry, SearchGroupKey } from '../../data/api';
import { DOC_TYPE_LABEL } from '../../shared/rules/knowledge';
import { DOC_TYPES, type DocType, type DocumentLinkTarget } from '../../shared/schema';
import { cx, FieldError, LightButton, Pill } from '../../ui/bits';
import { IconClose } from '../../ui/icons';
import { useModal } from '../../ui/Sheet';
import { DriveBrowser, useDriveSync } from './Drive';
import { Segmented, TopicSelect } from './KnowledgeSheets';

export interface LinkTarget {
  type: DocumentLinkTarget;
  id: string;
  /** „Aufgabe“, „Veranstaltung“, „Termin“, „Entscheidung“ */
  kind: string;
  name: string;
}

const WF = 'WF-WIS-06';
const GROUP_TARGET: Partial<Record<SearchGroupKey, [DocumentLinkTarget, string]>> = {
  aufgaben: ['task', 'Aufgabe'],
  events: ['event', 'Veranstaltung'],
  termine: ['appointment', 'Termin'],
  beschluesse: ['decision', 'Entscheidung'],
};
const field =
  'h-[46px] rounded-xl border border-rand bg-grund px-3.5 font-sans text-[16px] text-text normal-case';

export function DocumentLinkScreen({
  target: preset,
  onClose,
  wf = WF,
  driveFile,
}: {
  /** vorbelegt aus dem aufrufenden Screen, änderbar; null = nur erfassen */
  target: LinkTarget | null;
  onClose: () => void;
  wf?: string;
  /** aus dem Drive-Verzeichnis aufgerufen: diese Datei ist gewählt (WF-WIS-09) */
  driveFile?: DriveEntry;
}) {
  const { run } = useFeedback();
  const { data: known } = useData('documents', () => api.listDocuments());
  const [target, setTarget] = useState<LinkTarget | null>(preset);
  const [targetsOpen, setTargetsOpen] = useState(false);
  const [targetQuery, setTargetQuery] = useState('');
  const { data: hits } = useData(`ziel-suche:${targetQuery.trim()}`, () => api.search(targetQuery));
  const [tab, setTab] = useState<'link' | 'known' | 'drive'>(driveFile ? 'drive' : 'link');
  const [driveFolder, setDriveFolder] = useState<string | null>(driveFile?.parent_id ?? null);
  const [driveQuery, setDriveQuery] = useState('');
  const [file, setFile] = useState<DriveEntry | null>(driveFile ?? null);
  const [fileType, setFileType] = useState<DocType>('sonstiges');
  useDriveSync();
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [docType, setDocType] = useState<DocType | null>(null);
  const [topicId, setTopicId] = useState('');
  const [tags, setTags] = useState('');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useModal(onClose);

  const ready =
    tab === 'link' ? !!url.trim() && !!title.trim() && !!docType : tab === 'known' ? !!picked : !!file;
  const hint = ready
    ? target
      ? 'Wird verknüpft und steht in der Historie.'
      : 'Wird als Dokument erfasst.'
    : tab === 'link'
      ? 'Link, Titel und Typ sind Pflicht.'
      : tab === 'known'
        ? 'Ein erfasstes Dokument wählen.'
        : 'Eine Datei wählen – der Eintrag entsteht beim Verknüpfen.';
  const q = query.trim().toLowerCase();
  const knownShown = (known ?? []).filter((d) => !q || d.title.toLowerCase().includes(q));
  const targetHits = (hits ?? []).flatMap((g) => {
    const map = GROUP_TARGET[g.key];
    return map ? g.items.map((i) => ({ type: map[0], kind: map[1], id: i.id, name: i.title })) : [];
  });

  const submit = async () => {
    if (!ready || saving) return;
    setSaving(true);
    setError(null);
    const link = target ? { target_type: target.type, target_id: target.id } : null;
    const ok = await run<true | string>(
      () =>
        tab === 'link'
          ? api
              .createDocument({
                title,
                url,
                doc_type: docType!,
                topic_id: topicId || null,
                tags: tags
                  .split(',')
                  .map((t) => t.trim())
                  .filter(Boolean),
                link,
              })
              // zu diesem Drive-Link gab es schon ein Dokument: Titel und Typ der Eingabe gelten nicht
              .then((r): true | string =>
                r.created ? true : (known?.find((d) => d.id === r.id)?.title ?? ''),
              )
          : tab === 'drive'
            ? api.linkDriveFile({ file_id: file!.file_id, doc_type: fileType, link }).then(() => true)
            : link
              ? api.linkDocument(picked!, link.target_type, link.target_id).then(() => true)
              : Promise.resolve(true),
      {
        success: (r) =>
          r !== true
            ? `Schon erfasst${r ? ` als „${r}“` : ''}${target ? ` · verknüpft mit ${target.name}` : ''}`
            : target
              ? `Dokument verknüpft · ${target.name}`
              : 'Dokument erfasst',
        onInvalid: (e) => setError(e.message),
      },
    );
    setSaving(false);
    if (ok !== undefined) onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Dokument verknüpfen"
      className="fixed inset-0 z-30 flex flex-col bg-grund lg:left-1/2 lg:w-[480px] lg:-translate-x-1/2 lg:border-x lg:border-linie"
    >
      <div className="flex h-[60px] flex-none items-center gap-1 px-3">
        <button
          type="button"
          onClick={onClose}
          aria-label="Schließen"
          className="flex size-11 items-center justify-center text-text"
        >
          <IconClose />
        </button>
        <span className="font-mono text-[13px] text-leise">DOKUMENT VERKNÜPFEN</span>
      </div>
      <form
        noValidate
        className="flex flex-1 flex-col gap-3.5 overflow-y-auto px-5 pb-6"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {/* Ziel der Verknüpfung: vorbelegt aus dem aufrufenden Screen, änderbar */}
        <button
          type="button"
          data-wf={wf}
          onClick={() => setTargetsOpen(!targetsOpen)}
          aria-expanded={targetsOpen}
          className="flex min-h-[60px] items-center gap-3 rounded-[14px] border border-linie bg-flaeche px-3.5 py-2.5 text-left text-text"
        >
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="label-mono">{target ? `Verknüpfen mit · ${target.kind}` : 'Nur erfassen'}</span>
            <span className="text-[15px] font-medium">
              {target ? target.name : 'Ohne Verknüpfung – erscheint unter Wissen › Dokumente'}
            </span>
          </span>
          <span className="text-leise">▾</span>
        </button>
        {targetsOpen && (
          <div className="flex flex-col gap-1.5 rounded-[14px] border border-rand bg-erhoeht p-2">
            <input
              type="search"
              data-wf={wf}
              aria-label="Ziel suchen"
              placeholder="Aufgabe, Veranstaltung, Termin oder Entscheidung suchen …"
              value={targetQuery}
              onChange={(e) => setTargetQuery(e.target.value)}
              className="h-11 rounded-xl border border-rand bg-grund px-3.5 text-[14px] text-text"
            />
            {[...(preset ? [preset] : []), ...targetHits.filter((t) => t.id !== preset?.id)]
              .slice(0, 6)
              .map((t) => (
                <button
                  key={`${t.type}:${t.id}`}
                  type="button"
                  data-wf={wf}
                  aria-pressed={target?.id === t.id}
                  onClick={() => {
                    setTarget(t);
                    setTargetsOpen(false);
                  }}
                  className="flex min-h-11 flex-col justify-center rounded-lg px-2.5 py-1 text-left text-text"
                >
                  <span className="label-mono">{t.kind}</span>
                  <span className="text-[14px]">{t.name}</span>
                </button>
              ))}
            <button
              type="button"
              data-wf={wf}
              aria-pressed={!target}
              onClick={() => {
                setTarget(null);
                setTargetsOpen(false);
              }}
              className="flex min-h-11 flex-col justify-center rounded-lg px-2.5 py-1 text-left text-text"
            >
              <span className="label-mono">Nur erfassen</span>
              <span className="text-[14px]">Ohne Verknüpfung</span>
            </button>
          </div>
        )}

        <Segmented
          label="Herkunft"
          wf={wf}
          value={tab}
          onChange={setTab}
          options={[
            ['link', 'Per Link'],
            ['known', 'Erfasste'],
            ['drive', 'Aus Drive'],
          ]}
        />

        {tab === 'drive' ? (
          <>
            <DriveBrowser
              wf="WF-WIS-09"
              mode="pick-file"
              folderId={driveFolder}
              onFolder={setDriveFolder}
              query={driveQuery}
              onQuery={setDriveQuery}
              selected={file?.file_id ?? null}
              onSelect={(e) => setFile(file?.file_id === e.file_id ? null : e)}
            />
            {/* ein schon erfasstes Dokument behält seinen Typ; neue bekommen ihn hier */}
            {file && !file.document_id && (
              <div className="flex flex-col gap-2">
                <span className="label-mono">Typ des neuen Eintrags</span>
                <div role="group" aria-label="Typ" className="flex flex-wrap gap-2">
                  {DOC_TYPES.map((t) => (
                    <Pill
                      key={t}
                      size="sm"
                      data-wf="WF-WIS-09"
                      on={fileType === t}
                      onClick={() => setFileType(t)}
                    >
                      {DOC_TYPE_LABEL[t]}
                    </Pill>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : tab === 'link' ? (
          <>
            <label className="label-mono flex flex-col gap-1.5">
              Link *
              <input
                type="url"
                data-wf={wf}
                autoFocus
                value={url}
                placeholder="https://"
                onChange={(e) => {
                  setUrl(e.target.value);
                  setError(null);
                }}
                className={field}
              />
            </label>
            <span className="-mt-2 text-[12px] text-leise">Drive oder jede andere Adresse.</span>
            <label className="label-mono flex flex-col gap-1.5">
              Titel *
              <input
                type="text"
                data-wf={wf}
                value={title}
                maxLength={200}
                onChange={(e) => setTitle(e.target.value)}
                className={field}
              />
            </label>
            <div className="flex flex-col gap-2">
              <span className={cx('label-mono', !docType && 'text-bernstein')}>Typ *</span>
              <div role="group" aria-label="Typ" className="flex flex-wrap gap-2">
                {DOC_TYPES.map((t) => (
                  <Pill
                    key={t}
                    size="sm"
                    data-wf={wf}
                    on={docType === t}
                    onClick={() => setDocType(docType === t ? null : t)}
                  >
                    {DOC_TYPE_LABEL[t]}
                  </Pill>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <TopicSelect value={topicId} onChange={setTopicId} wf={wf} label="Thema" />
              <label className="label-mono flex min-w-0 flex-col gap-1.5">
                Tags
                <input
                  type="text"
                  data-wf={wf}
                  value={tags}
                  placeholder="mit Komma"
                  onChange={(e) => setTags(e.target.value)}
                  className={cx(field, 'min-w-0 text-[15px]')}
                />
              </label>
            </div>
          </>
        ) : (
          <>
            <input
              type="search"
              data-wf={wf}
              aria-label="Erfasste Dokumente durchsuchen"
              placeholder="Erfasste Dokumente durchsuchen …"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-11 rounded-xl border border-rand bg-grund px-3.5 text-[14px] text-text"
            />
            <div className="flex flex-col overflow-hidden rounded-2xl border border-linie">
              {knownShown.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  role="radio"
                  aria-checked={picked === d.id}
                  data-wf={wf}
                  onClick={() => setPicked(picked === d.id ? null : d.id)}
                  className={cx(
                    'flex min-h-[56px] items-center gap-3 border-b border-erhoeht px-3.5 py-2 text-left text-text last:border-b-0',
                    picked === d.id ? 'bg-erhoeht' : 'bg-flaeche',
                  )}
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-[15px] font-medium">{d.title}</span>
                    <span className="label-mono">
                      {DOC_TYPE_LABEL[d.doc_type]} · {d.link_summary}
                    </span>
                    {d.drive_missing && (
                      <span className="font-mono text-[11px] text-bernstein uppercase">
                        In Drive nicht mehr vorhanden
                      </span>
                    )}
                  </span>
                  <span className="text-gruen">{picked === d.id ? '✓' : ''}</span>
                </button>
              ))}
              {knownShown.length === 0 && (
                <span data-wf="WF-ALL-05" className="bg-flaeche p-4 text-[14px] text-leise">
                  {q ? 'Kein passendes Dokument.' : 'Noch kein Dokument erfasst.'}
                </span>
              )}
            </div>
          </>
        )}
        <FieldError>{error}</FieldError>
        <span className="flex-1" />
        <span className={cx('text-[13px] leading-[1.4]', ready ? 'text-leise' : 'text-bernstein')}>
          {hint}
        </span>
        <LightButton type="submit" data-wf={wf} disabled={!ready || saving || (tab === 'known' && !target)}>
          {tab === 'known' && !target && ready
            ? 'Ziel wählen, dann verknüpfen'
            : target
              ? 'Verknüpfen'
              : 'Erfassen'}
        </LightButton>
      </form>
    </div>
  );
}
