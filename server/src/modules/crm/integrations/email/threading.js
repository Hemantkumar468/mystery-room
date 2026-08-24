import { CrmActivity } from '../../activities/crmActivity.model.js';

/**
 * Which conversation a message belongs to.
 *
 * WHY THIS IS NOT OBVIOUS. Email has no conversation id. A thread exists only
 * because each reply carries `In-Reply-To` (the message it answers) and
 * `References` (the chain back to the start). Mail clients rebuild the tree
 * from those headers every time they render. We resolve it once, on the way
 * in, and store the answer — because doing it at read time means walking the
 * chain for every message on every timeline render, and the chain is only as
 * complete as whatever happens to be in the database at that instant.
 *
 * THE RULE: a message belongs to the thread of the newest ancestor we already
 * know about. `References` is walked from the END backwards — its last entry
 * is the immediate parent and its first is the root, so working backwards
 * finds the closest known relative rather than the oldest one. That matters
 * when a long thread is forwarded into the CRM half-way through: the parts we
 * have should join up, not each become their own conversation.
 *
 * When nothing is recognised the message starts a thread of its own, named by
 * its own Message-ID. A later reply that references it then joins it — so a
 * conversation captured out of order still converges, rather than staying
 * permanently split.
 */

/** `<a@x> <b@y>` → ['<a@x>', '<b@y>'] — the header is whitespace-separated. */
export function parseReferences(value) {
  if (!value) return [];
  const raw = Array.isArray(value) ? value.join(' ') : String(value);
  return raw.split(/\s+/).map((s) => s.trim()).filter(Boolean);
}

/**
 * @param {{messageId: string, inReplyTo?: string, references?: string|string[]}} message
 * @returns {Promise<{threadId: string, inReplyTo: string|null}>}
 */
export async function resolveThread(message) {
  const messageId = message?.messageId;
  const inReplyTo = message?.inReplyTo || null;

  // Closest relative first: the direct parent, then the chain from newest back.
  const candidates = [inReplyTo, ...parseReferences(message?.references).reverse()]
    .filter(Boolean);

  for (const candidate of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const parent = await CrmActivity.findOne({ providerEventId: candidate })
      .select('threadId providerEventId').lean();
    if (parent) return { threadId: parent.threadId || parent.providerEventId, inReplyTo };
  }

  /* Nothing recognised. Before starting a new thread, check whether anything
     already in the database names THIS message as its parent — the reply can
     arrive before the message it answers when a thread is forwarded in out of
     order, and without this the two halves would never join. */
  const child = await CrmActivity.findOne({ inReplyTo: messageId }).select('threadId').lean();
  if (child?.threadId) return { threadId: child.threadId, inReplyTo };

  return { threadId: messageId, inReplyTo };
}

/** Every message in one conversation, oldest first — the way a person reads it. */
export async function threadMessages(threadId, limit = 100) {
  if (!threadId) return [];
  return CrmActivity.find({ threadId })
    .populate('actor', 'name avatarColor')
    .sort({ occurredAt: 1 })
    .limit(limit)
    .lean();
}

export default resolveThread;
