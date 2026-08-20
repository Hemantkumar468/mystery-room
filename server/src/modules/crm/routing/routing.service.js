import { RoutingRule, RoutingCounter } from './routingRule.model.js';
import { Lead } from '../leads/lead.model.js';
import { User } from '../../auth/auth.model.js';
import { ROUTING_STRATEGY, LEAD_CLOSED_STATUSES } from '../crm.constants.js';
import { CANNOT_OWN_LEADS } from '../shared/ownership.js';
import { logger } from '../../../config/logger.js';

/**
 * Who gets the lead.
 *
 * Runs SYNCHRONOUSLY inside lead creation. Everything else about intake is
 * async, but not this: a lead that exists for even a second with no owner can
 * be missed by the list views, the response-time clock and the stale sweep,
 * all of which key on `assignedTo`.
 *
 * Never throws. A routing failure must not lose the enquiry — an unassigned
 * lead is a problem a manager can fix in ten seconds, and a 500 back to
 * Facebook's webhook is a lead nobody ever sees.
 */

/** Read `lead.utm.source` from a plain object, one dot at a time. */
const valueAt = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

/** One condition against one lead. Unknown operators are false, not thrown:
 *  the model's enum already refused them at save time, so reaching one here
 *  means the data predates the enum, and a stored rule that no longer parses
 *  should stop matching rather than stop the intake. */
function conditionMatches(lead, { field, op, value }) {
  const actual = valueAt(lead, field);

  switch (op) {
    case 'eq': return String(actual ?? '') === String(value ?? '');
    case 'ne': return String(actual ?? '') !== String(value ?? '');
    case 'in': return Array.isArray(value)
      && value.some((v) => String(v).toLowerCase() === String(actual ?? '').toLowerCase());
    case 'nin': return Array.isArray(value)
      && !value.some((v) => String(v).toLowerCase() === String(actual ?? '').toLowerCase());
    case 'gt': return Number(actual) > Number(value);
    case 'gte': return Number(actual) >= Number(value);
    case 'lt': return Number(actual) < Number(value);
    case 'lte': return Number(actual) <= Number(value);
    case 'contains': return String(actual ?? '').toLowerCase().includes(String(value).toLowerCase());
    case 'exists': return (actual != null && actual !== '') === Boolean(value);
    default: return false;
  }
}

/** All conditions, ANDed. An empty list is the catch-all and matches. */
const ruleMatches = (lead, rule) => (rule.conditions || []).every((c) => conditionMatches(lead, c));

/**
 * The agents a rotation may actually hand work to.
 *
 * Availability is the whole point of the filter: an agent on leave who stays
 * in the rotation collects leads nobody looks at for a week, and those are the
 * ones that go cold. Deactivated accounts are excluded for the stronger
 * reason that they cannot log in at all.
 */
async function eligibleAgents(team) {
  const where = { isActive: { $ne: false }, role: { $nin: CANNOT_OWN_LEADS } };
  if (team) where.department = team;

  const agents = await User.find(where)
    .select('_id name department crmAvailable crmOpenLeadCap')
    .sort({ _id: 1 }) // stable order, so the pointer means the same thing twice
    .lean();

  // `crmAvailable` is opt-OUT: a field nobody has set yet must not empty the
  // rotation, so only an explicit `false` removes someone.
  return agents.filter((a) => a.crmAvailable !== false);
}

/** Drop anyone already carrying their cap of open leads. */
async function underCap(agents) {
  const capped = agents.filter((a) => a.crmOpenLeadCap > 0);
  if (!capped.length) return agents;

  const counts = await Lead.aggregate([
    {
      $match: {
        assignedTo: { $in: capped.map((a) => a._id) },
        status: { $nin: LEAD_CLOSED_STATUSES },
      },
    },
    { $group: { _id: '$assignedTo', n: { $sum: 1 } } },
  ]);
  const byId = new Map(counts.map((c) => [String(c._id), c.n]));

  const free = agents.filter((a) => !(a.crmOpenLeadCap > 0)
    || (byId.get(String(a._id)) || 0) < a.crmOpenLeadCap);

  // Everyone at cap: hand it out anyway rather than leaving it unassigned. A
  // lead sitting in nobody's queue is worse than an agent one over their cap,
  // and the cap is a smoothing device, not a legal limit.
  return free.length ? free : agents;
}

/**
 * The next agent in a team's rotation.
 *
 * The `$inc` is atomic and returns the NEW value, so two leads arriving in the
 * same millisecond read different pointers. A read-then-write here is the
 * classic round-robin bug: five leads, five agents, all five to one person.
 */
async function roundRobin(team) {
  const agents = await underCap(await eligibleAgents(team));
  // Explicit, because `agents[n % 0]` is `agents[NaN]` — `undefined` — and an
  // undefined assignee silently becomes the unassigned lead this whole
  // function exists to prevent.
  if (!agents.length) return null;

  const counter = await RoutingCounter.findOneAndUpdate(
    { team: team || '*' },
    { $inc: { pointer: 1 } },
    { new: true, upsert: true },
  ).lean();

  return agents[counter.pointer % agents.length]._id;
}

/** The eligible agent with the fewest open leads. */
async function leastLoaded(team) {
  const agents = await eligibleAgents(team);
  if (!agents.length) return null;

  const counts = await Lead.aggregate([
    { $match: { assignedTo: { $in: agents.map((a) => a._id) }, status: { $nin: LEAD_CLOSED_STATUSES } } },
    { $group: { _id: '$assignedTo', n: { $sum: 1 } } },
  ]);
  const byId = new Map(counts.map((c) => [String(c._id), c.n]));

  return agents.reduce((best, a) => (
    (byId.get(String(a._id)) || 0) < (byId.get(String(best._id)) || 0) ? a : best
  ), agents[0])._id;
}

export const routingService = {
  /**
   * @param {object} lead  the lead-shaped payload, before it is saved
   * @returns {Promise<{ assignedTo: ObjectId|null, routedBy: string }>}
   */
  async route(lead) {
    try {
      const rules = await RoutingRule.find({ isActive: true })
        .sort({ priority: 1, createdAt: 1 })
        .lean();

      for (const rule of rules) {
        if (!ruleMatches(lead, rule)) continue;

        if (rule.leaveUnassigned) return { assignedTo: null, routedBy: `${rule.name} (unassigned by rule)` };

        let assignedTo = null;
        if (rule.strategy === ROUTING_STRATEGY.SPECIFIC_USER) {
          assignedTo = rule.targetUser || null;
        } else if (rule.strategy === ROUTING_STRATEGY.LEAST_LOADED) {
          assignedTo = await leastLoaded(rule.targetTeam);
        } else {
          assignedTo = await roundRobin(rule.targetTeam);
        }

        // A rule that matched but produced nobody (whole team on leave) must
        // not end the chain — fall through and let a broader rule try.
        if (assignedTo) return { assignedTo, routedBy: rule.name };
        logger.warn(`CRM routing: rule "${rule.name}" matched but had no available agent`);
      }

      // No rule produced an owner. Rather than leave the lead orphaned, fall
      // back to the whole-company rotation. Ops can see it happened, because
      // `routedBy` says so.
      const fallback = await roundRobin(null);
      return {
        assignedTo: fallback,
        routedBy: fallback ? 'fallback rotation (no rule matched)' : 'unassigned (nobody available)',
      };
    } catch (err) {
      // Losing the enquiry is worse than losing the assignment.
      logger.error(`CRM routing failed, leaving lead unassigned: ${err.message}`);
      return { assignedTo: null, routedBy: 'unassigned (routing error)' };
    }
  },

  /** Exposed for the rules admin screen and the tests. */
  ruleMatches,
  conditionMatches,
};

export default routingService;
