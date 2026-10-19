// S-02 Kein Zugriff · P1 – Ergebnis von WF-LOG-01, wenn die Mail keinem aktiven Mitglied gehört
import { Navigate } from 'react-router-dom';
import { useFeedback } from '../app/feedback';
import { Splash, useSession } from '../app/session';
import { api } from '../data';

export function NoAccess() {
  const session = useSession();
  const { run } = useFeedback();
  if (!session) return <Splash />;
  if (session.state === 'anonymous') return <Navigate to="/anmelden" replace />;
  if (session.state === 'member') return <Navigate to="/aufgaben" replace />;

  return (
    <div className="mx-auto flex min-h-dvh max-w-[480px] flex-col">
      <div className="flex flex-col gap-4 px-7 pt-40">
        <img src="/myzel-logo.png" alt="Myzel" className="h-[60px] w-[90px] object-contain" />
        <h1 className="m-0 text-[30px] leading-[1.15] font-bold tracking-[-1px]">Du bist noch nicht dabei</h1>
        <p className="m-0 text-[16px] leading-[1.55] text-weich">
          Mit <span className="font-mono text-[14px] break-all text-text">{session.email}</span> ist kein
          aktives Mitglied eingetragen. Myzel ist nur für das Kollektiv.
        </p>
        <p className="m-0 text-[16px] leading-[1.55] text-weich">
          Wenn du dazugehörst: Sag einer Person mit Admin-Rechten Bescheid, welche Google-Mail du nutzt.
        </p>
      </div>
      <div className="mt-auto px-7 pt-10 pb-10">
        <button
          type="button"
          data-wf="WF-LOG-03"
          onClick={() => void run(() => api.signOut())}
          className="flex h-[52px] w-full items-center justify-center rounded-[26px] border border-rand-stark text-[15px] font-semibold text-text"
        >
          Mit anderem Konto anmelden
        </button>
      </div>
    </div>
  );
}
