/**
 * The REAL Mystery Rooms user accounts, from SHEET/USERROLE.xlsx ("User Roles").
 *
 * The sheet lists 26 role rows, but several people hold more than one role and
 * an account is a PERSON, not a role — an email address can only log in once.
 * So the 26 rows become 22 accounts, and someone's extra roles are recorded in
 * their `title` (e.g. "Managing Director · Financial Expert · Feasibility
 * Expert"). Nothing is lost; it is just filed under the person who does it.
 *
 * The sheet's "Role" column is the BUSINESS role. The system has five
 * permission roles (md / ea / manager / employee / viewer), so each business
 * role is mapped below, deliberately and visibly:
 *
 *   Managing Director (MD) / Admin ............. md        (full control)
 *   any "… Head" / "… Manager" ................. manager   (owns work, approves)
 *   experts, consultants, architect, supervisor  employee  (does the work, files forms)
 *
 * Departments follow the template's own wiring where one exists — the Technical
 * assessment and Design & Drawings both sit with PROJECTS in
 * clientFlowTemplate.js, so the Technical Expert and the Architect do too.
 *
 * Names come from the email address, as asked. Five addresses are shared
 * mailboxes rather than a person (architect@, marketing@, inventory@,
 * purchase@, mysteryrooms.backend@) — those are named after the role they
 * serve, which is what the mailbox actually is.
 *
 * SAFE BY DEFAULT: dry run, prints the plan, writes nothing. Pass --apply.
 *
 *   node src/seed/createRealUsers.js                      # show the plan
 *   node src/seed/createRealUsers.js --apply              # create / update
 *   node src/seed/createRealUsers.js --apply --reset-passwords
 *
 * Re-runnable: accounts are matched by email, so a second run updates rather
 * than duplicates. An EXISTING account's password is never touched unless
 * --reset-passwords is passed — someone may already have changed their own.
 */
import mongoose from 'mongoose';
import { config } from '../config/index.js';
import { User } from '../modules/auth/auth.model.js';
import { ROLES, DEPARTMENTS as D } from '../core/constants/index.js';

const APPLY = process.argv.includes('--apply');
const RESET_PASSWORDS = process.argv.includes('--reset-passwords');
const PASSWORD = '12345678';

/** Distinct avatar tints, so a room full of new accounts is readable at a glance. */
const COLORS = [
  '#6E45FF', '#0EA5E9', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899',
  '#14B8A6', '#F97316', '#3B82F6', '#84CC16', '#A855F7',
];

/**
 * One row per PERSON. `roles` is every business role the sheet gives them, in
 * sheet order; the first one decides their permission role and department.
 * `employeeId` uses an MR-## namespace of its own so it cannot collide with the
 * demo roster (emp-exp-001 …) that the templates currently assign tasks to.
 */
const PEOPLE = [
  { id: 'MR-01', email: 'prateek@mysteryrooms.in', name: 'Prateek', phone: '9899883322', role: ROLES.MD, dept: null, roles: ['Managing Director (MD) / Admin', 'Financial Expert', 'Feasibility Expert'] },
  { id: 'MR-02', email: 'shikhir@mysteryrooms.in', name: 'Shikhir', phone: '9773733990', role: ROLES.MD, dept: null, roles: ['Managing Director (MD) / Admin'] },
  { id: 'MR-03', email: 'sapna@mysteryrooms.in', name: 'Sapna', phone: '9911421000', role: ROLES.MD, dept: null, roles: ['Managing Director (MD) / Admin'] },
  { id: 'MR-04', email: 'siddharth.kumar@mysteryrooms.in', name: 'Siddharth Kumar', phone: '8810397312', role: ROLES.MANAGER, dept: D.PROJECTS, roles: ['Project Management Head', 'Project Manager'] },
  // Surname-first mailbox (parihar + manoj). Read as "Manoj Parihar"; correct
  // it here if the sheet's owner spells it the other way round.
  { id: 'MR-05', email: 'pariharmanoj375@gmail.com', name: 'Manoj Parihar', phone: '9818203875', role: ROLES.EMPLOYEE, dept: D.EXPANSION, roles: ['Property / Franchise Consultant'] },
  { id: 'MR-06', email: 'om.prakash@mysteryrooms.in', name: 'Om Prakash', phone: '8448622256', role: ROLES.EMPLOYEE, dept: D.PROJECTS, roles: ['Technical Expert'] },
  { id: 'MR-07', email: 'shishir.mysteryrooms@gmail.com', name: 'Shishir', phone: '9267998160', role: ROLES.EMPLOYEE, dept: D.OPERATIONS, roles: ['Operational Expert'] },
  { id: 'MR-08', email: 'architect@mysteryrooms.in', name: 'Architect / Design Team', phone: '9982222789', role: ROLES.EMPLOYEE, dept: D.PROJECTS, roles: ['Architect / Design Team'], shared: true },
  { id: 'MR-09', email: 'ramsingh989929@gmail.com', name: 'Ram Singh', phone: '9899296421', role: ROLES.MANAGER, dept: D.CONSTRUCTION, roles: ['Civil Head', 'Games Head'] },
  { id: 'MR-10', email: 'chandan.kumar@mysteryrooms.in', name: 'Chandan Kumar', phone: '9354188370', role: ROLES.MANAGER, dept: D.IT, roles: ['IT Head'] },
  { id: 'MR-11', email: 'radhika@mysteryrooms.in', name: 'Radhika', phone: '7701962526', role: ROLES.MANAGER, dept: D.HR, roles: ['HR Head'] },
  { id: 'MR-12', email: 'marketing@mysteryrooms.in', name: 'Marketing Head', phone: '9355188533', role: ROLES.MANAGER, dept: D.MARKETING, roles: ['Marketing Head'], shared: true },
  { id: 'MR-13', email: 'inventory@mysteryrooms.in', name: 'Store Head', phone: '9218302993', role: ROLES.MANAGER, dept: D.PROCUREMENT, roles: ['Store Head'], shared: true },
  { id: 'MR-14', email: 'mysteryrooms.backend@gmail.com', name: 'Logistics Head', phone: '7428843352', role: ROLES.MANAGER, dept: D.PROCUREMENT, roles: ['Logistics Head'], shared: true },
  { id: 'MR-15', email: 'fardeen314@gmail.com', name: 'Fardeen', phone: '9899392067', role: ROLES.EMPLOYEE, dept: D.CONSTRUCTION, roles: ['Site Supervisor / Contractor'] },
  { id: 'MR-16', email: 'purchase@mysteryrooms.in', name: 'Store / Procurement Manager', phone: '9355188944', role: ROLES.MANAGER, dept: D.PROCUREMENT, roles: ['Store / Procurement Manager'], shared: true },
  { id: 'MR-17', email: 'ajay.sahni@mysteryrooms.in', name: 'Ajay Sahni', phone: '9971469664', role: ROLES.MANAGER, dept: D.OPERATIONS, roles: ['Operations Head'] },
  { id: 'MR-18', email: 'yogita.chauhan@mysteryrooms.in', name: 'Yogita Chauhan', phone: '9218302992', role: ROLES.MANAGER, dept: D.OPERATIONS, roles: ['Cluster / Branch Manager'] },
  { id: 'MR-19', email: 'yash.shroff@mysteryrooms.in', name: 'Yash Shroff', phone: '7678398954', role: ROLES.MANAGER, dept: D.OPERATIONS, roles: ['Cluster / Branch Manager'] },
  { id: 'MR-20', email: 'ashwini.rawale@mysteryrooms.in', name: 'Ashwini Rawale', phone: '7678398953', role: ROLES.MANAGER, dept: D.OPERATIONS, roles: ['Cluster / Branch Manager'] },
  { id: 'MR-21', email: 'vishal.saluja@mysteryrooms.in', name: 'Vishal Saluja', phone: '7678398948', role: ROLES.MANAGER, dept: D.OPERATIONS, roles: ['Cluster / Branch Manager'] },
  { id: 'MR-22', email: 'dawood.yousuf@mysteryrooms.in', name: 'Dawood Yousuf', phone: '7678398960', role: ROLES.MANAGER, dept: D.OPERATIONS, roles: ['Cluster / Branch Manager'] },
];

/** "Managing Director · Financial Expert" — every role they hold, on one line. */
const titleOf = (p) => p.roles.join(' · ');

async function main() {
  await mongoose.connect(config.db.uri);
  console.log(APPLY ? '\n== APPLYING ==' : '\n== DRY RUN (no writes) - pass --apply to persist ==');
  console.log(`${PEOPLE.length} accounts from ${new Set(PEOPLE.flatMap((p) => p.roles)).size} business roles`);
  console.log(`Password for NEW accounts: ${PASSWORD}${RESET_PASSWORDS ? '  (existing accounts will be RESET to it too)' : '  (existing accounts keep their own)'}\n`);

  const created = [];
  const updated = [];
  for (const [i, p] of PEOPLE.entries()) {
    const email = p.email.toLowerCase();
    const existing = await User.findOne({ email });
    const fields = {
      name: p.name,
      role: p.role,
      department: p.dept || undefined,
      employeeId: p.id,
      title: titleOf(p),
      phone: p.phone,
      avatarColor: COLORS[i % COLORS.length],
      isActive: true,
    };

    if (existing) {
      const changes = Object.entries(fields)
        .filter(([k, v]) => v !== undefined && String(existing[k] ?? '') !== String(v))
        .map(([k, v]) => `${k}="${v}"`);
      if (RESET_PASSWORDS) changes.push('password=reset');
      updated.push({ p, changes });
      if (APPLY) {
        Object.assign(existing, fields);
        if (RESET_PASSWORDS) existing.password = PASSWORD; // hashed by the model's pre-save hook
        await existing.save();
      }
    } else {
      created.push(p);
      if (APPLY) await User.create({ ...fields, email, password: PASSWORD });
    }
  }

  const line = (p, tag) => `  ${tag}  ${p.id}  ${p.email.padEnd(34)} ${p.role.padEnd(8)} ${(p.dept || '-').padEnd(13)} ${p.name.padEnd(28)} ${titleOf(p)}`;
  console.log(`NEW (${created.length}):`);
  for (const p of created) console.log(line(p, '+'));
  if (updated.length) {
    console.log(`\nALREADY EXISTED (${updated.length}) - updated in place, not duplicated:`);
    for (const { p, changes } of updated) {
      console.log(line(p, '~'));
      console.log(`        ${changes.length ? `changed: ${changes.join(', ')}` : 'no change needed'}`);
    }
  }
  console.log(APPLY ? `\nDone - ${created.length} created, ${updated.length} updated.` : '\nNothing written. Re-run with --apply.');
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
