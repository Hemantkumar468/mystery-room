/* eslint-disable no-console */
/**
 * One-time migration: convert the "Open Snags" master-data field from number
 * to text, to match the updated template definition in storeLaunchTemplate.js.
 *
 * It does two independent, idempotent things:
 *   1. Template documents — flips the `open_snags` field's `type` to 'text'
 *      wherever it is still 'number' (so the live form renders a text input).
 *   2. Project documents — normalizes any numeric `open_snags` value already
 *      captured in `masterData` into its string form (e.g. 3 -> "3").
 *
 * SAFE BY DEFAULT: runs as a DRY RUN and writes nothing. Pass --apply to persist.
 *
 *   node src/seed/migrateOpenSnagsToText.js            # preview only
 *   node src/seed/migrateOpenSnagsToText.js --apply     # actually migrate
 *
 * Touches only the `open_snags` field — no other field, project, or template
 * data is modified.
 */
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { Template } from '../modules/pms/templates/template.model.js';
import { Project } from '../modules/pms/projects/project.model.js';

const FIELD_KEY = 'open_snags';
const APPLY = process.argv.includes('--apply');

/** Step 1 — flip the field type on template definitions. */
async function migrateTemplates() {
  const templates = await Template.find({ 'stages.masterDataSchema.key': FIELD_KEY });
  let touched = 0;

  for (const template of templates) {
    let changed = false;
    for (const stage of template.stages || []) {
      for (const field of stage.masterDataSchema || []) {
        if (field.key === FIELD_KEY && field.type !== 'text') {
          console.log(
            `  • Template "${template.name}" / stage "${stage.key}": type ${field.type} -> text`,
          );
          field.type = 'text';
          changed = true;
        }
      }
    }
    if (changed) {
      touched += 1;
      if (APPLY) await template.save();
    }
  }
  console.log(`Templates needing update: ${touched}`);
  return touched;
}

/** Step 2 — normalize numeric values already stored on projects. */
async function migrateProjectValues() {
  const projects = await Project.find({});
  let touched = 0;

  for (const project of projects) {
    const master = project.masterData || {};
    let changed = false;

    for (const [stageKey, values] of Object.entries(master)) {
      if (!values || typeof values !== 'object') continue;
      const current = values[FIELD_KEY];
      if (typeof current === 'number') {
        console.log(
          `  • Project "${project.code}" / stage "${stageKey}": ${current} -> "${String(current)}"`,
        );
        values[FIELD_KEY] = String(current);
        changed = true;
      }
    }

    if (changed) {
      touched += 1;
      if (APPLY) {
        project.markModified('masterData');
        await project.save();
      }
    }
  }
  console.log(`Projects with numeric ${FIELD_KEY} values: ${touched}`);
  return touched;
}

async function main() {
  await connectDatabase();
  console.log(APPLY ? '\n== APPLYING migration ==\n' : '\n== DRY RUN (no writes) — pass --apply to persist ==\n');

  console.log('Step 1 — template field type:');
  const templates = await migrateTemplates();

  console.log('\nStep 2 — project values:');
  const projects = await migrateProjectValues();

  console.log(
    `\n${APPLY ? 'Applied' : 'Would update'}: ${templates} template(s), ${projects} project(s).`,
  );
}

main()
  .catch((err) => {
    console.error('✖ Migration failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDatabase();
    await mongoose.connection.close().catch(() => {});
    process.exit(process.exitCode || 0);
  });
