/**
 * Everything the printed purchase order works out for itself: who is billing
 * whom, which GST applies, and the total in words.
 *
 * Kept out of the page so each rule can be read (and later tested) on its own,
 * and so the two facts the document cannot derive — our own billing identity
 * and the GST rate — sit in one obvious place instead of being scattered
 * through JSX.
 */

/**
 * OUR OWN BILLING ENTITY — the "Invoice To" block on the document.
 *
 * NOT STORED ANYWHERE YET. The app has no company/legal-entity master: the
 * `companies` collection is CRM (the customers), and a tenant carries only a
 * name and a slug. A GSTIN is a legal identifier on a document that goes to
 * vendors, so it is left blank here rather than invented — a wrong one is far
 * worse than a missing one, and a plausible-looking wrong one is worst of all.
 *
 * Fill these four in and the block prints. When this earns a proper master
 * (Settings → Company), this object is the single call site to replace.
 */
export const ISSUER = Object.freeze({
  name: 'Mystery Rooms',
  addressLines: [],   // e.g. ['SCO 489-490, Sector 35C', 'Chandigarh']
  /**
   * TWO numbers, because the reference voucher carries two and they differ:
   * `gstNo` is the registration the company bills under, `gstin` the one this
   * order is placed against. Where a company has only one, put it in both.
   */
  gstNo: '',          // e.g. '04AAGCK5552J1ZG'
  gstin: '',          // e.g. '07AAGCK5552J1ZA'
  stateName: '',      // leave blank to derive it from the GSTIN
});

/**
 * The default GST rate, in per cent.
 *
 * The BOQ form records item, quantity and rate — there is no tax field on it,
 * so nothing on the record says what rate applies to this line. 18% is the
 * common slab for the goods and services these orders cover.
 *
 * The rate is NOT printed beside the tax lines: the reference voucher shows
 * only "CGST" and "SGST", and this document matches it. That makes this
 * constant the only statement of the assumption anywhere, so a per-line rate
 * on the Phase 5 form is the proper fix rather than a nicety.
 */
export const GST_RATE = 18;

/**
 * GSTIN state codes — the first two digits of every GSTIN.
 *
 * This is what decides CGST+SGST versus IGST, so it is a table of fact, not a
 * convenience: a supply inside one state is taxed half centrally and half by
 * the state; across states it is one integrated tax.
 */
const STATE_BY_CODE = Object.freeze({
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh',
  '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan',
  '09': 'Uttar Pradesh', 10: 'Bihar', 11: 'Sikkim', 12: 'Arunachal Pradesh',
  13: 'Nagaland', 14: 'Manipur', 15: 'Mizoram', 16: 'Tripura',
  17: 'Meghalaya', 18: 'Assam', 19: 'West Bengal', 20: 'Jharkhand',
  21: 'Odisha', 22: 'Chhattisgarh', 23: 'Madhya Pradesh', 24: 'Gujarat',
  26: 'Dadra & Nagar Haveli and Daman & Diu', 27: 'Maharashtra', 29: 'Karnataka',
  30: 'Goa', 31: 'Lakshadweep', 32: 'Kerala', 33: 'Tamil Nadu',
  34: 'Puducherry', 35: 'Andaman & Nicobar Islands', 36: 'Telangana',
  37: 'Andhra Pradesh', 38: 'Ladakh', 97: 'Other Territory',
});

/** The state a GSTIN belongs to: `{ code, name }`, or null when unreadable. */
export function stateOfGstin(gstin) {
  const code = String(gstin || '').trim().slice(0, 2);
  if (!/^\d{2}$/.test(code)) return null;
  const name = STATE_BY_CODE[code] || STATE_BY_CODE[String(Number(code))];
  return name ? { code, name } : null;
}

/** "Delhi, Code : 07" — the line Tally prints under each party. */
export function stateLine(gstin, fallbackName) {
  const s = stateOfGstin(gstin);
  if (s) return `${s.name}, Code : ${s.code}`;
  return fallbackName ? `${fallbackName}` : '';
}

/**
 * How this order is taxed.
 *
 * Same state on both GSTINs → CGST + SGST, half the rate each. Different
 * states → IGST at the full rate. When either GSTIN is missing we cannot know
 * which, so `split` is null and the document says the tax could not be worked
 * out instead of guessing a half that might be wrong.
 */
export function taxOf(taxable, issuerGstin, vendorGstin, rate = GST_RATE) {
  const a = stateOfGstin(issuerGstin);
  const b = stateOfGstin(vendorGstin);
  const amount = Number(taxable) || 0;
  if (!a || !b) {
    return { split: null, rate, lines: [], total: 0, grand: amount };
  }
  const intra = a.code === b.code;
  const lines = intra
    ? [
      { label: 'CGST', rate: rate / 2, amount: (amount * rate) / 200 },
      { label: 'SGST', rate: rate / 2, amount: (amount * rate) / 200 },
    ]
    : [{ label: 'IGST', rate, amount: (amount * rate) / 100 }];
  const total = lines.reduce((s, l) => s + l.amount, 0);
  return { split: intra ? 'intra' : 'inter', rate, lines, total, grand: amount + total };
}

/** 47200 → "47,200.00" — the two-decimal, Indian-grouped figure on the document. */
export function money(n) {
  return (Number(n) || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function under100(n) {
  if (n < 20) return ONES[n];
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`;
}
function under1000(n) {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return `${h ? `${ONES[h]} Hundred${r ? ' and' : ''}` : ''}${r ? `${h ? ' ' : ''}${under100(r)}` : ''}`;
}

/**
 * "INR Forty Seven Thousand Two Hundred Only" — Indian grouping (crore, lakh,
 * thousand), because that is what the document and the reader expect. Paise
 * are named only when there are any.
 */
export function amountInWords(value) {
  const n = Math.round((Number(value) || 0) * 100);
  const rupees = Math.floor(n / 100);
  const paise = n % 100;
  if (rupees === 0 && paise === 0) return 'INR Zero Only';

  const groups = [
    [Math.floor(rupees / 10000000), 'Crore'],
    [Math.floor((rupees % 10000000) / 100000), 'Lakh'],
    [Math.floor((rupees % 100000) / 1000), 'Thousand'],
    [rupees % 1000, ''],
  ];
  const words = groups
    .filter(([n2]) => n2 > 0)
    .map(([n2, unit]) => `${unit ? under100(n2) || under1000(n2) : under1000(n2)}${unit ? ` ${unit}` : ''}`)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  const head = rupees > 0 ? `INR ${words}` : 'INR';
  return paise > 0
    ? `${head} and ${under100(paise)} Paise Only`
    : `${head} Only`;
}

/** "21-Aug-26" — the date format on a Tally voucher. */
export function voucherDate(d) {
  const t = d ? new Date(d) : new Date();
  if (Number.isNaN(t.getTime())) return '';
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${String(t.getDate()).padStart(2, '0')}-${M[t.getMonth()]}-${String(t.getFullYear()).slice(-2)}`;
}

/** Address text into printable lines, however it was typed. */
export const addressLines = (text) => String(text || '')
  .split(/\r?\n|,\s*/)
  .map((s) => s.trim())
  .filter(Boolean);
