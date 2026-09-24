/* eslint-disable no-console */
/**
 * Write the client's copy of the company's own roles.
 *
 * The browser needs a seat's name, short name and colour to draw a badge, and
 * waiting for a round trip to render the word "Civil Head" would make every
 * table flash. So the registry is mirrored into client/src/lib/jobRoles.js —
 * the same arrangement lib/roles.js already has with the five security tiers.
 *
 * GENERATED RATHER THAN HAND-COPIED, because a mirror maintained by hand is a
 * mirror that drifts, and the failure mode here is a screen confidently
 * showing a seat that no longer exists. Edit the server registry, run this,
 * commit both.
 *
 * EMAILS ARE DELIBERATELY LEFT BEHIND. The sheet pairs each seat with the
 * person who holds it; that pairing is directory data the server serves to
 * the people allowed to see it, not something to ship in every bundle.
 *
 *   node src/seed/lib/emitClientJobRoles.mjs        # from server/
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JOB_ROLES } from '../../core/constants/jobRoles.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '../../../../client/src/lib/jobRoles.js');

const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

const entries = JOB_ROLES.map((r) => `  {
    key: ${q(r.key)},
    title: ${q(r.title)},
    short: ${q(r.short)},
    systemRole: ${q(r.systemRole)},
    department: ${r.department ? q(r.department) : 'null'},
    seats: ${r.seats},
    sheetRows: ${q(r.sheetRows)},
    color: ${q(r.color)},
  },`).join('\n');

const file = `/**
 * THE COMPANY'S OWN ROLES — the client mirror of
 * server/src/core/constants/jobRoles.js, which is itself transcribed from
 * SHEET/USERROLE.xlsx and checked against that workbook every time
 * \`npm run migrate:jobroles\` is run.
 *
 * These are the roles. "Civil Head", "Feasibility Expert", "Cluster / Branch
 * Manager" — what the org chart says, what the Employees page shows, and what
 * Settings → Access Control writes its policy against. The five values in
 * lib/roles.js (md, ea, manager, employee, viewer) are NOT a competing list
 * of job titles: they are the security tier the server enforces underneath,
 * and \`systemRole\` below is the seat that maps to it.
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
 * \`node src/seed/lib/emitClientJobRoles.mjs\` from server/ and commit both.
 */

export const JOB_ROLES = Object.freeze([
${entries}
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
  if (seats.length) return seats.map((r) => r.title).join(' \\u00b7 ');
  return user?.title || '';
}

export default JOB_ROLES;
`;

fs.writeFileSync(OUT, file, 'utf8');
console.log(`Wrote ${path.relative(process.cwd(), OUT)} — ${JOB_ROLES.length} roles.`);
