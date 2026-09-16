import { lazy } from 'react';
import { Inbox, ClipboardCheck, FileSignature, Rocket } from 'lucide-react';

/**
 * Single source of truth for the Property module — routing, sidebar,
 * breadcrumbs, titles and icons all read this one array via
 * lib/moduleRoutes.jsx, exactly as Purchase and HRMS do.
 *
 * WHY PROPERTY IS ITS OWN MODULE AND NOT A PMS PAGE. Sourcing a site is not a
 * phase of a project — it is what happens BEFORE there is a project worth
 * running. Properties arrive from the franchise link, the broker link and the
 * MD's own asks, most of them never become a project at all, and the people
 * working the queue are not the people running builds. Inside PMS it read as
 * a report on projects, which is the one thing it is not.
 *
 * THE THREE STEPS ARE THE FLOW, not a menu. A property enters at Step 1, and
 * the decision taken on its row is what moves it to Step 2 or Step 3. Nothing
 * is filed twice: each step is the same property record seen at the point its
 * own work happens.
 */
export const propertyRoutesConfig = [
  {
    key: 'property-capture', path: '/property/capture', parentKey: null,
    element: lazy(() => import('../PropertyCapturePage.jsx')),
    title: 'Step 1 · Property Capture', breadcrumb: 'Capture', icon: Inbox,
    sidebar: true, order: 0,
    description: 'Every property in front of us — franchisee, broker, or asked for by the MD.',
  },
  {
    key: 'property-assessment', path: '/property/assessment', parentKey: 'property-capture',
    element: lazy(() => import('../PropertyAssessmentPage.jsx')),
    title: 'Step 2 · Assessment', breadcrumb: 'Assessment', icon: ClipboardCheck,
    sidebar: true, order: 1,
    description: 'Properties being assessed — open a form, then shortlist or reject.',
  },
  {
    key: 'property-commercial', path: '/property/commercial', parentKey: 'property-capture',
    element: lazy(() => import('../PropertyCommercialPage.jsx')),
    title: 'Step 3 · Commercial Finalization', breadcrumb: 'Commercial', icon: FileSignature,
    sidebar: true, order: 2,
    description: 'Shortlisted properties closing — the six documents, one column each.',
  },
  {
    key: 'property-planning', path: '/property/planning', parentKey: 'property-capture',
    element: lazy(() => import('../PropertyPlanningPage.jsx')),
    title: 'Step 4 · Project & Games Planning', breadcrumb: 'Project & Games', icon: Rocket,
    sidebar: true, order: 3,
    description: 'Signed sites — choose the games, fix the opening date, create the project.',
  },
];

export default propertyRoutesConfig;
