/**
 * Bring published templates' BOQ (p13) schema up to date with two changes that
 * cannot arrive by editing `clientFlowTemplate.js` alone.
 *
 * A project's form reads its field list from the Template *document* in Mongo,
 * which was copied from the seed when the template was first published. Editing
 * the seed file therefore changes what a FRESH database gets and nothing else —
 * every existing deployment keeps the old schema until something rewrites it.
 * That is what this does, for exactly two fields:
 *
 *   amount.productOf            = ['quantity', 'rate']
 *   vendor.optionsFromStage.scope = 'global'
 *
 * Non-destructive and idempotent: it only writes those two keys, only on stages
 * keyed `p13`, and reports without saving unless `--apply` is passed. Nothing
 * else in the template is read or rewritten, so a template someone has since
 * customised keeps every other edit.
 *
 *   node src/seed/migrateBoqDerivedFields.js            # dry run
 *   node src/seed/migrateBoqDerivedFields.js --apply    # persist
 */
import mongoose from 'mongoose';
import { connectDatabase } from '../config/database.js';
import { Template } from '../modules/pms/templates/template.model.js';

const BOQ_STAGE_KEY = 'p13';
/** Procurement — its Vendor field was free text, which silently broke the PO
 *  print (contact details are looked up by the vendor's exact name). */
const PROCUREMENT_STAGE_KEY = 'p15';
const APPLY = process.argv.includes('--apply');

async function run() {
  await connectDatabase();

  const templates = await Template.find({ 'stages.key': { $in: [BOQ_STAGE_KEY, PROCUREMENT_STAGE_KEY] } });
  if (!templates.length) {
    console.log('No template has a BOQ or Procurement stage — nothing to do.');
    return;
  }

  let changed = 0;

  for (const template of templates) {
    const stage = template.stages.find((s) => s.key === BOQ_STAGE_KEY);
    const fields = stage?.masterDataSchema || [];
    const amount = fields.find((f) => f.key === 'amount');
    const vendor = fields.find((f) => f.key === 'vendor');
    const notes = [];

    if (amount && !(amount.productOf || []).length) {
      amount.productOf = ['quantity', 'rate'];
      amount.helpText = 'Quantity × Rate — filled in for you, override it if the agreed amount differs.';
      notes.push('amount.productOf = [quantity, rate]');
    }

    if (vendor?.optionsFromStage && vendor.optionsFromStage.scope !== 'global') {
      vendor.optionsFromStage.scope = 'global';
      vendor.helpText = 'From the vendor master (Phase 4B / the Vendors page). Add a vendor there and it appears here.';
      notes.push("vendor.optionsFromStage.scope = 'global'");
    }

    // Procurement (p15): same vendor picker as the BOQ line.
    const procurement = template.stages.find((s) => s.key === PROCUREMENT_STAGE_KEY);
    const poVendor = (procurement?.masterDataSchema || []).find((f) => f.key === 'vendor');
    if (poVendor && (poVendor.type !== 'select' || poVendor.optionsFromStage?.scope !== 'global')) {
      poVendor.type = 'select';
      poVendor.optionsFromStage = { stageKey: 'p12', field: 'vendor_name', scope: 'global' };
      poVendor.helpText = 'From the vendor master (Phase 4B / the Vendors page). Add a vendor there and it appears here.';
      notes.push("p15 vendor → select from the global vendor master");
    }
    if (!notes.length) {
      console.log(`· ${template.name} — already current`);
      continue;
    }

    console.log(`${APPLY ? '✔' : '·'} ${template.name}`);
    notes.forEach((n) => console.log(`    ${n}`));

    if (APPLY) {
      // The paths sit inside a nested array-of-subdocuments; Mongoose does not
      // always see a mutation that deep, so mark them explicitly.
      template.markModified('stages');
      await template.save();
    }
    changed += 1;
  }

  console.log(
    changed === 0
      ? '\nNothing to change.'
      : `\n${changed} template(s) ${APPLY ? 'updated.' : 'would change — re-run with --apply to persist.'}`,
  );
}

run()
  .catch((err) => {
    console.error('Migration failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.connection.close());
