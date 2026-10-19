// Drive-Verzeichnis · P5 (F-WIS-04, F-WIS-08, WF-WIS-08 bis -10): Ordner, Pfad, Suche, „Zuletzt geändert“.
// Die Anzeige kommt sofort aus dem Cache; beim Öffnen gleicht der Server im Hintergrund ab (3.13).
import { useEffect, useState } from 'react';
import { useFeedback } from '../../app/feedback';
import { useData } from '../../app/useData';
import { useNow } from '../../app/useNow';
import { api } from '../../data';
import type { DriveEntry } from '../../data/api';
import { formatAgo, formatDayMonth } from '../../shared/format';
import { DRIVE_KIND_LABEL, type DriveKind } from '../../shared/rules/drive';
import { daysUntil, toIsoDate } from '../../shared/rules/due';
import { cx, ListSkeleton, LoadError } from '../../ui/bits';
import { IconFile, IconFolder, IconLink } from '../../ui/icons';

/** Farbe je Dateiart wie im Prototyp: Tabellen grün, Dokumente blau, PDFs rot */
const KIND_COLOR: Record<DriveKind, string> = {
  ordner: 'text-violett',
  dokument: 'text-blau',
  tabelle: 'text-gruen',
  praesentation: 'text-bernstein',
  pdf: 'text-rot-hell',
  bild: 'text-pink',
  datei: 'text-leise',
};

/** Abgleich im Hintergrund beim Öffnen – der Server fragt höchstens einmal pro Minute bei Drive nach */
export function useDriveSync(): void {
  useEffect(() => {
    void api.syncDrive().catch(() => {
      // ohne Abgleich bleibt der Cache sichtbar; „abgeglichen vor …“ zeigt, wie alt er ist
    });
  }, []);
}

export function DriveIcon({ kind }: { kind: DriveKind }) {
  return kind === 'ordner' ? (
    <IconFolder className={cx('flex-none', KIND_COLOR.ordner)} />
  ) : (
    <IconFile className={cx('flex-none', KIND_COLOR[kind])} />
  );
}

function modifiedText(iso: string, now: Date): string {
  const days = daysUntil(toIsoDate(now), toIsoDate(new Date(iso)));
  if (days === 0) return 'geändert heute';
  if (days === 1) return 'geändert gestern';
  return formatDayMonth(new Date(iso));
}

export function entryMeta(e: DriveEntry, now: Date, withPath = false): string {
  const main =
    e.kind === 'ordner'
      ? `Ordner · ${e.child_count} ${e.child_count === 1 ? 'Eintrag' : 'Einträge'}`
      : `${DRIVE_KIND_LABEL[e.kind]} · ${modifiedText(e.modified_time, now)}`;
  return withPath && e.path ? `${main} · ${e.path}` : main;
}

export type DriveMode = 'browse' | 'pick-file' | 'pick-folder';

/**
 * Ordnerinhalt, Suche und „Zuletzt geändert“ in einem. browse: Dateien öffnen in Drive, daneben „Verknüpfen“;
 * pick-file: Antippen wählt eine Datei; pick-folder: nur Ordner, der aktuelle Ordner ist die Auswahl.
 */
export function DriveBrowser({
  wf,
  mode,
  folderId,
  onFolder,
  query,
  onQuery,
  selected,
  onSelect,
  onLink,
}: {
  wf: string;
  mode: DriveMode;
  folderId: string | null;
  onFolder: (id: string | null) => void;
  query: string;
  onQuery: (q: string) => void;
  selected?: string | null;
  onSelect?: (e: DriveEntry) => void;
  onLink?: (e: DriveEntry) => void;
}) {
  const { run } = useFeedback();
  const now = useNow();
  const [recent, setRecent] = useState(false);
  const term = query.trim();
  const searching = term.length >= 2;
  const folder = useData(`drive:${folderId ?? ''}`, () => api.getDriveFolder(folderId));
  const hits = useData(`drive-suche:${searching ? term : ''}`, () => api.searchDrive(term));
  const latest = useData(`drive-zuletzt:${recent ? 1 : 0}`, () =>
    recent ? api.recentDrive() : Promise.resolve([]),
  );
  const flat = searching || recent;
  const entries = searching ? hits.data : recent ? latest.data : folder.data?.entries;
  const shown = (entries ?? []).filter((e) => mode !== 'pick-folder' || e.kind === 'ordner');

  if (folder.error && !folder.data)
    return folder.error.code === 'not_found' ? (
      <div data-wf="WF-ALL-05" className="flex flex-col items-center gap-3 py-8 text-center">
        <span className="text-[14px] text-leise">Diesen Ordner gibt es im Drive nicht mehr.</span>
        <button type="button" onClick={() => onFolder(null)} className="hit text-[14px] text-pink">
          Zum Hauptordner
        </button>
      </div>
    ) : (
      <LoadError message={folder.error.message} onRetry={folder.reload} />
    );

  const sync = folder.data?.sync;
  const listError = searching ? hits.error : recent ? latest.error : null;
  return (
    <div data-wf={wf} className="flex flex-col gap-2.5">
      {/* Pfad oben – jedes Stück führt zurück */}
      {!flat && folder.data && (
        <nav aria-label="Ordnerpfad" className="flex flex-wrap items-center gap-x-1 font-mono text-[12px]">
          {folder.data.path.map((p, i) => {
            const last = i === folder.data!.path.length - 1;
            return (
              <span key={p.file_id} className="flex items-center gap-1">
                {i > 0 && <span className="text-rand-stark">/</span>}
                {last ? (
                  <span aria-current="page" className="text-text uppercase">
                    {p.name}
                  </span>
                ) : (
                  <button
                    type="button"
                    data-wf={wf}
                    onClick={() => onFolder(i === 0 ? null : p.file_id)}
                    className="hit min-h-8 text-leise uppercase"
                  >
                    {p.name}
                  </button>
                )}
              </span>
            );
          })}
        </nav>
      )}
      <div className="flex gap-2">
        <input
          type="search"
          data-wf={wf}
          aria-label="Im Drive suchen"
          placeholder="Im Drive suchen …"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          className="h-11 min-w-0 flex-1 rounded-[22px] border border-rand bg-flaeche px-4 text-[15px] text-text"
        />
        {mode !== 'pick-folder' && (
          <button
            type="button"
            data-wf={wf}
            aria-pressed={recent}
            onClick={() => setRecent(!recent)}
            className={cx(
              'hit h-11 flex-none rounded-[22px] border px-3.5 font-mono text-[11px]',
              recent ? 'border-text bg-text text-grund' : 'border-rand text-weich',
            )}
          >
            ZULETZT
          </button>
        )}
      </div>
      {flat && (
        <span className="label-mono" role="status">
          {searching
            ? entries
              ? `${shown.length} Treffer für „${term}“`
              : 'Suche …'
            : 'Zuletzt geändert · neueste zuerst'}
        </span>
      )}

      {listError && !entries ? (
        <LoadError message={listError.message} onRetry={searching ? hits.reload : latest.reload} />
      ) : !entries ? (
        <ListSkeleton />
      ) : shown.length === 0 ? (
        <span
          data-wf="WF-ALL-05"
          className="rounded-2xl border border-linie bg-flaeche p-4 text-[14px] text-leise"
        >
          {searching
            ? 'Keine Datei mit diesem Namen.'
            : mode === 'pick-folder'
              ? 'Keine Unterordner.'
              : 'Dieser Ordner ist leer.'}
        </span>
      ) : (
        <ul
          aria-label="Drive-Inhalt"
          className="m-0 flex list-none flex-col overflow-hidden rounded-2xl border border-linie p-0"
        >
          {shown.map((e) => (
            <DriveRow
              key={e.file_id}
              e={e}
              wf={wf}
              mode={mode}
              meta={entryMeta(e, now, flat)}
              selected={selected === e.file_id}
              onFolder={() => {
                onQuery('');
                setRecent(false);
                onFolder(e.file_id);
              }}
              onSelect={() => onSelect?.(e)}
              onLink={onLink && (() => onLink(e))}
            />
          ))}
        </ul>
      )}

      {/* „abgeglichen vor …“ und WF-WIS-10 „Neu einlesen“ */}
      {mode === 'browse' && sync && (
        <div className="flex items-center justify-between gap-2 font-mono text-[11px] text-leise">
          <span>
            ABGEGLICHEN{' '}
            {sync.last_checked_at ? formatAgo(sync.last_checked_at, now).toUpperCase() : 'NOCH NIE'}
          </span>
          <button
            type="button"
            data-wf="WF-WIS-10"
            onClick={() =>
              void run(() => api.rebuildDrive(), {
                success: (r) => `Neu eingelesen · ${r.count} Einträge`,
              })
            }
            className="hit h-11 text-violett"
          >
            NEU EINLESEN
          </button>
        </div>
      )}
    </div>
  );
}

function DriveRow({
  e,
  wf,
  mode,
  meta,
  selected,
  onFolder,
  onSelect,
  onLink,
}: {
  e: DriveEntry;
  wf: string;
  mode: DriveMode;
  meta: string;
  selected: boolean;
  onFolder: () => void;
  onSelect: () => void;
  onLink?: () => void;
}) {
  const body = (
    <>
      <DriveIcon kind={e.kind} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[15px] font-medium">
          {e.name}
          {e.kind !== 'ordner' && mode === 'browse' && ' ↗'}
        </span>
        <span className="label-mono">{meta}</span>
      </span>
    </>
  );
  const rowClass =
    'flex min-h-[58px] min-w-0 flex-1 items-center gap-3 py-1.5 pl-3.5 text-left text-text no-underline';
  return (
    <li
      className={cx(
        'flex items-center gap-1 border-b border-erhoeht pr-1.5 last:border-b-0',
        selected ? 'bg-erhoeht' : 'bg-flaeche',
      )}
    >
      {e.kind === 'ordner' ? (
        <button type="button" data-wf={wf} onClick={onFolder} className={rowClass}>
          {body}
        </button>
      ) : mode === 'pick-file' ? (
        <button
          type="button"
          role="radio"
          aria-checked={selected}
          data-wf={wf}
          onClick={onSelect}
          className={rowClass}
        >
          {body}
        </button>
      ) : (
        // Tippen öffnet die Datei in Drive – mit den normalen Rechten der Person
        <a href={e.web_url} target="_blank" rel="noreferrer" data-wf={wf} className={rowClass}>
          {body}
        </a>
      )}
      {e.link_summary && (
        <span className="flex-none rounded-full bg-erhoeht px-2 py-0.5 font-mono text-[10px] text-geplant uppercase">
          {e.link_summary}
        </span>
      )}
      {mode === 'pick-file' && selected && <span className="flex-none px-2 text-gruen">✓</span>}
      {onLink && e.kind !== 'ordner' && (
        <button
          type="button"
          data-wf="WF-WIS-09"
          onClick={onLink}
          aria-label={`Verknüpfen: ${e.name}`}
          className="flex size-11 flex-none items-center justify-center text-leise"
        >
          <IconLink />
        </button>
      )}
    </li>
  );
}
