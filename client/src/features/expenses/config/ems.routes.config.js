import { lazy } from 'react';
import {
  LayoutDashboard, Receipt, Tag, Store, Building2, PiggyBank,
  CheckSquare, CreditCard, Calculator, FileBarChart,
} from 'lucide-react';
import { CAN_MANAGE } from '../../../lib/roles.js';

/** Categories/Vendors/Branches are master-data admin screens — same
 * existing ROLES.ADMIN/ROLES.MANAGER used by task.routes.js's `canManage`,
 * reused here rather than inventing a new role for a step with no real
 * financeRole model yet (that lands in a later step). */
/* `allowed: ['admin', 'manager']` — 'admin' has not been a role since the
   MD/EA split, so this gate hid Vendors/Branches/Categories from the MD, the
   one person guaranteed to be allowed. Sourced from CAN_MANAGE now so it
   tracks the role model instead of a hardcoded snapshot of it. */
const ADMIN_MANAGER = { allowed: CAN_MANAGE };

/**
 * Single source of truth for the EMS module — routing, sidebar,
 * breadcrumbs, permissions, titles, icons, and future navigation all read
 * from this one array (see lib/moduleRoutes.jsx). Adding a new EMS screen
 * means adding one entry here, not hand-editing App.jsx, Sidebar.jsx, and a
 * breadcrumb component separately.
 *
 * `path` is the full absolute URL. `sidebar: true` entries appear in the
 * EMS nav group, ordered by `order`. Detail/create/edit screens reachable
 * only from their parent list are `sidebar: false` but still carry
 * `breadcrumb`/`title`/`parentKey` so the breadcrumb trail resolves.
 *
 * `soon: true` marks a screen whose `element` is still Step 1's placeholder
 * (no real backend/frontend behind it yet) — ModuleNavGroup renders it
 * exactly like the top-level "Soon" modules (CRM/HRMS/…) in Sidebar.jsx:
 * visible, non-clickable, badged. Only Branches (Step 2.1) has shipped;
 * every other entry stays `soon` until its own step lands and this flag is
 * removed from it specifically — this config's shape doesn't otherwise
 * change when that happens.
 */
export const emsRoutesConfig = [
  {
    key: 'ems-dashboard', path: '/ems/dashboard', parentKey: null,
    element: lazy(() => import('../EmsDashboardPage.jsx')),
    title: 'Dashboard', breadcrumb: 'Dashboard', icon: LayoutDashboard,
    sidebar: true, order: 1, soon: true, description: 'EMS overview and key metrics.',
  },
  {
    key: 'ems-expenses', path: '/ems/expenses', parentKey: null,
    element: lazy(() => import('../ExpenseListPage.jsx')),
    title: 'Expense Requests', breadcrumb: 'Expenses', icon: Receipt,
    sidebar: true, order: 2, soon: true, description: 'All expense requests across branches.',
  },
  {
    key: 'ems-expenses-new', path: '/ems/expenses/new', parentKey: 'ems-expenses',
    element: lazy(() => import('../NewExpensePage.jsx')),
    title: 'New Expense Request', breadcrumb: 'New', icon: Receipt,
    sidebar: false, soon: true, description: 'Submit a new expense request.',
  },
  {
    key: 'ems-expense-detail', path: '/ems/expenses/:expenseId', parentKey: 'ems-expenses',
    element: lazy(() => import('../ExpenseDetailPage.jsx')),
    title: 'Expense Details', breadcrumb: 'Details', icon: Receipt,
    sidebar: false, soon: true, description: 'View a single expense request.',
  },
  {
    key: 'ems-expense-edit', path: '/ems/expenses/:expenseId/edit', parentKey: 'ems-expense-detail',
    element: lazy(() => import('../ExpenseEditPage.jsx')),
    title: 'Edit Expense Request', breadcrumb: 'Edit', icon: Receipt,
    sidebar: false, soon: true, description: 'Edit an expense request.',
  },
  {
    key: 'ems-categories', path: '/ems/categories', parentKey: null,
    element: lazy(() => import('../ExpenseCategoriesPage.jsx')),
    title: 'Expense Categories', breadcrumb: 'Categories', icon: Tag,
    sidebar: true, order: 3, soon: true, permission: ADMIN_MANAGER,
    description: 'Manage fixed/variable expense categories.',
  },
  {
    key: 'ems-vendors', path: '/ems/vendors', parentKey: null,
    element: lazy(() => import('../VendorsPage.jsx')),
    title: 'Vendors', breadcrumb: 'Vendors', icon: Store,
    sidebar: true, order: 4, soon: true, permission: ADMIN_MANAGER,
    description: 'Manage vendor master records.',
  },
  {
    key: 'ems-branches', path: '/ems/branches', parentKey: null,
    element: lazy(() => import('../BranchesPage.jsx')),
    title: 'Branches', breadcrumb: 'Branches', icon: Building2,
    sidebar: true, order: 5, permission: ADMIN_MANAGER,
    description: 'Manage branches expenses are attributed to.',
  },
  {
    key: 'ems-budgets', path: '/ems/budgets', parentKey: null,
    element: lazy(() => import('../BudgetsPage.jsx')),
    title: 'Budgets', breadcrumb: 'Budgets', icon: PiggyBank,
    sidebar: true, order: 6, soon: true, description: 'Budget allocation and consumption.',
  },
  {
    key: 'ems-approvals', path: '/ems/approvals', parentKey: null,
    element: lazy(() => import('../ApprovalsQueuePage.jsx')),
    title: 'Approval Queue', breadcrumb: 'Approvals', icon: CheckSquare,
    sidebar: true, order: 7, soon: true, description: 'Expenses waiting on your approval.',
  },
  {
    key: 'ems-payments', path: '/ems/payments', parentKey: null,
    element: lazy(() => import('../PaymentsPage.jsx')),
    title: 'Payments', breadcrumb: 'Payments', icon: CreditCard,
    sidebar: true, order: 8, soon: true, description: 'Payment processing queue.',
  },
  {
    key: 'ems-accounting', path: '/ems/accounting', parentKey: null,
    element: lazy(() => import('../AccountingPage.jsx')),
    title: 'Accounting', breadcrumb: 'Accounting', icon: Calculator,
    sidebar: true, order: 9, soon: true, description: 'Tally ledger mapping and export.',
  },
  {
    key: 'ems-reports', path: '/ems/reports', parentKey: null,
    element: lazy(() => import('../ReportsPage.jsx')),
    title: 'Reports & Analytics', breadcrumb: 'Reports', icon: FileBarChart,
    sidebar: true, order: 10, soon: true,
    description: 'Expense analytics by branch, department, project, vendor.',
  },
];

export default emsRoutesConfig;
