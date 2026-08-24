/**
 * Add the Daily Site Report to every published template's Site Execution
 * (p6) stage — the form (an assessmentType) and the Site Supervisor's task
 * that opens it.
 *
 * Needed because a project's forms come from the Template DOCUMENT, which was
 * copied from the seed when first published; editing the seed alone changes
 * only what a fresh database gets. Non-destructive and idempotent: it adds
 * what is missing and touches nothing else, so a template someone has since
 * customised keeps every other edit. Dry run by default.
 *
 *   node src/seed/migrateDailySiteReport.js            # report only
 *   node src/seed/migrateDailySiteReport.js --apply    # persist
 *
 * Scope note, stated plainly: the TASK is added to the template, so every
 * project created from now on gets it. Projects that already exist keep the
 * task list they were created with — their supervisors can still file reports
 * from the Execution page's "Daily Reports" tab, they just have no task in My
 * Tasks pointing there. Back-filling tasks into live projects is a separate,
 * deliberate operation.
 */
import mongoose from 'mongoose';
import { connectDatabase } from '../config/database.js';
import { Template } from '../modules/pms/templates/template.model.js';
import { DAILY_SITE_REPORT_TYPE, DAILY_SITE_REPORT_TASK, DAILY_SITE_REPORT_KEY } from './dailySiteReport.js';

const STAGE_KEY = 'p6';
const APPLY = process.argv.includes('--apply');

async function run() {
  await connectDatabase();

  const templates = await Template.find({ 'stages.key': STAGE_KEY });
  if (!templates.length) {
    console.log(`No template has a "${STAGE_KEY}" stage — nothing to do.`);
    return;
  }

  let changed = 0;
  for (const template of templates) {
    const stage = template.stages.find((s) => s.key === STAGE_KEY);
    const notes = [];

    stage.assessmentTypes = stage.assessmentTypes || [];
    if (!stage.assessmentTypes.some((a) => a.key === DAILY_SITE_REPORT_KEY)) {
      stage.assessmentTypes.push(JSON.parse(JSON.stringify(DAILY_SITE_REPORT_TYPE)));
      notes.push(`p6: "${DAILY_SITE_REPORT_TYPE.name}" form added (${DAILY_SITE_REPORT_TYPE.masterDataSchema.length} fields)`);
    }

    stage.tasks = stage.tasks || [];
    if (!stage.tasks.some((x) => x.key === DAILY_SITE_REPORT_TASK.key)) {
      const maxOrder = stage.tasks.reduce((m, x) => Math.max(m, x.order ?? 0), -1);
      stage.tasks.push({ ...JSON.parse(JSON.stringify(DAILY_SITE_REPORT_TASK)), order: maxOrder + 1 });
      notes.push(`p6: task "${DAILY_SITE_REPORT_TASK.title}" added (Site Supervisor, opens the form)`);
    }

    if (!notes.length) {
      console.log(`· ${template.name} — already current`);
      continue;
    }

    console.log(`${APPLY ? '✔' : '·'} ${template.name}`);
    notes.forEach((n) => console.log(`    ${n}`));

    if (APPLY) {
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
