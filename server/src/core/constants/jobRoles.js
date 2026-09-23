import { ROLES, DEPARTMENTS } from './index.js';

/**
 * THE COMPANY'S OWN ROLES — the 20 roles of SHEET/USERROLE.xlsx, which
 * names 26 seats across them (three Managing Directors, five Cluster /
 * Branch Managers, one of everything else).
 *
 * This is the vocabulary the business actually uses. "Feasibility Expert",
 * "Civil Head", "Cluster / Branch Manager" are what the org chart says, what
 * the client's functional-flow document hands work to by name, and what
 * somebody setting up permissions is thinking about. They are the roles.
 *
 * WHY THE FIVE SYSTEM ROLES STILL EXIST UNDERNEATH. `ROLES` in ./index.js
 * (md, ea, manager, employee, viewer) is not a competing list of job titles —
 * it is the SECURITY TIER, the thing several hundred `authorize(...CAN_MANAGE)`
 * guards and every capability helper already branch on. Replacing it with 20
 * values would mean re-deriving every one of those call sites for a
 * distinction the permission model does not make: an IT Head and a Civil Head
 * approve their own department's work for exactly the same reason, and that
 * reason is "manager", not the word "Head".
 *
 * So the two are layered rather than merged:
 *
 *   jobRole  — WHO SOMEBODY IS in this company. What the Employees page
 *              shows, what Access Control is written against, what the sheet
 *              says. One person may hold several (the sheet lists Prateek
 *              three times).
 *   role     — WHAT THE SOFTWARE LETS THEM DO AT ALL. Derived from the job
 *              role via `systemRole` below; the floor beneath the policy.
 *
 * A job role can be given LESS than its tier on the Access Control screen —
 * that is the point of the screen. It can never be given more than the tier
 * allows, because the server's own guards are still there underneath.
 *
 * ── Keeping this file honest ──────────────────────────────────────────
 * `sheetRows`, `seats` and `sheetEmails` are transcribed from USERROLE.xlsx
 * and are checked against it by `npm run migrate:jobroles`, which reads the
 * workbook and refuses to run if the two have drifted. Edit the sheet, re-run
 * the migration, and it will tell you what to change here.
 */

/**
 * @typedef {object} JobRole
 * @property {string} key          stable slug — what is stored on a user and in a policy
 * @property {string} title        exactly as the sheet writes it
 * @property {string} short        for a badge, where the full title will not fit
 * @property {string} systemRole   the security tier this seat maps to
 * @property {string|null} department
 * @property {number} seats        how many people the sheet names in this seat
 * @property {string} sheetRows    which rows of USERROLE.xlsx this is
 * @property {string[]} sheetEmails the people the sheet names, in sheet order
 * @property {string[]} aliases    other titles THE SAME seat is known by in this database
 * @property {string} color
 */

/** @type {JobRole[]} */
export const JOB_ROLES = Object.freeze([
  {
    key: 'managing-director',
    title: 'Managing Director (MD) / Admin',
    short: 'Managing Director',
    systemRole: ROLES.MD,
    department: null,
    seats: 3,
    sheetRows: '1-3',
    sheetEmails: ['prateek@mysteryrooms.in', 'shikhir@mysteryrooms.in', 'sapna@mysteryrooms.in'],
    aliases: ['Managing Director', 'MD', 'ERP Administrator', 'Admin'],
    color: '#6E45FF',
  },
  {
    key: 'project-management-head',
    title: 'Project Management Head',
    short: 'PM Head',
    systemRole: ROLES.MANAGER,
    department: DEPARTMENTS.PROJECTS,
    seats: 1,
    sheetRows: '4',
    sheetEmails: ['siddharth.kumar@mysteryrooms.in'],
    aliases: ['Projects Head', 'Project Head', 'PMO Head'],
    color: '#14B8A6',
  },
  {
    key: 'project-manager',
    title: 'Project Manager',
    short: 'Project Manager',
    systemRole: ROLES.MANAGER,
    department: DEPARTMENTS.PROJECTS,
    seats: 1,
    sheetRows: '5',
    sheetEmails: ['siddharth.kumar@mysteryrooms.in'],
    aliases: ['Projects Manager'],
    color: '#0EA5A4',
  },
  {
    key: 'property-franchise-consultant',
    title: 'Property / Franchise Consultant',
    short: 'Property Consultant',
    systemRole: ROLES.EMPLOYEE,
    department: DEPARTMENTS.EXPANSION,
    seats: 1,
    sheetRows: '6',
    sheetEmails: ['pariharmanoj375@gmail.com'],
    aliases: ['Property Consultant', 'Franchise Consultant'],
    color: '#F5A623',
  },
  {
    key: 'technical-expert',
    title: 'Technical Expert',
    short: 'Technical Expert',
    systemRole: ROLES.EMPLOYEE,
    department: DEPARTMENTS.CONSTRUCTION,
    seats: 1,
    sheetRows: '7',
    sheetEmails: ['om.prakash@mysteryrooms.in'],
    aliases: ['Technical Assessor'],
    color: '#CA8A04',
  },
  {
    key: 'financial-expert',
    title: 'Financial Expert',
    short: 'Financial Expert',
    systemRole: ROLES.EMPLOYEE,
    department: DEPARTMENTS.FINANCE,
    seats: 1,
    sheetRows: '8',
    sheetEmails: ['prateek@mysteryrooms.in'],
    aliases: ['Finance Expert', 'Financial Assessor'],
    color: '#F59E0B',
  },
  {
    key: 'operational-expert',
    title: 'Operational Expert',
    short: 'Operational Expert',
    systemRole: ROLES.EMPLOYEE,
    department: DEPARTMENTS.OPERATIONS,
    seats: 1,
    sheetRows: '9',
    sheetEmails: ['shishir.mysteryrooms@gmail.com'],
    aliases: ['Operations Expert', 'Operational Assessor'],
    color: '#16A34A',
  },
  {
    key: 'feasibility-expert',
    title: 'Feasibility Expert',
    short: 'Feasibility Expert',
    systemRole: ROLES.EMPLOYEE,
    department: DEPARTMENTS.EXPANSION,
    seats: 1,
    sheetRows: '10',
    sheetEmails: ['prateek@mysteryrooms.in'],
    aliases: ['Feasibility Assessor'],
    color: '#A855F7',
  },
  {
    key: 'architect-design-team',
    title: 'Architect / Design Team',
    short: 'Architect',
    systemRole: ROLES.EMPLOYEE,
    department: DEPARTMENTS.INTERIOR,
    seats: 1,
    sheetRows: '11',
    sheetEmails: ['architect@mysteryrooms.in'],
    aliases: ['Architect', 'Design Team', 'Design Head'],
    color: '#7C3AED',
  },
  {
    key: 'civil-head',
    title: 'Civil Head',
    short: 'Civil Head',
    systemRole: ROLES.MANAGER,
    department: DEPARTMENTS.CONSTRUCTION,
    seats: 1,
    sheetRows: '12',
    sheetEmails: ['ramsingh989929@gmail.com'],
    aliases: ['Civil Manager', 'Construction Head', 'Construction Manager'],
    color: '#B45309',
  },
  {
    key: 'it-head',
    title: 'IT Head',
    short: 'IT Head',
    systemRole: ROLES.MANAGER,
    department: DEPARTMENTS.IT,
    seats: 1,
    sheetRows: '13',
    sheetEmails: ['chandan.kumar@mysteryrooms.in'],
    aliases: ['IT Manager'],
    color: '#0EA5E9',
  },
  {
    key: 'hr-head',
    title: 'HR Head',
    short: 'HR Head',
    systemRole: ROLES.MANAGER,
    department: DEPARTMENTS.HR,
    seats: 1,
    sheetRows: '14',
    sheetEmails: ['radhika@mysteryrooms.in'],
    aliases: ['HR Manager'],
    color: '#F43F5E',
  },
  {
    key: 'marketing-head',
    title: 'Marketing Head',
    short: 'Marketing Head',
    systemRole: ROLES.MANAGER,
    department: DEPARTMENTS.MARKETING,
    seats: 1,
    sheetRows: '15',
    sheetEmails: ['marketing@mysteryrooms.in'],
    aliases: ['Marketing Manager'],
    color: '#DB2777',
  },
  {
    key: 'store-head',
    title: 'Store Head',
    short: 'Store Head',
    systemRole: ROLES.MANAGER,
    department: DEPARTMENTS.OPERATIONS,
    seats: 1,
    sheetRows: '16',
    sheetEmails: ['inventory@mysteryrooms.in'],
    aliases: ['Store Manager'],
    color: '#059669',
  },
  {
    key: 'logistics-head',
    title: 'Logistics Head',
    short: 'Logistics Head',
    systemRole: ROLES.MANAGER,
    department: DEPARTMENTS.PROCUREMENT,
    seats: 1,
    sheetRows: '17',
    sheetEmails: ['mysteryrooms.backend@gmail.com'],
    aliases: ['Logistics Manager'],
    color: '#EA580C',
  },
  {
    key: 'games-head',
    title: 'Games Head',
    short: 'Games Head',
    systemRole: ROLES.MANAGER,
    department: DEPARTMENTS.AUTOMATION,
    seats: 1,
    sheetRows: '18',
    sheetEmails: ['ramsingh989929@gmail.com'],
    aliases: ['Games Manager', 'Game Head'],
    color: '#4F46E5',
  },
  {
    key: 'site-supervisor-contractor',
    title: 'Site Supervisor / Contractor',
    short: 'Site Supervisor',
    systemRole: ROLES.EMPLOYEE,
    department: DEPARTMENTS.CONSTRUCTION,
    seats: 1,
    sheetRows: '19',
    sheetEmails: ['fardeen314@gmail.com'],
    aliases: ['Site Supervisor', 'Contractor'],
    color: '#65A30D',
  },
  {
    key: 'store-procurement-manager',
    title: 'Store / Procurement Manager',
    short: 'Procurement Manager',
    systemRole: ROLES.MANAGER,
    department: DEPARTMENTS.PROCUREMENT,
    seats: 1,
    sheetRows: '20',
    sheetEmails: ['purchase@mysteryrooms.in'],
    aliases: ['Procurement Manager'],
    color: '#0891B2',
  },
  {
    key: 'operations-head',
    title: 'Operations Head',
    short: 'Operations Head',
    systemRole: ROLES.MANAGER,
    department: DEPARTMENTS.OPERATIONS,
    seats: 1,
    sheetRows: '21',
    sheetEmails: ['ajay.sahni@mysteryrooms.in'],
    aliases: ['Operations Manager', 'Ops Head'],
    color: '#2563EB',
  },
  {
    key: 'cluster-branch-manager',
    title: 'Cluster / Branch Manager',
    short: 'Branch Manager',
    systemRole: ROLES.MANAGER,
    department: DEPARTMENTS.OPERATIONS,
    seats: 5,
    sheetRows: '22-26',
    sheetEmails: [
      'yogita.chauhan@mysteryrooms.in',
      'yash.shroff@mysteryrooms.in',
      'ashwini.rawale@mysteryrooms.in',
      'vishal.saluja@mysteryrooms.in',
      'dawood.yousuf@mysteryrooms.in',
    ],
    aliases: ['Cluster Manager', 'Branch Manager'],
    color: '#9333EA',
  },
]);

export const JOB_ROLE_KEYS = Object.freeze(JOB_ROLES.map((r) => r.key));

const BY_KEY = new Map(JOB_ROLES.map((r) => [r.key, r]));

export const jobRole = (key) => BY_KEY.get(key) ?? null;
export const isJobRole = (key) => BY_KEY.has(key);
export const jobRoleTitle = (key) => BY_KEY.get(key)?.title ?? key;

/** Punctuation- and case-insensitive, so "Store / Procurement Manager" and
 *  "store/procurement manager" are the same seat. */
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Recognise a job role from a free-text title.
 *
 * Needed because `User.title` held these as prose for as long as there was
 * nowhere better to put them, and the strings in there are the sheet's
 * wording, this database's older wording, or a near-miss of either. Matching
 * on the aliases each seat already declares is what lets the migration adopt
 * an existing account instead of creating a second one beside it.
 *
 * An alias only ever names the SAME seat. "Civil Engineer" is not "Civil
 * Head" and "Marketing Exec" is not "Marketing Head" — a doer and the person
 * who signs off their work must not collapse into one role, or the approval
 * gate approves itself.
 */
export function jobRoleFromTitle(title, { aliases = true } = {}) {
  const n = norm(title);
  if (!n) return null;
  const exact = JOB_ROLES.find((r) => norm(r.title) === n);
  if (exact || !aliases) return exact ?? null;
  return JOB_ROLES.find((r) => r.aliases.some((a) => norm(a) === n)) ?? null;
}

/**
 * The security tier a set of job roles adds up to.
 *
 * The STRONGEST wins, because a person holding several seats holds all of
 * them: the sheet lists Prateek as Managing Director, Financial Expert and
 * Feasibility Expert, and he does not stop being the MD while filing a
 * feasibility score.
 */
const TIER_ORDER = [ROLES.VIEWER, ROLES.EMPLOYEE, ROLES.MANAGER, ROLES.EA, ROLES.MD];

export function systemRoleFor(keys = []) {
  let best = null;
  for (const key of keys) {
    const r = BY_KEY.get(key);
    if (!r) continue;
    if (best === null || TIER_ORDER.indexOf(r.systemRole) > TIER_ORDER.indexOf(best)) best = r.systemRole;
  }
  return best;
}

/**
 * WHO OWNS EACH FORM, by name, from the org sheet.
 *
 * The four Site Evaluations are the clearest case in the whole ERP: the sheet
 * names a Feasibility Expert, a Financial Expert, a Technical Expert and an
 * Operational Expert, and those four people are exactly who fills those four
 * forms. Before this the assessment tasks were addressed to the roster
 * strings the demo template shipped with (`emp-exp-001`), so the work was
 * created correctly and then handed to whoever those placeholders resolved
 * to — which is not the person the company means.
 *
 * Only forms whose owner the sheet states outright are listed. The six
 * commercial documents are deliberately absent: the sheet does not say who
 * files an NOC, and guessing would put a lease in somebody's queue on no
 * authority at all. Those keep whatever the template assigns until the
 * company says otherwise — and the Access Control screen can hand the step
 * to the right role in the meantime.
 */
export const FORM_OWNER = Object.freeze({
  feasibility: 'feasibility-expert',
  financial: 'financial-expert',
  technical: 'technical-expert',
  operational: 'operational-expert',
});

/** The job role that owns a form, or null when the sheet does not say. */
export const ownerRoleFor = (formKey) => FORM_OWNER[formKey] ?? null;

export default JOB_ROLES;
