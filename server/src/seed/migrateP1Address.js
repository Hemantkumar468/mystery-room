/* eslint-disable no-console */
/**
 * One-time migration: rebuild Property Capture (p1)'s "Where exactly is it"
 * fields — add Full Address, rename Locality to Location, and put the three
 * of them in order under Floor.
 *
 * WHY THE FORM NEEDED IT. `address` is read all the way down the property
 * module — the property report prints it under "Where it is", and the queue
 * falls back to the locality when it is empty
 * (`address: str(v.address) || str(v.locality)` in propertyCapture.service.js)
 * — but the capture form never asked for it. The schema even had an empty
 * `order: 2` slot sitting between Locality and Area where it belongs. So a
 * property captured by our own team carried its locality repeated back as its
 * address, and only the ones that arrived through the public franchise form
 * (which does ask) had a real one. The fallback made that invisible: the
 * report always showed *something*.
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
 * The three answers to "where exactly is it" end up together and in the order
 * somebody actually gives them: the area, then the pin, then the street
 * address the pin resolves to.
 */
const FIELDS = {
  property_name: { order: 0 },
  carpet_area: { order: 3 },
  frontage_ft: { order: 4 },
  floor: { order: 5 },
  locality: {
    order: 6,
    label: 'Location',
    placeholder: 'e.g. Connaught Place',
    helpText: 'The area within the city. Start typing to pick one already used here.',
  },
  live_location: { order: 7 },
  address: {
    order: 8,
    label: 'Full Address',
    type: 'textarea',
    placeholder: 'Shop number, building, street, landmark, pin code',
    helpText: 'Fills in from the pin above — edit it to add the shop number and landmark.',
  },
};

const SECTION = 'Property Information';

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

      /* Only `address` is genuinely new; everything else is being moved or
         relabelled. A template missing one of the others is not something this
         migration should invent — it is a template built differently, and
         quietly adding fields to it would be worse than leaving it alone. */
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

    /* THE ARRAY ORDER IS WHAT THE FORM DRAWS, not the `order` number — a field
       appended to the end renders at the end however low its order is. This is
       what actually puts Location under Floor and the address under the pin.
       Only this section is sorted; every other field keeps its place. */
    const before = schema.filter((x) => x.section === SECTION).map((x) => x.key).join(',');
    schema.sort((a, b) => {
      if (a.section !== SECTION || b.section !== SECTION) return 0;
      return (a.order ?? 0) - (b.order ?? 0);
    });
    const after = schema.filter((x) => x.section === SECTION).map((x) => x.key).join(',');
    if (before !== after) changes.push(`  order: ${after}`);

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
