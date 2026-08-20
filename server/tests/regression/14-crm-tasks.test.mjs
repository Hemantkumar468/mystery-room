/**
 * REGRESSION SUITE — CRM Phase 5: tasks, the rule engine and reminders.
 *
 * The three things worth guarding, in order of how quietly they fail:
 *
 *   1. A rule fires ONCE per record. A lead nudged through three statuses in an
 *      afternoon must not collect three identical "call them" tasks — that is
 *      how a to-do list becomes a wall people close without reading.
 *   2. A reminder inside quiet hours is HELD, not dropped. A reminder silently
 *      discarded because it fell at 11pm is the same as no reminder at all.
 *   3. Completing a task stamps first contact — once. The response-time metric
 *      is built on that field never moving twice.
 *
 * Nothing is ever actually emailed: mailService is swapped for a collector.
 */
import 'dotenv/config';
import { connect, disconnect, mongoose } from '../helpers/db.js';
import { ok, no, finish } from '../helpers/assert.js';

const conn = await connect();
console.log(`Connected: ${conn.name}\n`);

const B = '../../src/modules/crm';
const { CrmTask } = await import(`${B}/tasks/task.model.js`);
const { taskService } = await import(`${B}/tasks/task.service.js`);
const { Lead } = await import(`${B}/leads/lead.model.js`);
const { CrmActivity } = await import(`${B}/activities/crmActivity.model.js`);
const {
  sweepReminders, sweepQuietRecords, inQuietHours, quietHoursEndAt,
} = await import(`${B}/tasks/reminder.job.js`);
const { TASK_STATUS, CRM_EVENT, ENTITY_TYPE, QUIET_AFTER_DAYS } = await import(`${B}/crm.constants.js`);
const { mailService } = await import('../../src/core/services/mail.service.js');
const { Notification } = await import('../../src/modules/pms/notifications/notification.model.js');
const { User } = await import('../../src/modules/auth/auth.model.js');

const is = (name, actual, expected) => (
  actual === expected ? ok(name) : no(name, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`)
);
const truthy = (name, v, detail = '') => ((v ? ok : no)(name, detail || (v ? '' : `got ${JSON.stringify(v)}`)));

const sent = [];
mailService.__setTransportForTests({
  sendMail: async (m) => { sent.push(m); return { messageId: `t${sent.length}` }; },
});

const tag = `ZZTASK-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
const owner = await User.findOne({ role: 'md' }).select('_id name email').lean();
const actor = { _id: owner._id, id: String(owner._id), role: 'md', name: owner.name };

// Leftovers from a crashed run would make the dedupe assertions fail with a
// confusing "already exists".
await Promise.all([
  CrmTask.deleteMany({ title: /ZZTASK-/ }),
  Lead.deleteMany({ name: /^ZZTASK-/ }),
]);
const cleanup = [];

/* ══ The rule engine ══════════════════════════════════════════ */
console.log('── A new lead owes a first call ──');
const lead = await Lead.create({
  name: `${tag} Rakesh`, phone: '+919812300001', assignedTo: owner._id,
  assignedAt: new Date(), message: 'Wants a franchise in Indore',
});
cleanup.push(() => Lead.deleteOne({ _id: lead._id }));

const made = await taskService.runRules(CRM_EVENT.LEAD_CREATED, {
  record: lead, entityType: ENTITY_TYPE.LEAD,
});
cleanup.push(() => CrmTask.deleteMany({ entityId: lead._id }));

is('exactly one task', made.length, 1);
is('a call', made[0].type, 'call');
is('at high priority', made[0].priority, 'high');
truthy('due within a couple of hours, not days',
  (new Date(made[0].dueAt) - Date.now()) / 60_000 <= 121,
  `${Math.round((new Date(made[0].dueAt) - Date.now()) / 60_000)}m`);
truthy('it carries what they asked for', /Indore/.test(made[0].notes || ''), made[0].notes);
truthy('and says a rule created it', made[0].createdByRule, made[0].createdByRule);
is('reminder is an OFFSET, not an instant', made[0].reminderOffsetMinutes, 30);
truthy('with the instant derived from it', made[0].remindAt);

console.log('\n── The same rule cannot fire twice for one record ──');
const again = await taskService.runRules(CRM_EVENT.LEAD_CREATED, {
  record: lead, entityType: ENTITY_TYPE.LEAD,
});
is('nothing created the second time', again.length, 0);
is('still one open task', await CrmTask.countDocuments({ entityId: lead._id, status: TASK_STATUS.OPEN }), 1);

console.log('\n── An unowned record produces nothing ──');
const orphan = await Lead.create({ name: `${tag} Nobody`, phone: '+919812300002' });
cleanup.push(() => Lead.deleteOne({ _id: orphan._id }));
const none = await taskService.runRules(CRM_EVENT.LEAD_CREATED, {
  record: orphan, entityType: ENTITY_TYPE.LEAD,
});
is('a task nobody owns is not created', none.length, 0);

console.log('\n── Stage rules fire on the right stage only ──');
const fakeDeal = { _id: new mongoose.Types.ObjectId(), title: `${tag} Indore deal`, assignedTo: owner._id };
const demo = await taskService.runRules(CRM_EVENT.DEAL_STAGE_CHANGED, {
  record: fakeDeal, entityType: ENTITY_TYPE.DEAL, stageName: 'Demo Done',
});
cleanup.push(() => CrmTask.deleteMany({ entityId: fakeDeal._id }));
is('a demo produces a follow-up', demo.length, 1);
is('typed as a follow-up', demo[0].type, 'follow_up');
truthy('due tomorrow morning', new Date(demo[0].dueAt) > new Date(), new Date(demo[0].dueAt).toString().slice(0, 21));

const nego = await taskService.runRules(CRM_EVENT.DEAL_STAGE_CHANGED, {
  record: fakeDeal, entityType: ENTITY_TYPE.DEAL, stageName: 'Negotiation',
});
is('negotiation produces a proposal task', nego.length, 1);
is('typed as a document', nego[0].type, 'document');

const quiet = await taskService.runRules(CRM_EVENT.DEAL_STAGE_CHANGED, {
  record: fakeDeal, entityType: ENTITY_TYPE.DEAL, stageName: 'Contacted',
});
is('a stage with no rule produces nothing', quiet.length, 0);

const wonTasks = await taskService.runRules(CRM_EVENT.DEAL_STAGE_CHANGED, {
  record: fakeDeal, entityType: ENTITY_TYPE.DEAL, stageName: 'Closed Won', isWon: true,
});
is('winning produces an onboarding handover', wonTasks.length, 1);

/* ══ Quiet hours ══════════════════════════════════════════════ */
console.log('\n── Quiet hours, including the window that crosses midnight ──');
const night = { quietHoursStart: 22, quietHoursEnd: 7 };
const at = (h) => { const d = new Date(); d.setHours(h, 30, 0, 0); return d; };
is('11pm is quiet', inQuietHours(night, at(23)), true);
is('2am is quiet', inQuietHours(night, at(2)), true);
is('6am is still quiet', inQuietHours(night, at(6)), true);
is('7am is not', inQuietHours(night, at(7)), false);
is('3pm is not', inQuietHours(night, at(15)), false);

const daytime = { quietHoursStart: 13, quietHoursEnd: 14 };
is('a same-day window works too', inQuietHours(daytime, at(13)), true);
is('and ends when it says', inQuietHours(daytime, at(14)), false);

is('nobody with no window set is ever quiet', inQuietHours({}, at(3)), false);
is('a zero-length window is ignored', inQuietHours({ quietHoursStart: 9, quietHoursEnd: 9 }, at(9)), false);

const resumeAt = quietHoursEndAt(night, at(23));
is('a held reminder resumes at the hour the window ends', resumeAt.getHours(), 7);
truthy('on the following day', resumeAt > at(23));

/* ══ The reminder sweep ═══════════════════════════════════════ */
console.log('\n── A due reminder is announced once ──');
const due = await CrmTask.create({
  title: `${tag} call them back`,
  owner: owner._id,
  entityType: ENTITY_TYPE.LEAD,
  entityId: lead._id,
  entityLabel: lead.name,
  dueAt: new Date(Date.now() + 20 * 60_000),
  reminderOffsetMinutes: 60, // → remindAt is 40 minutes in the PAST
});
cleanup.push(() => CrmTask.deleteOne({ _id: due._id }));
truthy('its reminder is already due', due.remindAt < new Date(), due.remindAt?.toISOString());

const before = sent.length;
const r1 = await sweepReminders();
truthy('the sweep sent it', r1.sent >= 1, JSON.stringify(r1));
truthy('by email as well', sent.length > before, `${sent.length - before} message(s)`);
const note = await Notification.findOne({
  recipient: owner._id, type: 'crm_task_due', title: { $regex: tag },
}).lean();
truthy('and in-app', note, note?.title);
if (note) cleanup.push(() => Notification.deleteOne({ _id: note._id }));

const r2 = await sweepReminders();
const stamped = await CrmTask.findById(due._id).select('reminderSentAt').lean();
truthy('the task is stamped as reminded', stamped.reminderSentAt);
is('a second sweep does not re-announce it', r2.considered, 0);

console.log('\n── Inside quiet hours it is HELD, not dropped ──');
await User.updateOne({ _id: owner._id }, { $set: { quietHoursStart: 0, quietHoursEnd: 23 } });
const held = await CrmTask.create({
  title: `${tag} late night nudge`,
  owner: owner._id,
  dueAt: new Date(Date.now() + 10 * 60_000),
  reminderOffsetMinutes: 60,
});
cleanup.push(() => CrmTask.deleteOne({ _id: held._id }));

const mailBefore = sent.length;
const r3 = await sweepReminders();
truthy('it was held', r3.held >= 1, `held=${r3.held}`);
is('nothing was emailed', sent.length, mailBefore);
const pushed = await CrmTask.findById(held._id).select('remindAt reminderSentAt').lean();
is('and it is NOT marked as sent', pushed.reminderSentAt, undefined);
truthy('its reminder was moved forward instead', pushed.remindAt > new Date(),
  pushed.remindAt?.toISOString());
await User.updateOne({ _id: owner._id }, { $unset: { quietHoursStart: '', quietHoursEnd: '' } });

/* ══ Completing ═══════════════════════════════════════════════ */
console.log('\n── Completing a task is contact ──');
const beforeStamp = await Lead.findById(lead._id).select('firstActivityAt').lean();
is('the lead has never been contacted', beforeStamp.firstActivityAt, undefined);

await taskService.complete(String(made[0]._id), actor);
const afterStamp = await Lead.findById(lead._id).select('firstActivityAt').lean();
truthy('completing it stamps first contact', afterStamp.firstActivityAt);
const logged = await CrmActivity.findOne({ entityId: lead._id, subject: { $regex: 'Task done' } }).lean();
truthy('and writes it to the timeline', logged, logged?.subject);
if (logged) cleanup.push(() => CrmActivity.deleteMany({ entityId: lead._id }));

const first = afterStamp.firstActivityAt;
await taskService.complete(String(demo[0]._id), actor);
const afterSecond = await Lead.findById(lead._id).select('firstActivityAt').lean();
is('a second completion does NOT move first contact', String(afterSecond.firstActivityAt), String(first));

const done = await CrmTask.findById(made[0]._id).select('status completedAt').lean();
is('the task is done', done.status, TASK_STATUS.DONE);
truthy('with the moment recorded', done.completedAt);

/* ══ The quiet-record sweep ═══════════════════════════════════ */
console.log('\n── Records nobody has touched get a re-engage task ──');
const stale = await Lead.create({
  name: `${tag} Forgotten`,
  phone: '+919812300003',
  assignedTo: owner._id,
  assignedAt: new Date(Date.now() - (QUIET_AFTER_DAYS + 2) * 86_400_000),
  lastActivityAt: new Date(Date.now() - (QUIET_AFTER_DAYS + 2) * 86_400_000),
});
cleanup.push(() => Lead.deleteOne({ _id: stale._id }));
cleanup.push(() => CrmTask.deleteMany({ entityId: stale._id }));

const swept = await sweepQuietRecords();
truthy('the sweep found it', swept.considered >= 1, `${swept.considered} considered`);
const reengage = await CrmTask.findOne({ entityId: stale._id }).lean();
truthy('and created a re-engage task', reengage, reengage?.title);

const sweptAgain = await sweepQuietRecords();
is('running it again creates nothing new',
  await CrmTask.countDocuments({ entityId: stale._id }), 1);
truthy('even though the record is still quiet', sweptAgain.considered >= 1);

/* ══ The Today screen ═════════════════════════════════════════ */
console.log('\n── Today reads all of it in one call ──');
const today = await taskService.today(actor);
truthy('it returns the five sections',
  ['overdue', 'dueToday', 'upcoming', 'newLeads', 'stalled'].every((k) => k in today),
  Object.keys(today).join(', '));
truthy('with counts alongside', typeof today.counts.overdue === 'number',
  JSON.stringify(today.counts));
truthy('meetings are counted separately from calls',
  typeof today.counts.meetings === 'number');


/* ══ Ownership cannot be forged ═══════════════════════════════ */
console.log('\n── Only a manager may create work for somebody else ──');
const other = await User.findOne({ role: 'employee', _id: { $ne: owner._id } }).select('_id name').lean();
const asAgent = other
  ? { _id: other._id, id: String(other._id), role: 'employee', name: other.name }
  : null;

if (asAgent) {
  try {
    await taskService.create({
      title: `${tag} dumped on a colleague`,
      dueAt: new Date(Date.now() + 3600_000),
      owner: String(owner._id),
    }, asAgent);
    no('an agent cannot put a task on someone else');
  } catch (err) {
    (/Only a manager can assign/.test(err.message) ? ok : no)(
      'an agent cannot put a task on someone else', err.message.slice(0, 60),
    );
  }

  const mine = await taskService.create({
    title: `${tag} my own task`, dueAt: new Date(Date.now() + 3600_000),
  }, asAgent);
  cleanup.push(() => CrmTask.deleteOne({ _id: mine._id }));
  is('but may create one for themselves', String(mine.owner), String(other._id));
} else {
  ok('no second employee account to test with — skipped');
}

const viewer = await User.findOne({ role: 'viewer' }).select('_id name').lean();
if (viewer) {
  try {
    await taskService.create({
      title: `${tag} for a viewer`,
      dueAt: new Date(Date.now() + 3600_000),
      owner: String(viewer._id),
    }, actor);
    no('a manager still cannot assign work to a read-only role');
  } catch (err) {
    (/cannot be given work/.test(err.message) ? ok : no)(
      'a manager still cannot assign work to a read-only role', err.message.slice(0, 60),
    );
  }
} else {
  ok('no viewer account to test with — skipped');
}

/* ══ Reassignment moves the work ══════════════════════════════ */
console.log('\n── Reassigning a lead takes its open tasks with it ──');
const { leadService } = await import(`${B}/leads/lead.service.js`);
const handover = await Lead.create({
  name: `${tag} Handover`, phone: '+919812300004', assignedTo: owner._id, assignedAt: new Date(),
});
cleanup.push(() => Lead.deleteOne({ _id: handover._id }));
cleanup.push(() => CrmTask.deleteMany({ entityId: handover._id }));
cleanup.push(() => CrmActivity.deleteMany({ entityId: handover._id }));

const openTask = await CrmTask.create({
  title: `${tag} call the handover lead`,
  owner: owner._id,
  entityType: ENTITY_TYPE.LEAD,
  entityId: handover._id,
  dueAt: new Date(Date.now() + 3600_000),
});
const doneTask = await CrmTask.create({
  title: `${tag} already called`,
  owner: owner._id,
  entityType: ENTITY_TYPE.LEAD,
  entityId: handover._id,
  dueAt: new Date(Date.now() - 3600_000),
  status: TASK_STATUS.DONE,
  completedAt: new Date(),
});

if (other) {
  await leadService.reassign(
    String(handover._id),
    { assignedTo: String(other._id), reason: 'territory' },
    actor,
  );

  const movedTask = await CrmTask.findById(openTask._id).select('owner').lean();
  is('the open task moved to the new owner', String(movedTask.owner), String(other._id));

  const untouched = await CrmTask.findById(doneTask._id).select('owner').lean();
  is('a COMPLETED task keeps its original owner', String(untouched.owner), String(owner._id));

  const log = await CrmActivity.findOne({ entityId: handover._id, subject: 'Reassigned' }).lean();
  truthy('the timeline says the work moved too', /1 open task moved/.test(log?.body || ''), log?.body);
} else {
  ok('no second employee to reassign to — skipped');
}

/* ══ A manager can see everyone's overdue ═════════════════════ */
console.log('\n── Overdue work is visible above the person who owns it ──');
const buried = await CrmTask.create({
  title: `${tag} buried in a queue`,
  owner: other ? other._id : owner._id,
  dueAt: new Date(Date.now() - 5 * 86_400_000),
});
cleanup.push(() => CrmTask.deleteOne({ _id: buried._id }));

const managerToday = await taskService.today(actor);
truthy('a manager gets a team section', Array.isArray(managerToday.team));
if (other) {
  const row = managerToday.team.find((t) => String(t.owner?._id) === String(other._id));
  truthy('with that person\'s overdue count', row && row.overdue >= 1, JSON.stringify(row?.overdue));
  truthy('and how old the oldest one is', row?.oldest);
  is('flagged if they can no longer log in', row?.ownerInactive, false);
}
truthy(
  'the manager\'s own row is excluded — it is already above',
  !managerToday.team.some((t) => String(t.owner?._id) === String(owner._id)),
);

if (asAgent) {
  const agentToday = await taskService.today(asAgent);
  is('an agent gets no team section at all', agentToday.team, null);
}

/* ══ Completion honesty ═══════════════════════════════════════ */
console.log('\n── A completion records HOW it was confirmed ──');
const claimed = await CrmTask.create({
  title: `${tag} call with nothing behind it`,
  type: 'call',
  owner: owner._id,
  entityType: ENTITY_TYPE.LEAD,
  entityId: handover._id,
  dueAt: new Date(Date.now() + 600_000),
});
cleanup.push(() => CrmTask.deleteOne({ _id: claimed._id }));
const ticked = await taskService.complete(String(claimed._id), actor);
is('an unbacked tick is marked self-reported', ticked.completionSource, 'self_reported');

const backed = await CrmTask.create({
  title: `${tag} call with a real call behind it`,
  type: 'call',
  owner: owner._id,
  entityType: ENTITY_TYPE.LEAD,
  entityId: handover._id,
  dueAt: new Date(Date.now() + 600_000),
});
cleanup.push(() => CrmTask.deleteOne({ _id: backed._id }));
// What a telephony webhook will write once §4 lands: a call carrying the
// provider's own id, which is the part a person cannot fake by typing.
const realCall = await CrmActivity.create({
  type: 'call',
  entityType: ENTITY_TYPE.LEAD,
  entityId: handover._id,
  subject: 'Outbound call',
  providerEventId: `test-call-${tag}`,
  occurredAt: new Date(),
});
cleanup.push(() => CrmActivity.deleteOne({ _id: realCall._id }));

const verified = await taskService.complete(String(backed._id), actor);
is('a corroborated tick is marked telephony', verified.completionSource, 'telephony');
is('and points at the call that proves it', String(verified.completionEvidence), String(realCall._id));

const typedNote = await CrmTask.create({
  title: `${tag} note task`,
  type: 'follow_up',
  owner: owner._id,
  entityType: ENTITY_TYPE.LEAD,
  entityId: handover._id,
  dueAt: new Date(Date.now() + 600_000),
});
cleanup.push(() => CrmTask.deleteOne({ _id: typedNote._id }));
const noteDone = await taskService.complete(String(typedNote._id), actor);
is('a type with no verifiable channel stays self-reported', noteDone.completionSource, 'self_reported');


/* ══ The jobs actually run ════════════════════════════════════ */
console.log('\n── Every job definition is callable through Agenda ──');
/* THIS IS THE ASSERTION THAT WAS MISSING. Everything above calls
 * sweepReminders() directly, which proves the sweep works but says nothing
 * about whether Agenda can invoke it. agenda v6 takes (name, PROCESSOR,
 * options) and the code passed (name, options, processor) — so every real run
 * died with "definition.fn is not a function", once a minute, in a log nobody
 * was reading, while the whole suite stayed green.
 *
 * Registering the definitions here and asserting each one is a function closes
 * that gap without needing a live queue. */
const { defineTaskJobs, SWEEP_REMINDERS, SWEEP_QUIET_RECORDS } = await import(`${B}/tasks/reminder.job.js`);
const { defineMetaLeadJobs, FETCH_META_LEAD } = await import(`${B}/integrations/meta.jobs.js`);
const { defineRecordingJobs, FETCH_RECORDING } = await import(`${B}/integrations/telephony/recording.job.js`);

const registered = {};
const fakeAgenda = {
  define(name, processor, options) {
    registered[name] = { processor, options };
  },
};
defineTaskJobs(fakeAgenda);
defineMetaLeadJobs(fakeAgenda);
defineRecordingJobs(fakeAgenda);

for (const name of [SWEEP_REMINDERS, SWEEP_QUIET_RECORDS, FETCH_META_LEAD, FETCH_RECORDING]) {
  const def = registered[name];
  (typeof def?.processor === 'function' ? ok : no)(
    `"${name}" registers a FUNCTION as its processor`,
    typeof def?.processor,
  );
  (def?.options === undefined || typeof def.options === 'object' ? ok : no)(
    `and its options as an object, not the other way round`,
    JSON.stringify(def?.options),
  );
}

/* ══ Teardown ═════════════════════════════════════════════════ */
console.log('\n── Tidy up ──');
for (const undo of cleanup.reverse()) await undo();
await CrmTask.deleteMany({ title: new RegExp(tag) });
is('no fixtures left behind',
  (await CrmTask.countDocuments({ title: new RegExp(tag) }))
  + (await Lead.countDocuments({ name: new RegExp(tag) })), 0);

await disconnect();
process.exit(finish('CRM TASKS & REMINDERS'));
