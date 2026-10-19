// Verknüpfte Dokumente an Aufgabe, Entscheidung, Veranstaltung oder Termin (WF-AUF-13, WF-WIS-06, F-WIS-05):
// lösen einzeln, verknüpfen über S-43 – per Link, aus den Erfassten oder aus dem Drive.
import { useState } from 'react';
import { useActions } from '../../app/useActions';
import { api } from '../../data';
import type { DocumentListItem } from '../../data/api';
import { DocumentLinkScreen, type LinkTarget } from './DocumentLinkScreen';

/** „In Drive nicht mehr vorhanden“ (3.13) – der Eintrag bleibt sichtbar */
export function DriveMissing({ doc }: { doc: Pick<DocumentListItem, 'drive_missing'> }) {
  return doc.drive_missing ? (
    <span className="font-mono text-[11px] text-bernstein uppercase">In Drive nicht mehr vorhanden</span>
  ) : null;
}

export function LinkedDocuments({
  wf,
  target,
  documents,
}: {
  wf: string;
  target: LinkTarget;
  documents: DocumentListItem[] | undefined;
}) {
  const act = useActions();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <span className="label-mono">Dokumente</span>
      {(documents ?? []).map((doc) => (
        <div
          key={doc.id}
          className="flex items-center gap-1 rounded-xl border border-linie bg-flaeche pr-1 pl-3"
        >
          <a
            href={doc.url}
            target="_blank"
            rel="noreferrer"
            className="flex min-h-11 flex-1 flex-col justify-center py-1 text-[14px] text-text no-underline"
          >
            <span>{doc.title} ↗</span>
            <DriveMissing doc={doc} />
          </a>
          <button
            type="button"
            data-wf={wf}
            aria-label={`Verknüpfung lösen: ${doc.title}`}
            onClick={() =>
              void act(() => api.unlinkDocument(doc.id, target.type, target.id), {
                success: 'Verknüpfung gelöst',
              })
            }
            className="hit size-7 flex-none rounded-full text-[16px] text-leise"
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        data-wf={wf}
        onClick={() => setOpen(true)}
        className="flex h-11 items-center justify-center rounded-xl border border-dashed border-rand-stark text-[14px] text-leise"
      >
        + Dokument verknüpfen
      </button>
      {open && <DocumentLinkScreen wf={wf} target={target} onClose={() => setOpen(false)} />}
    </div>
  );
}
