import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * A call that is ringing RIGHT NOW, waiting to be shown to an agent.
 *
 * WHY THIS EXISTS AS A COLLECTION AND NOT JUST AN EVENT. The screen-pop has to
 * survive two things an in-memory emitter cannot: an agent whose browser
 * reconnects a second after the webhook landed, and a second API instance
 * handling the poll. A row that expires on its own covers both.
 *
 * TTL of two minutes. A ring nobody collected in that time is a call that has
 * already been answered, missed, or given up on — popping it afterwards would
 * put a stranger's record on screen in the middle of a different conversation.
 */
const ringSchema = new Schema({
  /** Whose screen this belongs on. */
  agent: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  providerCallId: { type: String, required: true, unique: true },
  from: { type: String, required: true },
  to: { type: String },

  /** What we managed to resolve the caller to, if anything. */
  matchType: { type: String, enum: ['lead', 'contact', 'unknown'], default: 'unknown' },
  matchId: { type: Schema.Types.ObjectId },
  matchName: { type: String },
  matchSummary: { type: String },

  /** Set once an agent's poll has returned it, so a reconnect does not pop the
   *  same call twice on the same screen. */
  deliveredAt: { type: Date },

  createdAt: { type: Date, default: Date.now },
}, { collection: 'crmringing' });

// Mongo removes the row itself once it is this old — no sweep to write, and no
// stale ring can outlive the call it describes.
ringSchema.index({ createdAt: 1 }, { expireAfterSeconds: 120 });

export const CrmRing = model('CrmRing', ringSchema);
export default CrmRing;
