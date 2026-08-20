import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { ApiError } from '../../../core/utils/ApiError.js';
import { Ticket, SlaPolicy } from './ticket.model.js';
import { CrmActivity } from '../activities/crmActivity.model.js';
import { Contact } from '../contacts/contact.model.js';
import { User } from '../../auth/auth.model.js';
import { ROLES } from '../../../core/constants/index.js';
import { buildScope, canManageCrm } from '../shared/scope.js';
import { resolveAssignee } from '../shared/ownership.js';
import {
  TICKET_STATUS, TICKET_OPEN_STATUSES, TICKET_PRIORITY, TICKET_PRIORITY_VALUES,
  DEFAULT_SLA_TARGETS, ACTIVITY_TYPE, ENTITY_TYPE,
  ESCALATION_LADDER, SLA_WARNING_PERCENT, CSAT_SCORES,
} from '../crm.constants.js';
import { addBusinessMinutes, businessMinutesBetween, normaliseCalendar } from './businessHours.js';
import { withRecordTenant } from '../../../core/tenancy/tenantContext.js';

/**
 * Tickets, and the clock on them.
 *
 * THE ONE RULE WORTH STATING TWICE: every duration here is WORKING minutes,
 * measured against the policy's calendar. A ticket raised at 18:40 on Friday
 * with a four-hour target is due at 13:00 on Monday, not at 22:40 on Friday.
 * Wall-clock SLAs breach overnight and over every weekend, and a desk whose
 * alerts are wrong by construction learns to ignore all of them — including
 * the true ones. See businessHours.js.
 *
 * DEADLINES ARE WRITTEN, NOT DERIVED. Two thousand open tickets cannot each
 * recompute a business-hours deadline on every list request, and a target that
 * moves under a ticket after the fact makes "did we breach?" unanswerable. So
 * the deadline is stamped when the ticket is created or re-prioritised, and
 * editing a policy leaves existing tickets on the deadline they were given.
 */

/** The policy every ticket falls back to, created on first use. */
async function defaultPolicy() {
  const existing = await SlaPolicy.findOne({ isDefault: true });
  if (existing) return existing;
  return SlaPolicy.create({
    name: 'Standard',
    isDefault: true,
    targets: DEFAULT_SLA_TARGETS.map((t) => ({ ...t })),
  });
}

/** The targets for one priority, falling back to `normal` then to anything. */
function targetsFor(policy, priority) {
  const list = policy?.targets || [];
  return list.find((t) => t.priority === priority)
    || list.find((t) => t.priority === TICKET_PRIORITY.NORMAL)
    || list[0]
    || DEFAULT_SLA_TARGETS.find((t) => t.priority === priority)
    || DEFAULT_SLA_TARGETS[2];
}

/** Both deadlines for a ticket, from a starting instant. */
export function deadlinesFor(policy, priority, from) {
  const target = targetsFor(policy, priority);
  const calendar = normaliseCalendar(policy?.calendar);
  return {
    dueFirstResponseAt: addBusinessMinutes(from, target.firstResponseMinutes, calendar),
    dueResolutionAt: addBusinessMinutes(from, target.resolutionMinutes, calendar),
  };
}

/**
 * The next ticket number.
 *
 * A counter document rather than a count of the collection: counting breaks
 * the moment one ticket is deleted, and two tickets created in the same second
 * would take the same number.
 */
async function nextNumber() {
  const { db } = mongoose.connection;
  const row = await db.collection('crm_counters').findOneAndUpdate(
    { _id: 'ticket' },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' },
  );
  const seq = row?.seq ?? row?.value?.seq ?? 1;
  return `TKT-${String(seq).padStart(4, '0')}`;
}

/**
 * How far through its SLA a ticket is, as a percentage.
 *
 * THE LIVE CLOCK, not both at once. While nobody has replied, the clock that
 * matters is first response — that is what the customer is waiting on. Once
 * somebody has, it becomes resolution. Averaging the two, or escalating on
 * whichever is worse, produces a number nobody can act on: "this ticket is at
 * 140%" has to name one deadline or it means nothing.
 *
 * Waiting on the customer is subtracted, same as everywhere else, so a desk is
 * never escalated for a delay that was not theirs.
 *
 * @returns {{percent: number, clock: 'first-response'|'resolution', target: number, used: number}}
 */
export function slaProgress(ticket, policy, now = new Date()) {
  const target = targetsFor(policy, ticket.priority);
  const calendar = normaliseCalendar(policy?.calendar);

  const answered = Boolean(ticket.firstRespondedAt);
  const budget = answered ? target.resolutionMinutes : target.firstResponseMinutes;
  const clock = answered ? 'resolution' : 'first-response';

  const gross = businessMinutesBetween(ticket.createdAt, now, calendar);
  const used = Math.max(0, gross - (ticket.pendingMinutes || 0));

  // A zero-minute target would divide by zero. Treated as already due, which
  // is what a zero target means.
  const percent = budget > 0 ? Math.round((used / budget) * 100) : 100;
  return {
    percent, clock, target: budget, used,
  };
}

/**
 * Who a rung of the ladder actually reaches.
 *
 * Mapped onto the roles this system HAS rather than the org chart it does not.
 * There is no "team leader" relationship on a user — nobody has modelled one —
 * so the first rung means "a manager in this person's own department", which
 * is the nearest true thing. Inventing a reporting line here would produce
 * escalations that go to the wrong person and look authoritative doing it.
 *
 * Each rung falls back to the one above when nobody matches: a ticket that
 * cannot find a team leader must still reach somebody, because the whole point
 * of escalating is that the current holder is not acting.
 */
async function escalationAudience(audience, ownerId) {
  const owner = ownerId
    ? await User.findById(ownerId).select('department').lean()
    : null;

  if (audience === 'team-leader' && owner?.department) {
    const local = await User.find({
      role: ROLES.MANAGER, department: owner.department, isActive: { $ne: false },
    }).select('_id name').lean();
    if (local.length) return local;
  }

  if (audience === 'team-leader' || audience === 'manager') {
    const managers = await User.find({ role: ROLES.MANAGER, isActive: { $ne: false } })
      .select('_id name').lean();
    if (managers.length) return managers;
  }

  return User.find({ role: { $in: [ROLES.MD, ROLES.EA] }, isActive: { $ne: false } })
    .select('_id name').lean();
}

/** One step up the priority scale, stopping at urgent. */
function raisedPriority(current) {
  const order = [TICKET_PRIORITY.LOW, TICKET_PRIORITY.NORMAL, TICKET_PRIORITY.HIGH, TICKET_PRIORITY.URGENT];
  const at = order.indexOf(current);
  return at === -1 || at === order.length - 1 ? current : order[at + 1];
}

/**
 * Working minutes the desk is answerable for, between two instants.
 *
 * `pendingMinutes` — time spent waiting on the customer — is subtracted,
 * because it is the customer's delay and charging the desk for it teaches the
 * desk not to ask questions.
 */
function deskMinutes(ticket, from, to, calendar) {
  const gross = businessMinutesBetween(from, to, calendar);
  return Math.max(0, gross - (ticket.pendingMinutes || 0));
}

export const ticketService = {
  deadlinesFor,

  async policies() {
    await defaultPolicy();
    return SlaPolicy.find().sort({ isDefault: -1, name: 1 }).lean();
  },

  async updatePolicy(id, body, user) {
    if (!canManageCrm(user)) {
      throw ApiError.forbidden('Only a manager can change SLA targets', { code: 'SLA_FORBIDDEN' });
    }
    const policy = await SlaPolicy.findById(id);
    if (!policy) throw ApiError.notFound('Policy not found');

    if (Array.isArray(body.targets)) {
      for (const t of body.targets) {
        if (!TICKET_PRIORITY_VALUES.includes(t.priority)) {
          throw ApiError.badRequest(`Unknown priority "${t.priority}"`, { code: 'SLA_BAD_PRIORITY' });
        }
        if (!(t.firstResponseMinutes >= 0) || !(t.resolutionMinutes >= 0)) {
          throw ApiError.badRequest('SLA targets must be zero or more minutes', { code: 'SLA_BAD_TARGET' });
        }
        if (t.resolutionMinutes < t.firstResponseMinutes) {
          // Otherwise a ticket is late to be resolved before anyone was even
          // late to answer it, and every report reads as nonsense.
          throw ApiError.badRequest(
            `Resolution target must not be shorter than the first-response target (${t.priority})`,
            { code: 'SLA_TARGETS_INVERTED' },
          );
        }
      }
      policy.targets = body.targets;
    }

    if (body.calendar) {
      const c = body.calendar;
      if (c.startMinute != null && c.endMinute != null && c.endMinute <= c.startMinute) {
        throw ApiError.badRequest('The working day must end after it starts', { code: 'SLA_BAD_HOURS' });
      }
      if (Array.isArray(c.workDays) && !c.workDays.length) {
        // With no working days there is no moment any deadline can fall on,
        // and every SLA calculation would run to its guard and throw.
        throw ApiError.badRequest('A calendar needs at least one working day', { code: 'SLA_NO_WORKDAYS' });
      }
      policy.calendar = { ...policy.calendar.toObject?.() ?? policy.calendar, ...c };
    }

    await policy.save();
    return policy.toObject();
  },

  /**
   * Raise a ticket. The clock starts now.
   *
   * `assignedTo` goes through the shared `resolveAssignee` rather than being
   * read off the body, exactly as leads and tasks do — one definition of who
   * may be given work, so a viewer cannot be handed a ticket through whichever
   * door happens to be newest.
   */
  async create(body, user) {
    if (!body?.subject?.trim()) throw ApiError.badRequest('A ticket needs a subject');

    const policy = await defaultPolicy();
    const priority = TICKET_PRIORITY_VALUES.includes(body.priority)
      ? body.priority : TICKET_PRIORITY.NORMAL;
    const now = new Date();

    const assignedTo = await resolveAssignee(body.assignedTo, user, {
      User, canManage: canManageCrm, badRequest: ApiError.badRequest, forbidden: ApiError.forbidden,
    });

    let requester = null;
    if (body.requester && mongoose.isValidObjectId(body.requester)) {
      requester = await Contact.exists({ _id: body.requester }) ? body.requester : null;
    }

    const ticket = await Ticket.create({
      number: await nextNumber(),
      subject: body.subject.trim(),
      description: body.description,
      priority,
      category: body.category,
      source: body.source || 'manual',
      requester,
      entityType: body.entityType,
      entityId: mongoose.isValidObjectId(body.entityId) ? body.entityId : undefined,
      assignedTo,
      createdBy: user._id || user.id,
      slaPolicy: policy._id,
      ...deadlinesFor(policy, priority, now),
      lastActivityAt: now,
    });

    await CrmActivity.create({
      type: ACTIVITY_TYPE.SYSTEM,
      entityType: ENTITY_TYPE.TICKET,
      entityId: ticket._id,
      subject: `Ticket ${ticket.number} raised`,
      body: ticket.subject,
      actor: user._id || user.id,
      occurredAt: now,
    });

    return ticket.toObject();
  },

  async list(query, user) {
    const where = { ...buildScope(user) };

    if (query.status) where.status = query.status;
    else if (query.open !== 'false') where.status = { $in: TICKET_OPEN_STATUSES };
    if (query.priority) where.priority = query.priority;
    if (query.assignedTo) where.assignedTo = query.assignedTo;
    if (query.breached === 'true') {
      where.$or = [{ firstResponseBreached: true }, { resolutionBreached: true }];
    }
    if (query.search) {
      const rx = new RegExp(String(query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      where.$and = [...(where.$and || []), { $or: [{ subject: rx }, { number: rx }] }];
    }

    const limit = Math.min(Number(query.limit) || 50, 200);
    if (query.escalated === 'true') where.escalationLevel = { $gt: 0 };
    // { total, items } — the same shape leads, contacts and tasks return, so
    // one list component can render any of them without a translation layer.
    const [items, total] = await Promise.all([
      Ticket.find(where)
        .populate('assignedTo', 'name avatarColor')
        .populate('requester', 'name phone email')
        // Soonest deadline first: the list is a queue, not an archive.
        .sort({ dueResolutionAt: 1, createdAt: -1 })
        .limit(limit)
        .lean(),
      Ticket.countDocuments(where),
    ]);
    return { total, items };
  },

  async detail(id, user) {
    if (!mongoose.isValidObjectId(id)) return null;
    const ticket = await Ticket.findOne({ _id: id, ...buildScope(user) })
      .populate('assignedTo', 'name avatarColor')
      .populate('requester', 'name phone email')
      .lean();
    if (!ticket) return null;

    const timeline = await CrmActivity.find({ entityType: ENTITY_TYPE.TICKET, entityId: ticket._id })
      .populate('actor', 'name avatarColor').sort({ occurredAt: -1 }).limit(100).lean();

    /* Computed here, not in the client. "How far through its SLA is this?" is
       business-hours arithmetic against a calendar the browser does not have,
       and a second implementation of it would disagree with the escalation
       sweep the first time somebody edited a holiday list. */
    const policy = await SlaPolicy.findById(ticket.slaPolicy).lean();
    const progress = TICKET_OPEN_STATUSES.includes(ticket.status)
      ? slaProgress(ticket, policy)
      : null;

    return { ticket, timeline, progress };
  },

  /**
   * Record a reply to the CUSTOMER.
   *
   * This — and only this — stops the first-response clock. An internal note,
   * an assignment, or reading the ticket must not, because a desk that can
   * satisfy its SLA without talking to anybody reports beautifully and serves
   * nobody.
   */
  async respond(id, body, user) {
    const ticket = await Ticket.findById(id);
    if (!ticket) throw ApiError.notFound('Ticket not found');

    const policy = await SlaPolicy.findById(ticket.slaPolicy).lean();
    const calendar = normaliseCalendar(policy?.calendar);
    const now = new Date();
    const first = !ticket.firstRespondedAt;

    if (first) {
      ticket.firstRespondedAt = now;
      ticket.firstResponseMinutes = deskMinutes(ticket, ticket.createdAt, now, calendar);
      // Stamped here as well as by the sweep: a reply that lands after the
      // deadline is a breach whether or not a sweep has run yet, and leaving
      // it to the sweep alone would mark it late for a few minutes and then
      // silently mark it fine.
      if (now > ticket.dueFirstResponseAt) ticket.firstResponseBreached = true;
    }

    ticket.lastActivityAt = now;
    await ticket.save();

    await CrmActivity.create({
      type: body.channel === 'call' ? ACTIVITY_TYPE.CALL : ACTIVITY_TYPE.EMAIL,
      entityType: ENTITY_TYPE.TICKET,
      entityId: ticket._id,
      subject: first ? 'First response to the customer' : 'Replied to the customer',
      body: body.body,
      direction: 'outbound',
      actor: user._id || user.id,
      occurredAt: now,
    });

    return ticket.toObject();
  },

  /**
   * Change status. This is where the clock stops and starts.
   *
   * Moving to `pending` banks the working time spent waiting on the customer;
   * moving back out of it resumes. The banked total is subtracted from every
   * elapsed figure, so a desk is measured on its own delay and not the
   * customer's.
   */
  async setStatus(id, body, user) {
    const ticket = await Ticket.findById(id);
    if (!ticket) throw ApiError.notFound('Ticket not found');

    const next = body.status;
    if (!Object.values(TICKET_STATUS).includes(next)) {
      throw ApiError.badRequest(`Unknown status "${next}"`, { code: 'TICKET_BAD_STATUS' });
    }

    const policy = await SlaPolicy.findById(ticket.slaPolicy).lean();
    const calendar = normaliseCalendar(policy?.calendar);
    const now = new Date();
    const previous = ticket.status;
    if (previous === next) return ticket.toObject();

    // Leaving `pending`: bank the wait.
    if (previous === TICKET_STATUS.PENDING && ticket.pendingSince) {
      ticket.pendingMinutes = (ticket.pendingMinutes || 0)
        + businessMinutesBetween(ticket.pendingSince, now, calendar);
      ticket.pendingSince = undefined;
    }
    if (next === TICKET_STATUS.PENDING) ticket.pendingSince = now;

    if (next === TICKET_STATUS.RESOLVED && !ticket.resolvedAt) {
      ticket.resolvedAt = now;
      ticket.resolutionMinutes = deskMinutes(ticket, ticket.createdAt, now, calendar);
      if (now > ticket.dueResolutionAt) ticket.resolutionBreached = true;

      /* ASK ONCE, ON THE FIRST RESOLUTION. A ticket that is resolved, reopened
         and resolved again must not send a second rating request — the
         customer already answered, and asking again reads as not having
         listened. The token is minted here rather than at send time so the
         link survives the mail failing and being retried. */
      if (!ticket.csatToken) {
        ticket.csatToken = crypto.randomBytes(18).toString('base64url');
        ticket.csat = { ...(ticket.csat || {}), askedAt: now };
      }
    }
    if (next === TICKET_STATUS.CLOSED) {
      ticket.closedAt = now;
      if (!ticket.resolvedAt) ticket.resolvedAt = now;
    }

    /* REOPENING. The original deadline is kept rather than reset: a ticket
       reopened because it was not actually fixed did not get faster by being
       reopened, and a fresh clock would erase the breach that just happened.
       The count is what says this went round twice. */
    if (TICKET_OPEN_STATUSES.includes(next)
      && [TICKET_STATUS.RESOLVED, TICKET_STATUS.CLOSED].includes(previous)) {
      ticket.reopenCount += 1;
      ticket.resolvedAt = undefined;
      ticket.closedAt = undefined;
    }

    ticket.status = next;
    ticket.lastActivityAt = now;
    await ticket.save();

    await CrmActivity.create({
      type: ACTIVITY_TYPE.STAGE_CHANGE,
      entityType: ENTITY_TYPE.TICKET,
      entityId: ticket._id,
      subject: `${previous} → ${next}`,
      body: body.note,
      actor: user._id || user.id,
      occurredAt: now,
    });

    return ticket.toObject();
  },

  /**
   * Re-prioritise, which moves the deadline.
   *
   * Measured from when the ticket was RAISED, not from now — otherwise
   * bumping a ticket to urgent an hour before it breaches quietly buys another
   * four hours, and the priority field becomes a way to hide lateness.
   */
  async setPriority(id, body, user) {
    if (!TICKET_PRIORITY_VALUES.includes(body.priority)) {
      throw ApiError.badRequest(`Unknown priority "${body.priority}"`, { code: 'TICKET_BAD_PRIORITY' });
    }
    const ticket = await Ticket.findById(id);
    if (!ticket) throw ApiError.notFound('Ticket not found');

    const policy = await SlaPolicy.findById(ticket.slaPolicy).lean() || await defaultPolicy();
    const previous = ticket.priority;
    ticket.priority = body.priority;
    Object.assign(ticket, deadlinesFor(policy, body.priority, ticket.createdAt));
    ticket.lastActivityAt = new Date();
    await ticket.save();

    await CrmActivity.create({
      type: ACTIVITY_TYPE.SYSTEM,
      entityType: ENTITY_TYPE.TICKET,
      entityId: ticket._id,
      subject: `Priority ${previous} → ${body.priority}`,
      actor: user._id || user.id,
      occurredAt: new Date(),
    });

    return ticket.toObject();
  },

  /** Hand it to somebody else — through the same door as every other
   *  assignment, so the same people are eligible. */
  async assign(id, body, user) {
    const ticket = await Ticket.findById(id);
    if (!ticket) throw ApiError.notFound('Ticket not found');

    ticket.assignedTo = await resolveAssignee(body.assignedTo, user, {
      User, canManage: canManageCrm, badRequest: ApiError.badRequest, forbidden: ApiError.forbidden,
    });
    ticket.lastActivityAt = new Date();
    await ticket.save();
    return ticket.toObject();
  },

  /**
   * Stamp anything that has gone past its deadline. Run on a schedule.
   *
   * Only OPEN statuses are considered, and each flag is set once — a breach is
   * an event that happened, not a condition that keeps re-firing.
   */
  async sweepBreaches(now = new Date()) {
    const [firstResponse, resolution] = await Promise.all([
      Ticket.updateMany(
        {
          status: { $in: TICKET_OPEN_STATUSES },
          firstRespondedAt: null,
          firstResponseBreached: false,
          dueFirstResponseAt: { $lt: now },
        },
        { $set: { firstResponseBreached: true } },
      ),
      Ticket.updateMany(
        {
          status: { $in: TICKET_OPEN_STATUSES },
          resolutionBreached: false,
          dueResolutionAt: { $lt: now },
        },
        { $set: { resolutionBreached: true } },
      ),
    ]);
    return {
      firstResponse: firstResponse.modifiedCount || 0,
      resolution: resolution.modifiedCount || 0,
    };
  },

  slaProgress,

  /**
   * Record a rating from the one-tap link.
   *
   * PUBLIC, and identified only by the token — the customer has no login and
   * never will. That is why the token is 18 random bytes rather than the
   * ticket id: a sequential id would let anyone score every ticket in the
   * system by counting upwards.
   *
   * A LATER TAP OVERWRITES AN EARLIER ONE. People misclick a row of five
   * numbers in an email, and refusing the correction would bake the misclick
   * into the average forever. The link belongs to the customer, so whoever
   * holds it is entitled to change their mind.
   */
  async recordCsat(token, score, comment) {
    const value = Number(score);
    if (!token || !CSAT_SCORES.includes(value)) return null;

    const ticket = await Ticket.findOneAndUpdate(
      { csatToken: token },
      {
        $set: {
          'csat.score': value,
          'csat.ratedAt': new Date(),
          ...(comment ? { 'csat.comment': String(comment).slice(0, 1000) } : {}),
        },
      },
      { new: true },
    ).select('_id number subject csat').lean();
    if (!ticket) return null;

    await CrmActivity.create({
      type: ACTIVITY_TYPE.SYSTEM,
      entityType: ENTITY_TYPE.TICKET,
      entityId: ticket._id,
      subject: `Rated ${value}/5 by the customer`,
      body: comment ? String(comment).slice(0, 1000) : undefined,
      occurredAt: new Date(),
    });

    return ticket;
  },

  /** What the ticket behind a rating token looks like, for the public page. */
  async csatContext(token) {
    if (!token) return null;
    const ticket = await Ticket.findOne({ csatToken: token })
      .select('number subject csat resolvedAt').lean();
    if (!ticket) return null;
    return {
      number: ticket.number,
      subject: ticket.subject,
      alreadyRated: ticket.csat?.score || null,
    };
  },

  /**
   * Warn before the breach, and escalate after it.
   *
   * ONE PASS over the open tickets, because both questions need the same
   * expensive thing: how far through its SLA each ticket is, in working
   * minutes. Computing that twice would double the cost of the only genuinely
   * heavy query in this module.
   *
   * ORDER MATTERS. The warning fires at 75% and the first rung at 100%, so a
   * ticket that has already blown past both — one raised while everyone was
   * away, found at 210% — gets its warning suppressed and jumps straight to
   * the rung it has actually reached. Sending "this is about to breach" about
   * something that breached yesterday is how people learn to ignore the
   * warnings that arrive in time.
   */
  async sweepEscalations(now = new Date()) {
    const { notificationService } = await import('../../pms/notifications/notification.service.js');

    const open = await Ticket.find({ status: { $in: TICKET_OPEN_STATUSES } })
      .select('number subject priority status createdAt pendingMinutes firstRespondedAt '
        + 'assignedTo slaPolicy escalationLevel escalationHistory warnedAt tenant')
      .limit(500)
      .lean();
    if (!open.length) return { warned: 0, escalated: 0, considered: 0 };

    // One policy read for the whole sweep rather than one per ticket.
    const policies = new Map(
      (await SlaPolicy.find().lean()).map((p) => [String(p._id), p]),
    );

    let warned = 0;
    let escalated = 0;

    for (const ticket of open) {
      /* The scan spans companies on purpose — a breach matters in every
         one — but every write below belongs to THIS ticket's company.
         Without this the escalation's audit row and its notification are
         written with no tenant, and are invisible to the very people they
         exist to reach. Same reason as the reminder sweep. */
      // eslint-disable-next-line no-await-in-loop
      await withRecordTenant(ticket, async () => {
        const policy = policies.get(String(ticket.slaPolicy));
        const { percent, clock } = slaProgress(ticket, policy, now);

        /* Which rung this ticket has actually reached — the HIGHEST it qualifies
           for, not the next one up. A ticket found at 210% belongs at level 3,
           and walking it up one rung per sweep would take fifteen minutes to
           tell the person who needed to know a day ago. */
        const rung = [...ESCALATION_LADDER].reverse().find((r) => percent >= r.atPercent);
        const owner = ticket.assignedTo;

        if (rung && rung.level > (ticket.escalationLevel || 0)) {
          // eslint-disable-next-line no-await-in-loop
          const audience = await escalationAudience(rung.audience, owner);
          const update = {
            $set: { escalationLevel: rung.level, escalatedAt: now },
            $push: {
              escalationHistory: {
                level: rung.level,
                atPercent: percent,
                audience: rung.audience,
                notified: audience.map((u) => u._id),
                at: now,
              },
            },
          };
          // 150% raises the priority too: a ticket half again past its target is
          // more urgent than whoever raised it believed.
          if (rung.raisePriority) {
            const next = raisedPriority(ticket.priority);
            if (next !== ticket.priority) update.$set.priority = next;
          }

          // eslint-disable-next-line no-await-in-loop
          await Ticket.updateOne({ _id: ticket._id }, update);

          if (audience.length) {
            // eslint-disable-next-line no-await-in-loop
            await notificationService.notify({
              recipients: [...audience.map((u) => u._id), owner].filter(Boolean),
              type: 'crm_ticket_escalated',
              title: `Escalated (${percent}%): ${ticket.subject}`,
              message: `${ticket.number} is at ${percent}% of its ${clock.replace('-', ' ')} target.`,
              link: `/crm/tickets?open=${ticket._id}`,
            });
          }
          escalated += 1;
          return;
        }

        if (percent >= SLA_WARNING_PERCENT && !ticket.warnedAt && !rung && owner) {
          // eslint-disable-next-line no-await-in-loop
          await Ticket.updateOne({ _id: ticket._id }, { $set: { warnedAt: now } });
          // eslint-disable-next-line no-await-in-loop
          await notificationService.notify({
            recipients: [owner],
            type: 'crm_ticket_warning',
            title: `Due soon (${percent}%): ${ticket.subject}`,
            message: `${ticket.number} has used ${percent}% of its ${clock.replace('-', ' ')} time.`,
            link: `/crm/tickets?open=${ticket._id}`,
          });
          warned += 1;
        }
      });
    }

    return { warned, escalated, considered: open.length };
  },

  /** The numbers a desk lead looks at. */
  async summary(user) {
    const base = { ...buildScope(user) };
    const [open, pending, breachedFirst, breachedResolution, resolvedRows] = await Promise.all([
      Ticket.countDocuments({ ...base, status: TICKET_STATUS.OPEN }),
      Ticket.countDocuments({ ...base, status: TICKET_STATUS.PENDING }),
      Ticket.countDocuments({ ...base, status: { $in: TICKET_OPEN_STATUSES }, firstResponseBreached: true }),
      Ticket.countDocuments({ ...base, status: { $in: TICKET_OPEN_STATUSES }, resolutionBreached: true }),
      Ticket.find({ ...base, firstResponseMinutes: { $ne: null } })
        .select('firstResponseMinutes resolutionMinutes firstResponseBreached').limit(500).lean(),
    ]);

    const answered = resolvedRows.length;
    const median = (list) => {
      const s = list.filter((n) => n != null).sort((a, b) => a - b);
      if (!s.length) return null;
      return s[Math.floor(s.length / 2)];
    };

    return {
      open,
      pending,
      breachedFirstResponse: breachedFirst,
      breachedResolution,
      /* MEDIAN, NOT MEAN. One ticket that sat over a long weekend drags a mean
         into uselessness, and the number is meant to describe the typical
         customer's experience. Null when nothing has been answered yet, rather
         than a zero that reads as instant service. */
      medianFirstResponseMinutes: median(resolvedRows.map((t) => t.firstResponseMinutes)),
      medianResolutionMinutes: median(resolvedRows.map((t) => t.resolutionMinutes)),
      answered,
      onTimeRate: answered
        ? Math.round(((answered - resolvedRows.filter((t) => t.firstResponseBreached).length) / answered) * 100)
        : null,
    };
  },
};

export default ticketService;
