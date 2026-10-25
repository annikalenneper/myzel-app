// Hinweisband der Demo in der echten App: Testdaten nur in diesem Browser, nichts geht an den Server
import { api, demoInProduction, setDemo } from '../data';

export function DemoBanner() {
  if (!demoInProduction) return null;
  const reset = async () => {
    await api.demo?.reset?.();
    // neu laden, damit jede Ansicht den Ausgangsstand zeigt
    window.location.reload();
  };
  return (
    <div
      role="status"
      className="sticky top-0 z-50 flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-bernstein bg-grund px-4 py-1.5 text-[13px] text-bernstein"
    >
      <span className="min-w-[180px] flex-1">
        Demo mit Testdaten – Änderungen bleiben nur in diesem Browser, nichts geht an den Server.
      </span>
      <div className="flex flex-none gap-2">
        <button
          type="button"
          data-demo="reset"
          onClick={() => void reset()}
          className="hit h-9 rounded-[18px] border border-bernstein/60 px-3"
        >
          Zurücksetzen
        </button>
        <button
          type="button"
          data-demo="end"
          onClick={() => setDemo(false)}
          className="hit h-9 rounded-[18px] border border-bernstein px-3 font-semibold"
        >
          Demo beenden
        </button>
      </div>
    </div>
  );
}
