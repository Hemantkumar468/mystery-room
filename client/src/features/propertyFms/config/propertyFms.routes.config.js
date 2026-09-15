import { lazy } from 'react';
import { LayoutDashboard, Inbox, ClipboardCheck, Search, ShieldCheck, FileSignature, Rocket } from 'lucide-react';

/**
 * Single source of truth for the Property FMS module — routing, sidebar,
 * breadcrumbs, titles and icons, read by lib/moduleRoutes.jsx exactly as
 * Franchise/HRMS/Purchase are. A separate module from Franchise: Franchise is
 * the short "enquiry → MD decision → project at Phase 3" road, while this is
 * the fuller six-phase pipeline — Property Capture through Project Creation —
 * shown end to end with its own Overview.
 */
export const propertyFmsRoutesConfig = [
  {
    key: 'fms-overview', path: '/property-fms/overview', parentKey: null,
    element: lazy(() => import('../PropertyFmsOverviewPage.jsx')),
    title: 'Property FMS Overview', breadcrumb: 'Overview', icon: LayoutDashboard,
    sidebar: true, order: 0,
    description: 'Complete visibility from opportunity to project creation.',
  },
  {
    key: 'fms-capture', path: '/property-fms/capture', parentKey: 'fms-overview',
    element: lazy(() => import('../PropertyCapturePage.jsx')),
    title: 'Property Capture', breadcrumb: 'Property Capture', icon: Inbox,
    sidebar: true, order: 1,
    description: 'Capture opportunities from interested partners, property owners or external sources.',
  },
  {
    key: 'fms-review', path: '/property-fms/review-decision', parentKey: 'fms-overview',
    element: lazy(() => import('../ReviewDecisionPage.jsx')),
    title: 'Review & Decision', breadcrumb: 'Review & Decision', icon: ClipboardCheck,
    sidebar: true, order: 2,
    description: 'MD reviews all submitted opportunities and takes the first key decision.',
  },
  {
    key: 'fms-research', path: '/property-fms/research', parentKey: 'fms-overview',
    element: lazy(() => import('../PropertyResearchPage.jsx')),
    title: 'Property Research', breadcrumb: 'Property Research', icon: Search,
    sidebar: true, order: 3,
    description: 'Find and evaluate suitable properties for interested leads (no property).',
  },
  {
    key: 'fms-assessment', path: '/property-fms/assessment', parentKey: 'fms-overview',
    element: lazy(() => import('../FmsAssessmentPage.jsx')),
    title: 'Assessment', breadcrumb: 'Assessment', icon: ShieldCheck,
    sidebar: true, order: 4,
    description: 'Evaluate shortlisted properties for technical, financial, operational and market feasibility.',
  },
  {
    key: 'fms-loi', path: '/property-fms/loi-commercial', parentKey: 'fms-overview',
    element: lazy(() => import('../LoiCommercialPage.jsx')),
    title: 'LOI & Commercial Finalization', breadcrumb: 'LOI & Commercial', icon: FileSignature,
    sidebar: true, order: 5,
    description: 'Manage LOI, legal clearance, lease negotiation and commercial finalization.',
  },
  {
    key: 'fms-creation', path: '/property-fms/project-creation', parentKey: 'fms-overview',
    element: lazy(() => import('../ProjectCreationFmsPage.jsx')),
    title: 'Project Creation', breadcrumb: 'Project Creation', icon: Rocket,
    sidebar: true, order: 6,
    description: 'Create and manage projects for approved properties with signed agreements.',
  },
];

export default propertyFmsRoutesConfig;
