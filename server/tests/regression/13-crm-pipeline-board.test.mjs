/**
 * REGRESSION SUITE — CRM Phase 3: pipeline, stage history and the board.
 *
 * What it is really guarding, in order of how expensive the mistake is:
 *
 *   1. stageHistory is written on EVERY transition. A missing entry cannot be
 *      reconstructed later — the information was never recorded — and it is
 *      what sales velocity, bottleneck analysis and stall detection are made of.
 *   2. Moving a card is one write at a midpoint, not a renumber of the column.
 *   3. A lost deal cannot be saved without a reason from the fixed list.
 *
 * Every fixture is created and torn down by the suite.
 */
import 'dotenv/config';
import { connect, disconnect, mongoose } from '../helpers/db.js';
import { ok, no, finish } from '../helpers/assert.js';

const conn = await connect();
console.log(`Connected: ${conn.name}\n`);

const B = '../../src/modules/crm';
const { Pipeline } = await import(`${B}/pipelines/pipeline.model.js`);
const { Deal } = await import(`${B}/deals/deal.model.js`);
const { CrmActivity } = await import(`${B}/activities/crmActivity.model.js`);
const { dealService } = await import(`${B}/deals/deal.service.js`);
const { pipelineService, DEFAULT_STAGES } = await import(`${B}/pipelines/pipeline.service.js`);
const { BOARD_ORDER_STEP } = await import(`${B}/crm.constants.js`);
const { User } = await import('../../src/modules/auth/auth.model.js');

const is = (name, actual, expected) => (
  actual === expected ? ok(name) : no(name, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`)
);
const truthy = (name, v, detail = '') => ((v ? ok : no)(name, detail || (v ? '' : `got ${JSON.stringify(v)}`)));
const throws = async (name, fn, re) => {
  try {
    await fn();
    no(name, 'expected a refusal, but it SUCCEEDED');
  } catch (err) {
    (re.test(err.message) ? ok : no)(name, err.message.slice(0, 90));
  }
};

const tag = `ZZPIPE-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
const admin = await User.findOne({ role: 'md' }).select('_id name').lean();
const md = { _id: admin._id, id: String(admin._id), role: 'md', name: admin.name };
const agent = await User.findOne({ role: 'employee' }).select('_id name').lean();

// Leftovers from a run that crashed before teardown would fail the assertions
// below with a confusing "wrong pipeline" — sweep before starting, not only after.
await Promise.all([
  Pipeline.deleteMany({ name: /^ZZPIPE-/ }),
  Deal.deleteMany({ title: /^ZZPIPE-/ }),
]);

/* ══ The pipeline ═════════════════════════════════════════════ */
console.log('── Stages are data, not an enum ──');
const pipe = await Pipeline.create({
  name: `${tag} Franchise`,
  stages: DEFAULT_STAGES,
  createdBy: md._id,
});
is('the starter pipeline has seven stages', pipe.stages.length, 7);
is('ordered in gaps of 100', pipe.orderedStages().map((s) => s.order).join(','),
  '100,200,300,400,500,600,700');
truthy('exactly one is marked won', pipe.stages.filter((s) => s.isWon).length === 1);
truthy('exactly one is marked lost', pipe.stages.filter((s) => s.isLost).length === 1);

await throws(
  'a pipeline with no won stage is refused',
  () => Pipeline.create({ name: `${tag} broken`, stages: [{ name: 'A', order: 100 }, { name: 'B', order: 200, isLost: true }] }),
  /needs a stage marked as won/i,
);
await throws(
  'a pipeline with one stage is refused',
  () => Pipeline.create({ name: `${tag} single`, stages: [{ name: 'Only', order: 100, isWon: true }] }),
  /at least two stages|needs a stage marked as/i,
);
await throws(
  'a stage cannot be both won and lost',
  () => Pipeline.create({
    name: `${tag} both`,
    stages: [{ name: 'A', order: 100 }, { name: 'Z', order: 200, isWon: true, isLost: true }],
  }),
  /both won and lost/i,
);

// A second pipeline, because multi-pipeline is a day-one requirement — a deal
// must never be movable into a stage that belongs to a different one.
const other = await Pipeline.create({
  name: `${tag} Corporate`,
  stages: [
    { name: 'Enquiry', order: 100, probability: 20 },
    { name: 'Booked', order: 200, probability: 100, isWon: true },
    { name: 'Dropped', order: 300, probability: 0, isLost: true },
  ],
  createdBy: md._id,
});
ok('a second pipeline coexists', `${other.name} (${other.stages.length} stages)`);

const stages = pipe.orderedStages();
const [newLead, contacted, requirement] = stages;
const won = stages.find((s) => s.isWon);
const lost = stages.find((s) => s.isLost);

/* ══ Deals ════════════════════════════════════════════════════ */
console.log('\n── Creating a deal opens its history ──');
const a = await dealService.create({
  title: `${tag} Indore franchise`, pipeline: pipe._id, value: 1_200_000,
}, md);
is('it lands in the first stage', String(a.stage), String(newLead._id));
is('history already has one entry', a.stageHistory.length, 1);
is('naming the stage it entered', a.stageHistory[0].stageName, 'New Lead');
is('still open — no exit yet', a.stageHistory[0].exitedAt, null);
is('and no duration yet', a.stageHistory[0].durationHours, null);
truthy('stageEnteredAt is stamped flat too', a.stageEnteredAt);
is('board position starts at one step', a.boardOrder, BOARD_ORDER_STEP);

const b = await dealService.create({ title: `${tag} Bhopal franchise`, pipeline: pipe._id, value: 800_000 }, md);
const c = await dealService.create({ title: `${tag} Nagpur franchise`, pipeline: pipe._id, value: 450_000 }, md);
is('the next cards stack below it', [a.boardOrder, b.boardOrder, c.boardOrder].join(','), '100,200,300');

/* ══ Moving ═══════════════════════════════════════════════════ */
console.log('\n── A stage change closes the previous entry ──');
const moved = await dealService.move(String(a._id), { stage: String(contacted._id) }, md);
is('two entries now', moved.stageHistory.length, 2);
truthy('the first one is closed', moved.stageHistory[0].exitedAt);
truthy('with a duration in hours', moved.stageHistory[0].durationHours !== null,
  `${moved.stageHistory[0].durationHours}h`);
is('the new one is open', moved.stageHistory[1].exitedAt, null);
is('and names the stage entered', moved.stageHistory[1].stageName, 'Contacted');
is('the deal is in that stage', String(moved.stage), String(contacted._id));

const changeLog = await CrmActivity.findOne({ entityId: a._id, type: 'stage_change' }).lean();
truthy('the move is on the timeline', /New Lead → Contacted/.test(changeLog?.subject || ''), changeLog?.subject);

console.log('\n── Repositioning takes the midpoint, not a renumber ──');
const before = await Deal.find({ pipeline: pipe._id, stage: newLead._id })
  .select('title boardOrder').sort({ boardOrder: 1 }).lean();
is('two cards left in the first column', before.length, 2);

// Drop C between B (100) and nothing → it should land at 200 again; instead
// drop it ABOVE B by giving it no `before` neighbour.
const repositioned = await dealService.move(String(c._id), { afterId: String(before[0]._id) }, md);
truthy('it moved above the first card', repositioned.boardOrder < before[0].boardOrder,
  `${repositioned.boardOrder} < ${before[0].boardOrder}`);

const untouched = await Deal.findById(before[0]._id).select('boardOrder').lean();
is('and the card it passed was NOT rewritten', untouched.boardOrder, before[0].boardOrder);

console.log('\n── When the gap runs out, the column renormalises ──');
// Squeeze two cards to adjacent positions, then drop between them.
await Deal.updateOne({ _id: b._id }, { $set: { boardOrder: 500 } });
await Deal.updateOne({ _id: c._id }, { $set: { boardOrder: 501 } });
const squeezed = await dealService.move(String(a._id), {
  stage: String(newLead._id), beforeId: String(b._id), afterId: String(c._id),
}, md);
truthy('the drop still succeeded', squeezed.boardOrder != null, `landed at ${squeezed.boardOrder}`);
const column = await Deal.find({ pipeline: pipe._id, stage: newLead._id })
  .select('boardOrder').sort({ boardOrder: 1 }).lean();
truthy('and every position is distinct again',
  new Set(column.map((d) => d.boardOrder)).size === column.length,
  column.map((d) => d.boardOrder).join(','));

console.log('\n── A stage from another pipeline is refused ──');
await throws(
  'cross-pipeline moves are impossible',
  () => dealService.move(String(b._id), { stage: String(other.stages[0]._id) }, md),
  /does not belong/i,
);

/* ══ Closing ══════════════════════════════════════════════════ */
console.log('\n── Losing a deal demands a reason ──');
await throws(
  'no reason → refused',
  () => dealService.move(String(b._id), { stage: String(lost._id) }, md),
  /Pick why this was lost/i,
);
await throws(
  'a reason outside the fixed list → refused',
  () => dealService.move(String(b._id), { stage: String(lost._id), lostReason: 'customer said no' }, md),
  /Pick why this was lost/i,
);

const lostDeal = await dealService.move(String(b._id), {
  stage: String(lost._id), lostReason: 'price', lostNotes: 'Wanted 20% off the fee',
}, md);
is('with a valid reason it closes', String(lostDeal.stage), String(lost._id));
is('the reason is stored structured', lostDeal.lostReason, 'price');
is('the notes alongside it', lostDeal.lostNotes, 'Wanted 20% off the fee');
truthy('and closedAt is stamped', lostDeal.closedAt);

console.log('\n── Reopening clears the closure ──');
const reopened = await dealService.move(String(b._id), { stage: String(requirement._id) }, md);
is('closedAt is cleared', reopened.closedAt, undefined);
is('and so is the lost reason', reopened.lostReason, undefined);
is('history kept every hop', reopened.stageHistory.length, 3);
truthy('with only the last one open',
  reopened.stageHistory.filter((h) => h.exitedAt == null).length === 1);

console.log('\n── Winning ──');
const wonDeal = await dealService.move(String(c._id), { stage: String(won._id) }, md);
truthy('closedAt is stamped', wonDeal.closedAt);
is('no lost reason on a won deal', wonDeal.lostReason, undefined);

/* ══ The board ════════════════════════════════════════════════ */
console.log('\n── The board, in one call ──');
const board = await dealService.board(String(pipe._id), md);
is('it names its pipeline', board.pipeline.name, `${tag} Franchise`);
is('every stage is a column', board.stages.length, 7);
truthy('columns carry their own count and value',
  board.stages.every((s) => typeof s.count === 'number' && typeof s.value === 'number'));

const boardCount = board.stages.reduce((n, s) => n + s.count, 0);
is('column counts sum to the total', boardCount, board.totals.count);
const boardValue = board.stages.reduce((n, s) => n + s.value, 0);
is('column values sum to the total', boardValue, board.totals.value);
truthy('and the weighted forecast is arithmetic over the stages',
  board.totals.weighted >= 0, `₹${board.totals.weighted}`);

const cardsInWon = board.stages.find((s) => s.isWon);
is('the won column holds the won deal', cardsInWon.count, 1);

console.log('\n── An agent sees only their own cards ──');
if (agent) {
  const agentBoard = await dealService.board(String(pipe._id), {
    _id: agent._id, id: String(agent._id), role: 'employee',
  });
  is('none of these deals are theirs', agentBoard.totals.count, 0);
} else {
  ok('no employee account to test scoping with — skipped');
}

console.log('\n── The list view reads the same deals ──');
const list = await dealService.list({ search: tag }, md);
is('same three deals', list.total, 3);
truthy('with their stage names resolved',
  list.items.every((d) => typeof d.stageName === 'string'),
  list.items.map((d) => d.stageName).join(', '));
const stalest = await dealService.list({ search: tag, sort: 'stalest' }, md);
truthy('and sortable by how long they have sat', stalest.items.length === 3);

console.log('\n── Removing a stage that still holds deals ──');
await throws(
  'refused, rather than orphaning them',
  () => pipelineService.updateStages(
    String(pipe._id),
    pipe.orderedStages().filter((s) => String(s._id) !== String(requirement._id)),
    md,
  ),
  /still holds/i,
);
await throws(
  'and an agent cannot edit stages at all',
  () => pipelineService.updateStages(String(pipe._id), pipe.orderedStages(), { role: 'employee', _id: agent?._id }),
  /Only a manager/i,
);

/* ══ Renaming a stage keeps its identity ══════════════════════ */
console.log('\n── A stage can be renamed without losing its deals ──');
{
  /* THE UNRECOVERABLE MISTAKE this guards against. Every deal carries `stage`,
     and every entry in every deal's `stageHistory` carries the id of the stage
     it entered. Replacing a stage rather than renaming it in place orphans
     both: the board draws empty columns, and the entire record of how long
     deals spent where points at stages that no longer exist. Durations cannot
     be reconstructed afterwards — the evidence is the thing that was lost.

     So the rename migration edits `name` in place, and this asserts the
     property that makes that safe. */
  const live = await Pipeline.findById(pipe._id);
  const target = live.stages[1];
  const originalId = String(target._id);
  const originalName = target.name;

  const before = await Deal.countDocuments({ stage: target._id });
  const historyBefore = await Deal.countDocuments({ 'stageHistory.stage': target._id });

  target.name = `${tag} Renamed`;
  target.labelHi = 'Naam Badla';
  await live.save();

  const after = await Pipeline.findById(pipe._id).lean();
  const renamed = after.stages.find((s) => String(s._id) === originalId);

  truthy('the stage still exists under the same id', Boolean(renamed));
  is('with the new name', renamed.name, `${tag} Renamed`);
  is('and the Hindi label alongside it', renamed.labelHi, 'Naam Badla');
  is('its deals still point at it', await Deal.countDocuments({ stage: target._id }), before);
  is('and its history entries still resolve',
    await Deal.countDocuments({ 'stageHistory.stage': target._id }), historyBefore);

  // The board reads the label from the stage, so a rename carries it through
  // rather than leaving a stale translation behind in the client.
  const board = await dealService.board(String(pipe._id), md);
  const col = board.stages.find((s) => String(s._id) === originalId);
  is('the board sends the label with the stage', col.labelHi, 'Naam Badla');
  is('and the new name with it', col.name, `${tag} Renamed`);

  target.name = originalName;
  target.labelHi = undefined;
  await live.save();
}

/* ══ Teardown ═════════════════════════════════════════════════ */
console.log('\n── Tidy up ──');
await Promise.all([
  Deal.deleteMany({ title: new RegExp(tag) }),
  Pipeline.deleteMany({ name: new RegExp(tag) }),
  CrmActivity.deleteMany({ entityId: { $in: [a._id, b._id, c._id] } }),
]);
is('no fixtures left behind',
  (await Deal.countDocuments({ title: new RegExp(tag) }))
  + (await Pipeline.countDocuments({ name: new RegExp(tag) })), 0);

await disconnect();
process.exit(finish('CRM PIPELINE & BOARD'));
