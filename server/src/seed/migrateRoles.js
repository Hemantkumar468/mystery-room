/**
 * One-off migration: the old four-role vocabulary → the ERP's five roles.
 *
 *   admin    → md         (Managing Director)
 *   manager  → manager    (unchanged)
 *   executor → employee   (the doer, renamed)
 *   viewer   → viewer     (unchanged)
 *
 * `ea` (Executive Assistant) is new and is never assigned automatically —
 * promoting someone to the MD's proxy is a decision, not a data migration.
 * Assign it explicitly afterwards.
 *
 * Safe to run more than once: users already on a new value are left alone.
 *
 *   node src/seed/migrateRoles.js            # apply
 *   node src/seed/migrateRoles.js --dry-run  # report only, change nothing
 */
import dns from 'node:dns';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

// Some networks refuse SRV lookups, which `mongodb+srv://` requires — the same
// workaround config/database.js applies.
dns.setServers(['8.8.8.8', '8.8.4.4']);

const MAP = {
  admin: 'md',
  executor: 'employee',
};

const DRY_RUN = process.argv.includes('--dry-run');

async function run() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 30_000 });
  const users = mongoose.connection.collection('users');

  const before = await users.aggregate([
    { $group: { _id: '$role', count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]).toArray();

  console.log(`\n${DRY_RUN ? 'DRY RUN — nothing will change' : 'Migrating roles'}\n`);
  console.log('  before:');
  before.forEach((r) => console.log(`    ${String(r._id).padEnd(10)} ${r.count}`));

  let changed = 0;
  for (const [from, to] of Object.entries(MAP)) {
    const n = await users.countDocuments({ role: from });
    if (!n) continue;
    console.log(`\n  ${from} → ${to}: ${n} user${n === 1 ? '' : 's'}`);
    if (!DRY_RUN) {
      const res = await users.updateMany({ role: from }, { $set: { role: to } });
      changed += res.modifiedCount;
    }
  }

  // Anything not in the new vocabulary would fail schema validation on the next
  // save and, worse, match no capability set — so it is reported loudly rather
  // than silently left behind.
  const VALID = ['md', 'ea', 'manager', 'employee', 'viewer'];
  // On a dry run nothing has moved yet, so anything this migration KNOWS how to
  // map is not a straggler — listing it would report every user as broken.
  const ignore = DRY_RUN ? [...VALID, ...Object.keys(MAP)] : VALID;
  const stragglers = await users.find({ role: { $nin: ignore } }).project({ email: 1, role: 1 }).toArray();
  if (stragglers.length) {
    console.log('\n  ⚠ users left on an unrecognised role — fix these by hand:');
    stragglers.forEach((u) => console.log(`    ${u.email} → ${u.role}`));
  }

  const after = await users.aggregate([
    { $group: { _id: '$role', count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]).toArray();
  console.log('\n  after:');
  after.forEach((r) => console.log(`    ${String(r._id).padEnd(10)} ${r.count}`));

  console.log(`\n${DRY_RUN ? 'Dry run complete — no writes.' : `Done. ${changed} user(s) updated.`}\n`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('\nMigration failed:', err.message, '\n');
  process.exit(1);
});
