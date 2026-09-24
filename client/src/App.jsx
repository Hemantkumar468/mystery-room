import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from './store/authStore.js';
import { AppShell } from './components/layout/AppShell.jsx';
import { LoginPage } from './features/auth/LoginPage.jsx';
import { DashboardPage } from './features/dashboard/DashboardPage.jsx';
import { ProjectsPage } from './features/projects/ProjectsPage.jsx';
import { ProjectDetailPage } from './features/projects/ProjectDetailPage.jsx';
import { TemplatesPage } from './features/templates/TemplatesPage.jsx';
import { TemplateDetailPage } from './features/templates/TemplateDetailPage.jsx';
import { CalendarPage } from './features/calendar/CalendarPage.jsx';
import { MisPage } from './features/mis/MisPage.jsx';
import { PageLoader } from './components/ui/primitives.jsx';

// Operations modules load on first visit so the PMS screens stay light.
const page = (load, name) => lazy(() => load().then((m) => ({ default: m[name] })));
const MyWorkPage = page(() => import('./features/delegation/MyWorkPage.jsx'), 'MyWorkPage');
const TasksPage = page(() => import('./features/delegation/TasksPage.jsx'), 'TasksPage');
const GroupsPage = page(() => import('./features/delegation/GroupsPage.jsx'), 'GroupsPage');
const RepeatsPage = page(() => import('./features/delegation/RepeatsPage.jsx'), 'RepeatsPage');
const TrashPage = page(() => import('./features/delegation/TrashPage.jsx'), 'TrashPage');
const ChecklistPage = page(() => import('./features/checklist/ChecklistPage.jsx'), 'ChecklistPage');
const TeamsPage = page(() => import('./features/org/TeamsPage.jsx'), 'TeamsPage');
const BranchesPage = page(() => import('./features/org/BranchesPage.jsx'), 'BranchesPage');
const OpsSettingsPage = page(() => import('./features/org/OpsSettingsPage.jsx'), 'OpsSettingsPage');
const ActivityPage = page(() => import('./features/org/ActivityPage.jsx'), 'ActivityPage');
const PerformancePage = page(() => import('./features/performance/PerformancePage.jsx'), 'PerformancePage');

function RequireAuth({ children }) {
  const token = useAuthStore((s) => s.accessToken);
  const location = useLocation();
  if (!token) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <AppShell>
              <Suspense fallback={<PageLoader />}>
              <Routes>
                {/* Project Management */}
                <Route path="/" element={<DashboardPage />} />
                <Route path="/projects" element={<ProjectsPage />} />
                <Route path="/projects/:id" element={<ProjectDetailPage />} />
                <Route path="/templates" element={<TemplatesPage />} />
                <Route path="/templates/:id" element={<TemplateDetailPage />} />
                <Route path="/calendar" element={<CalendarPage />} />
                <Route path="/mis" element={<MisPage />} />

                {/* Delegation */}
                <Route path="/delegation" element={<Navigate to="/delegation/my-work" replace />} />
                <Route path="/delegation/my-work" element={<MyWorkPage />} />
                <Route path="/delegation/tasks/:taskId" element={<MyWorkPage />} />
                <Route path="/delegation/delegated" element={<TasksPage mode="delegated" />} />
                <Route path="/delegation/loop" element={<TasksPage mode="loop" />} />
                <Route path="/delegation/all" element={<TasksPage mode="all" />} />
                <Route path="/delegation/groups" element={<GroupsPage />} />
                <Route path="/delegation/groups/:id" element={<GroupsPage />} />
                <Route path="/delegation/repeats" element={<RepeatsPage />} />
                <Route path="/delegation/trash" element={<TrashPage />} />

                {/* Checklist */}
                <Route path="/checklist" element={<ChecklistPage />} />

                {/* Organisation & performance */}
                <Route path="/performance" element={<PerformancePage />} />
                <Route path="/org/teams" element={<TeamsPage />} />
                <Route path="/org/branches" element={<BranchesPage />} />
                <Route path="/org/settings" element={<OpsSettingsPage />} />
                <Route path="/org/activity" element={<ActivityPage />} />

                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
              </Suspense>
            </AppShell>
          </RequireAuth>
        }
      />
    </Routes>
  );
}

export default App;
