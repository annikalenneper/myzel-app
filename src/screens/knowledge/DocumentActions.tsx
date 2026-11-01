// Dokumente haben keine Detailansicht (U15): Drei-Punkte-Menü in der Liste mit „Zuordnen“ (WF-WIS-14), „Kategorie“
// (WF-WIS-15) und „Löschen“ (WF-ALL-09) – Verbesserungen, Nutzerin 31.10.2026.
import { useState } from 'react';
import { useActions } from '../../app/useActions';
import { useData } from '../../app/useData';
import { api } from '../../data';
import type { DocumentListItem, SearchGroupKey } from '../../data/api';
import { DOC_TYPE_LABEL } from '../../shared/rules/knowledge';
import { DOC_TYPES, type DocumentLinkTarget } from '../../shared/schema';
import { Sheet } from '../../ui/Sheet';
import { DeleteAction, useDeleteArtifact } from '../common/DeleteAction';

const GROUP_TARGET: Partial<Record<SearchGroupKey, [DocumentLinkTarget, string]>> = {
  aufgaben: ['task', 'Aufgabe'],
  events: ['event', 'Veranstaltung'],
  termine: ['appointment', 'Termin'],
  beschluesse: ['decision', 'Entscheidung'],
};

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
  const term = query.trim();
  const { data: hits } = useData(`ziel-suche:${term}`, () => api.search(term));
  const targets = (hits ?? []).flatMap((g) => {
    const map = GROUP_TARGET[g.key];
    return map ? g.items.map((i) => ({ type: map[0], kind: map[1], id: i.id, name: i.title })) : [];
  });
  return (
    <Sheet title={`Zuordnen: ${doc.title}`} onClose={onClose} wf="WF-WIS-14" closeButton>
      <span className="text-[14px] leading-normal text-weich">
        Verknüpft das Dokument mit einer Aufgabe, Veranstaltung, einem Termin oder einer Entscheidung. Jetzt:{' '}
        {doc.link_summary}.
      </span>
      <input
        type="search"
        autoFocus
        aria-label="Ziel suchen"
        placeholder="Aufgabe, Event, Termin, Entscheidung suchen …"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="h-11 rounded-xl border border-rand bg-grund px-3.5 text-[14px] text-text"
      />
      <div className="flex flex-col gap-1.5">
        {term &&
          targets.slice(0, 12).map((t) => (
            <button
              key={`${t.type}:${t.id}`}
              type="button"
              data-wf="WF-WIS-14"
              onClick={() => {
                onClose();
                void act(() => api.linkDocument(doc.id, t.type, t.id), {
                  success: `Dokument verknüpft · ${t.name}`,
                });
              }}
              className="flex min-h-11 flex-col items-start justify-center rounded-xl border border-linie bg-grund px-3 py-1.5 text-left"
            >
              <span className="label-mono">{t.kind}</span>
              <span className="text-[15px] text-text">{t.name}</span>
            </button>
          ))}
        {term && hits && targets.length === 0 && (
          <span className="text-[14px] text-leise">Nichts gefunden.</span>
        )}
      </div>
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
