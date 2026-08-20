import { Lead } from '../leads/lead.model.js';
import { CrmActivity } from '../activities/crmActivity.model.js';
import { findDuplicate } from './dedupe.service.js';
import { normalisePhone } from './phone.js';
import { routingService } from '../routing/routing.service.js';
import { taskService } from '../tasks/task.service.js';
import {
  LEAD_SOURCE, LEAD_STATUS, ACTIVITY_TYPE, ENTITY_TYPE, ACTIVITY_DIRECTION, CRM_EVENT,
} from '../crm.constants.js';
import { ApiError } from '../../../core/utils/ApiError.js';
import { logger } from '../../../config/logger.js';

/**
 * THE way a lead enters the system.
 *
 *   web form ─┐
 *   Meta ads ─┤
 *   LinkedIn ─┼──→ intake() ──→ normalise → dedupe → create → route → timeline
 *   manual  ──┘
 *
 * Four intake paths, one function, because every rule that matters is a rule
 * about intake: the phone number has to be normalised the same way or the
 * duplicate check goes quiet; routing has to run or the lead has no owner; a
 * re-enquiry has to attach to the record it repeats or the buying signal is
 * lost. A second `Lead.create()` anywhere else is a path where one of those
 * silently does not happen.
 *
 * Controllers translate their own payload shape into this one and call here.
 * They never touch the Lead model directly.
 */

/** Only the fields a lead legitimately arrives with. Anything else in the
 *  payload — status, assignedTo, timestamps — is the system's to decide, and
 *  a public endpoint that let a caller set them would let a caller assign
 *  themselves leads. */
const INTAKE_FIELDS = [
  'name', 'email', 'company', 'designation', 'city', 'region', 'country',
  'message', 'productInterest', 'estimatedValue', 'segment', 'language',
  'source', 'sourceDetail', 'formId', 'externalId', 'utm',
];

function pickIntakeFields(payload) {
  const out = {};
  for (const key of INTAKE_FIELDS) {
    if (payload[key] !== undefined && payload[key] !== '') out[key] = payload[key];
  }
  return out;
}

export const leadIntakeService = {
  /**
   * @param {object} payload            the enquiry, in lead shape
   * @param {object} [opts]
   * @param {object} [opts.actor]       the user, for manual entry
   * @param {boolean} [opts.force]      create even if a duplicate was found
   * @returns {Promise<{ lead: object, duplicate: object|null, created: boolean }>}
   *   `created: false` means this was a re-enquiry recorded against an
   *   existing lead — the caller should not treat it as a new record.
   */
  async intake(payload = {}, opts = {}) {
    const values = pickIntakeFields(payload);

    if (!values.name || !String(values.name).trim()) {
      throw ApiError.badRequest('A lead needs a name', { code: 'LEAD_NAME_REQUIRED' });
    }

    /* ── 1. Normalise ─────────────────────────────────────────
       Before the duplicate check, never after: the check compares against the
       E.164 column, so an un-normalised number matches nothing and every
       repeat enquiry looks new. */
    const phoneRaw = payload.phone ? String(payload.phone).trim() : null;
    const phone = normalisePhone(phoneRaw);
    if (phoneRaw && !phone) {
      logger.warn(`CRM intake: unusable phone "${phoneRaw}" — keeping the raw value only`);
    }

    if (!phone && !values.email) {
      throw ApiError.badRequest(
        'A lead needs a phone number or an email address — otherwise nobody can follow it up',
        { code: 'LEAD_CONTACTABLE_REQUIRED' },
      );
    }

    /* ── 2. Idempotency, for the paths that have an id ────────
       Meta retries a webhook on any non-2xx, so the same submission arrives
       two or three times. Checked before dedupe because it is exact: this is
       not a repeat enquiry, it is the same delivery twice. */
    if (values.externalId) {
      const already = await Lead.findOne({ externalId: values.externalId }).lean();
      if (already) {
        logger.info(`CRM intake: ignoring repeat delivery of ${values.externalId}`);
        return { lead: already, duplicate: null, created: false };
      }
    }

    /* ── 3. Duplicate check ───────────────────────────────── */
    const duplicate = await findDuplicate({
      phone, email: values.email, name: values.name, company: values.company,
    });

    if (duplicate.isDuplicate && !opts.force) {
      const existing = duplicate.lead;
      if (existing) {
        // A REPEAT ENQUIRY. Not a second record: the same person asking again
        // is the strongest buying signal an enquiry can carry, and splitting
        // it across two leads hides that from whoever is working the first.
        await Promise.all([
          Lead.updateOne(
            { _id: existing._id },
            { $inc: { reEnquiryCount: 1 }, $set: { lastActivityAt: new Date() } },
          ),
          CrmActivity.create({
            type: ACTIVITY_TYPE.SYSTEM,
            entityType: ENTITY_TYPE.LEAD,
            entityId: existing._id,
            direction: ACTIVITY_DIRECTION.INBOUND,
            subject: 'Re-enquiry',
            body: [
              `Enquired again via ${values.source || LEAD_SOURCE.OTHER}`,
              values.sourceDetail && `(${values.sourceDetail})`,
              values.message && `\n\n"${String(values.message).slice(0, 500)}"`,
            ].filter(Boolean).join(' '),
            occurredAt: new Date(),
            meta: { matchedOn: duplicate.matchedOn, utm: values.utm || null },
          }),
        ]);

        const lead = await Lead.findById(existing._id).lean();
        return { lead, duplicate, created: false };
      }

      // Matched a CONTACT but no open lead: this person is known, but has no
      // enquiry running. That is new business from an existing relationship,
      // so a lead is created and linked rather than suppressed.
      values.contact = duplicate.contact?._id;
    }

    /* ── 4. Route, synchronously ──────────────────────────────
       Inside creation rather than after it, so the lead is never visible in an
       unassigned state — the list views, the response-time clock and the stale
       sweep all key on `assignedTo`. */
    const draft = { ...values, phone, phoneRaw };
    const { assignedTo, routedBy } = await routingService.route(draft);

    const lead = await Lead.create({
      ...draft,
      status: LEAD_STATUS.NEW,
      assignedTo,
      routedBy,
      assignedAt: assignedTo ? new Date() : undefined,
      createdBy: opts.actor?._id || opts.actor?.id,
    });

    /* ── 5. Timeline ──────────────────────────────────────────
       The first row of the lead's history is how it arrived. Awaited but never
       fatal: an enquiry that saved and then failed to log is still an enquiry,
       and throwing here would lose it to a retry that then trips the
       idempotency check. */
    try {
      await CrmActivity.create({
        type: ACTIVITY_TYPE.SYSTEM,
        entityType: ENTITY_TYPE.LEAD,
        entityId: lead._id,
        direction: ACTIVITY_DIRECTION.INBOUND,
        subject: `Lead captured via ${values.source || LEAD_SOURCE.MANUAL}`,
        body: values.message || undefined,
        occurredAt: lead.createdAt,
        actor: opts.actor?._id || opts.actor?.id,
        meta: { routedBy, utm: values.utm || null, formId: values.formId || null },
      });
    } catch (err) {
      logger.error(`CRM intake: lead ${lead._id} saved but its timeline row failed: ${err.message}`);
    }

    /* ── 6. The follow-up the lead now owes ─────────────────
       Fire-and-forget by design: runRules never throws, and a lead that was
       captured but failed to generate its first-call task is still a captured
       lead. Losing the enquiry to a task-engine error would be the far worse
       trade. */
    await taskService.runRules(CRM_EVENT.LEAD_CREATED, {
      record: lead,
      entityType: ENTITY_TYPE.LEAD,
    });

    return { lead: lead.toObject(), duplicate: duplicate.matchedOn ? duplicate : null, created: true };
  },

  /**
   * The live duplicate check the manual-entry form calls as the phone number
   * is typed. Read-only — it never creates anything.
   */
  async check({ phone, email, name, company }) {
    const normalised = normalisePhone(phone);
    const result = await findDuplicate({
      phone: normalised, email: email || null, name, company,
    });
    return { ...result, phone: normalised };
  },
};

export default leadIntakeService;
