import { Lead } from '../leads/lead.model.js';
import { Contact } from '../contacts/contact.model.js';
import { DUPLICATE_MATCH, LEAD_CLOSED_STATUSES } from '../crm.constants.js';

/**
 * Is this enquiry someone we already know?
 *
 * Runs on EVERY intake path before anything is created, because the cost of
 * getting this wrong is asymmetric:
 *
 *   - A missed duplicate means two agents ring the same customer, who
 *     concludes the company is disorganised. It also splits the history, so
 *     the second agent cannot see the objection the first one already handled.
 *   - A false positive attaches an enquiry to the wrong person, which is worse
 *     and much harder to notice.
 *
 * So the two strong signals (phone, email) auto-match, and the weak one
 * (similar name at the same company) only ever raises a flag for a human.
 * Nothing here merges anything: it reports, and the caller decides.
 */

/** Normalised, punctuation-free, for comparing names that differ cosmetically. */
const canon = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * @returns {Promise<{
 *   isDuplicate: boolean, matchedOn?: string, confidence: 'high'|'low',
 *   lead?: object, contact?: object, reason?: string
 * }>}
 */
export async function findDuplicate({ phone, email, name, company }) {
  /* ── Strong signal 1: the phone number ───────────────────────
     Compared against the E.164 column, so it only works if the caller
     normalised first. That is enforced by leadIntake, which normalises before
     it asks. */
  if (phone) {
    const [contact, lead] = await Promise.all([
      Contact.findOne({ phone }).lean(),
      // The most recent OPEN lead: an enquiry from someone whose last lead was
      // closed six months ago is genuinely new business, not a re-enquiry, and
      // attaching it to the dead record buries it.
      Lead.findOne({ phone, status: { $nin: LEAD_CLOSED_STATUSES } })
        .sort({ createdAt: -1 }).lean(),
    ]);
    if (contact || lead) {
      return {
        isDuplicate: true,
        matchedOn: DUPLICATE_MATCH.PHONE,
        confidence: 'high',
        contact: contact || null,
        lead: lead || null,
        reason: 'Same phone number',
      };
    }
  }

  /* ── Strong signal 2: the email address ─────────────────────
     Weaker than a phone number in practice — shared inboxes like
     info@company exist — but still an exact match on a unique-ish string. */
  if (email) {
    const [contact, lead] = await Promise.all([
      Contact.findOne({ email }).lean(),
      Lead.findOne({ email, status: { $nin: LEAD_CLOSED_STATUSES } })
        .sort({ createdAt: -1 }).lean(),
    ]);
    if (contact || lead) {
      return {
        isDuplicate: true,
        matchedOn: DUPLICATE_MATCH.EMAIL,
        confidence: 'high',
        contact: contact || null,
        lead: lead || null,
        reason: 'Same email address',
      };
    }
  }

  /* ── Weak signal: same name, same company ───────────────────
     Never auto-merges. Two different people called Rahul Sharma at a 400-person
     company is ordinary; silently folding them into one record loses one of
     them permanently, and nobody finds out until a deal goes missing. */
  if (name && company) {
    const candidates = await Lead.find({
      company: new RegExp(`^${escapeRegex(company)}$`, 'i'),
      status: { $nin: LEAD_CLOSED_STATUSES },
    }).select('name company phone email createdAt assignedTo').limit(20).lean();

    const match = candidates.find((c) => canon(c.name) === canon(name));
    if (match) {
      return {
        isDuplicate: false, // ← deliberately false: a flag, not a decision
        matchedOn: DUPLICATE_MATCH.FUZZY_NAME_COMPANY,
        confidence: 'low',
        lead: match,
        reason: 'Same name at the same company — check before creating',
      };
    }
  }

  return { isDuplicate: false, confidence: 'high' };
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default findDuplicate;
