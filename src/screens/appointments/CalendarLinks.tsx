// Termin in den eigenen Kalender übernehmen (16.5) – im Termin- und im Plenum-Detail
import type { AppointmentDetail } from '../../data/api';
import { googleCalendarUrl, icsFile, icsFileName } from '../../shared/rules/calendar';

/** Datei herunterladen – am Rechner öffnet sie der Kalender per Doppelklick */
function download(file: File): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Am Handy über „Teilen“: Dort bietet das System den Kalender an – ein Download landet in der installierten App nur in
 * den Dateien. Wo Teilen nicht geht oder scheitert, wird heruntergeladen; wer das Teilen abbricht, bekommt nichts.
 */
async function saveIcs(file: File): Promise<void> {
  const touch = window.matchMedia('(pointer: coarse)').matches;
  if (touch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
      return;
    } catch (e) {
      if ((e as { name?: string }).name === 'AbortError') return;
    }
  }
  download(file);
}

/** WF-TER-11: Link „In Google Kalender eintragen“ und .ics-Datei für alle anderen Kalender */
export function CalendarLinks({ a }: { a: AppointmentDetail }) {
  const appLink = `${window.location.origin}/termine/${a.id}`;
  return (
    <div className="flex flex-wrap gap-2">
      <a
        href={googleCalendarUrl(a, appLink)}
        target="_blank"
        rel="noreferrer"
        data-wf="WF-TER-11"
        className="hit flex h-10 items-center rounded-[20px] border border-rand-stark px-4 text-[14px] text-text no-underline"
      >
        In Google Kalender eintragen ↗
      </a>
      <button
        type="button"
        data-wf="WF-TER-11"
        onClick={() =>
          void saveIcs(
            new File([icsFile(a, appLink, new Date())], icsFileName(a.title), { type: 'text/calendar' }),
          )
        }
        className="hit h-10 rounded-[20px] border border-rand-stark px-4 text-[14px] text-text"
      >
        .ics herunterladen
      </button>
    </div>
  );
}
