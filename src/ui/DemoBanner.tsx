// Hinweisband der Demo in der echten App: Testdaten nur in diesem Browser, nichts geht an den Server
import { demoInProduction, setDemo } from '../data';

export function DemoBanner() {
  if (!demoInProduction) return null;
  return (
    <div
      role="status"
      className="sticky top-0 z-50 flex min-h-11 items-center gap-3 border-b border-bernstein bg-grund px-4 py-1.5 text-[13px] text-bernstein"
    >
      <span className="min-w-0 flex-1">
        Demo mit Testdaten – nichts wird gespeichert, echte Daten sind hier nicht.
      </span>
      <button
        type="button"
        data-demo="end"
        onClick={() => setDemo(false)}
        className="hit h-9 flex-none rounded-[18px] border border-bernstein px-3 font-semibold"
      >
        Demo beenden
      </button>
    </div>
  );
}
