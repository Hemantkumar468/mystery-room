import { lazy } from 'react';
import {
  LayoutDashboard, Users, Columns3, Sun, CheckSquare, Contact2, Building2, Settings,
} from 'lucide-react';

/**
 * The single source of truth for the CRM module — routing, sidebar,
 * breadcrumbs, permissions, titles and icons all read from this one array via
 * lib/moduleRoutes.jsx.
 *
 * ORDER IS THE ARGUMENT THE NAV MAKES. Today first, because that is what an
 * agent opens the module for; Dashboard second, because "how are we doing" is
 * a question asked weekly rather than hourly. Settings last, and only because
 * it has to live somewhere.
 *
 * Adding a screen means adding one entry here — not hand-editing App.jsx,
 * Sidebar.jsx and Breadcrumbs.jsx separately and discovering weeks later that
 * one of them was missed.
 */
export const crmRoutesConfig = [
  {
    key: 'crm-today', path: '/crm/today', parentKey: null,
    element: lazy(() => import('../TodayPage.jsx')),
    title: 'Today', breadcrumb: 'Today', icon: Sun,
    sidebar: true, order: 0,
    description: 'Overdue work, the follow-ups due today, and what is going quiet.',
  },
  {
    key: 'crm-dashboard', path: '/crm/dashboard', parentKey: null,
    element: lazy(() => import('../CrmDashboardPage.jsx')),
    title: 'Dashboard', breadcrumb: 'Dashboard', icon: LayoutDashboard,
    sidebar: true, order: 1,
    description: 'Where the business is coming from, and what needs answering.',
  },
  {
    key: 'crm-leads', path: '/crm/leads', parentKey: 'crm-dashboard',
    element: lazy(() => import('../LeadListPage.jsx')),
    title: 'Leads', breadcrumb: 'Leads', icon: Users,
    sidebar: true, order: 2,
    description: 'Every enquiry, from every source.',
  },
  {
    // Board and list are ONE route with a ?view= parameter, not two entries.
    // They are the same deals asked the same question; two sidebar links would
    // invite two implementations that drift.
    key: 'crm-pipeline', path: '/crm/pipeline', parentKey: 'crm-dashboard',
    element: lazy(() => import('../DealBoardPage.jsx')),
    title: 'Pipeline', breadcrumb: 'Pipeline', icon: Columns3,
    sidebar: true, order: 3,
    description: 'Deals by stage — drag to move, or switch to a sortable list.',
  },
  {
    key: 'crm-tasks', path: '/crm/tasks', parentKey: 'crm-today',
    element: lazy(() => import('../TasksPage.jsx')),
    title: 'Tasks', breadcrumb: 'Tasks', icon: CheckSquare,
    sidebar: true, order: 4,
    description: 'Every follow-up, not just today’s.',
  },
  {
    key: 'crm-contacts', path: '/crm/contacts', parentKey: 'crm-dashboard',
    element: lazy(() => import('../ContactListPage.jsx')),
    title: 'Contacts', breadcrumb: 'Contacts', icon: Contact2,
    sidebar: true, order: 5,
    description: 'The people behind the enquiries.',
  },
  {
    key: 'crm-companies', path: '/crm/companies', parentKey: 'crm-dashboard',
    element: lazy(() => import('../CompanyListPage.jsx')),
    title: 'Companies', breadcrumb: 'Companies', icon: Building2,
    sidebar: true, order: 6,
    description: 'The businesses those people work for.',
  },
  {
    key: 'crm-settings', path: '/crm/settings', parentKey: null,
    element: lazy(() => import('../CrmSettingsPage.jsx')),
    title: 'Settings', breadcrumb: 'Settings', icon: Settings,
    sidebar: true, order: 9,
    description: 'Quiet hours, availability, pipeline stages and lead routing.',
  },
];

export default crmRoutesConfig;
