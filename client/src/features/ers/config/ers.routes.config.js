import { lazy } from 'react';
import { LayoutDashboard, Trophy } from 'lucide-react';

/**
 * Single source of truth for the ERS module — routing, sidebar, breadcrumbs,
 * titles and icons all read this one array via lib/moduleRoutes.jsx, exactly
 * as Purchase, IMS and HRMS do. Adding a screen is one entry.
 *
 * WHY ERS IS ITS OWN MODULE. It reads a different system entirely
 * (feedback.mysteryrooms.co.in), it is read-only, and its audience is whoever
 * runs the outlets rather than whoever runs a build. Folding it into HRMS would
 * suggest these are appraisal records the company owns and can edit; they are
 * neither.
 */
export const ersRoutesConfig = [
  {
    key: 'ers-overview', path: '/ers/overview', parentKey: null,
    element: lazy(() => import('../ErsOverviewPage.jsx')),
    title: 'Performance', breadcrumb: 'Performance', icon: LayoutDashboard,
    sidebar: true, order: 0,
    description: 'Ratings, bands and the top performers across every outlet.',
  },
  {
    key: 'ers-leaderboard', path: '/ers/leaderboard', parentKey: 'ers-overview',
    element: lazy(() => import('../ErsLeaderboardPage.jsx')),
    title: 'Leaderboard', breadcrumb: 'Leaderboard', icon: Trophy,
    sidebar: true, order: 1,
    description: 'Every employee ranked by composite score, with filters and full detail.',
  },
];

export default ersRoutesConfig;
