/**
 * REGRESSION SUITE — Step 4's approve takes the road the MD actually ticked.
 *
 * THE BUG. The approve dialog asks the MD to tick commercial closure, project
 * creation, or both. It then sent the server `{ decision: 'shortlist' }` and
 * nothing else: the tick was read only to decide which page the browser would
 * land on. So a site approved for games and dates was written to the database
 * exactly like one approved for paperwork alone, the router carried the reader
 * to the planning queue, and the property was not on it — because nothing had
 * happened that would put it there.
 *
 * It is the worst shape a bug can take: the screen agreed with the decision
 * and the data did not, and the only way to notice was to go back a day later
 * and find the site missing from the step it had been sent to.
 *
 * WHAT MAKES THE TWO ROADS DIFFERENT is one fact, and it is the same fact
 * Step 2's own project road already used: the p1 record is APPROVED. An
 * approved property reads as past closure, which is what stands it in front of
 * Project & Games. Both roads open the six closure documents — choosing
 * project creation has never meant skipping the lease, only not waiting for
 * it — so this suite asserts the documents on BOTH, and the approval on one.
 */
import 'dotenv/config';
import { connect, disconnect } from '../helpers/db.js';
import { ok, no, finish } from '../helpers/assert.js';

const conn = await connect();
console.log(`Connected: ${conn.name}\n`);

const B = '../../src/modules/pms';
const { propertyCaptureService } = await import(`${B}/propertyCapture/propertyCapture.service.js`);
const { Project } = await import(`${B}/projects/project.model.js`);
const { Record } = await import(`${B}/records/record.model.js`);
const { Task } = await import(`${B}/tasks/task.model.js`);
const { Template } = await import(`${B}/templates/template.model.js`);
const { User } = await import('../../src/modules/auth/auth.model.js');
const { RECORD_STATUS } = await import('../../src/core/constants/index.js');

const is = (name, actual, expected) => (
  actual === expected ? ok(name) : no(name, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`)
);
const atLeast = (name, actual, min) => (
  actual >= min ? ok(name, `${actual}`) : no(name, `got ${actual}, expected at least ${min}`)
);

const tag = `ZZRD-${Date.now()}`;
const bin = { projects: [], templates: [], records: [] };
const admin = await User.findOne({ role: 'md' }).select('_id');

const tpl = await Template.create({
  name: `${tag}_TPL`, code: `${tag}-T`, status: 'published', version: 1,
  stages: [
    { key: 'p1', name: 'Property capture', order: 1, captureMode: 'collection' },
    {
      key: 'p2', name: 'Site evaluation', order: 2, captureMode: 'collection',
      assessmentTypes: [{ key: 'feasibility', name: 'Feasibility', masterDataSchema: [] }],
    },
    {
      key: 'p3', name: 'Commercial', order: 3, captureMode: 'collection',
      assessmentTypes: ['loi', 'lease', 'legal', 'deposit', 'nocs', 'approvals']
        .map((k) => ({ key: k, name: k, masterDataSchema: [] })),
    },
    { key: 'p20', name: 'Project planning & games', order: 4, captureMode: 'single' },
  ],
});
bin.templates.push(tpl._id);

/**
 * ONE PROJECT PER CASE, and not for tidiness.
 *
 * `recordService.decide` enforces a real rule: only ONE property may be the
 * approved site for a project's Site Evaluation — an outlet opens on one shop,
 * so approving a second is a mistake, not a second decision. Two properties
 * sharing a project would therefore make the second approval fail for a reason
 * that has nothing to do with the road being tested.
 *
 * Worth saying out loud, because it is also the shape of the feature: the
 * project road can be taken for one property per project, and the guard that
 * enforces that is inherited rather than bypassed.
 */
let projectNo = 0;
const mkProject = async () => {
  projectNo += 1;
  const pr = await Project.create({
    name: `${tag}_P${projectNo}`, code: `${tag}-P${projectNo}`, city: 'Probe',
    plannedStartDate: new Date('2026-01-01'),
    template: { ref: tpl._id, name: tpl.name, version: 1 },
    stages: [
      { key: 'p1', name: 'Property capture', order: 1, captureMode: 'collection' },
      { key: 'p2', name: 'Site evaluation', order: 2, captureMode: 'collection' },
      { key: 'p3', name: 'Commercial', order: 3, captureMode: 'collection' },
      { key: 'p20', name: 'Project planning & games', order: 4, captureMode: 'single' },
    ],
  });
  bin.projects.push(pr._id);
  return pr;
};

/** A captured property with one assessment FILED — the state Step 4 requires. */
const assessedProperty = async (name) => {
  const project = await mkProject();
  const prop = await Record.create({
    project: project._id, stageKey: 'p1', title: name,
    status: RECORD_STATUS.SHORTLISTED, values: { property_name: name }, createdBy: admin._id,
  });
  bin.records.push(prop._id);
  const assessment = await Record.create({
    project: project._id, stageKey: 'p2', parentRecordId: prop._id,
    assessmentType: 'feasibility',
    /* Not a draft: `decide` refuses to shortlist a property nothing has been
       filed against, and that refusal is its own rule, tested below. */
    status: RECORD_STATUS.SUBMITTED, values: { market_potential: 'High' }, createdBy: admin._id,
  });
  bin.records.push(assessment._id);
  return prop;
};

const statusOf = async (id) => (await Record.findById(id).select('status').lean())?.status;
const docsUnder = async (id) => Record.countDocuments({ parentRecordId: id, stageKey: 'p3' });
/** The games & dates plan is per PROJECT, not per property. */
const plansOn = async (prop) => Record.countDocuments({ project: prop.project, stageKey: 'p20' });

try {
  /* ── THE COMMERCIAL ROAD ─────────────────────────────────────────────── */
  console.log('── The MD approves for commercial closure ──');
  {
    const prop = await assessedProperty(`${tag} to-commercial`);
    const res = await propertyCaptureService.decide(
      prop._id, { decision: 'shortlist', road: 'commercial' }, admin._id,
    );
    is('the road is reported back', res.road, 'commercial');
    is('and it lands on commercial', res.nextStage, 'commercial');
    atLeast('the closure documents opened', await docsUnder(prop._id), 1);
    is('no games & dates form is opened', await plansOn(prop), 0);
    is('the property is NOT approved', await statusOf(prop._id), RECORD_STATUS.SHORTLISTED);
  }

  /* ── THE PROJECT ROAD ────────────────────────────────────────────────── */
  console.log('\n── The MD approves for games & dates ──');
  {
    const prop = await assessedProperty(`${tag} to-project`);
    const res = await propertyCaptureService.decide(
      prop._id, { decision: 'shortlist', road: 'project' }, admin._id,
    );
    is('the road is reported back', res.road, 'project');
    is('and it lands on planning', res.nextStage, 'planning');
    /* The half that was silently missing. A property stands on project
       creation when its project has a p20 plan open — that is the queue's own
       rule (`stage === 'commercial' && plan`), and it is true of a draft. */
    atLeast('the games & dates form is open', await plansOn(prop), 1);
    atLeast('and closure still opened alongside', await docsUnder(prop._id), 1);
    /* NOT approved: Phase 1 shortlists candidates and never approves them,
       and an approved p1 is invisible to Site Evaluation for ever after. */
    is('the p1 record is left shortlisted, not approved', await statusOf(prop._id), RECORD_STATUS.SHORTLISTED);
  }

  /* ── NO ROAD MEANS THE OLD ONE ───────────────────────────────────────── */
  console.log('\n── An older client that sends no road at all ──');
  {
    const prop = await assessedProperty(`${tag} no-road`);
    const res = await propertyCaptureService.decide(prop._id, { decision: 'shortlist' }, admin._id);
    is('defaults to commercial', res.road, 'commercial');
    is('and opens no plan behind anybody’s back', await plansOn(prop), 0);
  }

  /* ── THE GATE STILL HOLDS ────────────────────────────────────────────── */
  console.log('\n── A property with nothing filed against it ──');
  {
    const bareProject = await mkProject();
    const bare = await Record.create({
      project: bareProject._id, stageKey: 'p1', title: `${tag} unassessed`,
      status: RECORD_STATUS.SHORTLISTED, values: { property_name: 'unassessed' }, createdBy: admin._id,
    });
    bin.records.push(bare._id);
    let refused = false;
    try {
      await propertyCaptureService.decide(bare._id, { decision: 'shortlist', road: 'project' }, admin._id);
    } catch {
      refused = true;
    }
    is('cannot be approved onto either road', refused, true);
    is('and is left exactly as it was', await statusOf(bare._id), RECORD_STATUS.SHORTLISTED);
  }
} finally {
  console.log('\n── Cleaning up ──');
  await Task.deleteMany({ project: { $in: bin.projects } });
  await Record.deleteMany({ project: { $in: bin.projects } });
  await Project.deleteMany({ _id: { $in: bin.projects } });
  await Template.deleteMany({ _id: { $in: bin.templates } });
  await disconnect();
}

finish('MD approval road');
