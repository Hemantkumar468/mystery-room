/* eslint-disable no-console */
/**
 * Give Phase 3's closure tasks the form they are actually about.
 *
 * WHAT WAS WRONG. Phase 2's four assessment tasks each carry a `formKey` and
 * an `appPath`, so a doer opens their task, presses one button, fills the
 * form, and submitting it closes the task. Phase 3's six closure documents —
 * LOI, lease, legal check, deposit, NOCs, approvals — carry neither. The
 * pairing between "Issue Letter of Intent (LOI)" and the `loi` form was
 * obvious to anybody reading the screen and invisible to the code, so for the
 * whole of commercial closure:
 *
 *   - the task page had no button, because it is built from `appPath`;
 *   - filing the LOI left its task open, because `completeTaskForForm` joins
 *     on `formKey` and there was nothing to join to;
 *   - and the fix people found was to go back and tick the task by hand.
 *
 * The template now names the form on each task (storeLaunchTemplate.js), and
 * `buildTaskDoc` derives the address from it, so every project created from
 * here on is correct. This is for the ones that already exist.
 *
 * REPORT FIRST. Nothing is written without `--apply`.
 *
 *   node src/seed/linkCommercialTaskForms.js
 *   node src/seed/linkCommercialTaskForms.js --apply
 */
import dns from 'node:dns';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();
/* Atlas over SRV, and this network's resolver refuses `_mongodb._tcp` — the
   same two lines every other seed script carries. */
dns.setServers(['8.8.8.8', '8.8.4.4']);

const APPLY = process.argv.includes('--apply');

/**
 * Which template task is which form.
 *
 * Keyed on `templateTaskKey`, not on the title: titles are edited (they are
 * shown to people), keys are not. Both shipped templates use these five keys
 * for Phase 3 — see storeLaunchTemplate.js, which clientFlowTemplate.js
 * reuses wholesale.
 *
 * `approvals` has no task of its own in either template. That is not an
 * omission to patch here: inventing a task nobody planned would put a job on
 * somebody's desk that the business never asked for.
 */
const FORM_BY_TASK_KEY = {
  p3_t1: 'loi',
  p3_t2: 'lease',
  p3_t3: 'legal',
  p3_t4: 'deposit',
  p3_t5: 'nocs',
};

/* `task` as well as `form`: the form page's "Back to my task" button is built
   from the code, and without it a doer who has just filed an LOI is left on a
   phase page with no way back to the job that sent them there. */
const pathFor = (projectId, formKey, code) => `/projects/${projectId}/commercial-finalization?form=${formKey}&task=${code}`;

async function run() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 30_000 });
  const db = mongoose.connection.db;

  /* ── the templates ─────────────────────────────────────────────────── */
  const templates = await db.collection('templates').find({}).project({ name: 1, stages: 1 }).toArray();
  const templateFixes = [];
  for (const tpl of templates) {
    const p3 = (tpl.stages || []).find((s) => s.key === 'p3');
    if (!p3) continue;
    for (const [i, task] of (p3.tasks || []).entries()) {
      const want = FORM_BY_TASK_KEY[task.key];
      if (!want || task.formKey === want) continue;
      templateFixes.push({ tplId: tpl._id, tplName: tpl.name, stageKey: 'p3', taskIdx: i, key: task.key, want });
    }
  }

  /* ── the tasks already on projects ─────────────────────────────────── */
  const tasks = await db.collection('tasks')
    .find({ stageKey: 'p3', templateTaskKey: { $in: Object.keys(FORM_BY_TASK_KEY) } })
    .project({ code: 1, title: 1, project: 1, templateTaskKey: 1, formKey: 1, appPath: 1 })
    .toArray();

  const taskFixes = [];
  for (const t of tasks) {
    const want = FORM_BY_TASK_KEY[t.templateTaskKey];
    if (!want) continue;
    const wantPath = pathFor(t.project, want, t.code);
    const set = {};
    if (t.formKey !== want) set.formKey = want;
    if (t.appPath !== wantPath) set.appPath = wantPath;
    if (Object.keys(set).length) taskFixes.push({ id: t._id, code: t.code, title: t.title, set });
  }

  console.log(`\nTEMPLATES        ${templateFixes.length} Phase 3 task(s) to name`);
  for (const f of templateFixes.slice(0, 12)) {
    console.log(`  ${String(f.tplName).slice(0, 34).padEnd(36)} ${f.key.padEnd(8)} -> ${f.want}`);
  }

  console.log(`\nTASKS            ${taskFixes.length} of ${tasks.length} Phase 3 task(s) to link`);
  for (const f of taskFixes.slice(0, 10)) {
    console.log(`  ${String(f.code).padEnd(18)} ${String(f.title).slice(0, 38).padEnd(40)} ${JSON.stringify(f.set.formKey ?? '')}`);
  }
  if (taskFixes.length > 10) console.log(`  … and ${taskFixes.length - 10} more`);

  if (!APPLY) {
    console.log('\nREPORT ONLY — nothing was written. Re-run with --apply.\n');
    await mongoose.disconnect();
    return;
  }

  console.log('\nWriting…');
  for (const f of templateFixes) {
    // eslint-disable-next-line no-await-in-loop
    await db.collection('templates').updateOne(
      { _id: f.tplId, 'stages.key': f.stageKey },
      { $set: { [`stages.$.tasks.${f.taskIdx}.formKey`]: f.want } },
    );
  }
  console.log(`  templates   ${templateFixes.length} task(s) named`);

  let n = 0;
  for (const f of taskFixes) {
    // eslint-disable-next-line no-await-in-loop
    const res = await db.collection('tasks').updateOne({ _id: f.id }, { $set: f.set });
    n += res.modifiedCount;
  }
  console.log(`  tasks       ${n} linked`);

  /* Said out loud rather than assumed — the only moment anybody is looking
     at this is right now. */
  const left = await db.collection('tasks').countDocuments({
    stageKey: 'p3',
    templateTaskKey: { $in: Object.keys(FORM_BY_TASK_KEY) },
    $or: [{ formKey: null }, { formKey: { $exists: false } }, { appPath: null }, { appPath: { $exists: false } }],
  });
  console.log(left === 0
    ? '\nChecked: every Phase 3 task now knows its form.'
    : `\nWARNING: ${left} Phase 3 task(s) still have no form link.`);

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
