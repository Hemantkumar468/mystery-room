/**
 * One-off migration: put every stored phone number into E.164.
 *
 * THE BUG THIS FIXES IS INVISIBLE UNTIL IT MATTERS. Numbers written before
 * intake existed — or by a seed, or an import — are stored as they were typed:
 * `+91 8762350990`, with a space. Every part of the CRM that matches on a
 * phone number compares against the normalised form, so those records are
 * unreachable by:
 *
 *   - the inbound screen-pop, which looks up the caller and finds nobody;
 *   - duplicate detection, so the same customer enquires again and again and
 *     each one looks new;
 *   - click-to-call, which would hand a string with a space to the provider.
 *
 * None of that fails loudly. The pop simply never appears, and the duplicate
 * check simply says no.
 *
 * `phoneRaw` keeps exactly what was there before, so nothing is lost — the
 * display value and the match value are separated rather than overwritten.
 *
 * Safe to run more than once: an already-normalised number is skipped.
 *
 *   node src/seed/normalisePhones.js            # report only (default)
 *   node src/seed/normalisePhones.js --apply    # write
 */
import dns from 'node:dns';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

dns.setServers(['8.8.8.8', '8.8.4.4']);

const APPLY = process.argv.includes('--apply');

/* eslint-disable no-console */
async function run() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 30_000 });

  const { Lead } = await import('../modules/crm/leads/lead.model.js');
  const { Contact } = await import('../modules/crm/contacts/contact.model.js');
  const { normalisePhone } = await import('../modules/crm/intake/phone.js');

  let changed = 0;
  let unusable = 0;

  for (const [label, Model, fields] of [
    ['leads', Lead, ['phone']],
    ['contacts', Contact, ['phone', 'altPhone']],
  ]) {
    const rows = await Model.find({
      $or: fields.map((f) => ({ [f]: { $nin: [null, ''] } })),
    }).select([...fields, 'phoneRaw', 'name'].join(' ')).lean();

    const updates = [];
    for (const row of rows) {
      const $set = {};
      for (const field of fields) {
        const current = row[field];
        if (!current) continue;
        const normalised = normalisePhone(current);

        if (normalised === null) {
          // Left exactly as it is. A number this code cannot parse might still
          // be one a human can dial, and blanking it would destroy the only
          // way anybody has of reaching that customer.
          unusable += 1;
          console.log(`  ! ${label}: "${current}" (${row.name}) cannot be parsed — left alone`);
          continue;
        }
        if (normalised === current) continue;

        $set[field] = normalised;
        // Only for the primary number, and only if nothing is there already:
        // an existing phoneRaw is what somebody actually typed, and this
        // migration must not overwrite it with a later copy.
        if (field === 'phone' && !row.phoneRaw) $set.phoneRaw = current;
      }

      if (Object.keys($set).length) {
        updates.push({ updateOne: { filter: { _id: row._id }, update: { $set } } });
        if (updates.length <= 3) {
          console.log(`  ${label}: "${row.phone}" → ${$set.phone || '(alt only)'}`);
        }
      }
    }

    console.log(`${label}: ${updates.length} of ${rows.length} need normalising.`);
    if (APPLY && updates.length) await Model.bulkWrite(updates);
    changed += updates.length;
  }

  console.log(`\n${APPLY ? 'Normalised' : 'Would normalise'} ${changed} record(s).`);
  if (unusable) console.log(`${unusable} number(s) could not be parsed and were left untouched.`);
  if (!APPLY) console.log('\nRe-run with --apply to write.');

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
