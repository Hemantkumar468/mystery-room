import { ROLES } from '../../core/constants/index.js';
import { JOB_ROLES, jobRole } from '../../core/constants/jobRoles.js';
import { ACCESS, ACCESS_RANK, surfaceKey as SK } from '../../core/constants/access.js';

/**
 * THE REGISTRY — every part of the ERP that can be granted or taken away.
 *
 * This file is the list the Settings -> Access Control screen draws, the list
 * the resolver validates stored grants against, and the list the sidebar and
 * the step rails read their keys from. One list, because the alternative was
 * tried and it is what this feature exists to replace: permissions spelled
 * out in NAV_POLICY for the sidebar, again in each route config, and a third
 * time inline in whichever component happened to need them, with no screen
 * anywhere that could answer "what can a site engineer actually see".
 *
 * THREE KINDS OF SURFACE, and the distinction is the point of the exercise:
 *
 *   module - a system in the sidebar. Property Capturing FMS, Purchase,
 *            HRMS, Inventory. Turning one off removes the section entirely.
 *   step   - one stage of that system's flow. "Step 3 - All Property
 *            Assessment" is a step; so is Purchase -> Goods Received. This is
 *            the level the business actually assigns work at: the person who
 *            scores sites is not the person who signs the lease, and until
 *            now both were handed all six steps and left to work it out.
 *   stage  - a position a RECORD moves through rather than a page anyone
 *            navigates to. The hiring pipeline is the clearest case: applied
 *            -> screening -> interview -> offer -> hired. A coordinator may
 *            need to work the first two and never see what an offer was worth.
 *
 * PARENTS CASCADE, ALWAYS DOWNWARD. A step can never be more open than the
 * module that contains it - if Property is hidden for a role, its six steps
 * are hidden whatever their own rows say. That rule lives in the resolver
 * (access.service.js#resolve) rather than here, so it cannot be forgotten by
 * whoever adds the next module.
 *
 * DEFAULTS REPRODUCE TODAY EXACTLY. `roles` on each surface is the same
 * audience client/src/lib/navPolicy.js hard-codes today, and the level each
 * role gets is DEFAULT_LEVEL below. So an ERP with no saved policy behaves
 * precisely as it did before this module existed; every difference from here
 * on is one somebody chose on the Settings screen.
 */

const {
  MD, EA, MANAGER, EMPLOYEE, VIEWER,
} = ROLES;

/** Everyone who runs work. No doer, no read-only seat. */
const LEADERS = [MD, EA, MANAGER];
const ALL = [MD, EA, MANAGER, EMPLOYEE, VIEWER];
/** The people who run work, plus the people who do it. No read-only seat. */
const WORKERS = [MD, EA, MANAGER, EMPLOYEE];
/** Everyone who reads reports. A doer's own queue is elsewhere. */
const READERS = [MD, EA, MANAGER, VIEWER];

/**
 * What a role gets on a surface it is allowed at all.
 *
 * A Viewer reads, an Employee works, everyone above decides. This is the same
 * three-tier split CAN_MANAGE / CAN_CAPTURE already encode in
 * core/constants/index.js - stated once more here as LEVELS rather than as
 * membership, because a level is what a grant stores.
 */
export const DEFAULT_LEVEL = Object.freeze({
  [MD]: ACCESS.MANAGE,
  [EA]: ACCESS.MANAGE,
  [MANAGER]: ACCESS.MANAGE,
  [EMPLOYEE]: ACCESS.EDIT,
  [VIEWER]: ACCESS.VIEW,
});

const mod = (key, label, roles, extra = {}) => ({
  key: SK.module(key), kind: 'module', id: key, label, roles, parent: null, ...extra,
});
const step = (parentKey, key, label, roles, extra = {}) => ({
  key: SK.step(key), kind: 'step', id: key, label, roles, parent: SK.module(parentKey), ...extra,
});
const stage = (parentKey, key, label, roles, extra = {}) => ({
  key: SK.stage(key), kind: 'stage', id: key, label, roles, parent: SK.module(parentKey), ...extra,
});

/**
 * The sections are the sidebar's own grouping, so the Settings screen reads
 * in the same order as the thing it configures. Somebody hiding a step should
 * not have to translate between two arrangements of the same app.
 */
export const ACCESS_CATALOG = Object.freeze([
  {
    key: 'pms',
    label: 'PMS - Projects',
    hint: 'The project management system: the portfolio, its plan and its reports.',
    surfaces: [
      mod('dashboard', 'Dashboard', READERS),
      mod('my-tasks', 'My Tasks', WORKERS, { hint: 'A person’s own assigned work.' }),
      mod('projects', 'Projects', ALL),
      mod('gantt', 'Timeline (Gantt)', ALL),
      mod('plan-vs-actual', 'Plan vs Actual', READERS),
      mod('data-explorer', 'Data Explorer', READERS),
      mod('properties', 'Properties', ALL),
      mod('network-map', 'Network Map', READERS),
      mod('approvals', 'Approvals', LEADERS, { hint: 'The sign-off queue. A doer cannot action it.' }),
      mod('calendar', 'Calendar', ALL),
      mod('mis', 'MIS & Analytics', READERS),
      mod('templates', 'Templates', LEADERS),
      mod('guide', 'User Guide', ALL),
    ],
  },

  {
    key: 'property',
    label: 'Property Capturing FMS',
    hint: 'Six steps, from a site first walked to the project created against it.',
    surfaces: [
      mod('property-capture', 'Property Capturing FMS', ALL),
      step('property-capture', 'property-capture', 'Step 1 · All Properties', ALL,
        { hint: 'Every site in front of us, however it arrived.' }),
      step('property-capture', 'property-md-review', 'Step 2 · MD Review & Decision', ALL,
        { hint: 'Which road a filed property takes - assessment, commercial, or straight to project.' }),
      step('property-capture', 'property-assessment', 'Step 3 · All Property Assessment', ALL,
        { hint: 'The four site evaluations: feasibility, financial, technical, operational.' }),
      step('property-capture', 'property-selection', 'Step 4 · MD Review & Approval', ALL,
        { hint: 'One site chosen per project, the rest decided rather than left hanging.' }),
      step('property-capture', 'property-commercial', 'Step 5 · All Property Commercial', ALL,
        { hint: 'LOI, lease, legal check, deposit, NOCs and approvals.' }),
      step('property-capture', 'property-planning', 'Step 6 · All Project Creation', ALL,
        { hint: 'Games, opening and trial dates, and the project itself.' }),
    ],
  },

  {
    key: 'design',
    label: 'Design & Drawings FMS',
    hint: 'The 37-drawing checklist: the portfolio dashboard, and the rail drawings move along.',
    surfaces: [
      mod('design-drawings', 'Dashboard (all projects)', READERS,
        { hint: 'Portfolio reporting over every project’s checklist.' }),
      mod('design-drawings-fms', 'FMS rail', ALL,
        { hint: 'Where drawings are uploaded, reviewed and approved.' }),
    ],
  },

  {
    key: 'purchase',
    label: 'Purchase FMS',
    hint: 'Orders, deliveries and goods received across every project.',
    surfaces: [
      mod('purchase', 'Purchase', ALL),
      step('purchase', 'purchase-overview', 'Overview', ALL),
      step('purchase', 'purchase-orders', 'Purchase Orders', ALL),
      step('purchase', 'purchase-receipts', 'Goods Received', ALL),
    ],
  },

  {
    key: 'ims',
    label: 'Inventory Management (IMS)',
    hint: 'The count - how much of each item is where, and every movement that put it there.',
    surfaces: [
      mod('ims', 'Inventory (IMS)', ALL),
      step('ims', 'ims-overview', 'Overview', ALL),
      step('ims', 'ims-stock', 'Stock', ALL),
      step('ims', 'ims-movements', 'Movements', ALL),
      step('ims', 'ims-locations', 'Locations', ALL,
        { hint: 'Adding or closing a location is a manager’s job; the server enforces that too.' }),
    ],
  },

  {
    key: 'franchise',
    label: 'Franchise FMS',
    hint: 'The enquiry queue and the yes/no that creates a project.',
    surfaces: [
      mod('franchise', 'Franchise', LEADERS),
      step('franchise', 'franchise-overview', 'Overview', LEADERS),
      step('franchise', 'franchise-enquiries', 'Enquiries', LEADERS),
    ],
  },

  {
    key: 'hrms',
    label: 'HRMS - Hiring FMS',
    hint: 'Requisitions, candidates, and the pipeline a candidate moves through.',
    surfaces: [
      mod('hrms', 'HRMS', WORKERS),
      step('hrms', 'hrms-overview', 'Hiring Overview', WORKERS),
      step('hrms', 'hrms-requisitions', 'Requisitions', WORKERS),
      step('hrms', 'hrms-candidates', 'Candidates', WORKERS),
      /* The pipeline itself. These are not pages - they are where a candidate
         STANDS, and they are gated because the stages differ in sensitivity
         far more than the screens do: a hiring coordinator screens CVs all
         day and has no business reading what an offer was worth. */
      stage('hrms', 'hrms-applied', 'Pipeline · Applied', WORKERS),
      stage('hrms', 'hrms-screening', 'Pipeline · Screening', WORKERS),
      stage('hrms', 'hrms-interview', 'Pipeline · Interview', WORKERS),
      stage('hrms', 'hrms-offer', 'Pipeline · Offer', LEADERS,
        { hint: 'Salary and joining terms. Leadership by default.' }),
      stage('hrms', 'hrms-hired', 'Pipeline · Hired', WORKERS),
      stage('hrms', 'hrms-rejected', 'Pipeline · Rejected', WORKERS),
    ],
  },

  {
    key: 'ers',
    label: 'Employee Performance (ERS)',
    hint: 'A read-only window onto the customer-feedback service that rates staff.',
    surfaces: [
      mod('ers', 'Employee Performance', ALL, { maxLevel: ACCESS.VIEW }),
      step('ers', 'ers-overview', 'Performance overview', ALL, { maxLevel: ACCESS.VIEW }),
      step('ers', 'ers-leaderboard', 'Leaderboard', ALL, { maxLevel: ACCESS.VIEW }),
    ],
  },

  {
    key: 'crm',
    label: 'CRM',
    hint: 'Leads, deals and support. Hidden from the sidebar today; the routes still answer.',
    surfaces: [
      mod('crm', 'CRM', WORKERS),
    ],
  },

  {
    key: 'master',
    label: 'Master Data',
    hint: 'The company-wide lists projects pick FROM, rather than data a project produces.',
    surfaces: [
      mod('games', 'Games', ALL),
      mod('vendors', 'Vendors', ALL),
      mod('inventory', 'Item Master', ALL),
    ],
  },

  {
    key: 'admin',
    label: 'Administration',
    hint: 'Accounts, channels and this screen. Changing anything here changes what everybody else can do.',
    surfaces: [
      mod('employees', 'Employees', [MD]),
      mod('whatsapp', 'WhatsApp notifications', LEADERS),
      mod('access', 'Access Control (this screen)', [MD, EA],
        { hint: 'Who may hand out permissions. Keep this narrow.' }),
      /* Handing out WORK, not permissions. A project head does this weekly
         and has no business widening anybody's access, so it is a separate
         grant rather than a corner of the one above. */
      mod('fms-assign', 'FMS · Assign Work', LEADERS,
        { hint: 'Who each recurring job in a flow goes to, and who covers them.' }),
    ],
  },
]);

/** Every surface, flat, in catalogue order. */
export const ALL_SURFACES = Object.freeze(
  ACCESS_CATALOG.flatMap((section) => section.surfaces.map((s) => ({ ...s, section: section.key }))),
);

const BY_KEY = new Map(ALL_SURFACES.map((s) => [s.key, s]));

export const surfaceFor = (key) => BY_KEY.get(key) ?? null;
export const isKnownSurface = (key) => BY_KEY.has(key);

/** The children of a module surface, in catalogue order. */
export const childrenOf = (key) => ALL_SURFACES.filter((s) => s.parent === key);

/**
 * The out-of-the-box level for one role on one surface.
 *
 * `maxLevel` clamps surfaces that cannot honestly offer more than they do -
 * ERS is somebody else's data and this ERP has no write path to it, so
 * offering "Full control" there would be a promise the API cannot keep.
 */
export function defaultLevel(surface, role) {
  if (!surface?.roles?.includes(role)) return ACCESS.NONE;
  const level = surface.levels?.[role] ?? DEFAULT_LEVEL[role] ?? ACCESS.NONE;
  if (!surface.maxLevel) return level;
  return ACCESS_RANK[level] > ACCESS_RANK[surface.maxLevel] ? surface.maxLevel : level;
}

/** The whole default map for a role - `{ 'module:projects': 'manage', ... }`. */
export function defaultGrantsFor(role) {
  const out = {};
  for (const s of ALL_SURFACES) out[s.key] = defaultLevel(s, role);
  return out;
}

/**
 * The shipped default for one of the company's own roles.
 *
 * DERIVED FROM THE SEAT'S TIER, not written out per seat, and that is a
 * deliberate refusal to guess. Nothing in SHEET/USERROLE.xlsx says which
 * screens a Feasibility Expert should see - it says the seat exists and who
 * fills it. Inventing an answer for 20 roles x 54 surfaces would produce a
 * thousand guesses that look authoritative on screen and that nobody could
 * tell apart from decisions the company actually made.
 *
 * So every seat starts at what its tier has always granted - a Civil Head
 * starts where a Manager was, a Feasibility Expert where an Employee was -
 * and the company narrows each seat on the Access Control screen. Those
 * narrowings are stored; these defaults are not. The difference between
 * "nobody has decided" and "somebody decided this" stays visible forever.
 */
export function defaultGrantsForJobRole(key) {
  const seat = jobRole(key);
  if (!seat) return {};
  return defaultGrantsFor(seat.systemRole);
}

/** Every job role, with the tier it inherits from. For the Settings screen. */
export const jobRoleSummaries = () => JOB_ROLES.map((r) => ({
  key: r.key,
  title: r.title,
  short: r.short,
  systemRole: r.systemRole,
  department: r.department,
  seats: r.seats,
  sheetRows: r.sheetRows,
  color: r.color,
}));

export default ACCESS_CATALOG;
