import mongoose from 'mongoose';
import { attachTenancy } from '../../../../core/tenancy/tenancy.js';

const { Schema, model } = mongoose;

/**
 * Where the last poll got to, per mailbox.
 *
 * IMAP UIDs, not the `\Seen` flag. A flag is shared with every human and
 * client touching that mailbox: someone reading the dropbox in Gmail would
 * silently mark messages seen and this job would skip them forever, and a
 * "mark all unread" would re-file six months of email. A UID high-water mark
 * belongs to us and to nobody else.
 *
 * `uidValidity` is stored alongside because IMAP guarantees UIDs are only
 * meaningful while it is unchanged — a rebuilt mailbox resets numbering, and
 * carrying the old cursor across would skip everything below it.
 */
const dropboxStateSchema = new Schema(
  {
    mailbox: { type: String, required: true, unique: true },
    lastUid: { type: Number, default: 0 },
    uidValidity: { type: String },
    lastPolledAt: { type: Date },
    lastError: { type: String },
    /** Running totals, so "is this thing working?" is answerable without
     *  reading logs — which is how the dead-jobs outage stayed invisible. */
    counts: {
      filed: { type: Number, default: 0 },
      duplicate: { type: Number, default: 0 },
      unmatched: { type: Number, default: 0 },
      rejected: { type: Number, default: 0 },
    },
  },
  { timestamps: true, collection: 'crm_email_dropbox_state' },
);

attachTenancy(dropboxStateSchema, { modelName: 'EmailDropboxState' });

export const EmailDropboxState = model('EmailDropboxState', dropboxStateSchema);

/**
 * Email the dropbox could not attach to anything.
 *
 * KEPT, NOT DROPPED. An unmatched message is usually a real customer whose
 * address is not on the record yet — exactly the case where silently
 * discarding it destroys the evidence that the feature is under-performing.
 * Held here, it can be listed, counted, and attached by hand.
 *
 * The same collection holds rejections (unknown sender), because "why did my
 * email not appear on the record?" has one place to look rather than two.
 */
const unfiledEmailSchema = new Schema(
  {
    messageId: { type: String, required: true, unique: true },
    reason: { type: String, required: true, index: true },
    from: { type: String, trim: true, lowercase: true },
    /** The display name on the From header, so a lead created from this is
     *  called "Priya Nair" rather than "priya@example.com". */
    fromName: { type: String, trim: true, maxlength: 120 },
    to: [{ type: String, trim: true, lowercase: true }],
    subject: { type: String, trim: true, maxlength: 300 },
    /** A short excerpt only. The full body of an email nothing claims is
     *  personal data with no owner and no retention story — see the DPDP note
     *  in emailDropbox.service.js. */
    excerpt: { type: String, maxlength: 500 },
    sentAt: { type: Date },
    /** Cleared when somebody files it by hand, so the queue drains. */
    resolvedAt: { type: Date },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'crm_email_unfiled' },
);

unfiledEmailSchema.index({ resolvedAt: 1, createdAt: -1 });

attachTenancy(unfiledEmailSchema, { modelName: 'UnfiledEmail' });

export const UnfiledEmail = model('UnfiledEmail', unfiledEmailSchema);
