import { Routes, Route, Navigate } from 'react-router-dom';
import { RequireAuth, RequireRole } from './components/routing/RouteGuards.jsx';
import { useAppSelector } from './app/hooks.js';
import { selectCurrentUser } from './app/slices/authSlice.js';
import { NAV_KEYS, landingPathFor, navRequirement } from './lib/navPolicy.js';
import { AppShell } from './components/layout/AppShell.jsx';
import { LoginPage } from './features/auth/LoginPage.jsx';
import { DashboardPage } from './features/dashboard/DashboardPage.jsx';
import { ProjectsPage } from './features/projects/ProjectsPage.jsx';
import { PropertiesPage } from './features/properties/PropertiesPage.jsx';
import { ApprovalsPage } from './features/approvals/ApprovalsPage.jsx';
import { AiReportPage } from './features/ai/AiReportPage.jsx';
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
import { DepartmentPlanningKpiPage } from './features/projects/DepartmentPlanningKpiPage.jsx';
import { DepartmentTasksPage } from './features/projects/DepartmentTasksPage.jsx';
import { ExecutionPage } from './features/projects/ExecutionPage.jsx';
import { ExecutionKpiPage } from './features/projects/ExecutionKpiPage.jsx';
import { TaskDetailPage } from './features/tasks/TaskDetailPage.jsx';
import { OverdueTasksPage } from './features/tasks/OverdueTasksPage.jsx';
import { MyTasksPage } from './features/tasks/MyTasksPage.jsx';
import { ApprovalWorkflowPage } from './features/projects/ApprovalWorkflowPage.jsx';
import { ApprovalWorkflowKpiPage } from './features/projects/ApprovalWorkflowKpiPage.jsx';
import { StoreReadinessDashboardPage } from './features/projects/StoreReadinessDashboardPage.jsx';
import { CategoryDetailsPage } from './features/projects/CategoryDetailsPage.jsx';
import { ReadinessSummaryReportPage } from './features/projects/ReadinessSummaryReportPage.jsx';
import { StoreLaunchPage, LAUNCH_CATEGORY_ICONS } from './features/projects/StoreLaunchPage.jsx';
import { LAUNCH_CATEGORY_META, launchCategoryMeta } from './lib/ui.js';
import { ProjectClosurePage } from './features/projects/ProjectClosurePage.jsx';
import { ClosureReportPage } from './features/projects/ClosureReportPage.jsx';
import { TemplatesPage } from './features/templates/TemplatesPage.jsx';
import { TemplateDetailPage } from './features/templates/TemplateDetailPage.jsx';
import { CalendarPage } from './features/calendar/CalendarPage.jsx';
import { MisPage } from './features/mis/MisPage.jsx';
import { EmployeesPage } from './features/employees/EmployeesPage.jsx';
import { EmsLayout } from './features/expenses/EmsLayout.jsx';
import { emsRouteElements } from './features/expenses/config/emsRoutes.jsx';

/**
 * Route-level twin of the sidebar's filtering, off the same table. A hidden
 * nav link is not a gate — before this, an Employee could reach /mis or
 * /employees by typing the URL and get a full page of data they were never
 * meant to be offered. Redirects to the role's own landing page rather than a
 * 403 screen: for someone who simply followed a stale link, being put back
 * where they belong is the useful outcome.
 */
function Gate({ k, children }) {
  const user = useAppSelector(selectCurrentUser);
  return (
    <RequireRole requirement={navRequirement(k)} redirectTo={landingPathFor(user)}>
      {children}
    </RequireRole>
  );
}

/**
 * What "/" resolves to for the signed-in user.
 *
 * An Employee's own tasks are why they opened the app; landing them on the
 * portfolio dashboard made them go looking for their work every session. Every
 * other role keeps the dashboard, which is genuinely their overview. Rendering
 * the dashboard directly (rather than redirecting) keeps the URL clean for the
 * roles that belong there.
 */
function HomeRoute() {
  const user = useAppSelector(selectCurrentUser);
  const landing = landingPathFor(user);
  if (landing !== '/') return <Navigate to={landing} replace />;
  return <DashboardPage />;
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
                {/* Roles whose landing page is not the portfolio dashboard get
                    redirected here rather than at login, so a bookmark, a
                    refresh and a notification deep-link all behave the same.
                    See lib/navPolicy.js#landingPathFor. */}
                <Route path="/" element={<HomeRoute />} />
                <Route path="/my-tasks" element={<MyTasksPage />} />
                <Route path="/projects" element={<ProjectsPage />} />
                <Route path="/properties" element={<PropertiesPage />} />
                <Route path="/approvals" element={<Gate k={NAV_KEYS.APPROVALS}><ApprovalsPage /></Gate>} />
                <Route path="/tasks/overdue" element={<OverdueTasksPage />} />
                <Route path="/projects/:id" element={<ProjectDetailPage />} />
                <Route path="/projects/:id/property-identification" element={<PropertyIdentificationPage />} />
                <Route path="/projects/:id/property-identification/:recordId" element={<PropertyDetailPage />} />
                <Route path="/projects/:id/property-identification/:recordId/ai-report" element={<AiReportPage />} />
                <Route path="/projects/:id/site-evaluation" element={<SiteEvaluationPage />} />
                <Route path="/projects/:id/site-evaluation/comparison" element={<SiteEvaluationComparisonPage />} />
                <Route path="/projects/:id/site-evaluation/shortlisted" element={<SiteEvaluationKpiPage kpi="shortlisted" />} />
                <Route path="/projects/:id/site-evaluation/completed" element={<SiteEvaluationKpiPage kpi="completed" />} />
                <Route path="/projects/:id/site-evaluation/approved" element={<SiteEvaluationKpiPage kpi="approved" />} />
                <Route path="/projects/:id/site-evaluation/rejected" element={<SiteEvaluationKpiPage kpi="rejected" />} />
                <Route path="/projects/:id/site-evaluation/scores" element={<SiteEvaluationKpiPage kpi="scores" />} />
                <Route path="/projects/:id/site-evaluation/:propertyId" element={<PropertyEvaluationPage />} />
                <Route path="/projects/:id/site-evaluation/:propertyId/assessment/:recordId" element={<AssessmentReportPage />} />
                <Route path="/projects/:id/site-evaluation/report" element={<PropertyAssessmentReportPage />} />
                <Route path="/projects/:id/commercial-finalization" element={<CommercialFinalizationPage />} />
                <Route path="/projects/:id/commercial-finalization/record/:recordId" element={<CommercialRecordReportPage />} />
                <Route path="/projects/:id/commercial-finalization/module/:moduleKey" element={<CommercialModuleChecklistPage />} />
                <Route path="/projects/:id/commercial-finalization/report" element={<CommercialCompleteReportPage />} />
                <Route path="/projects/:id/project-creation" element={<ProjectCreationPage />} />
                <Route path="/projects/:id/department-planning" element={<DepartmentPlanningPage />} />
                <Route path="/projects/:id/department-planning/kpi/:kpiKey" element={<DepartmentPlanningKpiPage />} />
                <Route path="/projects/:id/department-planning/:departmentKey" element={<DepartmentTasksPage />} />
                <Route path="/projects/:id/execution" element={<ExecutionPage />} />
                <Route path="/projects/:id/execution/kpi/:kpiKey" element={<ExecutionKpiPage />} />
                <Route path="/projects/:id/tasks/:code" element={<TaskDetailPage />} />
                <Route path="/projects/:id/approval-workflow" element={<ApprovalWorkflowPage />} />
                <Route path="/projects/:id/approval-workflow/kpi/:kpiKey" element={<ApprovalWorkflowKpiPage />} />
                <Route path="/projects/:id/store-readiness" element={<StoreReadinessDashboardPage />} />
                <Route path="/projects/:id/store-readiness/category/:categoryKey" element={<CategoryDetailsPage />} />
                <Route path="/projects/:id/store-readiness/report" element={<ReadinessSummaryReportPage />} />
                <Route path="/projects/:id/store-launch" element={<StoreLaunchPage />} />
                <Route
                  path="/projects/:id/store-launch/category/:categoryKey"
                  element={
                    <CategoryDetailsPage
                      stageKey="p9"
                      categoryMetaMap={LAUNCH_CATEGORY_META}
                      categoryMetaFn={launchCategoryMeta}
                      categoryIcons={LAUNCH_CATEGORY_ICONS}
                      backPath="store-launch"
                      backLabel="Store Launch"
                    />
                  }
                />
                {/* Phase 10 Closure Command Center. Each tab is its own URL so a
                    closure view is linkable and survives a refresh; the printable
                    report is a distinct page, declared before the catch-all tab
                    route so "report" resolves to it rather than an unknown tab. */}
                <Route path="/projects/:id/project-closure" element={<ProjectClosurePage tab="overview" />} />
                <Route path="/projects/:id/project-closure/report" element={<ClosureReportPage />} />
                <Route path="/projects/:id/project-closure/modules" element={<ProjectClosurePage tab="modules" />} />
                <Route path="/projects/:id/project-closure/budget" element={<ProjectClosurePage tab="budget" />} />
                <Route path="/projects/:id/project-closure/timeline" element={<ProjectClosurePage tab="timeline" />} />
                <Route path="/projects/:id/project-closure/vendors" element={<ProjectClosurePage tab="vendors" />} />
                <Route path="/projects/:id/project-closure/departments" element={<ProjectClosurePage tab="departments" />} />
                <Route path="/projects/:id/project-closure/lessons" element={<ProjectClosurePage tab="lessons" />} />
                <Route path="/projects/:id/project-closure/documents" element={<ProjectClosurePage tab="documents" />} />
                <Route path="/projects/:id/project-closure/approvals" element={<ProjectClosurePage tab="approvals" />} />
                <Route path="/projects/:id/project-closure/reports" element={<ProjectClosurePage tab="reports" />} />
                <Route path="/projects/:id/project-closure/archive" element={<ProjectClosurePage tab="archive" />} />
                <Route path="/projects/:id/project-closure/audit" element={<ProjectClosurePage tab="audit" />} />
                <Route path="/templates" element={<Gate k={NAV_KEYS.TEMPLATES}><TemplatesPage /></Gate>} />
                <Route path="/templates/:id" element={<TemplateDetailPage />} />
                <Route path="/calendar" element={<CalendarPage />} />
                <Route path="/mis" element={<Gate k={NAV_KEYS.MIS}><MisPage /></Gate>} />
                <Route path="/employees" element={<Gate k={NAV_KEYS.EMPLOYEES}><EmployeesPage /></Gate>} />
                {/* EMS — a cross-cutting top-level module, not a PMS phase, so it
                    gets its own mount point and layout rather than living
                    alongside the /projects/:id/... tree above. All of its
                    routes/titles/breadcrumbs/permissions come from one config
                    (features/expenses/config/ems.routes.config.js) — see
                    lib/moduleRoutes.jsx for how App.jsx, Sidebar.jsx, and
                    Breadcrumbs.jsx all read from that same source. */}
                <Route path="/ems/*" element={<EmsLayout />}>
                  {emsRouteElements}
                </Route>
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
