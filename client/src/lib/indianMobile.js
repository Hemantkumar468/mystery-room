/**
 * INDIAN MOBILE NUMBERS — one definition, used by every form that takes one.
 *
 * WHAT WENT WRONG BEFORE. The record form pre-filled "+91 " into every empty
 * phone field and put it back whenever it was deleted. Two consequences, both
 * visible in the queue:
 *
 *   - A field nobody touched was SAVED as the bare prefix, so a property with
 *     no owner number showed "+91" in its Owner column.
 *   - "+91 " is not empty to `isEmpty`, so a REQUIRED phone field was satisfied
 *     by the prefix alone — the form accepted a property with no number at all.
 *
 * And nothing checked that what followed the prefix was a mobile number: ten
 * digits starting with 1 went through, as did a landline.
 *
 * THE RULE NOW. A number is valid if, after removing a leading +91 / 91 / 0,
 * it is exactly ten digits and the first is 6, 7, 8 or 9 — which is what
 * every Indian mobile range starts with. The country code is part of the
 * STORED value only when there is a valid number to put it in front of;
 * a blank field stays blank, and a half-typed number is kept as the digits
 * typed so far (never prefixed) until it is complete.
 */

/**
 * The local digits of whatever was typed or pasted, country code removed.
 *
 * A leading "+" is unambiguous, so "+91" is stripped however little follows
 * it — that is what turns the old bare "+91 " into nothing instead of "91".
 * Without a "+", "91" and "0" are only treated as a prefix when more than ten
 * digits follow them, because "91" is also how a real number begins ("9198...")
 * and the person is still typing it.
 *
 * NOT cut to ten digits. An eleventh digit has to stay visible so it can be
 * flagged: cutting it silently turned "98765432101" into a valid-looking
 * "9876543210" and saved the wrong number as a good one. The ceiling below
 * only bounds garbage, it does not decide validity.
 */
export function localDigits(raw) {
  const text = String(raw ?? '').trim();
  let d = text.replace(/\D/g, '');
  if (text.startsWith('+')) {
    if (d.startsWith('91')) d = d.slice(2);
  } else if (d.length > 10 && d.startsWith('91')) {
    d = d.slice(2);
  } else if (d.length > 10 && d.startsWith('0')) {
    d = d.slice(1);
  }
  return d.slice(0, 13);
}

/** True for a complete, valid Indian mobile number in any accepted spelling. */
export function isValidIndianMobile(raw) {
  return /^[6-9]\d{9}$/.test(localDigits(raw));
}

/**
 * What to STORE for what was typed.
 *
 *   ""            -> ""                     (nothing entered: nothing stored)
 *   "9876"        -> "9876"                 (still typing: the digits, no prefix)
 *   "9876543210"  -> "+91 9876543210"       (a real number: now it gets its code)
 *   "1234567890"  -> "1234567890"           (ten digits but not a mobile: no code)
 *   "+91 "        -> ""                     (the old bare prefix: treated as blank)
 */
export function storeMobile(raw) {
  const d = localDigits(raw);
  if (!d) return '';
  return /^[6-9]\d{9}$/.test(d) ? `+91 ${d}` : d;
}

/** The message for a number that was entered and is not a valid mobile. */
export const INVALID_MOBILE = 'Invalid Mobile Number';

/**
 * null when there is nothing wrong — which includes nothing entered at all,
 * because whether a blank is allowed is the field's `required`, not ours.
 */
export function mobileError(raw) {
  if (!localDigits(raw)) return null;
  return isValidIndianMobile(raw) ? null : INVALID_MOBILE;
}

/**
 * A number to SHOW, or '' when there is none.
 *
 * Reads records that were saved before this fix: a field left blank was
 * stored as the bare "+91 ", and that must not print as a phone number. The
 * stored text is otherwise returned untouched — it is already in the
 * "+91 9876543210" shape every existing row uses.
 */
export function displayMobile(stored) {
  const text = String(stored ?? '').trim();
  if (!text) return '';
  return localDigits(text) ? text : '';
}

/**
 * Whether a form field holds a phone/mobile number, judged by its key or label
 * ("owner_phone", "Mobile", "WhatsApp number"). Text-like fields only: a file
 * field called "Phone bill" is not a number to validate.
 */
export function isPhoneField(field) {
  const textLike = !field?.type || field.type === 'text' || field.type === 'phone' || field.type === 'tel';
  return textLike
    && /(phone|mobile|whatsapp|contact_no|contact_number)/i.test(`${field?.key || ''} ${field?.label || ''}`);
}
