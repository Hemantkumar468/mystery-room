/* eslint-disable no-console */
/**
 * One-time repair: a template task must not name the same person as a doer
 * AND as their own buddy.
 *
 * THE SYMPTOM, and why it is worth a migration. The template builder refuses
 * to save while any task has this ("The same person cannot be both a doer and
 * a buddy"), and MR-PMS-CLIENT-FLOW has it on 40 of its 56 tasks. The result
 * is a template that CANNOT BE EDITED AT ALL: open it to change one SLA day
 * and the Save button reports forty errors in tasks you never touched. Nobody
 * would guess that from the message.
 *
 * WHY IT IS SAFE TO JUST REMOVE THE BUDDY. In every one of the 40 cases the
 * clashing person is already in `assignees`, and in every one their buddy
 * entry is the ONLY buddy. So the buddy slot is not covering anything — a
 * backup who is the person they are backing up is not a backup. Removing it
 * changes who does the work by exactly nothing, and it unblocks the builder.
 *
 * The same guard already exists on the TASK path (backfillTaskAssignees.js
 * filters buddies that are also doers); templates never got it. This fixes the
 * data; assignRealPeople.js now carries the guard so a re-run cannot put it
 * back.
 *
 * SAFE BY DEFAULT: runs as a DRY RUN and writes nothing. Pass --apply.
 *
 *   node src/seed/migrateTemplateBuddyClash.js                      # preview
 *   node src/seed/migrateTemplateBuddyClash.js --apply              # persist
 *   node src/seed/migrateTemplateBuddyClash.js --apply --template MR-PMS-CLIENT-FLOW
 *
 * Touches only `backupAssignees` / `backupAssignee` on affected tasks. No
 * doer, no field, no stage and no other template data is modified.
 */
/* connectDatabase, not a bare mongoose.connect: it sets the public DNS
   resolvers, without which mongodb+srv:// dies at querySrv ECONNREFUSED on
   any network that blocks outbound port 53 — which reads as "the migration
   is broken" rather than "this machine cannot look up an SRV record". */
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { Template } from '../modules/pms/templates/template.model.js';

const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const APPLY = process.argv.includes('--apply');
const ONLY = arg('--template');

/** The doers of a task, old single field folded in — same shape the builder reads. */
const doersOf = (t) => [...new Set([...(t.assignees || []), t.primaryAssignee].filter(Boolean))].map(String);
const buddiesOf = (t) => [...new Set([...(t.backupAssignees || []), t.backupAssignee].filter(Boolean))].map(String);

async function main() {
  await connectDatabase();
  console.log(APPLY ? '\n== APPLYING ==' : '\n== DRY RUN (no writes) — pass --apply to persist ==');

  const templates = await Template.find(ONLY ? { code: ONLY } : {});
  if (!templates.length) throw new Error(ONLY ? `No template ${ONLY}` : 'No templates');

  let totalTasks = 0;
  let totalFixed = 0;

  for (const template of templates) {
    let changed = 0;
    const lines = [];

    for (const stage of template.stages || []) {
      for (const task of stage.tasks || []) {
        totalTasks += 1;
        const doers = doersOf(task);
        const buddies = buddiesOf(task);
        const clash = buddies.filter((b) => doers.includes(b));
        if (!clash.length) continue;

        const kept = buddies.filter((b) => !doers.includes(b));
        lines.push(
          `   ${stage.key}/${String(task.key).padEnd(18)} drop ${clash.join(', ')}`
          + `${kept.length ? `  (keeps ${kept.join(', ')})` : '  (no buddy left)'}`,
        );

        if (APPLY) {
          task.backupAssignees = kept;
          /* The legacy single field is rewritten from the same list, not left
             pointing at the id just removed — the two are read together and a
             half-cleaned task is worse than an uncleaned one. */
          task.backupAssignee = kept[0] || null;
        }
        changed += 1;
      }
    }

    if (!changed) {
      console.log(`\n# ${template.name} [${template.code}] — nothing to fix`);
      continue;
    }

    console.log(`\n# ${template.name} [${template.code}] — ${changed} task(s)`);
    for (const l of lines) console.log(l);
    totalFixed += changed;

    if (APPLY) {
      // Nested arrays inside an array of subdocuments: Mongoose does not see
      // these writes without being told.
      template.markModified('stages');
      await template.save();
      console.log(`   -> saved`);
    }
  }

  console.log(`\n${totalFixed} of ${totalTasks} task(s) had a buddy who was already a doer.`);
  console.log(APPLY
    ? 'Done. Those templates can be opened and saved in the builder again.'
    : 'Nothing written. Re-run with --apply.');
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => disconnectDatabase());
