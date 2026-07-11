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
import { EmployeesPage } from './features/employees/EmployeesPage.jsx';

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
              <Routes>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/projects" element={<ProjectsPage />} />
                <Route path="/projects/:id" element={<ProjectDetailPage />} />
                <Route path="/templates" element={<TemplatesPage />} />
                <Route path="/templates/:id" element={<TemplateDetailPage />} />
                <Route path="/calendar" element={<CalendarPage />} />
                <Route path="/mis" element={<MisPage />} />
                <Route path="/employees" element={<EmployeesPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </AppShell>
          </RequireAuth>
        }
      />
    </Routes>
  );
}

export default App;
