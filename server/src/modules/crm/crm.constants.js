/**
 * CRM vocabulary — the strings the whole module agrees on.
 *
 * Everything here is a value the DATABASE constrains. Anything a business
 * should be able to change without a deploy (pipeline stages, routing rules,
 * SLA targets) is a document in a collection instead, not an enum here — see
 * the Pipeline and RoutingRule models.
 */

/**
 * Where a lead came in through.
 *
 * `source` is the CHANNEL, deliberately coarse. The campaign, ad set and form
 * that produced it live in `sourceDetail` and the UTM fields, because those are
 * unbounded — a new campaign every week must not need a new enum value.
 */
export const LEAD_SOURCE = Object.freeze({
  WEB_FORM: 'web_form',
  FACEBOOK: 'facebook',
  INSTAGRAM: 'instagram',
  LINKEDIN: 'linkedin',
  GOOGLE_ADS: 'google_ads',
  REFERRAL: 'referral',
  WALK_IN: 'walk_in',
  PHONE: 'phone',
  EVENT: 'event',
  MANUAL: 'manual',
  OTHER: 'other',
});
export const LEAD_SOURCE_VALUES = Object.values(LEAD_SOURCE);

/**
 * The lead's own lifecycle, which is NOT the deal pipeline.
 *
 * A lead is either being qualified, has become a deal, or is dead. The seven
 * selling stages (New → Contacted → … → Closed Won) belong to the Deal and
 * live in the Pipeline collection so a business can reorder them. Conflating
 * the two is what makes "which stage is this lead in?" unanswerable once a
 * lead has produced two deals.
 */
export const LEAD_STATUS = Object.freeze({
  NEW: 'new',
  CONTACTED: 'contacted',
  QUALIFIED: 'qualified',
  CONVERTED: 'converted',
  DISQUALIFIED: 'disqualified',
});
export const LEAD_STATUS_VALUES = Object.values(LEAD_STATUS);

/** Statuses that mean nobody should be working this lead any more. */
export const LEAD_CLOSED_STATUSES = Object.freeze([
  LEAD_STATUS.CONVERTED, LEAD_STATUS.DISQUALIFIED,
]);

/**
 * What an activity records.
 *
 * One collection for every interaction, because the contact timeline is a
 * single reverse-chronological feed and merging four collections at read time
 * to build it is how that page becomes slow.
 */
export const ACTIVITY_TYPE = Object.freeze({
  CALL: 'call',
  WHATSAPP: 'whatsapp',
  EMAIL: 'email',
  MEETING: 'meeting',
  NOTE: 'note',
  TASK: 'task',
  STAGE_CHANGE: 'stage_change',
  SYSTEM: 'system',
});
export const ACTIVITY_TYPE_VALUES = Object.values(ACTIVITY_TYPE);

/** What an activity hangs off. These strings are also the URL segments. */
export const ENTITY_TYPE = Object.freeze({
  LEAD: 'lead',
  DEAL: 'deal',
  CONTACT: 'contact',
  COMPANY: 'company',
  TICKET: 'ticket',
});
export const ENTITY_TYPE_VALUES = Object.values(ENTITY_TYPE);

export const ACTIVITY_DIRECTION = Object.freeze({
  INBOUND: 'inbound',
  OUTBOUND: 'outbound',
});
export const ACTIVITY_DIRECTION_VALUES = Object.values(ACTIVITY_DIRECTION);

/** How a routing rule picks someone once its conditions match. */
export const ROUTING_STRATEGY = Object.freeze({
  ROUND_ROBIN: 'round-robin',
  SPECIFIC_USER: 'specific-user',
  LEAST_LOADED: 'least-loaded',
});
export const ROUTING_STRATEGY_VALUES = Object.values(ROUTING_STRATEGY);

/** The operators a routing condition may use. Validated on save, so a rule
 *  that the engine could not evaluate cannot be stored in the first place. */
export const CONDITION_OPERATORS = Object.freeze([
  'eq', 'ne', 'in', 'nin', 'gt', 'gte', 'lt', 'lte', 'contains', 'exists',
]);

/**
 * The lead fields a routing rule is allowed to test.
 *
 * An allow-list, not "any field": a rule is stored data that becomes a Mongo
 * query, and letting it name arbitrary paths is the same class of hole as an
 * unvalidated filter.
 */
export const ROUTABLE_FIELDS = Object.freeze([
  'source', 'city', 'region', 'country', 'segment', 'language',
  'productInterest', 'estimatedValue', 'utm.source', 'utm.campaign',
]);

/** How a duplicate was recognised — stored so a merge decision can be audited. */
export const DUPLICATE_MATCH = Object.freeze({
  PHONE: 'phone',
  EMAIL: 'email',
  FUZZY_NAME_COMPANY: 'fuzzy_name_company',
});
export const DUPLICATE_MATCH_VALUES = Object.values(DUPLICATE_MATCH);

/**
 * Default country for phone normalisation.
 *
 * Indian franchise business, so a bare 10-digit number is an Indian mobile.
 * Kept here rather than inline so a second market is one edit, and so the test
 * suite can state the assumption it is testing.
 */
export const DEFAULT_PHONE_REGION = '+91';

/* ── Deals ──────────────────────────────────────────────────── */

/**
 * Why a deal was lost — a FIXED list, not free text.
 *
 * This is the single most valuable structured field the CRM collects. Free
 * text produces a report that cannot be grouped, which is the same as no
 * report: "customer said no" restates the outcome rather than explaining it.
 * Six buckets answer "what is costing us deals", and `lostNotes` carries the
 * specifics for anyone who wants to read them.
 *
 * Deliberately short. A list of twenty makes people pick whichever is nearest
 * the top, and the resulting chart is a chart of the list's ordering.
 */
export const LOST_REASON = Object.freeze({
  PRICE: 'price',
  TIMING: 'timing',
  COMPETITOR: 'competitor',
  NO_BUDGET: 'no_budget',
  NO_RESPONSE: 'no_response',
  WRONG_FIT: 'wrong_fit',
});
export const LOST_REASON_VALUES = Object.values(LOST_REASON);

export const LOST_REASON_LABELS = Object.freeze({
  [LOST_REASON.PRICE]: 'Price too high',
  [LOST_REASON.TIMING]: 'Bad timing',
  [LOST_REASON.COMPETITOR]: 'Went to a competitor',
  [LOST_REASON.NO_BUDGET]: 'No budget',
  [LOST_REASON.NO_RESPONSE]: 'Went quiet / no response',
  [LOST_REASON.WRONG_FIT]: 'Not the right fit',
});

/**
 * The gap between adjacent cards in a board column.
 *
 * Gapped ordering means a drop between two cards is one write at their
 * midpoint, instead of renumbering everything below it. When two neighbours
 * get closer than MIN_BOARD_GAP there is no midpoint left to use, and the
 * column is renormalised back to clean multiples.
 */
export const BOARD_ORDER_STEP = 100;
export const MIN_BOARD_GAP = 2;

/* ── Tasks and reminders ────────────────────────────────────── */

/**
 * What KIND of work a task is.
 *
 * Typed rather than free-form because the mix is the diagnosis: an agent doing
 * fifty calls and no demos has a completely different problem from one doing
 * five demos and no calls, and an untyped task list cannot tell you which you
 * are looking at.
 */
export const TASK_TYPE = Object.freeze({
  CALL: 'call',
  MEETING: 'meeting',
  DEMO: 'demo',
  SITE_VISIT: 'site_visit',
  EMAIL: 'email',
  FOLLOW_UP: 'follow_up',
  DOCUMENT: 'document',
});
export const TASK_TYPE_VALUES = Object.values(TASK_TYPE);

/** Each type's default length, in minutes — what the calendar blocks out when
 *  somebody schedules one without thinking about duration. */
export const TASK_DEFAULT_MINUTES = Object.freeze({
  [TASK_TYPE.CALL]: 15,
  [TASK_TYPE.MEETING]: 45,
  [TASK_TYPE.DEMO]: 60,
  [TASK_TYPE.SITE_VISIT]: 120,
  [TASK_TYPE.EMAIL]: 10,
  [TASK_TYPE.FOLLOW_UP]: 15,
  [TASK_TYPE.DOCUMENT]: 30,
});

export const TASK_STATUS = Object.freeze({
  OPEN: 'open',
  DONE: 'done',
  CANCELLED: 'cancelled',
});
export const TASK_STATUS_VALUES = Object.values(TASK_STATUS);

export const TASK_PRIORITY = Object.freeze({ LOW: 'low', NORMAL: 'normal', HIGH: 'high' });
export const TASK_PRIORITY_VALUES = Object.values(TASK_PRIORITY);

/**
 * The events the rule engine reacts to.
 *
 * Named constants rather than loose strings so a typo in a rule is a missing
 * import rather than a rule that silently never fires — the worst failure mode
 * an automation can have, because nothing appears to be wrong.
 */
export const CRM_EVENT = Object.freeze({
  LEAD_CREATED: 'lead.created',
  LEAD_STATUS_CHANGED: 'lead.status_changed',
  DEAL_STAGE_CHANGED: 'deal.stage_changed',
  DEAL_CREATED: 'deal.created',
  /** Emitted by the sweep, not by a user action. */
  RECORD_WENT_QUIET: 'record.went_quiet',
});

/**
 * How long a record may go untouched before it counts as quiet.
 *
 * Three days, from the spec. Short enough that a stalling deal is caught while
 * it can still be saved, long enough that a normal weekend does not generate a
 * task for every open record on Monday morning.
 */
export const QUIET_AFTER_DAYS = 3;

/**
 * Speed to first contact, in minutes.
 *
 * The spec calls this the highest-leverage metric in the system and it is: a
 * lead answered inside the hour converts far better than the same lead
 * answered tomorrow. So the first task is due in HOURS, not days.
 */
export const FIRST_CALL_DUE_MINUTES = 120;

/* ── Tickets ─────────────────────────────────────────────────── */

/**
 * A ticket's life.
 *
 * `pending` is separate from `open` because it is the one state where the
 * delay belongs to the customer: the SLA clock stops there. Without it, a desk
 * that asks a customer for a screenshot is punished for asking, and the
 * fastest route to a green SLA report becomes never asking anything.
 */
export const TICKET_STATUS = Object.freeze({
  OPEN: 'open',
  PENDING: 'pending',
  RESOLVED: 'resolved',
  CLOSED: 'closed',
});
export const TICKET_STATUS_VALUES = Object.values(TICKET_STATUS);

/** Still the desk's problem — the SLA sweep looks only at these. */
export const TICKET_OPEN_STATUSES = Object.freeze([TICKET_STATUS.OPEN, TICKET_STATUS.PENDING]);

export const TICKET_PRIORITY = Object.freeze({
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high',
  URGENT: 'urgent',
});
export const TICKET_PRIORITY_VALUES = Object.values(TICKET_PRIORITY);

export const TICKET_SOURCE_VALUES = Object.freeze(['manual', 'email', 'phone', 'whatsapp', 'web']);

/**
 * The targets a desk starts with, in WORKING minutes — see
 * tickets/businessHours.js for why that is not the same as minutes.
 *
 * Seeded into a policy document on first use and edited there. They are a
 * starting point, not a rule: the whole point of the policy collection is that
 * the business can change these without a deployment.
 */
export const DEFAULT_SLA_TARGETS = Object.freeze([
  { priority: TICKET_PRIORITY.URGENT, firstResponseMinutes: 30, resolutionMinutes: 240 },
  { priority: TICKET_PRIORITY.HIGH, firstResponseMinutes: 60, resolutionMinutes: 480 },
  { priority: TICKET_PRIORITY.NORMAL, firstResponseMinutes: 240, resolutionMinutes: 1440 },
  { priority: TICKET_PRIORITY.LOW, firstResponseMinutes: 480, resolutionMinutes: 2880 },
]);

/* ── SLA escalation, warning and CSAT ────────────────────────── */

/**
 * How far through its SLA a ticket must be before somebody else is told.
 *
 * A LADDER, NOT A SINGLE ALARM. One notification at breach tells the person
 * who already knew, at the moment nothing can be done. Escalating in stages
 * means the first nudge arrives while the ticket can still be saved, and each
 * later rung reaches someone with more room to act.
 *
 * `atPercent` is measured in WORKING minutes against the live clock — first
 * response while nobody has replied, resolution after that. 150% raises the
 * priority as well, because a ticket that is half again past its target is,
 * by definition, more urgent than it was recorded as being.
 */
export const ESCALATION_LADDER = Object.freeze([
  { level: 1, atPercent: 100, audience: 'team-leader', raisePriority: false },
  { level: 2, atPercent: 150, audience: 'manager', raisePriority: true },
  { level: 3, atPercent: 200, audience: 'leadership', raisePriority: false },
]);

/**
 * Warn BEFORE the breach, not after.
 *
 * Telling somebody their ticket is late is a report. Telling them it is about
 * to be late is a chance to prevent it, which is the only version of this that
 * changes an outcome. Sent once per ticket.
 */
export const SLA_WARNING_PERCENT = 75;

/** One tap, five options. More granularity than this is not answered honestly. */
export const CSAT_SCORES = Object.freeze([1, 2, 3, 4, 5]);
export const CSAT_LABELS = Object.freeze({
  1: 'Very poor', 2: 'Poor', 3: 'Okay', 4: 'Good', 5: 'Excellent',
});
