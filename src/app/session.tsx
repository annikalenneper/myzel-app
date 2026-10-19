import { createContext, useContext, type ReactNode } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { api } from '../data';
import type { Session } from '../data/api';
import type { Member } from '../shared/schema';
import { LoadError } from '../ui/bits';
import { useData } from './useData';

const SessionContext = createContext<Session | undefined>(undefined);
const MemberContext = createContext<Member | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const { data, error, reload } = useData('session', () => api.getSession());
  if (!data && error)
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <LoadError message="Myzel ist gerade nicht erreichbar." onRetry={reload} />
      </div>
    );
  return <SessionContext.Provider value={data}>{children}</SessionContext.Provider>;
}

/** `undefined`, solange die Sitzung noch geprüft wird */
export function useSession(): Session | undefined {
  return useContext(SessionContext);
}

/** Das eingeloggte Mitglied; nur innerhalb von <RequireMember> */
export function useMe(): Member {
  const member = useContext(MemberContext);
  if (!member) throw new Error('useMe außerhalb des Mitgliederbereichs');
  return member;
}

export function Splash() {
  return (
    <div className="flex min-h-dvh items-center justify-center" aria-busy="true" aria-label="Myzel lädt">
      <img src="/myzel-logo.png" alt="" className="h-[60px] w-[90px] object-contain opacity-70" />
    </div>
  );
}

/** Nur aktive Mitglieder kommen rein; alle anderen sehen S-01 bzw. S-02 und keine Daten. */
export function RequireMember() {
  const session = useSession();
  if (!session) return <Splash />;
  if (session.state === 'anonymous') return <Navigate to="/anmelden" replace />;
  if (session.state === 'no_access') return <Navigate to="/kein-zugriff" replace />;
  return (
    <MemberContext.Provider value={session.member}>
      <Outlet />
    </MemberContext.Provider>
  );
}

export function RequireAdmin() {
  const me = useMe();
  return me.is_admin ? <Outlet /> : <Navigate to="/profil" replace />;
}
