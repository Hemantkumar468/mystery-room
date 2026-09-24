/**
 * Migrate the BoxHero inventory export into the inventory master.
 *
 * Reads SHEET/Report_Inventory_*.xlsx directly — the columns are SKU, Name,
 * Category, Visibility, Unit, Vendor Name, Vendor Details — and upserts one
 * `InventoryItem` per row, matched on SKU. Every distinct category in the file
 * is also created in the curated category master, so the page's dropdown is
 * populated the moment the migration finishes.
 *
 * WHY IT READS THE SPREADSHEET rather than a transcribed .js data file, which
 * is what seedVendorMaster.js does. That sheet is 40 rows; this one is 1,322,
 * and a transcription of it would be a 150KB source file that goes stale the
 * first time anybody re-exports from BoxHero. Reading the export means the
 * refresh is "drop in the new file and re-run", which is the only workflow
 * that survives contact with a list this size. See lib/readXlsx.mjs.
 *
 * RE-RUNNABLE AND NON-DESTRUCTIVE. Rows are matched by SKU, so a second run
 * refreshes what the sheet knows and leaves everything it does not: notes
 * somebody typed on the page, an item's archived state, and any SKU added in
 * the app that is not in the export are all untouched.
 *
 * SAFE BY DEFAULT: dry run, prints the plan, writes nothing.
 *
 *   node src/seed/seedInventory.js                 # show the plan
 *   node src/seed/seedInventory.js --apply         # migrate / refresh
 *   node src/seed/seedInventory.js --file <path>   # a specific export
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { config } from '../config/index.js';
import { readXlsx } from './lib/readXlsx.mjs';
import { InventoryItem } from '../modules/pms/inventory/inventoryItem.model.js';
import { InventoryCategory, categoryCode } from '../modules/pms/inventory/inventoryCategory.model.js';

const APPLY = process.argv.includes('--apply');
const fileArg = process.argv[process.argv.indexOf('--file') + 1];
const SHEET_DIR = path.resolve(fileURLToPath(new URL('../../SHEET', import.meta.url)));

/** The newest inventory export in SHEET/, unless one was named on the command line. */
function resolveSheet() {
  if (process.argv.includes('--file')) {
    if (!fileArg || fileArg.startsWith('--')) throw new Error('--file needs a path after it.');
    if (!fs.existsSync(fileArg)) throw new Error(`No such file: ${fileArg}`);
    return fileArg;
  }
  const candidates = fs.readdirSync(SHEET_DIR)
    .filter((f) => /^Report_Inventory_.*\.xlsx$/i.test(f) && !f.startsWith('~$'))
    .map((f) => ({ f, at: fs.statSync(path.join(SHEET_DIR, f)).mtimeMs }))
    .sort((a, b) => b.at - a.at);
  if (!candidates.length) {
    throw new Error(`No Report_Inventory_*.xlsx found in ${SHEET_DIR}. Drop the BoxHero export there, or pass --file.`);
  }
  return path.join(SHEET_DIR, candidates[0].f);
}

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/**
 * The export's units, spelled the way the master should hold them.
 *
 * 13 rows say "pice" and 3 say "set" against 102 that say "Set" — the same
 * unit typed differently on different days. Left as-is they become separate
 * entries in the Unit dropdown, which is how a dropdown stops being useful.
 * Anything not in this map is title-cased and otherwise left alone, because
 * "8x4" and "45*50 inch" are real answers the stores team gave and guessing at
 * them would lose information.
 */
const UNIT_FIXES = new Map([
  ['pice', 'Piece'],
  ['piece', 'Piece'],
  ['pcs', 'Piece'],
  ['set', 'Set'],
  ['pair', 'Pair'],
  ['meter', 'Meter'],
  ['metre', 'Meter'],
  ['packet', 'Packet'],
  ['box', 'Box'],
  ['can', 'Can'],
  ['roll', 'Roll'],
  ['bundle', 'Bundle'],
  ['bottle', 'Bottle'],
  ['bunch', 'Bunch'],
  ['kg', 'Kg'],
  ['grams', 'Grams'],
  ['ml', 'ml'],
  ['ton', 'Ton'],
  ['square feet', 'Square Feet'],
  ['square meter', 'Square Meter'],
]);

const normaliseUnit = (raw) => {
  const u = clean(raw);
  if (!u) return '';
  return UNIT_FIXES.get(u.toLowerCase()) ?? u;
};

/**
 * "Electronics , Game Elements" → "Electronics, Game Elements".
 *
 * The compound categories are kept as compounds rather than split into two
 * rows or forced into one: 22 items genuinely belong to both, that is what the
 * stores team meant, and inventing a rule to pick a winner would file them
 * somewhere nobody chose. Only the spacing is tidied, so the same compound
 * typed two ways collapses to one dropdown entry.
 */
const normaliseCategory = (raw) => clean(raw)
  .split(',')
  .map((p) => p.trim())
  .filter(Boolean)
  .join(', ');

const normaliseVisibility = (raw) => (clean(raw).toLowerCase() === 'listed' ? 'Listed' : 'Unlisted');

async function main() {
  const file = resolveSheet();
  const { header, rows } = readXlsx(file);

  const required = ['SKU', 'Name'];
  const missing = required.filter((h) => !header.includes(h));
  if (missing.length) {
    throw new Error(`${path.basename(file)} is missing the column(s): ${missing.join(', ')}. Found: ${header.join(', ')}`);
  }

  const items = rows.map((r) => ({
    sku: clean(r.SKU).toUpperCase(),
    name: clean(r.Name),
    category: normaliseCategory(r.Category),
    visibility: normaliseVisibility(r.Visibility),
    unit: normaliseUnit(r.Unit),
    vendorName: clean(r['Vendor Name']),
    vendorDetails: clean(r['Vendor Details']),
  })).filter((i) => i.sku && i.name);

  /* Two rows sharing a SKU would silently overwrite each other and the run
     would report success one row short. Caught before any write, because the
     export is produced by a system somebody else maintains and the next
     version of it is the one that introduces the clash. */
  const seen = new Map();
  const clashes = [];
  for (const i of items) {
    if (seen.has(i.sku)) clashes.push(`${i.sku}: "${seen.get(i.sku)}" and "${i.name}"`);
    else seen.set(i.sku, i.name);
  }
  if (clashes.length) {
    throw new Error(`The export has ${clashes.length} duplicate SKU(s):\n  ${clashes.join('\n  ')}`);
  }

  await mongoose.connect(config.db.uri);
  console.log(APPLY ? '\n== APPLYING ==' : '\n== DRY RUN (no writes) — pass --apply to persist ==');
  console.log(`Source: ${path.basename(file)}`);
  console.log(`${rows.length} rows read, ${items.length} usable\n`);

  const existing = new Set((await InventoryItem.find({}, { sku: 1 }).lean()).map((d) => d.sku));
  const created = items.filter((i) => !existing.has(i.sku));
  const refreshed = items.filter((i) => existing.has(i.sku));

  /* A sample rather than 1,322 lines. The whole point of the dry run is that
     somebody reads it, and nobody reads 1,322 lines — the counts below are the
     part that matters, and the sample is there to show the shape is right. */
  console.log('  First 10 rows as they will be stored:');
  for (const i of items.slice(0, 10)) {
    console.log(`    ${existing.has(i.sku) ? '~' : '+'} ${i.sku.padEnd(14)} ${i.name.slice(0, 34).padEnd(36)} ${(i.category || '—').padEnd(24)} ${(i.unit || '—').padEnd(8)} ${i.vendorName}`);
  }

  const categories = [...new Set(items.map((i) => i.category).filter(Boolean))].sort();
  const units = [...new Set(items.map((i) => i.unit).filter(Boolean))].sort();
  console.log(`\n  ${categories.length} categories: ${categories.join(' · ')}`);
  console.log(`  ${units.length} units: ${units.join(' · ')}`);
  console.log(`  ${items.filter((i) => i.visibility === 'Listed').length} listed, ${items.filter((i) => i.visibility === 'Unlisted').length} unlisted`);
  console.log(`  ${items.filter((i) => !i.category).length} with no category, ${items.filter((i) => !i.vendorName).length} with no vendor`);
  console.log(`\n  ${created.length} new, ${refreshed.length} to refresh.`);

  if (!APPLY) {
    console.log('\nNothing written. Re-run with --apply.');
    return;
  }

  /* One bulk write rather than 1,322 round trips. `upsert` keyed on the SKU is
     what makes the run repeatable, and `$set` naming only the columns the
     sheet actually has is what stops a re-run wiping the notes and the
     archived flag somebody set on the page. */
  const ops = items.map((i) => ({
    updateOne: {
      filter: { sku: i.sku },
      update: {
        $set: {
          name: i.name,
          category: i.category,
          visibility: i.visibility,
          unit: i.unit,
          vendorName: i.vendorName,
          vendorDetails: i.vendorDetails,
          source: 'sheet',
        },
        $setOnInsert: { sku: i.sku, active: true, notes: '' },
      },
      upsert: true,
    },
  }));

  const CHUNK = 500;
  let upserted = 0;
  let modified = 0;
  for (let at = 0; at < ops.length; at += CHUNK) {
    // eslint-disable-next-line no-await-in-loop
    const res = await InventoryItem.bulkWrite(ops.slice(at, at + CHUNK), { ordered: false });
    upserted += res.upsertedCount ?? 0;
    modified += res.modifiedCount ?? 0;
    console.log(`  … ${Math.min(at + CHUNK, ops.length)} / ${ops.length}`);
  }

  const lastCategory = await InventoryCategory.findOne().sort({ sortOrder: -1 }).select('sortOrder').lean();
  let order = lastCategory?.sortOrder ?? 0;
  const catOps = categories.map((name) => {
    order += 10;
    return {
      updateOne: {
        filter: { code: categoryCode(name) },
        update: { $setOnInsert: { code: categoryCode(name), name, sortOrder: order, active: true } },
        upsert: true,
      },
    };
  });
  const catRes = catOps.length ? await InventoryCategory.bulkWrite(catOps, { ordered: false }) : { upsertedCount: 0 };

  const total = await InventoryItem.countDocuments();
  console.log(`\n${upserted} new, ${modified} refreshed. ${catRes.upsertedCount ?? 0} new categories.`);
  console.log(`The master now holds ${total} items.`);
  console.log('Master Data → Inventory maintains it from here.');
}

main()
  .catch((err) => { console.error(`\n${err.message}\n`); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
