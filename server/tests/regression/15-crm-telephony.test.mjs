/**
 * REGRESSION SUITE — CRM §4: telephony.
 *
 * NO PROVIDER IS CONTACTED. A fake adapter is registered through the same seam
 * a real one uses, so everything below the provider boundary — caller
 * resolution, the screen-pop, idempotent call logging, the do-not-call
 * refusal — is exercised for real against a real database.
 *
 * That boundary is the point: when the Exotel sandbox arrives, only the
 * adapter is unproven, and it is the one file whose behaviour their docs
 * describe.
 */
import 'dotenv/config';
import { connect, disconnect, mongoose } from '../helpers/db.js';
import { ok, no, finish } from '../helpers/assert.js';

process.env.TELEPHONY_WEBHOOK_SECRET = 'test_hook_secret_value';
process.env.TELEPHONY_SID = 'test-sid';
process.env.TELEPHONY_TOKEN = 'test-token';
process.env.TELEPHONY_CALLER_ID = '+918040001111';

const conn = await connect();
console.log(`Connected: ${conn.name}\n`);

const B = '../../src/modules/crm';
const { telephonyService } = await import(`${B}/integrations/telephony/telephony.service.js`);
const { telephonyProvider, __setProviderForTests } = await import(`${B}/integrations/telephony/telephony.provider.js`);
const { CrmRing } = await import(`${B}/integrations/telephony/ringRegistry.js`);
const { CrmActivity } = await import(`${B}/activities/crmActivity.model.js`);
const { Lead } = await import(`${B}/leads/lead.model.js`);
const { Contact } = await import(`${B}/contacts/contact.model.js`);
const { ENTITY_TYPE } = await import(`${B}/crm.constants.js`);
const { User } = await import('../../src/modules/auth/auth.model.js');

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

const tag = `ZZTEL-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
const agentUser = await User.findOne({ role: 'md' }).select('_id name phone').lean();
const actor = { _id: agentUser._id, id: String(agentUser._id), role: 'md', name: agentUser.name };

await Promise.all([
  Lead.deleteMany({ name: /^ZZTEL-/ }),
  Contact.deleteMany({ name: /^ZZTEL-/ }),
  CrmRing.deleteMany({}),
]);
const cleanup = [];

/* A fake provider, registered through the production seam. */
const placed = [];
__setProviderForTests('exotel', {
  name: 'exotel',
  get configured() { return true; },
  async placeCall(args) {
    placed.push(args);
    return { providerCallId: `${tag}-CALL1`, status: 'queued' };
  },
  parseStatusWebhook: (b) => (b.CallSid ? {
    providerCallId: String(b.CallSid),
    direction: b.Direction === 'inbound' ? 'inbound' : 'outbound',
    from: b.From,
    to: b.To,
    status: b.Status,
    durationSeconds: b.ConversationDuration ? Number(b.ConversationDuration) : null,
    recordingUrl: b.RecordingUrl || null,
    startedAt: new Date(),
  } : null),
  parseInboundWebhook: (b) => (b.CallSid ? {
    providerCallId: String(b.CallSid),
    direction: 'inbound',
    from: b.CallFrom,
    to: b.CallTo,
    status: 'ringing',
    startedAt: new Date(),
  } : null),
  verifyWebhook: () => true,
  async fetchRecording() { return Buffer.from('fake-audio'); },
});

/* ══ Who is calling ═══════════════════════════════════════════ */
console.log('── The number is matched to a record ──');
const lead = await Lead.create({
  name: `${tag} Rakesh`, phone: '+919812345001', city: 'Indore',
  company: 'Sharma Enterprises', status: 'contacted', assignedTo: agentUser._id,
});
cleanup.push(() => Lead.deleteOne({ _id: lead._id }));

const contact = await Contact.create({
  name: `${tag} Priya`, phone: '+919812345002', city: 'Pune', owner: agentUser._id,
});
cleanup.push(() => Contact.deleteOne({ _id: contact._id }));

const ringFromLead = await telephonyService.registerRing({
  providerCallId: `${tag}-IN1`, from: '+919812345001', to: '+918040001111',
});
truthy('an inbound call from a known lead pops', ringFromLead);
is('matched as a lead', ringFromLead.matchType, 'lead');
is('with their name ready to show', ringFromLead.matchName, `${tag} Rakesh`);
truthy('and enough context to answer with', /Indore/.test(ringFromLead.matchSummary || ''),
  ringFromLead.matchSummary);
is('popped for the agent who owns them', String(ringFromLead.agent), String(agentUser._id));

const ringFromContact = await telephonyService.registerRing({
  providerCallId: `${tag}-IN2`, from: '+919812345002', to: '+918040001111',
});
is('a contact outranks a lead', ringFromContact.matchType, 'contact');

console.log('\n── The number is matched however it was written ──');
const ringLoose = await telephonyService.registerRing({
  // The same person, as a provider might send it: no plus, no country code.
  providerCallId: `${tag}-IN3`, from: '09812345001', to: '+918040001111',
});
is('a domestic-format number still matches', ringLoose.matchType, 'lead');
is('the same lead', String(ringLoose.matchId), String(lead._id));

const unknown = await telephonyService.registerRing({
  providerCallId: `${tag}-IN4`, from: '+919999000111', to: '+918040001111',
});
is('an unknown number belongs to nobody, so nothing pops', unknown, null);

/* ══ The screen-pop ═══════════════════════════════════════════ */
console.log('\n── The pop reaches the agent ──');
const waiting = telephonyService.waitForRing(actor, 4000);
const already = await waiting;
truthy('a ring already waiting is returned at once', already, already?.matchName);

const second = await telephonyService.waitForRing(actor, 300);
truthy('the same ring is not delivered twice', second === null || String(second._id) !== String(already._id));

console.log('\n── A poll held open is woken by a call ──');
/* Drain the earlier rings FIRST, or this proves nothing: with one still
   waiting, the poll returns instantly from the database and the "woken in
   74ms" assertion passes without the emitter ever firing. */
await CrmRing.updateMany({ agent: agentUser._id }, { $set: { deliveredAt: new Date() } });

const pending = telephonyService.waitForRing(actor, 5000);
const startedAt = Date.now();
// Ring 250ms later, as a webhook would.
setTimeout(() => {
  telephonyService.registerRing({
    providerCallId: `${tag}-IN5`, from: '+919812345002', to: '+918040001111',
  });
}, 250);
const woken = await pending;
const elapsed = Date.now() - startedAt;
truthy('the waiting poll returned', woken, woken?.matchName);
truthy('as soon as the call arrived, not on the timeout', elapsed < 2000, `${elapsed}ms`);

const nothing = await telephonyService.waitForRing(actor, 400);
is('and a quiet period simply times out', nothing, null);

/* ══ Logging a finished call ══════════════════════════════════ */
console.log('\n── A finished call lands on the timeline ──');
const call = await telephonyService.recordCallEnded({
  providerCallId: `${tag}-CALL-A`,
  direction: 'outbound',
  from: '+918040001111',
  to: '+919812345001',
  status: 'completed',
  durationSeconds: 187,
  startedAt: new Date(),
});
cleanup.push(() => CrmActivity.deleteMany({ providerEventId: new RegExp(tag) }));
truthy('it was logged', call);
is('against the lead', String(call.entityId), String(lead._id));
is('as a call', call.type, 'call');
truthy('with the duration in words', /3 min/.test(call.subject), call.subject);
is('and the provider id, for idempotency', call.providerEventId, `${tag}-CALL-A`);

console.log('\n── The same webhook delivered twice ──');
const again = await telephonyService.recordCallEnded({
  providerCallId: `${tag}-CALL-A`,
  direction: 'outbound',
  from: '+918040001111',
  to: '+919812345001',
  status: 'completed',
  durationSeconds: 187,
  recordingUrl: 'https://provider.example/rec/abc.mp3',
  startedAt: new Date(),
});
is('does not create a second row',
  await CrmActivity.countDocuments({ providerEventId: `${tag}-CALL-A` }), 1);
truthy('but the retry\'s extra detail is kept', again?.meta?.recordingUrl,
  again?.meta?.recordingUrl);

const unmatched = await telephonyService.recordCallEnded({
  providerCallId: `${tag}-CALL-B`,
  direction: 'inbound',
  from: '+919999000222',
  to: '+918040001111',
  status: 'completed',
  durationSeconds: 12,
  startedAt: new Date(),
});
is('a call from nobody we know is not logged against a guess', unmatched, null);

/* ══ Click to call ════════════════════════════════════════════ */
console.log('\n── Placing a call ──');
await User.updateOne({ _id: agentUser._id }, { $set: { phone: '+919800000001' } });

const result = await telephonyService.clickToCall(
  { entityType: ENTITY_TYPE.LEAD, entityId: String(lead._id) }, actor,
);
is('the call is placed', result.providerCallId, `${tag}-CALL1`);
is('naming who is being called', result.calling, `${tag} Rakesh`);

const args = placed[placed.length - 1];
is('the AGENT is rung first', args.agentPhone, '+919800000001');
is('the customer second', args.customerPhone, '+919812345001');
truthy('and the status callback carries the secret',
  /t=test_hook_secret_value/.test(args.callbackUrl), args.callbackUrl);

console.log('\n── Do Not Disturb is a refusal, not a warning ──');
const dnd = await Lead.create({
  name: `${tag} DoNotCall`, phone: '+919812345003', doNotDisturb: true, assignedTo: agentUser._id,
});
cleanup.push(() => Lead.deleteOne({ _id: dnd._id }));
await throws(
  'calling them is refused',
  () => telephonyService.clickToCall({ entityType: ENTITY_TYPE.LEAD, entityId: String(dnd._id) }, actor),
  /asked not to be called/i,
);

console.log('\n── An agent with no number of their own ──');
await User.updateOne({ _id: agentUser._id }, { $unset: { phone: '' } });
await throws(
  'is told exactly what to fix',
  () => telephonyService.clickToCall({ entityType: ENTITY_TYPE.LEAD, entityId: String(lead._id) }, actor),
  /profile has no phone number/i,
);
await User.updateOne({ _id: agentUser._id }, { $set: { phone: agentUser.phone || '+919800000001' } });

/* ══ The webhook token ════════════════════════════════════════ */
console.log('\n── Only somebody who knows the URL secret may post ──');
// The REAL verifier, not the fake — this is the one security control the
// provider does not give us a signature for.
__setProviderForTests('exotel', undefined);
const real = telephonyProvider();
is('the right token passes', real.verifyWebhook({ query: { t: 'test_hook_secret_value' }, get: () => null }), true);
is('a wrong token fails', real.verifyWebhook({ query: { t: 'nope' }, get: () => null }), false);
is('no token fails', real.verifyWebhook({ query: {}, get: () => null }), false);
is('a longer guess fails without throwing',
  real.verifyWebhook({ query: { t: 'test_hook_secret_value_extra' }, get: () => null }), false);

/* ══ Teardown ═════════════════════════════════════════════════ */
console.log('\n── Tidy up ──');
for (const undo of cleanup.reverse()) await undo();
await CrmRing.deleteMany({ providerCallId: new RegExp(tag) });
is('no fixtures left behind',
  (await Lead.countDocuments({ name: new RegExp(tag) }))
  + (await Contact.countDocuments({ name: new RegExp(tag) }))
  + (await CrmRing.countDocuments({ providerCallId: new RegExp(tag) })), 0);

await disconnect();
process.exit(finish('CRM TELEPHONY'));
