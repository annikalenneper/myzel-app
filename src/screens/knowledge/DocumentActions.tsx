// Dokumente haben keine Detailansicht (U15): Drei-Punkte-Menü in der Liste mit „Zuordnen“ (WF-WIS-14), „Kategorie“
// (WF-WIS-15) und „Löschen“ (WF-ALL-09) – Verbesserungen, Nutzerin 31.10.2026.
import { useState } from 'react';
import { useActions } from '../../app/useActions';
import { api } from '../../data';
import type { DocumentListItem } from '../../data/api';
import { DOC_TYPE_LABEL } from '../../shared/rules/knowledge';
import { DOC_TYPES } from '../../shared/schema';
import { Sheet } from '../../ui/Sheet';
import { DeleteAction, useDeleteArtifact } from '../common/DeleteAction';
import { TargetPicker } from './TargetPicker';

export function DocumentMenu({ doc }: { doc: DocumentListItem }) {
  const remove = useDeleteArtifact('document', doc.id, () => doc.version, null);
  const [sheet, setSheet] = useState<'assign' | 'type' | null>(null);
  return (
    <>
      <DeleteAction
        noun="Dokument"
        consequence="Die Datei selbst bleibt im Drive bzw. an ihrer Adresse; Verknüpfungen verschwinden aus den Listen."
        items={[
          { label: 'Zuordnen …', wf: 'WF-WIS-14', onClick: () => setSheet('assign') },
          { label: 'Kategorie …', wf: 'WF-WIS-15', onClick: () => setSheet('type') },
        ]}
        onConfirm={() => void remove()}
      />
      {sheet === 'assign' && <AssignSheet doc={doc} onClose={() => setSheet(null)} />}
      {sheet === 'type' && <TypeSheet doc={doc} onClose={() => setSheet(null)} />}
    </>
  );
}

/** WF-WIS-14: mit einer Aufgabe, Veranstaltung, einem Termin oder einer Entscheidung verknüpfen */
function AssignSheet({ doc, onClose }: { doc: DocumentListItem; onClose: () => void }) {
  const act = useActions();
  const [query, setQuery] = useState('');
  return (
    <Sheet title={`Zuordnen: ${doc.title}`} onClose={onClose} wf="WF-WIS-14" closeButton>
      <span className="text-[14px] leading-normal text-weich">
        Verknüpft das Dokument mit einer Aufgabe, Veranstaltung, einem Termin oder einer Entscheidung. Jetzt:{' '}
        {doc.link_summary}.
      </span>
      <TargetPicker
        wf="WF-WIS-14"
        query={query}
        onQuery={setQuery}
        selected={null}
        limit={12}
        autoFocus
        onPick={(t) => {
          if (!t) return;
          onClose();
          void act(() => api.linkDocument(doc.id, t.type, t.id), {
            success: `Dokument verknüpft · ${t.name}`,
          });
        }}
      />
    </Sheet>
  );
}

/** WF-WIS-15: Kategorie (Art) wählen – gespeichert wird sofort, mit Rückgängig */
function TypeSheet({ doc, onClose }: { doc: DocumentListItem; onClose: () => void }) {
  const act = useActions();
  return (
    <Sheet title="Kategorie" onClose={onClose} wf="WF-WIS-15" closeButton>
      <div role="group" aria-label="Kategorie" className="flex flex-col gap-1.5">
        {DOC_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            data-wf="WF-WIS-15"
            aria-pressed={doc.doc_type === t}
            onClick={() => {
              onClose();
              if (t !== doc.doc_type)
                void act(() => api.setDocumentType(doc.id, t, doc.version), {
                  subject: 'dieses Dokument',
                  success: `Kategorie: ${DOC_TYPE_LABEL[t]}`,
                  undo: (r) => r.undo_token,
                });
            }}
            className={
              doc.doc_type === t
                ? 'flex min-h-11 items-center rounded-xl border border-text bg-text px-3 text-left text-[15px] font-semibold text-grund'
                : 'flex min-h-11 items-center rounded-xl border border-linie bg-grund px-3 text-left text-[15px] text-text'
            }
          >
            {DOC_TYPE_LABEL[t]}
          </button>
        ))}
      </div>
    </Sheet>
  );
}
