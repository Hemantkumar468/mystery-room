/**
 * Who sees which top-level destination.
 *
 * One table, deliberately. The sidebar previously filtered nothing at all:
 * every role saw Templates, Employees and MIS identically, so an Employee
 * whose entire job is completing assigned tasks was handed the Managing
 * Director's nav and left to work out which nine of the ten entries were not
 * for them. This is the whole policy — changing who sees what is an edit here,
 * not a hunt through components.
 *
 * Two rules this file exists to keep:
 *
 *  1. Nothing branches on a role string anywhere else. Same rule as
 *     lib/roles.js — the app had five separate components checking for roles
 *     ('admin', 'executor') that had not existed since the MD/EA split, each
 *     silently false, and a sixth copy here would have been the next one to rot.
 *  2. This is UX only. The server's `authorize()` middleware is the actual
 *     boundary; hiding a link the user would be refused anyway just spares
 *     them a 403.
 */
import { ROLES } from './roles.js';

/**
 * Stable keys for every top-level destination. Nav arrays carry a `key`, and
 * the policy below is keyed by the same value, so a renamed label or moved
 * route cannot silently detach an entry from its permission.
 */
export const NAV_KEYS = Object.freeze({
  MY_TASKS: 'my-tasks',
  DASHBOARD: 'dashboard',
  PROJECTS: 'projects',
  GANTT: 'gantt',
  PROPERTIES: 'properties',
  NETWORK_MAP: 'network-map',
  APPROVALS: 'approvals',
  CALENDAR: 'calendar',
  MIS: 'mis',
  PLAN_VS_ACTUAL: 'plan-vs-actual',
  VENDORS: 'vendors',
  HRMS: 'hrms',
  GUIDE: 'guide',
  TEMPLATES: 'templates',
  EMPLOYEES: 'employees',
  CRM: 'crm',
});

/**
 * Role → the destinations that role may see.
 *
 *                   MD  EA  Manager  Employee  Viewer
 *   My Tasks         ✓   ✓     ✓        ✓         ·
 *   Dashboard        ✓   ✓     ✓        ·         ✓
 *   Projects         ✓   ✓     ✓        ✓         ✓
 *   Properties       ✓   ✓     ✓        ✓         ✓
 *   Network Map      ✓   ✓     ✓        ·         ✓
 *   Approvals        ✓   ✓     ✓        ·         ·
 *   Calendar         ✓   ✓     ✓        ✓         ✓
 *   MIS & Analytics  ✓   ✓     ✓        ·         ✓
 *   Templates        ✓   ✓     ✓        ·         ·
 *   Employees        ✓   ·     ·        ·         ·
 *   CRM              ✓   ✓     ✓        ✓         ·
 *
 * The Employee column is the point of the exercise: their own work, the
 * projects and properties they work on, and the calendar. No approvals queue
 * they cannot action, no portfolio analytics, no template authoring.
 *
 * Viewer is read-only and has no assigned work, so My Tasks would always be
 * empty for them — it is omitted rather than shown permanently blank.
 */
const K = NAV_KEYS;

export const NAV_POLICY = Object.freeze({
  [ROLES.MD]: [
    K.MY_TASKS, K.DASHBOARD, K.PROJECTS, K.GANTT, K.PLAN_VS_ACTUAL, K.PROPERTIES, K.VENDORS, K.HRMS, K.NETWORK_MAP,
    K.APPROVALS, K.CALENDAR, K.MIS, K.TEMPLATES, K.EMPLOYEES, K.CRM, K.GUIDE,
  ],
  [ROLES.EA]: [
    K.MY_TASKS, K.DASHBOARD, K.PROJECTS, K.GANTT, K.PLAN_VS_ACTUAL, K.PROPERTIES, K.VENDORS, K.HRMS, K.NETWORK_MAP,
    K.APPROVALS, K.CALENDAR, K.MIS, K.TEMPLATES, K.CRM, K.GUIDE,
  ],
  [ROLES.MANAGER]: [
    K.MY_TASKS, K.DASHBOARD, K.PROJECTS, K.GANTT, K.PLAN_VS_ACTUAL, K.PROPERTIES, K.VENDORS, K.HRMS, K.NETWORK_MAP,
    K.APPROVALS, K.CALENDAR, K.MIS, K.TEMPLATES, K.CRM, K.GUIDE,
  ],
  // The map is a portfolio view — an Employee's job is their own task queue,
  // and a national map of sites they do not work on is the same kind of noise
  // MIS is. Same reasoning, same answer.
  [ROLES.EMPLOYEE]: [
    K.MY_TASKS, K.PROJECTS, K.GANTT, K.PROPERTIES, K.CALENDAR, K.HRMS, K.CRM, K.GUIDE,
  ],
  // Read-only reporting is exactly what a Viewer exists for.
  [ROLES.VIEWER]: [
    K.DASHBOARD, K.PROJECTS, K.GANTT, K.PLAN_VS_ACTUAL, K.PROPERTIES, K.NETWORK_MAP, K.CALENDAR, K.MIS, K.GUIDE,
  ],
});

/**
 * Can this user see this destination?
 *
 * An unknown or missing role gets nothing. That is the safe direction: a user
 * whose role failed to load should not be handed the full MD nav for the
 * moment before it resolves, and a role added to the server without being
 * added here shows up as a missing link rather than a leaked one.
 */
export function canSeeNav(user, key) {
  const allowed = NAV_POLICY[user?.role];
  return Array.isArray(allowed) && allowed.includes(key);
}

/** Filter a nav array (anything carrying `key`) down to what this user sees. */
export const filterNav = (items, user) => items.filter((item) => canSeeNav(user, item.key));

/**
 * The same rule shaped as a route `requirement`, for RequireRole.
 *
 * Hiding a nav link is not a gate — the route still answers to anyone who
 * types the URL. Wrapping the route with this keeps the two in lockstep off
 * one table, instead of a hidden link and an open page disagreeing about who
 * is allowed. Still UX only; the server remains the real boundary.
 */
export const navRequirement = (key) => ({ check: (user) => canSeeNav(user, key) });

/**
 * Where a role belongs after login.
 *
 * An Employee landing on the portfolio Dashboard has to go looking for their
 * own work; their tasks are the reason they opened the app. Every other role
 * keeps the Dashboard, which is genuinely their overview.
 */
export function landingPathFor(user) {
  return user?.role === ROLES.EMPLOYEE ? '/my-tasks' : '/';
}

export default NAV_POLICY;
