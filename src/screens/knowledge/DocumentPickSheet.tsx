// Ein erfasstes Dokument auswählen – z. B. Protokoll eines Plenums (WF-PLE-03) oder Schichtplan (WF-VER-11).
// Neue Dokumente werden vorher unter Wissen › Dokumente per Link erfasst (Annahme A33).
import { useState } from 'react';
import { useData } from '../../app/useData';
import { api } from '../../data';
import { DOC_TYPE_LABEL } from '../../shared/rules/knowledge';
import type { DocType } from '../../shared/schema';
import { Sheet } from '../../ui/Sheet';

export function DocumentPickSheet({
  title,
  wf,
  preferType,
  onClose,
  onPick,
}: {
  title: string;
  wf: string;
  /** diese Art steht oben, z. B. Protokolle oder Schichtpläne */
  preferType: DocType;
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  const { data: docs } = useData('documents', () => api.listDocuments());
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = (docs ?? [])
    .filter((d) => !q || d.title.toLowerCase().includes(q))
    .sort((a, b) => Number(b.doc_type === preferType) - Number(a.doc_type === preferType))
    .slice(0, 12);
  return (
    <Sheet title={title} onClose={onClose} wf={wf} closeButton>
      <input
        type="search"
        aria-label="Dokument suchen"
        placeholder="Dokument suchen …"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="h-11 rounded-xl border border-rand bg-grund px-3.5 text-[14px] text-text"
      />
      <div className="flex flex-col gap-1.5">
        {shown.map((d) => (
          <button
            key={d.id}
            type="button"
            data-wf={wf}
            onClick={() => onPick(d.id)}
            className="flex min-h-11 items-center gap-2.5 rounded-xl border border-linie bg-grund px-3 py-1.5 text-left text-[14px] text-text"
          >
            <span className="flex-1">{d.title}</span>
            <span className="label-mono">{DOC_TYPE_LABEL[d.doc_type]}</span>
          </button>
        ))}
        {docs && shown.length === 0 && <span className="text-[13px] text-leise">Nichts gefunden.</span>}
      </div>
      <span className="text-[12px] leading-[1.4] text-leise">
        Neue Dokumente erfasst du unter Wissen › Dokumente per Link.
      </span>
    </Sheet>
  );
}
