/* eslint-disable no-console */
/**
 * Give the Purchase FMS one task per step, on the templates and on every
 * live project.
 *
 * WHAT WAS WRONG. The purchase pipeline has always DRAWN six steps — BOQ,
 * check, vendor, PO, tracking, GRN — but the template carried three tasks
 * for them: `p13_t1` for the BOQ, `p15_t1` for choosing the vendor AND
 * raising the PO AND chasing the delivery, and `p15_t3` for the GRN. There
 * was no task at all for checking the BOQ, which is the gate everything else
 * waits on.
 *
 * Three consequences, all of them things people reported as something else:
 *
 *   - Settings → FMS · Assign Work could not name a person per step, because
 *     three steps were one job. Assigning the vendor step also handed that
 *     person the chasing.
 *   - The sheet's "Assigned to" column showed the same name on three steps.
 *   - Approving the BOQ was nobody's task, so a finished BOQ sat unapproved
 *     with no row anywhere saying it was waiting.
 *
 * WHAT THIS WRITES. The three missing tasks (`p13_t2`, `p15_vendor`,
 * `p15_track`) onto each template's stage, then onto every project that has
 * that stage — dated, coded and assigned the same way the cascade would have
 * done on day one. It also stamps `formKey` and `appPath` on all six so each
 * one opens its own step from My Tasks.
 *
 * SAFE TO RE-RUN. A task that already exists is left exactly as it is —
 * nothing is reassigned, re-dated or reopened.
 *
 *   node src/seed/splitPurchaseTasks.js
 *   node src/seed/splitPurchaseTasks.js --apply
 */
import dns from 'node:dns';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();
dns.setServers(['8.8.8.8', '8.8.4.4']);

const APPLY = process.argv.includes('--apply');

/** step key on the pipeline, for the address a task opens. */
const STEP_OF = {
  p13_t1: 'all',
  p13_t2: 'check',
  p15_vendor: 'vendor',
  p15_t1: 'raise',
  p15_track: 'tracking',
  p15_t3: 'grn',
};

const FORM_OF = {
  p13_t1: 'boq-build',
  p13_t2: 'boq-check',
  p15_vendor: 'po-vendor',
  p15_t1: 'po-raise',
  p15_track: 'po-tracking',
  p15_t3: 'po-grn',
};

/** The three that did not exist, and where each belongs. */
const NEW_TASKS = [
  {
    key: 'p13_t2',
    stageKey: 'p13',
    title: 'Check the BOQs — approve or reject each one',
    department: 'projects',
    priority: 'critical',
    estimatedDays: 2,
    after: 'p13_t1',
  },
  {
    key: 'p15_vendor',
    stageKey: 'p15',
    title: 'Select the vendor for each approved BOQ',
    department: 'procurement',
    priority: 'critical',
    estimatedDays: 5,
    after: null, // first of the p15 chain
  },
  {
    key: 'p15_track',
    stageKey: 'p15',
    title: 'Track every order to the door',
    department: 'procurement',
    priority: 'high',
    estimatedDays: 45,
    after: 'p15_t1',
  },
];

const pathFor = (projectId, taskKey, code) => (STEP_OF[taskKey]
  ? `/purchase/orders?project=${projectId}&stage=${STEP_OF[taskKey]}&task=${code}`
  : undefined);

const addDays = (d, n) => new Date(new Date(d).getTime() + n * 86_400_000);

async function run() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 30_000 });
  const db = mongoose.connection.db;

  /* ── templates ─────────────────────────────────────────────────────── */
  let tplAdds = 0;
  const templates = await db.collection('templates').find({}).toArray();
  for (const tpl of templates) {
    let touched = false;
    for (const spec of NEW_TASKS) {
      const stage = (tpl.stages || []).find((st) => st.key === spec.stageKey);
      if (!stage) continue;
      if ((stage.tasks || []).some((t) => t.key === spec.key)) continue;
      const at = spec.after ? stage.tasks.findIndex((t) => t.key === spec.after) + 1 : 0;
      stage.tasks.splice(at, 0, {
        key: spec.key,
        title: spec.title,
        department: spec.department,
        estimatedDays: spec.estimatedDays,
        priority: spec.priority,
        formKey: FORM_OF[spec.key],
        checklist: [],
        approval: { required: false },
      });
      touched = true;
      tplAdds += 1;
      console.log(`  template ${String(tpl.name).slice(0, 32).padEnd(34)} + ${spec.key}`);
    }
    /* Every one of the six names its form, old and new alike. */
    for (const stage of (tpl.stages || [])) {
      for (const t of (stage.tasks || [])) {
        if (FORM_OF[t.key] && t.formKey !== FORM_OF[t.key]) { t.formKey = FORM_OF[t.key]; touched = true; }
      }
    }
    if (touched && APPLY) {
      await db.collection('templates').updateOne({ _id: tpl._id }, { $set: { stages: tpl.stages } });
    }
  }

  /* ── projects ──────────────────────────────────────────────────────── */
  const projects = await db.collection('projects').find({}).project({ code: 1, name: 1, stages: 1, createdBy: 1, tenant: 1 }).toArray();
  let taskAdds = 0;
  let pathFixes = 0;

  for (const project of projects) {
    const existing = await db.collection('tasks')
      .find({ project: project._id, templateTaskKey: { $in: Object.keys(STEP_OF) } })
      .project({ code: 1, templateTaskKey: 1, stageKey: 1, stageName: 1, tenant: 1, plannedStart: 1, plannedEnd: 1, appPath: 1, formKey: 1, assignee: 1, assigneeRefs: 1 })
      .toArray();
    const have = new Map(existing.map((t) => [t.templateTaskKey, t]));

    /* The highest -T number on this project, so new codes continue it. */
    const codes = await db.collection('tasks').find({ project: project._id }).project({ code: 1 }).toArray();
    let lastNo = codes.reduce((m, t) => Math.max(m, Number(String(t.code || '').split('-T').pop()) || 0), 0);

    for (const spec of NEW_TASKS) {
      if (have.has(spec.key)) continue;
      /* Dated and owned off the task it follows, so a new step lands in the
         same week as the work around it rather than today. A stage with no
         sibling task at all is skipped — that project does not run this
         phase. */
      const sibling = have.get(spec.after) || [...have.values()].find((t) => t.stageKey === spec.stageKey);
      if (!sibling) continue;
      lastNo += 1;
      const code = `${project.code}-T${String(lastNo).padStart(3, '0')}`;
      const plannedStart = sibling.plannedEnd || sibling.plannedStart || new Date();
      const doc = {
        /* THE TENANT, OR THE TASK DOES NOT EXIST. This is a raw insert, so
           nothing stamps it — and every read in the app is tenant-scoped, so
           the first run wrote 90 tasks that no page could see: not on My
           Tasks, and "not found" when opened by link. */
        tenant: project.tenant ?? sibling.tenant,
        project: project._id,
        code,
        templateTaskKey: spec.key,
        stageKey: spec.stageKey,
        stageName: sibling.stageName,
        approval: false,
        title: spec.title,
        department: spec.department,
        priority: spec.priority,
        status: 'pending',
        approvalState: 'none',
        formKey: FORM_OF[spec.key],
        appPath: pathFor(project._id, spec.key, code),
        plannedStart,
        plannedEnd: addDays(plannedStart, spec.estimatedDays),
        /* The sibling's doer, not nobody: these steps were part of that
           person's job until this split, so leaving them ownerless would
           silently drop work the team believes is assigned. Re-point them
           afterwards on Settings → FMS · Assign Work. */
        assignee: sibling.assignee ?? null,
        assigneeRefs: sibling.assigneeRefs?.length ? sibling.assigneeRefs : (sibling.assignee ? [sibling.assignee] : []),
        checklist: [],
        createdBy: project.createdBy ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      taskAdds += 1;
      console.log(`  ${project.code.padEnd(14)} + ${code} ${spec.key}`);
      if (APPLY) await db.collection('tasks').insertOne(doc);
    }

    /* And every existing one gets its form and its address. */
    for (const t of existing) {
      const wantForm = FORM_OF[t.templateTaskKey];
      const wantPath = pathFor(project._id, t.templateTaskKey, t.code);
      const set = {};
      if (wantForm && t.formKey !== wantForm) set.formKey = wantForm;
      if (wantPath && t.appPath !== wantPath) set.appPath = wantPath;
      if (Object.keys(set).length) {
        pathFixes += 1;
        if (APPLY) await db.collection('tasks').updateOne({ _id: t._id }, { $set: set });
      }
    }
  }

  console.log(`\n  templates:   ${tplAdds} task(s) added`);
  console.log(`  projects:    ${taskAdds} task(s) added, ${pathFixes} linked to their step`);

  if (!APPLY) {
    console.log('\nREPORT ONLY — nothing was written. Re-run with --apply.\n');
    await mongoose.disconnect();
    return;
  }

  const left = await db.collection('tasks').countDocuments({
    templateTaskKey: { $in: Object.keys(STEP_OF) },
    $or: [{ appPath: null }, { appPath: { $exists: false } }, { formKey: null }, { formKey: { $exists: false } }],
  });
  console.log(left === 0
    ? '\nChecked: every purchase task names its form and opens its own step.'
    : `\nWARNING: ${left} purchase task(s) still have no form or no link.`);

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
