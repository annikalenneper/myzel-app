// Quelle einer Entscheidung oder eines Fakts: Plenum, Dokument oder Notiz – mindestens eine (3.8)
import { useState } from 'react';
import { useData } from '../../app/useData';
import { api } from '../../data';
import { formatDayMonth } from '../../shared/format';
import { Pill } from '../../ui/bits';

export interface SourceValue {
  plenumId: string | null;
  documentId: string | null;
  note: string | null;
}

export const EMPTY_SOURCE: SourceValue = { plenumId: null, documentId: null, note: null };
export const sourceReady = (s: SourceValue) => !!(s.plenumId || s.documentId || s.note?.trim());

export function SourceFields({
  value,
  onChange,
  wf,
  kinds = ['plenum', 'dokument', 'notiz'],
}: {
  value: SourceValue;
  onChange: (next: SourceValue) => void;
  wf: string;
  /** außerhalb des Plenums geklärte Fragen: nur Notiz oder Dokument (WF-FRA-02) */
  kinds?: ('plenum' | 'dokument' | 'notiz')[];
}) {
  const { data: appointments } = useData('appointments', () => api.listAppointments());
  const { data: documents } = useData('documents', () => api.listDocuments());
  const plena = (appointments ?? [])
    .filter((a) => a.is_plenum && a.status !== 'abgesagt')
    .sort((a, b) => b.starts_at.localeCompare(a.starts_at));
  const [now] = useState(() => Date.now());
  const firstPlenum = plena.find((a) => new Date(a.starts_at).getTime() <= now) ?? plena[0];
  const field = 'h-11 rounded-xl border border-rand bg-grund px-3.5 text-[14px] text-text';

  return (
    <>
      <div role="group" aria-label="Quelle" className="flex flex-wrap gap-2">
        {kinds.includes('plenum') && (
          <Pill
            size="sm"
            data-wf={wf}
            on={value.plenumId !== null}
            onClick={() =>
              onChange({ ...value, plenumId: value.plenumId !== null ? null : (firstPlenum?.id ?? null) })
            }
          >
            Plenum
          </Pill>
        )}
        {kinds.includes('dokument') && (
          <Pill
            size="sm"
            data-wf={wf}
            on={value.documentId !== null}
            onClick={() =>
              onChange({
                ...value,
                documentId: value.documentId !== null ? null : (documents?.[0]?.id ?? null),
              })
            }
          >
            Dokument
          </Pill>
        )}
        {kinds.includes('notiz') && (
          <Pill
            size="sm"
            data-wf={wf}
            on={value.note !== null}
            onClick={() => onChange({ ...value, note: value.note !== null ? null : '' })}
          >
            Notiz
          </Pill>
        )}
      </div>
      {value.plenumId !== null && (
        <select
          data-wf={wf}
          aria-label="Plenum als Quelle"
          value={value.plenumId}
          onChange={(e) => onChange({ ...value, plenumId: e.target.value })}
          className={field}
        >
          {plena.map((a) => (
            <option key={a.id} value={a.id}>
              {a.title} ({formatDayMonth(new Date(a.starts_at))})
            </option>
          ))}
        </select>
      )}
      {value.documentId !== null && (
        <select
          data-wf={wf}
          aria-label="Dokument als Quelle"
          value={value.documentId}
          onChange={(e) => onChange({ ...value, documentId: e.target.value })}
          className={field}
        >
          {(documents ?? []).map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
            </option>
          ))}
        </select>
      )}
      {kinds.includes('dokument') && value.documentId === null && documents?.length === 0 && (
        <span className="text-[12px] leading-[1.4] text-leise">
          Noch kein Dokument erfasst – unter Wissen › Dokumente per Link anlegen.
        </span>
      )}
      {value.note !== null && (
        <input
          type="text"
          data-wf={wf}
          aria-label="Notiz zur Quelle"
          placeholder="Kurze Notiz, woher das stammt"
          value={value.note}
          maxLength={500}
          onChange={(e) => onChange({ ...value, note: e.target.value })}
          className={field}
        />
      )}
    </>
  );
}
