// S-43 Dokument verknüpfen · P3 (WF-WIS-06, WF-AUF-13); Auswahl aus dem Drive-Verzeichnis P5 (WF-WIS-09).
// Phase 14 (Nutzerin, 11.11.2026): einheitlich – ein Suchfeld-Stil, eine Auswahlliste mit Markierung für Ziel, Dateien
// und erfasste Dokumente, Aktion unten immer sichtbar; „Aus Drive“ zuerst.
import { useState } from 'react';
import { useFeedback } from '../../app/feedback';
import { useData } from '../../app/useData';
import { api } from '../../data';
import type { DriveEntry } from '../../data/api';
import { DOC_TYPE_LABEL } from '../../shared/rules/knowledge';
import { DOC_TYPES, type DocType } from '../../shared/schema';
import { ChoiceList, ChoiceRow, cx, FieldError, LightButton, Pill, SearchField } from '../../ui/bits';
import { IconClose, IconFile } from '../../ui/icons';
import { useModal } from '../../ui/Sheet';
import { DriveBrowser, useDriveSync } from './Drive';
import { Segmented, TopicSelect } from './KnowledgeSheets';
import { TargetPicker, type LinkTarget } from './TargetPicker';

export type { LinkTarget } from './TargetPicker';

const WF = 'WF-WIS-06';
const field =
  'h-[46px] rounded-xl border border-rand bg-grund px-3.5 font-sans text-[16px] text-text normal-case';

type Tab = 'drive' | 'known' | 'link';

function TypePills({
  value,
  onChange,
  wf,
  required,
}: {
  value: DocType | null;
  onChange: (t: DocType | null) => void;
  wf: string;
  required?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className={cx('label-mono', required && !value && 'text-bernstein')}>
        Typ{required ? ' *' : ''}
      </span>
      <div role="group" aria-label="Typ" className="flex flex-wrap gap-2">
        {DOC_TYPES.map((t) => (
          <Pill
            key={t}
            size="sm"
            data-wf={wf}
            on={value === t}
            onClick={() => onChange(required && value === t ? null : t)}
          >
            {DOC_TYPE_LABEL[t]}
          </Pill>
        ))}
      </div>
    </div>
  );
}

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
  const [choosingTarget, setChoosingTarget] = useState(false);
  const [targetQuery, setTargetQuery] = useState('');
  const [tab, setTab] = useState<Tab>('drive');
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
  const needsTarget = tab === 'known' && !target;
  const hint = !ready
    ? tab === 'link'
      ? 'Link, Titel und Typ sind Pflicht.'
      : tab === 'known'
        ? 'Ein erfasstes Dokument wählen.'
        : 'Eine Datei wählen – der Eintrag entsteht beim Verknüpfen.'
    : needsTarget
      ? 'Erfasste Dokumente brauchen ein Ziel – oben wählen.'
      : target
        ? `Wird mit „${target.name}“ verknüpft und steht im Verlauf.`
        : 'Wird als Dokument erfasst und steht unter Wissen › Dokumente.';
  const q = query.trim().toLowerCase();
  const knownShown = (known ?? []).filter((d) => !q || d.title.toLowerCase().includes(q));

  const submit = async () => {
    if (!ready || needsTarget || saving) return;
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
            : api.linkDocument(picked!, link!.target_type, link!.target_id).then(() => true),
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
      <div className="flex h-[60px] flex-none items-center gap-1 border-b border-linie px-3">
        <button
          type="button"
          onClick={onClose}
          aria-label="Schließen"
          className="flex size-11 items-center justify-center text-text"
        >
          <IconClose />
        </button>
        <h2 className="m-0 text-[17px] font-semibold">Dokument verknüpfen</h2>
      </div>
      <form
        noValidate
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pt-4 pb-6">
          {/* Ziel der Verknüpfung: vorbelegt aus dem aufrufenden Screen, änderbar */}
          {choosingTarget ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="label-mono">Verknüpfen mit</span>
                <button
                  type="button"
                  onClick={() => setChoosingTarget(false)}
                  className="hit h-8 text-[13px] text-violett"
                >
                  Fertig
                </button>
              </div>
              <TargetPicker
                wf={wf}
                query={targetQuery}
                onQuery={setTargetQuery}
                selected={target}
                pinned={preset}
                allowNone
                autoFocus
                onPick={(t) => {
                  setTarget(t);
                  setChoosingTarget(false);
                }}
              />
            </div>
          ) : (
            <button
              type="button"
              data-wf={wf}
              onClick={() => setChoosingTarget(true)}
              className="flex min-h-[58px] items-center gap-3 rounded-2xl border border-linie bg-flaeche py-2 pr-3 pl-3.5 text-left text-text"
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="label-mono">
                  {target ? `Verknüpfen mit · ${target.kind}` : 'Nur erfassen'}
                </span>
                <span className="truncate text-[15px] font-medium">
                  {target ? target.name : 'Ohne Verknüpfung'}
                </span>
              </span>
              <span className="flex-none text-[13px] text-violett">Ändern</span>
            </button>
          )}

          <Segmented
            label="Herkunft"
            wf={wf}
            value={tab}
            onChange={(t) => {
              setTab(t);
              setError(null);
            }}
            options={[
              ['drive', 'Aus Drive'],
              ['known', 'Erfasste'],
              ['link', 'Per Link'],
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
                <TypePills value={fileType} onChange={(t) => t && setFileType(t)} wf="WF-WIS-09" />
              )}
            </>
          ) : tab === 'link' ? (
            <>
              <label className="label-mono flex flex-col gap-1.5">
                Link *
                <input
                  type="url"
                  data-wf={wf}
                  value={url}
                  placeholder="https://"
                  onChange={(e) => {
                    setUrl(e.target.value);
                    setError(null);
                  }}
                  className={field}
                />
              </label>
              <span className="-mt-2.5 text-[12px] text-leise">Drive oder jede andere Adresse.</span>
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
              <TypePills value={docType} onChange={setDocType} wf={wf} required />
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
              <SearchField
                wf={wf}
                label="Erfasste Dokumente durchsuchen"
                placeholder="Erfasste Dokumente durchsuchen …"
                value={query}
                onChange={setQuery}
              />
              {knownShown.length > 0 ? (
                <ChoiceList label="Erfasste Dokumente">
                  {knownShown.map((d) => (
                    <ChoiceRow
                      key={d.id}
                      wf={wf}
                      icon={<IconFile className="flex-none text-leise" />}
                      title={d.title}
                      meta={`${DOC_TYPE_LABEL[d.doc_type]} · ${d.link_summary}`}
                      extra={
                        d.drive_missing && (
                          <span className="font-mono text-[11px] text-bernstein uppercase">
                            In Drive nicht mehr vorhanden
                          </span>
                        )
                      }
                      selected={picked === d.id}
                      onClick={() => setPicked(picked === d.id ? null : d.id)}
                    />
                  ))}
                </ChoiceList>
              ) : (
                <span
                  data-wf="WF-ALL-05"
                  className="rounded-2xl border border-linie bg-flaeche p-4 text-[14px] text-leise"
                >
                  {q ? 'Kein passendes Dokument.' : 'Noch kein Dokument erfasst.'}
                </span>
              )}
            </>
          )}
          <FieldError>{error}</FieldError>
        </div>
        {/* Aktion unten fest – auch bei langen Drive-Listen sichtbar */}
        <div className="flex flex-none flex-col gap-2 border-t border-linie bg-nav px-5 pt-3 pb-[calc(16px+env(safe-area-inset-bottom,0px))]">
          <span
            className={cx(
              'text-[13px] leading-[1.4]',
              ready && !needsTarget ? 'text-leise' : 'text-bernstein',
            )}
          >
            {hint}
          </span>
          <LightButton type="submit" data-wf={wf} disabled={!ready || needsTarget || saving}>
            {target ? 'Verknüpfen' : 'Erfassen'}
          </LightButton>
        </div>
      </form>
    </div>
  );
}
