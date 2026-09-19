import { lazy } from 'react';
import { Inbox, Gavel, ClipboardCheck, Trophy, FileSignature, Rocket } from 'lucide-react';

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
 * THE STEPS ARE THE FLOW, not a menu. A property enters at Step 1, leaves it
 * down one of three roads at Step 2, and Step 4 is the MD's second gate — the
 * single site that goes forward per project. Nothing is filed twice: each step
 * is the same property record seen at the point its own work happens.
 *
 * TWO MD GATES, DELIBERATELY, and they answer different questions. Step 2
 * asks WHICH ROAD one captured property takes (assess it, close on it, or
 * build it); Step 4 asks WHICH SITE wins once the assessments are in. The
 * titles differ — Decision, then Approval — because a step called the same
 * thing twice is a step nobody can be sent to.
 */
export const propertyRoutesConfig = [
  {
    key: 'property-capture', path: '/property/capture', parentKey: null,
    element: lazy(() => import('../PropertyCapturePage.jsx')),
    title: 'Step 1 · All Properties', breadcrumb: 'All Properties', icon: Inbox,
    sidebar: true, order: 0,
    description: 'Every property in front of us — franchisee, broker, or asked for by the MD.',
  },
  {
    /**
     * The one decision the flow turns on, as a step of its own.
     *
     * It was a button on Step 1 for a while, and that put a decision one
     * person owns inside a queue of twenty-five rows most of which are not
     * decisions at all — standing asks, public submissions, sites already
     * routed. Its own step is a list of exactly what is waiting on the MD.
     */
    key: 'property-md-review', path: '/property/md-review', parentKey: 'property-capture',
    element: lazy(() => import('../PropertyMdReviewPage.jsx')),
    title: 'Step 2 · MD Review & Decision', breadcrumb: 'MD Review & Decision', icon: Gavel,
    sidebar: true, order: 1,
    description: 'Filed properties waiting on one answer — assessment, commercial, or straight to project.',
  },
  {
    key: 'property-assessment', path: '/property/assessment', parentKey: 'property-capture',
    element: lazy(() => import('../PropertyAssessmentPage.jsx')),
    title: 'Step 3 · All Property Assessment', breadcrumb: 'All Property Assessment', icon: ClipboardCheck,
    sidebar: true, order: 2,
    description: 'Properties being assessed — open a form, then shortlist or reject.',
  },
  {
    /* Phase 2's own gate — "unlocks commercial negotiation on exactly one
       selected property" — as the step that takes it. */
    key: 'property-selection', path: '/property/selection', parentKey: 'property-capture',
    element: lazy(() => import('../PropertySelectionPage.jsx')),
    title: 'Step 4 · MD Review & Approval', breadcrumb: 'MD Review & Approval', icon: Trophy,
    sidebar: true, order: 3,
    description: 'Fully assessed properties, side by side — one site chosen per project.',
  },
  {
    key: 'property-commercial', path: '/property/commercial', parentKey: 'property-capture',
    element: lazy(() => import('../PropertyCommercialPage.jsx')),
    title: 'Step 5 · All Property Commercial', breadcrumb: 'All Property Commercial', icon: FileSignature,
    sidebar: true, order: 4,
    description: 'Shortlisted properties closing — the six documents, one column each.',
  },
  {
    key: 'property-planning', path: '/property/planning', parentKey: 'property-capture',
    element: lazy(() => import('../PropertyPlanningPage.jsx')),
    title: 'Step 6 · All Project Creation', breadcrumb: 'All Project Creation', icon: Rocket,
    sidebar: true, order: 5,
    description: 'Signed sites — choose the games, fix the opening date, create the project.',
  },
];

export default propertyRoutesConfig;
