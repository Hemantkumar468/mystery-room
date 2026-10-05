/* eslint-disable no-console */
/**
 * One-time migration: rebuild Property Capture (p1)'s "where is it" fields —
 * put Location beside the property's name, give the Full Address a label, a
 * textarea and its place under the pin, and renumber the section so the two
 * agree.
 *
 * WHAT WAS ACTUALLY ON THE LIVE TEMPLATE, and why the form looked broken.
 * `address` had been added to the published template by hand with `label: ''`,
 * `type: 'text'` and `order: 0` — the same order as `property_name`. The form
 * sorts by `order` (`groupBySection` in RecordFormModal), so it drew a
 * NAMELESS TEXT BOX in the second slot of the first row, beside Property Name:
 * a required-looking input with nothing to say what went in it. Meanwhile the
 * one field it was supposed to be — the big address that the pin fills in —
 * did not exist on the form at all.
 *
 * WHY `address` MATTERS AT ALL. It is read all the way down the property
 * module: the property report prints it under "Where it is", and the queue
 * falls back to the locality when it is empty
 * (`address: str(v.address) || str(v.locality)` in propertyCapture.service.js).
 * That fallback is what hid the gap for so long — the report always showed
 * *something*, so a property carrying its own locality back as its address
 * looked filled in.
 *
 * AND THE RENAME. "Locality" is not the word anybody here uses; they say
 * location — "Delhi, and the location is Connaught Place". Only the label and
 * help text change. The key stays `locality`, so every stored value, filter,
 * sort and report that already reads it keeps working; nothing is migrated in
 * the records themselves.
 *
 * Touches ONLY p1's `masterDataSchema`. No project, record or task data is
 * modified, and no other stage is looked at.
 *
 * SAFE BY DEFAULT: runs as a DRY RUN and writes nothing. Pass --apply.
 *
 *   node src/seed/migrateP1Address.js            # preview only
 *   node src/seed/migrateP1Address.js --apply    # actually migrate
 */
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { Template } from '../modules/pms/templates/template.model.js';

const APPLY = process.argv.includes('--apply');

/**
 * The Property Information section, as storeLaunchTemplate.js now defines it.
 * Source and migration must not drift, so the shape is written once here and
 * applied field by field.
 *
 * The order is the order somebody actually answers in: what the place is
 * called and where it is, then its size, then the pin, then the street address
 * the pin resolves to.
 */
const FIELDS = {
  property_name: { order: 0 },
  locality: {
    order: 1,
    label: 'Location',
    type: 'text',
    placeholder: 'e.g. Connaught Place',
    helpText: 'The area within the city. Start typing to pick one already used here.',
  },
  carpet_area: { order: 2 },
  frontage_ft: { order: 3 },
  floor: { order: 4 },
  live_location: { order: 5 },
  address: {
    order: 6,
    label: 'Full Address',
    type: 'textarea',
    placeholder: 'Shop number, building, street, landmark, pin code',
    helpText: 'Fills in from the pin above — edit it to add the shop number and landmark.',
  },
};

const SECTION = 'Property Information';

/**
 * Put the section's fields in `order`, leaving every other field where it is.
 *
 * THE ARRAY ORDER IS WHAT THE FORM DRAWS as much as the `order` number is —
 * `groupBySection` sorts by `order`, but ties keep array position, and a field
 * appended to the end of a 20-entry schema (which is exactly where the
 * hand-added `address` sat) has to travel a long way. Sorting the array in
 * place with a comparator that returns 0 for cross-section pairs is not a
 * valid ordering and will not reliably move it, so the section is lifted out,
 * sorted on its own, and dropped back where it started.
 */
function reorderSection(schema) {
  const inSection = (f) => f.section === SECTION;
  const positions = schema.map((f, i) => (inSection(f) ? i : -1)).filter((i) => i >= 0);
  if (positions.length < 2) return schema;

  const sorted = positions.map((i) => schema[i]).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const others = schema.filter((f) => !inSection(f));
  const othersBefore = schema.slice(0, positions[0]).filter((f) => !inSection(f)).length;

  return [...others.slice(0, othersBefore), ...sorted, ...others.slice(othersBefore)];
}

async function migrate() {
  const templates = await Template.find({ 'stages.key': 'p1' });
  let touched = 0;

  for (const template of templates) {
    const stage = template.stages.find((s) => s.key === 'p1');
    const schema = stage?.masterDataSchema;
    if (!Array.isArray(schema)) continue;

    const changes = [];

    for (const [key, want] of Object.entries(FIELDS)) {
      let field = schema.find((x) => x.key === key);

      /* Only `address` is genuinely new to a template that never had it;
         everything else is being moved or relabelled. A template missing one
         of the others is not something this migration should invent — it is a
         template built differently, and quietly adding fields to it would be
         worse than leaving it alone. */
      if (!field) {
        if (key !== 'address') continue;
        field = { key, section: SECTION, required: false };
        schema.push(field);
        changes.push(`+ ${key} (new)`);
      }

      for (const [prop, value] of Object.entries(want)) {
        if (field[prop] === value) continue;
        changes.push(`  ${key}.${prop}: ${JSON.stringify(field[prop])} -> ${JSON.stringify(value)}`);
        field[prop] = value;
      }
      if (!field.section) field.section = SECTION;
    }

    const before = schema.filter((x) => x.section === SECTION).map((x) => x.key).join(',');
    const rebuilt = reorderSection(schema.map((f) => f));
    const after = rebuilt.filter((x) => x.section === SECTION).map((x) => x.key).join(',');
    if (before !== after) {
      changes.push(`  order: ${before}`);
      changes.push(`      -> ${after}`);
      stage.masterDataSchema = rebuilt;
    }

    if (!changes.length) continue;

    console.log(`\nTemplate "${template.name}" (${template.code}):`);
    changes.forEach((c) => console.log(`  • ${c}`));

    template.markModified('stages');
    touched += 1;
    if (APPLY) await template.save();
  }

  console.log(`\nTemplates needing update: ${touched}`);
  if (!APPLY && touched) console.log('Dry run — nothing written. Re-run with --apply.');
  return touched;
}

async function main() {
  await connectDatabase();
  try {
    await migrate();
  } finally {
    await disconnectDatabase();
    await mongoose.connection.close().catch(() => { });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
