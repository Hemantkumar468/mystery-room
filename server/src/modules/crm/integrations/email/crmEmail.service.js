import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { config } from '../../../../config/index.js';
import { ApiError } from '../../../../core/utils/ApiError.js';
import { mailService } from '../../../../core/services/mail.service.js';
import { CrmActivity } from '../../activities/crmActivity.model.js';
import { Lead } from '../../leads/lead.model.js';
import { Contact } from '../../contacts/contact.model.js';
import { buildScope } from '../../shared/scope.js';
import { resolveThread, threadMessages } from './threading.js';
import { ACTIVITY_TYPE, ACTIVITY_DIRECTION, ENTITY_TYPE } from '../../crm.constants.js';

/**
 * Outbound CRM email — sent, threaded, and recorded on the customer's timeline.
 *
 * ONE TIMELINE. This writes a CrmActivity exactly like an inbound message
 * does, so a conversation reads in order regardless of which direction each
 * message went. A separate "sent items" store would mean the reply and the
 * message it answers live in different places, which is how a rep ends up
 * answering something twice.
 *
 * THREADING IS NOT COSMETIC. A reply carries `In-Reply-To` and `References`
 * so the customer's mail client files it under the original. Without them,
 * every reply the CRM sends starts a new conversation in their inbox, and one
 * enquiry becomes nine unrelated emails.
 */

/** Unguessable, and unrelated to the recipient — see the note on tracking. */
const newToken = () => crypto.randomBytes(18).toString('base64url');

/**
 * Where a tracking hit should land. Falls back to the local API in dev.
 *
 * `/crm/public/…` because that is where the unauthenticated router is mounted.
 * Getting this prefix wrong is invisible: the email still sends, the pixel
 * still renders as nothing, and every open silently 404s — so the feature
 * reports "nobody has opened anything" forever. The suite asserts the URL this
 * builds against the app's real route table for exactly that reason.
 */
export const TRACKING_PATH = '/crm/public/e';

function trackingBase() {
  const base = config.publicApiUrl || `http://localhost:${config.port}${config.apiPrefix}`;
  return `${base.replace(/\/+$/, '')}${TRACKING_PATH}`;
}

/**
 * Rewrite links so clicks are counted, and add the open pixel.
 *
 * THE LINKS ARE STORED, AND THE URL CARRIES AN INDEX — never the destination.
 * A redirect endpoint that takes its target from the query string is an open
 * redirect: anyone can hand out `…/click?url=https://evil.example` wearing our
 * domain, and phishing filters trust the domain. Storing the list at send time
 * means the endpoint can only ever send someone to a link we actually put in
 * that specific email.
 *
 * @returns {{html: string, links: string[]}}
 */
export function instrument(html, token) {
  const links = [];
  if (!config.mail.trackingEnabled || !html) return { html: html || '', links };

  const base = trackingBase();

  const rewritten = String(html).replace(
    /href="(https?:\/\/[^"]+)"/gi,
    (match, url) => {
      // `mailto:` and anchors never reach here — only http(s) is rewritten,
      // because a rewritten mailto link is a broken mailto link.
      const index = links.push(url) - 1;
      return `href="${base}/c/${token}/${index}"`;
    },
  );

  /* The pixel goes LAST, after the signature, so a client that truncates a
     long message ("[Message clipped]") still renders the visible content —
     the open is simply not counted, which is better than a broken layout. */
  const pixel = `<img src="${base}/o/${token}" width="1" height="1" alt="" style="display:none" />`;
  return { html: `${rewritten}${pixel}`, links };
}

/** The record an email is being sent about, if the caller named one. */
async function resolveEntity(body, user) {
  const { entityType, entityId } = body;
  if (!entityType || !mongoose.isValidObjectId(entityId)) return null;

  // Scoped: a rep must not be able to attach an email to somebody else's
  // record by guessing an id.
  const scope = buildScope(user);
  if (entityType === ENTITY_TYPE.LEAD) {
    const lead = await Lead.findOne({ _id: entityId, ...scope }).select('_id email name').lean();
    return lead && { entityType, entityId: lead._id, email: lead.email, name: lead.name };
  }
  if (entityType === ENTITY_TYPE.CONTACT) {
    const contact = await Contact.findOne({ _id: entityId, ...buildScope(user, { field: 'owner' }) })
      .select('_id email name').lean();
    return contact && { entityType, entityId: contact._id, email: contact.email, name: contact.name };
  }
  return { entityType, entityId };
}

export const crmEmailService = {
  instrument,

  /**
   * Send one email and record it.
   *
   * @param {{to?:string, subject:string, body:string, entityType?:string,
   *          entityId?:string, inReplyTo?:string}} body
   */
  async send(body, user) {
    if (!config.mail.configured) {
      throw ApiError.badRequest(
        'Email is not configured on this server (SMTP_HOST is unset), so nothing can be sent yet.',
        { code: 'MAIL_NOT_CONFIGURED' },
      );
    }
    if (!body?.subject?.trim()) throw ApiError.badRequest('An email needs a subject');
    if (!body?.body?.trim()) throw ApiError.badRequest('An email needs a message');

    const entity = await resolveEntity(body, user);
    const to = (body.to || entity?.email || '').trim();
    if (!to) {
      throw ApiError.badRequest(
        'No recipient — the record has no email address on it.',
        { code: 'MAIL_NO_RECIPIENT' },
      );
    }
    if (!entity) {
      // Refused rather than sent-and-unfiled: an email with no record is one
      // nobody will find again, and the whole point is the timeline.
      throw ApiError.notFound('That record could not be found, so there is nowhere to file the email');
    }

    /* Thread it BEFORE sending, so the headers can carry the chain. Replying
       from the drawer passes the message being answered; a fresh email starts
       its own thread once the provider assigns a Message-ID. */
    let parent = null;
    if (body.inReplyTo) {
      parent = await CrmActivity.findOne({ providerEventId: body.inReplyTo })
        .select('providerEventId threadId').lean();
    }

    const token = newToken();
    const html = `<div>${String(body.body).replace(/\n/g, '<br />')}</div>`;
    const { html: instrumented, links } = instrument(html, token);

    const result = await mailService.send({
      to,
      subject: body.subject.trim(),
      html: instrumented,
      inReplyTo: parent?.providerEventId,
      references: parent ? [parent.threadId, parent.providerEventId].filter(Boolean).join(' ') : undefined,
    });

    if (!result.sent) {
      /* No activity is written for a failed send. A timeline entry saying an
         email went out when it did not is worse than no entry: somebody reads
         it and stops chasing. The caller surfaces this immediately instead. */
      throw ApiError.badRequest(`The email could not be sent: ${result.skipped}`, { code: 'MAIL_SEND_FAILED' });
    }

    const { threadId, inReplyTo } = parent
      ? { threadId: parent.threadId || parent.providerEventId, inReplyTo: parent.providerEventId }
      : await resolveThread({ messageId: result.messageId });

    const activity = await CrmActivity.create({
      type: ACTIVITY_TYPE.EMAIL,
      entityType: entity.entityType,
      entityId: entity.entityId,
      subject: body.subject.trim().slice(0, 200),
      body: String(body.body).slice(0, 8000),
      direction: ACTIVITY_DIRECTION.OUTBOUND,
      occurredAt: new Date(),
      actor: user._id || user.id,
      providerEventId: result.messageId,
      threadId,
      inReplyTo,
      trackingToken: config.mail.trackingEnabled ? token : undefined,
      meta: {
        channel: 'crm-email',
        to,
        tracking: config.mail.trackingEnabled
          ? { links, opens: 0, clicks: 0 }
          : { disabled: true },
      },
    });

    return activity.toObject();
  },

  /** Every message in one conversation, oldest first. */
  async thread(threadId, user) {
    const messages = await threadMessages(threadId);
    if (!messages.length) return null;
    // Scoped through the entity the thread hangs off, not the thread id — a
    // thread id is guessable from a forwarded header.
    const scope = buildScope(user);
    if (Object.keys(scope).length) {
      const first = messages[0];
      const owned = first.entityType === ENTITY_TYPE.LEAD
        ? await Lead.exists({ _id: first.entityId, ...scope })
        : true;
      if (!owned) return null;
    }
    return messages;
  },

  /**
   * Record that an email was opened.
   *
   * Idempotent in spirit but not in count: the same pixel fires again every
   * time the message is re-opened, and that is genuinely useful — a quote
   * opened five times is a different signal from one opened once. `openedAt`
   * keeps the FIRST open, because "how long did they take to read it" is the
   * question people actually ask.
   */
  async recordOpen(token) {
    if (!token) return null;
    return CrmActivity.findOneAndUpdate(
      { trackingToken: token },
      {
        $inc: { 'meta.tracking.opens': 1 },
        $min: { 'meta.tracking.openedAt': new Date() },
      },
      { new: true },
    ).select('_id entityType entityId meta.tracking').lean();
  },

  /**
   * Record a click and return where the reader should actually be sent.
   *
   * Returns null when the token or index is unknown, and the route turns that
   * into a 404 rather than a redirect — because a redirect endpoint that
   * degrades to "somewhere sensible" is one that can be probed for what exists.
   */
  async recordClick(token, index) {
    if (!token) return null;
    const activity = await CrmActivity.findOne({ trackingToken: token })
      .select('meta.tracking').lean();
    const links = activity?.meta?.tracking?.links || [];
    const url = links[Number(index)];
    if (!url) return null;

    await CrmActivity.updateOne(
      { trackingToken: token },
      {
        $inc: { 'meta.tracking.clicks': 1 },
        $min: { 'meta.tracking.clickedAt': new Date() },
      },
    );
    return url;
  },
};

export default crmEmailService;
