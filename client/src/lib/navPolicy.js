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
import { levelOf, isVisible, surfaceKey } from './access.js';

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
  // The inventory master — every SKU the company stocks. Same tier as Games
  // and Vendors beside it: company-wide master data that every role reads and
  // only managers-and-above may change (the server enforces the second half).
  INVENTORY: 'inventory',
  // Inventory Management (IMS) — the COUNT, as its own module beside Purchase
  // and Franchise. Separate from INVENTORY above, which is the catalogue in
  // Master Data: different question, different people, different rhythm.
  // Open to Employee, because the person who takes six bulbs off a shelf is a
  // technician; the server still gates safety levels and locations to managers.
  IMS: 'ims',
  // ERS — Employee Performance. A READ-ONLY window onto the customer-feedback
  // service that rates the staff member who served each guest. Open to every
  // role: it is the company's own performance board, the same figures the
  // outlets already see on the review service's own screens, and hiding it
  // would only push people back to that other tab.
  ERS: 'ers',
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
  // Access Control — the screen that decides everything above. Leadership
  // only by default, and the server refuses to let the MD's own control of
  // it be revoked: there is no way back from that inside the app.
  ACCESS: 'access',
  // FMS · Assign Work — who each recurring job in a flow goes to. Separate
  // from ACCESS on purpose: handing out work is not handing out permissions,
  // and a project head does the first weekly without needing the second.
  FMS_ASSIGN: 'fms-assign',
  // Delegation & Checklist — open to every role. What each person sees INSIDE
  // them is narrowed by the server: a task is visible only to the people on it
  // (MD / EA see all), and writes need a working role.
  DELEGATION: 'delegation',
  CHECKLIST: 'checklist',
  OPS_PERFORMANCE: 'ops-performance',
  // Branches, teams, holidays and the ops activity log.
  ORGANISATION: 'organisation',
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
    K.APPROVALS, K.CALENDAR, K.MIS, K.TEMPLATES, K.EMPLOYEES, K.CRM, K.WHATSAPP, K.ACCESS, K.FMS_ASSIGN, K.GUIDE,
   K.GAMES, K.INVENTORY, K.IMS, K.ERS,
   K.DELEGATION, K.CHECKLIST, K.OPS_PERFORMANCE, K.ORGANISATION,],
  [ROLES.EA]: [
    K.DASHBOARD, K.MY_TASKS, K.PROJECTS, K.GANTT, K.PLAN_VS_ACTUAL, K.DATA_EXPLORER, K.PROPERTIES, K.PROPERTY_CAPTURE, K.DESIGN_DRAWINGS, K.DESIGN_DRAWINGS_FMS, K.VENDORS, K.HRMS, K.PURCHASE, K.FRANCHISE, K.NETWORK_MAP,
    K.APPROVALS, K.CALENDAR, K.MIS, K.TEMPLATES, K.CRM, K.WHATSAPP, K.ACCESS, K.FMS_ASSIGN, K.GUIDE,
   K.GAMES, K.INVENTORY, K.IMS, K.ERS,
   K.DELEGATION, K.CHECKLIST, K.OPS_PERFORMANCE, K.ORGANISATION,],
  [ROLES.MANAGER]: [
    K.DASHBOARD, K.MY_TASKS, K.PROJECTS, K.GANTT, K.PLAN_VS_ACTUAL, K.DATA_EXPLORER, K.PROPERTIES, K.PROPERTY_CAPTURE, K.DESIGN_DRAWINGS, K.DESIGN_DRAWINGS_FMS, K.VENDORS, K.HRMS, K.PURCHASE, K.FRANCHISE, K.NETWORK_MAP,
    K.APPROVALS, K.CALENDAR, K.MIS, K.TEMPLATES, K.CRM, K.WHATSAPP, K.FMS_ASSIGN, K.GUIDE,
   K.GAMES, K.INVENTORY, K.IMS, K.ERS,
   K.DELEGATION, K.CHECKLIST, K.OPS_PERFORMANCE, K.ORGANISATION,],
  // The map is a portfolio view — an Employee's job is their own task queue,
  // and a national map of sites they do not work on is the same kind of noise
  // MIS is. Same reasoning, same answer. Purchase stays: the order tracker is
  // the doer's own work, and the cross-project sheet is how a coordinator
  // finds every delivery they are chasing without opening projects one by one.
  [ROLES.EMPLOYEE]: [
    K.MY_TASKS, K.PROJECTS, K.GANTT, K.PROPERTIES, K.PROPERTY_CAPTURE, K.DESIGN_DRAWINGS_FMS, K.CALENDAR, K.HRMS, K.PURCHASE, K.CRM, K.GUIDE,
   K.GAMES, K.INVENTORY, K.IMS, K.ERS,
   K.DELEGATION, K.CHECKLIST, K.OPS_PERFORMANCE, K.ORGANISATION,],
  // Read-only reporting is exactly what a Viewer exists for.
  [ROLES.VIEWER]: [
    K.DASHBOARD, K.PROJECTS, K.GANTT, K.PLAN_VS_ACTUAL, K.DATA_EXPLORER, K.PROPERTIES, K.PROPERTY_CAPTURE, K.DESIGN_DRAWINGS, K.DESIGN_DRAWINGS_FMS, K.NETWORK_MAP, K.CALENDAR, K.MIS, K.PURCHASE, K.GUIDE,
   K.GAMES, K.INVENTORY, K.IMS, K.ERS,
   K.DELEGATION, K.CHECKLIST, K.OPS_PERFORMANCE, K.ORGANISATION,],
});

/**
 * Can this user see this destination?
 *
 * TWO ANSWERS, IN ORDER. The saved access policy first — what the company
 * decided on Settings -> Access Control, fetched once per session into
 * lib/access.js. The table above second, as the fallback.
 *
 * The table is no longer the policy; it is the DEFAULT the server seeds each
 * role's policy from (server/src/modules/access/access.catalog.js holds the
 * same audiences), and the reason it stays here is the half-second before
 * `/access/me` answers on a cold load. Denying everything in that window
 * would blank the sidebar on every page load, which reads as a broken app
 * rather than a loading one; falling back to what the role has always been
 * allowed shows the same nav it would have shown anyway.
 *
 * An unknown or missing role still gets nothing from the fallback. That is
 * the safe direction: a user whose role failed to load should not be handed
 * the full MD nav for the moment before it resolves.
 */
export function canSeeNav(user, key) {
  const level = levelOf(surfaceKey.module(key));
  if (level !== undefined) return isVisible(level);

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
 * Somewhere to send this person that they can actually open, in order of
 * preference.
 *
 * Only destinations that are a whole place to BE — no detail pages, nothing
 * that needs an id. Each is paired with the key that grants it, so the walk
 * below asks the same question the sidebar does.
 */
const LANDING_ORDER = [
  [K.MY_TASKS, '/my-tasks'],
  [K.DASHBOARD, '/'],
  [K.PROJECTS, '/projects'],
  [K.PROPERTY_CAPTURE, '/property/capture'],
  [K.PROPERTIES, '/properties'],
  [K.PURCHASE, '/purchase/overview'],
  [K.IMS, '/ims/overview'],
  [K.HRMS, '/hrms/overview'],
  [K.DESIGN_DRAWINGS_FMS, '/design-drawings/fms'],
  [K.FRANCHISE, '/franchise/overview'],
  [K.ERS, '/ers/overview'],
  [K.DELEGATION, '/delegation/my-work'],
  [K.CHECKLIST, '/checklist'],
  [K.CALENDAR, '/calendar'],
  [K.MIS, '/mis'],
  [K.GUIDE, '/guide'],
];

/**
 * Where this person belongs after login, and where a refused route sends
 * them back to.
 *
 * AN EMPLOYEE STARTS ON THEIR OWN WORK. Landing them on the portfolio
 * Dashboard made them go looking for their tasks every session; their tasks
 * are the reason they opened the app. Every other role keeps the Dashboard,
 * which is genuinely their overview.
 *
 * BUT NEITHER IS GUARANTEED ANY MORE. Access Control can take away My Tasks,
 * or the Dashboard, or both. A landing path that ignored that would send
 * somebody to a page that immediately refuses them and bounces them back to
 * the same path — a redirect loop, and a browser tab that freezes rather
 * than a screen saying no. So the preference is checked before it is used,
 * and the walk falls through to the first place they can actually open.
 *
 * `/no-access` is the floor. Somebody granted nothing at all is a mistake on
 * the Access Control screen rather than a state to design around, but it has
 * to end somewhere, and it has to end in a sentence rather than a loop.
 */
export function landingPathFor(user) {
  const preferred = user?.role === ROLES.EMPLOYEE ? K.MY_TASKS : K.DASHBOARD;
  const preferredPath = preferred === K.MY_TASKS ? '/my-tasks' : '/';
  if (canSeeNav(user, preferred)) return preferredPath;

  const fallback = LANDING_ORDER.find(([key]) => canSeeNav(user, key));
  return fallback ? fallback[1] : '/no-access';
}

export default NAV_POLICY;
