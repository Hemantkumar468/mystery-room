import mongoose from 'mongoose';
import { config } from '../../../../config/index.js';
import { logger } from '../../../../config/logger.js';
import { User } from '../../../auth/auth.model.js';
import { Lead } from '../../leads/lead.model.js';
import { Contact } from '../../contacts/contact.model.js';
import { CrmActivity } from '../../activities/crmActivity.model.js';
import { UnfiledEmail } from './emailDropbox.model.js';
import { resolveThread } from './threading.js';
import {
  ACTIVITY_TYPE, ACTIVITY_DIRECTION, ENTITY_TYPE, LEAD_CLOSED_STATUSES,
} from '../../crm.constants.js';

/**
 * The BCC dropbox: email, filed onto the record it belongs to.
 *
 * HOW IT WORKS. A rep BCCs a dedicated mailbox on their customer email. A job
 * polls that mailbox and each message is attached to the lead or contact it
 * concerns, so the thread appears on the timeline next to the calls without
 * anyone copying anything.
 *
 * WHY THIS CHANNEL FIRST. Telephony and WhatsApp are both waiting on provider
 * paperwork. This needs a mailbox and an app password. It also settles a
 * question no amount of design can answer: whether the team will remember to
 * BCC. If they will not, an OAuth mailbox integration would have been a
 * fortnight spent on the same wrong assumption.
 *
 * ── THE TRUST BOUNDARY ──────────────────────────────────────────────────
 * The dropbox address is, by design, known to everyone who is BCC'd on
 * anything — it travels in headers and it gets into address books. So it must
 * be treated as public, and "arrived at our mailbox" cannot mean "is true".
 * A message is filed only when its SENDER is recognised:
 *
 *   - an active user of this system  → an outbound email to a customer;
 *   - an address already on a lead or contact → that customer writing to us;
 *   - anything else → refused, and held in UnfiledEmail with the reason.
 *
 * Without that rule, anyone who learned the address could write entries onto
 * any customer's history, and a CRM whose timeline can be forged is worse than
 * one with no email at all — people believe it.
 *
 * ── PERSONAL DATA ───────────────────────────────────────────────────────
 * Message bodies are personal data under the DPDP Act. They inherit the
 * record's deletion path: erasing a contact must erase their activities, which
 * is why the body lives on CrmActivity keyed to an entity, and why unmatched
 * mail keeps only a short excerpt — a body with no owner has no deletion story.
 */

/** Addresses out of a parsed header, lower-cased and deduplicated. */
function addressesOf(field) {
  const list = field?.value || (Array.isArray(field) ? field : []);
  return [...new Set(list.map((a) => String(a?.address || '').trim().toLowerCase()).filter(Boolean))];
}

/**
 * The reply chain, removed.
 *
 * A timeline entry that opens with three screens of quoted history is a
 * timeline nobody reads. Only unmistakable separators are cut — a `>` block or
 * a client's own marker — because a heuristic that guesses will eventually eat
 * the one sentence that mattered.
 */
export function stripQuotedReply(text = '') {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const markers = [
    /^-{2,}\s*Original Message\s*-{2,}/i,
    /^_{5,}$/,
    /^On .+ (wrote|schrieb):\s*$/i,
    /^From:\s.+@/i,
  ];
  let cut = lines.length;
  for (let i = 0; i < lines.length; i += 1) {
    if (markers.some((m) => m.test(lines[i].trim()))) { cut = i; break; }
  }
  const kept = lines.slice(0, cut)
    // A leading '>' block at the end of what is left is quoted too.
    .filter((l, i, arr) => !(l.trimStart().startsWith('>') && arr.slice(i).every((x) => !x.trim() || x.trimStart().startsWith('>'))));
  return kept.join('\n').trim();
}

/** Everyone on the message who is not us and not the dropbox itself. */
function counterparties(message, internalAddresses) {
  const dropbox = config.emailDropbox.address;
  return [...addressesOf(message.to), ...addressesOf(message.cc)]
    .filter((a) => a !== dropbox && !internalAddresses.has(a));
}

/**
 * The record an address belongs to.
 *
 * An OPEN lead beats a contact: a live enquiry is what somebody is working
 * right now, and burying the email on the durable contact record instead is
 * how a rep misses a reply. Closed leads are skipped for the same reason — a
 * new mail about an old converted enquiry belongs on the person, not on the
 * enquiry that already ended.
 */
async function recordFor(address) {
  const lead = await Lead.findOne({ email: address, status: { $nin: LEAD_CLOSED_STATUSES } })
    .select('_id name assignedTo').sort({ createdAt: -1 }).lean();
  if (lead) {
    return {
      entityType: ENTITY_TYPE.LEAD, entityId: lead._id, name: lead.name, owner: lead.assignedTo,
    };
  }

  const contact = await Contact.findOne({ email: address }).select('_id name owner').lean();
  if (contact) {
    return {
      entityType: ENTITY_TYPE.CONTACT, entityId: contact._id, name: contact.name, owner: contact.owner,
    };
  }
  return null;
}

/** Park a message that could not be filed, with the reason it could not be. */
async function hold(message, reason) {
  const doc = {
    messageId: message.messageId,
    reason,
    from: addressesOf(message.from)[0],
    fromName: (message.from?.value?.[0]?.name || '').trim() || undefined,
    to: [...addressesOf(message.to), ...addressesOf(message.cc)],
    subject: message.subject,
    excerpt: stripQuotedReply(message.text || '').slice(0, 500),
    sentAt: message.date,
  };
  // Upsert: polling is at-least-once, and the same refused message arriving
  // twice must not become two rows in the queue somebody has to work through.
  await UnfiledEmail.updateOne({ messageId: doc.messageId }, { $setOnInsert: doc }, { upsert: true });
  return { status: reason === 'unknown-sender' ? 'rejected' : 'unmatched', reason };
}

export const emailDropboxService = {
  stripQuotedReply,

  /**
   * File one parsed message.
   *
   * Deliberately knows nothing about IMAP — it takes the shape mailparser
   * produces and nothing else, so the whole decision table can be tested from
   * fixtures without a mailbox. The IMAP half is in imapSource.js and does no
   * deciding at all.
   *
   * @returns {{status:'filed'|'duplicate'|'unmatched'|'rejected', reason?:string, entityType?:string, entityId?:any}}
   */
  async fileMessage(message) {
    if (!message?.messageId) {
      // Without a Message-ID there is no way to tell a re-poll from a new mail,
      // and filing it would duplicate the entry on every single run.
      return { status: 'rejected', reason: 'no-message-id' };
    }

    const sender = addressesOf(message.from)[0];
    if (!sender) return hold(message, 'no-sender');

    /* Who is internal. Fetched per message rather than cached: a rep who left
       this morning must stop being able to write to the timeline this morning,
       and a cache measured in minutes is a window where they still can. */
    const users = await User.find({ isActive: { $ne: false } }).select('_id email').lean();
    const byEmail = new Map(users.filter((u) => u.email).map((u) => [u.email.toLowerCase(), u]));
    const internalAddresses = new Set(byEmail.keys());

    const senderUser = byEmail.get(sender);

    let target = null;
    let direction = null;
    let actor = null;

    if (senderUser) {
      // One of ours wrote to a customer and BCC'd us.
      direction = ACTIVITY_DIRECTION.OUTBOUND;
      actor = senderUser._id;
      for (const address of counterparties(message, internalAddresses)) {
        // eslint-disable-next-line no-await-in-loop
        target = await recordFor(address);
        if (target) break;
      }
      if (!target) return hold(message, 'no-matching-record');
    } else {
      // Not one of ours. It is only allowed in if we already know the address —
      // see THE TRUST BOUNDARY above.
      target = await recordFor(sender);
      if (!target) return hold(message, 'unknown-sender');
      direction = ACTIVITY_DIRECTION.INBOUND;
      actor = target.owner || null;
    }

    /* Which conversation this belongs to, resolved before the write so the
       timeline can group by it without walking headers at read time. */
    const { threadId, inReplyTo } = await resolveThread({
      messageId: message.messageId,
      inReplyTo: message.inReplyTo,
      references: message.references,
    });

    const body = stripQuotedReply(message.text || '');
    const attachments = (message.attachments || [])
      .filter((a) => a?.filename)
      .map((a) => ({ filename: a.filename, size: a.size, contentType: a.contentType }));

    try {
      await CrmActivity.create({
        type: ACTIVITY_TYPE.EMAIL,
        entityType: target.entityType,
        entityId: target.entityId,
        subject: (message.subject || '(no subject)').slice(0, 200),
        // Truncated to the model's ceiling. `bodyTruncated` in meta says so
        // rather than leaving a reader to wonder whether the mail just ended.
        body: body.slice(0, 8000),
        direction,
        occurredAt: message.date || new Date(),
        actor,
        providerEventId: message.messageId,
        threadId,
        inReplyTo,
        meta: {
          channel: 'email-dropbox',
          from: sender,
          to: addressesOf(message.to),
          cc: addressesOf(message.cc),
          bodyTruncated: body.length > 8000,
          quotedReplyRemoved: body.length !== String(message.text || '').trim().length,
          // Filenames and sizes only. Storing the files themselves needs a
          // retention policy and a deletion path, which is a decision to make
          // deliberately rather than by accident.
          attachments,
        },
      });
    } catch (err) {
      // The unique index on providerEventId is what makes an at-least-once
      // poll safe. Hitting it means this message is already on the timeline.
      if (err?.code === 11000) return { status: 'duplicate', reason: 'already-filed' };
      throw err;
    }

    return {
      status: 'filed',
      direction,
      entityType: target.entityType,
      entityId: target.entityId,
      name: target.name,
    };
  },


  /**
   * Turn a held message from an unknown sender into a lead, and file the
   * message onto it.
   *
   * ONE CLICK, because the alternative is what happens today: the rep reads
   * the queue, opens another tab, retypes the name and address into the lead
   * form, comes back, and marks this resolved. Four steps, so it does not get
   * done, and the enquiry sits in a queue nobody works.
   *
   * The message is filed by RE-RUNNING the normal filing path rather than by
   * writing an activity here. The sender is a known address by then, so the
   * ordinary rules apply — one decision table, not a second one that drifts.
   */
  async createLeadFrom(id, body, user) {
    if (!mongoose.isValidObjectId(id)) return null;
    const held = await UnfiledEmail.findById(id);
    if (!held || held.resolvedAt) return null;

    const { leadIntakeService } = await import('../../intake/leadIntake.service.js');
    const { LEAD_SOURCE } = await import('../../crm.constants.js');

    const { lead } = await leadIntakeService.intake({
      name: (body?.name || held.fromName || held.from || 'Email enquiry').slice(0, 120),
      email: held.from,
      phone: body?.phone,
      // The enquiry genuinely arrived by email; recording it as manual entry
      // would put it in the wrong column of every source report.
      source: LEAD_SOURCE.OTHER,
      sourceDetail: `Email: ${held.subject || '(no subject)'}`,
      city: body?.city,
    }, { actor: user });

    /* Now that the address belongs to a lead, the ordinary filing rules will
       recognise it — so replay the message through them instead of writing a
       bespoke activity that could disagree with what the poller does. */
    const filed = await this.fileMessage({
      messageId: held.messageId,
      from: { value: [{ address: held.from, name: held.fromName }] },
      to: { value: (held.to || []).map((address) => ({ address })) },
      cc: { value: [] },
      subject: held.subject,
      text: held.excerpt,
      date: held.sentAt,
      attachments: [],
    });

    held.resolvedAt = new Date();
    held.resolvedBy = user._id || user.id;
    await held.save();

    return { lead, filed };
  },

  /** The unfiled queue, for the settings screen. */
  async listUnfiled(query = {}) {
    const where = { resolvedAt: null };
    if (query.reason) where.reason = query.reason;
    const [rows, total] = await Promise.all([
      UnfiledEmail.find(where).sort({ createdAt: -1 }).limit(Math.min(Number(query.limit) || 50, 200)).lean(),
      UnfiledEmail.countDocuments(where),
    ]);
    return { rows, total };
  },

  /** Mark one as dealt with, so the queue drains rather than growing forever. */
  async resolveUnfiled(id, user) {
    if (!mongoose.isValidObjectId(id)) return null;
    return UnfiledEmail.findByIdAndUpdate(
      id,
      { $set: { resolvedAt: new Date(), resolvedBy: user._id || user.id } },
      { new: true },
    ).lean();
  },

  /** One line for the settings screen: is this thing actually working? */
  async status() {
    const { EmailDropboxState } = await import('./emailDropbox.model.js');
    const state = await EmailDropboxState.findOne({ mailbox: config.emailDropbox.mailbox }).lean();
    const pending = await UnfiledEmail.countDocuments({ resolvedAt: null });
    return {
      configured: config.emailDropbox.configured,
      address: config.emailDropbox.address || null,
      mailbox: config.emailDropbox.mailbox,
      pollMinutes: config.emailDropbox.pollMinutes,
      lastPolledAt: state?.lastPolledAt || null,
      lastError: state?.lastError || null,
      counts: state?.counts || {
        filed: 0, duplicate: 0, unmatched: 0, rejected: 0,
      },
      unfiledPending: pending,
    };
  },
};

if (!config.emailDropbox.configured) {
  logger.info('Email dropbox is not configured (IMAP_HOST/USER/PASS) — inbound email is off.');
}

export default emailDropboxService;
