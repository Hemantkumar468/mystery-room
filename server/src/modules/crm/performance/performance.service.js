import mongoose from 'mongoose';
import { Lead } from '../leads/lead.model.js';
import { Deal } from '../deals/deal.model.js';
import { Pipeline } from '../pipelines/pipeline.model.js';
import { CrmActivity } from '../activities/crmActivity.model.js';
import { User } from '../../auth/auth.model.js';
import { buildScope, canManageCrm } from '../shared/scope.js';
import { LOST_REASON_LABELS, LOST_REASON_VALUES, ACTIVITY_TYPE } from '../crm.constants.js';

/**
 * Who is doing how much, and where each person is losing deals.
 *
 * TWO QUESTIONS, DELIBERATELY SEPARATE. Counting is the scorecard. Explaining
 * is the drop-off table. A single conversion-rate number makes four different
 * problems look identical — nobody is calling, the demo is weak, price came up
 * too late, the leads were never real — so a manager reading one number cannot
 * tell which they have. Stage-wise drop-off tells them apart.
 *
 * COMPUTED LIVE, FOR NOW. The design calls for a nightly ReportSnapshot, and
 * it should have one: these are multi-collection aggregations and they will
 * not stay cheap. At the current size — hundreds of leads, tens of deals —
 * live is honest and a snapshot would mean showing yesterday's numbers for no
 * benefit. The shape below is built to be snapshotted without changing: every
 * function takes a window and returns a plain object.
 *
 * SCOPE IS NOT COSMETIC. An agent must not read another agent's row. That is
 * enforced by buildScope here, not by hiding columns in the client — a
 * leaderboard everyone can see is a decision a company makes deliberately, and
 * it is off unless somebody turns it on.
 */

/** Two medians, and the reason it is not a mean. */
export function median(values) {
  const sorted = values.filter((n) => n != null && Number.isFinite(n)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  /* MEDIAN, NOT MEAN, and the whole analysis depends on it. One outstanding or
     disastrous performer drags a mean far enough that everybody else's "gap"
     is measured against a baseline nobody actually achieves. */
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Below this, a drop-off percentage is shown but never flagged. */
export const MIN_SAMPLE = 10;

/**
 * Is there enough here to rank anybody on?
 *
 * Exported and pure so the rule can be tested for what it IS, rather than by
 * seeding a database and hoping today's volume lands on the right side of the
 * threshold — which is a test that passes or fails depending on how busy the
 * week was.
 */
export function thinness(dealCount, leadCount) {
  return (dealCount < MIN_SAMPLE || leadCount < MIN_SAMPLE)
    ? { deals: dealCount, leads: leadCount }
    : null;
}

function windowFrom(query) {
  const days = Math.min(Math.max(Number(query?.days) || 30, 1), 365);
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  return { from, to, days };
}

/**
 * The agents this user may see at all.
 *
 * An agent sees exactly themselves. Anyone who can manage the CRM sees the
 * team. There is no middle setting yet because there is no team-leader
 * relationship on a user to build one from — see the note in ticket.service.js
 * about not inventing an org chart.
 */
async function visibleAgents(user) {
  if (!canManageCrm(user)) {
    const me = await User.findById(user._id || user.id).select('name avatarColor').lean();
    return me ? [me] : [];
  }
  return User.find({ isActive: { $ne: false }, role: { $nin: ['viewer'] } })
    .select('name avatarColor department')
    .sort({ name: 1 })
    .lean();
}

export const performanceService = {
  median,
  MIN_SAMPLE,
  thinness,

  /**
   * One row per agent: what they were given, what they did with it.
   */
  async scorecard(query, user) {
    const { from, to, days } = windowFrom(query);
    const agents = await visibleAgents(user);
    if (!agents.length) return { rows: [], medians: {}, range: { from, to, days } };

    const ids = agents.map((a) => a._id);
    const scope = buildScope(user);

    const [leads, deals, activityCounts] = await Promise.all([
      Lead.find({ ...scope, assignedTo: { $in: ids }, assignedAt: { $gte: from, $lte: to } })
        .select('assignedTo assignedAt firstActivityAt lastActivityAt status').lean(),
      Deal.find({ ...scope, assignedTo: { $in: ids }, createdAt: { $gte: from, $lte: to } })
        .select('assignedTo value createdAt closedAt stage lostAtStage lead').lean(),
      CrmActivity.aggregate([
        {
          $match: {
            actor: { $in: ids },
            occurredAt: { $gte: from, $lte: to },
            type: { $in: [ACTIVITY_TYPE.CALL, ACTIVITY_TYPE.MEETING, ACTIVITY_TYPE.EMAIL] },
          },
        },
        { $group: { _id: '$actor', n: { $sum: 1 } } },
      ]),
    ]);

    // Which stages are terminal, so "booked" means the same thing everywhere.
    const pipelines = await Pipeline.find().select('stages').lean();
    const wonStages = new Set();
    for (const p of pipelines) {
      for (const s of p.stages) if (s.isWon) wonStages.add(String(s._id));
    }

    const activityByAgent = new Map(activityCounts.map((a) => [String(a._id), a.n]));

    const rows = agents.map((agent) => {
      const key = String(agent._id);
      const mine = leads.filter((l) => String(l.assignedTo) === key);
      const myDeals = deals.filter((d) => String(d.assignedTo) === key);
      const booked = myDeals.filter((d) => wonStages.has(String(d.stage)));

      /* CONTACTED means somebody actually did something to it. A lead nobody
         has touched is the failure this column exists to surface, so the test
         is an activity — not a status somebody could set without calling. */
      const contacted = mine.filter((l) => l.firstActivityAt || l.lastActivityAt);

      const responseTimes = mine
        .filter((l) => l.firstActivityAt && l.assignedAt)
        .map((l) => (new Date(l.firstActivityAt) - new Date(l.assignedAt)) / 60_000)
        .filter((n) => n >= 0);

      // `closedAt`, not a `wonAt` — a deal has one closure timestamp and the
      // stage says which kind it was. Only booked deals reach here.
      const daysToClose = booked
        .filter((d) => d.closedAt)
        .map((d) => (new Date(d.closedAt) - new Date(d.createdAt)) / 86_400_000);

      const revenue = booked.reduce((sum, d) => sum + (d.value || 0), 0);
      const open = myDeals.filter((d) => !wonStages.has(String(d.stage)) && !d.lostAtStage);

      return {
        agent: { _id: agent._id, name: agent.name, avatarColor: agent.avatarColor },
        assigned: mine.length,
        contacted: contacted.length,
        contactRate: mine.length ? (contacted.length / mine.length) * 100 : null,
        /* MEDIAN response, not average: one lead answered a week late would
           otherwise make a diligent agent look slow. */
        avgResponseMinutes: median(responseTimes),
        dealsCreated: myDeals.length,
        booked: booked.length,
        conversionRate: mine.length ? (booked.length / mine.length) * 100 : null,
        revenue,
        avgDealSize: booked.length ? Math.round(revenue / booked.length) : null,
        avgDaysToClose: median(daysToClose),
        activities: activityByAgent.get(key) || 0,
        openCount: open.length,
        openValue: open.reduce((sum, d) => sum + (d.value || 0), 0),
      };
    });

    /* THE HONEST HEADER. A scorecard built on a handful of records is not
       wrong so much as meaningless, and a manager who acts on it once and
       gets burned stops trusting the screen permanently. Said out loud rather
       than left for them to work out. */
    const thin = thinness(deals.length, leads.length);

    return {
      range: { from, to, days },
      scope: canManageCrm(user) ? 'company' : 'mine',
      rows,
      thin,
      medians: {
        contactRate: median(rows.map((r) => r.contactRate)),
        conversionRate: median(rows.map((r) => r.conversionRate)),
        avgResponseMinutes: median(rows.map((r) => r.avgResponseMinutes)),
      },
    };
  },

  /**
   * Where deals stop moving — per agent, against the team median.
   *
   * "Entered" counts every deal that ever reached a stage, from stageHistory.
   * "Moved on" counts those that later left it for a further stage. The
   * difference is the drop, and comparing one agent's drop with everybody
   * else's at the SAME stage is the only version of this number that says
   * anything actionable.
   */
  async dropOff(query, user) {
    const { from, to, days } = windowFrom(query);
    const agents = await visibleAgents(user);
    const scope = buildScope(user);

    const pipelines = await Pipeline.find().select('stages name').lean();
    const stages = pipelines
      .flatMap((p) => p.stages)
      .filter((s) => !s.isWon && !s.isLost)
      .sort((a, b) => a.order - b.order);

    const deals = await Deal.find({
      ...scope,
      createdAt: { $gte: from, $lte: to },
    }).select('assignedTo stageHistory').lean();

    /** entered/movedOn for one set of deals, by stage id. */
    const tally = (rows) => {
      const counts = new Map();
      for (const deal of rows) {
        const history = deal.stageHistory || [];
        history.forEach((entry, i) => {
          const key = String(entry.stageId);
          if (!counts.has(key)) counts.set(key, { entered: 0, movedOn: 0 });
          counts.get(key).entered += 1;
          // It moved on if there is any later entry — the deal left this stage
          // for another one rather than sitting in it or dying there.
          if (i < history.length - 1) counts.get(key).movedOn += 1;
        });
      }
      return counts;
    };

    // Team baseline first: every visible deal, whoever owns it.
    const teamCounts = tally(deals);
    const wanted = query?.agent && mongoose.isValidObjectId(query.agent) ? String(query.agent) : null;
    const subject = wanted ? deals.filter((d) => String(d.assignedTo) === wanted) : deals;
    const subjectCounts = tally(subject);

    const rows = stages.map((stage) => {
      const key = String(stage._id);
      const mine = subjectCounts.get(key) || { entered: 0, movedOn: 0 };
      const team = teamCounts.get(key) || { entered: 0, movedOn: 0 };

      const dropPercent = mine.entered ? ((mine.entered - mine.movedOn) / mine.entered) * 100 : null;
      const teamMedianDrop = team.entered ? ((team.entered - team.movedOn) / team.entered) * 100 : null;
      const gap = dropPercent != null && teamMedianDrop != null ? dropPercent - teamMedianDrop : null;

      return {
        stageId: stage._id,
        name: stage.name,
        labelHi: stage.labelHi,
        entered: mine.entered,
        movedOn: mine.movedOn,
        dropPercent,
        teamMedianDrop,
        gap,
        /* FLAGGED ONLY WITH ENOUGH DEALS BEHIND IT. A 50% drop on two deals
           means nothing, and flagging it destroys trust in every other row on
           the page — so the numbers are shown and the judgement is withheld. */
        flagged: mine.entered >= MIN_SAMPLE && gap != null && Math.abs(gap) >= 10,
      };
    });

    return {
      range: { from, to, days },
      agent: wanted,
      agents: agents.map((a) => ({ _id: a._id, name: a.name })),
      minSample: MIN_SAMPLE,
      stages: rows,
    };
  },

  /**
   * Why deals die, where, and which sources produce them.
   */
  async losses(query, user) {
    const { from, to, days } = windowFrom(query);
    const scope = buildScope(user);

    const lost = await Deal.find({
      ...scope,
      lostReason: { $ne: null },
      updatedAt: { $gte: from, $lte: to },
    }).select('lostReason lostAtStage lostAtStageName value assignedTo lead').lean();

    if (!lost.length) {
      return {
        range: { from, to, days }, total: 0, byReason: [], byStage: [], bySource: [], heatmap: [], stageNames: [],
      };
    }

    const rank = (rows, keyOf, labelOf) => {
      const counts = new Map();
      for (const row of rows) {
        const key = keyOf(row) || 'unknown';
        if (!counts.has(key)) counts.set(key, { key, label: labelOf(key), count: 0, value: 0 });
        counts.get(key).count += 1;
        counts.get(key).value += row.value || 0;
      }
      return [...counts.values()].sort((a, b) => b.count - a.count);
    };

    const byReason = rank(lost, (d) => d.lostReason, (k) => LOST_REASON_LABELS[k] || k);
    const byStage = rank(
      lost,
      (d) => d.lostAtStageName,
      // Null is a real answer here: a deal created straight into the lost stage
      // never had a previous one. Named rather than hidden, so the chart does
      // not quietly under-count.
      (k) => (k === 'unknown' ? 'Not recorded' : k),
    );
    /* SOURCE LIVES ON THE LEAD, not the deal — a deal is the money, the lead
       is where it came from. Fetched in one query and joined here rather than
       denormalised onto the deal, because a lead's source can be corrected
       after the fact and a copy would keep the wrong answer forever. A deal
       created by hand has no lead, and says so. */
    const leadIds = lost.map((d) => d.lead).filter(Boolean);
    const sourceByLead = new Map(
      (await Lead.find({ _id: { $in: leadIds } }).select('source').lean())
        .map((l) => [String(l._id), l.source]),
    );
    const bySource = rank(
      lost,
      (d) => (d.lead ? sourceByLead.get(String(d.lead)) : null),
      (k) => (k === 'unknown' ? 'Added by hand' : k),
    );

    /* REASON × STAGE. "Price too high" appearing early rather than at the
       price stage means budget is being discussed before value — a coaching
       point neither single-axis chart can show. */
    const stageNames = byStage.map((s) => s.label);
    const heatmap = byReason.map((r) => ({
      reason: r.key,
      label: r.label,
      cells: stageNames.map((stageName) => lost.filter(
        (d) => d.lostReason === r.key
          && (d.lostAtStageName || 'Not recorded') === (stageName === 'Not recorded' ? 'Not recorded' : stageName),
      ).length),
    }));
    const heatMax = Math.max(1, ...heatmap.flatMap((r) => r.cells));

    return {
      range: { from, to, days },
      total: lost.length,
      byReason,
      byStage,
      bySource,
      stageNames,
      heatmap,
      heatMax,
      reasons: LOST_REASON_VALUES.map((v) => ({ value: v, label: LOST_REASON_LABELS[v] })),
    };
  },
};

export default performanceService;
