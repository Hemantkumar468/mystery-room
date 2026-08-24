/**
 * REGRESSION SUITE — a phone number cannot be stored in any form but E.164.
 *
 * THE BUG THIS EXISTS FOR. 97 live records held `+91 8762350990`, with a
 * space. Three features were silently broken by it: the inbound screen-pop
 * matched nobody, duplicate detection called every repeat enquiry new, and
 * click-to-call would have handed a provider a string with a space in it. No
 * error was ever logged, because normalisation lived in two services and both
 * of them were correct — the records had simply been written by something
 * else.
 *
 * So the assertions below deliberately do NOT go through a service. They write
 * through every Mongoose path a future service could reach for, then read the
 * result back with the RAW DRIVER, bypassing Mongoose entirely, because the
 * question is what is on disk and not what a getter is willing to show.
 *
 * If someone moves this rule back into a service, these tests fail — which is
 * the point. The lesson from the Agenda outage was that a test sitting inside
 * the boundary proves nothing about the boundary.
 */
import 'dotenv/config';
import { connect, disconnect, mongoose } from '../helpers/db.js';
import { ok, no, finish } from '../helpers/assert.js';

const conn = await connect();
console.log(`Connected: ${conn.name}\n`);

const B = '../../src/modules/crm';
const { Lead } = await import(`${B}/leads/lead.model.js`);
const { Contact } = await import(`${B}/contacts/contact.model.js`);
const { normalisePhone, attachPhoneNormalisation } = await import(`${B}/intake/phone.js`);
const { leadIntakeService } = await import(`${B}/intake/leadIntake.service.js`);
const { mapGraphLead } = await import(`${B}/integrations/meta.service.js`);
const { contactService } = await import(`${B}/contacts/contact.service.js`);
const { User } = await import('../../src/modules/auth/auth.model.js');

const is = (name, actual, expected) => (
  actual === expected ? ok(name) : no(name, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`)
);
const truthy = (name, v, detail = '') => ((v ? ok : no)(name, detail || (v ? '' : `got ${JSON.stringify(v)}`)));

const TAG = `PHONETEST-${Date.now()}`;
const TYPED = '+91 87623 50990'; // what a human types, spaces and all
const CANONICAL = '+918762350990';
const made = { leads: [], contacts: [] };

/** Read straight from MongoDB — no Mongoose casting, getters or virtuals. */
const onDisk = async (Model, id) => mongoose.connection.db
  .collection(Model.collection.name)
  .findOne({ _id: id });

const newLead = async (extra = {}) => {
  const lead = await Lead.create({ name: TAG, source: 'manual', ...extra });
  made.leads.push(lead._id);
  return lead;
};

try {
  /* ── Every write path Mongoose offers ───────────────────────────── */
  console.log('── No write path can put a space in the phone column ──');

  {
    const lead = await newLead({ phone: TYPED });
    const raw = await onDisk(Lead, lead._id);
    is('create() normalises', raw.phone, CANONICAL);
    is('create() keeps what was typed', raw.phoneRaw, TYPED);
  }

  {
    const lead = new Lead({ name: TAG, source: 'manual' });
    lead.phone = TYPED;
    await lead.save();
    made.leads.push(lead._id);
    is('assignment + save() normalises', (await onDisk(Lead, lead._id)).phone, CANONICAL);
  }

  {
    const [lead] = await Lead.insertMany([{ name: TAG, source: 'manual', phone: TYPED }]);
    made.leads.push(lead._id);
    const raw = await onDisk(Lead, lead._id);
    is('insertMany() normalises', raw.phone, CANONICAL);
    is('insertMany() keeps what was typed', raw.phoneRaw, TYPED);
  }

  {
    const lead = await newLead();
    await Lead.updateOne({ _id: lead._id }, { $set: { phone: TYPED } });
    const raw = await onDisk(Lead, lead._id);
    is('updateOne($set) normalises', raw.phone, CANONICAL);
    is('updateOne($set) keeps what was typed', raw.phoneRaw, TYPED);
  }

  {
    const lead = await newLead();
    await Lead.updateOne({ _id: lead._id }, { phone: TYPED });
    is('updateOne(bare) normalises', (await onDisk(Lead, lead._id)).phone, CANONICAL);
  }

  {
    const lead = await newLead();
    await Lead.findOneAndUpdate({ _id: lead._id }, { $set: { phone: TYPED } });
    const raw = await onDisk(Lead, lead._id);
    is('findOneAndUpdate() normalises', raw.phone, CANONICAL);
    is('findOneAndUpdate() keeps what was typed', raw.phoneRaw, TYPED);
  }

  {
    const lead = await newLead();
    await Lead.updateMany({ _id: lead._id }, { $set: { phone: TYPED } });
    is('updateMany() normalises', (await onDisk(Lead, lead._id)).phone, CANONICAL);
  }

  {
    // bulkWrite bypasses query middleware but is still cast, so the match key
    // is safe even though no raw copy is captured. The migration is the one
    // caller that needs the raw, and it writes phoneRaw itself.
    const lead = await newLead();
    await Lead.bulkWrite([{ updateOne: { filter: { _id: lead._id }, update: { $set: { phone: TYPED } } } }]);
    is('bulkWrite() normalises', (await onDisk(Lead, lead._id)).phone, CANONICAL);
  }

  /* ── The forms the same number arrives in ───────────────────────── */
  console.log('\n── The same customer, however they were typed in ──');
  const FORMS = ['8762350990', '08762350990', '918762350990', '+91-87623-50990', '0091 8762350990', '+91 8762350990'];
  for (const form of FORMS) {
    // eslint-disable-next-line no-await-in-loop
    const lead = await newLead({ phone: form });
    // eslint-disable-next-line no-await-in-loop
    is(`"${form}"`, (await onDisk(Lead, lead._id)).phone, CANONICAL);
  }

  /* ── A number that will not parse ───────────────────────────────── */
  console.log('\n── A number nothing can dial ──');
  {
    const lead = await newLead({ phone: '1234' });
    const raw = await onDisk(Lead, lead._id);
    truthy('an unparseable number does not block the write', Boolean(raw));
    is('and never reaches the match column', raw.phone ?? null, null);
    is('but is kept so a human can still read it', raw.phoneRaw, '1234');
  }

  /* ── Contacts, including the second number ──────────────────────── */
  console.log('\n── Contacts, both numbers ──');
  {
    const contact = await Contact.create({ name: TAG, phone: TYPED, altPhone: '080 4000 1111' });
    made.contacts.push(contact._id);
    const raw = await onDisk(Contact, contact._id);
    is('contact phone normalises', raw.phone, CANONICAL);
    is('contact altPhone normalises', raw.altPhone, '+918040001111');
    is('contact keeps what was typed', raw.phoneRaw, TYPED);
  }
  {
    const contact = await Contact.create({ name: TAG });
    made.contacts.push(contact._id);
    await Contact.updateOne({ _id: contact._id }, { $set: { altPhone: TYPED } });
    is('contact altPhone normalises on update', (await onDisk(Contact, contact._id)).altPhone, CANONICAL);
  }

  /* ── Things that must NOT change ────────────────────────────────── */
  console.log('\n── What the guard must leave alone ──');
  {
    const lead = await newLead({ phone: CANONICAL });
    const raw = await onDisk(Lead, lead._id);
    is('an already-canonical number is unchanged', raw.phone, CANONICAL);
    is('and no pointless raw copy is stored', raw.phoneRaw ?? null, null);
  }
  {
    // Intake supplies its own raw value; the guard must not overwrite what the
    // service recorded as the customer's actual input.
    const lead = await newLead({ phone: TYPED, phoneRaw: 'from the web form' });
    const raw = await onDisk(Lead, lead._id);
    is('an explicit phoneRaw wins on create', raw.phoneRaw, 'from the web form');
    is('and the number is still canonical', raw.phone, CANONICAL);
  }
  {
    const lead = await newLead();
    await Lead.updateOne({ _id: lead._id }, { $set: { phone: TYPED, phoneRaw: 'typed by the agent' } });
    is('an explicit phoneRaw wins on update', (await onDisk(Lead, lead._id)).phoneRaw, 'typed by the agent');
  }
  {
    const lead = await newLead({ phone: TYPED });
    await Lead.updateOne({ _id: lead._id }, { $set: { phone: null } });
    is('clearing a number still works', (await onDisk(Lead, lead._id)).phone ?? null, null);
  }
  {
    const lead = await newLead({ phone: TYPED });
    const found = await Lead.findOne({ _id: lead._id, phone: TYPED }).lean();
    truthy('a lookup by the typed form finds the canonical record', Boolean(found),
      found ? '' : 'setters did not run on the filter');
    const byCanonical = await Lead.findOne({ _id: lead._id, phone: CANONICAL }).lean();
    truthy('and so does a lookup by the canonical form', Boolean(byCanonical));
  }
  {
    // The list-view search passes a RegExp. Setters skip those; if they ever
    // stopped skipping them, every search would quietly return nothing.
    const lead = await newLead({ phone: TYPED });
    const rx = new RegExp('87623');
    const hits = await Lead.find({ _id: lead._id, $or: [{ name: rx }, { phone: rx }] }).lean();
    is('search by partial number still works', hits.length, 1);
  }


  /* ── The doors a phone number actually comes through ───────────── */
  console.log('\n── Every real entry point, not just every Mongoose method ──');
  /* The block above proves the DATABASE cannot hold a spaced number. This one
     proves the APPLICATION cannot put one there, which is a different claim:
     a service could normalise to something else, or drop the field, or write
     to a path the guard is not on. These go through the same functions the
     web form, the manual form, the Meta webhook and the contact screen call. */
  {
    const mdUser = await User.findOne({ role: 'md' }).select('_id name').lean();
    const md = { _id: mdUser._id, id: String(mdUser._id), role: 'md', name: mdUser.name };

    // 1. The manual entry form and the public web form both land here.
    const { lead: manual } = await leadIntakeService.intake({
      name: `${TAG} manual form`, phone: TYPED, source: 'manual', city: 'Indore',
    }, { actor: md });
    made.leads.push(manual._id);
    is('the manual/web intake form normalises', (await onDisk(Lead, manual._id)).phone, CANONICAL);

    // 2. The Meta webhook: a Graph payload, mapped and taken in.
    const mapped = mapGraphLead({
      id: `${TAG}-graph-1`,
      form_id: '99',
      campaign_name: 'Franchise Aug',
      field_data: [
        { name: 'full_name', values: [`${TAG} meta lead`] },
        { name: 'phone_number', values: ['+91 87623 50990'] },
      ],
    });
    is('Meta hands over the number exactly as the form captured it', mapped.phone, '+91 87623 50990');
    const { lead: fromMeta } = await leadIntakeService.intake(mapped);
    made.leads.push(fromMeta._id);
    is('and the Meta webhook path normalises', (await onDisk(Lead, fromMeta._id)).phone, CANONICAL);

    // 3. The contact form, and then editing it.
    const created = await contactService.create({ name: `${TAG} contact form`, phone: TYPED }, md);
    made.contacts.push(created._id);
    is('the contact form normalises', (await onDisk(Contact, created._id)).phone, CANONICAL);

    await contactService.update(String(created._id), { phone: '098765 43210' }, md);
    is('and editing a contact normalises the new number',
      (await onDisk(Contact, created._id)).phone, '+919876543210');

    // 4. Whatever writes next. There is no CSV import yet — it is Block 4 —
    //    so this asserts the guard is on the model rather than on any caller,
    //    which is what will make that import safe before it is written.
    const raw = new Lead({ name: `${TAG} some future importer`, source: 'manual' });
    raw.phone = '  +91 87623-50990  ';
    await raw.save();
    made.leads.push(raw._id);
    is('a caller that never heard of normalisation still cannot store a bad number',
      (await onDisk(Lead, raw._id)).phone, CANONICAL);
  }

  /* ── The guard is actually attached ─────────────────────────────── */
  console.log('\n── The guard is wired to the models that need it ──');
  /* REGISTRATION, in the sense the Agenda outage taught. A correct helper that
     no schema calls is the same outage in a different costume — and it would
     fail the same way the original did, by looking perfectly healthy. */
  for (const [label, Model, paths] of [['Lead', Lead, ['phone']], ['Contact', Contact, ['phone', 'altPhone']]]) {
    for (const path of paths) {
      const setters = Model.schema.path(path)?.setters || [];
      truthy(`${label}.${path} has the normalising setter`,
        setters.some((fn) => fn.name === 'storeCanonicalPhone'),
        setters.map((f) => f.name || '(anonymous)').join(', ') || 'no setters at all');
    }
  }

  {
    // Misspell a path and the helper must refuse at import time rather than
    // silently normalising nothing.
    const schema = new mongoose.Schema({ phone: String, phoneRaw: String });
    let message = '';
    try {
      attachPhoneNormalisation(schema, { phoneNumber: 'phoneRaw' });
    } catch (err) {
      message = err.message;
    }
    truthy('a wrong path name throws instead of doing nothing', /no path "phoneNumber"/.test(message), message);
  }

  is('normalisePhone is idempotent', normalisePhone(normalisePhone(TYPED)), CANONICAL);
} finally {
  await Lead.deleteMany({ _id: { $in: made.leads } });
  await Contact.deleteMany({ _id: { $in: made.contacts } });
  await disconnect();
}

process.exit(finish('CRM PHONE NORMALISATION'));
