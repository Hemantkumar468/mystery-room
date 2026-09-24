/* eslint-disable no-console */
/**
 * One-time migration: put the deposit's INSTALMENT PLAN on the LOI.
 *
 * The Letter of Intent already carried `deposit_amount` — one figure, and no
 * way to say the thing every LOI actually says next: how many payments it is
 * broken into. Without that the ledger could report money received and
 * nothing else; "instalment 1 of 2 settled, instalment 2 outstanding" was a
 * sentence only a person could write, from the PDF.
 *
 * Two fields, both optional:
 *   deposit_instalments   number, 1–12 — in how many payments it is paid
 *   deposit_split_pct     text — "50/50", "30/40/30"; blank splits equally
 *
 * `flow.service.js#depositPlan` reads them, sizes each instalment against the
 * agreed deposit and lays the recorded payments across it. An LOI that leaves
 * them blank behaves exactly as before: a list of payments and no plan.
 *
 * ── Why this is additive and cannot break an existing LOI ────────────
 * Nothing becomes required, no field is renamed, no value is rewritten. Every
 * LOI record already saved keeps every value it has; the two new fields are
 * simply empty on it until somebody fills them in. The only documents this
 * writes are Template (and Project stage snapshots, which carry their own
 * copy of the schema) — never a Record.
 *
 * SAFE BY DEFAULT: runs as a DRY RUN and writes nothing. Pass --apply.
 *
 *   node src/seed/migrateLoiDepositPlan.js            # preview only
 *   node src/seed/migrateLoiDepositPlan.js --apply    # actually migrate
 */
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { Template } from '../modules/pms/templates/template.model.js';
import { Project } from '../modules/pms/projects/project.model.js';
import { Record } from '../modules/pms/records/record.model.js';
import { storeLaunchTemplate } from './storeLaunchTemplate.js';

const APPLY = process.argv.includes('--apply');

const sourceLoi = storeLaunchTemplate.stages
  .find((s) => s.key === 'p3')
  ?.assessmentTypes?.find((a) => a.key === 'loi');

const NEW_KEYS = ['deposit_instalments', 'deposit_split_pct'];

/**
 * Add whatever is missing to one LOI schema, in the order the source declares.
 *
 * Field ORDER matters — the form lays fields out by it, and the new pair
 * belongs beside `deposit_amount`, not at the bottom under Remarks. So the
 * whole list is re-ordered to match the source rather than appended to. Any
 * field this database has that the source does not (a local addition) is kept
 * and pushed to the end rather than deleted.
 */
function mergeLoiSchema(existing = []) {
  const have = new Map(existing.map((f) => [f.key, f]));
  const added = NEW_KEYS.filter((k) => !have.has(k));
  if (!added.length) return { schema: null, added: [] };

  const merged = [];
  for (const src of sourceLoi.masterDataSchema) {
    const mine = have.get(src.key);
    /* An existing field keeps its own definition — this migration adds the
       two new ones, it does not quietly restyle the other nine. */
    merged.push(mine ? { ...mine.toObject?.() ?? mine, order: src.order } : { ...src });
    have.delete(src.key);
  }
  let n = merged.length;
  for (const leftover of have.values()) merged.push({ ...(leftover.toObject?.() ?? leftover), order: n += 1 });

  return { schema: merged, added };
}

async function migrateTemplates() {
  const templates = await Template.find({ 'stages.assessmentTypes.key': 'loi' });
  let touched = 0;

  for (const template of templates) {
    for (const stage of template.stages) {
      const loi = stage.assessmentTypes?.find((a) => a.key === 'loi');
      if (!loi) continue;
      const { schema, added } = mergeLoiSchema(loi.masterDataSchema);
      console.log(`\nTemplate "${template.name}" (${template.code}) · stage ${stage.key}:`);
      if (!added.length) { console.log('  • already has both fields — nothing to do'); continue; }
      console.log(`  • LOI fields ${loi.masterDataSchema.length} → ${schema.length}`);
      console.log(`  • adding: ${added.join(', ')}`);
      loi.masterDataSchema = schema;
      template.markModified('stages');
      touched += 1;
    }
    if (APPLY && template.isModified()) await template.save();
  }
  return touched;
}

/**
 * Projects snapshot their template's stages when they are created, so a
 * template edit does not reach a live project on its own. That is exactly
 * what hid Contracts and HR Hiring from every existing project until the
 * 17-phase migration, and the same trap applies here.
 */
async function migrateProjects() {
  const projects = await Project.find({ 'stages.assessmentTypes.key': 'loi' })
    .select('name code stages');
  let touched = 0;

  for (const project of projects) {
    let changed = false;
    for (const stage of project.stages) {
      const loi = stage.assessmentTypes?.find((a) => a.key === 'loi');
      if (!loi) continue;
      const { schema, added } = mergeLoiSchema(loi.masterDataSchema);
      if (!added.length) continue;
      loi.masterDataSchema = schema;
      changed = true;
      console.log(`  ${project.code || project.name} · ${stage.key}: +${added.join(', ')}`);
    }
    if (changed) {
      project.markModified('stages');
      touched += 1;
      if (APPLY) await project.save();
    }
  }
  return touched;
}

async function main() {
  if (!sourceLoi) throw new Error('storeLaunchTemplate has no p3 LOI assessment — nothing to migrate from');

  await connectDatabase();
  console.log(APPLY ? '\n== APPLYING migration ==' : '\n== DRY RUN (no writes) — pass --apply to persist ==');

  const templates = await migrateTemplates();

  console.log('\nProject stage snapshots:');
  const projects = await migrateProjects();
  if (!projects) console.log('  (none needed it)');

  /* Records are never touched. Counting them is how that claim is checked
     rather than asserted. */
  const loiRecords = await Record.countDocuments({ assessmentType: 'loi' });
  const withPlan = await Record.countDocuments({
    assessmentType: 'loi', 'values.deposit_instalments': { $exists: true, $ne: null },
  });

  console.log(`\n${'─'.repeat(62)}`);
  console.log(`  Templates updated:        ${templates}`);
  console.log(`  Project snapshots updated:${String(projects).padStart(2)}`);
  console.log(`  LOI records in the db:    ${loiRecords} — none is modified by this migration`);
  console.log(`  …already naming a plan:   ${withPlan}`);
  console.log(`${'─'.repeat(62)}`);
  console.log(APPLY
    ? '\nDone. Every LOI form now has "Deposit Instalments" and "Instalment Split (%)"; both are optional and every existing LOI keeps its values.\n'
    : '\nNothing was written. Re-run with --apply to persist.\n');

  await disconnectDatabase();
}

main().catch(async (err) => {
  console.error(err);
  await disconnectDatabase();
  process.exit(1);
});
