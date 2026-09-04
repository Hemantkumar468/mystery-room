/**
 * REGRESSION SUITE — Client/server rule parity across live projects.
 *
 * WHAT THIS USED TO CHECK, and why it changed. It compared the client's
 * "can I press Mark Done" rule against the server's completeStage() gate, on
 * real data, because a UI that offers a button the API refuses is worse than
 * no button. Both sides of that comparison are gone: rule 4 removed the gates
 * and the Mark Done affordance with them.
 *
 * WHAT IT CHECKS NOW is the parity that replaced it, and it is the same kind
 * of risk. Phase progress is computed in TWO places on purpose — the server
 * for every consumer, the client so the tree can recolour a phase in the same
 * frame as the click, without waiting for a round trip. Two implementations of
 * one rule is exactly how a screen starts disagreeing with its own data, and
 * nothing would raise an error when it did: the phase would simply be the
 * wrong colour, and the number beside it would be right.
 *
 * So: the REAL client module and the REAL server module are both imported, run
 * over every live project's every phase, and required to agree. Read-only —
 * nothing is created, updated or deleted.
 */
import 'dotenv/config';
import { connect, disconnect } from '../helpers/db.js';
import { ok, no, finish } from '../helpers/assert.js';

const conn = await connect();
console.log(`Connected: ${conn.name}\n`);

const { Project } = await import('../../src/modules/pms/projects/project.model.js');
const { Task } = await import('../../src/modules/pms/tasks/task.model.js');

/* The server's implementation… */
const { phaseProgress: serverProgress } = await import('../../src/modules/pms/projects/phaseProgress.js');
/* …and the one the browser actually runs. */
const { phaseProgress: clientProgress } = await import('../../../client/src/features/projects/phaseProgress.js');

const projects = await Project.find({}).select('_id name code stages').lean();
console.log(`${projects.length} live project(s)\n`);

let compared = 0;
let mismatches = 0;

for (const p of projects) {
  const tasks = await Task.find({ project: p._id }).select('status stageKey').lean();
  for (const stage of p.stages || []) {
    const own = tasks.filter((t) => t.stageKey === stage.key);
    const s = serverProgress(own);
    const c = clientProgress(own);
    compared += 1;
    if (s !== c) {
      mismatches += 1;
      no(`  ${p.code} ${stage.key}`, `server=${s} but client=${c} over ${own.length} task(s)`);
    }
  }
}

if (!mismatches) {
  ok('  every phase of every project agrees', `${compared} phase(s) compared`);
}

/* The edge cases the two implementations are most likely to drift on — asserted
   directly rather than hoping live data happens to contain them. */
console.log('\n── The cases live data may not cover ──');
const CASES = [
  ['no tasks at all', []],
  ['one pending', [{ status: 'pending' }]],
  ['one processing', [{ status: 'processing' }]],
  ['one complete', [{ status: 'complete' }]],
  ['complete + pending', [{ status: 'complete' }, { status: 'pending' }]],
  ['complete + processing', [{ status: 'complete' }, { status: 'processing' }]],
  ['all complete', [{ status: 'complete' }, { status: 'complete' }]],
  ['an unknown legacy value', [{ status: 'todo' }]],
  ['a missing status', [{}]],
];
for (const [label, tasks] of CASES) {
  const s = serverProgress(tasks);
  const c = clientProgress(tasks);
  (s === c ? ok : no)(`  ${label}`, s === c ? s : `server=${s} client=${c}`);
}

await disconnect();
process.exit(finish('PARITY'));
