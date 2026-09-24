/* eslint-disable no-console */
/**
 * The deposit's instalment plan — the LOI's split laid against real payments.
 *
 * The rule the business runs on: the Letter of Intent settles how many
 * instalments the security deposit is paid in and how big each one is, and
 * the ledger is then measured against that. "Instalment 1 of 2 settled,
 * instalment 2 outstanding" is the sentence a project manager acts on, and it
 * is arithmetic, not a status somebody types.
 *
 * The cases below are the ones that are awkward to stage in real data and
 * easy to get wrong:
 *   · one transfer settling two instalments, and one settling neither
 *   · a split that does not divide evenly into the agreed figure
 *   · a split whose parts do not add to 100
 *   · an LOI that names a count but no percentages
 *   · money received beyond the plan
 *
 * Pure — `depositPlan` is a function over rows, so no database is involved.
 */
import { depositPlan } from '../../src/modules/pms/flow/flow.service.js';

let pass = 0;
let fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass += 1; console.log(`  PASS  ${name}`); } else { fail += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};
const eq = (name, actual, expected) =>
  ok(name, Object.is(actual, expected), `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);

const loi = (deposit_instalments, deposit_split_pct) =>
  ({ values: { deposit_instalments, deposit_split_pct } });
const pay = (amount, paidOn, reference) => ({ amount, paidOn, reference });

console.log('\n── No plan without a count on the LOI ──');
{
  ok('no LOI at all', depositPlan(null, 3000000, []) === null);
  ok('LOI silent about instalments', depositPlan(loi(undefined, ''), 3000000, []) === null);
  ok('zero instalments is not a plan', depositPlan(loi(0), 3000000, []) === null);
  ok('a count nobody would write is refused', depositPlan(loi(99), 3000000, []) === null);
  const one = depositPlan(loi(1), 3000000, []);
  eq('paid in full at once is a plan of one', one.count, 1);
  eq('…and that one instalment is the whole deposit', one.instalments[0].expected, 3000000);
}

console.log('\n── 50/50, the case the client described ──');
{
  const p = depositPlan(loi(2, '50/50'), 3000000, [pay(1500000, '2026-06-10', 'UTR-1')]);
  eq('two instalments', p.count, 2);
  eq('the split is the LOI\'s, not assumed', p.evenSplit, false);
  eq('each is half the deposit', p.instalments[0].expected, 1500000);
  eq('instalment 1 is paid', p.instalments[0].status, 'paid');
  eq('…on the date the money arrived', p.instalments[0].paidOn, '2026-06-10');
  eq('it takes the project to 50%', p.instalments[0].cumulativePct, 50);
  eq('instalment 2 is still due', p.instalments[1].status, 'due');
  eq('…for the other half', p.instalments[1].outstanding, 1500000);
  eq('it would take the project to 100%', p.instalments[1].cumulativePct, 100);
  eq('one of two settled', p.settled, 1);
  eq('the next one owed is instalment 2', p.next.no, 2);
  eq('nothing beyond the plan', p.over, 0);
}

console.log('\n── One transfer can settle both halves ──');
{
  const p = depositPlan(loi(2, '50/50'), 3000000, [pay(3000000, '2026-06-10')]);
  eq('instalment 1 paid', p.instalments[0].status, 'paid');
  eq('instalment 2 paid by the same transfer', p.instalments[1].status, 'paid');
  eq('both settled', p.settled, 2);
  ok('nothing is outstanding', p.next === null);
  eq('and none of it is over the plan', p.over, 0);
}

console.log('\n── A payment too small to settle anything ──');
{
  /* The failure this pins: counting instalments instead of money. One payment
     of ₹1L against a ₹36L deposit is not "instalment 1 of 2 done". */
  const p = depositPlan(loi(2, '50/50'), 3600000, [pay(100000, '2026-06-10')]);
  eq('instalment 1 is part paid, not paid', p.instalments[0].status, 'part');
  eq('what came in against it', p.instalments[0].paid, 100000);
  eq('what is still owed on it', p.instalments[0].outstanding, 1700000);
  ok('a part-paid instalment has no settled date', p.instalments[0].paidOn === null);
  eq('nothing is settled', p.settled, 0);
  eq('the next one owed is still instalment 1', p.next.no, 1);
}

console.log('\n── An uneven split, and rounding that must not lose a rupee ──');
{
  const p = depositPlan(loi(3, '30/40/30'), 100001, []);
  eq('three instalments', p.count, 3);
  eq('first is 30%', p.instalments[0].expected, 30000);
  eq('second is 40%', p.instalments[1].expected, 40000);
  /* The last instalment absorbs the rounding, so the parts always add to the
     agreed figure — otherwise a rupee sits in nobody's instalment for ever. */
  eq('the last absorbs the remainder', p.instalments[2].expected, 30001);
  const sum = p.instalments.reduce((n, i) => n + i.expected, 0);
  eq('the parts add to the agreed deposit', sum, 100001);
  eq('the last takes it to 100%', p.instalments[2].cumulativePct, 100);
}

console.log('\n── A split that does not add to 100 is normalised, not trusted ──');
{
  /* Somebody typing "60/60" means "twice as much as nothing else"; what they
     do NOT mean is 120% of the deposit. Normalising keeps the plan honest. */
  const p = depositPlan(loi(2, '60/60'), 1000000, []);
  eq('each is half after normalising', p.instalments[0].expected, 500000);
  eq('the parts still add to the deposit', p.instalments[0].expected + p.instalments[1].expected, 1000000);
}

console.log('\n── A count with no percentages splits equally, and says so ──');
{
  const p = depositPlan(loi(4, ''), 4000000, []);
  eq('four equal instalments', p.instalments[1].expected, 1000000);
  eq('flagged as this code\'s arithmetic, not the LOI\'s', p.evenSplit, true);
  const named = depositPlan(loi(4, '25/25/25/25'), 4000000, []);
  eq('the same numbers, but stated by the LOI', named.evenSplit, false);
}

console.log('\n── A split with the wrong number of parts is not guessed at ──');
{
  /* "50/50" against three instalments: which one was the missing number for?
     Unanswerable, so it splits equally and flags the assumption rather than
     inventing a third share. */
  const p = depositPlan(loi(3, '50/50'), 3000000, []);
  eq('falls back to equal', p.instalments[0].expected, 1000000);
  eq('and admits the split is assumed', p.evenSplit, true);
}

console.log('\n── Money beyond the plan is reported, never dropped ──');
{
  const p = depositPlan(loi(2, '50/50'), 1000000, [pay(600000, '2026-06-01'), pay(600000, '2026-07-01')]);
  eq('both settled', p.settled, 2);
  eq('the excess is named', p.over, 200000);
}

console.log('\n── Payments are applied oldest first ──');
{
  const p = depositPlan(loi(2, '50/50'), 1000000, [
    pay(500000, '2026-08-01', 'LATE'),
    pay(500000, '2026-06-01', 'EARLY'),
  ]);
  eq('instalment 1 was settled by the June payment', p.instalments[0].paidOn, '2026-06-01');
  eq('instalment 2 by the August one', p.instalments[1].paidOn, '2026-08-01');
}

console.log('\n── The scratch marker never leaks into the payment rows ──');
{
  /* The matcher tracks how much of each payment it has consumed. If that ever
     escaped, it would land in `values.deposit_payments` on the next write. */
  const payments = [pay(500000, '2026-06-01')];
  depositPlan(loi(2, '50/50'), 1000000, payments);
  ok('no _used on the payment', !Object.prototype.hasOwnProperty.call(payments[0], '_used'));
}

console.log('\n── The LOI alone decides the deposit ──');
{
  /* The regression this pins: `getDeposit` used to return null unless a
     Deposit Management record existed, so a project whose LOI plainly said
     "₹30,000 deposit" showed nothing about a deposit at all. The LOI is where
     the amount is decided; the ledger only records what arrives against it. */
  const p = depositPlan(loi(2, '50/50'), 30000, []);
  eq('an LOI-only project still gets a plan', p.count, 2);
  eq('each instalment is half the LOI figure', p.instalments[0].expected, 15000);
  eq('nothing is settled without any payment', p.settled, 0);
  eq('the first instalment is what is owed next', p.next.outstanding, 15000);
}

console.log('\n── A deposit with no agreed figure yet ──');
{
  /* The LOI can name a count before anybody fills in the amount. The plan
     exists but has nothing to size the instalments with, and must not divide
     by zero to say so. */
  const p = depositPlan(loi(2, '50/50'), 0, []);
  eq('the instalments are worth nothing yet', p.instalments[0].expected, 0);
  ok('and no percentage is NaN', Number.isFinite(p.instalments[0].cumulativePct));
}

console.log(`\n${'═'.repeat(60)}\n  ${pass} passed, ${fail} failed\n${'═'.repeat(60)}\n`);
process.exit(fail ? 1 : 0);
