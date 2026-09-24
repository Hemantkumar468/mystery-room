import { lazy } from 'react';
import { LayoutDashboard, Inbox } from 'lucide-react';

/**
 * Single source of truth for the Franchise module (FMS) — routing, sidebar,
 * breadcrumbs, titles and icons all read this one array via
 * lib/moduleRoutes.jsx, exactly as HRMS and Purchase do.
 *
 * A franchise enquiry is the SHORT road into the PMS pipeline: a prospect
 * arrives with a property and the commitment, the MD says yes or no, and a
 * yes creates a project standing at Phase 3 (LOI) with the property already
 * filed and approved. These screens are that queue and that decision; the
 * project it creates then lives in PMS like any other launch.
 */
export const franchiseRoutesConfig = [
  {
    key: 'franchise-overview', path: '/franchise/overview', parentKey: null,
    element: lazy(() => import('../FranchiseOverviewPage.jsx')),
    title: 'Franchise Overview', breadcrumb: 'Overview', icon: LayoutDashboard,
    sidebar: true, order: 0,
    description: 'Enquiries waiting for a decision, cities asking, and the link to share.',
  },
  {
    key: 'franchise-enquiries', path: '/franchise/enquiries', parentKey: 'franchise-overview',
    element: lazy(() => import('../FranchiseEnquiriesPage.jsx')),
    title: 'Franchise Enquiries', breadcrumb: 'Enquiries', icon: Inbox,
    sidebar: true, order: 1,
    description: 'Every enquiry — who, where, what property — and the yes or no.',
  },
  {
    key: 'franchise-application', path: '/franchise/enquiries/:id', parentKey: 'franchise-enquiries',
    element: lazy(() => import('../FranchiseApplicationPage.jsx')),
    title: 'Franchise Application', breadcrumb: 'Application', icon: Inbox,
    sidebar: false, order: 2,
    description: 'One application in full — every property, every file — and the decision.',
  },
];

export default franchiseRoutesConfig;
