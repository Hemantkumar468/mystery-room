/**
 * REGRESSION SUITE — CRM contacts, companies, routing rules and preferences.
 *
 * These four services shipped without tests, and the Agenda outage is the
 * argument for writing them: four jobs were dead for hours while 77 tests
 * stayed green, because every test sat INSIDE the boundary and none asked
 * whether the thing that calls the code could call it.
 *
 * So this suite covers two kinds of thing:
 *
 *   BEHAVIOUR — scoping and permission, which is where these services can be
 *   wrong in ways nobody notices until data leaks. An agent must get NOTHING
 *   for a record that is not theirs, and 404 rather than 403: "that exists but
 *   is not yours" is itself a fact about the customer database.
 *
 *   REGISTRATION — that each service is actually reachable from the router
 *   that is supposed to expose it. A perfect service nothing calls is the same
 *   outage in a different costume.
 */
import 'dotenv/config';
import { connect, disconnect, mongoose } from '../helpers/db.js';
import { ok, no, finish } from '../helpers/assert.js';
import { assertRoutesRegistered } from '../helpers/routes.js';

const conn = await connect();
console.log(`Connected: ${conn.name}\n`);

const B = '../../src/modules/crm';
const { contactService, companyService } = await import(`${B}/contacts/contact.service.js`);
const { routingRuleService, routingVocabulary } = await import(`${B}/routing/routingRule.service.js`);
const { Contact } = await import(`${B}/contacts/contact.model.js`);
const { Company } = await import(`${B}/companies/company.model.js`);
const { RoutingRule } = await import(`${B}/routing/routingRule.model.js`);
const { User } = await import('../../src/modules/auth/auth.model.js');
const { createApp } = await import('../../src/app.js');

const is = (name, actual, expected) => (
  actual === expected ? ok(name) : no(name, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`)
);
const truthy = (name, v, detail = '') => ((v ? ok : no)(name, detail || (v ? '' : `got ${JSON.stringify(v)}`)));
const throws = async (name, fn, re) => {
  try {
    await fn();
    no(name, 'expected a refusal, but it SUCCEEDED');
  } catch (err) {
    (re.test(err.message) ? ok : no)(name, err.message.slice(0, 80));
  }
};

const tag = `ZZADM-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
const mdUser = await User.findOne({ role: 'md' }).select('_id name').lean();
const agentUser = await User.findOne({ role: 'employee' }).select('_id name').lean();
const otherAgent = await User.findOne({ role: 'employee', _id: { $ne: agentUser?._id } })
  .select('_id name').lean();
const viewerUser = await User.findOne({ role: 'viewer' }).select('_id name').lean();

const md = { _id: mdUser._id, id: String(mdUser._id), role: 'md', name: mdUser.name };
const agent = agentUser
  ? { _id: agentUser._id, id: String(agentUser._id), role: 'employee', name: agentUser.name }
  : null;
const other = otherAgent
  ? { _id: otherAgent._id, id: String(otherAgent._id), role: 'employee', name: otherAgent.name }
  : null;

await Promise.all([
  Contact.deleteMany({ name: /^ZZADM-/ }),
  Company.deleteMany({ name: /^ZZADM-/ }),
  RoutingRule.deleteMany({ name: /^ZZADM-/ }),
]);
const cleanup = [];

/* ══ Companies ════════════════════════════════════════════════ */
console.log('── A company, and the people in it ──');
const company = await companyService.create({
  name: `${tag} Sharma Enterprises`, city: 'Indore', website: 'https://sharma.example',
}, md);
cleanup.push(() => Company.deleteOne({ _id: company._id }));
truthy('a company can be created', company._id, company.name);
is('owned by whoever made it', String(company.owner), String(mdUser._id));

const person = await contactService.create({
  name: `${tag} Rakesh`, phone: '98765 43210', company: String(company._id),
  designation: 'Director', whatsappOptIn: true,
}, md);
cleanup.push(() => Contact.deleteOne({ _id: person._id }));
is('the phone is normalised on the way in', person.phone, '+919876543210');
is('and the raw value kept', person.phoneRaw, '98765 43210');

console.log('\n── Consent is recorded as evidence, not a boolean ──');
truthy('opting in stamps WHEN', person.whatsappOptInAt);
truthy('and HOW', person.whatsappOptInSource, person.whatsappOptInSource);

const optedOut = await contactService.update(String(person._id), { whatsappOptIn: false }, md);
is('withdrawing consent clears the flag', optedOut.whatsappOptIn, false);
is('and the date with it', optedOut.whatsappOptInAt, undefined);

console.log('\n── A form cannot forge the consent date ──');
const forged = await contactService.update(String(person._id), {
  whatsappOptIn: true,
  // Both of these are the system's to decide.
  whatsappOptInAt: new Date('2001-01-01'),
  owner: String(other?._id || mdUser._id),
}, md);
truthy('the stamp is the server\'s, not the caller\'s',
  new Date(forged.whatsappOptInAt).getFullYear() > 2020,
  new Date(forged.whatsappOptInAt).toISOString().slice(0, 10));
is('and ownership cannot be reassigned through an edit',
  String(forged.owner), String(mdUser._id));

console.log('\n── A company list counts its people ──');
const listed = await companyService.list({ search: tag }, md);
is('the company is findable', listed.total, 1);
is('with a head count', listed.items[0].contactCount, 1);

const detail = await companyService.detail(String(company._id), md);
is('and its detail lists them', detail.contacts[0].name, `${tag} Rakesh`);
truthy('with the phone masked even here',
  detail.contacts[0].phone?.includes('*'), detail.contacts[0].phone);

console.log('\n── Contact detail shows the REAL number ──');
const contactDetail = await contactService.detail(String(person._id), md);
is('opening a record reveals it', contactDetail.contact.phone, '+919876543210');
truthy('and returns the timeline, deals and tasks',
  ['timeline', 'deals', 'tasks'].every((k) => k in contactDetail),
  Object.keys(contactDetail).join(', '));

/* ══ Scoping ══════════════════════════════════════════════════ */
console.log('\n── An agent gets NOTHING for a record that is not theirs ──');
if (agent) {
  const notMine = await contactService.detail(String(person._id), agent);
  is('the detail comes back null, so the route can 404',
    notMine, null);

  const theirList = await contactService.list({ search: tag }, agent);
  is('and it is absent from their list', theirList.total, 0);

  await throws(
    'editing it is refused as not-found, not as forbidden',
    () => contactService.update(String(person._id), { city: 'Nowhere' }, agent),
    /not found/i,
  );

  const companyNotMine = await companyService.detail(String(company._id), agent);
  is('the same for companies', companyNotMine, null);
} else {
  ok('no employee account to test scoping with — skipped');
}

console.log('\n── An agent cannot hand a record to somebody else ──');
if (agent && other) {
  await throws(
    'creating a contact owned by a colleague is refused',
    () => contactService.create({
      name: `${tag} Dumped`, phone: '9000000011', owner: String(other._id),
    }, agent),
    /Only a manager can assign/i,
  );

  const mine = await contactService.create({ name: `${tag} Mine`, phone: '9000000012' }, agent);
  cleanup.push(() => Contact.deleteOne({ _id: mine._id }));
  is('but one for themselves is fine', String(mine.owner), String(agent._id));
}

if (viewerUser) {
  await throws(
    'and nobody can hand one to a read-only role',
    () => contactService.create({
      name: `${tag} ForViewer`, phone: '9000000013', owner: String(viewerUser._id),
    }, md),
    /cannot be given work/i,
  );
} else {
  ok('no viewer account to test with — skipped');
}

/* ══ Routing rules ════════════════════════════════════════════ */
console.log('\n── Routing rules: readable by all, editable by managers ──');
const rule = await routingRuleService.create({
  name: `${tag} Indore territory`,
  priority: 50,
  conditions: [{ field: 'city', op: 'in', value: ['Indore'] }],
  strategy: 'round-robin',
  targetTeam: 'expansion',
}, md);
cleanup.push(() => RoutingRule.deleteOne({ _id: rule._id }));
truthy('a manager can create one', rule._id, rule.name);

const rules = await routingRuleService.list();
const mine2 = rules.find((r) => String(r._id) === String(rule._id));
truthy('it appears in the list', mine2);
truthy('with the size of the team it points at',
  mine2.teamSize !== null && mine2.teamSize !== undefined, `teamSize=${mine2.teamSize}`);

if (agent) {
  await throws(
    'an agent cannot create one',
    () => routingRuleService.create({ name: `${tag} sneaky`, conditions: [] }, agent),
    /Only a manager/i,
  );
  await throws(
    'nor edit one',
    () => routingRuleService.update(String(rule._id), { priority: 1 }, agent),
    /Only a manager/i,
  );
  await throws(
    'nor delete one',
    () => routingRuleService.remove(String(rule._id), agent),
    /Only a manager/i,
  );
}

console.log('\n── A rule the engine could not evaluate cannot be stored ──');
await throws(
  'an unknown field is refused',
  () => routingRuleService.create({
    name: `${tag} bad field`,
    conditions: [{ field: 'secretSalary', op: 'eq', value: 1 }],
  }, md),
  /validation|secretSalary|enum/i,
);
await throws(
  'an unknown operator is refused',
  () => routingRuleService.create({
    name: `${tag} bad op`,
    conditions: [{ field: 'city', op: 'sql-inject', value: 'x' }],
  }, md),
  /validation|sql-inject|enum/i,
);

console.log('\n── Clearing a target is possible, not just setting one ──');
const specific = await routingRuleService.update(String(rule._id), {
  strategy: 'specific-user', targetUser: String(mdUser._id),
}, md);
is('a rule can point at a person', String(specific.targetUser), String(mdUser._id));
const backToTeam = await routingRuleService.update(String(rule._id), {
  strategy: 'round-robin', targetUser: '',
}, md);
is('and be switched back, clearing them', backToTeam.targetUser, undefined);

console.log('\n── The last catch-all cannot be deleted ──');
const existingCatchAlls = await RoutingRule.countDocuments({ isActive: true, conditions: { $size: 0 } });
const catchAll = await routingRuleService.create({
  name: `${tag} catch-all`, priority: 999, conditions: [], strategy: 'round-robin',
}, md);
cleanup.push(() => RoutingRule.deleteOne({ _id: catchAll._id }));

if (existingCatchAlls === 0) {
  await throws(
    'deleting the only one is refused',
    () => routingRuleService.remove(String(catchAll._id), md),
    /only catch-all/i,
  );
} else {
  // Another catch-all already exists, so removing this one is legitimate —
  // the rule protects the LAST one, not every one.
  const gone = await routingRuleService.remove(String(catchAll._id), md);
  ok('with another catch-all present, this one may be deleted', String(gone._id));
}

console.log('\n── The vocabulary is served, not duplicated in the client ──');
const vocab = routingVocabulary();
truthy('fields are listed', vocab.fields.length > 0, vocab.fields.slice(0, 3).join(', '));
truthy('operators too', vocab.operators.includes('eq'));
truthy('and strategies', vocab.strategies.includes('round-robin'));

/* ══ REGISTRATION — is any of this reachable? ═════════════════ */
console.log('\n── Every service is actually wired to a route ──');
/* THE LESSON FROM THE AGENDA OUTAGE, applied here. Above this line every
 * service is proven correct; none of it proves the router exposes them. A
 * perfect service nothing calls is the same failure in a different costume. */
/* THIS BLOCK USED TO BE WRONG, and worth recording. It hit each path over
 * HTTP with no token and read 401 as "wired", 404 as "missing". But every CRM
 * router sits behind a blanket `router.use(authenticate)`, so the 401 comes
 * back BEFORE any route matching: `/crm/this-route-does-not-exist` answered
 * 401 too. Every assertion here would have passed for a module nobody had
 * written — the same shape of failure as the Agenda outage, in the very test
 * written to catch it.
 *
 * It now asks Express what is mounted. See tests/helpers/routes.js. */
assertRoutesRegistered(createApp(), [
  ['GET', '/crm/contacts'],
  ['POST', '/crm/contacts'],
  ['GET', '/crm/companies'],
  ['POST', '/crm/companies'],
  ['GET', '/crm/routing/rules'],
  ['POST', '/crm/routing/rules'],
  ['GET', '/crm/routing/vocabulary'],
  ['GET', '/crm/preferences'],
  ['PATCH', '/crm/preferences'],
  ['GET', '/crm/today'],
  ['GET', '/crm/board'],
  ['GET', '/crm/telephony/ringing'],
], { ok, no });

/* ══ Teardown ═════════════════════════════════════════════════ */
console.log('\n── Tidy up ──');
for (const undo of cleanup.reverse()) await undo();
is('no fixtures left behind',
  (await Contact.countDocuments({ name: new RegExp(tag) }))
  + (await Company.countDocuments({ name: new RegExp(tag) }))
  + (await RoutingRule.countDocuments({ name: new RegExp(tag) })), 0);

await disconnect();
process.exit(finish('CRM RECORDS & ADMIN'));
