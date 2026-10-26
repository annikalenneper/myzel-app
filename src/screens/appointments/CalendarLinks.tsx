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
    <div className="flex flex-wrap gap-x-5">
      <a
        href={googleCalendarUrl(a, appLink)}
        target="_blank"
        rel="noreferrer"
        data-wf="WF-TER-11"
        className="hit flex min-h-8 items-center text-[14px] text-text"
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
        className="hit flex min-h-8 items-center text-left text-[14px] text-text underline"
      >
        .ics herunterladen
      </button>
    </div>
  );
}

/** „Zum Call ↗“ als Knopf (Phase 9); fehlt der Link noch, steht darunter ein Hinweis */
export function CallButton({ url }: { url: string | null }) {
  if (url)
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        data-wf="WF-TER-03"
        className="flex h-11 items-center justify-center gap-2 rounded-[22px] bg-text text-[14px] font-semibold text-grund no-underline"
      >
        Zum Call ↗
      </a>
    );
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        data-wf="WF-TER-03"
        disabled
        className="flex h-11 items-center justify-center rounded-[22px] border border-rand text-[14px] text-leise"
      >
        Zum Call
      </button>
      <span className="text-center text-[13px] leading-[1.4] text-leise">
        Noch kein Link zur Besprechung hinterlegt – über „Bearbeiten“ ergänzen.
      </span>
    </div>
  );
}
