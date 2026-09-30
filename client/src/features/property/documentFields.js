/**
 * WHAT EACH CLOSURE DOCUMENT ASKS, laid out for reading rather than for entry.
 *
 * The sibling of `assessmentFields.js`, for stage p3 instead of p2. Mirrors
 * the six `assessmentTypes` the template carries (storeLaunchTemplate.js), and
 * exists for the same reason that one does: the template describes a FORM —
 * every field, in entry order, with its widget and its validation — and a
 * report needs something different. It needs to know which answers are short
 * enough to sit two-up in a grid, which are prose that needs its own
 * paragraph, and what each key is called once it is away from its label.
 *
 * Nothing here is derived from the template at runtime on purpose: the report
 * has to render a document filed a year ago under a schema that has since
 * gained a field, and a table that is allowed to be out of date degrades into
 * a missing row rather than a crash.
 */

/**
 * The five, in the order closure works them. Matches DOCUMENTS on the server,
 * which is where the note on why `approvals` is not among them lives.
 *
 * The `approvals` entries below (its field group, its file field) are kept on
 * purpose: records filed against it before it left the list still have to
 * render somewhere, and a report that cannot label a field it is holding is
 * worse than a list with one unused row in it.
 */
export const DOCUMENT_TYPES = [
  { key: 'loi', label: 'LOI' },
  { key: 'lease', label: 'Lease Agreement' },
  { key: 'legal', label: 'Legal Check' },
  { key: 'deposit', label: 'Deposit' },
  { key: 'nocs', label: 'NOCs' },
];

/**
 * The seven permits a store can need, in the order the NOC form lists them.
 *
 * Held here rather than read off the filed records, because the question the
 * checklist answers is "what are we still missing" — and a list built from
 * what we have can only ever say "nothing". Matches the `noc_type` options in
 * the template; a permit added there and not here shows as an extra ticked
 * row rather than disappearing (see `NocChecklist`).
 */
export const NOC_TYPES = [
  'Fire NOC',
  'Municipal NOC',
  'Pollution NOC',
  'Electricity Approval',
  'Water Approval',
  'Trade License',
  'Building Approval',
];

/** How the report lays each document out — the form's own sections. */
export const DOC_FIELD_GROUPS = {
  loi: [
    {
      label: 'The letter',
      keys: ['loi_number', 'loi_date', 'valid_until'],
    },
    {
      /* `deposit_instalments` and `deposit_split_pct` are deliberately not
         here: on their own they read as "5" and "30/40/30", which is the
         input rather than the answer. They are rendered as a schedule of
         actual amounts instead — see `instalmentPlan`. */
      label: 'What was agreed',
      keys: ['proposed_rent', 'deposit_amount',
        'lockin_period_months', 'notice_period_months', 'revenue_share_pct'],
    },
    {
      label: 'Terms and notes',
      keys: ['commercial_terms', 'remarks'],
      long: ['commercial_terms', 'remarks'],
    },
  ],
  lease: [
    {
      label: 'The term',
      keys: ['lease_start_date', 'lease_end_date', 'renewal_option', 'stamp_duty'],
    },
    {
      label: 'Registration and notes',
      keys: ['registration_details', 'remarks'],
      long: ['registration_details', 'remarks'],
    },
  ],
  legal: [
    {
      label: 'What was checked',
      keys: ['property_ownership', 'title_verification', 'encumbrance_check', 'litigation_status'],
    },
    {
      label: 'Who checked it',
      keys: ['advocate_name', 'verification_date'],
    },
    {
      label: 'The opinion',
      keys: ['legal_opinion', 'remarks'],
      long: ['legal_opinion', 'remarks'],
    },
  ],
  deposit: [
    {
      label: 'What was paid',
      keys: ['security_deposit', 'advance_rent'],
    },
    {
      label: 'How it was paid',
      keys: ['payment_mode', 'transaction_number', 'payment_date'],
    },
    {
      label: 'Notes',
      keys: ['remarks'],
      long: ['remarks'],
    },
  ],
  nocs: [
    {
      label: 'The permit',
      keys: ['noc_type', 'expiry_date'],
    },
    {
      label: 'Notes',
      keys: ['remarks'],
      long: ['remarks'],
    },
  ],
  approvals: [
    {
      label: 'Who signed it off',
      keys: ['approval_level'],
    },
    {
      label: 'Notes',
      keys: ['remarks'],
      long: ['remarks'],
    },
  ],
};

/**
 * Which key on each document holds its uploads.
 *
 * Three different names for one idea — the template calls it `documents` on
 * the LOI and the legal check, `lease_document` on the lease, `payment_proof`
 * on the deposit — so the report asks this table rather than guessing, and a
 * lease copy stops being invisible because it was not called `documents`.
 */
export const DOC_FILE_FIELDS = {
  loi: ['documents'],
  lease: ['lease_document'],
  legal: ['documents'],
  deposit: ['payment_proof'],
  nocs: ['noc_document'],
  approvals: ['approval_document'],
};

const LABELS = {
  /* LOI */
  loi_number: 'LOI number',
  loi_date: 'LOI date',
  valid_until: 'Valid until',
  proposed_rent: 'Proposed rent',
  deposit_amount: 'Deposit',
  deposit_instalments: 'Deposit instalments',
  deposit_split_pct: 'Instalment split',
  lockin_period_months: 'Lock-in',
  notice_period_months: 'Notice period',
  revenue_share_pct: 'Revenue share',
  commercial_terms: 'Commercial terms',
  /* Lease */
  lease_start_date: 'Starts',
  lease_end_date: 'Ends',
  renewal_option: 'Renewal option',
  stamp_duty: 'Stamp duty',
  registration_details: 'Registration details',
  /* Legal */
  property_ownership: 'Ownership',
  title_verification: 'Title',
  encumbrance_check: 'Encumbrance',
  litigation_status: 'Litigation',
  legal_opinion: 'Legal opinion',
  advocate_name: 'Advocate',
  verification_date: 'Verified on',
  /* Deposit */
  security_deposit: 'Security deposit',
  advance_rent: 'Advance rent',
  payment_mode: 'Paid by',
  transaction_number: 'Transaction number',
  payment_date: 'Paid on',
  /* NOCs */
  noc_type: 'Permit',
  expiry_date: 'Expires',
  /* Approvals */
  approval_level: 'Approval level',
  /* Shared */
  remarks: 'Remarks',
};

export const labelOfDocField = (key) => LABELS[key] || key;

const MONEY = new Set([
  'proposed_rent', 'deposit_amount', 'stamp_duty', 'security_deposit', 'advance_rent',
]);
const MONTHS = new Set(['lockin_period_months', 'notice_period_months']);
const PERCENT = new Set(['revenue_share_pct']);
const DATES = new Set([
  'loi_date', 'valid_until', 'lease_start_date', 'lease_end_date',
  'verification_date', 'payment_date', 'expiry_date',
]);

/**
 * One answer, as it should read on the page.
 *
 * Returns null for anything unanswered so the caller can drop the row
 * entirely — a report of a half-filled form is more readable as the four
 * things it says than as the twelve things it mostly does not.
 */
/**
 * THE DEPOSIT, AS THE PAYMENTS IT WILL ACTUALLY BE MADE IN.
 *
 * A deposit is never handed over in one go. The LOI is where the company
 * commits to how it will be paid — five instalments, say, against signing,
 * fit-out and handover — and the form captures that as two numbers:
 * `deposit_instalments` (how many) and `deposit_split_pct` (the shares,
 * "30/40/30", blank meaning equal).
 *
 * Printed raw those are "5" and "30/40/30", which is what was typed rather
 * than what was agreed: the reader still has to find the deposit, divide it
 * and hope they read the split the same way round as whoever wrote it. So
 * the report does that arithmetic once, here, and shows the money.
 *
 * Returns null unless there is genuinely a schedule to show — one payment of
 * the whole amount is not a plan, and a deposit with no instalment count is
 * not one either.
 */
export function instalmentPlan(values = {}) {
  const total = Number(values.deposit_amount);
  const count = Number(values.deposit_instalments);
  if (!Number.isFinite(total) || total <= 0) return null;
  if (!Number.isFinite(count) || count < 2) return null;

  const raw = String(values.deposit_split_pct || '').trim();
  let shares = raw
    ? raw.split(/[/,\s]+/).map((x) => Number(String(x).replace('%', ''))).filter((n) => Number.isFinite(n) && n > 0)
    : [];
  /* A split that does not have one share per instalment is not a split this
     can trust, so it falls back to equal rather than guessing which of the
     two numbers is wrong. */
  if (shares.length !== count) shares = Array.from({ length: count }, () => 100 / count);

  const sum = shares.reduce((a, x) => a + x, 0);
  /* Normalised, so "30/40/30" and "3/4/3" both mean the same thing and a
     split that does not add to 100 still produces amounts that add to the
     deposit. */
  const rows = shares.map((sh, i) => ({
    n: i + 1,
    pct: (sh / sum) * 100,
    amount: Math.round((total * sh) / sum),
  }));

  /* Rounding has to land exactly on the deposit — five instalments of
     ₹1,666.67 printed as ₹1,667 add up to ₹5 more than was agreed, and this
     is a figure people reconcile against a bank statement. */
  const drift = total - rows.reduce((a, r) => a + r.amount, 0);
  if (drift && rows.length) rows[rows.length - 1].amount += drift;

  return { total, rows, equal: !raw || shares.every((x) => x === shares[0]) };
}

export function formatDocValue(key, value) {
  if (value === undefined || value === null || value === '') return null;
  if (Array.isArray(value)) return value.length ? value.join(', ') : null;

  if (DATES.has(key)) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
    }
    return String(value);
  }
  if (MONEY.has(key)) {
    const n = Number(value);
    return Number.isFinite(n) ? `₹${n.toLocaleString('en-IN')}` : String(value);
  }
  if (MONTHS.has(key)) {
    const n = Number(value);
    return Number.isFinite(n) ? `${n} month${n === 1 ? '' : 's'}` : String(value);
  }
  if (PERCENT.has(key)) {
    const n = Number(value);
    return Number.isFinite(n) ? `${n}%` : String(value);
  }
  return String(value);
}
