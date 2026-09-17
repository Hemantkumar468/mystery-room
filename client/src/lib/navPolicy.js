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
  DATA_EXPLORER: 'data-explorer',
  VENDORS: 'vendors',
  // Design & Drawings FMS — the multi-project management dashboard over the
  // 37-drawing checklist. Its own top-level module, same tier as Property/
  // Purchase/Franchise: reached before AND across projects, not nested in PMS.
  DESIGN_DRAWINGS: 'design-drawings',
  /* The FMS itself — the three-step rail where drawings are uploaded,
     reviewed and approved. Separate from the dashboard key because it is a
     different audience: the dashboard is portfolio reporting (no Employee,
     same as MIS), while the rail is where the doers actually work, so the
     architects and designers filing drawings need it. */
  DESIGN_DRAWINGS_FMS: 'design-drawings-fms',
  GAMES: 'games',
  // Property capture — the one queue every property lands in, whichever of the
  // four intakes sent it. Same tier as Properties: the expansion team works it.
  PROPERTY_CAPTURE: 'property-capture',
  HRMS: 'hrms',
  // Purchase — every project's orders, deliveries and GRNs seen company-wide.
  // The doers update trackers, so Employee is in; Viewer reads it like MIS.
  PURCHASE: 'purchase',
  // Franchise (FMS) — the enquiry queue and the yes/no that creates a project.
  // Decision-tier: the list is a queue for the people who can clear it.
  FRANCHISE: 'franchise',
  GUIDE: 'guide',
  TEMPLATES: 'templates',
  EMPLOYEES: 'employees',
  CRM: 'crm',
  // Admin surface for the WhatsApp notification channel: the template mirror,
  // event mapping and delivery logs. Leadership + Manager only — it decides
  // what messages every doer receives.
  WHATSAPP: 'whatsapp',
});

/**
 * Role → the destinations that role may see.
 *
 *                   MD  EA  Manager  Employee  Viewer
 *   Dashboard        ✓   ✓     ✓        ·         ✓
 *   My Tasks         ✓   ✓     ✓        ✓         ·
 *   Projects         ✓   ✓     ✓        ✓         ✓
 *   Properties       ✓   ✓     ✓        ✓         ✓
 *   Network Map      ✓   ✓     ✓        ·         ✓
 *   Approvals        ✓   ✓     ✓        ·         ·
 *   Calendar         ✓   ✓     ✓        ✓         ✓
 *   MIS & Analytics  ✓   ✓     ✓        ·         ✓
 *   Templates        ✓   ✓     ✓        ·         ·
 *   Employees        ✓   ·     ·        ·         ·
 *   CRM              ✓   ✓     ✓        ✓         ·
 *   HRMS             ✓   ✓     ✓        ✓         ·
 *   Purchase         ✓   ✓     ✓        ✓         ✓
 *   Franchise        ✓   ✓     ✓        ·         ·
 *   WhatsApp         ✓   ✓     ✓        ·         ·
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
    K.DASHBOARD, K.MY_TASKS, K.PROJECTS, K.GANTT, K.PLAN_VS_ACTUAL, K.DATA_EXPLORER, K.PROPERTIES, K.PROPERTY_CAPTURE, K.DESIGN_DRAWINGS, K.DESIGN_DRAWINGS_FMS, K.VENDORS, K.HRMS, K.PURCHASE, K.FRANCHISE, K.NETWORK_MAP,
    K.APPROVALS, K.CALENDAR, K.MIS, K.TEMPLATES, K.EMPLOYEES, K.CRM, K.WHATSAPP, K.GUIDE,
   K.GAMES,],
  [ROLES.EA]: [
    K.DASHBOARD, K.MY_TASKS, K.PROJECTS, K.GANTT, K.PLAN_VS_ACTUAL, K.DATA_EXPLORER, K.PROPERTIES, K.PROPERTY_CAPTURE, K.DESIGN_DRAWINGS, K.DESIGN_DRAWINGS_FMS, K.VENDORS, K.HRMS, K.PURCHASE, K.FRANCHISE, K.NETWORK_MAP,
    K.APPROVALS, K.CALENDAR, K.MIS, K.TEMPLATES, K.CRM, K.WHATSAPP, K.GUIDE,
   K.GAMES,],
  [ROLES.MANAGER]: [
    K.DASHBOARD, K.MY_TASKS, K.PROJECTS, K.GANTT, K.PLAN_VS_ACTUAL, K.DATA_EXPLORER, K.PROPERTIES, K.PROPERTY_CAPTURE, K.DESIGN_DRAWINGS, K.DESIGN_DRAWINGS_FMS, K.VENDORS, K.HRMS, K.PURCHASE, K.FRANCHISE, K.NETWORK_MAP,
    K.APPROVALS, K.CALENDAR, K.MIS, K.TEMPLATES, K.CRM, K.WHATSAPP, K.GUIDE,
   K.GAMES,],
  // The map is a portfolio view — an Employee's job is their own task queue,
  // and a national map of sites they do not work on is the same kind of noise
  // MIS is. Same reasoning, same answer. Purchase stays: the order tracker is
  // the doer's own work, and the cross-project sheet is how a coordinator
  // finds every delivery they are chasing without opening projects one by one.
  [ROLES.EMPLOYEE]: [
    K.MY_TASKS, K.PROJECTS, K.GANTT, K.PROPERTIES, K.PROPERTY_CAPTURE, K.DESIGN_DRAWINGS_FMS, K.CALENDAR, K.HRMS, K.PURCHASE, K.CRM, K.GUIDE,
   K.GAMES,],
  // Read-only reporting is exactly what a Viewer exists for.
  [ROLES.VIEWER]: [
    K.DASHBOARD, K.PROJECTS, K.GANTT, K.PLAN_VS_ACTUAL, K.DATA_EXPLORER, K.PROPERTIES, K.PROPERTY_CAPTURE, K.DESIGN_DRAWINGS, K.DESIGN_DRAWINGS_FMS, K.NETWORK_MAP, K.CALENDAR, K.MIS, K.PURCHASE, K.GUIDE,
   K.GAMES,],
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
