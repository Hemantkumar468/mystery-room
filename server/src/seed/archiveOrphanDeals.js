/**
 * Move deals that predate the pipeline model out of the way — without
 * deleting them.
 *
 * An earlier version of this module stored a deal's stage as a NAME
 * ("qualified") where the current one stores the id of a stage subdocument
 * inside a Pipeline. Those documents cannot be placed in a column, given a
 * probability, or shown a history, so the list already excludes them — but
 * they still sit in `deals`, counting toward any raw `countDocuments`, and
 * waiting to confuse whoever next opens the collection.
 *
 * MOVED, NOT DROPPED. The only thing deleting them buys is one fewer
 * collection; what it costs is the ability to look at them again. They go to
 * `deals_legacy`, and `--restore` brings them back.
 *
 * A deal is "orphaned" when it has no `pipeline` field. That is the precise
 * test, not a date or a guess: with a pipeline it works, without one it cannot.
 *
 *   node src/seed/archiveOrphanDeals.js              # report only (default)
 *   node src/seed/archiveOrphanDeals.js --apply      # move to deals_legacy
 *   node src/seed/archiveOrphanDeals.js --restore    # move them back
 */
import dns from 'node:dns';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

dns.setServers(['8.8.8.8', '8.8.4.4']);

const APPLY = process.argv.includes('--apply');
const RESTORE = process.argv.includes('--restore');

const SOURCE = 'deals';
const ARCHIVE = 'deals_legacy';

/* eslint-disable no-console */
async function run() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 30_000 });
  const { db } = mongoose.connection;

  if (RESTORE) {
    const rows = await db.collection(ARCHIVE).find({}).toArray();
    console.log(`${rows.length} archived deals.`);
    if (!rows.length) { await mongoose.disconnect(); return; }
    if (!APPLY) {
      console.log('Re-run with --restore --apply to move them back into `deals`.');
      await mongoose.disconnect();
      return;
    }
    // `_id` is preserved, so a restore puts every document back exactly where
    // it was — including any reference something else still holds to it.
    await db.collection(SOURCE).insertMany(rows, { ordered: false });
    await db.collection(ARCHIVE).deleteMany({ _id: { $in: rows.map((r) => r._id) } });
    console.log(`Restored ${rows.length} deals to \`${SOURCE}\`.`);
    await mongoose.disconnect();
    return;
  }

  const orphans = await db.collection(SOURCE)
    .find({ $or: [{ pipeline: { $exists: false } }, { pipeline: null }] })
    .toArray();

  const kept = await db.collection(SOURCE).countDocuments({ pipeline: { $exists: true, $ne: null } });

  console.log(`${orphans.length} orphaned deals (no pipeline), ${kept} current ones.`);
  if (!orphans.length) { await mongoose.disconnect(); return; }

  const stages = new Map();
  for (const d of orphans) stages.set(d.stage, (stages.get(d.stage) || 0) + 1);
  console.log('\nTheir stored stage values, which are names rather than ids:');
  for (const [stage, n] of stages) console.log(`  ${String(stage).padEnd(16)} ${n}`);

  if (!APPLY) {
    console.log(`\nRe-run with --apply to move them to \`${ARCHIVE}\`. Nothing is deleted.`);
    await mongoose.disconnect();
    return;
  }

  // Stamped on the way out, so the archive says why it exists to anyone who
  // finds it later without this script in front of them.
  const archivedAt = new Date();
  await db.collection(ARCHIVE).insertMany(
    orphans.map((d) => ({ ...d, _legacy: true, _archivedAt: archivedAt, _archivedReason: 'no pipeline — predates the Pipeline model' })),
    { ordered: false },
  );
  const { deletedCount } = await db.collection(SOURCE)
    .deleteMany({ _id: { $in: orphans.map((d) => d._id) } });

  console.log(`\nMoved ${deletedCount} deals to \`${ARCHIVE}\`.`);
  console.log(`\`${SOURCE}\` now holds ${await db.collection(SOURCE).countDocuments()}.`);
  console.log('\nTo undo: node src/seed/archiveOrphanDeals.js --restore --apply');

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
