import crypto from 'node:crypto';
import { config } from '../../../../config/index.js';
import { logger } from '../../../../config/logger.js';

/**
 * The telephony provider, behind one interface.
 *
 * Exotel is the choice for this business — India-only call volume, and their
 * defaults are the Indian compliance rules rather than an exception to them.
 * Twilio remains a one-file swap because the decision is worth keeping cheap:
 * the *number* is the expensive thing to change, not the code.
 *
 * Everything provider-shaped lives here — the request shape, the field names
 * in a webhook, the way a signature is checked. Nothing above this file knows
 * which provider is in use, which is the only way that claim stays true.
 *
 * A provider is a plain object with:
 *   name
 *   configured        boolean
 *   placeCall({ agentPhone, customerPhone, callerId, callbackUrl })
 *   parseStatusWebhook(body)     → normalised event, or null
 *   parseInboundWebhook(body)    → normalised event, or null
 *   verifyWebhook(req)           → boolean
 *   fetchRecording(url)          → Buffer
 */

/** The one shape the rest of the module understands. */
const normalise = ({
  providerCallId, direction, from, to, status, durationSeconds, recordingUrl, startedAt,
}) => ({
  providerCallId,
  direction,
  from,
  to,
  status,
  durationSeconds: durationSeconds ? Number(durationSeconds) : null,
  recordingUrl: recordingUrl || null,
  startedAt: startedAt ? new Date(startedAt) : new Date(),
});

/**
 * Exotel.
 *
 * Their Connect API bridges two numbers: it rings the AGENT first, and only
 * dials the customer once the agent picks up. That ordering is deliberate on
 * their side and correct — a customer answering a call nobody is on yet is the
 * fastest way to be marked as spam.
 */
const exotel = {
  name: 'exotel',

  get configured() {
    return Boolean(config.crm.telephony.sid && config.crm.telephony.token && config.crm.telephony.callerId);
  },

  async placeCall({ agentPhone, customerPhone, callbackUrl }) {
    const { sid, token, callerId, subdomain } = config.crm.telephony;

    // Exotel authenticates with HTTP Basic over an account-scoped path.
    const url = `https://${subdomain}/v1/Accounts/${sid}/Calls/connect.json`;
    const auth = Buffer.from(`${sid}:${token}`).toString('base64');

    const form = new URLSearchParams({
      From: agentPhone,      // rings first
      To: customerPhone,     // dialled on answer
      CallerId: callerId,    // what the CUSTOMER sees — the masking
      CallType: 'trans',
      StatusCallback: callbackUrl,
      // Recording is enabled on the Exotel App/flow, not per call. The consent
      // announcement is configured there too — see docs/CRM-COMMS-ONBOARDING.md.
    });

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form,
      signal: AbortSignal.timeout(15_000),
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`Exotel ${res.status}: ${body?.RestException?.Message || res.statusText}`);
    }

    const call = body?.Call || {};
    return { providerCallId: String(call.Sid || ''), status: call.Status || 'queued' };
  },

  parseStatusWebhook(body = {}) {
    if (!body.CallSid) return null;
    return normalise({
      providerCallId: String(body.CallSid),
      direction: String(body.Direction || '').includes('inbound') ? 'inbound' : 'outbound',
      from: body.From || body.CallFrom,
      to: body.To || body.CallTo,
      status: body.Status || body.CallStatus,
      durationSeconds: body.ConversationDuration || body.DialCallDuration,
      recordingUrl: body.RecordingUrl,
      startedAt: body.StartTime || body.DateCreated,
    });
  },

  parseInboundWebhook(body = {}) {
    // The "passthru" applet fires while the call is still ringing — which is
    // the whole point of the screen-pop. If Exotel confirm it fires on ANSWER
    // instead, this feature has to be rebuilt around a different event; see
    // the question list in docs/CRM-COMMS-ONBOARDING.md.
    if (!body.CallSid) return null;
    return normalise({
      providerCallId: String(body.CallSid),
      direction: 'inbound',
      from: body.CallFrom || body.From,
      to: body.CallTo || body.To,
      status: 'ringing',
      startedAt: body.StartTime,
    });
  },

  /**
   * Exotel does not sign webhooks. The URL itself is the secret, so it carries
   * a token this app generated and compares in constant time.
   *
   * Weaker than an HMAC and honestly so: anyone who learns the URL can post to
   * it. That is why the handler treats every field as untrusted and why the
   * token must be long and never logged.
   */
  verifyWebhook(req) {
    const expected = config.crm.telephony.webhookSecret;
    if (!expected) return false;
    const given = String(req.query?.t || req.get('X-Webhook-Token') || '');
    const a = Buffer.from(given);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  },

  async fetchRecording(url) {
    const { sid, token } = config.crm.telephony;
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}` },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`Recording fetch failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  },
};

/**
 * Twilio — deliberately a stub.
 *
 * Written out so the shape of the swap is visible and so nobody has to guess
 * whether the abstraction actually fits a second provider. It throws rather
 * than half-working: a provider that silently does nothing is worse than one
 * that is honestly absent.
 */
const twilio = {
  name: 'twilio',
  get configured() { return false; },
  async placeCall() {
    throw new Error('The Twilio adapter is not implemented — set TELEPHONY_PROVIDER=exotel');
  },
  parseStatusWebhook: () => null,
  parseInboundWebhook: () => null,
  verifyWebhook: () => false,
  async fetchRecording() { throw new Error('Twilio adapter not implemented'); },
};

const PROVIDERS = { exotel, twilio };

let warned = false;

/** The configured provider. Falls back to Exotel, which is the decision made. */
export function telephonyProvider() {
  const chosen = PROVIDERS[config.crm.telephony.provider] || exotel;
  if (!chosen.configured && !warned) {
    warned = true;
    logger.warn(
      `Telephony (${chosen.name}) is not configured — click-to-call will be refused and `
      + 'inbound webhooks rejected. Set TELEPHONY_SID, TELEPHONY_TOKEN, TELEPHONY_CALLER_ID '
      + 'and TELEPHONY_WEBHOOK_SECRET to enable it.',
    );
  }
  return chosen;
}

/** Test seam — swap in a fake provider without touching config. */
export function __setProviderForTests(name, impl) {
  PROVIDERS[name] = impl;
}

export default telephonyProvider;
