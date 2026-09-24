/* eslint-disable no-console */
/**
 * The client's org chart, as login accounts.
 *
 * The functional-flow document lists 26 seats, and work in the client-flow
 * template is handed to them BY NAME — `who: 'Feasibility Expert'`,
 * `'Technical Expert'`, `'Cluster / Branch Manager'` (see clientFlowTemplate.js).
 * Those are plain strings on a checklist row. If no account carries that title,
 * the work can be printed but never assigned: `Task.assignee` stays empty, and
 * an empty assignee is the one field My Tasks queries. The task exists and
 * reaches nobody.
 *
 * So this creates the missing SEAT, not a new permission. The ERP still has
 * exactly five system roles (core/constants: md, ea, manager, employee, viewer)
 * and every guard still branches on those; a job role is a `title` on the
 * account plus the department it answers for. Adding "Games Head" to the ROLES
 * enum would mean re-deriving every capability tier for a distinction the
 * permission model does not make — a Head approves because they are a manager
 * of that department, not because of the word "Head".
 *
 * ── The 26 rows become 21 accounts ──────────────────────────────────────
 * The table repeats MD/Admin three times and Cluster / Branch Manager five,
 * because it counts PEOPLE. One account per distinct role is seeded; further
 * seats are ordinary Add Employee work once the real names are known.
 *
 * ── Never creates a second account for a seat that exists ───────────────
 * Each role carries the aliases the same seat is already known by in this
 * database, and a role counts as filled if ANY account matches by title, name
 * or email — so HR Head recognises Neha Kapoor's "HR Manager" and is skipped
 * rather than duplicated. The check runs against live data, so it stays correct
 * as the directory changes and re-running is a no-op.
 *
 * An alias only ever names the SAME seat. "Civil Engineer" is not "Civil Head"
 * and "Marketing Exec" is not "Marketing Head" — a doer and the person who
 * signs off their work cannot be one account, or the approval gate approves
 * itself.
 *
 *   npm run seed:roles            # report only — nothing is written
 *   npm run seed:roles -- --apply # create the missing accounts
 */
import dns from 'node:dns';
import { pathToFileURL } from 'node:url';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();
// Same reason as backfillTenancy.js: Atlas is reached over an SRV record, and
// the resolver handed out by some networks refuses `_mongodb._tcp` lookups.
dns.setServers(['8.8.8.8', '8.8.4.4']);

const APPLY = process.argv.includes('--apply');

/**
 * One shared sign-in for every seeded account — the same credential seed.js
 * documents, so seeding does not scatter a second password across the
 * directory. A demo/development convenience: real staff get their own password
 * set through the Employees screen.
 */
const DEFAULT_PASSWORD = '12345678';

/**
 * The client's 26-row role table, in its own order.
 *
 * `seats` records what the table asked for, so the difference between "one
 * account" and "five branch managers" stays visible instead of looking like a
 * transcription slip. `aliases` are other titles THE SAME SEAT is known by in
 * this database — never a neighbouring, more junior one.
 */
export const ORG_ROLES = [
  {
    row: '1–3', seats: 3, title: 'Managing Director (MD) / Admin',
    systemRole: 'md', department: null,
    aliases: ['Managing Director', 'MD', 'ERP Administrator', 'Admin'],
    email: 'md.admin@mysteryrooms.in', name: 'Managing Director', color: '#6E45FF',
  },
  {
    row: '4', seats: 1, title: 'Project Management Head',
    systemRole: 'manager', department: 'projects',
    aliases: ['Projects Head', 'Project Head', 'PMO Head'],
    email: 'pm.head@mysteryrooms.in', name: 'Project Management Head', color: '#14B8A6',
  },
  {
    row: '5', seats: 1, title: 'Project Manager',
    systemRole: 'manager', department: 'projects',
    aliases: ['Projects Manager'],
    email: 'project.manager@mysteryrooms.in', name: 'Project Manager', color: '#0EA5A4',
  },
  {
    row: '6', seats: 1, title: 'Property / Franchise Consultant',
    systemRole: 'employee', department: 'expansion',
    aliases: ['Property Consultant', 'Franchise Consultant'],
    email: 'property.consultant@mysteryrooms.in', name: 'Property / Franchise Consultant', color: '#F5A623',
  },
  {
    row: '7', seats: 1, title: 'Technical Expert',
    systemRole: 'employee', department: 'construction',
    aliases: ['Technical Assessor'],
    email: 'technical.expert@mysteryrooms.in', name: 'Technical Expert', color: '#CA8A04',
  },
  {
    row: '8', seats: 1, title: 'Financial Expert',
    systemRole: 'employee', department: 'finance',
    aliases: ['Finance Expert', 'Financial Assessor'],
    email: 'financial.expert@mysteryrooms.in', name: 'Financial Expert', color: '#F59E0B',
  },
  {
    row: '9', seats: 1, title: 'Operational Expert',
    systemRole: 'employee', department: 'operations',
    aliases: ['Operations Expert', 'Operational Assessor'],
    email: 'operational.expert@mysteryrooms.in', name: 'Operational Expert', color: '#16A34A',
  },
  {
    row: '10', seats: 1, title: 'Feasibility Expert',
    systemRole: 'employee', department: 'expansion',
    aliases: ['Feasibility Assessor'],
    email: 'feasibility.expert@mysteryrooms.in', name: 'Feasibility Expert', color: '#A855F7',
  },
  {
    row: '11', seats: 1, title: 'Architect / Design Team',
    systemRole: 'employee', department: 'interior',
    aliases: ['Architect', 'Design Team', 'Design Head'],
    email: 'architect@mysteryrooms.in', name: 'Architect / Design Team', color: '#7C3AED',
  },
  {
    row: '12', seats: 1, title: 'Civil Head',
    systemRole: 'manager', department: 'construction',
    aliases: ['Civil Manager', 'Construction Head', 'Construction Manager'],
    email: 'civil.head@mysteryrooms.in', name: 'Civil Head', color: '#B45309',
  },
  {
    row: '13', seats: 1, title: 'IT Head',
    systemRole: 'manager', department: 'it',
    aliases: ['IT Manager'],
    email: 'it.head@mysteryrooms.in', name: 'IT Head', color: '#0EA5E9',
  },
  {
    row: '14', seats: 1, title: 'HR Head',
    systemRole: 'manager', department: 'hr',
    aliases: ['HR Manager'],
    email: 'hr.head@mysteryrooms.in', name: 'HR Head', color: '#F43F5E',
  },
  {
    row: '15', seats: 1, title: 'Marketing Head',
    systemRole: 'manager', department: 'marketing',
    aliases: ['Marketing Manager'],
    email: 'marketing.head@mysteryrooms.in', name: 'Marketing Head', color: '#DB2777',
  },
  {
    row: '16', seats: 1, title: 'Store Head',
    systemRole: 'manager', department: 'operations',
    aliases: ['Store Manager'],
    email: 'store.head@mysteryrooms.in', name: 'Store Head', color: '#059669',
  },
  {
    row: '17', seats: 1, title: 'Logistics Head',
    systemRole: 'manager', department: 'procurement',
    aliases: ['Logistics Manager'],
    email: 'logistics.head@mysteryrooms.in', name: 'Logistics Head', color: '#EA580C',
  },
  {
    row: '18', seats: 1, title: 'Games Head',
    systemRole: 'manager', department: 'automation',
    aliases: ['Games Manager', 'Game Head'],
    email: 'games.head@mysteryrooms.in', name: 'Games Head', color: '#4F46E5',
  },
  {
    row: '19', seats: 1, title: 'Site Supervisor / Contractor',
    systemRole: 'employee', department: 'construction',
    aliases: ['Site Supervisor', 'Contractor'],
    email: 'site.supervisor@mysteryrooms.in', name: 'Site Supervisor / Contractor', color: '#65A30D',
  },
  {
    row: '20', seats: 1, title: 'Store / Procurement Manager',
    systemRole: 'manager', department: 'procurement',
    aliases: ['Procurement Manager'],
    email: 'procurement.manager@mysteryrooms.in', name: 'Store / Procurement Manager', color: '#0891B2',
  },
  {
    row: '21', seats: 1, title: 'Operations Head',
    systemRole: 'manager', department: 'operations',
    aliases: ['Operations Manager', 'Ops Head'],
    email: 'operations.head@mysteryrooms.in', name: 'Operations Head', color: '#2563EB',
  },
  {
    row: '22–26', seats: 5, title: 'Cluster / Branch Manager',
    systemRole: 'manager', department: 'operations',
    aliases: ['Cluster Manager', 'Branch Manager'],
    email: 'cluster.manager@mysteryrooms.in', name: 'Cluster / Branch Manager', color: '#9333EA',
  },
];

/** Punctuation- and case-insensitive, so "Store / Procurement Manager" and
 *  "Store/Procurement manager" are recognised as one seat. */
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Does an existing account already hold this seat?
 *
 * Title first — it is what the seat IS. Then name, because the role-named
 * accounts in this directory ("MD", "Manager User") carry the role in the name
 * and nothing in the title. Then the canonical email, which recognises an
 * earlier run of this script whose title an admin has since edited.
 */
function findHolder(role, users) {
  const wanted = new Set([role.title, ...role.aliases].map(norm));
  return users.find((u) => u.email?.toLowerCase() === role.email
    || wanted.has(norm(u.title))
    || wanted.has(norm(u.name)));
}

async function run() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 30_000 });

  const { withTenant, withoutTenant } = await import('../core/tenancy/tenantContext.js');
  const { Tenant } = await import('../core/tenancy/tenant.model.js');
  const { User } = await import('../modules/auth/auth.model.js');

  // Read the company list outside any scope — this is what decides the scope
  // everything else runs in.
  const tenants = await withoutTenant(
    'choosing which company these role accounts belong to',
    () => Tenant.find({ isActive: { $ne: false } }).select('_id name isDefault').lean(),
  );
  if (!tenants.length) {
    throw new Error('No company exists yet — run `npm run migrate:tenancy -- --apply` first.');
  }
  if (tenants.length > 1) {
    throw new Error(
      `${tenants.length} companies exist, so which one these accounts belong to cannot be inferred. `
      + 'Seed them one company at a time, naming the tenant explicitly.',
    );
  }
  const tenant = tenants.find((t) => t.isDefault) || tenants[0];
  console.log(`Company: ${tenant.name} (${tenant._id})\n`);

  await withTenant(String(tenant._id), async () => {
    // `isActive` is `select: false`, and a deactivated account still occupies
    // its seat — reactivating one beats creating a twin.
    const users = await User.find({}).select('name email role title department isActive').lean();

    const missing = [];
    console.log('Role table → directory');
    console.log('─'.repeat(78));
    for (const role of ORG_ROLES) {
      const holder = findHolder(role, users);
      const seats = role.seats > 1 ? ` (${role.seats} seats in the table)` : '';
      if (holder) {
        const via = norm(holder.title) === norm(role.title) ? '' : ` as "${holder.title || holder.name}"`;
        const off = holder.isActive === false ? ' [DEACTIVATED]' : '';
        console.log(`  OK   ${role.title}${seats} — ${holder.name} <${holder.email}>${via}${off}`);
      } else {
        missing.push(role);
        console.log(`  --   ${role.title}${seats} — no account`);
      }
    }

    console.log('─'.repeat(78));
    if (!missing.length) {
      console.log('\nEvery role in the table has an account. Nothing to do.');
      return;
    }
    console.log(`\n${missing.length} role(s) to create:\n`);
    for (const role of missing) {
      console.log(`  ${role.title.padEnd(32)} ${role.systemRole.padEnd(9)}`
        + `${(role.department || '—').padEnd(13)} ${role.email}`);
    }

    if (!APPLY) {
      console.log('\nReport only — nothing written. Re-run with --apply to create these accounts.');
      return;
    }

    console.log('');
    for (const role of missing) {
      // `new User().save()`, never findOneAndUpdate: the bcrypt hash lives in a
      // pre('save') hook and an upsert skips it, which would store the password
      // in clear and leave an account nobody can actually sign in to.
      const doc = new User({
        name: role.name,
        email: role.email,
        password: DEFAULT_PASSWORD,
        role: role.systemRole,
        title: role.title,
        avatarColor: role.color,
        ...(role.department ? { department: role.department } : {}),
      });
      // eslint-disable-next-line no-await-in-loop
      await doc.save();
      console.log(`  created  ${role.title} <${role.email}>`);
    }
    console.log(`\n${missing.length} account(s) created. Shared password: ${DEFAULT_PASSWORD}`);
    console.log('Set real passwords from Employees → Edit before anyone uses these.');
  });

  await mongoose.disconnect();
}

/* Only when RUN, never when IMPORTED. `ORG_ROLES` above is the reusable half
   of this file, and a bare `run()` at module scope meant importing it connected
   to the database, seeded, and then disconnected — closing the connection out
   from under whatever imported it. */
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  run().catch(async (err) => {
    console.error(err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}
