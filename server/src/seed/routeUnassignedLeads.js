/**
 * One-off migration: run the routing engine over leads that predate it.
 *
 * Routing runs at CREATION. Every lead captured before the engine existed —
 * an import, a seed, anything migrated in — therefore has no owner, and no
 * amount of using the app fixes that: nothing re-routes an existing lead.
 *
 * The result is the worst kind of dashboard number: a red count at the top of
 * the page with no button anywhere that clears it. This script is that button
 * until the bulk-assign UI exists.
 *
 * WHICH LEADS. Open ones with no owner. A converted or disqualified lead is
 * finished — assigning it now would put closed work on somebody's desk and
 * inflate their open-lead count for nothing.
 *
 * WHAT IT DOES NOT DO. It does not touch `firstActivityAt`. Assigning a lead
 * is not contacting it, and back-dating first contact would make the response
 * time metric report a number nobody earned — permanently, since there is no
 * way to tell a real stamp from a manufactured one afterwards.
 *
 * Safe to run more than once: an assigned lead is skipped.
 *
 *   node src/seed/routeUnassignedLeads.js            # report only (default)
 *   node src/seed/routeUnassignedLeads.js --apply    # write
 */
import dns from 'node:dns';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

// Some networks refuse SRV lookups, which `mongodb+srv://` requires — the same
// workaround config/database.js applies.
dns.setServers(['8.8.8.8', '8.8.4.4']);

const APPLY = process.argv.includes('--apply');

/* eslint-disable no-console */
async function run() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 30_000 });

  const { Lead } = await import('../modules/crm/leads/lead.model.js');
  const { CrmActivity } = await import('../modules/crm/activities/crmActivity.model.js');
  const { RoutingRule } = await import('../modules/crm/routing/routingRule.model.js');
  const { routingService } = await import('../modules/crm/routing/routing.service.js');
  const {
    LEAD_CLOSED_STATUSES, ACTIVITY_TYPE, ENTITY_TYPE,
  } = await import('../modules/crm/crm.constants.js');

  const rules = await RoutingRule.countDocuments({ isActive: true });
  console.log(
    rules
      ? `${rules} active routing rule(s) will decide.`
      : 'No routing rules exist — everything falls to the whole-company rotation.\n'
        + '(That is the engine\'s deliberate fallback, not a failure. Add rules later\n'
        + ' and future leads will follow them.)',
  );

  const unassigned = await Lead.find({
    assignedTo: null,
    status: { $nin: LEAD_CLOSED_STATUSES },
  }).lean();

  console.log(`\n${unassigned.length} open leads have no owner.${APPLY ? '' : '  (dry run — nothing will be written)'}\n`);
  if (!unassigned.length) { await mongoose.disconnect(); return; }

  const tally = new Map();
  let routed = 0;
  let stillUnassigned = 0;

  for (const lead of unassigned) {
    // eslint-disable-next-line no-await-in-loop
    const { assignedTo, routedBy } = await routingService.route(lead);

    if (!assignedTo) { stillUnassigned += 1; continue; }
    routed += 1;
    tally.set(String(assignedTo), (tally.get(String(assignedTo)) || 0) + 1);

    if (APPLY) {
      // eslint-disable-next-line no-await-in-loop
      await Promise.all([
        Lead.updateOne({ _id: lead._id }, {
          $set: {
            assignedTo,
            assignedAt: new Date(),
            routedBy: `${routedBy} (backfill)`,
          },
        }),
        // On the timeline, so "why did I get this lead" has an answer here too
        // — and marked as a system action, not as somebody working the lead.
        CrmActivity.create({
          type: ACTIVITY_TYPE.SYSTEM,
          entityType: ENTITY_TYPE.LEAD,
          entityId: lead._id,
          subject: 'Assigned by backfill',
          body: `Routed by: ${routedBy}. This lead predates the routing engine.`,
          occurredAt: new Date(),
        }),
      ]);
    }
  }

  const { User } = await import('../modules/auth/auth.model.js');
  const names = new Map(
    (await User.find({ _id: { $in: [...tally.keys()] } }).select('name').lean())
      .map((u) => [String(u._id), u.name]),
  );

  console.log(`${APPLY ? 'Assigned' : 'Would assign'} ${routed} leads:`);
  for (const [id, n] of [...tally.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(names.get(id) || id).padEnd(24)} ${n}`);
  }
  if (stillUnassigned) {
    console.log(`\n${stillUnassigned} could not be routed — no eligible agent was available.`);
  }
  if (!APPLY) console.log('\nRe-run with --apply to write.');

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
