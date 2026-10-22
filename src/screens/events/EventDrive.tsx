// WF-VER-14 Drive-Ordner der Veranstaltung · P5 (F-VER-03): wählen, Inhalt aus dem Cache ansehen, entfernen
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useActions, useLatest } from '../../app/useActions';
import { useData } from '../../app/useData';
import { useNow } from '../../app/useNow';
import { api } from '../../data';
import type { EventDetail } from '../../data/api';
import { LightButton } from '../../ui/bits';
import { IconFolder } from '../../ui/icons';
import { Sheet } from '../../ui/Sheet';
import { DriveBrowser, DriveIcon, entryMeta, useDriveSync } from '../knowledge/Drive';

const WF = 'WF-VER-14';
/** so viele Einträge zeigt das Detail; der Rest im Drive-Reiter */
const SHOWN = 6;

export function EventDriveFolder({ event }: { event: EventDetail }) {
  const act = useActions();
  const latest = useLatest(event.version);
  const now = useNow();
  const [picking, setPicking] = useState(false);
  const folder = event.drive_folder;
  // ohne Ordner nur, wenn jemand einen wählt
  useDriveSync(!!folder || picking);

  const save = (folderId: string | null) =>
    act(() => api.setEventDriveFolder(event.id, folderId, latest.current), {
      subject: 'diese Veranstaltung',
      success: folderId ? 'Drive-Ordner verknüpft' : 'Verknüpfung entfernt',
    });

  return (
    <>
      {folder ? (
        <section
          data-wf={WF}
          aria-label="Drive-Ordner"
          className="flex flex-col overflow-hidden rounded-2xl border border-linie bg-flaeche"
        >
          <div className="flex min-h-[54px] items-center gap-2.5 border-b border-erhoeht pr-1.5 pl-3.5">
            <IconFolder className="flex-none text-violett" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="label-mono">Drive-Ordner</span>
              {folder.missing ? (
                <span className="truncate text-[15px] font-medium text-weich">{folder.name}</span>
              ) : (
                <Link
                  data-wf={WF}
                  to={`/wissen/drive/${folder.file_id}`}
                  className="truncate text-[15px] font-medium text-text no-underline"
                >
                  {folder.name} ›
                </Link>
              )}
            </span>
            <button
              type="button"
              data-wf={WF}
              onClick={() => setPicking(true)}
              className="hit h-8 px-2 text-[13px] text-leise"
            >
              Ändern
            </button>
            <button
              type="button"
              data-wf={WF}
              onClick={() => void save(null)}
              className="hit h-8 px-2 text-[13px] text-leise"
            >
              Entfernen
            </button>
          </div>
          {folder.missing ? (
            <span className="px-3.5 py-3 font-mono text-[11px] text-bernstein uppercase">
              In Drive nicht mehr vorhanden
            </span>
          ) : folder.entries.length === 0 ? (
            <span className="px-3.5 py-3 text-[14px] text-leise">Der Ordner ist leer.</span>
          ) : (
            <ul className="m-0 flex list-none flex-col p-0">
              {folder.entries.slice(0, SHOWN).map((e) => {
                const body = (
                  <>
                    <DriveIcon kind={e.kind} />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-[14px]">
                        {e.name}
                        {e.kind !== 'ordner' && ' ↗'}
                      </span>
                      <span className="label-mono">
                        {entryMeta(e, now)}
                        {e.link_summary && ` · ${e.link_summary}`}
                      </span>
                    </span>
                  </>
                );
                const row =
                  'flex min-h-[52px] items-center gap-3 border-b border-erhoeht px-3.5 py-1.5 text-text no-underline';
                return (
                  <li key={e.file_id}>
                    {e.kind === 'ordner' ? (
                      <Link to={`/wissen/drive/${e.file_id}`} data-wf={WF} className={row}>
                        {body}
                      </Link>
                    ) : (
                      <a href={e.web_url} target="_blank" rel="noreferrer" data-wf={WF} className={row}>
                        {body}
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {!folder.missing && folder.entries.length > SHOWN && (
            <Link
              data-wf={WF}
              to={`/wissen/drive/${folder.file_id}`}
              className="hit flex min-h-11 items-center px-3.5 text-[13px] text-violett no-underline"
            >
              Alle {folder.entries.length} Einträge ansehen ›
            </Link>
          )}
        </section>
      ) : (
        <button
          type="button"
          data-wf={WF}
          onClick={() => setPicking(true)}
          className="flex h-[46px] items-center gap-2 rounded-[14px] border border-rand px-3.5 text-[14px] text-text"
        >
          <IconFolder size={18} className="text-leise" />+ Drive-Ordner wählen
        </button>
      )}
      {picking && (
        <FolderPickSheet
          start={folder && !folder.missing ? folder.file_id : null}
          onClose={() => setPicking(false)}
          onPick={(id) => {
            setPicking(false);
            if (id !== folder?.file_id || folder.missing) void save(id);
          }}
        />
      )}
    </>
  );
}

/** Ordner im Verzeichnis ansteuern; gewählt wird der gerade offene Ordner */
function FolderPickSheet({
  start,
  onClose,
  onPick,
}: {
  start: string | null;
  onClose: () => void;
  onPick: (folderId: string) => void;
}) {
  const [folderId, setFolderId] = useState<string | null>(start);
  const [query, setQuery] = useState('');
  const { data } = useData(`drive:${folderId ?? ''}`, () => api.getDriveFolder(folderId));
  return (
    <Sheet title="Drive-Ordner wählen" onClose={onClose} wf={WF} closeButton>
      <DriveBrowser
        wf={WF}
        mode="pick-folder"
        folderId={folderId}
        onFolder={setFolderId}
        query={query}
        onQuery={setQuery}
      />
      <LightButton
        type="button"
        data-wf={WF}
        disabled={!data}
        onClick={() => data && onPick(data.folder.file_id)}
      >
        {data ? `„${data.folder.name}“ wählen` : 'Ordner wählen'}
      </LightButton>
    </Sheet>
  );
}
