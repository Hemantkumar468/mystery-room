/* eslint-disable no-console */
/**
 * Open the BOQ for every project whose plan was filed before the plan did
 * that itself.
 *
 * From now on, filing a Phase 4 project plan opens the project's BOQ — one
 * line per selected game per BOQ, plus the common area once (see
 * record.service.js#generateBoqFromPlan). Plans filed before that change
 * opened nothing, so their projects reached Purchase with an empty BOQ and
 * nothing for the flow to run on. This runs the same generator over them.
 *
 * ONLY projects with a filed plan, selected games, and NO BOQ lines yet — a
 * project where somebody has already started a BOQ by hand is left alone.
 *
 *   node src/seed/openBoqFromPlans.js           report
 *   node src/seed/openBoqFromPlans.js --apply   write
 */
import dns from 'node:dns';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();
dns.setServers(['8.8.8.8', '8.8.4.4']);
const APPLY = process.argv.includes('--apply');

async function run() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 30_000 });
  const db = mongoose.connection.db;

  const plans = await db.collection('records')
    .find({ stageKey: 'p20', status: { $in: ['submitted', 'approved', 'locked'] } })
    .project({ project: 1, values: 1, submittedBy: 1, createdBy: 1, tenant: 1 })
    .toArray();

  const due = [];
  for (const pl of plans) {
    const games = (pl.values?.selected_games || []).filter(Boolean);
    if (!games.length) continue;
    // eslint-disable-next-line no-await-in-loop
    const has = await db.collection('records').countDocuments({ project: pl.project, stageKey: 'p13' });
    if (has) continue;
    // eslint-disable-next-line no-await-in-loop
    const proj = await db.collection('projects').findOne({ _id: pl.project }, { projection: { code: 1, name: 1 } });
    if (!proj) continue;
    due.push({ pl, proj, games });
  }

  console.log(`\n${due.length} project(s) with a filed plan and no BOQ yet:\n`);
  for (const { proj, games } of due) {
    console.log(`  ${String(proj.code).padEnd(14)} ${String(proj.name).slice(0, 34).padEnd(36)} ${games.length} game(s) -> ${games.length * 5 + 1} line(s)`);
  }

  if (!APPLY) {
    console.log('\nREPORT ONLY — nothing was written. Re-run with --apply.\n');
    await mongoose.disconnect();
    return;
  }

  /* The generator runs inside the app's own tenancy context — records are
     tenant-stamped on create — so each plan is replayed in its tenant. */
  const { withTenant } = await import('../core/tenancy/tenantContext.js');
  const { generateBoqFromPlan } = await import('../modules/pms/records/record.service.js');
  for (const { pl, proj } of due) {
    const actor = pl.submittedBy || pl.createdBy || null;
    // eslint-disable-next-line no-await-in-loop
    await withTenant(pl.tenant, () => generateBoqFromPlan({ ...pl, stageKey: 'p20' }, actor));
    // eslint-disable-next-line no-await-in-loop
    const n = await db.collection('records').countDocuments({ project: pl.project, stageKey: 'p13' });
    console.log(`  ${proj.code.padEnd(14)} ${n} BOQ line(s) opened`);
  }
  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
