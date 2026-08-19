/**
 * REGRESSION SUITE — CRM Phase 5: lead capture.
 *
 * Covers the whole intake path against a real MongoDB and a real Express app
 * on an ephemeral port: web form → guards → validation → dedupe → routing →
 * lead → timeline, plus the Meta webhook's signature and mapping.
 *
 * Every fixture is created and torn down by the suite. Run via
 * `npm run test:regression` from server/.
 *
 * NOTHING external is contacted: the Graph API is never called (only its
 * response is mapped), and the app is started in-process rather than assumed
 * to be running.
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import { connect, disconnect, mongoose } from '../helpers/db.js';
import { ok, no, finish } from '../helpers/assert.js';

/* Configure the public endpoint BEFORE config/index.js is first imported —
   it reads process.env once, at import time. */
process.env.CRM_FORM_KEYS = 'test-form:secret_abc123,other-form:secret_xyz789';
process.env.META_VERIFY_TOKEN = 'verify_me';
process.env.META_APP_SECRET = 'app_secret_for_tests';
process.env.META_PAGE_TOKEN = 'page_token_for_tests';

const conn = await connect();
console.log(`Connected: ${conn.name}\n`);

const B = '../../src/modules/crm';
const { Lead } = await import(`${B}/leads/lead.model.js`);
const { CrmActivity } = await import(`${B}/activities/crmActivity.model.js`);
const { RoutingRule, RoutingCounter } = await import(`${B}/routing/routingRule.model.js`);
const { routingService } = await import(`${B}/routing/routing.service.js`);
const { leadIntakeService } = await import(`${B}/intake/leadIntake.service.js`);
const { leadService } = await import(`${B}/leads/lead.service.js`);
const { crmDashboardService } = await import(`${B}/dashboard/crmDashboard.service.js`);
const { normalisePhone, maskPhone } = await import(`${B}/intake/phone.js`);
const { buildScope } = await import(`${B}/shared/scope.js`);
const { verifyMetaSignature, mapGraphLead } = await import(`${B}/integrations/meta.service.js`);
const { resetFormKeys } = await import(`${B}/intake/intake.guards.js`);
const { LEAD_SOURCE, LEAD_STATUS } = await import(`${B}/crm.constants.js`);
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
    (re.test(err.message) ? ok : no)(name, err.message.slice(0, 90));
  }
};

const tag = `ZZCAP-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
const cleanup = [];
resetFormKeys();

/**
 * Clear anything a previous run left behind.
 *
 * A suite that crashes half way through never reaches its teardown, and its
 * routing rules then outlive it — sorted by priority and creation order, the
 * OLD rule wins and every routing assertion in the next run fails with a
 * confusing "expected this run's tag, got a different one". Test fixtures are
 * the one kind of leftover that breaks the next test rather than the app, so
 * this sweeps before it starts as well as after it finishes.
 */
await Promise.all([
  RoutingRule.deleteMany({ name: /^ZZCAP-/ }),
  Lead.deleteMany({ name: /^ZZCAP-/ }),
]);

/* ══ Phone normalisation ══════════════════════════════════════ */
console.log('── One phone number, one stored form ──');
const SAME = ['98765 43210', '+91 98765-43210', '09876543210', '919876543210', '0091 9876543210'];
const normalised = SAME.map((s) => normalisePhone(s));
is('every way of writing it normalises identically',
  new Set(normalised).size, 1);
is('and to E.164', normalised[0], '+919876543210');
is('an unusable number is null, not a bad value', normalisePhone('1234'), null);
is('a foreign number keeps its own country code', normalisePhone('+1 415 555 2671'), '+14155552671');
is('list views mask it', maskPhone('+919876543210'), '+91987*****10');

/* ══ Routing ══════════════════════════════════════════════════ */
console.log('\n── Routing: everyone gets a turn ──');
const agents = await User.find({ isActive: { $ne: false } }).select('_id name').limit(4).lean();
if (agents.length < 3) { console.error('Need at least 3 users to test rotation.'); process.exit(1); }

// A catch-all rule, which every routing chain must have.
const catchAll = await RoutingRule.create({
  name: `${tag} catch-all`, priority: 900, conditions: [], strategy: 'round-robin',
});
cleanup.push(() => RoutingRule.deleteOne({ _id: catchAll._id }));

const picks = [];
for (let i = 0; i < 6; i += 1) {
  const { assignedTo } = await routingService.route({ name: 'x', city: 'Pune' });
  picks.push(String(assignedTo));
}
truthy('every lead got an owner', picks.every(Boolean), picks.filter(Boolean).length + '/6');
truthy('and the rotation spread them', new Set(picks).size >= 3,
  `${new Set(picks).size} distinct agents across 6 leads`);

console.log('\n── Routing: conditions, in priority order ──');
const cityRule = await RoutingRule.create({
  name: `${tag} Indore territory`,
  priority: 10,
  conditions: [{ field: 'city', op: 'in', value: ['Indore', 'Bhopal'] }],
  strategy: 'specific-user',
  targetUser: agents[0]._id,
});
cleanup.push(() => RoutingRule.deleteOne({ _id: cityRule._id }));

const indore = await routingService.route({ name: 'x', city: 'Indore' });
is('a matching territory rule wins', String(indore.assignedTo), String(agents[0]._id));
is('and says which rule did it', indore.routedBy, `${tag} Indore territory`);

const elsewhere = await routingService.route({ name: 'x', city: 'Chennai' });
is('a non-match falls through to the catch-all', elsewhere.routedBy, `${tag} catch-all`);

is('case-insensitive `in`',
  routingService.conditionMatches({ city: 'INDORE' }, { field: 'city', op: 'in', value: ['Indore'] }), true);
is('`gt` on a number', routingService.conditionMatches({ estimatedValue: 800000 }, { field: 'estimatedValue', op: 'gt', value: 500000 }), true);
is('a nested UTM field is readable',
  routingService.conditionMatches({ utm: { source: 'linkedin' } }, { field: 'utm.source', op: 'eq', value: 'linkedin' }), true);
is('an unknown operator matches nothing rather than throwing',
  routingService.conditionMatches({ city: 'Pune' }, { field: 'city', op: 'regex', value: '.*' }), false);

/* ══ Intake ═══════════════════════════════════════════════════ */
console.log('\n── Intake: a web form submission ──');
const first = await leadIntakeService.intake({
  name: `${tag} Rakesh Menon`,
  phone: '98765 43210',
  email: `${tag.toLowerCase()}@example.com`,
  city: 'Indore',
  message: 'Interested in a franchise',
  source: LEAD_SOURCE.WEB_FORM,
  formId: 'test-form',
  utm: { source: 'google', medium: 'cpc', campaign: 'franchise-aug' },
});
cleanup.push(() => Lead.deleteOne({ _id: first.lead._id }));
cleanup.push(() => CrmActivity.deleteMany({ entityId: first.lead._id }));

truthy('the lead is created', first.created);
is('the phone is stored normalised', first.lead.phone, '+919876543210');
is('and the raw value is kept too', first.lead.phoneRaw, '98765 43210');
truthy('it has an owner immediately', first.lead.assignedTo);
truthy('with the moment it was assigned', first.lead.assignedAt);
is('routed by the territory rule', first.lead.routedBy, `${tag} Indore territory`);
is('status starts at new', first.lead.status, LEAD_STATUS.NEW);
is('UTM attribution survived', first.lead.utm?.campaign, 'franchise-aug');

const timeline = await CrmActivity.find({ entityId: first.lead._id }).lean();
is('the timeline records how it arrived', timeline.length, 1);
truthy('naming the source', /web_form/.test(timeline[0].subject), timeline[0].subject);

console.log('\n── A field the system owns cannot be set by the caller ──');
const forged = await leadIntakeService.intake({
  name: `${tag} Forger`,
  phone: '9000000001',
  status: 'converted',
  assignedTo: String(agents[2]._id),
  reEnquiryCount: 99,
  createdAt: '2001-01-01',
});
cleanup.push(() => Lead.deleteOne({ _id: forged.lead._id }));
cleanup.push(() => CrmActivity.deleteMany({ entityId: forged.lead._id }));
is('a forged status is ignored', forged.lead.status, LEAD_STATUS.NEW);
is('a forged re-enquiry count is ignored', forged.lead.reEnquiryCount, 0);
truthy('a forged createdAt is ignored', new Date(forged.lead.createdAt).getFullYear() > 2020);

console.log('\n── The same person enquiring again ──');
const second = await leadIntakeService.intake({
  name: `${tag} Rakesh Menon`,
  phone: '+91 98765-43210', // same number, written differently
  source: LEAD_SOURCE.FACEBOOK,
  message: 'Still interested — any update?',
});
is('no second lead is created', second.created, false);
is('it resolves to the SAME lead', String(second.lead._id), String(first.lead._id));
is('matched on the phone number', second.duplicate?.matchedOn, 'phone');
is('and the re-enquiry is counted', second.lead.reEnquiryCount, 1);

const afterRe = await CrmActivity.find({ entityId: first.lead._id }).sort({ createdAt: 1 }).lean();
is('the repeat is on the timeline', afterRe.length, 2);
truthy('described as a re-enquiry', /Re-enquiry/i.test(afterRe[1].subject), afterRe[1].subject);

console.log('\n── A lead nobody could follow up is refused ──');
await throws(
  'no phone and no email',
  () => leadIntakeService.intake({ name: `${tag} Ghost` }),
  /phone number or an email/i,
);
await throws('no name', () => leadIntakeService.intake({ phone: '9000000002' }), /needs a name/i);

console.log('\n── Meta delivering the same webhook twice ──');
const metaPayload = {
  name: `${tag} Priya Nair`, phone: '9000000003',
  source: LEAD_SOURCE.FACEBOOK, externalId: `meta:${tag}-777`,
};
const m1 = await leadIntakeService.intake(metaPayload);
cleanup.push(() => Lead.deleteOne({ _id: m1.lead._id }));
cleanup.push(() => CrmActivity.deleteMany({ entityId: m1.lead._id }));
const m2 = await leadIntakeService.intake(metaPayload);
truthy('the first delivery creates a lead', m1.created);
is('the retry creates nothing', m2.created, false);
is('and returns the same record', String(m2.lead._id), String(m1.lead._id));
is('exactly one lead exists for that submission',
  await Lead.countDocuments({ externalId: `meta:${tag}-777` }), 1);

/* ══ Meta webhook internals ═══════════════════════════════════ */
console.log('\n── Meta: only Meta may post ──');
const body = Buffer.from(JSON.stringify({ object: 'page', entry: [] }));
const goodSig = `sha256=${crypto.createHmac('sha256', 'app_secret_for_tests').update(body).digest('hex')}`;
is('a correctly signed body passes', verifyMetaSignature(body, goodSig), true);
is('a tampered body fails', verifyMetaSignature(Buffer.from('{"object":"page","entry":[1]}'), goodSig), false);
is('a missing signature fails', verifyMetaSignature(body, undefined), false);
is('a wrong algorithm fails', verifyMetaSignature(body, 'sha1=abcdef'), false);

console.log('\n── Meta: field_data → a lead ──');
const mapped = mapGraphLead({
  id: '1234567890',
  form_id: '999',
  campaign_name: 'Franchise Aug',
  field_data: [
    { name: 'full_name', values: ['Anita Desai'] },
    { name: 'phone_number', values: ['+919812345678'] },
    { name: 'email', values: ['anita@example.com'] },
    { name: 'city', values: ['Nagpur'] },
    { name: 'how_many_outlets_do_you_run', values: ['3'] },
  ],
});
is('name mapped', mapped.name, 'Anita Desai');
is('phone mapped', mapped.phone, '+919812345678');
is('city mapped', mapped.city, 'Nagpur');
is('externalId namespaced', mapped.externalId, 'meta:1234567890');
is('campaign captured for attribution', mapped.utm.campaign, 'Franchise Aug');
truthy('a custom question is kept, not dropped',
  /outlets do you run: 3/.test(mapped.message || ''), mapped.message);

const noName = mapGraphLead({ id: '5', field_data: [{ name: 'phone_number', values: ['9812345678'] }] });
is('a form with no name field still produces a lead', noName.name, 'Unnamed enquiry');

/* ══ Scope ════════════════════════════════════════════════════ */
console.log('\n── Visibility fails CLOSED ──');
is('an employee sees only their own',
  JSON.stringify(buildScope({ role: 'employee', _id: 'abc' })), '{"assignedTo":"abc"}');
is('a manager sees everything', JSON.stringify(buildScope({ role: 'manager', _id: 'x' })), '{}');
is('the ownership field is configurable',
  JSON.stringify(buildScope({ role: 'employee', _id: 'abc' }, { field: 'owner' })), '{"owner":"abc"}');
try {
  buildScope({ role: 'intern', _id: 'x' });
  no('an unknown role is refused, not given everything');
} catch (err) {
  (/no CRM visibility rule/.test(err.message) ? ok : no)(
    'an unknown role is refused, not given everything', err.message.slice(0, 60),
  );
}

/* ══ The public endpoint, over real HTTP ══════════════════════ */
/* ══ Dashboard, list and the working actions ══════════════════ */
console.log('\n── The dashboard reads what capture wrote ──');
// A manager identity for the scoped calls below. The routing tests above
// already proved these users exist and are active.
const md = { _id: agents[0]._id, id: String(agents[0]._id), role: 'md', name: agents[0].name };
const dash = await crmDashboardService.summary(md);
truthy('it answers as the whole company for a manager', dash.scope === 'company');
truthy('total is a number', typeof dash.capture.total === 'number', String(dash.capture.total));
truthy('today counts at least the ones just captured', dash.capture.today >= 3, `today=${dash.capture.today}`);
truthy('unassigned is visible to a manager', dash.attention.unassigned !== null);
truthy('sources are ordered by volume',
  dash.sources.every((s, i) => i === 0 || dash.sources[i - 1].leads >= s.leads),
  dash.sources.map((s) => `${s.source}:${s.leads}`).join(' '));
truthy('recent enquiries are returned', dash.recent.length > 0, `${dash.recent.length} rows`);

const agentView = await crmDashboardService.summary({
  _id: agents[1]._id, id: String(agents[1]._id), role: 'employee',
});
is('an agent gets their own desk, not the company', agentView.scope, 'mine');
is('and cannot see the unassigned pile', agentView.attention.unassigned, null);

console.log('\n── The list, and its filters ──');
const all = await leadService.list({ search: tag }, md);
truthy('search finds this run\'s leads', all.total >= 3, `${all.total} rows`);
truthy('phone numbers arrive MASKED in the list',
  all.items.every((l) => !l.phone || l.phone.includes('*')),
  all.items[0]?.phone);

const byStatus = await leadService.list({ search: tag, status: 'new' }, md);
truthy('filtering by status narrows it', byStatus.items.every((l) => l.status === 'new'));

const bogus = await leadService.list({ search: tag, status: 'not-a-status' }, md);
is('an unknown status is ignored rather than returning nothing', bogus.total, all.total);

const paged = await leadService.list({ search: tag, limit: 2 }, md);
is('pagination caps the rows', paged.items.length <= 2, true);
truthy('and reports how many pages', paged.pages >= 1, `page ${paged.page}/${paged.pages}`);

console.log('\n── Working a lead ──');
const target = first.lead._id;

const detail = await crmDashboardService.detail(target, md);
truthy('the detail view returns the lead', String(detail.lead._id) === String(target));
truthy('with its timeline', detail.timeline.length >= 2, `${detail.timeline.length} entries`);
truthy('and the REAL phone number, not the masked one', detail.lead.phone === '+919876543210');

const beforeLog = await Lead.findById(target).lean();
is('nothing has been logged against it yet', beforeLog.firstActivityAt, undefined);

await leadService.logActivity(target, { type: 'call', body: `${tag} spoke to them` }, md);
const afterLog = await Lead.findById(target).lean();
truthy('logging a call stamps first contact', afterLog.firstActivityAt);
is('and moves it out of "new"', afterLog.status, 'contacted');

const firstStamp = afterLog.firstActivityAt;
await leadService.logActivity(target, { type: 'note', body: `${tag} second touch` }, md);
const afterSecond = await Lead.findById(target).lean();
is('a second activity does NOT move first contact', String(afterSecond.firstActivityAt), String(firstStamp));

console.log('\n── Status changes ──');
await throws(
  'disqualifying without a reason is refused',
  () => leadService.setStatus(target, { status: 'disqualified' }, md),
  /Say why/i,
);
const disq = await leadService.setStatus(target, { status: 'disqualified', reason: 'Budget too low' }, md);
is('with a reason it goes through', disq.status, 'disqualified');
is('and the reason is stored', disq.disqualifiedReason, 'Budget too low');
await throws(
  'an unknown status is refused',
  () => leadService.setStatus(target, { status: 'sold' }, md),
  /Unknown status/i,
);

console.log('\n── Reassignment ──');
const moved = await leadService.reassign(target, { assignedTo: String(agents[2]._id), reason: 'territory' }, md);
is('a manager can move a lead', String(moved.assignedTo._id), String(agents[2]._id));
const reassignLog = await CrmActivity.findOne({ entityId: target, subject: 'Reassigned' }).lean();
truthy('and it is on the timeline with a reason', /territory/.test(reassignLog?.body || ''), reassignLog?.body);

await throws(
  'an agent cannot reassign',
  () => leadService.reassign(target, { assignedTo: String(agents[0]._id) },
    { _id: agents[1]._id, id: String(agents[1]._id), role: 'employee' }),
  /Only a manager/i,
);

console.log('\n── An agent cannot read someone else\'s lead ──');
const otherAgent = { _id: agents[3]?._id || agents[1]._id, id: String(agents[3]?._id || agents[1]._id), role: 'employee' };
const notMine = await crmDashboardService.detail(target, otherAgent);
is('it comes back as nothing, not as a 403 with the name in it',
  notMine === null || String(notMine.lead.assignedTo?._id) === String(otherAgent._id), true);


console.log('\n── The public endpoint, end to end ──');
const app = createApp();
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}/api/v1/crm/public`;

const post = (path, payload, headers = {}) => fetch(`${base}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(payload),
});

const noKey = await post('/leads', { name: 'x', phone: '9000000004' });
is('no form key → 401', noKey.status, 401);

const badKey = await post('/leads', { name: 'x', phone: '9000000004' }, { 'X-Form-Key': 'nope' });
is('an unrecognised key → 401', badKey.status, 401);

const KEY = { 'X-Form-Key': 'secret_abc123' };

const junk = await post('/leads', { name: 'x', phone: '9000000005', evil: 'payload' }, KEY);
is('an unknown field is rejected, not ignored', junk.status, 400);

const noContact = await post('/leads', { name: `${tag} Nobody` }, KEY);
is('no phone and no email → 400', noContact.status, 400);

const real = await post('/leads', {
  name: `${tag} Web Visitor`,
  phone: '9000000006',
  email: `${tag.toLowerCase()}-web@example.com`,
  city: 'Pune',
  message: 'Sent from the website',
  utm_source: 'google',
  utm_campaign: 'aug-franchise',
  formId: 'CALLER-CLAIMS-THIS',
}, KEY);
is('a genuine submission → 201', real.status, 201);
const realBody = await real.json();
is('and says nothing about what happened internally',
  JSON.stringify(realBody.data), '{"received":true}');

const webLead = await Lead.findOne({ name: `${tag} Web Visitor` }).lean();
cleanup.push(() => Lead.deleteOne({ _id: webLead._id }));
cleanup.push(() => CrmActivity.deleteMany({ entityId: webLead._id }));
truthy('the lead landed', webLead);
is('formId comes from the KEY, not the body', webLead.formId, 'test-form');
is('flat utm_* params were captured', webLead.utm?.campaign, 'aug-franchise');
truthy('and it was routed to someone', webLead.assignedTo);

const honeyBefore = await Lead.countDocuments({ name: `${tag} Bot` });
const honey = await post('/leads', {
  name: `${tag} Bot`, phone: '9000000007', website_url: 'http://spam.example',
}, KEY);
is('a honeypot hit still answers 201 — telling a bot nothing', honey.status, 201);
is('but no lead is created', await Lead.countDocuments({ name: `${tag} Bot` }), honeyBefore);

console.log('\n── The Meta handshake ──');
const verify = await fetch(
  `${base}/webhooks/meta?hub.mode=subscribe&hub.verify_token=verify_me&hub.challenge=CHALLENGE_123`,
);
is('a correct verify token → 200', verify.status, 200);
is('and the challenge is echoed BARE, not wrapped', (await verify.text()).trim(), 'CHALLENGE_123');

const wrongToken = await fetch(
  `${base}/webhooks/meta?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=X`,
);
is('a wrong verify token → 403', wrongToken.status, 403);

const unsigned = await post('/webhooks/meta', { object: 'page', entry: [] });
is('an unsigned webhook POST → 403', unsigned.status, 403);

await new Promise((r) => server.close(r));

/* ══ Teardown ═════════════════════════════════════════════════ */
console.log('\n── Tidy up ──');
for (const undo of cleanup.reverse()) await undo();
await RoutingCounter.deleteMany({ team: '*' });
const leftover = await Lead.countDocuments({ name: new RegExp(tag) });
is('no fixtures left behind', leftover, 0);

await disconnect();
process.exit(finish('CRM LEAD CAPTURE'));
