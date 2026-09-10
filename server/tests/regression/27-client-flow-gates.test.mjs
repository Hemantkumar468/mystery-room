/* eslint-disable no-console */
/**
 * The client flow's three gates — PMS_UI_SPEC_00 §3, rules 2, 3 and 4.
 *
 * These are the rules the business actually runs on, and every one of them was
 * previously something a person remembered:
 *
 *   Rule 2  Set 1 drawings unlock the BOQ. Set 2 blocks nothing.
 *   Rule 3  Quantities come from drawings, rates from the panel. Neither alone.
 *   Rule 4  Nothing is ordered before a contract exists.
 *
 * Deliberately a PURE test with no database. Every gate is a function over
 * rows — mergeDrawings, summariseBoqs, summarisePanel, summariseContracts,
 * orderability — so the arithmetic can be pinned exactly, including the cases
 * that are awkward to stage in real data (28 of 29 Set 1 drawings approved; a
 * signed contract for the wrong vendor). Those are the cases that matter:
 * a gate is only worth having if it says NO at the right moment.
 */
import {
  mergeDrawings, drawingSummary, summariseBoqs, summarisePanel, summariseContracts, orderability,
} from '../../src/modules/pms/flow/flow.service.js';
import {
  DRAWING_CHECKLIST, DRAWING_SET_1, DRAWING_SET_2,
} from '../../src/seed/drawingChecklist.js';
import { BOQ_MASTER, BOQ_TYPES, SOURCE_OF_SUPPLY } from '../../src/seed/boqMaster.js';

let pass = 0;
let fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass += 1; console.log(`  PASS  ${name}`); } else { fail += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};
const eq = (name, actual, expected) =>
  ok(name, Object.is(actual, expected), `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);

/* Minimal row builders — only the fields the gates actually read. */
let seq = 0;
const drawing = (name, status, revision = 1) => ({
  _id: `d${(seq += 1)}`, status: 'submitted', updatedAt: new Date(),
  values: { checklist_drawing: name, checklist_status: status, revision_no: revision },
});
const line = (boqType, amount, extra = {}) => ({
  _id: `l${(seq += 1)}`, status: extra.status || 'submitted',
  values: { boq_type: boqType, amount, ...extra.values },
});
const vendor = (category, name, rateConfirmed, extra = {}) => ({
  _id: `v${(seq += 1)}`, status: 'submitted',
  values: { panel_category: category, vendor_name: name, rate_confirmed: rateConfirmed, ...extra },
});
const contract = (vendorName, status, extra = {}) => ({
  _id: `c${(seq += 1)}`, status: 'submitted', attachments: extra.attachments || [],
  values: { vendor_name: vendorName, contract_status: status, contract_value: extra.value || 0 },
});

const summaryOf = (records) => {
  const rows = mergeDrawings(records);
  const s1 = rows.filter((r) => r.set === 1);
  return {
    rows,
    approvedSet1: s1.filter((r) => r.approved).length,
    boqUnlocked: s1.every((r) => r.approved) && s1.length > 0,
  };
};

console.log('\n── The master itself ──────────────────────────────────────');
eq('37 drawings in the checklist', DRAWING_CHECKLIST.length, 37);
eq('29 in Set 1', DRAWING_SET_1.length, 29);
eq('8 in Set 2', DRAWING_SET_2.length, 8);
eq('the two sets account for all 37', DRAWING_SET_1.length + DRAWING_SET_2.length, 37);
ok('every Set 1 drawing blocks the BOQ', DRAWING_SET_1.every((d) => d.blocksBoq));
ok('no Set 2 drawing blocks the BOQ', DRAWING_SET_2.every((d) => !d.blocksBoq));
ok('drawing numbers are unique', new Set(DRAWING_CHECKLIST.map((d) => d.no)).size === 37);
ok('drawing names are unique', new Set(DRAWING_CHECKLIST.map((d) => d.name)).size === 37,
  'a duplicate name would make two checklist rows indistinguishable');
eq('7 BOQs in the master', BOQ_MASTER.length, 7);
eq('BOQ_TYPES matches the master', BOQ_MASTER.map((b) => b.name).join('|'), BOQ_TYPES.join('|'));
eq('the indicative shares total 100%', BOQ_MASTER.reduce((n, b) => n + b.share, 0), 100);

console.log('\n── Rule 2: Set 1 unlocks the BOQ, Set 2 blocks nothing ────');
{
  const none = summaryOf([]);
  eq('all 37 rows show even with nothing filed', none.rows.length, 37);
  ok('nothing filed → BOQ locked', !none.boqUnlocked);
  ok('an untouched row reads "Not started"', none.rows.every((r) => r.status === 'Not started'));

  /* "Nobody has started" vs "you are blocked" — the same arithmetic, two
     different facts. Eighteen live projects predate the checklist and some are
     already ordering; telling them the BOQ is held up by 29 drawings is a
     false alarm, and a banner that cries wolf gets scrolled past. */
  const untouched = drawingSummary(mergeDrawings([]));
  ok('a project that has never used the checklist reports started=false', !untouched.started);
  const oneFiled = drawingSummary(mergeDrawings([drawing(DRAWING_SET_1[0].name, 'In progress')]));
  ok('one drawing filed flips it to started=true', oneFiled.started);
  ok('…and it is still, correctly, locked', !oneFiled.boqUnlocked,
    'started must not be confused with unlocked');

  /* The case that matters: 28 of 29. One drawing short is still locked. */
  const almost = summaryOf(DRAWING_SET_1.slice(0, 28).map((d) => drawing(d.name, 'Approved')));
  eq('28 of 29 Set 1 approved', almost.approvedSet1, 28);
  ok('28 of 29 → still LOCKED', !almost.boqUnlocked, 'one missing drawing must still hold the BOQ');

  const all1 = summaryOf(DRAWING_SET_1.map((d) => drawing(d.name, 'Approved')));
  ok('29 of 29 → UNLOCKED', all1.boqUnlocked);

  /* Set 2 must not matter in either direction. */
  const onlySet2 = summaryOf(DRAWING_SET_2.map((d) => drawing(d.name, 'Approved')));
  ok('all of Set 2 approved, none of Set 1 → still locked', !onlySet2.boqUnlocked);
  const set1PlusNoSet2 = summaryOf(DRAWING_SET_1.map((d) => drawing(d.name, 'Approved')));
  ok('Set 1 done and Set 2 untouched → unlocked', set1PlusNoSet2.boqUnlocked,
    'Set 2 must never hold up the BOQ');

  /* "Submitted" is not "Approved" — quantities must not come off unreviewed work. */
  const submitted = summaryOf(DRAWING_SET_1.map((d) => drawing(d.name, 'Submitted for review')));
  ok('Set 1 submitted but not approved → locked', !submitted.boqUnlocked);

  /* Several revisions of one drawing collapse to the latest. */
  const revs = mergeDrawings([
    drawing(DRAWING_SET_1[0].name, 'Submitted for review', 1),
    drawing(DRAWING_SET_1[0].name, 'Approved', 2),
  ]);
  eq('two revisions collapse to one row', revs.filter((r) => r.name === DRAWING_SET_1[0].name).length, 1);
  ok('the latest revision wins', revs.find((r) => r.name === DRAWING_SET_1[0].name).approved);
  eq('and reports its revision number', revs.find((r) => r.name === DRAWING_SET_1[0].name).revision, 2);
}

console.log('\n── Rule 3: quantities AND rates ───────────────────────────');
{
  const cats = [...new Set(BOQ_MASTER.map((b) => b.vendorCategory))];
  const noRates = summarisePanel(cats.map((c) => vendor(c, `${c} Co`, false)));
  ok('vendors present but no rate confirmed → rates NOT ready', !noRates.ratesReady,
    'a vendor with no agreed rate prices nothing');
  eq('and it names every missing category', noRates.missing.length, cats.length);

  const allButOne = summarisePanel(cats.map((c, i) => vendor(c, `${c} Co`, i !== 0)));
  ok('one category unconfirmed → rates not ready', !allButOne.ratesReady);
  eq('and names exactly that one', allButOne.missing.length, 1);

  const ready = summarisePanel(cats.map((c) => vendor(c, `${c} Co`, true)));
  ok('every category confirmed → rates ready', ready.ratesReady);
  eq('confirmed count matches the categories', ready.confirmedCount, cats.length);

  const withGc = summarisePanel([...cats.map((c) => vendor(c, `${c} Co`, true)), vendor(cats[0], 'Local Build Co', true, { is_local_gc: true })]);
  eq('the local general contractor is identified', withGc.localContractor, 'Local Build Co');
}

console.log('\n── Seven BOQs, totalled separately ────────────────────────');
{
  const lines = [
    line(BOQ_MASTER[0].name, 1000, { status: 'approved' }),
    line(BOQ_MASTER[0].name, 500, { status: 'approved' }),
    line(BOQ_MASTER[1].name, 250),
    line('', 99), // filed before boq_type existed
  ];
  const s = summariseBoqs(lines);
  eq('seven BOQs are always reported', s.boqs.length, 7);
  eq('BOQ 1 totals its own lines only', s.boqs[0].value, 1500);
  eq('BOQ 2 totals its own lines only', s.boqs[1].value, 250);
  eq('an empty BOQ totals zero', s.boqs[6].value, 0);
  ok('a fully approved BOQ says so', s.boqs[0].fullyApproved);
  ok('a BOQ with an unapproved line does not', !s.boqs[1].fullyApproved);
  ok('an EMPTY BOQ is not "fully approved"', !s.boqs[6].fullyApproved,
    'zero of zero approved must not read as done');
  eq('unfiled lines are counted separately', s.unassigned.lines, 1);
  eq('and not folded into any BOQ total', s.totals.value, 1849);
  eq('three streams', s.streams.length, 3);
  eq('stream values sum to the filed total', s.streams.reduce((n, x) => n + x.value, 0), 1750);
}

console.log('\n── Rule 4: nothing ordered without a contract ─────────────');
{
  const V = SOURCE_OF_SUPPLY;
  const lines = [
    line(BOQ_MASTER[0].name, 100, { status: 'approved', values: { source_of_supply: V.PROCURE, vendor: 'Acme Ltd' } }),
    line(BOQ_MASTER[0].name, 100, { status: 'approved', values: { source_of_supply: V.PROCURE, vendor: 'Nobody Ltd' } }),
    line(BOQ_MASTER[1].name, 100, { status: 'approved', values: { source_of_supply: V.STOCK, vendor: 'Acme Ltd' } }),
    line(BOQ_MASTER[1].name, 100, { status: 'approved', values: { source_of_supply: V.PRODUCTION, vendor: 'Acme Ltd' } }),
    line(BOQ_MASTER[0].name, 100, { status: 'submitted', values: { source_of_supply: V.PROCURE, vendor: 'Acme Ltd' } }),
  ];

  const noContracts = orderability(lines, summariseContracts([]));
  eq('no contracts at all → nothing orderable', noContracts.orderable, 0);
  /* Three, not two: both approved procurement lines are blocked for want of a
     contract, and the unapproved one is blocked as well — for a different
     reason, which is why the reasons are reported per line rather than as a
     single count. */
  eq('all three procurement lines are blocked', noContracts.blocked, 3);
  eq('two of them for want of a contract',
    noContracts.rows.filter((r) => /No signed contract/.test(r.reason)).length, 2);
  eq('and one because the line is not approved',
    noContracts.rows.filter((r) => r.reason === 'BOQ line not approved yet').length, 1);

  const drafted = orderability(lines, summariseContracts([contract('Acme Ltd', 'Draft')]));
  eq('a DRAFT contract releases nothing', drafted.orderable, 0,
    'drafted is not signed — it blocks ordering just as firmly as nothing');

  const signed = summariseContracts([contract('Acme Ltd', 'Signed', { value: 5000 })]);
  eq('one signed contract', signed.counts.signed, 1);
  eq('and it names the released vendor', signed.signedVendors.join(), 'Acme Ltd');
  ok('a signed contract with no uploaded copy is flagged', signed.signedWithoutCopy.includes('Acme Ltd'),
    'a signed contract with no document is a claim, not a contract');

  const live = orderability(lines, signed);
  eq('Acme’s approved procurement line becomes orderable', live.orderable, 1);
  ok('the other vendor is still blocked by name',
    live.blockedVendors.includes('Nobody Ltd'));

  /* The distinction the contracts screen depends on. Acme is signed, but their
     UNAPPROVED line is still blocked — so Acme appears in blockedVendors and
     must NOT appear in awaitingContract. Naming them under "waiting on a
     signature" would send somebody chasing a contract that already exists. */
  ok('a signed vendor with an unapproved line is still in blockedVendors',
    live.blockedVendors.includes('Acme Ltd'));
  ok('…but is NOT awaiting a contract', !live.awaitingContract.includes('Acme Ltd'),
    'their contract is signed — the block is BOQ approval');
  ok('only the genuinely contract-less vendor awaits a signature',
    live.awaitingContract.join() === 'Nobody Ltd', live.awaitingContract.join());
  eq('and the approval-blocked line is counted separately', live.awaitingApproval, 1);
  ok('Acme’s UNAPPROVED line is still blocked',
    live.rows.some((r) => r.reason === 'BOQ line not approved yet'));
  eq('stock and production are not blocked, just not orderable', live.notApplicable, 2);
  ok('and they say why without sounding like a failure',
    live.rows.filter((r) => !r.blocked && !r.orderable)
      .every((r) => /earmarked|never becomes/.test(r.reason)));

  const withCopy = summariseContracts([
    contract('Acme Ltd', 'Signed', { attachments: [{ fieldKey: 'contract_file', name: 'signed.pdf' }] }),
  ]);
  eq('a signed contract WITH a copy is not flagged', withCopy.signedWithoutCopy.length, 0);
}

console.log('\n── Screen 1: the panel board and its rate cards ───────────');
{
  const { summarisePanelBoard, assertRateLineExplained } = await import('../../src/modules/pms/flow/flow.service.js');

  const empty = summarisePanelBoard([], []);
  eq('seven rows, one per BOQ, from day one', empty.rows.length, 7);
  eq('…served by six unique categories', empty.categories, 6);
  ok('an unassigned row explains what it blocks',
    /cannot be approved until a rate is confirmed/.test(empty.rows[0].blocks));
  ok('…and does NOT claim to block the BOQ being built',
    !/cannot be built|blocks the BOQ/i.test(empty.rows[0].blocks));

  /* The two furniture BOQs share one panel category — the row must say so
     rather than silently asking for the same rate card twice. */
  const shared = empty.rows.filter((r) => r.sharesWith.length);
  eq('two rows share a category', shared.length, 2);
  ok('and each names the other', shared[0].sharesWith.length === 1);

  const cat = BOQ_MASTER[0].vendorCategory;
  const v = { _id: 'v1', values: { panel_category: cat, vendor_name: 'Acme', rate_confirmed: true, on_panel: true } };
  const withVendor = summarisePanelBoard([v], [
    { _id: 'r1', parentRecordId: 'v1', values: { item: 'Partition', standard_rate: 100, site_rate: 100 } },
    { _id: 'r2', parentRecordId: 'v1', values: { item: 'Flooring', standard_rate: 200, site_rate: 240, override_reason: 'Imported tile' } },
  ]);
  const row = withVendor.rows[0];
  eq('the assigned vendor shows', row.vendorName, 'Acme');
  eq('rate card line count', row.card.lines, 2);
  eq('overrides counted', row.card.overrides, 1);
  eq('card reads site-specific', row.card.state, 'site');
  eq('no unexplained overrides', row.card.unexplained, 0);
  ok('a confirmed row blocks nothing', row.blocks === null);

  const unexplained = summarisePanelBoard([v], [
    { _id: 'r3', parentRecordId: 'v1', values: { item: 'X', standard_rate: 100, site_rate: 130 } },
  ]);
  eq('an override with no reason is surfaced', unexplained.unexplainedOverrides, 1);

  /* The write-path rule: a negotiated rate must say why. */
  let threw = null;
  try { assertRateLineExplained({ standard_rate: 100, site_rate: 130 }); } catch (e) { threw = e; }
  ok('the API REFUSES an unexplained override', !!threw);
  eq('…with 400', threw?.statusCode, 400);
  let ok1 = null;
  try { assertRateLineExplained({ standard_rate: 100, site_rate: 130, override_reason: 'negotiated' }); } catch (e) { ok1 = e; }
  ok('an explained override is accepted', !ok1);
  let ok2 = null;
  try { assertRateLineExplained({ standard_rate: 100, site_rate: 100 }); } catch (e) { ok2 = e; }
  ok('a matching rate needs no reason', !ok2);
}

console.log('\n── Record nouns: the right number and the right case ──────');
{
  const { nounFor } = await import('../../src/modules/pms/flow/flow.service.js');
  /* Both of these shipped wrong once, and both were visible on the board
     within a minute: "propertys" from a naive +s, and "boq items" from
     lowercasing an acronym. The noun comes from the template, so this has to
     inflect whatever it is handed rather than know a list of words. */
  const cases = [
    ['Property', 1, 'property'], ['Property', 3, 'properties'],
    ['Drawing', 37, 'drawings'], ['Vendor', 7, 'vendors'],
    ['BOQ Item', 1, 'BOQ item'], ['BOQ Item', 7, 'BOQ items'],
    ['QC Item', 7, 'QC items'], ['Test Run', 6, 'test runs'],
    ['Role', 16, 'roles'], ['Contract', 1, 'contract'],
    ['Record', 0, 'records'], ['Address', 2, 'addresses'],
  ];
  for (const [noun, n, want] of cases) eq(`${noun} x${n}`, nounFor(noun, n), want);
}

console.log(`\n${'═'.repeat(60)}\n  ${pass} passed, ${fail} failed\n${'═'.repeat(60)}\n`);
process.exit(fail ? 1 : 0);

