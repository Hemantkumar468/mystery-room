/**
 * One-off migration: plainer stage names, plus a Hindi sub-label.
 *
 * WHY THIS IS A MIGRATION AND NOT AN EDIT. Stages live in the Pipeline
 * collection as data, not in an enum, so renaming one is a database change.
 * That was the point of putting them there.
 *
 * THE STAGE `_id` MUST NOT CHANGE, and this script never touches it. Every
 * deal carries `stage`, and every entry in every deal's `stageHistory`
 * carries the id of the stage it entered. Replacing a stage — rather than
 * renaming it in place — would orphan both: the board would show empty
 * columns, and the whole history of how long deals spent where would point at
 * stages that no longer exist. That history is not reconstructible.
 *
 * MATCHED BY NAME, AND ONLY THE EXACT OLD NAME. A pipeline somebody has
 * already renamed by hand is left alone rather than being forced back into a
 * shape this script assumes.
 *
 * SAFE TO RUN MORE THAN ONCE: a stage already carrying the new name and label
 * is reported as done and skipped.
 *
 *   npm run migrate:crm-rename-stages            # report only (default)
 *   npm run migrate:crm-rename-stages -- --apply # write
 */
import dns from 'node:dns';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();
dns.setServers(['8.8.8.8', '8.8.4.4']);

const APPLY = process.argv.includes('--apply');

/**
 * old name → { name, labelHi }
 *
 * "Contacted" keeps its English name and only gains a Hindi label, which is
 * why the map is keyed by the old name rather than being a list of renames.
 */
const RENAMES = new Map([
  ['New Lead', { name: 'New', labelHi: 'Naya' }],
  ['Contacted', { name: 'Contacted', labelHi: 'Baat Hui' }],
  ['Requirement Understood', { name: 'Interested', labelHi: 'Interested' }],
  ['Demo Done', { name: 'Visit Done', labelHi: 'Visit Ho Gaya' }],
  ['Negotiation', { name: 'Price Talk', labelHi: 'Price Baat' }],
  ['Closed Won', { name: 'Booked', labelHi: 'Book Ho Gaya' }],
  ['Closed Lost', { name: 'Not Booked', labelHi: 'Nahi Hua' }],
]);

/* eslint-disable no-console */
async function run() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 30_000 });

  const { withoutTenant } = await import('../core/tenancy/tenantContext.js');
  const { Pipeline } = await import('../modules/crm/pipelines/pipeline.model.js');
  const { Deal } = await import('../modules/crm/deals/deal.model.js');

  await withoutTenant('renaming stages applies to every company', async () => {
    const pipelines = await Pipeline.find();
    if (!pipelines.length) {
      console.log('No pipelines exist yet — nothing to rename.');
      return;
    }

    let changed = 0;
    let already = 0;
    let untouched = 0;

    for (const pipeline of pipelines) {
      console.log(`\nPipeline "${pipeline.name}"`);

      for (const stage of pipeline.stages) {
        const target = RENAMES.get(stage.name);

        if (!target) {
          // Either already renamed by this script, or renamed by a human.
          // Either way, not ours to overwrite.
          const isNewName = [...RENAMES.values()].some((v) => v.name === stage.name);
          if (isNewName && stage.labelHi) {
            already += 1;
            console.log(`   = ${stage.name.padEnd(24)} already done`);
          } else {
            untouched += 1;
            console.log(`   . ${stage.name.padEnd(24)} not a stage this script knows — left alone`);
          }
          continue;
        }

        /* Already there. Worth its own branch rather than letting the write
           happen again harmlessly: "Contacted" keeps its English name, so it
           matches this map forever, and a second run would otherwise report
           "would rename 1 stage" when nothing at all would change. A migration
           whose dry run overstates what it will do is one people stop reading. */
        if (stage.name === target.name && stage.labelHi === target.labelHi) {
          already += 1;
          console.log(`   = ${stage.name.padEnd(24)} already done`);
          continue;
        }

        // The count is printed to make the point that the id is being kept:
        // these deals keep pointing at the same stage after the rename.
        // eslint-disable-next-line no-await-in-loop
        const deals = await Deal.countDocuments({ stage: stage._id });
        console.log(
          `   → ${stage.name.padEnd(24)} becomes "${target.name}" (${target.labelHi})`
          + `  [id ${String(stage._id).slice(-6)} kept, ${deals} deal(s)]`,
        );

        if (APPLY) {
          stage.name = target.name;
          stage.labelHi = target.labelHi;
        }
        changed += 1;
      }

      if (APPLY) {
        // eslint-disable-next-line no-await-in-loop
        await pipeline.save();
      }
    }

    console.log(`\n${APPLY ? 'Renamed' : 'Would rename'} ${changed} stage(s).`);
    if (already) console.log(`${already} already carried the new name and label.`);
    if (untouched) console.log(`${untouched} left alone (unrecognised name).`);
    if (!APPLY) console.log('\nRe-run with --apply to write.');

    /* Proof, not assertion: every deal and every history entry still resolves
       to a stage that exists. If an id had moved, this is where it would show
       — and it would show as a number, not as a vague worry. */
    if (APPLY) {
      const stageIds = new Set(
        (await Pipeline.find().lean()).flatMap((p) => p.stages.map((s) => String(s._id))),
      );
      const deals = await Deal.find().select('stage stageHistory').lean();
      const orphanDeals = deals.filter((d) => d.stage && !stageIds.has(String(d.stage))).length;
      const orphanHistory = deals.reduce(
        (n, d) => n + (d.stageHistory || []).filter((h) => h.stage && !stageIds.has(String(h.stage))).length,
        0,
      );
      console.log(`\nDeals still pointing at a live stage: ${deals.length - orphanDeals}/${deals.length}`);
      console.log(`History entries still resolving:      ${orphanHistory === 0 ? 'all' : `${orphanHistory} BROKEN`}`);
      if (orphanDeals || orphanHistory) {
        console.log('\nSomething replaced a stage instead of renaming it. Investigate before deploying.');
        process.exitCode = 1;
      }
    }
  });

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
