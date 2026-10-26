// Termin in den eigenen Kalender übernehmen (16.5) – im Termin- und im Plenum-Detail
import type { AppointmentDetail } from '../../data/api';
import { googleCalendarUrl, icsFile, icsFileName } from '../../shared/rules/calendar';

/** WF-TER-11: Link „In Google Kalender eintragen“ und .ics-Datei für alle anderen Kalender */
export function CalendarLinks({ a }: { a: AppointmentDetail }) {
  const appLink = `${window.location.origin}/termine/${a.id}`;
  const download = () => {
    const url = URL.createObjectURL(new Blob([icsFile(a, appLink, new Date())], { type: 'text/calendar' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = icsFileName(a.title);
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
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
        onClick={download}
        className="hit h-10 rounded-[20px] border border-rand-stark px-4 text-[14px] text-text"
      >
        .ics herunterladen
      </button>
    </div>
  );
}
