/**
 * Stand up the IMS: the locations stock sits at, and a stock row per item at
 * the central warehouse.
 *
 * WHAT IT DOES AND DOES NOT INVENT. It creates the LOCATIONS and, at the main
 * warehouse, one `StockLevel` per catalogue item — so every one of the 1,322
 * migrated SKUs is immediately visible, searchable and stockable in the IMS
 * rather than having to be "added" one at a time before it can be received.
 *
 * Those rows are created at ZERO, with no safety stock, and NO movements are
 * written. That is deliberate and it is the whole ethic of this script: the
 * BoxHero export carried no quantities, so nobody knows what is on the
 * shelves, and seeding a plausible-looking number would put fiction into the
 * ledger that every later reading would inherit as fact. The real opening
 * count is a stocktake, and the IMS has a screen for it — Stock → Count.
 *
 * Re-runnable and non-destructive: locations are matched on `code` and stock
 * rows on item × location, so a second run adds what is missing and touches
 * no count and no floor anybody has already set.
 *
 * SAFE BY DEFAULT: dry run, prints the plan, writes nothing.
 *
 *   node src/seed/seedIms.js                    # show the plan
 *   node src/seed/seedIms.js --apply            # create locations + stock rows
 *   node src/seed/seedIms.js --apply --no-stock # locations only
 */
import mongoose from 'mongoose';
import { config } from '../config/index.js';
import { InventoryItem } from '../modules/pms/inventory/inventoryItem.model.js';
import { InventoryLocation } from '../modules/ims/inventoryLocation.model.js';
import { StockLevel } from '../modules/ims/stockLevel.model.js';
import { StockMovement } from '../modules/ims/stockMovement.model.js';

const APPLY = process.argv.includes('--apply');
const WITH_STOCK = !process.argv.includes('--no-stock');

/**
 * The starting set.
 *
 * MAIN is the central store — it is literally the name on the export this
 * whole module grew from ("Mystery Rooms (Main Inventory)"). The rest are the
 * cities Mystery Rooms already runs centres in, seeded so the location filter
 * has something real in it on day one; any that are wrong are edited or closed
 * on IMS → Locations, and new ones are added there.
 *
 * `type` matters: the warehouse is what stock is issued FROM, an outlet is
 * company-run, a franchise is partner-run. The grid and the transfer form both
 * read it.
 */
const LOCATIONS = [
  { code: 'MAIN', name: 'Mystery Rooms (Main Inventory)', type: 'warehouse', city: 'Delhi', sortOrder: 0 },
  { code: 'DEL', name: 'Mystery Rooms Delhi', type: 'outlet', city: 'Delhi', sortOrder: 10 },
  { code: 'GGN', name: 'Mystery Rooms Gurgaon', type: 'outlet', city: 'Gurgaon', sortOrder: 20 },
  { code: 'NOI', name: 'Mystery Rooms Noida', type: 'outlet', city: 'Noida', sortOrder: 30 },
  { code: 'JAI', name: 'Mystery Rooms Jaipur', type: 'franchise', city: 'Jaipur', sortOrder: 40 },
  { code: 'LKO', name: 'Mystery Rooms Lucknow', type: 'franchise', city: 'Lucknow', sortOrder: 50 },
];

async function main() {
  await mongoose.connect(config.db.uri);
  console.log(APPLY ? '\n== APPLYING ==' : '\n== DRY RUN (no writes) — pass --apply to persist ==');

  /* ── locations ─────────────────────────────────────────────────────── */

  const existingCodes = new Set((await InventoryLocation.find({}, { code: 1 }).lean()).map((l) => l.code));
  const newLocations = LOCATIONS.filter((l) => !existingCodes.has(l.code));

  console.log(`\nLocations — ${LOCATIONS.length} in the starting set, ${existingCodes.size} already present:`);
  for (const l of LOCATIONS) {
    console.log(`  ${existingCodes.has(l.code) ? '~ have' : '+ new '} ${l.code.padEnd(6)} ${l.name.padEnd(36)} ${l.type.padEnd(10)} ${l.city}`);
  }

  if (APPLY && newLocations.length) {
    await InventoryLocation.insertMany(
      newLocations.map((l) => ({ ...l, active: true })),
      { ordered: false },
    );
  }

  /* ── stock rows at the warehouse ───────────────────────────────────── */

  const main = APPLY
    ? await InventoryLocation.findOne({ code: 'MAIN' }).lean()
    : await InventoryLocation.findOne({ code: 'MAIN' }).lean() || { _id: null, name: LOCATIONS[0].name };

  const itemCount = await InventoryItem.countDocuments({ active: { $ne: false } });

  if (!WITH_STOCK) {
    console.log('\n--no-stock — no stock rows will be created.');
  } else if (!main?._id) {
    console.log(`\nStock rows — would create one per item (${itemCount}) at "${LOCATIONS[0].name}" once it exists.`);
  } else {
    const have = await StockLevel.countDocuments({ location: main._id });
    console.log(`\nStock rows at ${main.name} — ${have} present, ${itemCount} items in the master.`);

    if (APPLY) {
      /* Upsert keyed on item × location, so a re-run adds only what is missing
         and `$setOnInsert` guarantees it never touches a count or a floor that
         somebody has already set. */
      const items = await InventoryItem.find({ active: { $ne: false } }, { _id: 1 }).lean();
      const ops = items.map((i) => ({
        updateOne: {
          filter: { item: i._id, location: main._id },
          update: { $setOnInsert: { item: i._id, location: main._id, onHand: 0, safetyStock: 0, reorderQty: 0 } },
          upsert: true,
        },
      }));

      const CHUNK = 500;
      let created = 0;
      for (let at = 0; at < ops.length; at += CHUNK) {
        // eslint-disable-next-line no-await-in-loop
        const res = await StockLevel.bulkWrite(ops.slice(at, at + CHUNK), { ordered: false });
        created += res.upsertedCount ?? 0;
        console.log(`  … ${Math.min(at + CHUNK, ops.length)} / ${ops.length}`);
      }
      console.log(`  ${created} stock rows created at zero.`);
    }
  }

  /* ── what the module now holds ─────────────────────────────────────── */

  if (APPLY) {
    const [locations, levels, movements] = await Promise.all([
      InventoryLocation.countDocuments(),
      StockLevel.countDocuments(),
      StockMovement.countDocuments(),
    ]);
    console.log(`\nIMS now holds ${locations} locations, ${levels} stock rows and ${movements} movements.`);
    console.log('Every count starts at zero and NO movements were invented — see the note at the top of this file.');
    console.log('Next: IMS → Stock → "Count" to enter the real opening numbers, and set a safety level per item.');
  } else {
    console.log('\nNothing written. Re-run with --apply.');
  }
}

main()
  .catch((err) => { console.error(`\n${err.message}\n`); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
