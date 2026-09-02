const config = require('../config/env');
const { badRequest } = require('./ApiError');

/**
 * Normalises a phone number to the E.164 digits-only form WhatsApp expects
 * (country code + subscriber number, no "+", no spaces, no dashes).
 *
 * Accepted inputs for India (default country code 91):
 *   9876543210        -> 919876543210
 *   09876543210       -> 919876543210
 *   +91 98765-43210   -> 919876543210
 *   919876543210      -> 919876543210
 *
 * Any other country code works as long as the number is passed with it
 * (e.g. +1 415 555 0123 -> 14155550123).
 */
function normalizePhone(input, countryCode = config.defaultCountryCode) {
  if (input === undefined || input === null) {
    throw badRequest('phone is required');
  }

  const raw = String(input).trim();
  if (!raw) throw badRequest('phone is required');

  let digits = raw.replace(/[^\d]/g, '');
  if (!digits) throw badRequest(`Invalid phone number: ${raw}`);

  // 00 international prefix -> drop it
  if (digits.startsWith('00')) digits = digits.slice(2);

  // Local trunk prefix 0 (e.g. 09876543210)
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);

  // Bare 10-digit local number -> prepend the country code
  if (digits.length === 10) digits = `${countryCode}${digits}`;

  if (digits.length < 10 || digits.length > 15) {
    throw badRequest(
      `Invalid phone number: ${raw}. Expected a 10-digit Indian number or a full number with country code.`
    );
  }

  if (digits.startsWith(config.defaultCountryCode) && config.defaultCountryCode === '91') {
    const local = digits.slice(2);
    if (local.length === 10 && !/^[6-9]/.test(local)) {
      throw badRequest(`Invalid Indian mobile number: ${raw}. It must start with 6, 7, 8 or 9.`);
    }
  }

  return digits;
}

module.exports = { normalizePhone };
