/**
 * Mark the LOG forms on every live template.
 *
 * A form flagged `noDecision` is filed and read, never approved: the record
 * drawer shows no Shortlist/Reject, and its records stay out of the approvals
 * queue. The Daily Site Report is the first — a site supervisor's diary entry
 * is not something a manager signs off, and one per site per day would bury
 * the approvals that matter.
 *
 * Needed as its own step because a template is a DOCUMENT copied from the seed
 * when it was first published: editing the seed only changes what a fresh
 * database gets. migrateDailySiteReport.js deliberately only ADDS a missing
 * form and never rewrites an existing one, so templates that already carry the
 * report need this to pick up the flag.
 *
 * Non-destructive and idempotent — it sets one boolean and touches nothing
 * else. Dry run by default.
 *
 *   node src/seed/markLogForms.js            # report only
 *   node src/seed/markLogForms.js --apply    # persist
 */
import mongoose from 'mongoose';
import { config } from '../config/index.js';
import { Template } from '../modules/pms/templates/template.model.js';
import { DAILY_SITE_REPORT_KEY } from './dailySiteReport.js';

/** Assessment-type keys that are logs, not submissions. */
const LOG_FORM_KEYS = new Set([DAILY_SITE_REPORT_KEY]);

const APPLY = process.argv.includes('--apply');

async function main() {
  await mongoose.connect(config.db.uri);
  console.log(APPLY ? '\n== APPLYING ==' : '\n== DRY RUN (no writes) - pass --apply to persist ==');

  const templates = await Template.find({});
  let changed = 0;

  for (const template of templates) {
    const notes = [];
    for (const stage of template.stages || []) {
      for (const type of stage.assessmentTypes || []) {
        if (!LOG_FORM_KEYS.has(type.key) || type.noDecision === true) continue;
        type.noDecision = true;
        notes.push(`${stage.key}: "${type.name}" is now a log (no approval, no approvals-queue entry)`);
      }
    }
    if (!notes.length) {
      console.log(`- ${template.name}: already current`);
      continue;
    }
    changed += 1;
    console.log(`# ${template.name} [${template.code}]`);
    for (const n of notes) console.log(`    ${n}`);
    if (APPLY) {
      template.markModified('stages');
      await template.save();
    }
  }

  console.log(APPLY
    ? `\nDone - ${changed} template(s) updated.`
    : `\nNothing written. ${changed} template(s) would change. Re-run with --apply.`);
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
