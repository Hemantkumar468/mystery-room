/**
 * One-off migration: give every existing record a company.
 *
 * There is one company today, so this creates it and stamps every document in
 * every tenant-scoped collection with its id. It is the easy half of adding
 * multi-tenancy, and the reason for doing it now rather than later: the hard
 * half is auditing every query written between now and then, and that work
 * grows with the codebase.
 *
 * SAFE TO RUN MORE THAN ONCE. Only documents with no tenant are touched, so a
 * second run reports zero and changes nothing. It also means a run that dies
 * halfway can simply be run again.
 *
 * RUNS UNSCOPED, deliberately — it is the thing that creates the scope.
 *
 *   npm run migrate:tenancy            # report only
 *   npm run migrate:tenancy -- --apply # write
 */
import dns from 'node:dns';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();
dns.setServers(['8.8.8.8', '8.8.4.4']);

const APPLY = process.argv.includes('--apply');
const NAME = process.env.DEFAULT_TENANT_NAME || 'Mystery Rooms';
const SLUG = process.env.DEFAULT_TENANT_SLUG || 'mystery-rooms';

/* eslint-disable no-console */
async function run() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 30_000 });

  const { withoutTenant } = await import('../core/tenancy/tenantContext.js');
  const { Tenant } = await import('../core/tenancy/tenant.model.js');

  await withoutTenant('the tenancy backfill is what creates the scope', async () => {
    // Importing every model file registers it with Mongoose, which is how the
    // list below is discovered rather than hand-maintained — a hand-written
    // list is a list that misses the model somebody adds next month.
    await Promise.all([
      import('../modules/auth/auth.model.js'),
      import('../modules/ai/ai.model.js'),
      import('../modules/crm/leads/lead.model.js'),
      import('../modules/crm/contacts/contact.model.js'),
      import('../modules/crm/companies/company.model.js'),
      import('../modules/crm/deals/deal.model.js'),
      import('../modules/crm/pipelines/pipeline.model.js'),
      import('../modules/crm/tasks/task.model.js'),
      import('../modules/crm/activities/crmActivity.model.js'),
      import('../modules/crm/routing/routingRule.model.js'),
      import('../modules/crm/tickets/ticket.model.js'),
      import('../modules/crm/integrations/email/emailDropbox.model.js'),
      import('../modules/crm/integrations/telephony/ringRegistry.js'),
      import('../modules/pms/projects/project.model.js'),
      import('../modules/pms/tasks/task.model.js'),
      import('../modules/pms/records/record.model.js'),
      import('../modules/pms/templates/template.model.js'),
      import('../modules/pms/activity/activity.model.js'),
      import('../modules/pms/notifications/notification.model.js'),
    ]);

    let tenant = await Tenant.findOne({ isDefault: true });
    if (!tenant) {
      console.log(`Default tenant "${NAME}" does not exist yet.`);
      if (APPLY) {
        tenant = await Tenant.create({
          name: NAME, slug: SLUG, isDefault: true, isActive: true,
        });
        console.log(`  created → ${tenant._id}`);
      } else {
        console.log('  would create it.');
      }
    } else {
      console.log(`Default tenant: ${tenant.name} (${tenant._id})`);
    }

    const models = Object.entries(mongoose.models)
      .filter(([name]) => name !== 'Tenant')
      .filter(([, model]) => model.schema.path('tenant'));

    console.log(`\n${models.length} tenant-scoped collection(s):\n`);
    let total = 0;
    /** Documents whose stamped key is already taken — a human decision, not
     *  something this script should guess at. */
    const conflicts = [];

    for (const [name, model] of models) {
      // eslint-disable-next-line no-await-in-loop
      const pending = await model.countDocuments({ tenant: { $in: [null, undefined] } });
      total += pending;
      if (!pending) {
        console.log(`  ${name.padEnd(20)} already done`);
        continue;
      }
      console.log(`  ${name.padEnd(20)} ${pending} document(s) need a tenant`);
      if (APPLY && tenant) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await model.updateMany(
            { tenant: { $in: [null, undefined] } },
            { $set: { tenant: tenant._id } },
          );
        } catch (err) {
          /* ONE COLLECTION'S CONFLICT MUST NOT ABORT THE REST.
             A stamped document can collide with an existing one — a per-company
             unique index means the backfilled key may already be taken. That is
             a real situation needing a human decision (merge? discard?), not a
             reason to leave the other twenty collections unstamped. So it is
             reported and the run continues.

             It happens for real: a rotation counter created by an unscoped
             script sits at `{tenant: null, team: '*'}` while the live one is at
             `{tenant: <company>, team: '*'}`. Stamping the orphan collides. */
          if (err?.code !== 11000) throw err;
          // eslint-disable-next-line no-await-in-loop
          const rows = await model.find({ tenant: { $in: [null, undefined] } }).select('_id').lean();
          let stamped = 0;
          for (const row of rows) {
            try {
              // eslint-disable-next-line no-await-in-loop
              await model.updateOne({ _id: row._id }, { $set: { tenant: tenant._id } });
              stamped += 1;
            } catch (inner) {
              if (inner?.code !== 11000) throw inner;
              conflicts.push(`${name} ${row._id}`);
            }
          }
          console.log(`    ${stamped} stamped, ${rows.length - stamped} could not be (see below)`);
        }
      }
    }

    console.log(`\n${APPLY ? 'Stamped' : 'Would stamp'} ${total} document(s).`);
    if (!APPLY) console.log('\nRe-run with --apply to write.');

    if (APPLY) {
      // Indexes now start with `tenant`, so the old ones are dead weight on
      // every write. Rebuilt here rather than left to autoIndex, which only
      // creates what is missing and never removes what is obsolete.
      console.log('\nRebuilding indexes…');
      for (const [name, model] of models) {
        // eslint-disable-next-line no-await-in-loop
        await model.syncIndexes().catch((err) => console.log(`  ${name}: ${err.message}`));
      }
      console.log('  done.');
    }
  });

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
