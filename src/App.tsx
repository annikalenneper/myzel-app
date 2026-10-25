import { Navigate, Outlet, Route, Routes, useParams } from 'react-router-dom';
import { AppShell } from './app/AppShell';
import { FeedbackProvider } from './app/feedback';
import { LookupsProvider } from './app/lookups';
import { RequireAdmin, RequireMember, SessionProvider } from './app/session';
import { AgendaFilterProvider } from './app/agendaFilter';
import { AgendaScreen } from './screens/agenda/AgendaScreen';
import { AppointmentsScreen } from './screens/appointments/AppointmentsScreen';
import { PartnersScreen } from './screens/partners/PartnersScreen';
import { Templates } from './screens/profile/Templates';
import { EventsScreen } from './screens/events/EventsScreen';
import { KnowledgeScreen } from './screens/knowledge/KnowledgeScreen';
import { Login } from './screens/Login';
import { NoAccess } from './screens/NoAccess';
import { Privacy } from './screens/Privacy';
import { AppointmentTypes } from './screens/profile/AppointmentTypes';
import { Members } from './screens/profile/Members';
import { Profile } from './screens/profile/Profile';
import { SystemStatus } from './screens/profile/SystemStatus';
import { Topics } from './screens/profile/Topics';
import { DemoBanner } from './ui/DemoBanner';

/** Alte Adressen (z. B. in schon verschickten Benachrichtigungen) führen zur neuen Stelle (16.1) */
function Moved({ to }: { to: (id: string) => string }) {
  const { id } = useParams();
  return <Navigate to={to(id ?? '')} replace />;
}

function MemberArea() {
  return (
    <LookupsProvider>
      <AgendaFilterProvider>
        <Outlet />
      </AgendaFilterProvider>
    </LookupsProvider>
  );
}

export function App() {
  return (
    <SessionProvider>
      <FeedbackProvider>
        <DemoBanner />
        <Routes>
          <Route path="/anmelden" element={<Login />} />
          <Route path="/kein-zugriff" element={<NoAccess />} />
          <Route path="/datenschutz" element={<Privacy />} />
          <Route element={<RequireMember />}>
            <Route element={<MemberArea />}>
              <Route element={<AppShell />}>
                <Route path="/agenda" element={<AgendaScreen />} />
                <Route path="/agenda/:id" element={<AgendaScreen />} />
                <Route path="/agenda/frage/:id" element={<AgendaScreen detail="question" />} />
                <Route path="/agenda/eintrag/:id" element={<AgendaScreen detail="decision" />} />
                <Route path="/aufgaben" element={<Navigate to="/agenda" replace />} />
                <Route path="/aufgaben/:id" element={<Moved to={(id) => `/agenda/${id}`} />} />
                <Route path="/events" element={<EventsScreen />} />
                <Route path="/events/:eventId" element={<EventsScreen />} />
                <Route path="/partner" element={<PartnersScreen />} />
                <Route path="/partner/:partnerId" element={<PartnersScreen />} />
                <Route path="/termine" element={<AppointmentsScreen />} />
                <Route path="/termine/:appointmentId" element={<AppointmentsScreen />} />
                <Route path="/wissen" element={<KnowledgeScreen />} />
                <Route path="/wissen/beschluesse/:id" element={<KnowledgeScreen detail="decision" />} />
                <Route path="/wissen/fragen/:id" element={<Moved to={(id) => `/agenda/frage/${id}`} />} />
                <Route path="/wissen/drive" element={<KnowledgeScreen drive />} />
                <Route path="/wissen/drive/:folderId" element={<KnowledgeScreen drive />} />
                <Route path="/profil" element={<Profile />} />
                <Route path="/profil/vorlagen" element={<Templates />} />
                <Route element={<RequireAdmin />}>
                  <Route path="/profil/mitglieder" element={<Members />} />
                  <Route path="/profil/themen" element={<Topics />} />
                  <Route path="/profil/system" element={<SystemStatus />} />
                  <Route path="/profil/terminarten" element={<AppointmentTypes />} />
                </Route>
              </Route>
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/agenda" replace />} />
        </Routes>
      </FeedbackProvider>
    </SessionProvider>
  );
}
