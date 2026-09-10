/* eslint-disable no-console */
/**
 * The client flow's gates, through real database queries.
 *
 * Suite 27 pins the arithmetic as pure functions over rows. This one proves
 * the same gates behave identically when the rows come out of Mongo — that the
 * stageKey queries select what they should, that a `values.*` field survives
 * the round trip, and that `assertOrderable` (the write-path guard) refuses
 * exactly what the screen greys out.
 *
 * ── Why this suite refuses to run against the shared database ────────
 * It CREATES a project and records, and no amount of careful teardown makes
 * that safe to do in a database people are working in: a crash between create
 * and cleanup leaves scratch rows in a real project list. So it runs only
 * against a local MONGO_URI and SKIPS otherwise, rather than failing — a
 * skipped safety check should not read as a broken build.
 *
 *   MONGO_URI=mongodb://127.0.0.1:27017/mr_flowtest node tests/regression/28-client-flow-live.test.mjs
 */
import mongoose from 'mongoose';
import { Project } from '../../src/modules/pms/projects/project.model.js';
import { Record } from '../../src/modules/pms/records/record.model.js';
import { Template } from '../../src/modules/pms/templates/template.model.js';
import { clientFlowTemplate } from '../../src/seed/clientFlowTemplate.js';
import * as flow from '../../src/modules/pms/flow/flow.service.js';
import { DRAWING_SET_1, DRAWING_SET_2 } from '../../src/seed/drawingChecklist.js';
import { BOQ_MASTER, SOURCE_OF_SUPPLY } from '../../src/seed/boqMaster.js';

const URI = process.env.MONGO_URI;
if (!/(127\.0\.0\.1|localhost)/.test(String(URI))) {
  console.log('  SKIP  28-client-flow-live — MONGO_URI is not local.');
  console.log('        This suite creates and deletes a project, so it never runs against a shared database.');
  console.log('        Run it with: MONGO_URI=mongodb://127.0.0.1:27017/mr_flowtest');
  process.exit(0);
}

let pass = 0; let fail = 0;
const ok = (n, c, d = '') => { if (c) { pass += 1; console.log(`  PASS  ${n}`); } else { fail += 1; console.log(`  FAIL  ${n}${d ? ` — ${d}` : ''}`); } };
const eq = (n, a, b) => ok(n, Object.is(a, b), `got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);

await mongoose.connect(URI, { serverSelectionTimeoutMS: 8000 });

const TAG = `ZZ-FLOWTEST-${Date.now()}`;
/**
 * Built from the REAL client-flow template, not a hand-written stub.
 *
 * Two things depend on it and would otherwise pass for the wrong reason:
 * `updateTracking` resolves its field schema from the TEMPLATE (not the
 * project's own stage snapshot), so `po_number` must genuinely be declared
 * `tracker: true` there; and the contract rule binds to the project HAVING a
 * Phase 8, which is a property of the template it was created from.
 */
const tpl = await Template.findOneAndUpdate(
  { code: clientFlowTemplate.code },
  { $set: clientFlowTemplate },
  { upsert: true, new: true, setDefaultsOnInsert: true },
);
const project = await Project.create({
  name: TAG,
  code: TAG,
  city: 'Bhopal',
  status: 'active',
  plannedStartDate: new Date(),
  plannedEndDate: new Date(Date.now() + 145 * 86400000),
  template: { ref: tpl._id, name: tpl.name, code: tpl.code },
  stages: tpl.stages.map((s) => ({
    key: s.key, name: s.name, order: s.order, color: s.color, slaDays: s.slaDays,
    ownerDepartment: s.ownerDepartment, captureMode: s.captureMode, recordNoun: s.recordNoun,
    masterDataSchema: s.masterDataSchema, recordGroups: s.recordGroups,
  })),
});
const pid = project._id;
const made = [];
const put = async (stageKey, values, status = 'submitted') => {
  const r = await Record.create({ project: pid, stageKey, values, status });
  made.push(r._id);
  return r;
};

try {
  console.log('\n── an empty project ───────────────────────────────────────');
  let f = await flow.getFlow(pid);
  eq('all 37 checklist rows present from day one', f.drawings.rows.length, 37);
  ok('BOQ locked', !f.drawings.boqUnlocked);
  eq('29 Set 1 drawings blocking', f.drawings.blocking.length, 29);
  eq('seven BOQs reported even with no lines', f.boq.boqs.length, 7);
  ok('rates not ready', !f.panel.ratesReady);
  eq('nothing orderable', f.orders.orderable, 0);

  console.log('\n── 28 of 29 Set 1 approved, and all of Set 2 ──────────────');
  for (const d of DRAWING_SET_1.slice(0, 28)) {
    await put('p11', { checklist_drawing: d.name, checklist_status: 'Approved', revision_no: 1 });
  }
  for (const d of DRAWING_SET_2) {
    await put('p11', { checklist_drawing: d.name, checklist_status: 'Approved', revision_no: 1 });
  }
  f = await flow.getFlow(pid);
  eq('28 of 29 approved', f.drawings.set1.approved, 28);
  eq('all 8 of Set 2 approved', f.drawings.set2.approved, 8);
  ok('BOQ STILL LOCKED on one missing Set 1 drawing', !f.drawings.boqUnlocked);
  eq('and it names the one that is missing', f.drawings.blocking.length, 1);

  console.log('\n── the 29th arrives ───────────────────────────────────────');
  await put('p11', { checklist_drawing: DRAWING_SET_1[28].name, checklist_status: 'Approved', revision_no: 1 });
  f = await flow.getFlow(pid);
  ok('BOQ UNLOCKED', f.drawings.boqUnlocked);
  eq('nothing blocking', f.drawings.blocking.length, 0);

  console.log('\n── the panel confirms its rates ───────────────────────────');
  const cats = [...new Set(BOQ_MASTER.map((b) => b.vendorCategory))];
  for (const c of cats) await put('p12', { panel_category: c, vendor_name: `${c} Co`, rate_confirmed: true });
  f = await flow.getFlow(pid);
  ok('rates ready', f.panel.ratesReady);
  ok('BOQ can start — quantities AND rates', f.boq.inputs.canStart);

  console.log('\n── BOQ lines, and the contract gate ───────────────────────');
  const acme = `${cats[0]} Co`;
  await put('p13', {
    boq_type: BOQ_MASTER[0].name, item: 'Partition walls', amount: 250000,
    source_of_supply: SOURCE_OF_SUPPLY.PROCURE, vendor: acme,
  }, 'approved');
  await put('p13', {
    boq_type: BOQ_MASTER[1].name, item: 'Game props', amount: 90000,
    source_of_supply: SOURCE_OF_SUPPLY.STOCK, vendor: acme,
  }, 'approved');
  f = await flow.getFlow(pid);
  eq('BOQ 1 totals its own line', f.boq.boqs[0].value, 250000);
  eq('BOQ 2 totals its own line', f.boq.boqs[1].value, 90000);
  eq('nothing orderable without a contract', f.orders.orderable, 0);
  eq('one line blocked by the missing contract', f.orders.blocked, 1);
  ok('and it names the vendor', f.orders.blockedVendors.includes(acme));
  eq('the stock line is not blocked, just never a PO', f.orders.notApplicable, 1);

  console.log('\n── a DRAFT contract changes nothing ───────────────────────');
  const draft = await put('p21', { vendor_name: acme, contract_status: 'Draft', contract_value: 250000 });
  f = await flow.getFlow(pid);
  eq('still nothing orderable', f.orders.orderable, 0);

  console.log('\n── signing it releases exactly that vendor ────────────────');
  await Record.updateOne({ _id: draft._id }, { $set: { 'values.contract_status': 'Signed' } });
  f = await flow.getFlow(pid);
  eq('one line now orderable', f.orders.orderable, 1);
  eq('nothing blocked', f.orders.blocked, 0);
  ok('rule 4 satisfied', f.rules.nothingOrderedWithoutContract);

  console.log('\n── the write-path guard agrees with the screen ────────────');
  const orderable = f.orders.rows.find((r) => r.orderable);
  ok('assertOrderable passes the orderable line', !!(await flow.assertOrderable(pid, orderable.id)).orderable);
  const stockLine = f.orders.rows.find((r) => !r.orderable && !r.blocked);
  let threw = null;
  try { await flow.assertOrderable(pid, stockLine.id); } catch (e) { threw = e; }
  ok('assertOrderable REFUSES a stock line', !!threw, 'the API must refuse what the screen greys out');
  ok('and refuses with 409, not 500', threw?.statusCode === 409, `got ${threw?.statusCode}`);
  console.log('\n── Rule 4 is enforced on the WRITE path ───────────────────');
  {
    const { recordService } = await import('../../src/modules/pms/records/record.service.js');
    const lines = await Record.find({ project: pid, stageKey: 'p13' }).lean();
    const stock = lines.find((l) => l.values?.source_of_supply === SOURCE_OF_SUPPLY.STOCK);
    const procure = lines.find((l) => l.values?.source_of_supply === SOURCE_OF_SUPPLY.PROCURE);

    /* A stock line must never become a purchase order, however it is asked. */
    let threw = null;
    try {
      await recordService.updateTracking(stock._id, { values: { po_number: 'PO-TEST-1' } }, null);
    } catch (e) { threw = e; }
    ok('the API refuses a PO on a Delhi-stock line', !!threw, 'the screen greys it out; the API must too');
    ok('and refuses with 409', threw?.statusCode === 409, `got ${threw?.statusCode}`);

    /* The vendor with a signed contract may be ordered from. */
    let raised = null;
    try {
      raised = await recordService.updateTracking(procure._id, { values: { po_number: 'PO-TEST-2' } }, null);
    } catch (e) { raised = e; }
    ok('a line with a signed contract IS allowed through', !(raised instanceof Error),
      raised instanceof Error ? raised.message : '');

    /* Correcting a field on an order already raised is not raising one. */
    let edit = null;
    try {
      edit = await recordService.updateTracking(procure._id, { values: { po_number: 'PO-TEST-2A' } }, null);
    } catch (e) { edit = e; }
    ok('editing an already-raised PO is not blocked', !(edit instanceof Error),
      edit instanceof Error ? edit.message : '');
  }

  console.log('\n── and does NOT apply to a project with no Phase 8 ────────');
  {
    const { contractRuleApplies } = await import('../../src/modules/pms/flow/flow.service.js');
    const legacy = await Project.create({
      name: `${TAG}-LEGACY`, code: `${TAG}-L`, city: 'Pune', status: 'active',
      plannedStartDate: new Date(), plannedEndDate: new Date(Date.now() + 1e10),
      stages: [{ key: 'p13', name: 'BOQ', order: 0 }],
    });
    ok('a project with no Contracts phase is exempt', !(await contractRuleApplies(legacy._id)),
      'enforcing retroactively would stop procurement on every existing project');
    ok('the demo project, which HAS Phase 8, is bound by it', await contractRuleApplies(pid));
    await Project.deleteOne({ _id: legacy._id });
  }
} finally {
  await Record.deleteMany({ _id: { $in: made } });
  await Project.deleteOne({ _id: pid });
  console.log(`\n  cleaned up ${made.length} records + 1 project`);
  await mongoose.disconnect();
}

console.log(`\n${'═'.repeat(60)}\n  ${pass} passed, ${fail} failed\n${'═'.repeat(60)}\n`);
process.exit(fail ? 1 : 0);
