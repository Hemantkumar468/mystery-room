import mongoose from 'mongoose';
import crypto from 'node:crypto';
import { attachTenancy } from '../../../core/tenancy/tenancy.js';

const { Schema, model } = mongoose;

/**
 * An invitation for someone OUTSIDE the company to do one phase's work.
 *
 * Mystery Rooms outsources design. The front-elevation options and the working
 * drawings are both routinely done by an architect who is not an employee, has
 * no login, and never will — giving every freelancer a PMS account to file two
 * drawings is not a system anybody would use. So the work goes out as a link.
 *
 * WHAT THE LINK IS. One long random token, sent by WhatsApp or email. Opening
 * it shows the designer the brief — the site's city, address and area, the
 * games planned for it and the floor space each needs, what to produce and by
 * when — and lets them upload their work straight into the right list of the
 * right phase. Nothing else about the project is reachable through it: no
 * budget, no other phase, no other project, no people.
 *
 * WHY THE TOKEN IS HASHED. It is a bearer credential — whoever holds it can
 * file into this phase — and it will end up in WhatsApp history, in a mail
 * archive and in whatever the designer forwards it to. Storing only the SHA-256
 * means a leaked database dump does not hand out working links, and the same
 * reason it is shown exactly once at creation.
 *
 * WHY IT EXPIRES AND CAN BE REVOKED. A design brief is live for weeks, not
 * forever, and the relationship with a freelancer ends. An invitation with no
 * end date is a permanent hole nobody remembers opening.
 *
 * The contact details are the point as much as the link: name, mobile and
 * email are captured so the WhatsApp channel can reach this person directly
 * once it is live, instead of somebody re-typing a number from a chat.
 */

/** How the link was sent — kept so "did anyone actually send it?" is answerable. */
const sendSchema = new Schema({
  channel: { type: String, enum: ['whatsapp', 'email', 'copied'], required: true },
  to: { type: String }, // the number or address it went to, as sent
  at: { type: Date, default: Date.now },
  by: { type: Schema.Types.ObjectId, ref: 'User' },
}, { _id: false });

const outsourceLinkSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    /** The phase the work belongs to ('p11'). */
    stageKey: { type: String, required: true, index: true },
    /**
     * WHICH list of that phase, when the phase keeps several (see
     * recordGroups). Phase 4 has two — front options and working drawings —
     * and a designer invited for one must not file into the other by accident.
     */
    groupKey: { type: String },
    /** The task this stands in for, so the work filed lands against it. */
    task: { type: Schema.Types.ObjectId, ref: 'Task' },
    templateTaskKey: { type: String },

    contact: {
      name: { type: String, required: true, trim: true, maxlength: 120 },
      company: { type: String, trim: true, maxlength: 160 },
      // Stored as typed. Normalisation happens at send time, not here: a
      // number rewritten on save is a number nobody recognises on read.
      phone: { type: String, trim: true, maxlength: 32 },
      email: { type: String, trim: true, lowercase: true, maxlength: 160 },
    },

    /** A line from whoever sent it — "front elevation only, glass frontage". */
    note: { type: String, maxlength: 2000 },

    /** SHA-256 of the token. The token itself is never stored. */
    tokenHash: { type: String, required: true, unique: true, index: true },
    /** Last 6 characters, so a link can be identified in a list without it. */
    tokenHint: { type: String },

    expiresAt: { type: Date, required: true, index: true },
    revokedAt: { type: Date },
    revokedBy: { type: Schema.Types.ObjectId, ref: 'User' },

    sends: [sendSchema],
    /* Opens are counted, not logged one by one: the useful questions are "did
       they ever open it?" and "recently?", and an append-only visit log on a
       public URL is an unbounded array fed by anyone with the link. */
    openCount: { type: Number, default: 0 },
    firstOpenedAt: { type: Date },
    lastOpenedAt: { type: Date },

    /** What they filed through it. */
    records: [{ type: Schema.Types.ObjectId, ref: 'Record' }],

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

attachTenancy(outsourceLinkSchema);

outsourceLinkSchema.index({ project: 1, stageKey: 1, createdAt: -1 });

/** Live means: not revoked, not expired. Everything else is history. */
outsourceLinkSchema.virtual('isLive').get(function isLive() {
  return !this.revokedAt && this.expiresAt > new Date();
});

outsourceLinkSchema.virtual('state').get(function state() {
  if (this.revokedAt) return 'revoked';
  if (this.expiresAt <= new Date()) return 'expired';
  if (this.records?.length) return 'delivered';
  if (this.openCount > 0) return 'opened';
  if (this.sends?.length) return 'sent';
  return 'not sent';
});

/** A fresh token and its stored form. The raw half is returned exactly once. */
export function mintToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token), tokenHint: token.slice(-6) };
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export const OutsourceLink = model('OutsourceLink', outsourceLinkSchema);
export default OutsourceLink;
