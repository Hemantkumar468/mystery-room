import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from './store/authStore.js';
import { AppShell } from './components/layout/AppShell.jsx';
import { LoginPage } from './features/auth/LoginPage.jsx';
import { DashboardPage } from './features/dashboard/DashboardPage.jsx';
import { ProjectsPage } from './features/projects/ProjectsPage.jsx';
import { ProjectDetailPage } from './features/projects/ProjectDetailPage.jsx';
import { PropertyIdentificationPage } from './features/projects/PropertyIdentificationPage.jsx';
import { PropertyDetailPage } from './features/projects/PropertyDetailPage.jsx';
import { SiteEvaluationPage } from './features/projects/SiteEvaluationPage.jsx';
import { SiteEvaluationComparisonPage } from './features/projects/SiteEvaluationComparisonPage.jsx';
import { SiteEvaluationKpiPage } from './features/projects/SiteEvaluationKpiPage.jsx';
import { PropertyEvaluationPage } from './features/projects/PropertyEvaluationPage.jsx';
import { AssessmentReportPage } from './features/projects/AssessmentReportPage.jsx';
import { PropertyAssessmentReportPage } from './features/projects/PropertyAssessmentReportPage.jsx';
import { CommercialFinalizationPage } from './features/projects/CommercialFinalizationPage.jsx';
import { CommercialRecordReportPage } from './features/projects/CommercialRecordReportPage.jsx';
import { CommercialModuleChecklistPage } from './features/projects/CommercialModuleChecklistPage.jsx';
import { CommercialCompleteReportPage } from './features/projects/CommercialCompleteReportPage.jsx';
import { ProjectCreationPage } from './features/projects/ProjectCreationPage.jsx';
import { DepartmentPlanningPage } from './features/projects/DepartmentPlanningPage.jsx';
import { ExecutionPage } from './features/projects/ExecutionPage.jsx';
import { ApprovalWorkflowPage } from './features/projects/ApprovalWorkflowPage.jsx';
import { StoreReadinessPage } from './features/projects/StoreReadinessPage.jsx';
import { StoreLaunchPage } from './features/projects/StoreLaunchPage.jsx';
import { ProjectClosurePage } from './features/projects/ProjectClosurePage.jsx';
import { TemplatesPage } from './features/templates/TemplatesPage.jsx';
import { TemplateDetailPage } from './features/templates/TemplateDetailPage.jsx';
import { CalendarPage } from './features/calendar/CalendarPage.jsx';
import { MisPage } from './features/mis/MisPage.jsx';
import { EmployeesPage } from './features/employees/EmployeesPage.jsx';
import { PhaseRouteGuard } from './features/projects/stagesConfig.jsx';

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
                <Route path="/projects/:id/property-identification" element={<PhaseRouteGuard stageKey="p1"><PropertyIdentificationPage /></PhaseRouteGuard>} />
                <Route path="/projects/:id/property-identification/:recordId" element={<PropertyDetailPage />} />
                <Route path="/projects/:id/site-evaluation" element={<PhaseRouteGuard stageKey="p2"><SiteEvaluationPage /></PhaseRouteGuard>} />
                <Route path="/projects/:id/site-evaluation/comparison" element={<SiteEvaluationComparisonPage />} />
                <Route path="/projects/:id/site-evaluation/shortlisted" element={<SiteEvaluationKpiPage kpi="shortlisted" />} />
                <Route path="/projects/:id/site-evaluation/completed" element={<SiteEvaluationKpiPage kpi="completed" />} />
                <Route path="/projects/:id/site-evaluation/approved" element={<SiteEvaluationKpiPage kpi="approved" />} />
                <Route path="/projects/:id/site-evaluation/rejected" element={<SiteEvaluationKpiPage kpi="rejected" />} />
                <Route path="/projects/:id/site-evaluation/scores" element={<SiteEvaluationKpiPage kpi="scores" />} />
                <Route path="/projects/:id/site-evaluation/:propertyId" element={<PropertyEvaluationPage />} />
                <Route path="/projects/:id/site-evaluation/:propertyId/assessment/:recordId" element={<AssessmentReportPage />} />
                <Route path="/projects/:id/site-evaluation/report" element={<PropertyAssessmentReportPage />} />
                <Route path="/projects/:id/commercial-finalization" element={<PhaseRouteGuard stageKey="p3"><CommercialFinalizationPage /></PhaseRouteGuard>} />
                <Route path="/projects/:id/commercial-finalization/record/:recordId" element={<CommercialRecordReportPage />} />
                <Route path="/projects/:id/commercial-finalization/module/:moduleKey" element={<CommercialModuleChecklistPage />} />
                <Route path="/projects/:id/commercial-finalization/report" element={<CommercialCompleteReportPage />} />
                <Route path="/projects/:id/project-creation" element={<PhaseRouteGuard stageKey="p4"><ProjectCreationPage /></PhaseRouteGuard>} />
                <Route path="/projects/:id/department-planning" element={<PhaseRouteGuard stageKey="p5"><DepartmentPlanningPage /></PhaseRouteGuard>} />
                <Route path="/projects/:id/execution" element={<PhaseRouteGuard stageKey="p6"><ExecutionPage /></PhaseRouteGuard>} />
                <Route path="/projects/:id/approval-workflow" element={<PhaseRouteGuard stageKey="p7"><ApprovalWorkflowPage /></PhaseRouteGuard>} />
                <Route path="/projects/:id/store-readiness" element={<PhaseRouteGuard stageKey="p8"><StoreReadinessPage /></PhaseRouteGuard>} />
                <Route path="/projects/:id/store-launch" element={<PhaseRouteGuard stageKey="p9"><StoreLaunchPage /></PhaseRouteGuard>} />
                <Route path="/projects/:id/project-closure" element={<PhaseRouteGuard stageKey="p10"><ProjectClosurePage /></PhaseRouteGuard>} />
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
