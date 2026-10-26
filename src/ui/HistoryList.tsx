// Verlauf einer Detailansicht (3.10, 16.3): Zeit und ein Satz je Eintrag, neuester zuerst.
import { formatHistoryTime } from '../shared/format';
import type { HistoryEntry } from '../shared/schema';

export function HistoryList({
  entries,
  sentence,
}: {
  entries: HistoryEntry[];
  sentence: (entry: HistoryEntry) => string;
}) {
  return (
    <section aria-label="Verlauf" className="flex flex-col gap-2">
      <span className="label-mono">Verlauf</span>
      <div className="flex flex-col">
        {entries.map((h) => (
          <div key={h.id} className="flex gap-3 border-b border-erhoeht py-2.5 last:border-b-0">
            <span className="w-[88px] flex-none font-mono text-[11px] leading-[20px] whitespace-nowrap text-leise">
              {formatHistoryTime(h.created_at)}
            </span>
            <span className="text-[14px] leading-[1.4] text-weich">{sentence(h)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
