import { CLOSED, NOT_SENT, has, num, sentAtOf } from '../projects/orderTracking.jsx';
import { purchaseOrderPath } from '../projects/orderRoutes.js';

/**
 * BOQ → PO → Tracking → Delivery, as six stages.
 *
 * The stage an order is at is DERIVED from its tracking fields on every read —
 * there is no stage column on the record and there must not be one. The same
 * rule the phase tree follows: a stored stage and a set of tracking fields
 * drift the moment somebody edits one and not the other, and then two screens
 * disagree about where an order is.
 *
 * Everything here reads `factsOf` (orderTracking.jsx), which is what the
 * project's own tracker reads, so "late", "partly received" and "sent" mean
 * exactly one thing in the project sheet, the company sheet and this pipeline.
 */

/**
 * `goes` names WHERE that stage's action is actually done. Two pages already
 * do this work and neither is being rebuilt here:
 *
 *   'document' -> the PO itself — vendor block, editable PO details, print to
 *                 PDF, and the send panel: WhatsApp plus a real email composer
 *                 with To/CC/subject/body and attachments that travel with the
 *                 mail (PurchaseOrderPage.jsx#EmailComposerPanel).
 *
 *   'tracker'  -> what happened after it went out — dispatch and receipt
 *                 fields, received-against-ordered, the GRN with its photo and
 *                 document uploads, the paper trail, and Notes.
 *
 * Raising and chasing belong to the document; tracking, receiving and closing
 * belong to the tracker. The button on a row therefore lands on the page that
 * can do the thing the button is named after, instead of one page for
 * everything that then has to be navigated a second time.
 */
/**
 * BOQ line → vendor → PO → tracking → GRN, and the one branch that leaves it:
 * shortfall. Six steps, in the order the work happens.
 *
 * `n` is the number on the circle, `next` the arrow leaving it — the label on
 * the arrow is what has to HAPPEN for a line to move on, which is why the last
 * one reads "received < ordered" and is drawn as an exception rather than a
 * step forward.
 *
 * `goes` names the page that step's action is done on: the PO document for
 * raising and chasing, the order page for everything after it.
 */
export const PIPELINE = Object.freeze([
  {
    /* --ink-800 rather than a text token: the numeral on a filled circle is
       white, and the neutral text tokens flip with the theme, which would put
       white on near-white in dark mode. The ink scale does not flip. */
    key: 'all', n: 1, group: 'BOQ', name: 'Fill BOQ', tone: 'var(--ink-800)',
    /* "filed", not "approved line" — approval is now step 2's own job and
       the arrow must not claim it happens here. */
    next: 'BOQ filled', action: 'View record', goes: 'tracker',
  },
  {
    /**
     * CHECKING THE BOQ WAS ALWAYS IN THE FLOW — as an arrow, not a step.
     *
     * The label on the arrow leaving step 1 read "approved line", so the
     * sheet already assumed somebody approved each line before a vendor
     * could be chosen. Nobody owned it, nothing showed lines waiting for it,
     * and a finished BOQ sat unapproved with the whole purchase flow behind
     * it and no row anywhere saying why. The approval itself always existed
     * (every line is a record the MD can rule on); what was missing was a
     * place to do it and a person who owed it.
     */
    key: 'check', n: 2, group: '', name: 'Check BOQ', tone: 'var(--accent, #8b5cf6)',
    next: 'approved', action: 'Check BOQ', goes: 'tracker',
  },
  {
    key: 'vendor', n: 3, group: 'PO', name: 'Vendor finalisation', tone: 'var(--warning)',
    next: 'vendor selected', action: 'Select vendor', goes: 'tracker',
  },
  {
    /* Gold sat too close to the amber of step 2 to tell them apart at 54px,
       and the palette has no sixth hue. Mixing two tokens keeps the theme
       honest — it moves with them — and gives the step its own colour. */
    key: 'raise', n: 4, group: '', name: 'Raise the PO',
    tone: 'color-mix(in srgb, var(--info) 58%, var(--danger))',
    next: 'PO sent', action: 'Raise PO', goes: 'document',
  },
  {
    key: 'tracking', n: 5, group: 'Tracking', name: 'Tracking', tone: 'var(--info)',
    next: 'goods at site', action: 'Chase vendor', goes: 'document',
  },
  {
    key: 'grn', n: 6, group: 'Delivery', name: 'GRN', tone: 'var(--success)',
    next: 'received < ordered', nextIsException: true, action: 'Book GRN', goes: 'tracker',
  },
  {
    key: 'short', n: 7, group: '', name: 'Shortfall', tone: 'var(--danger)',
    action: 'Book GRN', goes: 'tracker',
  },
]);

export const PIPELINE_KEYS = PIPELINE.map((s) => s.key);

/**
 * The FMS definition of the six steps: which project task OWNS each step (its
 * doer, and whoever assigned that task) and the standard lead time. Plans
 * chain the way a flow-management sheet does — a step is due its lead time
 * after the previous step ACTUALLY happened (or its plan, while that is still
 * open) — so one late step pushes the rest. Red = done after its plan, or
 * still open past it.
 */
/**
 * ONE TASK PER STEP — which is what makes each one assignable.
 *
 * Vendor, Raise and Tracking all used to name `p15_t1`, because the template
 * carried one task for all three. The Assigned-to column therefore showed
 * the same person on three steps, and Settings → FMS · Assign Work could not
 * separate them: naming somebody for the vendor step also handed them the
 * chasing. The template now has a task each (clientFlowTemplate.js), and
 * these are those keys.
 *
 * `short` still shares the GRN's task on purpose — a shortfall is discovered
 * BY booking the GRN and is chased by the same person; it is an exception
 * branch off that step, not a seventh job with its own owner.
 */
export const FMS_STEPS = Object.freeze({
  all: { taskKey: 'p13_t1', leadDays: 0, what: 'Fill the BOQ', after: 'the BOQ task’s due date' },
  check: { taskKey: 'p13_t2', leadDays: 2, what: 'Check and approve the BOQ', after: 'the BOQ is filled' },
  vendor: { taskKey: 'p15_vendor', leadDays: 2, what: 'Select the vendor', after: 'the BOQ is approved' },
  raise: { taskKey: 'p15_t1', leadDays: 1, what: 'Raise and send the PO', after: 'the vendor is chosen' },
  tracking: { taskKey: 'p15_track', leadDays: 7, what: 'Get it delivered', after: 'the PO is sent, or the vendor’s promised date' },
  grn: { taskKey: 'p15_t3', leadDays: 1, what: 'Book the GRN', after: 'delivery' },
  short: { taskKey: 'p15_t3', leadDays: 3, what: 'Resolve the shortfall', after: 'the GRN' },
});

const FMS_DAY = 86400000;
const FMS_CHAIN = [['vendor', 'all'], ['raise', 'vendor'], ['tracking', 'raise'], ['grn', 'tracking'], ['short', 'grn']];
const DELIVERED_STATUSES = ['Delivered', 'Partly Received', 'Received (GRN)', 'Short / Damaged'];
const msOf = (d) => {
  if (!d) return null;
  const n = new Date(d).getTime();
  return Number.isNaN(n) ? null : n;
};
const lastLog = (r, test) => [...(r.changeLog || [])].reverse().find(test) || null;
const stampOfLog = (e) => (e ? { at: e.at || null, by: e.by?.name || null } : null);
/* Send stamps are also free-text boxes on older rows — only a real date counts. */
const realDate = (x) => (x && !Number.isNaN(Date.parse(x)) && /[-/T:]/.test(String(x)) ? x : null);
const lateText = (ms) => {
  const d = Math.floor(ms / FMS_DAY);
  const h = Math.floor((ms % FMS_DAY) / 3600000);
  return d ? `${d}d${h ? ` ${h}h` : ''}` : `${Math.max(1, h)}h`;
};

/**
 * One line's FMS timeline: for every step, its plan, its actual `{ at, by }`
 * (null while open) and whether it is late. Shortfall is null for a line that
 * was not short — the step does not apply to it.
 */
export function fmsTimeline(row, { boqTask = null, now = Date.now() } = {}) {
  const { r, f } = row;
  const v = r.values || {};
  const isShort = f.received != null && f.qty > 0 && f.received < f.qty;
  const receipt = lastLog(r, (c) => c.field === 'grn_number' || c.field === 'received_quantity');

  const actual = {
    all: { at: r.submittedAt || r.createdAt || null, by: r.submittedBy?.name || r.createdBy?.name || null },
    vendor: String(v.vendor || '').trim()
      ? (stampOfLog(lastLog(r, (c) => c.field === 'vendor')) || { at: null, by: null })
      : null,
    raise: String(v.po_number || '').trim()
      ? (stampOfLog(lastLog(r, (c) => c.field === 'po_number'))
        || { at: realDate(v.sent_email_at) || realDate(v.sent_whatsapp_at), by: null })
      : null,
    tracking: stampOfLog(lastLog(r, (c) => c.field === 'order_status' && DELIVERED_STATUSES.includes(c.to)))
      || (v.received_date ? { at: v.received_date, by: v.received_by || null } : null),
    grn: String(v.grn_number || '').trim() || f.received != null
      ? { at: receipt?.at || v.received_date || null, by: v.received_by || receipt?.by?.name || null }
      : null,
    short: null,
  };

  const plans = { all: boqTask?.plannedEnd || r.createdAt || null };
  for (const [key, prev] of FMS_CHAIN) {
    if (key === 'tracking' && v.promised_delivery) {
      const due = new Date(v.promised_delivery);
      due.setHours(18, 0, 0, 0);
      plans[key] = due.toISOString();
      continue;
    }
    const base = msOf(actual[prev]?.at) ?? msOf(plans[prev]);
    plans[key] = base == null ? null : new Date(base + FMS_STEPS[key].leadDays * FMS_DAY).toISOString();
  }

  const out = {};
  for (const key of Object.keys(FMS_STEPS)) {
    if (key === 'short' && !isShort) { out[key] = null; continue; }
    const a = actual[key];
    const plan = msOf(plans[key]);
    const doneAt = msOf(a?.at);
    let lateMs = 0;
    if (plan != null) lateMs = a ? (doneAt != null && doneAt > plan ? doneAt - plan : 0) : Math.max(0, now - plan);
    out[key] = {
      plan: plans[key],
      actual: a,
      late: lateMs > 0,
      lateLabel: lateMs > 0 ? `${a ? 'late' : 'overdue'} ${lateText(lateMs)}` : '',
    };
  }
  return out;
}
export const stageMeta = (key) => PIPELINE.find((s) => s.key === key) || PIPELINE[0];

/**
 * Which step a line is at.
 *
 * Read top down, and exclusive: the first rule that matches wins, so every
 * line is at exactly one step and the six counts add up to the whole list.
 * Cancelled sits outside the flow entirely — it is not a step, it is a line
 * that left.
 *
 * Takes the ROW, not the facts: "has a vendor" and "has a PO number" are
 * fields on the record, and deriving them from the status would have to guess.
 */
export function stageOf(row) {
  /* Called with either a row or, from older call sites, bare facts. */
  const f = row?.f || row;
  const v = row?.r?.values || {};
  if (f.status === 'Cancelled') return 'cancelled';

  /* Short before full: a line can be "received" and still short, and the
     shortfall is the thing somebody has to act on. */
  if (f.received != null && f.qty > 0 && f.received < f.qty) return 'short';
  if (f.received != null && f.received >= f.qty && f.qty > 0) return 'grn';
  if (f.status === 'Received (GRN)') return 'grn';

  /* Delivered at site with no receipt booked: the next job is the GRN. */
  if (v.order_status === 'Delivered') return 'grn';

  /* On its way: a PO exists, and nothing has arrived against it. */
  if (String(v.po_number || '').trim() || f.sent || f.moved) return 'tracking';

  /**
   * NOT RULED ON YET. Checked after everything downstream, deliberately: a
   * line that has already been ordered and delivered is not sitting in the
   * approval queue whatever its record status says — the work moved on, and
   * dragging it backwards would put received goods on the checker's desk.
   */
  /* A DRAFT IS STILL BEING WRITTEN. It belongs to Step 1's builder, not the
     checker's desk: a line the plan opened with no rate yet is not something
     anybody can approve. Step 1 lists every line, so it is still seen there. */
  if (row?.r?.status === 'draft') return 'all';

  if (row?.r?.status !== 'approved') return 'check';

  /* Nothing can be ordered without somebody to order it from. */
  if (!String(v.vendor || '').trim()) return 'vendor';
  return 'raise';
}

const MS_DAY = 86400000;
const twoDigit = (n) => String(n).padStart(2, '0');

/** A promise falls due at the end of its day, not at midnight that morning. */
export function promisedAt(due) {
  if (!due) return null;
  const t = new Date(due);
  if (Number.isNaN(t.getTime())) return null;
  t.setHours(18, 0, 0, 0);
  return t.getTime();
}

/** "2d 04:11:07" — days only when there are any. */
export function countdown(ms) {
  const t = Math.floor(Math.abs(ms) / 1000);
  const d = Math.floor(t / 86400);
  return `${d > 0 ? `${d}d ` : ''}${twoDigit(Math.floor((t % 86400) / 3600))}:${twoDigit(Math.floor((t % 3600) / 60))}:${twoDigit(t % 60)}`;
}

/**
 * What the clock should say and how it should look, for one order at one
 * instant. `tone` is 'over' | 'soon' | 'ok' | 'done' | 'none' — never a colour,
 * so the palette lives in CSS and this stays testable.
 */
export function clockOf(facts, now = Date.now()) {
  if (CLOSED.has(facts.status)) {
    if (facts.status === 'Cancelled') return { text: 'cancelled', tone: 'none' };
    const slip = facts.receivedLate;
    return { text: slip > 0 ? `${slip}d late` : 'on time', tone: slip > 0 ? 'over' : 'done' };
  }
  const at = promisedAt(facts.due);
  if (!at) return { text: 'no date given', tone: 'none' };
  const left = at - now;
  if (left <= 0) return { text: `${countdown(left)} late`, tone: 'over' };
  return { text: `${countdown(left)} left`, tone: left < 3 * MS_DAY ? 'soon' : 'ok' };
}

/**
 * How long the vendor asked for, and how long we planned — both from real
 * fields, both optional. There is no invented SLA: an order with no promised
 * date simply has no promise to measure, and the screen says that.
 */
export function promiseOf({ r, f }) {
  const v = r.values || {};
  /* The SEND STAMP, not `f.sent` — that is a boolean, and `new Date(true)` is
     1 Jan 1970, which turned every promise into "vendor said 20696 days". */
  const from = sentAtOf(v.sent_whatsapp_at) || sentAtOf(v.sent_email_at) || v.planned_start || null;
  const span = from && f.due ? Math.round((new Date(f.due) - new Date(from)) / MS_DAY) : null;
  /* A promise that ends before it starts is bad data, not a zero-day promise:
     three BOQ rows here have planned_end before planned_start. Saying nothing
     is honest; saying "0 days" reads as "they promised it the same day". */
  const said = span != null && span >= 0 ? span : null;
  const planned = v.planned_start && v.planned_end
    ? Math.max(0, Math.round((new Date(v.planned_end) - new Date(v.planned_start)) / MS_DAY))
    : null;
  return { said, planned };
}

/** The BOQ group an order belongs to — its category, which is what the form asks for. */
export const categoryOf = ({ r }) => (r.values?.category || '').trim() || 'Uncategorised';

/** Every category present in the rows, most-used first — the filter chips are built from the data. */
export function categoriesOf(rows) {
  const counts = new Map();
  for (const row of rows) {
    const c = categoryOf(row);
    counts.set(c, (counts.get(c) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([key, n]) => ({ key, n }));
}

/** Counts and value per stage, for the pipeline strip. Cancelled sits outside it. */
export function pipelineOf(rows) {
  const at = new Map(PIPELINE_KEYS.map((k) => [k, { key: k, rows: [], value: 0, late: 0 }]));
  /* Step 1 is the whole list, not a step lines sit at: it is where the flow
     starts and what you click to see everything again. */
  at.get('all').rows = [...rows];
  at.get('all').value = rows.reduce((n, r) => n + r.f.amount, 0);
  at.get('all').late = rows.filter((r) => r.f.daysLate > 0).length;
  for (const row of rows) {
    const cell = at.get(stageOf(row));
    if (!cell || cell.key === 'all') continue;   // cancelled, or the total
    cell.rows.push(row);
    cell.value += row.f.amount;
    if (row.f.daysLate > 0) cell.late += 1;
  }
  return PIPELINE.map((st) => ({ ...st, ...at.get(st.key), count: at.get(st.key).rows.length }));
}

/**
 * Where this order's action button goes. Built here, not at the two call
 * sites, so the sheet and the drawer can never send the same button to
 * different places.
 */
export function actionPathOf({ r, f, project }) {
  const stage = stageMeta(stageOf({ r, f, project }));
  const base = purchaseOrderPath(project.id, r._id);
  /* Purchase addresses, always: these two builders are only ever called from
     the Purchase sheet and its drawer, and a row there must not throw the
     reader into PMS. */
  return stage.goes === 'document' ? `${base}/document` : base;
}

/** The OTHER page, for the secondary link beside it. */
export function otherPathOf({ r, f, project }) {
  const stage = stageMeta(stageOf({ r, f, project }));
  const base = purchaseOrderPath(project.id, r._id);
  return stage.goes === 'document' ? base : `${base}/document`;
}

/** Value on a set of rows — one place, so the cards and the table agree. */
export const valueOf = (rows) => rows.reduce((sum, { f }) => sum + num(f.amount), 0);
export const lateOf = (rows) => rows.filter(({ f }) => f.daysLate > 0).length;

/** Is anything at all recorded for this order beyond the BOQ line itself? */
export const hasTracking = ({ r }) => {
  const v = r.values || {};
  return ['po_number', 'indent_number', 'dispatch_date', 'transporter', 'lr_docket',
    'delivery_challan_no', 'received_date', 'grn_number', 'invoice_number']
    .some((k) => has(v[k]));
};

/**
 * The BOQs a line can belong to — the six documents the business plans and
 * orders from. This list is the ORDER they are shown in, not a filter: a value
 * outside it (someone typed one, or a template gained an eighth) still gets a
 * card, after these.
 *
 * The field is `boq_type` on the Phase 5 form. It is NOT `category`: category
 * is the trade, and two of these BOQs — "All games furniture" and "Common area
 * furniture" — are the same trade, so one can never stand in for the other.
 */
export const BOQ_ORDER = Object.freeze([
  'All games furniture BOQ',
  'All games electronic BOQ',
  'All games cameras BOQ',
  'All games speaker BOQ',
  'Common area furniture BOQ',
  'Procurement BOQ of all games',
]);

/** Lines with no BOQ set are collected here rather than dropped. */
export const BOQ_NONE = 'Not assigned';
export const boqOf = ({ r }) => (r.values?.boq_type || '').trim() || BOQ_NONE;

/**
 * The BOQs present in these rows, each with what a planner needs before
 * opening it: how many lines, what they are worth, and how many are not yet
 * on an order — which is the only reason to open one.
 */
export function boqsOf(rows) {
  const by = new Map(BOQ_ORDER.map((key) => [key, {
    key, lines: [], value: 0, toOrder: 0, late: 0,
  }]));
  for (const row of rows) {
    const key = boqOf(row);
    if (!by.has(key)) by.set(key, { key, lines: [], value: 0, toOrder: 0, late: 0 });
    const g = by.get(key);
    g.lines.push(row);
    g.value += row.f.amount;
    if (['vendor', 'raise'].includes(stageOf(row))) g.toOrder += 1;
    if (row.f.daysLate > 0) g.late += 1;
  }
  const rank = (k) => {
    const i = BOQ_ORDER.indexOf(k);
    /* Unknown values after the six, "Not assigned" last of all — it is a gap
       to fill, not a BOQ to plan from. */
    return k === BOQ_NONE ? 999 : (i < 0 ? 500 : i);
  };
  return [...by.values()].sort((a, b) => rank(a.key) - rank(b.key));
}

/* ---------------------------------------------------------------------------
   Newest first.

   Every purchase list reads top-down, and the row somebody came to look at is
   almost always the one that moved most recently — an order raised this
   morning, a GRN booked an hour ago. The rows used to arrive sorted by centre
   name, which put "Andheri" above "Worli" forever and buried today's work
   under a hundred lines of alphabet.

   Recency is "when did anything happen to this line", not "when was it typed":
   `factsOf` already resolves that to `lastAt` (the last changeLog stamp, or
   the record's own updatedAt), so an order raised last month but received
   today sorts as today's. `createdAt` is the fallback for a line nothing has
   happened to yet, and `seq` breaks the tie for lines created in the same
   write — a seeded BOQ shares one timestamp across every row it wrote.
   --------------------------------------------------------------------------- */

/**
 * Milliseconds for the most recent thing that happened to a row, or 0.
 *
 * Strict about what a date is, for the reason sentAtOf is: `new Date()` will
 * take almost anything. The literal string "+91 " that four BOQ rows carry in
 * a date-shaped field parses to 1991 rather than failing, and a row silently
 * dated 1991 sorts as a real date instead of as the "no date" it is. Only a
 * Date, an epoch number, or a string that STARTS as YYYY-MM-DD counts.
 */
export function recencyOf(row) {
  const at = (x) => {
    if (!x) return null;
    if (x instanceof Date) return Number.isFinite(x.getTime()) ? x.getTime() : null;
    if (typeof x === 'number') return Number.isFinite(x) ? x : null;
    if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(x)) return null;
    const ms = new Date(x).getTime();
    return Number.isFinite(ms) ? ms : null;
  };
  return at(row?.f?.lastAt) ?? at(row?.r?.updatedAt) ?? at(row?.r?.createdAt) ?? 0;
}

/** Comparator: latest to oldest, stable on ties. */
export const byNewestFirst = (a, b) => recencyOf(b) - recencyOf(a)
  || (b?.r?.seq ?? 0) - (a?.r?.seq ?? 0);
