import mongoose from 'mongoose';
import { attachTenancy } from '../../../core/tenancy/tenancy.js';
import { attachAudit } from '../../../core/audit/audit.js';
import {
  ROUTING_STRATEGY, ROUTING_STRATEGY_VALUES, CONDITION_OPERATORS, ROUTABLE_FIELDS,
} from '../crm.constants.js';

const { Schema, model } = mongoose;

/**
 * One rule in the routing chain: "if the lead looks like THIS, give it to
 * THEM".
 *
 * Rules are documents, not code, because who gets which lead changes with
 * every reorganisation, every new territory and every hire — and none of those
 * should need a deploy. The engine evaluates them in `priority` order and
 * stops at the first match.
 *
 * The conditions are stored data that becomes a comparison against a lead, so
 * both the field and the operator are validated against an allow-list on save.
 * A rule naming an arbitrary path is the same class of hole as an unvalidated
 * query filter, and it would be stored by an admin screen rather than typed by
 * a developer.
 */
const conditionSchema = new Schema({
  field: { type: String, required: true, enum: ROUTABLE_FIELDS },
  op: { type: String, required: true, enum: CONDITION_OPERATORS },
  // Mixed because the operand's type follows the field's: a string for city,
  // a number for estimatedValue, an array for `in`.
  value: { type: Schema.Types.Mixed },
}, { _id: false });

const routingRuleSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    /** Lower runs first. Ties are broken by creation order, deterministically,
     *  so two rules with the same priority still behave the same way twice. */
    priority: { type: Number, required: true, default: 100, index: true },
    isActive: { type: Boolean, default: true, index: true },

    /**
     * ANDed together. An empty array matches everything — that is how the
     * catch-all rule is expressed, and there must always be one: without it a
     * lead that matches nothing gets no owner and disappears from every list
     * view that filters by assignee.
     */
    conditions: { type: [conditionSchema], default: [] },

    strategy: {
      type: String, enum: ROUTING_STRATEGY_VALUES, default: ROUTING_STRATEGY.ROUND_ROBIN,
    },
    /** For `specific-user`. */
    targetUser: { type: Schema.Types.ObjectId, ref: 'User' },
    /**
     * For `round-robin` and `least-loaded`: whose rotation to use.
     *
     * Free text rather than a Team ref — there is no Team collection yet, and
     * inventing one to satisfy a foreign key would be building the wrong thing
     * first. It is the rotation's name, and the users in it are matched on
     * `User.department` until teams exist.
     */
    targetTeam: { type: String, trim: true, maxlength: 80 },

    /** Turn off assignment entirely for a matched lead — used for spam-ish
     *  sources you still want recorded but nobody should chase. */
    leaveUnassigned: { type: Boolean, default: false },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

routingRuleSchema.index({ isActive: 1, priority: 1, createdAt: 1 });

/* Who changed what, and what it was before — see core/audit/audit.js. The
 * previous value is the half that matters: the new one is already in the
 * record, the old one is destroyed by the write. */
attachAudit(routingRuleSchema, { modelName: 'RoutingRule', label: 'name' });
attachTenancy(routingRuleSchema, { modelName: 'RoutingRule' });

export const RoutingRule = model('RoutingRule', routingRuleSchema);

/**
 * The rotation pointer, one per team.
 *
 * Its own tiny collection because it is incremented atomically on every single
 * lead — `findOneAndUpdate($inc)` is one round trip and is safe under
 * concurrency, whereas read-then-write on a field inside the rule document
 * hands the same agent to two leads that arrive in the same millisecond.
 */
const routingCounterSchema = new Schema({
  /**
   * UNIQUE PER COMPANY, not globally.
   *
   * This was `unique: true` on `team` alone, and multi-tenancy broke it in a
   * way that was both severe and silent. The counter is looked up with an
   * upsert scoped to the company; once the filter carries a tenant it stops
   * matching a row belonging to another one, so the upsert tries to INSERT —
   * and the global unique index on `team` rejects it. Routing throws, the
   * `catch` in routing.service.js swallows it (deliberately: losing the
   * enquiry is worse than losing the assignment), and every lead from the web
   * form quietly arrives with no owner. An unassigned lead is invisible to
   * every list view, so nobody notices until someone asks why the website
   * stopped producing enquiries.
   *
   * The generic tenancy plugin deliberately does NOT prefix unique indexes —
   * doing that to a sparse one destroys its sparseness. Which fields are
   * unique PER COMPANY rather than globally is a decision per field, and this
   * is one of them: two companies each running a "sales" rotation is normal.
   */
  team: { type: String, required: true },
  pointer: { type: Number, default: 0 },
}, { timestamps: true });

routingCounterSchema.index({ tenant: 1, team: 1 }, { unique: true });

attachTenancy(routingCounterSchema, { modelName: 'RoutingCounter' });

export const RoutingCounter = model('RoutingCounter', routingCounterSchema);

export default RoutingRule;
