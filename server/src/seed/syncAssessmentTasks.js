/**
 * Give every shortlisted property its own Phase 2 assessment tasks — for the
 * projects that already exist.
 *
 * New shortlists do this by themselves (record.service decide/undoDecision →
 * projectService.syncAssessmentTasks). Projects shortlisted before that change
 * still have one "Do the Feasibility assessment" task for all their properties;
 * this brings them in line with the same function.
 *
 * Preview by default — nothing is written without --apply:
 *   node src/seed/syncAssessmentTasks.js                      # every project, plan only
 *   node src/seed/syncAssessmentTasks.js --project=MR-AGR-002 # one project
 *   node src/seed/syncAssessmentTasks.js --apply              # write
 */
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { Project } from '../modules/pms/projects/project.model.js';
import { projectService } from '../modules/pms/projects/project.service.js';

const apply = process.argv.includes('--apply');
const only = process.argv.find((a) => a.startsWith('--project='))?.split('=')[1];

await connectDatabase();
try {
  const projects = await Project.find(only ? { code: only } : { status: { $ne: 'archived' } })
    .select('_id code name')
    .sort({ code: 1 });

  let touched = 0;
  const totals = { create: 0, attach: 0, rename: 0, remove: 0, detach: 0 };
  for (const p of projects) {
    const plan = await projectService.syncAssessmentTasks(p._id, { apply });
    const lines = Object.keys(totals).flatMap((k) => plan[k].map((l) => `    ${k.padEnd(6)} ${l}`));
    Object.keys(totals).forEach((k) => { totals[k] += plan[k].length; });
    if (!lines.length) continue;
    touched += 1;
    console.log(`\n${p.code} — ${p.name}`);
    lines.forEach((l) => console.log(l));
  }
  console.log(`\n${apply ? 'APPLIED' : 'PREVIEW (nothing written — add --apply)'}: ${touched} project(s) change; `
    + Object.entries(totals).map(([k, n]) => `${k} ${n}`).join(', '));
} finally {
  await disconnectDatabase();
}
