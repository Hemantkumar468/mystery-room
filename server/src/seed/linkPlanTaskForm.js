/* eslint-disable no-console */
/**
 * Give Phase 4's project-plan task the form it is about.
 *
 * WHAT WAS WRONG. `p20_games` — "Fill the project plan: games, dates &
 * budget" — carried no `formKey` and no `appPath`, so the task page offered
 * a single button: Complete Task. The person was told to fill a plan, given
 * no way to reach it, and the only thing the screen let them do was tick the
 * box. Filing the plan afterwards did not close the task either, because
 * nothing joined the two.
 *
 * The plan is a real form — games, construction start, handover, testing,
 * target opening, setup cost, operating cost, manager — living on that
 * phase's own page. This points the task at it.
 *
 * Templates carry the `formKey` from here on (clientFlowTemplate.js) and new
 * projects derive the address at creation (project.service.js). This is for
 * the projects that already exist.
 *
 *   node src/seed/linkPlanTaskForm.js
 *   node src/seed/linkPlanTaskForm.js --apply
 */
import dns from 'node:dns';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();
dns.setServers(['8.8.8.8', '8.8.4.4']);

const APPLY = process.argv.includes('--apply');

/** stage -> [the task whose job is that phase's form, the formKey]. */
const SINGLE_FORM = {
  p20: ['p20_games', 'project_plan'],
  /* Filed once per vendor rather than once per project — the task keeps its
     own Complete button (see multiFill in TaskFocusCard) and is NOT closed
     on submit, but it still needs a way to reach the form. */
  p12: ['p12_finalise', 'vendor_panel'],
};

async function run() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 30_000 });
  const db = mongoose.connection.db;

  /* ── templates ─────────────────────────────────────────────────────── */
  let tplFixed = 0;
  for (const tpl of await db.collection('templates').find({}).toArray()) {
    let touched = false;
    for (const [stageKey, [taskKey, formKey]] of Object.entries(SINGLE_FORM)) {
      const stage = (tpl.stages || []).find((st) => st.key === stageKey);
      const task = (stage?.tasks || []).find((t) => t.key === taskKey);
      if (task && task.formKey !== formKey) { task.formKey = formKey; touched = true; tplFixed += 1; }
    }
    if (touched) {
      console.log(`  template ${String(tpl.name).slice(0, 36)}`);
      if (APPLY) await db.collection('templates').updateOne({ _id: tpl._id }, { $set: { stages: tpl.stages } });
    }
  }

  /* ── the tasks on live projects ────────────────────────────────────── */
  const keys = Object.values(SINGLE_FORM).map(([k]) => k);
  const tasks = await db.collection('tasks')
    .find({ templateTaskKey: { $in: keys } })
    .project({ code: 1, project: 1, stageKey: 1, templateTaskKey: 1, formKey: 1, appPath: 1 })
    .toArray();

  const fixes = [];
  for (const t of tasks) {
    const entry = SINGLE_FORM[t.stageKey];
    if (!entry) continue;
    const [, formKey] = entry;
    const wantPath = `/projects/${t.project}/phase/${t.stageKey}?task=${t.code}`;
    const set = {};
    if (t.formKey !== formKey) set.formKey = formKey;
    if (t.appPath !== wantPath) set.appPath = wantPath;
    if (Object.keys(set).length) fixes.push({ id: t._id, code: t.code, set });
  }

  console.log(`\n  templates: ${tplFixed} task(s) named`);
  console.log(`  projects:  ${fixes.length} of ${tasks.length} plan task(s) to link`);
  fixes.slice(0, 8).forEach((f) => console.log(`     ${f.code}`));
  if (fixes.length > 8) console.log(`     … and ${fixes.length - 8} more`);

  if (!APPLY) {
    console.log('\nREPORT ONLY — nothing was written. Re-run with --apply.\n');
    await mongoose.disconnect();
    return;
  }

  for (const f of fixes) {
    // eslint-disable-next-line no-await-in-loop
    await db.collection('tasks').updateOne({ _id: f.id }, { $set: f.set });
  }
  const left = await db.collection('tasks').countDocuments({
    templateTaskKey: { $in: keys },
    $or: [{ appPath: null }, { appPath: { $exists: false } }, { formKey: null }, { formKey: { $exists: false } }],
  });
  console.log(`\n  ${fixes.length} linked.`);
  console.log(left === 0
    ? 'Checked: every project-plan task opens its own form.'
    : `WARNING: ${left} plan task(s) still have no form or no link.`);

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
