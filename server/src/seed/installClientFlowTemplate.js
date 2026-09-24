/* eslint-disable no-console */
/**
 * Install (or refresh) the 16-phase client-approved Branch Opening template
 * defined in clientFlowTemplate.js — the flow signed off in
 * docs/PMS_Functional_Flow_Document.docx.
 *
 * `npm run seed` also creates it, but seeding DESTROYS every user, project,
 * record and task in the database. This script adds the template to an
 * already-populated database and touches nothing else:
 *
 *   - No project, record, task, user or activity is read or written.
 *   - No OTHER template is modified. In particular the current default
 *     (storeLaunchTemplate, "MR-PMS-STORE-LAUNCH") keeps `isDefault` — this
 *     template is opt-in until its eight new phases are deep enough to lead
 *     with, so nothing about existing demos changes.
 *   - Live projects are unaffected either way: a project snapshots its
 *     template's stages at creation, so re-running this can never rewrite work
 *     already in flight.
 *
 * Idempotent: matched on the unique template `code`. First run inserts;
 * later runs overwrite the definition in place, which is how you pick up edits
 * to clientFlowTemplate.js as the new phases are fleshed out.
 *
 * SAFE BY DEFAULT: runs as a DRY RUN and writes nothing. Pass --apply to persist.
 *
 *   node src/seed/installClientFlowTemplate.js           # preview only
 *   node src/seed/installClientFlowTemplate.js --apply   # actually install
 */
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { Template } from '../modules/pms/templates/template.model.js';
import { User } from '../modules/auth/auth.model.js';
import { ROLES } from '../core/constants/index.js';
import { clientFlowTemplate } from './clientFlowTemplate.js';
import { storeLaunchTemplate } from './storeLaunchTemplate.js';

const APPLY = process.argv.includes('--apply');

/** Stage keys this template reuses from the 10-phase template, for the report. */
const REUSED = new Set(storeLaunchTemplate.stages.map((s) => s.key));

async function install() {
  const existing = await Template.findOne({ code: clientFlowTemplate.code });

  console.log(`\nTemplate: "${clientFlowTemplate.name}" [${clientFlowTemplate.code}]`);
  console.log(existing ? '  → already present, definition will be REFRESHED' : '  → not present, will be CREATED');

  const nTasks = clientFlowTemplate.stages.reduce((n, s) => n + (s.tasks?.length || 0), 0);
  console.log(`  ${clientFlowTemplate.stages.length} stages, ${nTasks} tasks\n`);

  for (const s of clientFlowTemplate.stages) {
    const origin = REUSED.has(s.key) ? 'reused' : 'new';
    /* The wiring, named in the preview. `branchOf` and `parallelGroup` are how
       the board knows a phase hangs off another rather than blocking it, and
       which pairs run side by side — and they are exactly what a template
       installed before those fields existed is missing. Printing them is how
       you can see, before writing anything, that this run carries them. */
    const wiring = [
      s.branchOf ? `branch of ${s.branchOf}` : '',
      s.parallelGroup ? `runs with ${s.parallelGroup}` : '',
    ].filter(Boolean).join(' · ');
    console.log(`   ${String(s.order).padStart(2)}  ${s.key.padEnd(4)} ${origin.padEnd(6)} ${s.name}`
      + (wiring ? `
        ${wiring}` : ''));
  }

  // Guard the one thing that would change existing behaviour: this template
  // must never take `isDefault` off the current default by accident.
  if (clientFlowTemplate.isDefault) {
    console.log('\n  ⚠  This template is marked isDefault — it will displace the current default.');
  } else {
    const current = await Template.findOne({ isDefault: true }).select('name code');
    console.log(`\n  Default template unchanged: "${current?.name ?? '(none)'}" [${current?.code ?? '—'}]`);
  }

  if (!APPLY) return existing ? 'refresh' : 'create';

  // `createdBy` is required on the model. Attribute to an MD if one exists,
  // otherwise to any user — this is a system install, not a user action, and
  // failing the whole run over attribution would be worse than approximating it.
  const owner = (await User.findOne({ role: ROLES.MD }).select('_id'))
    || (await User.findOne().select('_id'));
  if (!owner) throw new Error('No users in the database — run the seed first.');

  /* `isDefault` belongs to the DATABASE, not to this file. Whether this
     template is the default is an operator decision made in the running
     system; the file ships `isDefault: false` as a safe initial value. A
     refresh that pushed the file's value over the stored one silently removed
     the default flag — leaving NO default template, which breaks "Use the
     standard flow" on project creation. So on refresh the stored flag wins;
     the file's value applies only on first insert. */
  const { isDefault: fileDefault, ...definition } = clientFlowTemplate;
  await Template.findOneAndUpdate(
    { code: clientFlowTemplate.code },
    {
      ...definition,
      createdBy: owner._id,
      ...(existing ? {} : { isDefault: fileDefault }),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  return existing ? 'refreshed' : 'created';
}

async function main() {
  await connectDatabase();
  console.log(APPLY ? '\n== APPLYING ==' : '\n== DRY RUN (no writes) — pass --apply to persist ==');

  const outcome = await install();
  console.log(`\n${APPLY ? `Done — template ${outcome}.` : `Would ${outcome} the template.`}`);
  console.log('No projects, records, tasks or users were touched.');
}

main()
  .catch((err) => {
    console.error('✖ Install failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDatabase();
    await mongoose.connection.close().catch(() => {});
    process.exit(process.exitCode || 0);
  });
