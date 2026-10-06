import { ROLES } from '../../core/constants/index.js';
import { JOB_ROLES, jobRole } from '../../core/constants/jobRoles.js';
import {
  ACCESS, ACCESS_RANK, surfaceKey as SK, weakest,
} from '../../core/constants/access.js';

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
 * NOBODY — a module the company has switched off.
 *
 * NOT THE SAME AS DELETING IT, and not the same as commenting it out of the
 * sidebar either, which is what this replaces and what the client caught us
 * doing. Three modules were hidden by wrapping their sidebar blocks in a JSX
 * comment: they vanished from every screen while this catalogue went on
 * reporting them as fully granted, so an admin could search Access Control
 * for a role, read "Full" against Franchise, sign in as that person and find
 * no Franchise anywhere. There was no way to discover why, because the
 * reason was in a source file.
 *
 * An empty audience says the same thing where it can be seen and undone. The
 * screen draws the row as Hidden for every role, the cascade takes the steps
 * underneath with it, the `<Gate>` on the route refuses a typed URL, and an
 * MD who wants it back presses "Can view" against one role and has it back —
 * without a deployment, and with the change recorded as a decision somebody
 * took rather than as a line nobody can find.
 *
 * The routes, pages and keys are all still here. This is the door, not the
 * building.
 */
const NOBODY = [];

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
    hint: 'Seven steps, from a site first walked to the project created against it.',
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
      step('property-capture', 'property-doc-approval', 'Step 6 · Document Approvals', ALL,
        { hint: 'Documents a doer has submitted, waiting to be approved or sent back.' }),
      step('property-capture', 'property-planning', 'Step 7 · All Project Creation', ALL,
        { hint: 'Games, opening and trial dates, and the project itself.' }),

      /**
       * THE THREE DOORS NEW PROPERTIES COME IN THROUGH.
       *
       * Granted separately from Step 1 itself, because reading the queue and
       * ADDING to it are different jobs done by different people: a Cluster
       * Manager watches their region's pipeline all day and should not be
       * able to open a new store, while the Property Consultant who files
       * sites has no business handing out the public application link.
       *
       * They are steps of Step 1 rather than surfaces of their own so the
       * cascade already covers them: hide the Property module and the three
       * buttons go with it, with nothing extra to remember.
       *
       * WORKERS, not ALL: a Viewer reads the pipeline and does not add to
       * it, which is what "viewer" means. New Store is LEADERS because it
       * creates a PROJECT — a commitment to open somewhere, not a note about
       * a shop somebody walked past.
       */
      step('property-capture', 'property-intake-link', 'Add · Property link', WORKERS,
        { hint: 'The public link for franchise applications and broker leads. Whoever holds this can hand out the form.' }),
      step('property-capture', 'property-intake-store', 'Add · New Store', LEADERS,
        { hint: 'Commit to opening in a city with no site yet. This creates a project.' }),
      step('property-capture', 'property-intake-capture', 'Add · Capture Property', WORKERS,
        { hint: 'File a site we have walked. The property form, opened from the queue.' }),
    ],
  },

  {
    key: 'design',
    label: 'Design & Drawings FMS',
    hint: 'The 37-drawing checklist: the portfolio dashboard, and the rail drawings move along.',
    surfaces: [
      /* SWITCHED OFF FOR EVERYONE, by request — see NOBODY above. Turn a
         role back on here and the sidebar entry and the routes both return. */
      mod('design-drawings', 'Dashboard (all projects)', NOBODY,
        { hint: 'Portfolio reporting over every project’s checklist. Switched off for every role — grant a role below to bring it back.' }),
      mod('design-drawings-fms', 'FMS rail', NOBODY,
        { hint: 'Where drawings are uploaded, reviewed and approved. Switched off for every role — grant a role below to bring it back.' }),
    ],
  },

  {
    key: 'new-games',
    label: 'New Games Creation FMS',
    hint: 'A new game from its indent form to the Games master.',
    /**
     * SEVEN STEPS, BECAUSE THE SEVEN JOBS ARE SEVEN DIFFERENT PEOPLE.
     *
     * The module row alone could only answer "does this seat see New Games at
     * all", and that is not the question the business asks. The person who
     * prices a BOQ is deliberately not the person who approves it, and the
     * technical team who assemble a room are not the testers who sign it off.
     * Until these rows existed those five jobs were one grant.
     *
     * THIS IS A SECOND GATE, NOT A REPLACEMENT FOR THE FIRST. The service
     * already refuses anyone who is not assigned to a step (newGame.service's
     * `mustBeDoer`). That answers "is it your turn". These rows answer "may
     * this seat ever hold this job", which no amount of assigning can say.
     * Both have to pass.
     *
     * DEFAULTS CHANGE NOTHING TODAY, on purpose. Every step ships at ALL and
     * DEFAULT_LEVEL — exactly what the module row already granted — so no
     * BOQ checker loses their check the day this deploys. Narrowing them is a
     * decision for the Access Control screen, not one smuggled in here: the
     * "BOQ checker" is often an Employee-tier seat, and guessing otherwise
     * would lock the real checker out of the only thing they do.
     */
    surfaces: [
      mod('new-games', 'New Games Creation FMS', ALL,
        { hint: 'File an indent, watch the video, make and check the BOQs, build and test — every step with its plan and doer.' }),
      step('new-games', 'ng-indent', 'Step 1 · Indent form', ALL,
        { hint: 'Filing a new game and editing the indent — the name, the concept, the reference video and the watch-by date.' }),
      step('new-games', 'ng-video', 'Step 2 · Watch the video', ALL,
        { hint: 'Marking the reference video watched. Each person answers only for themselves.' }),
      step('new-games', 'ng-boq', 'Step 3 · Make the BOQ', ALL,
        { hint: 'Adding, correcting and removing BOQs, and marking the BOQ step done.' }),
      step('new-games', 'ng-check', 'Step 4 · Check the BOQ', ALL,
        { hint: 'Approving or rejecting a BOQ. Approval is what hands the lines to the Purchase FMS, so it is a decision — “Full control”, not “Can work”.' }),
      step('new-games', 'ng-order', 'Step 5 · Order & receive', ALL,
        { hint: 'Read here, worked in Purchase. Vendor, PO, tracking and GRN all run in the Purchase FMS; the only action on this step is a manager re-sending a hand-off that failed.' }),
      step('new-games', 'ng-assemble', 'Step 6 · Assemble', ALL,
        { hint: 'Marking the room built, once the goods have arrived.' }),
      step('new-games', 'ng-testing', 'Step 7 · Testing & quality', ALL,
        { hint: 'The final sign-off. Completing this step is what puts the game into the Games master.' }),
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
      /* SWITCHED OFF FOR EVERYONE, by request — see NOBODY above. The public
         /franchise/apply form is a separate unauthenticated route and is NOT
         affected: enquiries keep arriving whatever this row says. */
      mod('franchise', 'Franchise', NOBODY,
        { hint: 'The enquiry queue. Switched off for every role — grant a role below to bring it back. The public application form keeps working either way.' }),
      step('franchise', 'franchise-overview', 'Overview', LEADERS),
      step('franchise', 'franchise-enquiries', 'Enquiries', LEADERS),
    ],
  },

  {
    key: 'hrms',
    label: 'HRMS - Hiring FMS',
    hint: 'Requisitions, candidates, and the pipeline a candidate moves through.',
    surfaces: [
      /* SWITCHED OFF FOR EVERYONE, by request — see NOBODY above. A hiring
         task still reaches its owner in My Tasks; the link from it into HRMS
         will refuse until a role is granted here again. */
      mod('hrms', 'HRMS', NOBODY,
        { hint: 'Requisitions and candidates. Switched off for every role — grant a role below to bring it back.' }),
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
    key: 'operations',
    label: 'Delegation & Checklist',
    hint: 'Handing out work and following it to closure, and the recurring routines scheduled for each outlet.',
    surfaces: [
      /**
       * THE PAGES, NOT JUST THE MODULES.
       *
       * These four shipped as whole-module grants only — on or off — while
       * every FMS beside them could be handed out a step at a time. So the
       * only way to keep somebody off the Trash bin or the activity log was
       * to take Delegation or Organisation away entirely, which also took
       * away their own work. The rows below are the sidebar's own rows, so
       * what an admin ticks is what the person will see.
       *
       * The cascade still applies: hide the module and every page under it
       * goes with it, whatever its own row says.
       */
      mod('delegation', 'Delegation', ALL,
        { hint: 'My Work, delegated tasks, groups and repeat rules. Everyone sees only the tasks they are on; MD and EA see all.' }),
      step('delegation', 'delegation-mine', 'My Work', ALL,
        { hint: 'A person\u2019s own delegated tasks. Taking this away leaves them no way to see what they owe.' }),
      step('delegation', 'delegation-out', 'Delegated by me', ALL,
        { hint: 'What they have handed to other people.' }),
      step('delegation', 'delegation-loop', 'In the loop', ALL,
        { hint: 'Tasks they are watching rather than doing.' }),
      step('delegation', 'delegation-all', 'All tasks', LEADERS,
        { hint: 'Every task in the company. A doer has no business reading the whole board.' }),
      step('delegation', 'delegation-groups', 'Groups', ALL),
      step('delegation', 'delegation-repeats', 'Repeat rules', LEADERS,
        { hint: 'What recurs and how often — a scheduling decision, not a doer\u2019s.' }),
      step('delegation', 'delegation-trash', 'Trash', LEADERS,
        { hint: 'Deleted tasks, and where they are restored from.' }),

      /**
       * CHECKLIST'S FOUR VIEWS, which were four hard-coded role checks.
       *
       * The page already split itself: Tasks and Routines for everybody,
       * Department report and Sites behind `can.manage(role)` in
       * ChecklistPage.jsx. That is a rule of the SOFTWARE stating what is
       * really a decision of the BUSINESS — exactly the arrangement this
       * catalogue exists to replace. The split is now four rows somebody can
       * change, and the defaults are the split that was compiled in:
       * report and sites to the people who run work, the rest to everyone.
       *
       * Sites is a step and not a modal-shaped afterthought because it is
       * company-wide data — the places every routine is scheduled against.
       * Somebody who may work a checklist is not automatically somebody who
       * may add an outlet to it.
       */
      mod('checklist', 'Checklist', ALL, { hint: 'Recurring routines, their dated occurrences and the department report.' }),
      step('checklist', 'chk-tasks', 'Tasks', ALL,
        { hint: 'The dated occurrences — completing them, reopening, reassigning and adding remarks.' }),
      step('checklist', 'chk-routines', 'Routines', ALL,
        { hint: 'The recurring masters themselves: what repeats, how often, and who it lands on.' }),
      step('checklist', 'chk-report', 'Department report', LEADERS,
        { hint: 'Completion by department, across the branch. A management read, not daily work.' }),
      step('checklist', 'chk-sites', 'Sites', LEADERS,
        { hint: 'The rooms and areas routines are scheduled against — company-wide, so adding or closing one is a manager’s call.' }),
    ],
  },

  /**
   * ORGANISATION — ITS OWN SECTION, NAMED THE WAY THE SIDEBAR NAMES IT.
   *
   * These rows already existed and already worked. Nobody could find them:
   * the sidebar group is called "Organisation" and this screen called it
   * "Teams & Branches", filed under a section headed "Delegation &
   * Checklist". Searching this screen for "organisation" returned nothing,
   * so the reasonable conclusion was that the module had no access control
   * at all — which is what got reported.
   *
   * That breaks the promise at the top of this file: the sections ARE the
   * sidebar's grouping, so that nobody has to translate between two
   * arrangements of the same app. Split out and renamed to match.
   *
   * THE IDS ARE UNCHANGED, and that is the important part. A stored grant
   * keys off `module:organisation` and `step:org-*`; renaming those would
   * silently drop every decision the company has already taken here. Only
   * the labels and the grouping move.
   *
   * Performance sits here because that is where the sidebar puts it —
   * inside the Organisation group, above Teams & People.
   */
  {
    key: 'organisation',
    label: 'Organisation',
    hint: 'Teams and people, branches, ops settings and the activity log — plus the performance scoreboard built from them.',
    surfaces: [
      mod('organisation', 'Organisation', ALL,
        { hint: 'The group itself. Hiding it takes Teams & People, Branches, Ops settings and the Activity log with it.' }),
      mod('ops-performance', 'Performance', ALL,
        { hint: 'KRA report and scoreboard built from delegation and checklist work.' }),
      step('organisation', 'org-teams', 'Teams & People', ALL,
        { hint: 'The directory. Most people need to READ it to hand work over.' }),
      step('organisation', 'org-branches', 'Branches', LEADERS,
        { hint: 'Head office, regions and outlets.' }),
      step('organisation', 'org-settings', 'Ops settings', LEADERS,
        { hint: 'Holidays, categories and tags — company-wide lists everything else picks from.' }),
      step('organisation', 'org-activity', 'Activity log', LEADERS,
        { hint: 'Who changed what, across delegation and checklist. An audit trail, not daily work.' }),
    ],
  },
  {
    key: 'crm',
    label: 'CRM',
    hint: 'Leads, deals and support. Switched off for every role today.',
    surfaces: [
      /* SWITCHED OFF FOR EVERYONE — see NOBODY above. Was hidden by a JSX
         comment in the sidebar while this row read WORKERS, which is the
         same disagreement the other three had. */
      mod('crm', 'CRM', NOBODY,
        { hint: 'Leads, deals and support. Switched off for every role — grant a role below to bring it back.' }),
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
 * THE DOER'S FLOOR - their own work, and nothing else.
 *
 * Every seat below gets these, and a seat that needs more says so. It is
 * four modules rather than the one the request asked for ("only My Tasks"),
 * because the other three are what MAKE My Tasks work rather than extra
 * territory:
 *
 *   my-tasks   - the queue itself.
 *   delegation - a delegated task in that queue links to
 *                /delegation/tasks/:id, which is gated. Take the module
 *                away and half the rows in My Tasks open a refusal. Only
 *                `mine`: the whole-company board stays shut.
 *   checklist  - the same story for a routine's dated occurrence.
 *   guide      - how to use the thing. Hiding the manual helps nobody.
 *
 * NOT projects, and that is worth stating because a doer's property work
 * opens at /projects/:id/site-evaluation/... Those sub-routes are ungated by
 * design - holding the task IS the permission - so the sidebar entry can go
 * while the work stays reachable.
 */
const DOER_FLOOR = Object.freeze({
  [SK.module('my-tasks')]: ACCESS.EDIT,
  [SK.module('delegation')]: ACCESS.EDIT,
  [SK.step('delegation-mine')]: ACCESS.EDIT,
  [SK.module('checklist')]: ACCESS.EDIT,
  [SK.step('chk-tasks')]: ACCESS.EDIT,
  [SK.module('guide')]: ACCESS.VIEW,
});

/**
 * WHAT EACH SEAT SEES OUT OF THE BOX, from the sheet's own Visibility column.
 *
 * THIS FILE USED TO REFUSE TO WRITE THIS DOWN, and the refusal was right at
 * the time: every seat started at its tier, because USERROLE.xlsx named the
 * seats and said nothing about which screens went with them, and inventing
 * 20 x 86 answers would have produced a thousand guesses indistinguishable
 * from decisions the company had actually taken.
 *
 * The sheet now carries a Visibility column, and it is specific: the
 * Technical Expert "can view assigned technical tasks and provide technical
 * inputs, assessments, and updates"; the Property / Franchise Consultant
 * "can add property details and view assigned property tasks". That is not
 * a guess any more - it is the client's own sentence, written out in the
 * only vocabulary the resolver understands.
 *
 * WHY IT WAS WORTH DOING. A doer signing in got the Managing Director's
 * sidebar: fourteen modules, one of which was theirs. The complaint was
 * never that they could reach too much - the server's guards were holding -
 * it was that nobody could tell what their job was by looking at their
 * screen.
 *
 * THESE NARROW; THEY NEVER WIDEN. Each level below is intersected with what
 * the seat's security tier already allowed, so a row here can only ever take
 * something away. It cannot hand an Employee a Manager's surface by
 * accident, and a module switched off for everyone (see NOBODY) stays off
 * however enthusiastically it is listed.
 *
 * AND THEY ARE DEFAULTS, VISIBLY SO. Settings -> Access Control draws every
 * one of these rows, with the sentence that produced it, and anything an
 * admin changes is stored on top and marked as a decision somebody took.
 * Nothing here is hidden from that screen - which is the point, and the bug
 * that prompted it.
 *
 * MANAGER AND MD SEATS ARE ABSENT ON PURPOSE. The sheet gives them broad
 * sentences ("can view and manage project planning, vendor, BOQ, budget and
 * execution tasks") that do not resolve to a surface list, and the MD is
 * meant to see everything. Those keep their tier.
 */
export const SEAT_DEFAULTS = Object.freeze({
  'property-franchise-consultant': {
    why: 'The sheet says: "Can add property details and view assigned property tasks." So: their own queue, plus the one screen that files a site.',
    allow: {
      ...DOER_FLOOR,
      [SK.module('property-capture')]: ACCESS.EDIT,
      [SK.step('property-capture')]: ACCESS.EDIT,
      [SK.step('property-intake-capture')]: ACCESS.EDIT,
    },
  },
  'technical-expert': {
    why: 'The sheet says: "Can view assigned technical tasks and provide technical inputs, assessments, and updates." Assigned work is My Tasks.',
    allow: DOER_FLOOR,
  },
  'operational-expert': {
    why: 'The sheet says: "Can view assigned operational tasks and provide operational inputs, assessments, and updates."',
    allow: DOER_FLOOR,
  },
  'financial-expert': {
    why: 'The assessor\u2019s seat: the financial evaluation, which arrives as a task. The wider sentence on this row of the sheet describes the Managing Director who also holds it \u2014 and holding both seats still grants both, because a person gets the strongest answer any of their seats gives.',
    allow: DOER_FLOOR,
  },
  'feasibility-expert': {
    why: 'The assessor\u2019s seat: the feasibility evaluation, which arrives as a task. Same note as Financial Expert \u2014 the MD holds this seat too, and keeps their own access.',
    allow: DOER_FLOOR,
  },
  'architect-design-team': {
    why: 'The sheet says: "Can view assigned drawing and design tasks and update drawings."',
    allow: DOER_FLOOR,
  },
  'site-supervisor-contractor': {
    why: 'The sheet says: "Can view assigned site-execution tasks and update site progress."',
    allow: DOER_FLOOR,
  },
});

/**
 * WHAT A TIER ACTUALLY GRANTS SOMEBODY WHO HOLDS NO SEAT.
 *
 * THE GAP THIS CLOSES. SEAT_DEFAULTS narrows the seven doer seats the org
 * sheet names, and that worked - a Technical Expert resolved to four
 * modules. But only five employee-tier accounts in this database hold a
 * seat at all; the other nineteen are not in the sheet, so there was no
 * seat to narrow and they fell through to the bare Employee tier, which
 * grants eighteen modules. Two people doing the same job saw completely
 * different applications, and the difference was invisible: nothing on
 * either screen mentions a seat.
 *
 * So the floor is applied to the TIER as well. A doer is a doer whether or
 * not the sheet happens to name them, and "the account nobody has
 * classified yet" is the wrong thing to reward with the widest view in the
 * building.
 *
 * ONLY THE EMPLOYEE TIER. Manager, EA and MD are people who run work rather
 * than only do it, and a manager with no seat still needs the portfolio;
 * narrowing them would lock out most of the company's own supervisors on
 * no authority at all. Viewer is read-only by construction.
 *
 * THIS IS THE CEILING FOR A SEATLESS PERSON, NOT FOR A SEATED ONE.
 * `defaultGrantsFor` below stays raw on purpose - it is what
 * `defaultGrantsForJobRole` intersects a seat against, and narrowing it
 * there would clamp the Property Consultant's own Step 1 to nothing.
 */
const TIER_DEFAULTS = Object.freeze({
  [EMPLOYEE]: {
    why: 'Someone who does the work and holds no seat in the org sheet: their own queue, and nothing else. Give them a role on the Employees page to widen it, or change any row below.',
    allow: DOER_FLOOR,
  },
});

/**
 * The out-of-the-box map for somebody whose access comes from their tier
 * alone - which is most of this database.
 *
 * Kept apart from `defaultGrantsFor` because the two answer different
 * questions and one of them must stay raw: this is "what does a seatless
 * Employee get", that is "what is the most an Employee may ever be given".
 */
export function tierGrantsFor(role) {
  const raw = defaultGrantsFor(role);
  const policy = TIER_DEFAULTS[role];
  if (!policy) return raw;

  const out = {};
  for (const s of ALL_SURFACES) {
    out[s.key] = weakest(raw[s.key] ?? ACCESS.NONE, policy.allow[s.key] ?? ACCESS.NONE);
  }
  return out;
}

/** Why a tier starts where it does, for the Access Control screen. */
export const tierNote = (role) => TIER_DEFAULTS[role]?.why ?? null;

/**
 * The shipped default for one of the company's own roles.
 *
 * TWO SOURCES. A seat listed in SEAT_DEFAULTS gets what the org sheet says
 * it does, intersected with its tier so the row can only narrow. Every other
 * seat still starts at what its tier has always granted - a Civil Head where
 * a Manager was - because the sheet's sentence for those seats does not
 * resolve to a list of screens, and guessing would be worse than inheriting.
 *
 * Either way these are DEFAULTS and are not stored. Narrowings an admin
 * makes are, so the difference between "nobody has decided" and "somebody
 * decided this" stays visible forever.
 */
export function defaultGrantsForJobRole(key) {
  const seat = jobRole(key);
  if (!seat) return {};
  const tier = defaultGrantsFor(seat.systemRole);
  const policy = SEAT_DEFAULTS[key];
  if (!policy) return tier;

  const out = {};
  for (const s of ALL_SURFACES) {
    /* Intersected, never unioned: the sheet can take a surface away from a
       seat, and can never hand it one its tier was not trusted with. */
    out[s.key] = weakest(tier[s.key] ?? ACCESS.NONE, policy.allow[s.key] ?? ACCESS.NONE);
  }
  return out;
}

/** Every job role, with the tier it inherits from. For the Settings screen. */
export const jobRoleSummaries = () => JOB_ROLES.map((r) => ({
  key: r.key,
  /* WHY this seat's defaults look the way they do, in the sheet's own
     words. Shown on the Access Control screen under the role, so somebody
     reading "Hidden" against twelve modules can see that the company's
     own sentence put it there, and that it is not a bug. */
  defaultsNote: SEAT_DEFAULTS[r.key]?.why ?? null,
  title: r.title,
  short: r.short,
  systemRole: r.systemRole,
  department: r.department,
  seats: r.seats,
  sheetRows: r.sheetRows,
  color: r.color,
}));

export default ACCESS_CATALOG;
