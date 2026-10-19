import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AppShell } from './app/AppShell';
import { FeedbackProvider } from './app/feedback';
import { LookupsProvider } from './app/lookups';
import { RequireAdmin, RequireMember, SessionProvider } from './app/session';
import { TaskFilterProvider } from './app/taskFilter';
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
import { TasksScreen } from './screens/tasks/TasksScreen';

function MemberArea() {
  return (
    <LookupsProvider>
      <TaskFilterProvider>
        <Outlet />
      </TaskFilterProvider>
    </LookupsProvider>
  );
}

export function App() {
  return (
    <SessionProvider>
      <FeedbackProvider>
        <Routes>
          <Route path="/anmelden" element={<Login />} />
          <Route path="/kein-zugriff" element={<NoAccess />} />
          <Route path="/datenschutz" element={<Privacy />} />
          <Route element={<RequireMember />}>
            <Route element={<MemberArea />}>
              <Route element={<AppShell />}>
                <Route path="/aufgaben" element={<TasksScreen />} />
                <Route path="/aufgaben/:taskId" element={<TasksScreen />} />
                <Route path="/events" element={<EventsScreen />} />
                <Route path="/events/:eventId" element={<EventsScreen />} />
                <Route path="/partner" element={<PartnersScreen />} />
                <Route path="/partner/:partnerId" element={<PartnersScreen />} />
                <Route path="/termine" element={<AppointmentsScreen />} />
                <Route path="/termine/:appointmentId" element={<AppointmentsScreen />} />
                <Route path="/wissen" element={<KnowledgeScreen />} />
                <Route path="/wissen/beschluesse/:id" element={<KnowledgeScreen detail="decision" />} />
                <Route path="/wissen/fragen/:id" element={<KnowledgeScreen detail="question" />} />
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
          <Route path="*" element={<Navigate to="/aufgaben" replace />} />
        </Routes>
      </FeedbackProvider>
    </SessionProvider>
  );
}
