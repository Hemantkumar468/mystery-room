/**
 * Put the real people (realRoster.js) on every task of the live templates, so
 * a new project hands the work straight to them.
 *
 * A project copies its template's tasks at creation and resolves each named
 * person to their account (project.service.js#cascadeTasksFromTemplate), so
 * changing the template is what changes who gets the work — for every project
 * created from now on.
 *
 * On each task it sets:
 *   assignees          every doer. The task lands in ALL their My Tasks, and
 *                      the first to complete it closes it for the rest.
 *   backupAssignees    the buddies — they watch it and can pick it up.
 *   primaryAssignee    the first doer (the single-owner field older code reads)
 *   backupAssignee     the first buddy
 *
 * The last two matter more than they look: the cascade builds its doer list
 * from `assignees` PLUS `primaryAssignee`, so leaving the old demo roster id
 * behind there would quietly make a demo employee a doer alongside the real
 * people. They are always overwritten together.
 *
 * SAFE BY DEFAULT: dry run, prints who gets what, writes nothing.
 *
 *   node src/seed/assignRealPeople.js                          # the plan
 *   node src/seed/assignRealPeople.js --apply                  # persist
 *   node src/seed/assignRealPeople.js --apply --template MR-PMS-CLIENT-FLOW
 */
import mongoose from 'mongoose';
import { config } from '../config/index.js';
import { Template } from '../modules/pms/templates/template.model.js';
import { User } from '../modules/auth/auth.model.js';
import { assignmentFor } from './realRoster.js';

const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const APPLY = process.argv.includes('--apply');
const ONLY = arg('--template');

async function main() {
  await mongoose.connect(config.db.uri);
  console.log(APPLY ? '\n== APPLYING ==' : '\n== DRY RUN (no writes) - pass --apply to persist ==');

  // Every real person, so the plan can print names and flag anyone missing.
  const users = await User.find({ employeeId: /^MR-/ }, 'name employeeId role title').lean();
  const nameOf = new Map(users.map((u) => [u.employeeId, u.name]));
  console.log(`${users.length} real accounts available (MR-*)\n`);

  const templates = await Template.find(ONLY ? { code: ONLY } : {});
  if (!templates.length) throw new Error(ONLY ? `No template ${ONLY}` : 'No templates');

  const missing = new Set();
  let totalTasks = 0;
  let totalAssigned = 0;

  for (const template of templates) {
    console.log(`\n# ${template.name} [${template.code}]`);
    let changed = 0;

    for (const stage of [...(template.stages || [])].sort((x, y) => (x.order ?? 0) - (y.order ?? 0))) {
      const lines = [];
      for (const task of [...(stage.tasks || [])].sort((x, y) => (x.order ?? 0) - (y.order ?? 0))) {
        totalTasks += 1;
        const plan = assignmentFor(task.key, task.department || stage.ownerDepartment);
        if (!plan) { lines.push(`   ${task.key.padEnd(16)} ${task.title.slice(0, 44).padEnd(44)} -- NO RULE, left as is`); continue; }

        for (const id of [...plan.doers, ...plan.buddies]) if (!nameOf.has(id)) missing.add(id);

        const show = (ids) => ids.map((id) => nameOf.get(id) || `${id}?`).join(', ') || '-';
        lines.push(`   ${task.key.padEnd(16)} ${task.title.slice(0, 44).padEnd(44)} ${show(plan.doers)}${plan.buddies.length ? `   (cover: ${show(plan.buddies)})` : ''}`);
        totalAssigned += 1;

        if (APPLY) {
          task.assignees = [...plan.doers];
          task.backupAssignees = [...plan.buddies];
          // Overwritten together — see the note at the top of this file.
          task.primaryAssignee = plan.doers[0] || null;
          task.backupAssignee = plan.buddies[0] || null;
          changed += 1;
        }
      }
      if (lines.length) {
        console.log(`\n  ${stage.key}  ${stage.name}`);
        for (const l of lines) console.log(l);
      }
    }

    if (APPLY && changed) {
      template.markModified('stages');
      await template.save();
      console.log(`\n  -> saved: ${changed} task(s) assigned`);
    }
  }

  if (missing.size) {
    console.log(`\n!! No account for: ${[...missing].join(', ')} — run createRealUsers.js --apply first.`);
  }
  console.log(`\n${totalAssigned} of ${totalTasks} tasks have a named owner.`);
  console.log(APPLY
    ? 'Done. Projects created from now on go straight to these people.'
    : 'Nothing written. Re-run with --apply.');
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
