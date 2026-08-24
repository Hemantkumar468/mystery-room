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

/** Where a setter parks the value it was handed, for pre('validate') to keep.
 *  A symbol so it never reaches the document, a toJSON, or an API response. */
const RAW_INPUT = Symbol('crm.phone.rawInput');

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

/**
 * Enforce E.164 at the SCHEMA, so no write path can store anything else.
 *
 * WHY THIS IS NOT IN A SERVICE. It used to be. `leadIntake.service` and
 * `contact.service` both called `normalisePhone` before assigning, and both
 * were correct — but they are not the only ways a number gets written. A CSV
 * import, a Meta webhook, an admin edit, a migration, a WhatsApp inbound
 * creating a contact, or any future service that reaches for the model
 * directly all bypass them. That is not hypothetical: 97 existing records held
 * `+91 8762350990`, with a space, and it silently disabled three features at
 * once — screen-pop matched nobody, duplicate detection called every repeat
 * enquiry new, and click-to-call would have handed a provider a string with a
 * space in it. Nothing logged an error, because from inside any one service
 * nothing had gone wrong.
 *
 * A rule enforced at N call sites holds until someone adds the N+1th. This is
 * the same move as `resolveAssignee` and the `isSeed` argument: one
 * definition, and the call sites cannot opt out of it.
 *
 * WHAT IT COVERS. Mongoose runs path setters on every write — `create`,
 * `save`, assignment, `insertMany`, `updateOne`, `updateMany`,
 * `findOneAndUpdate`, `replaceOne` and `bulkWrite`. It runs them on query
 * FILTERS too, so `findOne({ phone: '+91 87623 50990' })` finds the canonical
 * record instead of quietly returning nothing. Regular expressions bypass
 * setters, so the list-view search (`{ phone: /9876/ }`) is unaffected.
 *
 * A NUMBER THAT WILL NOT PARSE leaves `phone` null and is kept in the raw
 * field. It must not be stored as typed, because this column is the match key
 * and an unmatchable value in it is the bug itself; and it must not reject the
 * write, because losing a whole lead over a malformed phone number is worse
 * than holding one nobody can auto-dial.
 *
 * @param {import('mongoose').Schema} schema
 * @param {Record<string, string|null>} fields  path → path to keep the raw
 *   input in, or null to normalise without keeping it.
 */
export function attachPhoneNormalisation(schema, fields) {
  const entries = Object.entries(fields);

  for (const [path, rawPath] of entries) {
    const schemaType = schema.path(path);
    // Loud at boot rather than silent at runtime: renaming the field would
    // otherwise switch this guard off with nothing to notice it.
    if (!schemaType) throw new Error(`attachPhoneNormalisation: no path "${path}" on this schema.`);
    if (rawPath && !schema.path(rawPath)) {
      throw new Error(`attachPhoneNormalisation: no path "${rawPath}" on this schema.`);
    }

    schemaType.set(function storeCanonicalPhone(value) {
      // null and undefined pass straight through: they are how "no number" and
      // a `{ phone: null }` filter are written, and normalising them would turn
      // a legitimate query into one that matches nothing.
      if (value === null || value === undefined) return value;

      // Park what arrived so pre('validate') can preserve it. `this` is the
      // document on a document write, and the query when a filter is being
      // cast — where there is nothing worth keeping.
      if (this && typeof this === 'object') {
        const arrived = this[RAW_INPUT] || (this[RAW_INPUT] = {});
        arrived[path] = value;
      }
      return normalisePhone(value);
    });
  }

  /** Document writes: create, save, assignment, insertMany. */
  schema.pre('validate', function keepRawPhoneInput() {
    const arrived = this[RAW_INPUT];
    if (!arrived) return;

    for (const [path, rawPath] of entries) {
      if (!rawPath) continue;
      const original = arrived[path];
      if (original === undefined || original === null) continue;
      if (!this.isModified(path)) continue;
      // The caller gave their own raw value in this same write; theirs is
      // closer to what the customer typed than anything inferred here.
      if (this.isModified(rawPath)) continue;

      const text = String(original).trim().slice(0, 40);
      // Nothing to preserve when the input was already canonical.
      if (!text || text === this.get(path)) continue;
      this.set(rawPath, text);
    }
  });

  /**
   * Query updates: updateOne, updateMany, findOneAndUpdate, replaceOne.
   *
   * This runs before casting, the only point at which the raw string is still
   * visible — the setter has replaced it by the time the update reaches Mongo.
   * `bulkWrite` does not run query middleware, so it normalises (the setter
   * still casts it) without capturing the raw; the one caller that needs that
   * is the migration, which writes `phoneRaw` itself.
   */
  schema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne'], function keepRawPhoneOnUpdate() {
    const update = this.getUpdate();
    if (!update || Array.isArray(update)) return; // aggregation-pipeline update

    for (const [path, rawPath] of entries) {
      if (!rawPath) continue;
      const target = (update.$set && path in update.$set) ? update.$set
        : (path in update ? update : null);
      if (!target) continue;

      const original = target[path];
      if (original === null || original === undefined) continue;
      if ((update.$set && rawPath in update.$set) || rawPath in update) continue;

      const text = String(original).trim().slice(0, 40);
      if (!text || text === normalisePhone(original)) continue;
      target[rawPath] = text;
      this.setUpdate(update);
    }
  });

  return schema;
}

export default normalisePhone;
