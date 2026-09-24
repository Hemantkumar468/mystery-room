import { Lead } from '../leads/lead.model.js';
import { CrmActivity } from '../activities/crmActivity.model.js';
import { buildScope, canManageCrm } from '../shared/scope.js';
import { LEAD_STATUS, LEAD_CLOSED_STATUSES, ENTITY_TYPE } from '../crm.constants.js';

/**
 * The CRM dashboard's numbers.
 *
 * WHAT THIS DELIBERATELY DOES NOT SHOW. The spec's dashboard also carries a
 * funnel, a leaderboard against quota, and revenue — all of which are
 * questions about DEALS, and deals do not exist yet. A funnel rendered from an
 * empty collection is not an empty chart, it is a chart of zeroes that looks
 * like a reporting bug, and a leaderboard with no targets ranks everyone at
 * 0%. They arrive with the pipeline phase; nothing here fabricates them.
 *
 * Everything below is computed live. That is the right choice at this size —
 * a few thousand leads — and the wrong one at a hundred thousand, which is why
 * the spec puts a nightly snapshot job in the analytics phase. The shape of
 * this response is what that job will fill in later, so the client does not
 * change when the source does.
 */

const dayAgo = (n) => new Date(Date.now() - n * 86_400_000);

/** Start of today in the server's timezone — "captured today" has to mean the
 *  calendar day a person is looking at, not the last 24 hours. */
function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** `[{_id, n}]` → `{ [_id]: n }`, with a stable zero for every expected key. */
function tally(rows, keys = []) {
  const out = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const r of rows) out[r._id ?? 'unknown'] = r.n;
  return out;
}

export const crmDashboardService = {
  async summary(user) {
    const scope = buildScope(user);
    const today = startOfToday();
    const isManager = canManageCrm(user);

    const [
      total, capturedToday, captured7, captured30,
      byStatus, bySource, unassigned, reEnquiries,
      responseRows, recent, unworked, unworkedMeasurable,
    ] = await Promise.all([
      Lead.countDocuments(scope),
      Lead.countDocuments({ ...scope, createdAt: { $gte: today } }),
      Lead.countDocuments({ ...scope, createdAt: { $gte: dayAgo(7) } }),
      Lead.countDocuments({ ...scope, createdAt: { $gte: dayAgo(30) } }),

      Lead.aggregate([{ $match: scope }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
      Lead.aggregate([{ $match: scope }, { $group: { _id: '$source', n: { $sum: 1 } } }, { $sort: { n: -1 } }]),

      // Unassigned is a MANAGER's number: an agent scoped to their own leads
      // can never see one, so it would always read 0 and mean nothing.
      isManager ? Lead.countDocuments({ assignedTo: null }) : Promise.resolve(null),
      Lead.countDocuments({ ...scope, reEnquiryCount: { $gt: 0 } }),

      /**
       * Speed to first contact — the metric the spec calls the highest-leverage
       * one in the system, and it is: a lead answered in five minutes converts
       * far better than the same lead answered tomorrow.
       *
       * Only leads that HAVE been contacted are averaged. Including the
       * untouched ones as zero would make the number improve every time
       * somebody ignored a lead.
       */
      Lead.aggregate([
        { $match: { ...scope, assignedAt: { $ne: null }, firstActivityAt: { $ne: null } } },
        {
          $project: {
            minutes: { $divide: [{ $subtract: ['$firstActivityAt', '$assignedAt'] }, 60_000] },
          },
        },
        { $group: { _id: null, avg: { $avg: '$minutes' }, n: { $sum: 1 } } },
      ]),

      Lead.find(scope)
        .populate('assignedTo', 'name avatarColor')
        .sort({ createdAt: -1 })
        .limit(8)
        .select('name company city source status assignedTo createdAt reEnquiryCount phone')
        .lean(),

      /**
       * NOBODY HAS TOUCHED THESE. Open leads with no first activity, assigned
       * more than a day ago.
       *
       * This is the one number on the page that is a to-do list rather than a
       * statistic — every row in it is a customer who asked a question and got
       * silence, and it is the single highest-value thing the dashboard can
       * point at.
       */
      Lead.countDocuments({
        ...scope,
        status: { $nin: LEAD_CLOSED_STATUSES },
        firstActivityAt: null,
        assignedAt: { $lt: dayAgo(1) },
      }),

      /**
       * How many leads that question could even be ASKED of.
       *
       * Without this the tile cannot tell "0 out of 40 — everyone is being
       * worked" from "0 out of 0 — nothing has been assigned long enough to
       * measure". Both render as a big green zero, and the second one is false
       * comfort: it looks like the team is on top of things at exactly the
       * moment nobody has been given anything to do.
       */
      Lead.countDocuments({
        ...scope,
        status: { $nin: LEAD_CLOSED_STATUSES },
        assignedAt: { $lt: dayAgo(1) },
      }),
    ]);

    const responded = responseRows[0] || { avg: null, n: 0 };

    return {
      scope: isManager ? 'company' : 'mine',
      capture: {
        total,
        today: capturedToday,
        last7: captured7,
        last30: captured30,
        reEnquiries,
      },
      status: tally(byStatus, Object.values(LEAD_STATUS)),
      /** Ordered by volume — the top row is where the business actually comes
       *  from, which is the question this list is asked. */
      sources: bySource.map((s) => ({ source: s._id || 'unknown', leads: s.n })),
      attention: {
        unassigned,
        /** Assigned over a day ago and still never contacted. */
        unworked,
        /** The denominator — see the query above. A zero here means the
         *  number beside it is "cannot tell", not "all clear". */
        unworkedMeasurable,
      },
      responseTime: {
        avgMinutes: responded.avg == null ? null : Math.round(responded.avg),
        measuredOn: responded.n,
      },
      recent,
    };
  },

  /**
   * One lead, with its whole timeline — what the detail drawer opens.
   *
   * Scoped: an agent asking for a lead they do not own gets a 404 rather than
   * a 403, because "that record exists but is not yours" is itself information
   * about the customer database.
   */
  async detail(id, user) {
    const scope = buildScope(user);
    const lead = await Lead.findOne({ _id: id, ...scope })
      .populate('assignedTo', 'name avatarColor')
      .populate('createdBy', 'name')
      .lean();
    if (!lead) return null;

    const timeline = await CrmActivity.find({ entityType: ENTITY_TYPE.LEAD, entityId: id })
      .populate('actor', 'name avatarColor')
      .sort({ occurredAt: -1 })
      .limit(100)
      .lean();

    return { lead, timeline };
  },
};

export default crmDashboardService;
