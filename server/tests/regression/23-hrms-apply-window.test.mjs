/**
 * REGRESSION SUITE — the public apply link is open when, and only when, the
 * apply window says so.
 *
 * WHY THIS EXISTS. A job link posted on LinkedIn keeps collecting applications
 * long after HR has stopped reading them; people apply into a void and the
 * company looks like it does not care. The fix was a closing time and an
 * off-switch — but the danger in a feature like this is not that it fails
 * loudly, it is that it fails QUIETLY in one of two directions:
 *
 *   • HR is told "Off" while the endpoint is still accepting applications
 *   • the page renders a form that the submit endpoint then rejects
 *
 * Neither raises an error anywhere. Both come from the same cause: more than
 * one implementation of "is it live". So `applyWindow()` is the single rule,
 * and these tests pin its precedence — which is the part that a later edit is
 * most likely to reorder without noticing.
 *
 * Deliberately a PURE test: no database, no service, `now` injected. The rule
 * has to be right before anything that calls it can be.
 */
import { ok, no, finish } from '../helpers/assert.js';

const { applyWindow, APPLY_CLOSED_REASON: R, APPLY_CLOSED_COPY } =
  await import('../../src/modules/hrms/requisitions/applyWindow.js');

const NOW = new Date('2026-08-26T12:00:00.000Z');
const PAST = new Date('2026-08-20T12:00:00.000Z');
const FUTURE = new Date('2026-09-20T12:00:00.000Z');

/** A requisition that is open with nothing else set — the default case. */
const req = (over = {}) => ({ status: 'open', acceptingApplications: true, ...over });

const expect = (name, r, wantOpen, wantReason, now = NOW) => {
  const w = applyWindow(r, now);
  if (w.open === wantOpen && w.reason === wantReason) return ok(name);
  return no(name, `got open=${w.open} reason=${JSON.stringify(w.reason)}, expected open=${wantOpen} reason=${JSON.stringify(wantReason)}`);
};

console.log('\n— the plain cases —');
expect('open requisition, no schedule → live', req(), true, null);
expect('null requisition → not_found', null, false, R.NOT_FOUND);
expect('soft-deleted → not_found', req({ deletedAt: new Date() }), false, R.NOT_FOUND);

console.log('\n— a draft never leaks —');
// A draft answering anything other than "not_found" would let someone walk
// ids and discover roles before they are announced.
expect('draft → not_found, not "draft"', req({ status: 'draft' }), false, R.NOT_FOUND);
{
  const w = applyWindow(req({ status: 'draft', applyClosesAt: FUTURE }), NOW);
  (w.closesAt === null ? ok : no)('draft leaks no dates', w.closesAt === null ? '' : `got ${w.closesAt}`);
}

console.log('\n— status closes it —');
expect('on_hold', req({ status: 'on_hold' }), false, R.ON_HOLD);
expect('filled', req({ status: 'filled' }), false, R.FILLED);
expect('closed', req({ status: 'closed' }), false, R.CLOSED);

console.log('\n— the manual switch —');
expect('acceptingApplications false → switched_off', req({ acceptingApplications: false }), false, R.SWITCHED_OFF);

console.log('\n— the schedule —');
expect('opens in the future → not_yet_open', req({ applyOpensAt: FUTURE }), false, R.NOT_YET_OPEN);
expect('opened in the past → live', req({ applyOpensAt: PAST }), true, null);
expect('closes in the future → live', req({ applyClosesAt: FUTURE }), true, null);
expect('closed in the past → expired', req({ applyClosesAt: PAST }), false, R.EXPIRED);
expect('inside the window → live', req({ applyOpensAt: PAST, applyClosesAt: FUTURE }), true, null);
expect('before the window → not_yet_open', req({ applyOpensAt: FUTURE, applyClosesAt: FUTURE }), false, R.NOT_YET_OPEN);

// The boundary. `>=` not `>`: a link that closes at 6:00pm must be shut AT
// 6:00pm, not one millisecond after — that is what the closing time means.
expect('exactly at the closing instant → expired', req({ applyClosesAt: NOW }), false, R.EXPIRED);
expect('one ms before closing → still live', req({ applyClosesAt: new Date(NOW.getTime() + 1) }), true, null);
expect('exactly at the opening instant → live', req({ applyOpensAt: NOW }), true, null);

console.log('\n— precedence, which is the part that gets reordered —');
// Each of these has TWO reasons to be shut. The one that wins is the one
// stated, and HR reads that string on the requisition page.
expect('filled beats a live schedule', req({ status: 'filled', applyClosesAt: FUTURE }), false, R.FILLED);
expect('the off-switch beats a live schedule', req({ acceptingApplications: false, applyClosesAt: FUTURE }), false, R.SWITCHED_OFF);
expect('the off-switch beats not_yet_open', req({ acceptingApplications: false, applyOpensAt: FUTURE }), false, R.SWITCHED_OFF);
expect('status beats the off-switch', req({ status: 'on_hold', acceptingApplications: false }), false, R.ON_HOLD);
expect('not_yet_open beats expired when both could apply', req({ applyOpensAt: FUTURE, applyClosesAt: PAST }), false, R.NOT_YET_OPEN);

console.log('\n— rubbish dates must not close a live link —');
// A bad string reaching the column should degrade to "no schedule". Silently
// taking a live link off the air over unparseable data is the worse failure.
expect('unparseable closesAt → still live', req({ applyClosesAt: 'not a date' }), true, null);
expect('unparseable opensAt → still live', req({ applyOpensAt: 'not a date' }), true, null);

console.log('\n— every reason has words to show the applicant —');
// The page renders APPLY_CLOSED_COPY[reason]. A reason added without copy
// would render an empty card, and nothing would throw.
for (const key of Object.values(R)) {
  const c = APPLY_CLOSED_COPY[key];
  const good = c && typeof c.headline === 'string' && c.headline.length > 0
    && typeof c.body === 'string' && c.body.length > 0;
  (good ? ok : no)(`copy for "${key}"`, good ? '' : `missing headline/body: ${JSON.stringify(c)}`);
}

// `headline`, not `title` — the response also carries the ROLE's title, and
// the two collided once already.
{
  const bad = Object.entries(APPLY_CLOSED_COPY).filter(([, c]) => 'title' in c);
  (bad.length === 0 ? ok : no)(
    'copy does not use "title" (it would overwrite the role name)',
    bad.length ? `offenders: ${bad.map(([k]) => k).join(', ')}` : '',
  );
}

// Exit with the failure count: run-all.mjs decides pass/fail from the exit
// code, so a bare finish() would report green no matter what failed above.
process.exit(finish('HRMS APPLY WINDOW'));
