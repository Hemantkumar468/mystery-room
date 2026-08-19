import { DEFAULT_PHONE_REGION } from '../crm.constants.js';

/**
 * Phone numbers, in one canonical form.
 *
 * The number is the primary duplicate key, so "98765 43210", "+91 98765-43210"
 * and "091-9876543210" have to compare equal — otherwise the same customer is
 * three records being chased by three agents, which is the single most visible
 * failure a CRM can have.
 *
 * Deliberately NOT libphonenumber. That library is ~500KB to answer a question
 * this business has one form of: Indian mobile numbers, occasionally with a
 * country code. When a second country is added, swap this file's internals —
 * every caller goes through `normalisePhone`, so nothing else changes.
 */

/** Digits only, plus a leading + if the caller wrote one. */
const strip = (raw) => String(raw ?? '').trim().replace(/[^\d+]/g, '');

/**
 * A raw phone string → E.164 (`+919876543210`), or null if it cannot be one.
 *
 * Returning null rather than the input is the point: a value that failed to
 * normalise must never reach the phone column, or it silently stops matching
 * everything and the duplicate check goes quiet instead of loud.
 */
export function normalisePhone(raw, region = DEFAULT_PHONE_REGION) {
  let s = strip(raw);
  if (!s) return null;

  // "00" is the international prefix everywhere except North America; treat it
  // as the "+" the caller's keypad could not produce.
  if (s.startsWith('00')) s = `+${s.slice(2)}`;

  if (s.startsWith('+')) {
    const digits = s.slice(1);
    // 8 is the shortest national number in use anywhere; 15 is E.164's ceiling.
    if (digits.length < 8 || digits.length > 15) return null;
    return `+${digits}`;
  }

  // A domestic trunk prefix: 09876543210 is the same as 9876543210.
  if (s.length === 11 && s.startsWith('0')) s = s.slice(1);

  // Country code typed without the plus: 919876543210.
  const cc = region.replace('+', '');
  if (s.length > 10 && s.startsWith(cc)) return `+${s}`;

  if (s.length === 10) return `${region}${s}`;

  // Anything else — a 4-digit extension, a truncated paste — is not a number
  // anyone can be called back on.
  return null;
}

/**
 * How the number should be SHOWN: +91 98765 43210.
 *
 * Display formatting is separate from storage on purpose. The stored value has
 * exactly one form so it can be compared; the displayed value is for humans
 * reading it off a screen and dialling it by hand.
 */
export function formatPhone(e164) {
  if (!e164 || !e164.startsWith(DEFAULT_PHONE_REGION)) return e164 || '';
  const national = e164.slice(DEFAULT_PHONE_REGION.length);
  if (national.length !== 10) return e164;
  return `${DEFAULT_PHONE_REGION} ${national.slice(0, 5)} ${national.slice(5)}`;
}

/**
 * A number masked for list views: +91 98765 43210 → +91 987*****10.
 *
 * List screens are where a whole customer database gets copied out one
 * screenshot at a time. The detail page reveals the real number and logs that
 * it was revealed; the list shows enough to recognise a record and not enough
 * to dial it.
 */
export function maskPhone(e164) {
  if (!e164) return '';
  const tail = e164.slice(-2);
  const head = e164.slice(0, Math.max(0, e164.length - 7));
  return `${head}*****${tail}`;
}

export default normalisePhone;
