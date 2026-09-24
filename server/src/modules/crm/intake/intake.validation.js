import { z } from 'zod';
import { LEAD_SOURCE_VALUES } from '../crm.constants.js';

/**
 * What a public form is allowed to send.
 *
 * This runs on an endpoint with no authentication, so it is the only thing
 * between the open internet and the Lead collection. Two rules shape it:
 *
 *   - `.strict()` is deliberate. An unknown key is rejected rather than
 *     ignored, so a caller cannot probe for fields the API might accept, and a
 *     form that starts sending a renamed field fails loudly instead of quietly
 *     dropping data nobody notices for a month.
 *   - Every string has a maximum. Without one, a 4MB "message" is a valid
 *     lead, and the collection fills up one submission at a time.
 *
 * Fields the SYSTEM owns — status, assignedTo, createdAt, reEnquiryCount — are
 * absent by design. leadIntake.service picks from an allow-list too, so this
 * is the second of two independent gates, not the only one.
 */

const trimmed = (max) => z.string().trim().max(max);

export const publicLeadSchema = z.object({
  body: z.object({
    name: trimmed(120).min(1, 'Name is required'),
    // Contactability is checked in the service, not here: "phone OR email" is
    // a rule about the lead, and stating it in one place keeps the manual and
    // webhook paths honest too.
    phone: trimmed(40).optional(),
    email: z.string().trim().email('That email address is not valid').max(160).optional()
      .or(z.literal('')),
    company: trimmed(160).optional(),
    city: trimmed(80).optional(),
    message: trimmed(4000).optional(),
    productInterest: trimmed(120).optional(),

    /* ── Attribution ─────────────────────────────────────────
       Accepted in both shapes because forms send them both ways: flat
       `utm_source` fields from a query string, or a nested object from a
       script that already parsed them. */
    utm_source: trimmed(120).optional(),
    utm_medium: trimmed(120).optional(),
    utm_campaign: trimmed(160).optional(),
    utm_term: trimmed(160).optional(),
    utm_content: trimmed(160).optional(),
    utm: z.object({
      source: trimmed(120).optional(),
      medium: trimmed(120).optional(),
      campaign: trimmed(160).optional(),
      term: trimmed(160).optional(),
      content: trimmed(160).optional(),
    }).optional(),

    formId: trimmed(80).optional(),
    source: z.enum(LEAD_SOURCE_VALUES).optional(),

    /**
     * The honeypot.
     *
     * A field the real form hides with CSS, so a human never fills it and a
     * bot that fills every input always does. Accepted rather than rejected
     * here — see the middleware for why silence beats a 400.
     */
    website_url: z.string().max(200).optional(),
  }).strict(),
});

/** Manual entry, by a signed-in agent. Looser: a rep on a phone call has the
 *  person's name and number and not much else, and demanding more just means
 *  the lead gets written on paper instead. */
export const manualLeadSchema = z.object({
  body: z.object({
    name: trimmed(120).min(1, 'Name is required'),
    phone: trimmed(40).optional(),
    email: z.string().trim().email().max(160).optional().or(z.literal('')),
    company: trimmed(160).optional(),
    designation: trimmed(120).optional(),
    city: trimmed(80).optional(),
    region: trimmed(80).optional(),
    message: trimmed(4000).optional(),
    productInterest: trimmed(120).optional(),
    estimatedValue: z.coerce.number().min(0).optional(),
    segment: trimmed(60).optional(),
    language: trimmed(40).optional(),
    source: z.enum(LEAD_SOURCE_VALUES).optional(),
    sourceDetail: trimmed(200).optional(),
    /** "Yes, I know it looks like a duplicate — create it anyway." Only an
     *  authenticated human may say this; the public form never can. */
    force: z.coerce.boolean().optional(),
  }).strict(),
});

export const duplicateCheckSchema = z.object({
  query: z.object({
    phone: trimmed(40).optional(),
    email: trimmed(160).optional(),
    name: trimmed(120).optional(),
    company: trimmed(160).optional(),
  }),
});

/** Flat `utm_*` keys and a nested `utm` object → one nested shape. */
export function collectUtm(body = {}) {
  const utm = {
    source: body.utm?.source || body.utm_source,
    medium: body.utm?.medium || body.utm_medium,
    campaign: body.utm?.campaign || body.utm_campaign,
    term: body.utm?.term || body.utm_term,
    content: body.utm?.content || body.utm_content,
  };
  return Object.values(utm).some(Boolean) ? utm : undefined;
}
