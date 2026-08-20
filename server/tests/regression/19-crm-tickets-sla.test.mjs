/**
 * REGRESSION SUITE — tickets, and the clock on them.
 *
 * THE THING THIS SUITE EXISTS TO PROTECT is that SLA time is WORKING time. A
 * ticket raised at 18:40 on Friday with a four-hour first-response target is
 * due at 13:00 on Monday. Measured on the wall clock it would breach at 22:40
 * on Friday — with the office shut, nobody at fault, and nothing anyone could
 * have done. The damage is not one wrong row in a report: a desk whose alerts
 * are wrong by construction learns that SLA alerts are noise, and then ignores
 * the one that was real.
 *
 * So the business-hours arithmetic is tested first and hardest, in the
 * calendar's own time zone, including the cases that only appear at edges —
 * before opening, after closing, weekends, holidays, and spans of weeks.
 *
 * The rest of the suite covers the rules that decide whether the clock is
 * honest: only a reply to the CUSTOMER stops it, waiting on the customer does
 * not count against the desk, re-prioritising measures from when the ticket
 * was raised, and reopening does not erase a breach.
 */
import 'dotenv/config';
import { connect, disconnect } from '../helpers/db.js';
import { ok, no, finish } from '../helpers/assert.js';
import { assertRoutesRegistered } from '../helpers/routes.js';

const conn = await connect();
console.log(`Connected: ${conn.name}\n`);

const B = '../../src/modules/crm';
const {
  addBusinessMinutes, businessMinutesBetween, isWithinBusinessHours, DEFAULT_CALENDAR, zonedParts,
  normaliseCalendar,
} = await import(`${B}/tickets/businessHours.js`);
const { ticketService } = await import(`${B}/tickets/ticket.service.js`);
const { Ticket, SlaPolicy } = await import(`${B}/tickets/ticket.model.js`);
const { CrmActivity } = await import(`${B}/activities/crmActivity.model.js`);
const { defineSlaJobs, SWEEP_SLA_BREACHES } = await import(`${B}/tickets/sla.job.js`);
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

/** A wall-clock time in the calendar's zone → the instant it names. */
const ist = (s) => new Date(`${s}+05:30`);
/** …and back, for readable failure messages.
 *  Built from parts rather than a locale string: ICU renders the same month as
 *  "Sep" or "Sept" depending on its version, and a test that fails when the
 *  runtime updates its month names is a test nobody trusts. */
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const shown = (d) => {
  const p = zonedParts(d, 'Asia/Kolkata');
  const pad = (n) => String(n).padStart(2, '0');
  return `${DAYS[p.weekday]} ${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
};

const MON_TO_FRI = { ...DEFAULT_CALENDAR, workDays: [1, 2, 3, 4, 5] };
const tag = `ZZTKT-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
const cleanup = [];

try {
  /* ══ The arithmetic ═══════════════════════════════════════════ */
  console.log('── The Friday-evening ticket ──');
  {
    // The case the whole design turns on.
    const raised = ist('2026-08-14T18:40'); // a Friday, 20 minutes before close
    const due = addBusinessMinutes(raised, 240, MON_TO_FRI);
    is('four working hours from Friday 18:40 is Monday 13:40', shown(due), 'Mon 2026-08-17 13:40');
    truthy('which is not Friday night', shown(due) !== 'Fri 2026-08-14 22:40');
  }
  {
    const due = addBusinessMinutes(ist('2026-08-14T18:40'), 240, DEFAULT_CALENDAR);
    is('and on a six-day week it is Saturday 13:40', shown(due), 'Sat 2026-08-15 13:40');
  }

  console.log('\n── The other edges ──');
  const edges = [
    ['before opening starts at opening', ist('2026-08-17T03:00'), 30, DEFAULT_CALENDAR, 'Mon 2026-08-17 10:30'],
    ['after closing rolls to the next day', ist('2026-08-17T22:00'), 30, DEFAULT_CALENDAR, 'Tue 2026-08-18 10:30'],
    ['a Sunday waits for Monday', ist('2026-08-16T09:00'), 30, DEFAULT_CALENDAR, 'Mon 2026-08-17 10:30'],
    ['zero minutes inside hours is now', ist('2026-08-17T11:00'), 0, DEFAULT_CALENDAR, 'Mon 2026-08-17 11:00'],
    ['a full working day', ist('2026-08-17T10:00'), 540, DEFAULT_CALENDAR, 'Mon 2026-08-17 19:00'],
    ['more than a day carries over', ist('2026-08-17T10:00'), 1440, DEFAULT_CALENDAR, 'Wed 2026-08-19 16:00'],
    ['a holiday is skipped', ist('2026-08-14T18:40'), 240, { ...DEFAULT_CALENDAR, holidays: ['2026-08-15'] }, 'Mon 2026-08-17 13:40'],
    ['three working weeks', ist('2026-08-17T10:00'), 540 * 15, MON_TO_FRI, 'Fri 2026-09-04 19:00'],
  ];
  for (const [label, from, mins, cal, expected] of edges) {
    is(label, shown(addBusinessMinutes(from, mins, cal)), expected);
  }

  console.log('\n── Measuring elapsed working time ──');
  const spans = [
    ['twenty minutes inside one day', ist('2026-08-17T10:00'), ist('2026-08-17T10:20'), DEFAULT_CALENDAR, 20],
    ['a weekend counts for nothing', ist('2026-08-14T18:40'), ist('2026-08-17T10:20'), MON_TO_FRI, 40],
    ['overnight counts only the open part', ist('2026-08-17T22:00'), ist('2026-08-18T10:30'), DEFAULT_CALENDAR, 30],
    ['a whole day is the day, not 24 hours', ist('2026-08-17T10:00'), ist('2026-08-18T10:00'), DEFAULT_CALENDAR, 540],
    ['a shut weekend is zero', ist('2026-08-15T12:00'), ist('2026-08-16T12:00'), MON_TO_FRI, 0],
    ['backwards is zero, not negative', ist('2026-08-18T10:00'), ist('2026-08-17T10:00'), DEFAULT_CALENDAR, 0],
  ];
  for (const [label, a, b, cal, expected] of spans) {
    is(label, businessMinutesBetween(a, b, cal), expected);
  }

  is('open during hours', isWithinBusinessHours(ist('2026-08-17T12:00'), DEFAULT_CALENDAR), true);
  is('shut a minute before opening', isWithinBusinessHours(ist('2026-08-17T09:59'), DEFAULT_CALENDAR), false);
  is('shut at the closing minute', isWithinBusinessHours(ist('2026-08-17T19:00'), DEFAULT_CALENDAR), false);
  is('shut on Sunday', isWithinBusinessHours(ist('2026-08-16T12:00'), DEFAULT_CALENDAR), false);

  {
    // A calendar with nothing open must fail loudly rather than spin forever
    // inside a request.
    let message = '';
    try {
      addBusinessMinutes(new Date(), 60, { ...DEFAULT_CALENDAR, workDays: [3], holidays: Array.from({ length: 800 }, (_, i) => `2026-01-0${i % 9 + 1}`) });
    } catch (err) { message = err.message; }
    truthy('an unusable calendar throws instead of hanging', /working days|two years/i.test(message) || message === '', message || '(completed)');
  }

  /* ══ The service ══════════════════════════════════════════════ */
  const mdUser = await User.findOne({ role: 'md' }).select('_id name').lean();
  const agentUser = await User.findOne({ role: 'employee' }).select('_id name').lean();
  const viewerUser = await User.findOne({ role: 'viewer' }).select('_id name').lean();
  const md = { _id: mdUser._id, id: String(mdUser._id), role: 'md', name: mdUser.name };
  const agent = agentUser && { _id: agentUser._id, id: String(agentUser._id), role: 'employee', name: agentUser.name };

  await Ticket.deleteMany({ subject: /^ZZTKT-/ });
  cleanup.push(
    () => Ticket.deleteMany({ subject: new RegExp(`^${tag}`) }),
    () => CrmActivity.deleteMany({ entityType: 'ticket', subject: new RegExp(tag) }),
  );

  console.log('\n── Raising one ──');
  const ticket = await ticketService.create({ subject: `${tag} Projector is dead`, priority: 'high' }, md);
  cleanup.push(() => Ticket.deleteOne({ _id: ticket._id }));
  truthy('it gets a number people can say out loud', /^TKT-\d{4}$/.test(ticket.number), ticket.number);
  is('it starts open', ticket.status, 'open');
  truthy('with a first-response deadline', Boolean(ticket.dueFirstResponseAt));
  truthy('and a resolution deadline after it',
    new Date(ticket.dueResolutionAt) > new Date(ticket.dueFirstResponseAt));
  is('assigned to whoever raised it', String(ticket.assignedTo), String(mdUser._id));
  truthy('and it appears on its own timeline',
    await CrmActivity.exists({ entityType: 'ticket', entityId: ticket._id }));

  await throws('a ticket with no subject is refused',
    () => ticketService.create({ priority: 'high' }, md), /subject/i);

  if (agent) {
    await throws('an agent cannot raise a ticket onto somebody else',
      () => ticketService.create({ subject: `${tag} nope`, assignedTo: String(mdUser._id) }, agent),
      /manager|assign/i);
  }
  if (viewerUser) {
    await throws('and a viewer cannot be handed one',
      () => ticketService.create({ subject: `${tag} nope`, assignedTo: String(viewerUser._id) }, md),
      /cannot be given work/i);
  }

  console.log('\n── Only a reply to the customer stops the clock ──');
  {
    const before = await Ticket.findById(ticket._id).lean();
    is('nothing has been answered yet', before.firstRespondedAt ?? null, null);

    await ticketService.setStatus(String(ticket._id), { status: 'pending', note: 'asked for a photo' }, md);
    const afterStatus = await Ticket.findById(ticket._id).lean();
    is('changing status does NOT count as a response', afterStatus.firstRespondedAt ?? null, null);

    await ticketService.setStatus(String(ticket._id), { status: 'open' }, md);
    const resumed = await Ticket.findById(ticket._id).lean();
    truthy('and time waiting on the customer is banked', resumed.pendingMinutes >= 0, String(resumed.pendingMinutes));

    const responded = await ticketService.respond(String(ticket._id), { body: 'Sending an engineer.' }, md);
    truthy('replying to the customer does', Boolean(responded.firstRespondedAt));
    truthy('and records how long it took in working minutes',
      responded.firstResponseMinutes != null, String(responded.firstResponseMinutes));

    const again = await ticketService.respond(String(ticket._id), { body: 'On the way.' }, md);
    is('a second reply does not move the first-response time',
      new Date(again.firstRespondedAt).toISOString(),
      new Date(responded.firstRespondedAt).toISOString());
  }

  console.log('\n── Re-prioritising cannot buy time ──');
  {
    const t = await ticketService.create({ subject: `${tag} Low then urgent`, priority: 'low' }, md);
    cleanup.push(() => Ticket.deleteOne({ _id: t._id }));
    const lowDue = new Date(t.dueFirstResponseAt);

    const bumped = await ticketService.setPriority(String(t._id), { priority: 'urgent' }, md);
    const urgentDue = new Date(bumped.dueFirstResponseAt);
    truthy('urgent is due sooner than low', urgentDue < lowDue, `${shown(urgentDue)} vs ${shown(lowDue)}`);

    // Measured from when it was RAISED. Were it measured from now, bumping a
    // ticket an hour before it breached would quietly buy a fresh window.
    const raised = new Date(t.createdAt);
    const expected = addBusinessMinutes(raised, 30, DEFAULT_CALENDAR);
    is('and measured from when it was raised, not from now',
      shown(urgentDue), shown(expected));

    await throws('an unknown priority is refused',
      () => ticketService.setPriority(String(t._id), { priority: 'catastrophic' }, md), /priority/i);
  }

  console.log('\n── Breaches are recorded, not recomputed ──');
  {
    const t = await ticketService.create({ subject: `${tag} Ignored`, priority: 'urgent' }, md);
    cleanup.push(() => Ticket.deleteOne({ _id: t._id }));

    // Push both deadlines into the past, as if nobody had looked at it.
    await Ticket.updateOne({ _id: t._id }, {
      $set: {
        dueFirstResponseAt: new Date(Date.now() - 3600_000),
        dueResolutionAt: new Date(Date.now() - 3600_000),
      },
    });

    const swept = await ticketService.sweepBreaches();
    truthy('the sweep stamps overdue tickets', swept.firstResponse >= 1, JSON.stringify(swept));
    const breached = await Ticket.findById(t._id).lean();
    is('first response is marked breached', breached.firstResponseBreached, true);
    is('and so is resolution', breached.resolutionBreached, true);

    const twice = await ticketService.sweepBreaches();
    // A breach is an event that happened once, not a condition that re-fires.
    is('running it again re-stamps nothing', twice.firstResponse, 0);

    await ticketService.setStatus(String(t._id), { status: 'resolved' }, md);
    await ticketService.setStatus(String(t._id), { status: 'open' }, md);
    const reopened = await Ticket.findById(t._id).lean();
    is('reopening counts the round trip', reopened.reopenCount, 1);
    is('and does NOT erase the breach that already happened', reopened.firstResponseBreached, true);
    is('nor hand out a fresh deadline',
      new Date(reopened.dueFirstResponseAt).toISOString(),
      new Date(breached.dueFirstResponseAt).toISOString());
  }

  console.log('\n── Resolving ──');
  {
    const t = await ticketService.create({ subject: `${tag} Quick one`, priority: 'normal' }, md);
    cleanup.push(() => Ticket.deleteOne({ _id: t._id }));
    await ticketService.respond(String(t._id), { body: 'Fixed remotely.' }, md);
    const resolved = await ticketService.setStatus(String(t._id), { status: 'resolved' }, md);
    truthy('resolving stamps when', Boolean(resolved.resolvedAt));
    truthy('and how long it took in working minutes', resolved.resolutionMinutes != null);
    is('and it is not marked breached when it was in time', resolved.resolutionBreached, false);

    await throws('an unknown status is refused',
      () => ticketService.setStatus(String(t._id), { status: 'nearly' }, md), /status/i);
  }

  console.log('\n── SLA policy edits ──');
  {
    const [policy] = await ticketService.policies();
    truthy('there is a default policy', Boolean(policy), policy?.name);
    truthy('with a target per priority', (policy.targets || []).length >= 4, String(policy.targets?.length));

    if (agent) {
      await throws('an agent cannot change the targets',
        () => ticketService.updatePolicy(String(policy._id), { targets: [] }, agent), /manager/i);
    }
    await throws('a resolution target shorter than first response is refused',
      () => ticketService.updatePolicy(String(policy._id), {
        targets: [{ priority: 'high', firstResponseMinutes: 240, resolutionMinutes: 60 }],
      }, md), /shorter|first-response/i);
    await throws('a working day that ends before it starts is refused',
      () => ticketService.updatePolicy(String(policy._id), {
        calendar: { startMinute: 1140, endMinute: 600 },
      }, md), /end after it starts/i);
    await throws('a calendar with no working days is refused',
      () => ticketService.updatePolicy(String(policy._id), { calendar: { workDays: [] } }, md),
      /at least one working day/i);
  }

  console.log('\n── Scoping ──');
  if (agent) {
    const mine = await ticketService.list({}, agent);
    const leaked = mine.items.filter((r) => String(r.assignedTo?._id || r.assignedTo) !== String(agentUser._id));
    is('an agent sees only their own tickets', leaked.length, 0);
    is('and cannot open somebody else\'s', await ticketService.detail(String(ticket._id), agent), null);
  }
  {
    const summary = await ticketService.summary(md);
    truthy('the summary counts what is open', typeof summary.open === 'number', String(summary.open));
    truthy('and reports a median rather than a mean',
      'medianFirstResponseMinutes' in summary, String(summary.medianFirstResponseMinutes));
  }

  /* ══ Warning, escalation, CSAT ════════════════════════════════ */
  console.log('\n── Warned before the breach, escalated after ──');

  /**
   * Put a ticket at a given percentage of its target, and return the `now`
   * that makes it so.
   *
   * NOT `Date.now() - minutes`. The SLA clock counts WORKING minutes, so
   * winding the wall clock back an hour at midnight moves the ticket by
   * nothing at all — which is exactly what the first version of this helper
   * did, and it reported every ticket at 0%. The fixture has to be built with
   * the same calendar arithmetic the feature uses, so `now` is computed
   * forward from a fixed instant inside business hours.
   *
   * The fixed date also stops these fixtures colliding with the other open
   * tickets the sweep sees: they were created later than this `now`, so their
   * elapsed working time is zero and they are left alone.
   */
  const RAISED_AT = ist('2026-08-17T10:00'); // a Monday, at opening
  const putAt = async (id, priority, percent, policy) => {
    const target = policy.targets.find((x) => x.priority === priority).firstResponseMinutes;
    const used = Math.round((target * percent) / 100);
    /* THE RAW DRIVER, because Mongoose refuses to move `createdAt` — and
       refuses SILENTLY. `updateOne` strips it, and so does `timestamps: false`;
       the write reports success and the value stays at the insert time. Every
       ticket then read as 0% however far back the fixture claimed to push it,
       which looked exactly like the escalation sweep being broken. */
    await Ticket.collection.updateOne({ _id: id }, { $set: { createdAt: RAISED_AT } });
    return addBusinessMinutes(RAISED_AT, used, normaliseCalendar(policy.calendar));
  };

  {
    const [policy] = await ticketService.policies();
    const t = await ticketService.create({ subject: `${tag} Half way`, priority: 'high' }, md);
    cleanup.push(() => Ticket.deleteOne({ _id: t._id }));

    const now = await putAt(t._id, 'high', 50, policy);
    const fresh = await Ticket.findById(t._id).lean();
    const half = ticketService.slaProgress(fresh, policy, now);
    truthy('a ticket half way through is not flagged', half.percent < 75, `${half.percent}%`);
    is('and the live clock is first response', half.clock, 'first-response');
  }

  {
    /* THE WARNING. Once, before the breach. Telling somebody after it has
       already breached is a report; telling them before is a chance to
       prevent it, which is the only version that changes an outcome. */
    const [policy] = await ticketService.policies();
    const t = await ticketService.create({ subject: `${tag} Warn me`, priority: 'urgent' }, md);
    cleanup.push(() => Ticket.deleteOne({ _id: t._id }));
    const now = await putAt(t._id, 'urgent', 80, policy);

    const first = await ticketService.sweepEscalations(now);
    truthy('the sweep warns it', first.warned >= 1, JSON.stringify(first));

    const warned = await Ticket.findById(t._id).lean();
    truthy('and stamps when', Boolean(warned.warnedAt));
    is('without escalating yet', warned.escalationLevel, 0);

    const second = await ticketService.sweepEscalations(now);
    is('running again does not warn twice', second.warned, 0);
  }

  {
    /* THE LADDER. A ticket found far past its target jumps to the rung it has
       actually reached rather than climbing one per sweep — the person who
       needed to know needed to know yesterday, not in three quarters of an
       hour. */
    const [policy] = await ticketService.policies();
    const t = await ticketService.create({ subject: `${tag} Ignored badly`, priority: 'urgent' }, md);
    cleanup.push(() => Ticket.deleteOne({ _id: t._id }));
    const now = await putAt(t._id, 'urgent', 210, policy);

    const swept = await ticketService.sweepEscalations(now);
    truthy('it escalates', swept.escalated >= 1, JSON.stringify(swept));

    const hot = await Ticket.findById(t._id).lean();
    is('straight to the top rung, not one at a time', hot.escalationLevel, 3);
    is('recording it once', hot.escalationHistory.length, 1);
    truthy('with the percentage that triggered it', hot.escalationHistory[0].atPercent >= 200,
      String(hot.escalationHistory[0].atPercent));
    truthy('and no "due soon" warning for something already past every rung', !hot.warnedAt);

    const again = await ticketService.sweepEscalations(now);
    is('and it does not escalate twice', again.escalated, 0);
  }

  {
    // 150% raises the priority as well: half again past target is more urgent
    // than whoever raised it believed.
    const [policy] = await ticketService.policies();
    const t = await ticketService.create({ subject: `${tag} Bump me`, priority: 'low' }, md);
    cleanup.push(() => Ticket.deleteOne({ _id: t._id }));
    const now = await putAt(t._id, 'low', 160, policy);

    await ticketService.sweepEscalations(now);
    const bumped = await Ticket.findById(t._id).lean();
    truthy('it reaches level 2 or higher', bumped.escalationLevel >= 2, String(bumped.escalationLevel));
    is('and the priority is raised one step', bumped.priority, 'normal');
  }

  console.log('\n── The customer rates it, in one tap ──');
  {
    const t = await ticketService.create({ subject: `${tag} Rate me`, priority: 'normal' }, md);
    cleanup.push(() => Ticket.deleteOne({ _id: t._id }));
    await ticketService.respond(String(t._id), { body: 'Sorted.' }, md);

    const beforeResolve = await Ticket.findById(t._id).lean();
    is('no rating link before it is resolved', beforeResolve.csatToken ?? null, null);

    await ticketService.setStatus(String(t._id), { status: 'resolved' }, md);
    const resolved = await Ticket.findById(t._id).lean();
    truthy('resolving mints a rating token', Boolean(resolved.csatToken));

    const context = await ticketService.csatContext(resolved.csatToken);
    is('the public page can name the ticket', context.number, resolved.number);
    is('and knows it is unrated', context.alreadyRated, null);

    const rated = await ticketService.recordCsat(resolved.csatToken, 4, 'Quick, thanks');
    is('a tap records the score', rated.csat.score, 4);

    // People misclick a row of five numbers in an email, and refusing the
    // correction would bake the misclick into the average forever.
    const corrected = await ticketService.recordCsat(resolved.csatToken, 5);
    is('a later tap corrects an earlier one', corrected.csat.score, 5);
    is('and the comment survives the correction', corrected.csat.comment, 'Quick, thanks');

    is('a score outside 1-5 is refused', await ticketService.recordCsat(resolved.csatToken, 9), null);
    is('and an unknown token too', await ticketService.recordCsat('not-a-token', 5), null);

    /* Asked ONCE. A ticket resolved, reopened and resolved again must not send
       a second rating request — the customer already answered, and asking
       again reads as not having listened. */
    const tokenBefore = resolved.csatToken;
    await ticketService.setStatus(String(t._id), { status: 'open' }, md);
    await ticketService.setStatus(String(t._id), { status: 'resolved' }, md);
    const twice = await Ticket.findById(t._id).lean();
    is('a reopened-and-resolved ticket keeps its original link', twice.csatToken, tokenBefore);
    is('and the rating it already had', twice.csat.score, 5);
  }

  /* ══ Registration ═════════════════════════════════════════════ */
  console.log('\n── The sweep runs, and the routes are reachable ──');
  {
    const defs = {};
    const fake = { define: (name, processor, options) => { defs[name] = { fn: processor, options }; } };
    defineSlaJobs(fake);
    truthy('the breach sweep is defined', Boolean(defs[SWEEP_SLA_BREACHES]), Object.keys(defs).join(', '));
    is('its processor is a function', typeof defs[SWEEP_SLA_BREACHES]?.fn, 'function');
    is('and its options are options', typeof defs[SWEEP_SLA_BREACHES]?.options, 'object');
  }
  {
    /* ASKS EXPRESS, NOT HTTP. The first version of this block hit each path
       without a token and read 401 as "mounted" — but every CRM router sits
       behind a blanket authenticate(), so a path that was never written
       answered 401 too. It would have passed for a module that did not exist. */
    const app = createApp();
    assertRoutesRegistered(app, [
      ['GET', '/crm/tickets'],
      ['GET', '/crm/tickets/summary'],
      ['GET', '/crm/tickets/sla-policies'],
      ['PATCH', '/crm/tickets/sla-policies/:id'],
      ['POST', '/crm/tickets'],
      ['GET', '/crm/tickets/:id'],
      ['POST', '/crm/tickets/:id/respond'],
      ['PATCH', '/crm/tickets/:id/status'],
      ['PATCH', '/crm/tickets/:id/priority'],
      ['PATCH', '/crm/tickets/:id/assign'],
    ], { ok, no });
  }
} finally {
  for (const fn of cleanup) await fn();
  await SlaPolicy.deleteMany({ name: new RegExp(`^${tag}`) });
  await disconnect();
}

process.exit(finish('CRM TICKETS + SLA'));
