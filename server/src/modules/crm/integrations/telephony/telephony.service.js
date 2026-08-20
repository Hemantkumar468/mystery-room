import { EventEmitter } from 'node:events';
import { telephonyProvider } from './telephony.provider.js';
import { CrmRing } from './ringRegistry.js';
import { CrmActivity } from '../../activities/crmActivity.model.js';
import { Lead } from '../../leads/lead.model.js';
import { Contact } from '../../contacts/contact.model.js';
import { User } from '../../../auth/auth.model.js';
import { normalisePhone } from '../../intake/phone.js';
import { ACTIVITY_TYPE, ENTITY_TYPE, ACTIVITY_DIRECTION } from '../../crm.constants.js';
import { config } from '../../../../config/index.js';
import { ApiError } from '../../../../core/utils/ApiError.js';
import { logger } from '../../../../config/logger.js';

/**
 * Calls: placing them, recording them, and putting the caller on screen before
 * the agent picks up.
 *
 * THE SCREEN-POP IS THE POINT. Everything else here saves an agent a few
 * seconds; the pop is the feature that makes them keep the CRM open all day,
 * and a CRM nobody keeps open fills up with data nobody trusts.
 *
 * Delivered by LONG POLL rather than a socket: the client holds a request open
 * and the webhook wakes it. That needs no new dependency, no second auth path
 * (the token lives in localStorage, so EventSource could not send it anyway),
 * and it survives a reconnect because the ring is a row with a TTL, not an
 * event that has already gone past.
 *
 * KNOWN LIMIT. The emitter below is per process, so with two API instances a
 * poll held on instance A is not woken by a webhook that lands on instance B —
 * it falls back to the poll's own timeout, which makes the pop up to `waitMs`
 * late instead of instant. The row is what makes that a delay rather than a
 * miss. A shared bus is the fix when a second instance actually exists.
 */

const rings = new EventEmitter();
// One listener per waiting agent; the default cap of 10 would warn on the
// eleventh person to open the CRM.
rings.setMaxListeners(200);

/** Who should see this call — the person who owns the record it belongs to. */
async function resolveCaller(rawNumber) {
  const phone = normalisePhone(rawNumber);
  if (!phone) return { matchType: 'unknown' };

  // Contact first: a known person outranks the enquiry they came in through,
  // because that is the record with the relationship on it.
  const contact = await Contact.findOne({ phone })
    .select('name company city owner').populate('company', 'name').lean();
  if (contact) {
    return {
      matchType: 'contact',
      matchId: contact._id,
      matchName: contact.name,
      matchSummary: [contact.company?.name, contact.city].filter(Boolean).join(' · '),
      agent: contact.owner,
    };
  }

  const lead = await Lead.findOne({ phone })
    .sort({ createdAt: -1 })
    .select('name company city status assignedTo').lean();
  if (lead) {
    return {
      matchType: 'lead',
      matchId: lead._id,
      matchName: lead.name,
      matchSummary: [lead.company, lead.city, lead.status].filter(Boolean).join(' · '),
      agent: lead.assignedTo,
    };
  }

  return { matchType: 'unknown', phone };
}

export const telephonyService = {
  /**
   * Ring the agent, then the customer.
   *
   * The agent's own mobile is used as the leg to ring, and the CUSTOMER sees
   * the company caller id — that masking is the main reason to use cloud
   * telephony at all rather than a `tel:` link.
   */
  async clickToCall({ entityType, entityId }, user) {
    const provider = telephonyProvider();
    if (!provider.configured) {
      throw ApiError.badRequest(
        'Telephony is not set up yet — no calls can be placed.',
        { code: 'TELEPHONY_NOT_CONFIGURED' },
      );
    }

    const agent = await User.findById(user._id || user.id).select('name phone').lean();
    if (!agent?.phone) {
      // Said plainly, because the fix is a profile edit and a generic failure
      // would send them to support instead.
      throw ApiError.badRequest(
        'Your profile has no phone number, so there is nothing to ring. Add one first.',
        { code: 'AGENT_PHONE_MISSING' },
      );
    }

    const Model = entityType === ENTITY_TYPE.CONTACT ? Contact : Lead;
    const record = await Model.findById(entityId).select('name phone doNotDisturb').lean();
    if (!record) throw ApiError.notFound('That record no longer exists');
    if (!record.phone) throw ApiError.badRequest('That record has no phone number');
    if (record.doNotDisturb) {
      // A compliance fact, not a preference — refused rather than warned about.
      throw ApiError.badRequest(
        `${record.name} has asked not to be called.`,
        { code: 'DO_NOT_DISTURB' },
      );
    }

    const callbackUrl = `${config.publicApiUrl}/crm/public/webhooks/telephony/status`
      + `?t=${encodeURIComponent(config.crm.telephony.webhookSecret || '')}`;

    const { providerCallId, status } = await provider.placeCall({
      agentPhone: agent.phone,
      customerPhone: record.phone,
      callbackUrl,
    });

    logger.info(`Click-to-call ${providerCallId}: ${agent.name} → ${record.name}`);
    return { providerCallId, status, calling: record.name };
  },

  /**
   * A call ended. Write it to the timeline.
   *
   * IDEMPOTENT by `providerEventId`: providers retry on any non-2xx, so the
   * same completed call arrives two or three times, and without the unique
   * index this would be three rows on one customer's history.
   */
  async recordCallEnded(event, { actorId } = {}) {
    const match = await resolveCaller(
      event.direction === ACTIVITY_DIRECTION.INBOUND ? event.from : event.to,
    );

    const entityType = match.matchType === 'unknown' ? null : match.matchType;
    if (!entityType) {
      logger.info(`Call ${event.providerCallId} from ${event.from} matched no record — not logged`);
      return null;
    }

    const minutes = event.durationSeconds ? Math.round(event.durationSeconds / 60) : 0;
    const doc = {
      type: ACTIVITY_TYPE.CALL,
      entityType,
      entityId: match.matchId,
      direction: event.direction,
      subject: `${event.direction === 'inbound' ? 'Inbound' : 'Outbound'} call`
        + (event.durationSeconds ? ` · ${minutes || '<1'} min` : ''),
      occurredAt: event.startedAt,
      actor: actorId || match.agent || undefined,
      providerEventId: event.providerCallId,
      meta: {
        status: event.status,
        durationSeconds: event.durationSeconds,
        from: event.from,
        to: event.to,
        // The provider's URL, kept only until the job swaps it for an S3 key —
        // these expire, which is exactly why the audio is downloaded.
        recordingUrl: event.recordingUrl || undefined,
      },
    };

    try {
      const activity = await CrmActivity.create(doc);
      return activity.toObject();
    } catch (err) {
      // Duplicate key = the same webhook delivered twice. Update rather than
      // fail: the retry usually carries MORE than the first (a duration, a
      // recording url), so the second delivery is worth keeping.
      if (err.code === 11000) {
        const updated = await CrmActivity.findOneAndUpdate(
          { providerEventId: event.providerCallId },
          { $set: { subject: doc.subject, meta: doc.meta } },
          { new: true },
        ).lean();
        logger.info(`Call ${event.providerCallId} was already logged — updated instead`);
        return updated;
      }
      throw err;
    }
  },

  /**
   * A call is RINGING. Put it on the right agent's screen.
   *
   * Runs before the agent answers, which is the entire value: reading who is
   * calling after picking up is not a screen-pop, it is a distraction.
   */
  async registerRing(event) {
    const match = await resolveCaller(event.from);

    // Unknown numbers still pop — with a "create this lead" affordance. An
    // unrecognised caller is the one where knowing nothing hurts most, and the
    // one most likely to be new business.
    const agent = match.agent || null;
    if (!agent) {
      logger.info(`Inbound ${event.providerCallId} from ${event.from}: no agent owns this caller`);
      return null;
    }

    const ring = await CrmRing.findOneAndUpdate(
      { providerCallId: event.providerCallId },
      {
        $set: {
          agent,
          from: event.from,
          to: event.to,
          matchType: match.matchType,
          matchId: match.matchId,
          matchName: match.matchName,
          matchSummary: match.matchSummary,
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true, new: true },
    ).lean();

    // Wake anybody already holding a poll. Instant path; the row is the
    // fallback for a reconnect or a second instance.
    rings.emit(String(agent), ring);
    logger.info(`Inbound ${event.providerCallId} popped for ${match.matchName || event.from}`);
    return ring;
  },

  /**
   * The long poll behind the pop.
   *
   * Returns immediately if something is already ringing; otherwise holds the
   * request until one arrives or the timeout expires. One request per agent
   * per ~25 seconds instead of one every two — same latency, a fraction of the
   * traffic, and no socket to authenticate.
   */
  async waitForRing(user, waitMs = 25_000) {
    const me = String(user._id || user.id);

    const existing = await CrmRing.findOneAndUpdate(
      { agent: me, deliveredAt: null },
      { $set: { deliveredAt: new Date() } },
      { new: true, sort: { createdAt: -1 } },
    ).lean();
    if (existing) return existing;

    return new Promise((resolve) => {
      const done = async (ring) => {
        clearTimeout(timer);
        rings.off(me, done);
        if (!ring) { resolve(null); return; }

        /* Stamp it here too, not only on the database path above.
         *
         * Without this the live path leaves `deliveredAt` unset, so the very
         * next poll finds the same row waiting and pops the same call a second
         * time — the agent sees the card appear, dismiss, and appear again
         * while they are still talking to the person on it. */
        await CrmRing.updateOne({ _id: ring._id }, { $set: { deliveredAt: new Date() } });
        resolve(ring);
      };
      const timer = setTimeout(() => done(null), waitMs);
      rings.once(me, done);
    });
  },

  /** Test seam — the emitter, so a suite can assert a poll was woken. */
  __rings: rings,
};

export default telephonyService;
