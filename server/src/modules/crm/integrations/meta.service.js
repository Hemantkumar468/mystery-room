import crypto from 'node:crypto';
import { config } from '../../../config/index.js';
import { LEAD_SOURCE } from '../crm.constants.js';
import { logger } from '../../../config/logger.js';

/**
 * Meta Lead Ads — Facebook and Instagram lead forms.
 *
 * THE SHAPE OF THIS INTEGRATION, which is the part that surprises people:
 * Meta's webhook does NOT contain the lead. It contains an id. The actual
 * name, phone and answers have to be fetched in a second call to the Graph
 * API, authenticated with a page token.
 *
 *   Meta ──POST {leadgen_id}──▶ webhook  (answer 200 immediately)
 *                                  │
 *                                  └─ queue a job
 *                                        │
 *                                        └─ GET /{leadgen_id} ──▶ Graph API
 *                                              └─ field_data → intake()
 *
 * The fetch happens in a job and not in the handler because Meta retries any
 * request it does not get a fast 2xx for. A slow Graph API therefore turns
 * into duplicate deliveries of the same lead — and the retry arrives while the
 * first one is still working, so even an idempotency check races.
 */

/**
 * Is this POST really from Meta?
 *
 * Meta signs every webhook body with the app secret. Without this check the
 * endpoint is an open door: anyone who learns the URL can post fabricated
 * `leadgen_id`s, and the job queue will dutifully try to fetch each one.
 *
 * Compared with `timingSafeEqual`, because a normal string comparison returns
 * faster the earlier it finds a difference, and that timing is enough to
 * recover a signature byte by byte.
 */
export function verifyMetaSignature(rawBody, signatureHeader) {
  const secret = config.crm.meta.appSecret;
  if (!secret) return false;
  if (!signatureHeader || !rawBody) return false;

  const [algo, provided] = String(signatureHeader).split('=');
  if (algo !== 'sha256' || !provided) return false;

  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  // Length must match before timingSafeEqual, which throws on a mismatch.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Fetch one submission's answers from the Graph API.
 *
 * @param {string} leadgenId
 * @returns {Promise<{ id, created_time, form_id, field_data: Array<{name, values}> }>}
 */
export async function fetchLeadFromGraph(leadgenId) {
  const { pageToken, graphVersion } = config.crm.meta;
  if (!pageToken) throw new Error('META_PAGE_TOKEN is not set');

  const url = `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(leadgenId)}`
    + `?access_token=${encodeURIComponent(pageToken)}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    const detail = body?.error?.message || res.statusText;
    // Code 190 is "token expired or revoked", which is the single most common
    // way this integration dies — and it dies silently, weeks after setup,
    // because a short-lived token was used instead of a long-lived one.
    if (body?.error?.code === 190) {
      logger.error(
        'META_PAGE_TOKEN is invalid or expired — Meta lead capture has STOPPED. '
        + 'Generate a new long-lived page token with leads_retrieval.',
      );
    }
    throw new Error(`Graph API ${res.status}: ${detail}`);
  }

  return body;
}

/**
 * Meta's `field_data` → our lead shape.
 *
 * Field names come from whatever the advertiser called them in Ads Manager, so
 * this maps the standard ones and keeps everything else. An unmapped answer is
 * appended to the message rather than dropped: a custom question like "how
 * many outlets do you run?" is often the most useful thing in the submission,
 * and silently discarding it makes the CRM look broken to the person who set
 * the form up.
 */
export function mapGraphLead(graphLead, { platform = LEAD_SOURCE.FACEBOOK } = {}) {
  const answers = new Map(
    (graphLead.field_data || []).map((f) => [String(f.name).toLowerCase(), (f.values || [])[0]]),
  );
  const take = (...names) => {
    for (const n of names) {
      const v = answers.get(n);
      if (v) { answers.delete(n); return v; }
    }
    return undefined;
  };

  const name = take('full_name', 'name')
    || [take('first_name'), take('last_name')].filter(Boolean).join(' ')
    || 'Unnamed enquiry'; // Meta allows forms with no name field at all.

  const lead = {
    name,
    phone: take('phone_number', 'phone', 'mobile'),
    email: take('email'),
    city: take('city', 'town'),
    company: take('company_name', 'company'),
    source: platform,
    sourceDetail: graphLead.campaign_name || graphLead.ad_name || `Meta form ${graphLead.form_id || ''}`.trim(),
    formId: graphLead.form_id ? String(graphLead.form_id) : undefined,
    externalId: `meta:${graphLead.id}`,
    utm: {
      source: platform,
      medium: 'paid_social',
      campaign: graphLead.campaign_name || undefined,
      content: graphLead.ad_name || undefined,
    },
  };

  // Whatever is left over, as a readable block.
  const extras = [...answers.entries()].filter(([, v]) => v);
  if (extras.length) {
    lead.message = extras.map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join('\n');
  }

  return lead;
}

export default { verifyMetaSignature, fetchLeadFromGraph, mapGraphLead };
