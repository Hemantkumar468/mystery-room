import mongoose from 'mongoose';
import { attachTenancy } from '../../../core/tenancy/tenancy.js';
import {
  ACTIVITY_TYPE_VALUES, ENTITY_TYPE_VALUES, ACTIVITY_DIRECTION_VALUES,
} from '../crm.constants.js';

const { Schema, model } = mongoose;

/**
 * One thing that happened — a call, a WhatsApp message, an email, a note, a
 * stage change. The unified timeline is a query over this collection.
 *
 * NAMED `CrmActivity`, NOT `Activity`. The PMS module already registers a
 * Mongoose model called `Activity` for its project audit trail, and a second
 * `model('Activity', …)` throws `OverwriteModelError` at import time — which
 * takes the whole API down at boot, not at first use. The collection is named
 * explicitly for the same reason.
 *
 * `entityType` + `entityId` is a deliberate polymorphic link rather than five
 * nullable refs. The timeline component is one implementation serving leads,
 * deals, contacts, companies and tickets; five refs would mean five branches
 * in every query that builds it.
 */
const crmActivitySchema = new Schema(
  {
    type: { type: String, enum: ACTIVITY_TYPE_VALUES, required: true, index: true },

    entityType: { type: String, enum: ENTITY_TYPE_VALUES, required: true },
    entityId: { type: Schema.Types.ObjectId, required: true },

    subject: { type: String, trim: true, maxlength: 200 },
    body: { type: String, maxlength: 8000 },

    direction: { type: String, enum: ACTIVITY_DIRECTION_VALUES },

    /**
     * When it HAPPENED, which is not when the row was written.
     *
     * A call that finished at 3:02 can be recorded at 3:40 by a webhook, and a
     * timeline ordered by `createdAt` would then show it after things that
     * happened later. Every timeline query sorts on this.
     */
    occurredAt: { type: Date, default: Date.now, index: true },

    /** Who did it. Absent for anything the system did to itself. */
    actor: { type: Schema.Types.ObjectId, ref: 'User', index: true },

    /** Channel-specific payload — call duration and recording key, message id,
     *  email headers. Loose by design: each channel adds its own shape as it
     *  is built, and pinning them all now would be guessing. */
    meta: { type: Schema.Types.Mixed },

    /**
     * The provider's id for the underlying event.
     *
     * Unique when present, which is what makes webhook handlers idempotent:
     * telephony and messaging providers retry on any non-2xx, so without it a
     * slow response writes the same call to the timeline twice.
     */
    providerEventId: { type: String, trim: true, index: true, unique: true, sparse: true },

    /**
     * The conversation this belongs to — the Message-ID of whatever started it.
     *
     * Email arrives as individual messages that only relate to each other
     * through `In-Reply-To` and `References` headers. Resolved once, on the way
     * in, and stored: doing it at read time would mean walking the header chain
     * of every message on every timeline render, and the chain is only as good
     * as the messages that happen to be in the database at that moment.
     *
     * Sparse — only email carries one. A call has no thread.
     */
    threadId: { type: String, trim: true, index: true, sparse: true },
    /** The message this one answers, kept so the chain can be re-derived if
     *  the threading rules ever change. */
    inReplyTo: { type: String, trim: true },

    /**
     * Open and click tracking for one outbound email.
     *
     * DELETION PATH, stated here because it ships with the data: this lives on
     * the activity, and activities are keyed to an entity, so erasing a contact
     * erases their tracking with them. No separate store, no orphan rows, and
     * nothing that outlives the record it describes.
     *
     * PRIVACY. A tracking pixel tells us something the recipient did not
     * choose to tell us. It is off unless EMAIL_TRACKING_ENABLED is set, the
     * token is random rather than derived from the address, and no third party
     * is involved — the pixel is served by this API and nobody else sees it.
     */
    trackingToken: { type: String, trim: true, index: true, sparse: true },
  },
  { timestamps: true, collection: 'crmactivities' },
);

/** THE timeline query: one entity's history, newest first. Cursor-paginated on
 *  `occurredAt`, which this index serves directly. */
crmActivitySchema.index({ entityType: 1, entityId: 1, occurredAt: -1 });

attachTenancy(crmActivitySchema, { modelName: 'CrmActivity' });

export const CrmActivity = model('CrmActivity', crmActivitySchema);
export default CrmActivity;
