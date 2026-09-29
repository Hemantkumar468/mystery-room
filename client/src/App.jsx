import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { RequireAuth, RequireRole } from './components/routing/RouteGuards.jsx';
import { useAppSelector } from './app/hooks.js';
import { useAccess } from './hooks/useAccess.js';
import { EmptyState } from './components/ui/primitives.jsx';
import { ShieldOff } from 'lucide-react';
import { selectCurrentUser } from './app/slices/authSlice.js';
import { NAV_KEYS, landingPathFor, navRequirement } from './lib/navPolicy.js';
import { AppShell } from './components/layout/AppShell.jsx';
import { LoginPage } from './features/auth/LoginPage.jsx';
import { DashboardPage } from './features/dashboard/DashboardPage.jsx';
import { ProjectsPage } from './features/projects/ProjectsPage.jsx';
import { PropertiesPage } from './features/properties/PropertiesPage.jsx';
import { NetworkMapPage } from './features/network/NetworkMapPage.jsx';
import { ApprovalsPage } from './features/approvals/ApprovalsPage.jsx';
import ApprovalItemPage from './features/approvals/ApprovalItemPage.jsx';
import { AiReportPage } from './features/ai/AiReportPage.jsx';
import { ProjectDetailPage } from './features/projects/ProjectDetailPage.jsx';
import MasterFlowPage from './features/projects/MasterFlowPage.jsx';
import JourneyMapPage from './features/projects/JourneyMapPage.jsx';
import PmsFlowPage from './features/projects/PmsFlowPage.jsx';
/* The client flow's three new boards — the drawing checklist that gates the
   BOQ, the seven-BOQ workspace, and the contracts that gate ordering.
   See server/src/modules/pms/flow for the read model they render. */
import DrawingChecklistPage from './features/projects/clientFlow/DrawingChecklistPage.jsx';
/* The Design & Drawings FMS — the multi-project management dashboard over the
   same 37-drawing checklist DrawingChecklistPage renders for one project. */
import DesignDrawingsDashboardPage from './features/designDrawings/DesignDrawingsDashboardPage.jsx';
import DesignDrawingsProjectPage from './features/designDrawings/DesignDrawingsProjectPage.jsx';
import DesignDrawingsMetricPage from './features/designDrawings/DesignDrawingsMetricPage.jsx';
import BoqWorkspacePage from './features/projects/clientFlow/BoqWorkspacePage.jsx';
import ContractsPage from './features/projects/clientFlow/ContractsPage.jsx';
import VendorPanelPage from './features/projects/clientFlow/VendorPanelPage.jsx';
import VendorRateCardPage from './features/projects/clientFlow/VendorRateCardPage.jsx';
import PhasePage from './features/projects/PhasePage.jsx';
import PurchaseOrderPage from './features/projects/PurchaseOrderPage.jsx';
import InvoicePage from './features/projects/InvoicePage.jsx';
import ProcurementTrackerPage from './features/projects/ProcurementTrackerPage.jsx';
import OrderDetailPage from './features/projects/OrderDetailPage.jsx';
import PlanVsActualPage from './features/projects/PlanVsActualPage.jsx';
import DataExplorerPage from './features/projects/DataExplorerPage.jsx';
import DesignBriefPage from './features/projects/DesignBriefPage.jsx';
import VendorsPage from './features/vendors/VendorsPage.jsx';
import VendorProjectPage from './features/vendors/VendorProjectPage.jsx';
import VendorRecordPage from './features/vendors/VendorRecordPage.jsx';
import GamesPage from './features/master/GamesPage.jsx';
import InventoryPage from './features/master/InventoryPage.jsx';
import PropertySteps from './features/property/PropertySteps.jsx';
import { propertyRouteElements } from './features/property/config/propertyRoutes.jsx';
import UserGuidePage from './features/guide/UserGuidePage.jsx';
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
import DailyReportsPage from './features/projects/DailyReportsPage.jsx';
import { ExecutionKpiPage } from './features/projects/ExecutionKpiPage.jsx';
import { TaskDetailPage } from './features/tasks/TaskDetailPage.jsx';
import { OverdueTasksPage } from './features/tasks/OverdueTasksPage.jsx';
import { MyTasksPage } from './features/tasks/MyTasksPage.jsx';
import { GanttPage } from './features/gantt/GanttPage.jsx';
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
import { EmployeesPage } from './features/employees/EmployeesPage.jsx';
import { WhatsappSettingsPage } from './features/settings/WhatsappSettingsPage.jsx';
import { AccessControlPage } from './features/settings/AccessControlPage.jsx';
import { FmsAssignPage } from './features/settings/FmsAssignPage.jsx';
import { HrmsLayout } from './features/hrms/HrmsLayout.jsx';
import { hrmsRouteElements } from './features/hrms/config/hrmsRoutes.jsx';
import { ApplyPage } from './features/hrms/ApplyPage.jsx';
import { PurchaseLayout } from './features/purchase/PurchaseLayout.jsx';
import { purchaseRouteElements } from './features/purchase/config/purchaseRoutes.jsx';
import { ImsLayout } from './features/ims/ImsLayout.jsx';
import { imsRouteElements } from './features/ims/config/imsRoutes.jsx';
import { ErsLayout } from './features/ers/ErsLayout.jsx';
import { ersRouteElements } from './features/ers/config/ersRoutes.jsx';
import { FranchiseLayout } from './features/franchise/FranchiseLayout.jsx';
import { franchiseRouteElements } from './features/franchise/config/franchiseRoutes.jsx';
import { FranchiseApplyPage } from './features/franchise/FranchiseApplyPage.jsx';
// CRM hidden for now — not to be shown to anyone yet. Re-enable by uncommenting here and the /crm/* route below.
// import { CrmLayout } from './features/crm/CrmLayout.jsx';
// import { crmRouteElements } from './features/crm/config/crmRoutes.jsx';

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
  /* `navRequirement` calls the pure `canSeeNav`, which reads the access map
     from a module-level mirror and so cannot trigger a render on its own.
     Subscribing here is what makes a route the admin just closed stop
     answering without a reload. */
  useAccess();
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
  /* Subscribes to the access policy — `landingPathFor` reads it through the
     pure `canSeeNav`, which cannot trigger a render on its own. */
  useAccess();
  const landing = landingPathFor(user);
  /* `landingPathFor` returns '/' only when this person may actually see the
     Dashboard. Taking it away used to leave `/` rendering the portfolio to
     somebody it had been hidden from — the address bar is the one door a
     nav-only gate never closes. */
  if (landing !== '/') return <Navigate to={landing} replace />;
  return <DashboardPage />;
}

/**
 * The floor, for somebody who has been granted nothing at all.
 *
 * It should never be reached — an account with no access is a mistake made
 * on the Access Control screen, not a state worth designing for — but every
 * redirect has to end somewhere, and ending in a sentence is the difference
 * between a screen that explains itself and a tab that freezes in a loop.
 */
function NoAccessRoute() {
  const user = useAppSelector(selectCurrentUser);
  return (
    <div className="content">
      <div className="content-narrow" style={{ paddingTop: 48 }}>
        <EmptyState
          icon={ShieldOff}
          title="You have not been given access to anything yet"
          hint={`Signed in as ${user?.name ?? 'this account'}. Ask whoever manages Access Control in Settings to grant your role the parts of the ERP you need.`}
        />
      </div>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {/* PUBLIC: the job page applicants open from a shared link. No login,
          no app shell — and it must stay outside RequireAuth or every
          applicant would be bounced to the login screen. */}
      <Route path="/apply/:id" element={<ApplyPage />} />
      {/* PUBLIC: the franchise enquiry a prospective partner opens from a
          shared link — their property IS the capture; approval starts the
          project at Phase 3 (LOI). */}
      <Route path="/franchise/apply" element={<FranchiseApplyPage />} />
      {/* The property referral link — brokers, agents, landlords. Same public
          form in referral mode; see FranchiseApplyPage. Unauthenticated, so it
          sits out here with /franchise/apply rather than inside the shell. */}
      <Route path="/refer-property" element={<FranchiseApplyPage mode="referral" />} />
      {/* PUBLIC: the design brief an OUTSIDE architect opens from a WhatsApp
          link — the site, its area, the games it must hold, and somewhere to
          upload their drawings. Outside RequireAuth for the same reason as
          the two above: they have no account and never will. */}
      <Route path="/design/:token" element={<DesignBriefPage />} />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <AppShell>
              <Suspense fallback={<PageLoader />}>
              <Routes>
                {/* Roles whose landing page is not the portfolio dashboard get
                    redirected here rather than at login, so a bookmark, a
                    refresh and a notification deep-link all behave the same.
                    See lib/navPolicy.js#landingPathFor. */}
                <Route path="/" element={<HomeRoute />} />
                {/* Gated like every other destination. It is the Employee's
                    landing page, so `landingPathFor` checks this same key
                    before sending anyone here — otherwise hiding it would
                    bounce them between the gate and the landing for ever. */}
                <Route path="/my-tasks" element={<Gate k={NAV_KEYS.MY_TASKS}><MyTasksPage /></Gate>} />
                <Route path="/my-tasks/projects/:id/tasks/:code" element={<Gate k={NAV_KEYS.MY_TASKS}><TaskDetailPage /></Gate>} />
                <Route path="/no-access" element={<NoAccessRoute />} />
                <Route path="/gantt" element={<Gate k={NAV_KEYS.GANTT}><GanttPage /></Gate>} />
                {/* Gated, like every other top-level destination. These four
                    — Projects, Properties, Calendar and the Guide — were the
                    last ungated ones: their sidebar links disappeared when
                    access was taken away, but the page still answered anyone
                    who typed the address, which is not hiding it. */}
                <Route path="/projects" element={<Gate k={NAV_KEYS.PROJECTS}><ProjectsPage /></Gate>} />
                <Route path="/plan-vs-actual" element={<Gate k={NAV_KEYS.PLAN_VS_ACTUAL}><PlanVsActualPage /></Gate>} />
                <Route path="/data-explorer" element={<Gate k={NAV_KEYS.DATA_EXPLORER}><DataExplorerPage /></Gate>} />
                <Route path="/properties" element={<Gate k={NAV_KEYS.PROPERTIES}><PropertiesPage /></Gate>} />
                <Route path="/vendors" element={<Gate k={NAV_KEYS.VENDORS}><VendorsPage /></Gate>} />
                {/* The vendor drill-down: project → its vendors → the record.
                    Real addresses, so the browser back button matches the
                    on-screen back links and any level can be linked to. */}
                <Route path="/vendors/project/:projectId" element={<Gate k={NAV_KEYS.VENDORS}><VendorProjectPage /></Gate>} />
                <Route path="/vendors/project/:projectId/vendor/:vendorId" element={<Gate k={NAV_KEYS.VENDORS}><VendorRecordPage /></Gate>} />
                <Route path="/guide" element={<Gate k={NAV_KEYS.GUIDE}><UserGuidePage /></Gate>} />
                {/* Portfolio view, so it is gated exactly like MIS — see
                    lib/navPolicy.js. Hiding the sidebar link is not a gate;
                    this is the half that answers a typed URL. */}
                <Route path="/network-map" element={<Gate k={NAV_KEYS.NETWORK_MAP}><NetworkMapPage /></Gate>} />
                <Route path="/approvals" element={<Gate k={NAV_KEYS.APPROVALS}><ApprovalsPage /></Gate>} />
                {/* One project's queue — the same page with the project locked,
                    so every decision control works there unchanged. */}
                <Route path="/approvals/project/:projectId" element={<Gate k={NAV_KEYS.APPROVALS}><ApprovalsPage /></Gate>} />
                {/* Level 3 — the full submission. A real route, so browser back
                    from here lands on level 2 rather than the project list. */}
                <Route path="/approvals/project/:projectId/item/:taskId" element={<Gate k={NAV_KEYS.APPROVALS}><ApprovalItemPage /></Gate>} />
                <Route path="/tasks/overdue" element={<OverdueTasksPage />} />
                <Route path="/projects/:id" element={<ProjectDetailPage />} />
                {/* The MD's whole-project view: every phase, who owns it, planned vs actual. */}
                <Route path="/projects/:id/flow" element={<MasterFlowPage />} />
                {/* The launch as one picture, with its critical path — see
                    JourneyMapPage.jsx for why it sits beside Plan vs Actual
                    rather than replacing it. */}
                <Route path="/projects/:id/journey" element={<JourneyMapPage />} />
                {/* The 16-phase flow from the UI specs, as one page — the board,
                    the two parallel pairs, the three gates and the spec tables.
                    It reads the spec's own constants rather than the project
                    API, so it answers on both addresses: the project-scoped one
                    that matches the context bar it draws, and a bare one for
                    linking straight to it. See PmsFlowPage.jsx. */}
                <Route path="/pms-flow" element={<PmsFlowPage />} />
                <Route path="/projects/:id/pms-flow" element={<PmsFlowPage />} />
                {/* Phase 5 — the 37-drawing checklist. The board shows the whole
                    master so the GAP is visible; filing and approving each
                    drawing stays on the phase page. Set 1 gates the BOQ. */}
                <Route path="/projects/:id/drawings" element={<DrawingChecklistPage />} />
                {/* Design & Drawings FMS — the same checklist master, across every
                    project. A management dashboard, not a second checklist. */}
                <Route path="/design-drawings" element={<Gate k={NAV_KEYS.DESIGN_DRAWINGS}><DesignDrawingsDashboardPage /></Gate>} />
                {/* The FMS rail itself, project picked in-page. A static segment,
                    so React Router ranks it above the `:id` route below it. */}
                {/* `/metric/:metric` sits above `/:id` so "metric" is matched as
                    the literal segment rather than as a project id. */}
                <Route path="/design-drawings/metric/:metric" element={<Gate k={NAV_KEYS.DESIGN_DRAWINGS}><DesignDrawingsMetricPage /></Gate>} />
                <Route path="/design-drawings/fms" element={<Gate k={NAV_KEYS.DESIGN_DRAWINGS_FMS}><DesignDrawingsProjectPage /></Gate>} />
                <Route path="/design-drawings/:id" element={<Gate k={NAV_KEYS.DESIGN_DRAWINGS_FMS}><DesignDrawingsProjectPage /></Gate>} />
                {/* Phase 7 — the seven BOQs, each totalled and approved on its
                    own, with the quantities-and-rates convergence stated. */}
                <Route path="/projects/:id/boq" element={<BoqWorkspacePage />} />
                {/* Phase 8 — contracts, and the ordering they release. */}
                <Route path="/projects/:id/contracts" element={<ContractsPage />} />
                {/* Phase 6 — the standing panel. Seven rows, one per BOQ, each
                    asking only which team and at what rate. The firm-level
                    vendor master stays at /vendors; this is the per-site half. */}
                <Route path="/projects/:id/vendor-panel" element={<VendorPanelPage />} />
                <Route path="/projects/:id/vendor-panel/:vendorId" element={<VendorRateCardPage />} />
                {/* Generic phase page — every phase without a purpose-built one
                    gets a real URL here rather than opening in a modal. */}
                <Route path="/projects/:id/phase/:stageKey" element={<PhasePage />} />
                {/* A p13 BOQ record as a sendable, printable purchase order. */}
                <Route path="/projects/:id/purchase-order/:recordId" element={<PurchaseOrderPage />} />
                <Route path="/projects/:id/invoice/:recordId" element={<InvoicePage />} />
                {/* Phase 6 — the order tracker over the Phase 5 BOQ lines (stage p15). */}
                <Route path="/projects/:id/procurement" element={<ProcurementTrackerPage />} />
                {/* One purchase order — everything about it, editable in place. */}
                <Route path="/projects/:id/procurement/:recordId" element={<OrderDetailPage />} />
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
                <Route path="/projects/:id/daily-reports" element={<DailyReportsPage />} />
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
                <Route path="/calendar" element={<Gate k={NAV_KEYS.CALENDAR}><CalendarPage /></Gate>} />
                <Route path="/mis" element={<Gate k={NAV_KEYS.MIS}><MisPage /></Gate>} />
                <Route path="/employees" element={<Gate k={NAV_KEYS.EMPLOYEES}><EmployeesPage /></Gate>} />
                <Route path="/settings/whatsapp" element={<Gate k={NAV_KEYS.WHATSAPP}><WhatsappSettingsPage /></Gate>} />
                {/* Who sees which module and which STEP of which flow. Gated by
                    the same mechanism it administers — `module:access` — so the
                    company can move permission administration without a deploy.
                    The server refuses to let the MD's own control of it be
                    revoked; there is no way back from that inside the app. */}
                <Route path="/settings/access" element={<Gate k={NAV_KEYS.ACCESS}><AccessControlPage /></Gate>} />
                {/* Who each recurring job in a flow goes to — the work, not
                    the permissions. Its own grant, so a project head can hand
                    out assessments without being able to widen anyone's
                    access. */}
                <Route path="/settings/fms-assign" element={<Gate k={NAV_KEYS.FMS_ASSIGN}><FmsAssignPage /></Gate>} />
                {/* Master data — the game catalogue Phase 3B and Phase 10 read. */}
                <Route path="/games" element={<Gate k={NAV_KEYS.GAMES}><GamesPage /></Gate>} />
                {/* Master data — the stock catalogue, migrated from the BoxHero
                    export. A catalogue, not a stock count: see InventoryPage.jsx. */}
                <Route path="/inventory" element={<Gate k={NAV_KEYS.INVENTORY}><InventoryPage /></Gate>} />

{/* CRM — its own mount point and layout, not a PMS phase. Routes,
                    titles, breadcrumbs and permissions all come from one config
                    (features/crm/config/crm.routes.config.js) via
                    lib/moduleRoutes.jsx — the same source Sidebar.jsx and
                    Breadcrumbs.jsx read.

                    MUST stay ABOVE the catch-all: a route declared after
                    `path="*"` is unreachable, and /crm/dashboard then silently
                    redirects to the PMS dashboard. That exact bug has happened
                    here before. */}
                {/* CRM hidden for now — uncomment to bring the module back.
                <Route path="/crm/*" element={<Gate k={NAV_KEYS.CRM}><CrmLayout /></Gate>}>
                  {crmRouteElements}
                </Route>
                */}

                {/* HRMS — same config-driven mount as CRM. Above the
                    catch-all for the same reason CRM documents. */}
                <Route path="/hrms" element={<Navigate to="/hrms/overview" replace />} />
                <Route path="/hrms/*" element={<Gate k={NAV_KEYS.HRMS}><HrmsLayout /></Gate>}>
                  {hrmsRouteElements}
                </Route>

                {/* Property (FMS) — sourcing a site, which happens BEFORE
                    there is a project. Three steps: capture, assessment,
                    commercial closure. Same config-driven mount as Purchase,
                    and above the catch-all for the reason CRM documents. */}
                <Route path="/property" element={<Navigate to="/property/capture" replace />} />
                <Route path="/property/*" element={<Gate k={NAV_KEYS.PROPERTY_CAPTURE}><PropertySteps /></Gate>}>
                  {propertyRouteElements}
                </Route>

                {/* Purchase — the company-wide view of every project's
                    orders, deliveries and GRNs. Same config-driven mount. */}
                <Route path="/purchase" element={<Navigate to="/purchase/overview" replace />} />
                <Route path="/purchase/*" element={<Gate k={NAV_KEYS.PURCHASE}><PurchaseLayout /></Gate>}>
                  {purchaseRouteElements}
                </Route>

                {/* Inventory Management — stock, movements and locations.
                    Its own mount beside Purchase; the item CATALOGUE stays at
                    /inventory under Master Data. Above the catch-all for the
                    reason the CRM block documents. */}
                <Route path="/ims" element={<Navigate to="/ims/overview" replace />} />
                <Route path="/ims/*" element={<Gate k={NAV_KEYS.IMS}><ImsLayout /></Gate>}>
                  {imsRouteElements}
                </Route>

                {/* ERS — Employee Performance, read-only over the customer
                    feedback service. Above the catch-all for the reason the
                    CRM block documents. */}
                <Route path="/ers" element={<Navigate to="/ers/overview" replace />} />
                <Route path="/ers/*" element={<Gate k={NAV_KEYS.ERS}><ErsLayout /></Gate>}>
                  {ersRouteElements}
                </Route>

                {/* Franchise (FMS) — the enquiry queue and the decision. The
                    public form is /franchise/apply, declared outside the
                    shell above; everything else under /franchise is gated. */}
                <Route path="/franchise" element={<Navigate to="/franchise/overview" replace />} />
                <Route path="/franchise/*" element={<Gate k={NAV_KEYS.FRANCHISE}><FranchiseLayout /></Gate>}>
                  {franchiseRouteElements}
                </Route>

                {/* Delegation — every route behind the same module gate the
                    sidebar uses; the server enforces it again on the API. */}
                <Route path="/delegation" element={<Navigate to="/delegation/my-work" replace />} />
                <Route path="/delegation/my-work" element={<Gate k={NAV_KEYS.DELEGATION}><MyWorkPage /></Gate>} />
                <Route path="/delegation/tasks/:taskId" element={<Gate k={NAV_KEYS.DELEGATION}><MyWorkPage /></Gate>} />
                <Route path="/delegation/delegated" element={<Gate k={NAV_KEYS.DELEGATION}><TasksPage mode="delegated" /></Gate>} />
                <Route path="/delegation/loop" element={<Gate k={NAV_KEYS.DELEGATION}><TasksPage mode="loop" /></Gate>} />
                <Route path="/delegation/all" element={<Gate k={NAV_KEYS.DELEGATION}><TasksPage mode="all" /></Gate>} />
                <Route path="/delegation/groups" element={<Gate k={NAV_KEYS.DELEGATION}><GroupsPage /></Gate>} />
                <Route path="/delegation/groups/:id" element={<Gate k={NAV_KEYS.DELEGATION}><GroupsPage /></Gate>} />
                <Route path="/delegation/repeats" element={<Gate k={NAV_KEYS.DELEGATION}><RepeatsPage /></Gate>} />
                <Route path="/delegation/trash" element={<Gate k={NAV_KEYS.DELEGATION}><TrashPage /></Gate>} />

                {/* Checklist */}
                <Route path="/checklist" element={<Gate k={NAV_KEYS.CHECKLIST}><ChecklistPage /></Gate>} />

                {/* Organisation & ops performance */}
                <Route path="/performance" element={<Gate k={NAV_KEYS.OPS_PERFORMANCE}><PerformancePage /></Gate>} />
                <Route path="/org/teams" element={<Gate k={NAV_KEYS.ORGANISATION}><TeamsPage /></Gate>} />
                <Route path="/org/branches" element={<Gate k={NAV_KEYS.ORGANISATION}><BranchesPage /></Gate>} />
                <Route path="/org/settings" element={<Gate k={NAV_KEYS.ORGANISATION}><OpsSettingsPage /></Gate>} />
                <Route path="/org/activity" element={<Gate k={NAV_KEYS.ORGANISATION}><ActivityPage /></Gate>} />

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
