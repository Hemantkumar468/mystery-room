/**
 * REGRESSION SUITE — interview rounds, and the boundaries between them.
 *
 * WHY THIS EXISTS. Hiring has two overlapping state machines: the pipeline
 * STAGE a candidate sits at, and the verdict on each individual ROUND. Almost
 * every way this feature can go wrong is a leak between the two, and none of
 * them raise anything:
 *
 *   • a round marked "not selected" quietly rejecting the person
 *   • scheduling round 2 while the board still says "applied"
 *   • a rescheduled interview keeping its "invite sent" tick, so the
 *     candidate is never told the time changed
 *   • two people scheduling at once and both getting "round 2"
 *
 * So the assertions below are mostly about what must NOT happen. They drive
 * the real service against a real database and read the result back, because
 * the question is what is stored, not what a handler was willing to return.
 *
 * Every fixture is torn down; nothing here touches existing data.
 */
import 'dotenv/config';
import { connect, disconnect } from '../helpers/db.js';
import { ok, no, finish } from '../helpers/assert.js';

const conn = await connect();
console.log(`Connected: ${conn.name}\n`);

const { hrmsService } = await import('../../src/modules/hrms/hrms.service.js');
const { Requisition } = await import('../../src/modules/hrms/requisitions/requisition.model.js');
const { Candidate } = await import('../../src/modules/hrms/candidates/candidate.model.js');
const { User } = await import('../../src/modules/auth/auth.model.js');
const { withTenant } = await import('../../src/core/tenancy/tenantContext.js');
const mongoose = (await import('mongoose')).default;

const is = (name, actual, expected) => (
  actual === expected ? ok(name) : no(name, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`)
);
/* The detail is printed only on FAILURE. Passing it to ok() as well makes a
   green run read like a red one — "PASS ... csv did not contain a formula" —
   and output nobody trusts is output nobody reads. */
const truthy = (name, v, detail = '') => (v ? ok(name) : no(name, detail || `got ${JSON.stringify(v)}`));
const falsy = (name, v) => (!v ? ok(name) : no(name, `expected falsy, got ${JSON.stringify(v)}`));

const company = new mongoose.Types.ObjectId();
const cleanup = [];
const tag = `ZZIV-${Date.now()}`;

const hr = await withTenant(company, () => User.create({
  name: `${tag} Recruiter`,
  email: `${tag.toLowerCase()}@example.test`,
  password: 'placeholder-not-a-credential',
  role: 'manager',
  department: 'hr',
}));
cleanup.push(() => User.deleteOne({ _id: hr._id }));

const req = await withTenant(company, () => Requisition.create({
  code: `${tag}-REQ`, title: 'Game Master', status: 'open', headcount: 2,
}));
cleanup.push(() => Requisition.deleteOne({ _id: req._id }));

const mkCandidate = async (over = {}) => {
  const c = await withTenant(company, () => Candidate.create({
    requisition: req._id, name: `${tag} Applicant`, phone: '9000000009', ...over,
  }));
  cleanup.push(() => Candidate.deleteOne({ _id: c._id }));
  return c;
};

const soon = (days = 2) => new Date(Date.now() + days * 864e5);
const run = (fn) => withTenant(company, fn);

try {
  /* ── round numbering ─────────────────────────────────────────────── */
  console.log('── Rounds number themselves ──');
  {
    const c = await mkCandidate();
    await run(() => hrmsService.scheduleInterview(String(c._id), { scheduledAt: soon(1) }, hr));
    await run(() => hrmsService.scheduleInterview(String(c._id), { scheduledAt: soon(3), kind: 'hr' }, hr));
    const got = await run(() => hrmsService.getCandidate(String(c._id)));
    is('two rounds exist', got.interviews.length, 2);
    is('first is round 1', got.interviews[0].round, 1);
    // Derived from the max, not from the array length — cancelling round 1 and
    // scheduling again must not hand out a duplicate number.
    is('second is round 2', got.interviews[1].round, 2);

    await run(() => hrmsService.cancelInterview(String(c._id), String(got.interviews[0]._id), hr));
    await run(() => hrmsService.scheduleInterview(String(c._id), { scheduledAt: soon(5) }, hr));
    const after = await run(() => hrmsService.getCandidate(String(c._id)));
    is('after cancelling round 1, the next is round 3 not round 2',
      after.interviews.map((i) => i.round).join(','), '2,3');
  }

  /* ── the stage follows, but only forwards ────────────────────────── */
  console.log('\n── Scheduling moves the board, and never backwards ──');
  {
    const c = await mkCandidate({ stage: 'applied' });
    await run(() => hrmsService.scheduleInterview(String(c._id), { scheduledAt: soon() }, hr));
    const got = await run(() => hrmsService.getCandidate(String(c._id)));
    is('an applied candidate becomes interview', got.stage, 'interview');
    truthy('and the move is on the record',
      (got.stageHistory || []).some((h) => h.stage === 'interview' && /Round 1/.test(h.note || '')));
  }
  {
    const c = await mkCandidate({ stage: 'offer' });
    await run(() => hrmsService.scheduleInterview(String(c._id), { scheduledAt: soon() }, hr));
    const got = await run(() => hrmsService.getCandidate(String(c._id)));
    // A final round after an offer is normal. Dragging them BACK to interview
    // would undo a decision somebody already made.
    is('a candidate at offer stays at offer', got.stage, 'offer');
  }
  {
    const c = await mkCandidate({ stage: 'hired' });
    await run(() => hrmsService.scheduleInterview(String(c._id), { scheduledAt: soon() }, hr));
    const got = await run(() => hrmsService.getCandidate(String(c._id)));
    is('a hired candidate stays hired', got.stage, 'hired');
  }

  /* ── a verdict on a round is NOT a verdict on the person ─────────── */
  console.log('\n── A round outcome never moves the candidate ──');
  {
    const c = await mkCandidate({ stage: 'applied' });
    await run(() => hrmsService.scheduleInterview(String(c._id), { scheduledAt: soon() }, hr));
    let got = await run(() => hrmsService.getCandidate(String(c._id)));
    const ivId = String(got.interviews[0]._id);

    got = await run(() => hrmsService.decideInterview(String(c._id), ivId,
      { outcome: 'rejected', feedback: 'Not comfortable with late shifts', rating: 2 }, hr));

    is('the round is marked not selected', got.interviews[0].outcome, 'rejected');
    // THE assertion this suite exists for.
    is('the CANDIDATE is not rejected', got.stage, 'interview');
    falsy('and no rejection reason was invented', got.rejectionReason);
    is('feedback is stored', got.interviews[0].feedback, 'Not comfortable with late shifts');
    is('the rating reaches the candidate too', got.rating, 2);
    truthy('who decided it is recorded', got.interviews[0].decidedBy);
    truthy('and when', got.interviews[0].decidedAt);
  }

  /* ── rescheduling invalidates the invite ─────────────────────────── */
  console.log('\n── A moved interview is an uninvited interview ──');
  {
    const c = await mkCandidate({ email: `${tag.toLowerCase()}-cand@example.test` });
    await run(() => hrmsService.scheduleInterview(String(c._id), { scheduledAt: soon() }, hr));
    let got = await run(() => hrmsService.getCandidate(String(c._id)));
    const ivId = String(got.interviews[0]._id);

    // Stamp it directly: whether mail is configured on this machine is not
    // what is being tested, and the test must not depend on it.
    await Candidate.updateOne(
      { _id: c._id, 'interviews._id': ivId },
      { $set: { 'interviews.$.inviteSentAt': new Date(), 'interviews.$.inviteTo': 'x@y.test' } },
    );
    got = await run(() => hrmsService.getCandidate(String(c._id)));
    truthy('precondition: the invite is stamped', got.interviews[0].inviteSentAt);

    got = await run(() => hrmsService.updateInterview(String(c._id), ivId, { scheduledAt: soon(6) }, hr));
    falsy('changing the TIME clears the invite stamp', got.interviews[0].inviteSentAt);

    // Changing something else must not: re-sending an invite because a
    // location typo was fixed is noise the candidate does not need.
    await Candidate.updateOne(
      { _id: c._id, 'interviews._id': ivId },
      { $set: { 'interviews.$.inviteSentAt': new Date() } },
    );
    got = await run(() => hrmsService.updateInterview(String(c._id), ivId, { location: 'Second floor' }, hr));
    truthy('changing only the location keeps it', got.interviews[0].inviteSentAt);
  }

  /* ── invites degrade, never throw ────────────────────────────────── */
  console.log('\n── An invite with nowhere to go is an answer, not a crash ──');
  {
    const c = await mkCandidate({ email: undefined });
    await run(() => hrmsService.scheduleInterview(String(c._id), { scheduledAt: soon() }, hr));
    const got = await run(() => hrmsService.getCandidate(String(c._id)));
    const r = await run(() => hrmsService.sendInterviewInvite(
      String(c._id), String(got.interviews[0]._id), {}, hr,
    ));
    is('no email on file → sent:false', r.sent, false);
    is('and it says why', r.skipped, 'no_email');
    truthy('the page is told whether mail even works here', 'mailConfigured' in got);
  }

  /* ── cancelling ──────────────────────────────────────────────────── */
  console.log('\n── Cancelling ──');
  {
    const c = await mkCandidate();
    await run(() => hrmsService.scheduleInterview(String(c._id), { scheduledAt: soon() }, hr));
    let got = await run(() => hrmsService.getCandidate(String(c._id)));
    got = await run(() => hrmsService.cancelInterview(String(c._id), String(got.interviews[0]._id), hr));
    is('the round is gone', got.interviews.length, 0);
  }

  /* ── permissions ─────────────────────────────────────────────────── */
  console.log('\n── Only HR may touch any of this ──');
  {
    const outsider = await withTenant(company, () => User.create({
      name: `${tag} Outsider`,
      email: `${tag.toLowerCase()}-out@example.test`,
      password: 'placeholder-not-a-credential',
      role: 'employee',
      department: 'operations',
    }));
    cleanup.push(() => User.deleteOne({ _id: outsider._id }));
    const c = await mkCandidate();
    for (const [label, fn] of [
      ['schedule', () => hrmsService.scheduleInterview(String(c._id), { scheduledAt: soon() }, outsider)],
      ['export', () => hrmsService.exportCandidates({}, outsider)],
    ]) {
      try {
        await run(fn);
        no(`${label} is refused for a non-HR user`, 'it SUCCEEDED');
      } catch (err) {
        (err.statusCode === 403 ? ok : no)(`${label} is refused for a non-HR user`, `status ${err.statusCode}`);
      }
    }
  }

  /* ── export ──────────────────────────────────────────────────────── */
  console.log('\n── The export says what it contains ──');
  {
    const c = await mkCandidate({ name: `=cmd|' /c calc'!A1 ${tag}`, email: 'evil@example.test' });
    const out = await run(() => hrmsService.exportCandidates({ requisition: String(req._id) }, hr));
    truthy('a CSV comes back', out.csv?.length > 0);
    truthy('rowCount is reported', typeof out.rowCount === 'number');
    truthy('the true total is reported too', typeof out.total === 'number');
    is('nothing was silently clipped', out.truncated, false);
    // The formula guard, inherited from core/utils/csv.js. A name beginning
    // with = is a live command in Excel; it must arrive quoted as text.
    truthy('a formula-looking name is neutralised', out.csv.includes("\"'=cmd"),
      `csv did not contain a quoted formula: ${out.csv.slice(0, 200)}`);
    truthy('the header row is there', out.csv.startsWith('﻿"Candidate"'));
    void c;
  }
} finally {
  for (const fn of cleanup.reverse()) {
    // eslint-disable-next-line no-await-in-loop
    await withTenant(company, fn).catch(() => {});
  }
  await disconnect();
}

process.exit(finish('HRMS INTERVIEWS'));
