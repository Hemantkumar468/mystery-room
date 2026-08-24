import { lazy } from 'react';
import { LayoutDashboard, BriefcaseBusiness, Users } from 'lucide-react';

/**
 * Single source of truth for the HRMS module — routing, sidebar, breadcrumbs,
 * titles and icons all read this one array via lib/moduleRoutes.jsx, exactly
 * as CRM does. Adding a screen is one entry here.
 */
export const hrmsRoutesConfig = [
  {
    key: 'hrms-overview', path: '/hrms/overview', parentKey: null,
    element: lazy(() => import('../HrmsOverviewPage.jsx')),
    title: 'Hiring Overview', breadcrumb: 'Overview', icon: LayoutDashboard,
    sidebar: true, order: 0,
    description: 'Open roles, pipeline totals and hiring per centre.',
  },
  {
    key: 'hrms-requisitions', path: '/hrms/requisitions', parentKey: 'hrms-overview',
    element: lazy(() => import('../RequisitionListPage.jsx')),
    title: 'Requisitions', breadcrumb: 'Requisitions', icon: BriefcaseBusiness,
    sidebar: true, order: 1,
    description: 'Every role being hired — its JD, its status and its pipeline.',
  },
  {
    key: 'hrms-requisition-detail', path: '/hrms/requisitions/:id', parentKey: 'hrms-requisitions',
    element: lazy(() => import('../RequisitionDetailPage.jsx')),
    title: 'Requisition', breadcrumb: 'Requisition', icon: BriefcaseBusiness,
    sidebar: false,
    description: 'One role: the JD, the apply link and the candidate pipeline.',
  },
  {
    key: 'hrms-candidates', path: '/hrms/candidates', parentKey: 'hrms-overview',
    element: lazy(() => import('../CandidateListPage.jsx')),
    title: 'Candidates', breadcrumb: 'Candidates', icon: Users,
    sidebar: true, order: 2,
    description: 'Every application, across every role.',
  },
];

export default hrmsRoutesConfig;
