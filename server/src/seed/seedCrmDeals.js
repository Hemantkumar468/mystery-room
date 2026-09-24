/**
 * Turn qualified leads into deals, so the board has something on it.
 *
 * Not a fixture generator: every deal here comes from a REAL lead in the
 * database, carrying that lead's name, city and budget. A board seeded with
 * invented companies teaches nothing about whether the board works on your
 * data — and it has to be deleted before go-live, which nobody remembers.
 *
 * HISTORY IS NOT FABRICATED. Each deal is created through the real service, so
 * its `stageHistory` starts now and every card reads "0d in stage". Back-dating
 * would put numbers into the velocity report that nobody earned, and there is
 * no way to tell a manufactured duration from a real one afterwards.
 *
 * Safe to run more than once: a lead that already has a deal is skipped.
 *
 *   node src/seed/seedCrmDeals.js               # report only (default)
 *   node src/seed/seedCrmDeals.js --apply       # write
 *   node src/seed/seedCrmDeals.js --apply --n=12
 *   node src/seed/seedCrmDeals.js --destroy --apply   # remove every seeded deal
 */
import dns from 'node:dns';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

dns.setServers(['8.8.8.8', '8.8.4.4']);

const APPLY = process.argv.includes('--apply');
const DESTROY = process.argv.includes('--destroy');
const HOW_MANY = Number((process.argv.find((a) => a.startsWith('--n=')) || '').split('=')[1]) || 10;

/* eslint-disable no-console */
async function run() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 30_000 });

  const { Lead } = await import('../modules/crm/leads/lead.model.js');
  const { Deal } = await import('../modules/crm/deals/deal.model.js');
  const { dealService } = await import('../modules/crm/deals/deal.service.js');
  const { pipelineService } = await import('../modules/crm/pipelines/pipeline.service.js');
  const { User } = await import('../modules/auth/auth.model.js');
  const { LEAD_STATUS } = await import('../modules/crm/crm.constants.js');

  const md = await User.findOne({ role: 'md' }).select('_id name role').lean();
  if (!md) throw new Error('No MD account found — seed users first.');
  const actor = { _id: md._id, id: String(md._id), role: 'md', name: md.name };

  /* ── Undo ─────────────────────────────────────────────────
     Only rows this seeder wrote, identified by the flag rather than by a name
     pattern or a date range — those two both fail the moment somebody edits a
     seeded deal, which is exactly what happens when it is being used as a demo. */
  if (DESTROY) {
    const seeded = await Deal.find({ isSeed: true }).select('_id lead title').lean();
    console.log(`${seeded.length} seeded deals.${APPLY ? '' : '  (dry run — nothing will be removed)'}`);
    for (const d of seeded.slice(0, 10)) console.log(`  ${d.title}`);
    if (seeded.length > 10) console.log(`  …and ${seeded.length - 10} more`);

    if (APPLY && seeded.length) {
      await Deal.deleteMany({ _id: { $in: seeded.map((d) => d._id) } });
      // Put their leads back where they were. A lead left "converted" with no
      // deal behind it is invisible in every list and counted in no pipeline —
      // worse than the seeded deal it came from.
      await Lead.updateMany(
        { _id: { $in: seeded.map((d) => d.lead).filter(Boolean) } },
        { $set: { status: LEAD_STATUS.QUALIFIED }, $unset: { convertedAt: '' } },
      );
      console.log(`\nRemoved ${seeded.length} seeded deals and reopened their leads.`);
    } else if (seeded.length) {
      console.log('\nRe-run with --destroy --apply to remove them.');
    }
    await mongoose.disconnect();
    return;
  }

  const pipeline = await pipelineService.ensureDefault(actor);
  console.log(`Pipeline: ${pipeline.name} (${pipeline.stages.length} stages)`);

  const alreadyLinked = new Set(
    (await Deal.find({ lead: { $ne: null } }).select('lead').lean()).map((d) => String(d.lead)),
  );

  // Leads that have gone somewhere. A brand-new enquiry is not a deal yet, and
  // putting every one on the board is how a pipeline stops meaning anything.
  const candidates = (await Lead.find({
    status: { $in: [LEAD_STATUS.CONTACTED, LEAD_STATUS.QUALIFIED] },
  }).sort({ createdAt: -1 }).limit(HOW_MANY * 3).lean())
    .filter((l) => !alreadyLinked.has(String(l._id)))
    .slice(0, HOW_MANY);

  console.log(`\n${candidates.length} leads to promote.${APPLY ? '' : '  (dry run — nothing will be written)'}`);
  if (!candidates.length) { await mongoose.disconnect(); return; }

  // Spread them across the OPEN stages, so the board shows a pipeline rather
  // than one full column. Terminal stages are left alone — a won or lost deal
  // is a claim about something that happened, not demo scenery.
  const openStages = pipeline.orderedStages().filter((s) => !s.isWon && !s.isLost);

  let made = 0;
  for (const [i, lead] of candidates.entries()) {
    const stage = openStages[i % openStages.length];
    const title = `${lead.name}${lead.city ? ` — ${lead.city}` : ''}`;
    console.log(`  ${title.padEnd(38)} → ${stage.name}`);

    if (APPLY) {
      // eslint-disable-next-line no-await-in-loop
      const deal = await dealService.create({
        title,
        pipeline: pipeline._id,
        stage: stage._id,
        value: lead.estimatedValue || 500_000 + (i % 6) * 250_000,
        lead: lead._id,
        assignedTo: lead.assignedTo,
        expectedCloseDate: new Date(Date.now() + (14 + i * 5) * 86_400_000),
        // Flagged at birth. Added later it would be a guess about which rows
        // were demo data, and by then nobody remembers.
      }, actor, { isSeed: true });
      // The lead has become an opportunity — leaving it "qualified" means it
      // stays in every "needs working" count forever.
      // eslint-disable-next-line no-await-in-loop
      await Lead.updateOne({ _id: lead._id }, {
        $set: { status: LEAD_STATUS.CONVERTED, convertedAt: new Date() },
      });
      made += deal ? 1 : 0;
    }
  }

  console.log(`\n${APPLY ? `Created ${made} deals.` : 'Re-run with --apply to write.'}`);
  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
