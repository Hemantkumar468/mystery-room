/**
 * THE COMPANY'S OWN ROLES — the client mirror of
 * server/src/core/constants/jobRoles.js, which is itself transcribed from
 * SHEET/USERROLE.xlsx and checked against that workbook every time
 * `npm run migrate:jobroles` is run.
 *
 * These are the roles. "Civil Head", "Feasibility Expert", "Cluster / Branch
 * Manager" — what the org chart says, what the Employees page shows, and what
 * Settings → Access Control writes its policy against. The five values in
 * lib/roles.js (md, ea, manager, employee, viewer) are NOT a competing list
 * of job titles: they are the security tier the server enforces underneath,
 * and `systemRole` below is the seat that maps to it.
 *
 * A seat can be granted LESS than its tier on the Access Control screen —
 * that is what the screen is for. It can never be granted more, because the
 * server's own authorize() guards are still there beneath the policy.
 *
 * MIRRORED for the same reason lib/roles.js is: the server re-checks every
 * request, and this copy exists so a screen can put a name and a colour on a
 * seat without a round trip. It carries no email addresses — the sheet pairs
 * each seat with the person who holds it, and that pairing is directory data
 * the server serves, not something to ship in every bundle.
 *
 * GENERATED, not hand-written. After editing the server registry, run
 * `node src/seed/lib/emitClientJobRoles.mjs` from server/ and commit both.
 */

export const JOB_ROLES = Object.freeze([
  {
    key: 'managing-director',
    title: 'Managing Director (MD) / Admin',
    short: 'Managing Director',
    systemRole: 'md',
    department: null,
    seats: 3,
    sheetRows: '1-3',
    color: '#6E45FF',
  },
  {
    key: 'project-management-head',
    title: 'Project Management Head',
    short: 'PM Head',
    systemRole: 'manager',
    department: 'projects',
    seats: 1,
    sheetRows: '4',
    color: '#14B8A6',
  },
  {
    key: 'project-manager',
    title: 'Project Manager',
    short: 'Project Manager',
    systemRole: 'manager',
    department: 'projects',
    seats: 1,
    sheetRows: '5',
    color: '#0EA5A4',
  },
  {
    key: 'property-franchise-consultant',
    title: 'Property / Franchise Consultant',
    short: 'Property Consultant',
    systemRole: 'employee',
    department: 'expansion',
    seats: 1,
    sheetRows: '6',
    color: '#F5A623',
  },
  {
    key: 'technical-expert',
    title: 'Technical Expert',
    short: 'Technical Expert',
    systemRole: 'employee',
    department: 'construction',
    seats: 1,
    sheetRows: '7',
    color: '#CA8A04',
  },
  {
    key: 'financial-expert',
    title: 'Financial Expert',
    short: 'Financial Expert',
    systemRole: 'employee',
    department: 'finance',
    seats: 1,
    sheetRows: '8',
    color: '#F59E0B',
  },
  {
    key: 'operational-expert',
    title: 'Operational Expert',
    short: 'Operational Expert',
    systemRole: 'employee',
    department: 'operations',
    seats: 1,
    sheetRows: '9',
    color: '#16A34A',
  },
  {
    key: 'feasibility-expert',
    title: 'Feasibility Expert',
    short: 'Feasibility Expert',
    systemRole: 'employee',
    department: 'expansion',
    seats: 1,
    sheetRows: '10',
    color: '#A855F7',
  },
  {
    key: 'architect-design-team',
    title: 'Architect / Design Team',
    short: 'Architect',
    systemRole: 'employee',
    department: 'interior',
    seats: 1,
    sheetRows: '11',
    color: '#7C3AED',
  },
  {
    key: 'civil-head',
    title: 'Civil Head',
    short: 'Civil Head',
    systemRole: 'manager',
    department: 'construction',
    seats: 1,
    sheetRows: '12',
    color: '#B45309',
  },
  {
    key: 'it-head',
    title: 'IT Head',
    short: 'IT Head',
    systemRole: 'manager',
    department: 'it',
    seats: 1,
    sheetRows: '13',
    color: '#0EA5E9',
  },
  {
    key: 'hr-head',
    title: 'HR Head',
    short: 'HR Head',
    systemRole: 'manager',
    department: 'hr',
    seats: 1,
    sheetRows: '14',
    color: '#F43F5E',
  },
  {
    key: 'marketing-head',
    title: 'Marketing Head',
    short: 'Marketing Head',
    systemRole: 'manager',
    department: 'marketing',
    seats: 1,
    sheetRows: '15',
    color: '#DB2777',
  },
  {
    key: 'store-head',
    title: 'Store Head',
    short: 'Store Head',
    systemRole: 'manager',
    department: 'operations',
    seats: 1,
    sheetRows: '16',
    color: '#059669',
  },
  {
    key: 'logistics-head',
    title: 'Logistics Head',
    short: 'Logistics Head',
    systemRole: 'manager',
    department: 'procurement',
    seats: 1,
    sheetRows: '17',
    color: '#EA580C',
  },
  {
    key: 'games-head',
    title: 'Games Head',
    short: 'Games Head',
    systemRole: 'manager',
    department: 'automation',
    seats: 1,
    sheetRows: '18',
    color: '#4F46E5',
  },
  {
    key: 'site-supervisor-contractor',
    title: 'Site Supervisor / Contractor',
    short: 'Site Supervisor',
    systemRole: 'employee',
    department: 'construction',
    seats: 1,
    sheetRows: '19',
    color: '#65A30D',
  },
  {
    key: 'store-procurement-manager',
    title: 'Store / Procurement Manager',
    short: 'Procurement Manager',
    systemRole: 'manager',
    department: 'procurement',
    seats: 1,
    sheetRows: '20',
    color: '#0891B2',
  },
  {
    key: 'operations-head',
    title: 'Operations Head',
    short: 'Operations Head',
    systemRole: 'manager',
    department: 'operations',
    seats: 1,
    sheetRows: '21',
    color: '#2563EB',
  },
  {
    key: 'cluster-branch-manager',
    title: 'Cluster / Branch Manager',
    short: 'Branch Manager',
    systemRole: 'manager',
    department: 'operations',
    seats: 5,
    sheetRows: '22-26',
    color: '#9333EA',
  },
]);

export const JOB_ROLE_KEYS = Object.freeze(JOB_ROLES.map((r) => r.key));

const BY_KEY = new Map(JOB_ROLES.map((r) => [r.key, r]));

export const jobRole = (key) => BY_KEY.get(key) ?? null;
export const jobRoleTitle = (key) => BY_KEY.get(key)?.title ?? key;
export const jobRoleShort = (key) => BY_KEY.get(key)?.short ?? key;
export const jobRoleColor = (key) => BY_KEY.get(key)?.color ?? '#6B7280';

/** The seats a person holds, as registry entries. Unknown keys are dropped. */
export const jobRolesOf = (user) => (user?.jobRoles ?? []).map(jobRole).filter(Boolean);

/**
 * What to call somebody, in one line.
 *
 * Their seats when the sheet gives them any, their free-text title when it
 * does not, and an empty string rather than a guess when there is neither.
 * No seat is a real state — the demo and QA logins predate the sheet — and
 * the Employees page flags it for assignment instead of inventing a
 * designation nobody chose.
 */
export function designationOf(user) {
  const seats = jobRolesOf(user);
  if (seats.length) return seats.map((r) => r.title).join(' \u00b7 ');
  return user?.title || '';
}

export default JOB_ROLES;
