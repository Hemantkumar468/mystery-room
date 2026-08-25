import mongoose from 'mongoose';
import { attachTenancy } from '../../../core/tenancy/tenancy.js';

const { Schema, model } = mongoose;

/**
 * One Ask-the-Map conversation.
 *
 * Persisted for the same three reasons the big assistants persist chats:
 *   1. CONTINUITY  — a follow-up ("and within 10 km?") only makes sense with
 *      the thread it follows; the model gets the history, not a cold start.
 *   2. ECONOMY     — facts already researched in this thread are reused from
 *      the saved messages instead of being re-searched, which is both faster
 *      and cheaper in provider tokens.
 *   3. THE RECORD  — "what did the AI tell us about Indore last month" is a
 *      real question; a chat with its own URL answers it.
 *
 * Messages are embedded, not a separate collection: a thread is read and
 * written as a unit, is bounded (MAX_MESSAGES in the service), and is never
 * queried message-by-message.
 */
const messageSchema = new Schema(
  {
    role: { type: String, enum: ['user', 'assistant'], required: true },
    text: { type: String, required: true, maxlength: 8000 },
    // Assistant messages carry what the answer was made of, so reopening a
    // chat re-plots its pins without asking the provider anything.
    confidence: { type: String, enum: ['high', 'medium', 'low'] },
    caveat: { type: String, maxlength: 1000 },
    findings: [{
      _id: false,
      name: String,
      kind: String,
      detail: String,
      city: String,
      lat: Number,
      lng: Number,
      approx: Boolean,
      radius_km: Number,
    }],
    // A question the assistant asked back (ambiguous place, missing detail),
    // with its clickable options — kept so a reopened chat still shows them.
    clarification: {
      needed: { type: Boolean, default: false },
      question: { type: String, maxlength: 400 },
      options: { type: [String], default: undefined },
    },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const mapChatSchema = new Schema(
  {
    // Private to the person who asked — the MD's market thinking is not a
    // shared feed. Listing and reading always filter by this.
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // First question, trimmed — the name a chat list shows.
    title: { type: String, required: true, trim: true, maxlength: 140 },
    messages: { type: [messageSchema], default: [] },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

mapChatSchema.index({ user: 1, updatedAt: -1 });

attachTenancy(mapChatSchema, { modelName: 'MapChat' });

export const MapChat = model('MapChat', mapChatSchema);
export default MapChat;
