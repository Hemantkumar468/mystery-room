/**
 * Add the BOQ field to Phase 5 (p13) of the default template.
 *
 * WHY A NEW FIELD. The seven BOQs the business works from — General
 * Contractor, All games furniture, All games electronic, All games cameras,
 * All games speaker, Common area furniture, Procurement of all games — are
 * DOCUMENTS. A single BOQ carries lines of many trades, and two of them
 * ("All games furniture", "Common area furniture") are the same trade. So
 * nothing already on the form can stand in for it: `category` is the trade,
 * and deriving one from the other would merge two BOQs that must stay apart.
 *
 * WHY IT IS A TRACKER FIELD. Content fields are frozen once a record is
 * approved — that is the point of approval. Four of the BOQ lines in this
 * database are already approved, and they still need to be filed under a BOQ,
 * so the field has to be writable afterwards. `tracker: true` is exactly that
 * permission, and every write lands in the record's own changeLog with the
 * name of whoever made it.
 *
 * Nothing else changes: no code, no other field, no record. Existing lines
 * simply have no BOQ until somebody sets one, and the UI files those under
 * "Not assigned" rather than guessing.
 *
 *   node src/seed/addBoqTypeField.js            # dry run, prints the change
 *   node src/seed/addBoqTypeField.js --apply    # writes it
 */
import mongoose from 'mongoose';
import dns from 'dns';
import fs from 'fs';

dns.setServers(['8.8.8.8', '8.8.4.4']);

const APPLY = process.argv.includes('--apply');
const STAGE = 'p13';
const KEY = 'boq_type';

/** The seven, in the order the business lists them. */
export const BOQ_TYPES = [
  'General Contractor BOQ',
  'All games furniture BOQ',
  'All games electronic BOQ',
  'All games cameras BOQ',
  'All games speaker BOQ',
  'Common area furniture BOQ',
  'Procurement BOQ of all games',
];

const FIELD = {
  key: KEY,
  label: 'BOQ',
  type: 'select',
  options: BOQ_TYPES,
  required: false,
  tracker: true,
  helpText: 'Which BOQ this line belongs to. Lines of one BOQ are planned and ordered together.',
};

const uri = fs.readFileSync('.env', 'utf8').split('\n')
  .filter((l) => l.startsWith('MONGO_URI=')).pop().slice(10).trim();

await mongoose.connect(uri, { serverSelectionTimeoutMS: 30_000 });
const db = mongoose.connection.db;

const template = await db.collection('templates').findOne({ isDefault: true });
if (!template) throw new Error('No default template found.');

const stages = template.stages || [];
const idx = stages.findIndex((s) => s.key === STAGE);
if (idx < 0) throw new Error(`${STAGE} is not a stage of ${template.code}.`);

const schema = stages[idx].masterDataSchema || [];
const already = schema.findIndex((f) => f.key === KEY);

console.log(`template : ${template.code} (${template.name})`);
console.log(`stage    : ${STAGE} — ${stages[idx].name}`);
console.log(`fields   : ${schema.length}${already >= 0 ? ` (already has ${KEY})` : ''}`);

if (already >= 0) {
  console.log(`\n${KEY} is already on the form — nothing to do.`);
} else {
  /* Placed straight after `category`: the two answer neighbouring questions
     ("which trade" / "which BOQ") and a form reads better when they sit
     together. Falls back to the end if the form ever loses `category`. */
  const after = schema.findIndex((f) => f.key === 'category');
  const at = after >= 0 ? after + 1 : schema.length;
  console.log(`\nwould insert at position ${at + 1}, after "${schema[at - 1]?.key ?? '(start)'}":`);
  console.log(`  ${JSON.stringify(FIELD, null, 2).split('\n').join('\n  ')}`);

  if (APPLY) {
    const next = [...schema.slice(0, at), FIELD, ...schema.slice(at)];
    const path = `stages.${idx}.masterDataSchema`;
    const res = await db.collection('templates')
      .updateOne({ _id: template._id }, { $set: { [path]: next } });
    console.log(`\nwritten — matched ${res.matchedCount}, modified ${res.modifiedCount}`);
    const check = await db.collection('templates').findOne({ _id: template._id });
    const now = (check.stages[idx].masterDataSchema || []).find((f) => f.key === KEY);
    console.log(`read back: ${now ? `${now.key} · ${now.type} · ${now.options.length} options · tracker ${now.tracker}` : 'NOT FOUND'}`);
  } else {
    console.log('\ndry run — pass --apply to write it.');
  }
}

/* What the existing lines look like against it, either way. */
const rows = await db.collection('records').find({ stageKey: STAGE }).toArray();
const counts = {};
for (const r of rows) {
  const k = (r.values || {})[KEY] || '(not assigned)';
  counts[k] = (counts[k] || 0) + 1;
}
console.log(`\n${rows.length} existing ${STAGE} lines, by BOQ:`);
for (const [k, n] of Object.entries(counts)) console.log(`  ${String(n).padStart(3)}  ${k}`);

await mongoose.disconnect();
