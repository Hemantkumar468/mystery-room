/* eslint-disable no-console */
/**
 * One-time backfill: copy the APPROVED Project Setup (Phase 4) master form
 * onto its Project document.
 *
 * Phase 4 used to complete the moment its form was *submitted* — a
 * client-side useEffect fired completeStage() with no manager approval
 * involved (see ProjectCreationPage.jsx history). Two consequences for
 * projects created before that was fixed:
 *
 *   1. The budget / target opening date / project manager / configuration
 *      captured in the form were never written onto the Project document —
 *      completeStage had no p4 branch to copy them across.
 *   2. Some projects reached "p4 completed" with a form that was never
 *      approved at all — or with no p4 record whatsoever.
 *
 * This script fixes (1) ONLY, and only from genuinely APPROVED records. It
 * deliberately refuses to backfill from a submitted-but-unapproved form:
 * trusting unapproved figures is the exact bug this phase's gate now
 * prevents, and silently importing them would launder bad data into the
 * project. Those projects are reported instead, for a human to decide
 * (get the form approved, or reopen p4 and run it through properly).
 *
 * DRY RUN BY DEFAULT — prints what it would change and writes nothing.
 *
 *   node src/seed/backfillProjectSetup.js            # dry run
 *   node src/seed/backfillProjectSetup.js --apply    # actually write
 */
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { Project } from '../modules/pms/projects/project.model.js';
import { Record } from '../modules/pms/records/record.model.js';
import { User } from '../modules/auth/auth.model.js';
import { RECORD_STATUS, STAGE_STATUS } from '../core/constants/index.js';

const APPLY = process.argv.includes('--apply');
const P4_MASTER_KEY = 'project_creation';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const date = (v) => {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

async function run() {
  const projects = await Project.find({}).select('code name stages budget targetEndDate plannedStartDate owner masterData');
  const completed = projects.filter(
    (p) => p.stages.find((s) => s.key === 'p4')?.status === STAGE_STATUS.COMPLETED,
  );
  console.log(`${projects.length} project(s); ${completed.length} with Phase 4 completed.\n`);

  const skipped = [];
  let changed = 0;

  for (const project of completed) {
    if (project.masterData?.p4) {
      console.log(`  ${project.code}: already has masterData.p4 — skipping.`);
      continue;
    }
    const approved = await Record.findOne({
      project: project._id,
      stageKey: 'p4',
      assessmentType: P4_MASTER_KEY,
      status: RECORD_STATUS.APPROVED,
    }).sort({ createdAt: -1 });

    if (!approved) {
      const any = await Record.countDocuments({ project: project._id, stageKey: 'p4', assessmentType: P4_MASTER_KEY });
      skipped.push({ code: project.code, reason: any ? 'p4 form exists but was never approved' : 'no p4 form on record at all' });
      continue;
    }

    const v = approved.values || {};
    const before = {
      budget: project.budget?.planned,
      currency: project.budget?.currency,
      targetEndDate: project.targetEndDate,
      owner: project.owner,
    };

    const planned = num(v.estimated_budget);
    if (planned !== undefined) project.budget.planned = planned;
    if (v.currency) project.budget.currency = v.currency;
    const opening = date(v.target_opening_date);
    if (opening) project.targetEndDate = opening;
    const start = date(v.project_start_date);
    if (start) project.plannedStartDate = start;

    const pmName = String(v.project_manager || '').trim();
    if (pmName) {
      const pm = await User.findOne({
        name: new RegExp(`^${pmName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
      }).select('_id name');
      if (pm) project.owner = pm._id;
      else console.log(`  ${project.code}: project manager "${pmName}" matches no user account — leaving owner unchanged.`);
    }

    project.masterData = { ...(project.masterData || {}), p4: { ...v } };
    project.markModified('masterData');

    console.log(`  ${project.code}:`);
    console.log(`      budget   ${before.budget} -> ${project.budget.planned} ${project.budget.currency}`);
    console.log(`      opening  ${before.targetEndDate ? new Date(before.targetEndDate).toISOString().slice(0, 10) : '—'} -> ${project.targetEndDate ? new Date(project.targetEndDate).toISOString().slice(0, 10) : '—'}`);
    console.log(`      owner    ${before.owner || '—'} -> ${project.owner || '—'}`);
    console.log(`      config   ${Object.keys(v).length} field(s) stored in masterData.p4`);

    if (APPLY) await project.save();
    changed += 1;
  }

  console.log(`\n${APPLY ? 'Updated' : 'Would update'} ${changed} project(s).`);

  if (skipped.length) {
    console.log(`\n${skipped.length} project(s) NOT backfilled — these completed Phase 4 without a real approval,`);
    console.log('so there are no approved figures to copy. Decide per project: get the Project Setup');
    console.log('approved, or reopen Phase 4 and run it through the (now gated) flow.');
    for (const s of skipped) console.log(`  - ${s.code}: ${s.reason}`);
  }

  if (!APPLY) console.log('\nDRY RUN — nothing was written. Re-run with --apply to commit.');
}

connectDatabase()
  .then(run)
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(disconnectDatabase);
