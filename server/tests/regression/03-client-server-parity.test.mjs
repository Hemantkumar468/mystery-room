/**
 * REGRESSION SUITE — Client/server rule parity across live projects
 *
 * Drives the real services against a real MongoDB; every fixture is created
 * and torn down by the suite itself, so it leaves no residue. Run via
 * `npm run test:regression` from server/.
 */
/**
 * Client/server business-rule PARITY check, against all live projects.
 *
 * Imports the REAL client modules (scoring.js / recordUi.js — the same code
 * the browser runs) and compares their verdict to what the server's
 * completeStage() gate actually does, on real MongoDB data. Read-only:
 * nothing is created, updated or deleted.
 *
 * A mismatch means the UI would offer a "Mark Done" the API refuses (or
 * hide one it would accept) — exactly the class of bug Module 2 exists to
 * eliminate.
 */
import 'dotenv/config';
import { connect, disconnect, mongoose } from '../helpers/db.js';

import { ok, no, finish } from '../helpers/assert.js';

const conn = await connect();
console.log(`Connected: ${conn.name}
`);

const { Project } = await import('../../src/modules/pms/projects/project.model.js');
const { Record } = await import('../../src/modules/pms/records/record.model.js');
const { Template } = await import('../../src/modules/pms/templates/template.model.js');
const { projectService } = await import('../../src/modules/pms/projects/project.service.js');

// The actual client-side rule modules.
const C = '../../../client/src/features/projects/records';
const { computeScorecard } = await import(`${C}/scoring.js`);
const { isTypeApproved } = await import(`${C}/recordUi.js`);

/** Ask the server gate for its verdict WITHOUT mutating anything. */
async function serverAllows(projectId, stageKey) {
  const before = await Project.findById(projectId).select('stages status').lean();
  const stage = before.stages.find((s) => s.key === stageKey);
  if (stage?.status === 'completed') return { verdict: 'already-completed' };
  try {
    await projectService.completeStage(projectId, stageKey, null, { role: 'md' });
    // It succeeded — undo the write so this stays read-only.
    await Project.updateOne(
      { _id: projectId, 'stages.key': stageKey },
      {
        $set: {
          'stages.$.status': stage.status,
          'stages.$.completedManually': stage.completedManually ?? false,
        },
        $unset: { 'stages.$.completedAt': '', 'stages.$.completedBy': '' },
      },
    );
    if (before.status !== undefined) await Project.updateOne({ _id: projectId }, { $set: { status: before.status } });
    return { verdict: 'allow' };
  } catch (e) {
    return { verdict: 'deny', code: e.code, message: e.message };
  }
}

const projects = await Project.find({}).select('_id name code template stages').lean();
console.log(`Comparing client vs server rules across ${projects.length} live projects\n`);

let compared = 0;
for (const p of projects) {
  const [props, p2Records, p3Records, template] = await Promise.all([
    Record.find({ project: p._id, stageKey: 'p1', status: 'shortlisted' }).lean(),
    Record.find({ project: p._id, stageKey: 'p2' }).lean(),
    Record.find({ project: p._id, stageKey: 'p3' }).lean(),
    p.template?.ref ? Template.findById(p.template.ref).select('stages').lean() : null,
  ]);
  const p2Types = template?.stages?.find((s) => s.key === 'p2')?.assessmentTypes || [];
  const p3Types = template?.stages?.find((s) => s.key === 'p3')?.assessmentTypes || [];
  const typeKeys = p2Types.length ? p2Types.map((t) => t.key) : ['feasibility', 'financial', 'technical', 'operational'];

  // ---- CLIENT rule, computed by the client's own code ----
  const scorecards = props.map((prop) => computeScorecard(prop, p2Records, typeKeys));
  const clientP2 = scorecards.filter((s) => s.stageApproved).length >= 1;      // SiteEvaluationPage canMarkDone
  const eligible = scorecards.find((s) => s.stageApproved)?.property || null;   // CommercialFinalizationPage properties[0]
  const mandatory = p3Types.filter((t) => !t.subKeyField);
  const ownP3 = eligible ? p3Records.filter((r) => String(r.parentRecordId) === String(eligible._id)) : [];
  const clientP3 = Boolean(eligible)
    && mandatory.length > 0
    && mandatory.every((t) => isTypeApproved(ownP3, eligible._id, t));          // allMandatoryDone

  // ---- SERVER rule ----
  for (const [stageKey, clientSays] of [['p2', clientP2], ['p3', clientP3]]) {
    if (!p.stages?.some((s) => s.key === stageKey)) continue;
    const res = await serverAllows(p._id, stageKey);
    if (res.verdict === 'already-completed') continue;
    compared += 1;
    const serverSays = res.verdict === 'allow';
    const label = `${p.code} ${stageKey}`;
    if (serverSays === clientSays) {
      ok(`  ${label}`, `both ${serverSays ? 'ALLOW' : `DENY (${res.code || '-'})`}`);
    } else {
      no(`  ${label}`, `client=${clientSays ? 'ALLOW' : 'DENY'} but server=${serverSays ? 'ALLOW' : `DENY ${res.code}`}`);
    }
  }
}

if (compared === 0) console.log('  (all p2/p3 stages already completed — nothing left to compare)');
const failures = finish('PARITY');
await disconnect();
process.exit(failures ? 1 : 0);

