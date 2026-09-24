/**
 * Load the supply vendor master (vendorMasterData.js, from SHEET/F Vendor.xlsx)
 * into the database.
 *
 * Re-runnable and non-destructive: rows are matched by `code` (item + vendor),
 * so a second run refreshes numbers without duplicating anything, and any
 * vendor added on the Vendors page that is not in the sheet is left alone.
 *
 * SAFE BY DEFAULT: dry run, prints the plan, writes nothing.
 *
 *   node src/seed/seedVendorMaster.js            # show the plan
 *   node src/seed/seedVendorMaster.js --apply    # load / refresh
 */
import mongoose from 'mongoose';
import { config } from '../config/index.js';
import { VendorMaster, vendorCode } from '../modules/pms/vendorMaster/vendorMaster.model.js';
import { VENDOR_MASTER } from './vendorMasterData.js';

const APPLY = process.argv.includes('--apply');

async function main() {
  await mongoose.connect(config.db.uri);
  console.log(APPLY ? '\n== APPLYING ==' : '\n== DRY RUN (no writes) - pass --apply to persist ==');
  console.log(`${VENDOR_MASTER.length} vendor rows in the sheet\n`);

  /* Two rows that slug to the same code would silently overwrite each other and
     the run would report a success one row short. Caught here, before any
     write, because the sheet is hand-maintained and the next edit to it is the
     one that introduces the clash. */
  const seen = new Map();
  for (const v of VENDOR_MASTER) {
    const code = vendorCode(v.item, v.vendorName);
    if (seen.has(code)) {
      throw new Error(
        `Two sheet rows share the key "${code}": "${seen.get(code)}" and "${v.item} / ${v.vendorName}". `
        + 'Give one of them a distinguishing item or vendor name.',
      );
    }
    seen.set(code, `${v.item} / ${v.vendorName}`);
  }

  let created = 0;
  let updated = 0;
  let order = 0;
  for (const v of VENDOR_MASTER) {
    order += 10;
    const code = vendorCode(v.item, v.vendorName);
    const existing = await VendorMaster.findOne({ code });
    const tag = existing ? '~ refresh' : '+ new    ';
    console.log(`  ${tag} ${String(v.serial ?? '').padStart(2)}  ${v.item.padEnd(28)} ${v.vendorName.padEnd(36)} ${v.contactNumber || ''}`);
    if (existing) updated += 1; else created += 1;
    if (!APPLY) continue;

    await VendorMaster.findOneAndUpdate(
      { code },
      /* Contact details somebody filled in on the page are NOT wiped by a
         re-seed: the sheet only ever knew a phone number, so `$set` carries
         just the columns it actually has an answer for, and contactPerson,
         email, city, gst and notes survive. `sortOrder` is re-stated so the
         page keeps reading in the sheet's order after a row is inserted. */
      {
        $set: {
          item: v.item,
          vendorName: v.vendorName,
          contactNumber: v.contactNumber ?? '',
          serial: v.serial ?? null,
          sortOrder: order,
        },
        $setOnInsert: { code },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  const total = await VendorMaster.countDocuments();
  console.log(`\n${created} new, ${updated} refreshed.${APPLY ? ` The master now holds ${total} vendors.` : ''}`);
  console.log(APPLY
    ? 'Master Data → Vendors maintains it, and the BOQ / work-order vendor pickers read it.'
    : '\nNothing written. Re-run with --apply.');
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
