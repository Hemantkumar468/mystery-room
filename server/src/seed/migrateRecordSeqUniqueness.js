/* eslint-disable no-console */
/**
 * MIGRATION — repair duplicate Record `seq` values, then enforce uniqueness.
 *
 * `seq` is the stable per-stage display number users cite ("Property No. 3").
 * It was assigned read-then-write — find the highest, add one — so two
 * submissions filed at the same moment both claimed the same number. There
 * was no unique index to stop it, and the live data already contains
 * duplicates plus some records with no seq at all.
 *
 * record.service.js#create now retries on a duplicate-key rejection, but that
 * only actually protects anything once the unique index exists. This script
 * is the prerequisite: it renumbers the duplicates, backfills the missing
 * ones, and then creates
 *
 *     { project: 1, stageKey: 1, seq: 1 }  unique
 *
 * Renumbering keeps the OLDEST record's number (that's the one people have
 * already quoted) and pushes later collisions to the end of the range, so no
 * existing reference changes meaning.
 *
 * DRY RUN BY DEFAULT.
 *
 *   node src/seed/migrateRecordSeqUniqueness.js            # dry run
 *   node src/seed/migrateRecordSeqUniqueness.js --apply    # repair + index
 */
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { Record } from '../modules/pms/records/record.model.js';

const APPLY = process.argv.includes('--apply');
const INDEX = { project: 1, stageKey: 1, seq: 1 };

async function run() {
  const all = await Record.find({}).select('project stageKey seq createdAt').sort({ createdAt: 1 }).lean();
  console.log(`${all.length} record(s) scanned.\n`);

  // Group by (project, stageKey) so numbering is per stage, as it is at creation.
  const groups = new Map();
  for (const r of all) {
    const key = `${r.project}|${r.stageKey}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const fixes = []; // { _id, from, to }
  let dupGroups = 0;
  let missing = 0;

  for (const [, rows] of groups) {
    const taken = new Set();
    let highest = rows.reduce((m, r) => Math.max(m, Number(r.seq) || 0), 0);
    let groupHadDup = false;

    for (const r of rows) { // oldest first — first claim wins
      const seq = Number(r.seq);
      if (!seq) {
        missing += 1;
        highest += 1;
        fixes.push({ _id: r._id, from: r.seq ?? null, to: highest });
        taken.add(highest);
        continue;
      }
      if (taken.has(seq)) {
        groupHadDup = true;
        highest += 1;
        fixes.push({ _id: r._id, from: seq, to: highest });
        taken.add(highest);
      } else {
        taken.add(seq);
      }
    }
    if (groupHadDup) dupGroups += 1;
  }

  console.log(`Duplicate groups : ${dupGroups}`);
  console.log(`Missing seq      : ${missing}`);
  console.log(`Records to renumber: ${fixes.length}`);
  for (const f of fixes.slice(0, 20)) console.log(`   ${f._id}: ${f.from} -> ${f.to}`);
  if (fixes.length > 20) console.log(`   … and ${fixes.length - 20} more`);

  const existing = await Record.collection.indexes();
  const hasIndex = existing.some((i) => JSON.stringify(i.key) === JSON.stringify(INDEX) && i.unique);
  console.log(`\nUnique index present: ${hasIndex ? 'yes' : 'no'}`);

  if (!APPLY) {
    console.log(`\nWould renumber ${fixes.length} record(s)${hasIndex ? '' : ' and create the unique index'}.`);
    console.log('DRY RUN — nothing was written. Re-run with --apply to commit.');
    return;
  }

  for (const f of fixes) {
    await Record.collection.updateOne({ _id: f._id }, { $set: { seq: f.to } });
  }
  console.log(`\nRenumbered ${fixes.length} record(s).`);

  if (!hasIndex) {
    try {
      await Record.collection.createIndex(INDEX, { unique: true, name: 'project_stageKey_seq_unique' });
      console.log('Created unique index { project, stageKey, seq }.');
    } catch (err) {
      console.error(`Index creation FAILED: ${err.message}`);
      console.error('The renumbering above is still applied — re-run to retry the index.');
      process.exitCode = 1;
      return;
    }
  }

  // Verify rather than assume.
  const after = await Record.aggregate([
    { $group: { _id: { p: '$project', s: '$stageKey', q: '$seq' }, n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
    { $count: 'groups' },
  ]);
  console.log(after[0]?.groups ? `WARNING: ${after[0].groups} duplicate group(s) remain.` : 'Verified: no duplicate seq values remain.');
  console.log('\nNOTE: with the index in place, add `unique: true` to the seq index in');
  console.log('record.model.js so a fresh environment gets the same constraint.');
}

connectDatabase()
  .then(run)
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(disconnectDatabase);
