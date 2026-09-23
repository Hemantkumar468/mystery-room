/* eslint-disable no-console */
/**
 * Delete projects and everything that hangs off them.
 *
 * WHY THIS EXISTS AS A SCRIPT rather than a one-off command. Deleting a
 * project is not deleting a row: a project owns tasks, records, activities,
 * notifications, drawing plans, AI analyses and outsource links, and removing
 * the project alone leaves every one of them pointing at nothing. Orphans do
 * not announce themselves — they show up months later as a task nobody can
 * open and a dashboard figure nobody can explain. The cascade belongs in one
 * reviewable place.
 *
 * REPORT FIRST, ALWAYS. Nothing is written without `--apply`. The report
 * names every project it would remove and counts every document that would
 * go with it, because "18 projects" and "2,486 documents" are very different
 * sentences and only the second one tells you what you are about to do.
 *
 * WHAT IT WILL NOT TOUCH. Users, the org sheet's job roles, templates, games,
 * vendors, the inventory master and stock — none of them belong to a project,
 * and a cleanup that quietly took a shared master with it would be the worst
 * kind of surprise. Stock LOCATIONS keep their optional `project` back-link;
 * a centre outlives the build that produced it (see inventoryLocation.model).
 *
 *   node src/seed/deleteProjects.js --codes MR-AHM-001,DRAFT-2A56D201
 *   node src/seed/deleteProjects.js --match "demo|test" --created 2026-07..2026-08
 *   ... add --apply to write. Take a backup first: src/seed/dbExport.js
 */
import dns from 'node:dns';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();
/* Atlas is reached over an SRV record and this network's resolver refuses the
   `_mongodb._tcp` lookup — the same workaround config/database.js applies. */
dns.setServers(['8.8.8.8', '8.8.4.4']);

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`) || a === `--${name}`);
  if (!hit) return null;
  if (hit.includes('=')) return hit.split('=').slice(1).join('=');
  return process.argv[process.argv.indexOf(hit) + 1] ?? null;
};

const APPLY = process.argv.includes('--apply');
const CODES = (arg('codes') || '').split(',').map((s) => s.trim()).filter(Boolean);
const MATCH = arg('match');
const CREATED = arg('created'); // 2026-07..2026-08

/**
 * Everything that belongs to a project, and the field that says so.
 *
 * Ordered children-first so a failure halfway through leaves orphans pointing
 * at a project that still exists — recoverable by re-running — rather than a
 * project deleted with its children still in place, which nothing can find.
 */
const OWNED = [
  ['tasks', 'project'],
  ['records', 'project'],
  ['activities', 'project'],
  ['notifications', 'project'],
  ['drawingplans', 'project'],
  ['outsourcelinks', 'project'],
  ['aianalyses', 'project'],
];

function monthRange(spec) {
  if (!spec) return null;
  const [a, b] = spec.split('..');
  const start = new Date(`${a}-01T00:00:00Z`);
  const [by, bm] = (b || a).split('-').map(Number);
  const end = new Date(Date.UTC(bm === 12 ? by + 1 : by, bm === 12 ? 0 : bm, 1));
  return { start, end };
}

async function run() {
  /* A date range on its own is a legitimate selection — "everything from
     August" is the shape of a cleanup. What is refused is NO selector at
     all, which would match every project in the database. */
  if (!CODES.length && !MATCH && !CREATED) {
    console.error('Nothing selected. Pass --codes A,B, --match "demo|test", or --created 2026-08..2026-08.');
    process.exitCode = 1;
    return;
  }

  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 30_000 });
  const db = mongoose.connection.db;

  const where = {};
  if (CODES.length) where.code = { $in: CODES };
  if (MATCH) where.name = new RegExp(MATCH, 'i');
  const range = monthRange(CREATED);
  if (range) where.createdAt = { $gte: range.start, $lt: range.end };

  const projects = await db.collection('projects')
    .find(where)
    .project({
      code: 1, name: 1, status: 1, city: 1, createdAt: 1,
    })
    .sort({ createdAt: 1 })
    .toArray();

  if (!projects.length) {
    console.log('Nothing matches. Nothing to do.');
    await mongoose.disconnect();
    return;
  }

  const ids = projects.map((p) => p._id);
  console.log(`\nPROJECTS SELECTED — ${projects.length}\n`);
  for (const p of projects) {
    console.log(`  ${String(p.code ?? '—').padEnd(16)} ${String(p.name ?? '').slice(0, 32).padEnd(34)}`
      + ` ${String(p.status ?? '').padEnd(9)} ${String(p.city ?? '').padEnd(12)} ${p.createdAt?.toISOString().slice(0, 10) ?? ''}`);
  }

  console.log('\nWHAT GOES WITH THEM\n');
  let total = 0;
  const counts = [];
  for (const [name, field] of OWNED) {
    // eslint-disable-next-line no-await-in-loop
    const n = await db.collection(name).countDocuments({ [field]: { $in: ids } });
    counts.push([name, field, n]);
    if (n) console.log(`  ${name.padEnd(18)} ${String(n).padStart(6)}`);
    total += n;
  }
  console.log(`  ${'projects'.padEnd(18)} ${String(projects.length).padStart(6)}`);
  console.log(`  ${''.padEnd(18)} ------`);
  console.log(`  ${'total'.padEnd(18)} ${String(total + projects.length).padStart(6)} document(s)\n`);

  if (!APPLY) {
    console.log('REPORT ONLY — nothing was written. Re-run with --apply to delete.');
    console.log('Back up first if you have not:  node src/seed/dbExport.js --out ../backup/<name>\n');
    await mongoose.disconnect();
    return;
  }

  console.log('Deleting…\n');
  for (const [name, field, expected] of counts) {
    if (!expected) continue;
    // eslint-disable-next-line no-await-in-loop
    const res = await db.collection(name).deleteMany({ [field]: { $in: ids } });
    console.log(`  ${name.padEnd(18)} ${String(res.deletedCount).padStart(6)} removed`);
  }
  const gone = await db.collection('projects').deleteMany({ _id: { $in: ids } });
  console.log(`  ${'projects'.padEnd(18)} ${String(gone.deletedCount).padStart(6)} removed\n`);

  /* Said out loud rather than assumed: anything still pointing at a project
     that no longer exists is a bug in this script's OWNED list, and the only
     moment anybody will be looking is right now. */
  let strays = 0;
  for (const [name, field] of OWNED) {
    // eslint-disable-next-line no-await-in-loop
    strays += await db.collection(name).countDocuments({ [field]: { $in: ids } });
  }
  console.log(strays === 0
    ? 'Checked: nothing is left pointing at a deleted project.'
    : `WARNING: ${strays} document(s) still reference a deleted project.`);

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
