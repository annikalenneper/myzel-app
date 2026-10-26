// App-Gerüst (ANFORDERUNGEN 8.3): mobil untere Navigation, am Desktop eine Seitenleiste.
// Agenda (16.1), Events, Termine (ab P3), Wissen (ab P3), Profil.
import type { ReactNode } from 'react';
import { NavLink, Outlet, useMatch } from 'react-router-dom';
import { Avatar, cx } from '../ui/bits';
import { IconCalendar, IconEvents, IconKnowledge, IconProfile, IconTasks } from '../ui/icons';
import { CreateButton } from '../screens/common/CreateButton';
import { useMe } from './session';
import { ChangelogNotice } from './version';

const NAV: { to: string; label: string; icon: (p: { size?: number }) => ReactNode }[] = [
  { to: '/agenda', label: 'Agenda', icon: IconTasks },
  { to: '/events', label: 'Events', icon: IconEvents },
  { to: '/termine', label: 'Termine', icon: IconCalendar },
  { to: '/wissen', label: 'Wissen', icon: IconKnowledge },
  { to: '/profil', label: 'Profil', icon: IconProfile },
];

function BottomNav() {
  return (
    <nav
      aria-label="Hauptnavigation"
      className="fixed inset-x-0 bottom-0 z-20 grid h-[calc(76px+env(safe-area-inset-bottom,0px))] auto-cols-fr grid-flow-col border-t border-linie bg-nav pb-[calc(6px+env(safe-area-inset-bottom,0px))] font-mono lg:hidden"
    >
      {NAV.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            cx(
              'flex flex-col items-center justify-center gap-1 text-[10px] uppercase no-underline',
              isActive ? 'font-semibold text-text' : 'text-leise',
            )
          }
        >
          {({ isActive }) => (
            <>
              <Icon size={24} />
              {label}
              <span className={cx('h-[3px] w-5 rounded-sm', isActive && 'bg-marke-strich')} />
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

function Sidebar() {
  const me = useMe();
  // Partner gehören zu den Veranstaltungen und haben keine eigene Navigation (3.5)
  const partners = useMatch('/partner/*');
  return (
    <aside className="fixed inset-y-0 left-0 hidden w-[220px] flex-col gap-6 border-r border-linie bg-nav px-4 py-6 lg:flex">
      <img src="/myzel-logo.png" alt="Myzel" className="h-11 w-[66px] object-contain" />
      <nav aria-label="Hauptnavigation" className="flex flex-1 flex-col gap-1 font-mono">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cx(
                'flex h-11 items-center gap-3 rounded-xl px-3 text-[12px] uppercase no-underline',
                isActive || (to === '/events' && partners)
                  ? 'bg-erhoeht font-semibold text-text'
                  : 'text-leise hover:text-text',
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={22} />
                <span className="flex-1">{label}</span>
                <span
                  className={cx(
                    'h-5 w-[3px] rounded-sm',
                    (isActive || (to === '/events' && partners)) && 'bg-marke',
                  )}
                />
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <NavLink to="/profil" className="flex items-center gap-2.5 text-[14px] text-weich no-underline">
        <Avatar member={me} size={32} />
        {me.display_name}
      </NavLink>
    </aside>
  );
}

export function AppShell() {
  // Detailansichten haben mobil keine Navigation, sondern einen Zurück-Pfeil (8.3)
  const agendaDetail = useMatch('/agenda/:id');
  const agendaSubDetail = useMatch('/agenda/:kind/:id');
  const eventDetail = useMatch('/events/:id');
  const appointmentDetail = useMatch('/termine/:id');
  const knowledgeDetail = useMatch('/wissen/:kind/:id');
  const subPage = useMatch('/profil/:page');
  // im Profil gibt es nichts anzulegen – dort kein „+“ (auch nicht am Desktop)
  const profile = useMatch('/profil/*');
  // Partner (S-24) erreicht man aus der Veranstaltung – mit Zurück-Pfeil statt Navigation
  const partners = useMatch('/partner/*');
  const partnerList = useMatch('/partner');
  const detail =
    agendaDetail ||
    agendaSubDetail ||
    eventDetail ||
    appointmentDetail ||
    knowledgeDetail ||
    subPage ||
    partners;
  return (
    <div className="lg:pl-[220px]">
      <Sidebar />
      <Outlet />
      {!detail && <BottomNav />}
      {/* ein „+“ für alle Arten (Phase 5) – mobil nicht in Detailansichten, dort stehen unten eigene Leisten */}
      {!profile && <CreateButton navVisible={!detail} hidden={!!detail && !partnerList} />}
      {/* 16.5: nach einem neuen Deploy einmal „Was ist neu?“ */}
      <ChangelogNotice />
    </div>
  );
}

/** Zwei Spalten am Desktop: Liste und Detail nebeneinander; mobil jeweils eine Ansicht. */
export function ListDetailLayout({
  list,
  detail,
  detailOpen,
}: {
  list: ReactNode;
  detail: ReactNode;
  detailOpen: boolean;
}) {
  return (
    <div className="lg:grid lg:grid-cols-[400px_minmax(0,1fr)] xl:grid-cols-[440px_minmax(0,1fr)] 2xl:grid-cols-[500px_minmax(0,1fr)]">
      <div
        className={cx(
          'lg:block lg:h-dvh lg:overflow-y-auto lg:border-r lg:border-linie',
          detailOpen && 'hidden',
        )}
      >
        {list}
      </div>
      <div className={cx('lg:block lg:h-dvh lg:overflow-y-auto', !detailOpen && 'hidden')}>
        {detailOpen ? (
          <div className="lg:mx-auto lg:max-w-[760px] 2xl:max-w-[880px]">{detail}</div>
        ) : (
          <div className="hidden h-full items-center justify-center text-[14px] text-leise lg:flex">
            Wähle links einen Eintrag aus.
          </div>
        )}
      </div>
    </div>
  );
}
