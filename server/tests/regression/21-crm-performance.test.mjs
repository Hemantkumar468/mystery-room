/**
 * REGRESSION SUITE — performance and loss analysis.
 *
 * THE THREE RULES THIS SCREEN LIVES OR DIES BY, and all three are about not
 * lying to a manager who is about to have a difficult conversation:
 *
 *   SMALL SAMPLES ARE NOT FLAGGED. A 50% drop on two deals means nothing. Flag
 *   it once and every other flag on the page stops being believed — so the
 *   numbers are shown and the judgement is withheld below ten.
 *
 *   THE BASELINE IS THE MEDIAN, NOT THE MEAN. One outstanding or disastrous
 *   performer must not move everybody else's baseline. With a mean, hiring one
 *   star makes the whole team look like it is underperforming.
 *
 *   AN AGENT CANNOT READ ANOTHER AGENT'S ROW. Enforced in the service, not by
 *   hiding columns in the client — a leaderboard everyone can see is a
 *   decision a company makes deliberately.
 */
import 'dotenv/config';
import { connect, disconnect } from '../helpers/db.js';
import { ok, no, finish } from '../helpers/assert.js';
import { assertRoutesRegistered } from '../helpers/routes.js';

const conn = await connect();
console.log(`Connected: ${conn.name}\n`);

const B = '../../src/modules/crm';
const {
  performanceService, median, MIN_SAMPLE, thinness,
} = await import(`${B}/performance/performance.service.js`);
const { Lead } = await import(`${B}/leads/lead.model.js`);
const { Deal } = await import(`${B}/deals/deal.model.js`);
const { Pipeline } = await import(`${B}/pipelines/pipeline.model.js`);
const { dealService } = await import(`${B}/deals/deal.service.js`);
const { User } = await import('../../src/modules/auth/auth.model.js');
const { createApp } = await import('../../src/app.js');

const is = (name, actual, expected) => (
  actual === expected ? ok(name) : no(name, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`)
);
const truthy = (name, v, detail = '') => ((v ? ok : no)(name, detail || (v ? '' : `got ${JSON.stringify(v)}`)));

const tag = `ZZPERF-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
const cleanup = [];

try {
  /* ══ The median, on its own ═══════════════════════════════════ */
  console.log('── Median, not mean ──');
  is('an odd list takes the middle', median([10, 20, 90]), 20);
  is('an even list averages the two middles', median([10, 20, 30, 40]), 25);
  is('an empty list is null, not zero', median([]), null);
  is('nulls are ignored rather than counted as zero', median([null, 10, null, 20, 30]), 20);
  {
    /* THE WHOLE REASON IT IS A MEDIAN. One spectacular performer among four
       ordinary ones: the mean says the typical agent converts 30%, the median
       says 12%. Only one of those is a baseline anybody could be measured
       against fairly. */
    const rates = [10, 12, 12, 14, 100];
    const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
    is('the median ignores the outlier', median(rates), 12);
    truthy('where the mean would be dragged far above everyone', mean > 25, `mean ${mean}`);
  }

  /* ══ Fixtures ═════════════════════════════════════════════════ */
  const mdUser = await User.findOne({ role: 'md' }).select('_id name').lean();
  const agentUser = await User.findOne({ role: 'employee' }).select('_id name').lean();
  const otherAgent = await User.findOne({ role: 'employee', _id: { $ne: agentUser?._id } })
    .select('_id name').lean();
  const md = { _id: mdUser._id, id: String(mdUser._id), role: 'md', name: mdUser.name };
  const agent = agentUser && {
    _id: agentUser._id, id: String(agentUser._id), role: 'employee', name: agentUser.name,
  };

  await Promise.all([
    Lead.deleteMany({ name: /^ZZPERF-/ }),
    Deal.deleteMany({ title: /^ZZPERF-/ }),
  ]);

  const pipe = await Pipeline.findOne({ isDefault: true });
  const stages = pipe.orderedStages();
  const open = stages.filter((s) => !s.isWon && !s.isLost);
  const lostStage = stages.find((s) => s.isLost);

  cleanup.push(
    () => Lead.deleteMany({ name: new RegExp(`^${tag}`) }),
    () => Deal.deleteMany({ title: new RegExp(`^${tag}`) }),
  );

  /* ══ Small-sample suppression ═════════════════════════════════ */
  console.log('\n── A tiny sample is shown but never flagged ──');
  {
    /* Three deals, all of which stall at the second stage — a 100% drop. With
       a sample this small that number is noise, and the screen must say so
       rather than accusing somebody. */
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const d = await dealService.create({
        title: `${tag} tiny ${i}`, pipeline: pipe._id, value: 100000, stage: String(open[0]._id),
      }, md);
      // eslint-disable-next-line no-await-in-loop
      await dealService.move(String(d._id), { stage: String(open[1]._id) }, md);
    }

    const drop = await performanceService.dropOff({ days: 30 }, md);
    const second = drop.stages.find((s) => String(s.stageId) === String(open[1]._id));
    truthy('the stage appears in the table', Boolean(second));
    truthy('with its real numbers', second.entered >= 3, `entered ${second.entered}`);
    is('the minimum sample is stated for the screen to explain itself', drop.minSample, MIN_SAMPLE);

    if (second.entered < MIN_SAMPLE) {
      is('but it is NOT flagged, because the sample is too small', second.flagged, false);
    } else {
      ok('sample grew past the threshold — suppression not exercised this run',
        `${second.entered} deals`);
    }
  }

  /* ══ Losses ═══════════════════════════════════════════════════ */
  console.log('\n── Why deals died, and where ──');
  {
    const d = await dealService.create({
      title: `${tag} lost one`, pipeline: pipe._id, value: 500000, stage: String(open[0]._id),
    }, md);
    await dealService.move(String(d._id), { stage: String(open[2]._id) }, md);
    await dealService.move(String(d._id), {
      stage: String(lostStage._id), lostReason: 'price', lostNotes: 'wanted a discount',
    }, md);

    const stored = await Deal.findById(d._id).lean();
    /* WHERE it died, captured at the moment it died. Derivable from
       stageHistory, but the analysis asks it of every lost deal on every
       render — and it must not depend on that history staying intact. */
    is('the stage it died in is recorded', String(stored.lostAtStage), String(open[2]._id));
    is('by name too, so a rename cannot orphan the chart', stored.lostAtStageName, open[2].name);

    const losses = await performanceService.losses({ days: 30 }, md);
    truthy('the loss shows up', losses.total >= 1, `${losses.total} lost`);
    truthy('ranked by reason', losses.byReason.length >= 1, losses.byReason.map((r) => r.label).join(', '));
    truthy('and ranked biggest first',
      losses.byReason.every((r, i, a) => i === 0 || a[i - 1].count >= r.count));

    const stageRow = losses.byStage.find((s) => s.label === open[2].name);
    truthy('broken down by the stage it died in', Boolean(stageRow), open[2].name);

    truthy('with a reason × stage grid', losses.heatmap.length >= 1);
    is('whose rows line up with the stage columns',
      losses.heatmap[0].cells.length, losses.stageNames.length);
  }

  /* ══ Scope ════════════════════════════════════════════════════ */
  console.log('\n── An agent cannot read anybody else ──');
  if (agent) {
    const mine = await performanceService.scorecard({ days: 30 }, agent);
    is('an agent gets exactly one row', mine.rows.length, 1);
    is('their own', String(mine.rows[0].agent._id), String(agentUser._id));
    is('and the response says whose numbers these are', mine.scope, 'mine');

    if (otherAgent) {
      const names = mine.rows.map((r) => r.agent.name);
      truthy('another agent does not appear', !names.includes(otherAgent.name), names.join(', '));
    }

    const theirDrop = await performanceService.dropOff({ days: 30, agent: String(otherAgent?._id || '') }, agent);
    /* Asking for somebody else's drop-off does not return it. The scope filter
       runs on the DEALS, so a forged agent id yields that agent's stages
       computed from nothing this user may see. */
    truthy('and asking for another agent yields none of their deals',
      theirDrop.stages.every((s) => s.entered === 0),
      theirDrop.stages.map((s) => s.entered).join(','));

    const manager = await performanceService.scorecard({ days: 30 }, md);
    truthy('while a manager sees the team', manager.rows.length > 1, `${manager.rows.length} rows`);
    is('and the response says so', manager.scope, 'company');
  }

  /* ══ Thin-data honesty ════════════════════════════════════════ */
  console.log('\n── The screen admits when it knows too little ──');
  {
    /* The RULE, tested directly. Asserting it against whatever happens to be
       in the database today is a test that passes or fails depending on how
       busy the week was — which is the same class of mistake as the quiet-hours
       test that only failed between 23:00 and midnight. */
    truthy('too few deals is thin', Boolean(thinness(3, 100)));
    truthy('too few leads is thin, even with plenty of deals', Boolean(thinness(100, 3)));
    is('enough of both is not thin', thinness(MIN_SAMPLE, MIN_SAMPLE), null);
    is('and the caveat names the actual counts', thinness(3, 4).deals, 3);

    const card = await performanceService.scorecard({ days: 1 }, md);
    truthy('the scorecard carries the caveat either way', 'thin' in card);
    truthy('medians are still returned, not faked as zero',
      'contactRate' in (card.medians || {}));
  }

  /* ══ Registration ═════════════════════════════════════════════ */
  console.log('\n── The screens are reachable ──');
  assertRoutesRegistered(createApp(), [
    ['GET', '/crm/performance'],
    ['GET', '/crm/performance/dropoff'],
    ['GET', '/crm/performance/losses'],
  ], { ok, no });
} finally {
  for (const fn of cleanup) await fn();
  await disconnect();
}

process.exit(finish('CRM PERFORMANCE'));
