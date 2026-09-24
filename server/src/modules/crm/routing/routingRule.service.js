import { RoutingRule } from './routingRule.model.js';
import { User } from '../../auth/auth.model.js';
import { canManageCrm } from '../shared/scope.js';
import {
  ROUTABLE_FIELDS, CONDITION_OPERATORS, ROUTING_STRATEGY_VALUES,
} from '../crm.constants.js';
import { ApiError } from '../../../core/utils/ApiError.js';

/**
 * The routing rules admin.
 *
 * MANAGERS ONLY, and not as a formality: a rule decides who receives business.
 * An agent able to edit the chain could route every lead in a city to
 * themselves, and the only trace would be a rule nobody remembers changing.
 *
 * Reading is open to anyone in the CRM, because "why did I get this lead" is a
 * fair question and `routedBy` alone only names the rule.
 */

function assertManager(user) {
  if (!canManageCrm(user)) {
    throw ApiError.forbidden('Only a manager can change routing rules', { code: 'ROUTING_FORBIDDEN' });
  }
}

/** Everything the rules editor needs to render itself, served rather than
 *  duplicated in the client — a field the engine cannot evaluate must not be
 *  offerable in a dropdown. */
export const routingVocabulary = () => ({
  fields: ROUTABLE_FIELDS,
  operators: CONDITION_OPERATORS,
  strategies: ROUTING_STRATEGY_VALUES,
});

export const routingRuleService = {
  async list() {
    const rules = await RoutingRule.find({})
      .populate('targetUser', 'name avatarColor')
      .sort({ priority: 1, createdAt: 1 })
      .lean();

    // Which agents each rotation would currently reach. A rule that looks
    // right but points at an empty team is the most common way routing
    // "stops working", and it is invisible from the rule alone.
    const teams = [...new Set(rules.map((r) => r.targetTeam).filter(Boolean))];
    const counts = teams.length
      ? await User.aggregate([
        { $match: { department: { $in: teams }, isActive: { $ne: false }, role: { $ne: 'viewer' } } },
        { $group: { _id: '$department', n: { $sum: 1 } } },
      ])
      : [];
    const byTeam = new Map(counts.map((c) => [c._id, c.n]));

    return rules.map((r) => ({
      ...r,
      teamSize: r.targetTeam ? (byTeam.get(r.targetTeam) || 0) : null,
    }));
  },

  async create(body, user) {
    assertManager(user);
    const rule = await RoutingRule.create({
      name: String(body.name || '').trim(),
      priority: Number(body.priority) || 100,
      isActive: body.isActive !== false,
      // The model's enums refuse an unknown field or operator on save, so an
      // editor cannot store a rule the engine would silently skip.
      conditions: Array.isArray(body.conditions) ? body.conditions : [],
      strategy: body.strategy,
      targetUser: body.targetUser || undefined,
      targetTeam: body.targetTeam || undefined,
      leaveUnassigned: Boolean(body.leaveUnassigned),
      createdBy: user._id || user.id,
    });
    return rule.toObject();
  },

  async update(id, body, user) {
    assertManager(user);
    const rule = await RoutingRule.findById(id);
    if (!rule) throw ApiError.notFound('Rule not found');

    for (const key of ['name', 'priority', 'isActive', 'conditions', 'strategy', 'leaveUnassigned']) {
      if (body[key] !== undefined) rule[key] = body[key];
    }
    // Explicitly nullable: switching a rule from a specific person back to a
    // rotation has to be able to CLEAR the person, which `if (body.x)` cannot.
    if (body.targetUser !== undefined) rule.targetUser = body.targetUser || undefined;
    if (body.targetTeam !== undefined) rule.targetTeam = body.targetTeam || undefined;

    await rule.save();
    return rule.toObject();
  },

  async remove(id, user) {
    assertManager(user);
    const rule = await RoutingRule.findById(id).lean();
    if (!rule) throw ApiError.notFound('Rule not found');

    /* The catch-all is load-bearing. Without a rule that matches everything,
       a lead matching nothing falls through to the engine's own fallback —
       which works, but silently, and the chain then has no readable answer to
       "where do unmatched leads go". Deleting it is refused rather than
       warned about. */
    if (!rule.conditions?.length && rule.isActive) {
      const others = await RoutingRule.countDocuments({
        _id: { $ne: id }, isActive: true, conditions: { $size: 0 },
      });
      if (!others) {
        throw ApiError.badRequest(
          'This is the only catch-all rule. Add another before deleting it, or leads that match nothing will have no owner named by any rule.',
          { code: 'LAST_CATCH_ALL' },
        );
      }
    }

    await RoutingRule.deleteOne({ _id: id });
    return { _id: id };
  },
};

export default routingRuleService;
