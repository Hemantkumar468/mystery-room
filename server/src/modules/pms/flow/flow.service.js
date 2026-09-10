import mongoose from 'mongoose';
import { Record } from '../records/record.model.js';
import { Project } from '../projects/project.model.js';
import { ApiError } from '../../../core/utils/ApiError.js';
import { RECORD_STATUS } from '../../../core/constants/index.js';
import {
  DRAWING_CHECKLIST, DRAWING_SET_1, DRAWING_SET_2, DRAWING_STATUS_APPROVED,
} from '../../../seed/drawingChecklist.js';
import {
  BOQ_MASTER, BOQ_TYPES, BOQ_STREAM_META, VENDOR_CATEGORIES,
  SOURCE_OF_SUPPLY, needsPurchaseOrder,
} from '../../../seed/boqMaster.js';

/**
 * The client flow's read model — the three rules, computed rather than typed.
 *
 * PMS_UI_SPEC_00 §3 states five rules. Three of them are gates with a yes/no
 * answer, and every one of them was previously a thing people remembered:
 *
 *   Rule 2  Set 1 drawings unlock the BOQ. Set 2 blocks nothing.
 *   Rule 3  Quantities come from drawings, rates from the panel. Neither alone.
 *   Rule 4  Nothing is ordered before a contract exists.
 *
 * WHY THIS IS A SERVICE AND NOT A SCREEN. A rule that only the UI knows is a
 * suggestion: anyone can POST straight to /records and raise a purchase order
 * for a vendor who never signed anything. `assertOrderable` below is the same
 * check the screen renders, called from the write path, so the answer is the
 * same whichever door you come in by.
 *
 * WHY IT READS RECORDS RATHER THAN ITS OWN TABLES. Drawings, BOQ lines,
 * vendors and contracts are all Records keyed by stageKey — see
 * record.model.js. Deriving the gates from those means the board, the phase
 * pages, the approvals queue and the audit trail are all looking at one set of
 * rows. A parallel table would be a second answer to the same question.
 */

const STAGE = Object.freeze({
  DRAWINGS: 'p11',
  VENDORS: 'p12',
  BOQ: 'p13',
  CONTRACTS: 'p21',
  ORDERS: 'p15',
});

/** Records that still count. Rejected and archived rows are not evidence. */
const LIVE = { $nin: [RECORD_STATUS.REJECTED, RECORD_STATUS.ARCHIVED] };

const str = (v) => String(v ?? '').trim();
const num = (v) => {
  const n = Number(String(v ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

async function requireProject(projectId) {
  const project = await Project.findById(projectId).select('_id name code').lean();
  if (!project) throw new ApiError(404, 'Project not found');
  return project;
}

const rowsFor = (projectId, stageKey) =>
  Record.find({ project: projectId, stageKey, status: LIVE }).lean();

/* ══════════════════════════════════════════════════════════════════════
   PHASE 5 — the drawing checklist, and the gate it holds
   ══════════════════════════════════════════════════════════════════════ */

/**
 * All 37 rows, always — merged with whatever has been filed against them.
 *
 * The checklist is the deliverable, not the uploads (fix F-1). A board that
 * lists only what arrived can say what is there; it can never say what is
 * MISSING, and missing is the only thing this phase is asked about.
 *
 * The merge is done on read rather than by writing 37 empty records into every
 * project: an untouched row has nothing to store, and materialising it would
 * put 37 rows of noise in the approvals queue and the audit trail of every
 * project on the day it is created. A row becomes a real Record the moment
 * somebody actually files something against it.
 */
export function mergeDrawings(records = []) {
  const byName = new Map();
  for (const r of records) {
    const key = str(r.values?.checklist_drawing);
    if (!key) continue;
    /* Several revisions of one drawing are normal and expected. The row shows
       the LATEST, which is the only one anybody is asking about — earlier ones
       stay on their own records and in the changeLog. */
    const prev = byName.get(key);
    const rev = num(r.values?.revision_no);
    if (!prev || rev >= prev.rev) byName.set(key, { record: r, rev });
  }

  return DRAWING_CHECKLIST.map((d) => {
    const hit = byName.get(d.name);
    const rec = hit?.record;
    const status = str(rec?.values?.checklist_status) || 'Not started';
    return {
      no: d.no,
      category: d.category,
      name: d.name,
      set: d.set,
      setLabel: d.setLabel,
      blocksBoq: d.blocksBoq,
      unconfirmed: !!d.unconfirmed,
      status,
      approved: status === DRAWING_STATUS_APPROVED,
      revision: rec ? num(rec.values?.revision_no) : null,
      recordId: rec?._id || null,
      updatedAt: rec?.updatedAt || null,
    };
  });
}

export function drawingSummary(rows) {
  const of = (set) => {
    const mine = rows.filter((r) => r.set === set);
    const approved = mine.filter((r) => r.approved).length;
    const started = mine.filter((r) => r.status !== 'Not started').length;
    return {
      total: mine.length, approved, started, notStarted: mine.length - started,
    };
  };
  const set1 = of(1);
  const set2 = of(2);
  /**
   * Has anybody used the checklist on this project at all?
   *
   * "Nobody has started" and "the checklist says you are blocked" are the same
   * arithmetic — 0 of 29 approved — and completely different facts. Eighteen
   * projects predate the checklist; several are already ordering. Telling them
   * "the BOQ is waiting on 29 drawings" is a false alarm, and a banner that
   * cries wolf on day one is a banner people learn to scroll past — which
   * costs us the one it is actually for.
   *
   * So the gate still reads false (quantities genuinely are not ready), but
   * the screen can say which of the two situations it is looking at.
   */
  const started = rows.some((r) => r.recordId);
  return {
    set1,
    set2,
    total: rows.length,
    approved: set1.approved + set2.approved,
    started,
    /**
     * THE GATE. Rule 2: Set 1 and only Set 1. Wiring Set 2 in here would hold
     * the BOQ for a wall-finish schedule nobody is counting quantities from —
     * which is precisely the mistake the two-set split exists to prevent.
     */
    boqUnlocked: set1.approved === set1.total && set1.total > 0,
    blocking: rows.filter((r) => r.blocksBoq && !r.approved)
      .map((r) => ({ no: r.no, name: r.name, status: r.status })),
  };
}

export async function getDrawings(projectId) {
  await requireProject(projectId);
  const rows = mergeDrawings(await rowsFor(projectId, STAGE.DRAWINGS));
  return { rows, summary: drawingSummary(rows), sets: { set1: DRAWING_SET_1.length, set2: DRAWING_SET_2.length } };
}

/* ══════════════════════════════════════════════════════════════════════
   PHASE 6 — the panel, and the rates it owes the BOQ
   ══════════════════════════════════════════════════════════════════════ */

export function summarisePanel(vendorRecords = []) {
  const categories = VENDOR_CATEGORIES.map((category) => {
    const mine = vendorRecords.filter((r) => str(r.values?.panel_category) === category);
    /* "Confirmed" means somebody ticked the rate — not merely that a vendor
       row exists. A vendor with no agreed rate prices nothing, and counting
       them as done is how a BOQ ends up with empty totals nobody expected. */
    const confirmed = mine.filter((r) => r.values?.rate_confirmed === true);
    return {
      category,
      vendors: mine.length,
      confirmed: confirmed.length,
      rateConfirmed: confirmed.length > 0,
      names: confirmed.map((r) => str(r.values?.vendor_name)).filter(Boolean),
    };
  });
  const gc = vendorRecords.find((r) => r.values?.is_local_gc === true);
  return {
    categories,
    confirmedCount: categories.filter((c) => c.rateConfirmed).length,
    totalCategories: categories.length,
    ratesReady: categories.every((c) => c.rateConfirmed),
    missing: categories.filter((c) => !c.rateConfirmed).map((c) => c.category),
    localContractor: gc ? str(gc.values?.vendor_name) : null,
  };
}

export async function getPanel(projectId) {
  await requireProject(projectId);
  return summarisePanel(await rowsFor(projectId, STAGE.VENDORS));
}

/* ── the panel board: one row per BOQ, because that is what needs pricing ──
 *
 * The spec asks for "seven rows, one per vendor category, the same seven as
 * the BOQ types". Those are not the same seven: "All games furniture" and
 * "Common area furniture" are bought from ONE panel category, so there are six
 * categories serving seven BOQs.
 *
 * The board is therefore keyed on the seven BOQs — that is the list people
 * recognise, and it is what actually needs a rate before it can be priced —
 * and the two rows that share a category say so, with confirming one visibly
 * satisfying both. Collapsing to six rows would hide a BOQ; pretending there
 * are seven independent categories would ask for a rate card twice.
 */
const RATE_LINE = 'rate_line';

export function summarisePanelBoard(vendorRecords = [], rateLines = []) {
  const vendorsOf = (category) =>
    vendorRecords.filter((r) => str(r.values?.panel_category) === category);

  const linesOf = (vendorId) =>
    rateLines.filter((l) => String(l.parentRecordId) === String(vendorId));

  const cardOf = (vendor) => {
    if (!vendor) return { lines: 0, overrides: 0, state: 'none' };
    const lines = linesOf(vendor._id);
    /* An override is a site rate that differs from the standard one. Counting
       them is what turns "Site-specific" from a label into a number somebody
       can be asked about at closure. */
    const overrides = lines.filter((l) => {
      const std = num(l.values?.standard_rate);
      const site = num(l.values?.site_rate);
      return std > 0 && site > 0 && std !== site;
    });
    return {
      lines: lines.length,
      overrides: overrides.length,
      /* Unexplained overrides are called out separately: the reason is what
         makes a negotiated rate defensible, and a blank one is the single
         thing most likely to be missing. */
      unexplained: overrides.filter((l) => !str(l.values?.override_reason)).length,
      state: lines.length === 0 ? 'none' : (overrides.length ? 'site' : 'standard'),
    };
  };

  const rows = BOQ_MASTER.map((b) => {
    const candidates = vendorsOf(b.vendorCategory);
    /* The assigned vendor is the one whose rate is confirmed; failing that,
       whichever is on the panel for this category. */
    const vendor = candidates.find((v) => v.values?.rate_confirmed === true) || candidates[0] || null;
    const card = cardOf(vendor);
    const sharesWith = BOQ_MASTER
      .filter((o) => o.no !== b.no && o.vendorCategory === b.vendorCategory)
      .map((o) => o.name);

    return {
      boqNo: b.no,
      boqName: b.name,
      category: b.vendorCategory,
      covers: b.covers,
      /* Panel · Local · Internal — read off the category's own naming, which
         is where the business already records it. */
      vendorType: /internal/i.test(b.vendorCategory) ? 'Internal'
        : (/local/i.test(b.vendorCategory) ? 'Local' : 'Panel'),
      vendorId: vendor?._id || null,
      vendorName: vendor ? str(vendor.values?.vendor_name) : null,
      onPanel: vendor?.values?.on_panel === true,
      rateConfirmed: vendor?.values?.rate_confirmed === true,
      isLocalGc: vendor?.values?.is_local_gc === true,
      card,
      candidates: candidates.length,
      sharesWith,
      /**
       * A category with no confirmed vendor does NOT stop the BOQ being built
       * — quantities come from the drawings and can be entered today. What it
       * stops is that BOQ being APPROVED, because an approved BOQ with no
       * agreed rate behind it is a number nobody has committed to.
       */
      blocks: vendor?.values?.rate_confirmed === true
        ? null
        : `${b.name} cannot be approved until a rate is confirmed for ${b.vendorCategory}`,
    };
  });

  return {
    rows,
    confirmed: rows.filter((r) => r.rateConfirmed).length,
    total: rows.length,
    categories: [...new Set(BOQ_MASTER.map((b) => b.vendorCategory))].length,
    localContractor: rows.find((r) => r.isLocalGc)?.vendorName || null,
    unexplainedOverrides: rows.reduce((n, r) => n + (r.card.unexplained || 0), 0),
  };
}

export async function getPanelBoard(projectId) {
  await requireProject(projectId);
  const [vendors, rateLines] = await Promise.all([
    rowsFor(projectId, STAGE.VENDORS),
    Record.find({
      project: projectId, stageKey: STAGE.VENDORS, assessmentType: RATE_LINE, status: LIVE,
    }).lean(),
  ]);
  /* The vendor list excludes rate lines: both live on p12, and a rate line is
     not a vendor. Without this the board would count 40 rate rows as 40
     vendors on the panel. */
  const onlyVendors = vendors.filter((v) => v.assessmentType !== RATE_LINE);
  return summarisePanelBoard(onlyVendors, rateLines);
}

/** One vendor's rate card, for the card editor. */
export async function getRateCard(projectId, vendorId) {
  await requireProject(projectId);
  const vendor = await Record.findOne({ project: projectId, stageKey: STAGE.VENDORS, _id: vendorId }).lean();
  if (!vendor) throw new ApiError(404, 'That vendor is not on this project');
  const lines = await Record.find({
    project: projectId, stageKey: STAGE.VENDORS, assessmentType: RATE_LINE,
    parentRecordId: vendorId, status: LIVE,
  }).lean();
  return {
    vendor: {
      id: vendor._id,
      name: str(vendor.values?.vendor_name),
      category: str(vendor.values?.panel_category),
      rateConfirmed: vendor.values?.rate_confirmed === true,
      onPanel: vendor.values?.on_panel === true,
    },
    lines: lines.map((l) => ({
      id: l._id,
      item: str(l.values?.item),
      unit: str(l.values?.unit),
      standardRate: num(l.values?.standard_rate),
      siteRate: num(l.values?.site_rate),
      reason: str(l.values?.override_reason),
      validTill: l.values?.valid_till || null,
      overridden: num(l.values?.standard_rate) > 0
        && num(l.values?.site_rate) > 0
        && num(l.values?.standard_rate) !== num(l.values?.site_rate),
    })),
  };
}

/* ══════════════════════════════════════════════════════════════════════
   PHASE 7 — seven BOQs, each totalled and approved on its own
   ══════════════════════════════════════════════════════════════════════ */

export function summariseBoqs(lines = []) {
  const bucket = (name) => lines.filter((l) => str(l.values?.boq_type) === name);

  const boqs = BOQ_MASTER.map((b) => {
    const mine = bucket(b.name);
    const approved = mine.filter((l) => l.status === RECORD_STATUS.APPROVED);
    const value = mine.reduce((n, l) => n + num(l.values?.amount), 0);
    const sources = {
      [SOURCE_OF_SUPPLY.STOCK]: 0,
      [SOURCE_OF_SUPPLY.PRODUCTION]: 0,
      [SOURCE_OF_SUPPLY.PROCURE]: 0,
      unset: 0,
    };
    for (const l of mine) {
      const s = str(l.values?.source_of_supply);
      if (sources[s] === undefined) sources.unset += 1;
      else sources[s] += 1;
    }
    return {
      ...b,
      lines: mine.length,
      approvedLines: approved.length,
      value,
      approvedValue: approved.reduce((n, l) => n + num(l.values?.amount), 0),
      /* A BOQ with no lines is not an approved BOQ — it is an empty one. */
      fullyApproved: mine.length > 0 && approved.length === mine.length,
      sources,
    };
  });

  /* Lines filed before boq_type existed. Shown by name rather than folded into
     a total, because a total that quietly includes unfiled lines is a total
     nobody can reconcile against the seven documents. */
  const unassigned = lines.filter((l) => !BOQ_TYPES.includes(str(l.values?.boq_type)));

  const streams = BOQ_STREAM_META.map((s) => {
    const mine = boqs.filter((b) => b.stream === s.key);
    return {
      ...s,
      boqs: mine.length,
      lines: mine.reduce((n, b) => n + b.lines, 0),
      value: mine.reduce((n, b) => n + b.value, 0),
    };
  });

  return {
    boqs,
    streams,
    unassigned: {
      lines: unassigned.length,
      value: unassigned.reduce((n, l) => n + num(l.values?.amount), 0),
    },
    totals: {
      lines: lines.length,
      value: lines.reduce((n, l) => n + num(l.values?.amount), 0),
      approvedBoqs: boqs.filter((b) => b.fullyApproved).length,
      ofBoqs: boqs.length,
    },
  };
}

export async function getBoq(projectId) {
  await requireProject(projectId);
  const [lines, drawings, vendors] = await Promise.all([
    rowsFor(projectId, STAGE.BOQ),
    rowsFor(projectId, STAGE.DRAWINGS),
    rowsFor(projectId, STAGE.VENDORS),
  ]);
  const summary = summariseBoqs(lines);
  const drawingSum = drawingSummary(mergeDrawings(drawings));
  const panel = summarisePanel(vendors);

  /**
   * Rule 3, stated in one place. Quantities come from the drawings and rates
   * come from the panel, and NEITHER ALONE produces a BOQ. The workspace shows
   * both halves so an empty BOQ says which half is missing rather than just
   * looking unstarted.
   */
  return {
    ...summary,
    inputs: {
      quantitiesReady: drawingSum.boqUnlocked,
      blockingDrawings: drawingSum.blocking,
      ratesReady: panel.ratesReady,
      missingRates: panel.missing,
      canStart: drawingSum.boqUnlocked && panel.ratesReady,
    },
  };
}

/* ══════════════════════════════════════════════════════════════════════
   PHASE 8 — contracts, and the vendors they release
   ══════════════════════════════════════════════════════════════════════ */

const SIGNED = 'Signed';

export function summariseContracts(contractRecords = []) {
  const contracts = contractRecords.map((r) => ({
    id: r._id,
    vendor: str(r.values?.vendor_name),
    boqType: str(r.values?.boq_type),
    category: str(r.values?.panel_category),
    value: num(r.values?.contract_value),
    status: str(r.values?.contract_status) || 'Draft',
    signed: str(r.values?.contract_status) === SIGNED,
    completionDate: r.values?.completion_date || null,
    retentionPct: r.values?.retention_pct ?? null,
    hasSignedCopy: !!(r.attachments || []).some((a) => a.fieldKey === 'contract_file'),
  }));

  const signed = contracts.filter((c) => c.signed);
  return {
    contracts,
    signedVendors: [...new Set(signed.map((c) => c.vendor).filter(Boolean))],
    counts: {
      total: contracts.length,
      signed: signed.length,
      draft: contracts.length - signed.length,
    },
    value: {
      total: contracts.reduce((n, c) => n + c.value, 0),
      signed: signed.reduce((n, c) => n + c.value, 0),
    },
    /* A signed contract with no uploaded copy is a claim, not a document. */
    signedWithoutCopy: signed.filter((c) => !c.hasSignedCopy).map((c) => c.vendor),
  };
}

export async function getContracts(projectId) {
  await requireProject(projectId);
  return summariseContracts(await rowsFor(projectId, STAGE.CONTRACTS));
}

/* ══════════════════════════════════════════════════════════════════════
   PHASE 9 — what may actually be ordered
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Rule 4, as a function: nothing is ordered before a contract exists.
 *
 * Two things stop a BOQ line becoming a purchase order, and they are different
 * refusals with different fixes, so they are reported separately:
 *
 *   - the line is not bought in at all (Delhi stock or Delhi production).
 *     There is nothing to fix; it was never going to be a PO.
 *   - the vendor has no signed contract. That IS a fix, and naming the vendor
 *     is what makes it actionable instead of just blocked.
 */
export function orderability(lines = [], contractSummary) {
  const signed = new Set((contractSummary?.signedVendors || []).map((v) => v.toLowerCase()));

  const rows = lines.map((l) => {
    const source = str(l.values?.source_of_supply);
    const vendor = str(l.values?.vendor || l.values?.vendor_name);
    const approved = l.status === RECORD_STATUS.APPROVED;

    if (!needsPurchaseOrder(source)) {
      return {
        id: l._id,
        vendor,
        source,
        orderable: false,
        reason: source
          ? `${source} — earmarked, never becomes a purchase order`
          : 'No source of supply set yet',
        blocked: false,
      };
    }
    if (!approved) {
      return { id: l._id, vendor, source, orderable: false, reason: 'BOQ line not approved yet', blocked: true };
    }
    if (!vendor) {
      return { id: l._id, vendor, source, orderable: false, reason: 'No vendor on the line', blocked: true };
    }
    if (!signed.has(vendor.toLowerCase())) {
      return {
        id: l._id,
        vendor,
        source,
        orderable: false,
        reason: `No signed contract with ${vendor} — sign it in Phase 8 first`,
        blocked: true,
        needsContract: true,
      };
    }
    return { id: l._id, vendor, source, orderable: true, reason: '', blocked: false };
  });

  /**
   * The order book, as it actually stands — read off the tracking fields the
   * order tracker writes, not from a status anybody types twice.
   *
   * A line is SENT once it has a PO number; RECEIVED once a GRN or a received
   * date exists against it. Both are stamps the tracker writes, so these
   * counts and the tracker's own sheet cannot disagree.
   */
  const book = {
    lines: lines.length,
    sent: lines.filter((l) => str(l.values?.po_number)).length,
    received: lines.filter((l) => str(l.values?.grn_number) || str(l.values?.received_date)).length,
    stock: lines.filter((l) => str(l.values?.source_of_supply) === SOURCE_OF_SUPPLY.STOCK).length,
    production: lines.filter((l) => str(l.values?.source_of_supply) === SOURCE_OF_SUPPLY.PRODUCTION).length,
  };
  book.notSent = book.lines - book.sent;

  return {
    rows,
    book,
    orderable: rows.filter((r) => r.orderable).length,
    blocked: rows.filter((r) => r.blocked).length,
    notApplicable: rows.filter((r) => !r.orderable && !r.blocked).length,
    blockedVendors: [...new Set(rows.filter((r) => r.blocked && r.vendor).map((r) => r.vendor))],
    /**
     * Vendors blocked SPECIFICALLY for want of a signed contract — which is
     * not the same set as `blockedVendors`, and the difference matters.
     *
     * A vendor whose contract IS signed still appears in `blockedVendors` if
     * one of their lines is merely unapproved. Naming them on the contracts
     * screen under "waiting on" would send somebody to chase a signature that
     * already exists, and make the page look wrong to the one person who knows
     * it is. Signing is the fix for THIS list and no other.
     */
    awaitingContract: [...new Set(
      rows.filter((r) => r.needsContract && r.vendor).map((r) => r.vendor),
    )],
    awaitingApproval: rows.filter((r) => r.blocked && !r.needsContract).length,
  };
}

export async function getOrderability(projectId) {
  await requireProject(projectId);
  const [lines, contractRecords] = await Promise.all([
    rowsFor(projectId, STAGE.BOQ),
    rowsFor(projectId, STAGE.CONTRACTS),
  ]);
  return orderability(lines, summariseContracts(contractRecords));
}

/**
 * The write-path guard. Called before a BOQ line is turned into a purchase
 * order, so the rule holds for anyone posting straight to the API and not only
 * for people looking at the screen.
 */
export async function assertOrderable(projectId, recordId) {
  const { rows } = await getOrderability(projectId);
  const row = rows.find((r) => String(r.id) === String(recordId));
  if (!row) throw new ApiError(404, 'That BOQ line is not on this project');
  if (!row.orderable) throw new ApiError(409, row.reason || 'This line cannot be ordered');
  return row;
}

/**
 * Does the contract rule apply to this project at all?
 *
 * ── Why this exists, and why enforcement is not simply switched on ───
 * Phase 8 is NEW. No project created before it has a single contract record,
 * and every purchase order on every live project was raised without one —
 * correctly, because at the time there was nothing to raise it against.
 *
 * Enforcing Rule 4 unconditionally would therefore not tighten the process; it
 * would stop procurement dead on every project in the system, for a document
 * nobody was ever asked to produce. A rule applied retroactively to work that
 * predates it is not a rule, it is an outage.
 *
 * So the guard binds to the PROMISE: a project whose template gave it a
 * Contracts & Work Orders phase is a project where a contract was always
 * expected before ordering, and it is held to that. A project with no Phase 8
 * is left exactly as it was. When an older project is migrated onto the client
 * flow it acquires the phase, and the rule starts applying to it from then on
 * — which is the moment it becomes true for that project.
 */
export async function contractRuleApplies(projectId) {
  const project = await Project.findById(projectId).select('stages.key').lean();
  return !!project?.stages?.some((s) => s.key === STAGE.CONTRACTS);
}

/**
 * The fields whose arrival means "this BOQ line has become a purchase order".
 * Editing a delivery date or a GRN on an order that was already raised is not
 * raising one, and must not be blocked.
 */
export const PO_RAISING_FIELDS = Object.freeze([
  'po_number', 'sent_whatsapp_at', 'sent_email_at',
]);

/**
 * Guard for the tracking write path. No-ops unless this change actually raises
 * a purchase order on a project the rule applies to.
 *
 * `previous` is the record's values BEFORE the change: a field going from
 * empty to set is raising the order, a field being corrected is not.
 */
export async function assertMayRaisePurchaseOrder({ projectId, recordId, stageKey, values = {}, previous = {} }) {
  if (stageKey !== STAGE.BOQ) return null;

  const raising = PO_RAISING_FIELDS.filter((f) => {
    const next = str(values[f]);
    return next && !str(previous[f]);
  });
  if (!raising.length) return null;

  if (!(await contractRuleApplies(projectId))) return null;

  return assertOrderable(projectId, recordId);
}

/**
 * A negotiated rate must say why.
 *
 * A site rate that differs from the panel's standard rate is a decision
 * somebody made, and at closure — when vendor performance and budget variance
 * are being explained — "why is this branch paying 12% more for partitions?"
 * has to have an answer on the record rather than in somebody's memory. The
 * reason field is optional in the schema because it does not apply when the
 * rates match; it is required exactly when they do not, which is a rule about
 * two fields together and so cannot be expressed as `required: true`.
 *
 * Enforced here rather than only in the form, for the same reason as Rule 4:
 * a rule the API does not hold is a rule.
 */
export function assertRateLineExplained(values = {}) {
  const std = num(values.standard_rate);
  const site = num(values.site_rate);
  if (!std || !site || std === site) return;
  if (!str(values.override_reason)) {
    throw new ApiError(
      400,
      'This rate differs from the standard rate — say why. A negotiated rate with no reason cannot be defended at closure.',
      { code: 'RATE_OVERRIDE_UNEXPLAINED' },
    );
  }
}

/**
 * The deposit, as money actually received — Phase 3's own ledger.
 *
 * The LOI fixes ONE agreed figure (`security_deposit`); it arrives in parts,
 * and each part is recorded as an entry in `deposit_payments` with its amount,
 * date, mode and reference. `deposit_received` and `deposit_balance` are
 * recomputed by recordService on every entry, so the running total can never
 * disagree with the list under it — this only reads them.
 *
 * ── Why the percentage is by MONEY, not by instalment count ──────────
 * "One of two instalments paid" sounds like 50% and very often is not: a
 * token of ₹1L against an agreed ₹36L is 3%, not half. The ring therefore
 * follows the rupees, and the instalment count is shown beside it as its own
 * fact. Both are true; only one of them is the money.
 *
 * ── The PLAN comes from the LOI ──────────────────────────────────────
 * "We will pay it in two" is agreed on the Letter of Intent and nowhere
 * else, so the LOI carries `deposit_instalments` and an optional
 * `deposit_split_pct` ("50/50", "30/40/30"; blank splits equally). Those two
 * fields turn the ledger from a list of receipts into a plan with a position
 * on it: instalment 1 of 2 is 50% and it is paid, instalment 2 is 50% and it
 * is outstanding. See `depositPlan`.
 *
 * An LOI that says nothing about a split still works — there is simply no
 * plan, and the board falls back to listing what actually arrived.
 *
 * ── What this cannot say ─────────────────────────────────────────────
 * WHEN an outstanding instalment falls due. The LOI records how many
 * instalments and their sizes; no field anywhere records a date for one, so
 * every "due" line here says how much and stops there. A date nobody wrote
 * down is not a date this can report.
 */
export async function getDeposit(projectId) {
  const rows = await Record.find({
    project: projectId, stageKey: 'p3', status: LIVE,
    assessmentType: { $in: ['deposit', 'loi'] },
  }).lean();

  /* One project can carry more than one of either (a re-filed form). The one
     that names a figure is the live one; failing that, the most recent. */
  const depositRows = rows.filter((r) => r.assessmentType === 'deposit');
  const loiRows = rows.filter((r) => r.assessmentType === 'loi');
  const rec = depositRows.find((r) => num(r.values?.security_deposit) > 0)
    || depositRows[depositRows.length - 1] || null;
  const loi = loiRows.find((r) => num(r.values?.deposit_amount) > 0)
    || loiRows[loiRows.length - 1] || null;

  /**
   * THE LOI ALONE IS ENOUGH.
   *
   * The deposit is decided on the Letter of Intent — how much, and in how
   * many parts — and that is often the only document filled in for weeks:
   * the Deposit Management form gets opened when the first payment actually
   * arrives. This used to return null unless that form existed, so a project
   * whose LOI clearly said "₹30,000 deposit" showed nothing about a deposit
   * at all. The agreed figure is knowable from the LOI, so it is reported
   * from the LOI, and the ledger simply adds what has arrived against it.
   */
  const loiAmount = num(loi?.values?.deposit_amount);
  const formAmount = num(rec?.values?.security_deposit);
  if (!formAmount && !loiAmount && !depositRows.length) return null;

  /* The deposit form's own figure wins where it has one: it is the later
     document, and it is what the payments are recorded against. Where the two
     disagree that is reported rather than quietly resolved — two documents
     describing one deposit should not differ, and somebody has to look. */
  const agreed = formAmount || loiAmount;
  const disagrees = formAmount > 0 && loiAmount > 0 && formAmount !== loiAmount;
  const payments = Array.isArray(rec?.values?.deposit_payments) ? rec.values.deposit_payments : [];
  const received = payments.reduce((n, p) => n + num(p.amount), 0);

  let running = 0;
  const instalments = payments
    .slice()
    .sort((a, b) => String(a.paidOn || '').localeCompare(String(b.paidOn || '')))
    .map((p, i) => {
      running += num(p.amount);
      return {
        no: i + 1,
        amount: num(p.amount),
        paidOn: p.paidOn || null,
        mode: str(p.mode) || null,
        reference: str(p.reference) || null,
        by: str(p.byName) || null,
        /* What the project had paid once THIS instalment landed — the figure
           somebody is actually looking for when they ask "where were we in
           March". */
        cumulative: running,
        cumulativePct: agreed > 0 ? Math.round((running / agreed) * 100) : null,
      };
    });

  const plan = depositPlan(loi, agreed, payments);

  return {
    agreed,
    received,
    balance: agreed > 0 ? Math.max(agreed - received, 0) : null,
    pct: agreed > 0 ? Math.round((received / agreed) * 100) : null,
    settled: agreed > 0 && received >= agreed,
    count: instalments.length,
    instalments,
    /* The LOI's plan, when it has one: null means the LOI is silent about a
       split and only `instalments` above (what actually arrived) can be shown. */
    plan,
    advanceRent: num(rec?.values?.advance_rent) || null,
    /* An agreed figure is what makes every other number meaningful. Without
       it there is a list of payments and no way to say how far along it is. */
    agreedKnown: agreed > 0,
    /* What the LOI says, kept whether or not it is the figure being used, so
       the board can show the disagreement rather than pick a side silently. */
    loiAmount: loiAmount || null,
    formAmount: formAmount || null,
    disagrees,
    /* No Deposit Management form yet: the amount is known but there is
       nowhere for a payment to have been recorded. Worth saying out loud —
       "0% paid" and "nobody has opened the ledger" are different facts. */
    ledgerStarted: Boolean(rec),
    recordId: rec?._id || null,
    loiId: loi?._id || null,
  };
}

/**
 * The LOI's instalment plan, with what has actually arrived laid against it.
 *
 * The LOI says "two instalments, 50/50". Money then arrives in whatever
 * amounts it arrives in. Matching one against the other is the whole point:
 * it is what turns "₹15L received" into "instalment 1 paid, instalment 2
 * outstanding" — the sentence a project manager can act on.
 *
 * Payments are applied to the plan IN ORDER and by amount, not one payment
 * per instalment. A single ₹30L transfer settles both halves of a 50/50 plan;
 * three dribbles of ₹5L leave instalment 1 half paid. Anything received
 * beyond the plan is reported as `over` rather than silently dropped.
 *
 * The split is normalised so the parts always add to the agreed figure —
 * "30/40/30" of ₹1,00,001 cannot divide evenly, so the LAST instalment
 * absorbs the rounding rather than leaving a rupee unaccounted for.
 */
export function depositPlan(loi, agreed, payments = []) {
  const count = Math.floor(num(loi?.values?.deposit_instalments));
  if (!Number.isFinite(count) || count < 1 || count > 12) return null;

  /* "50/50", "30 / 40 / 30", "50-50" — however it was typed. A split that
     does not have one number per instalment is ignored in favour of an equal
     split rather than guessing which instalment the missing number was. */
  const parts = String(loi?.values?.deposit_split_pct || '')
    .split(/[^\d.]+/).filter(Boolean).map(Number)
    .filter((n) => Number.isFinite(n) && n > 0);
  const split = parts.length === count ? parts : Array.from({ length: count }, () => 100 / count);
  const total = split.reduce((a, b) => a + b, 0);
  const even = parts.length !== count;

  let allocated = 0;
  const rows = split.map((share, i) => {
    const pct = (share / total) * 100;
    const last = i === count - 1;
    const expected = agreed > 0
      ? (last ? agreed - allocated : Math.round((pct / 100) * agreed))
      : 0;
    allocated += expected;
    return {
      no: i + 1,
      pct: Math.round(pct * 10) / 10,
      /* What this instalment takes the project TO — the user's own way of
         reading it: "first one done → 50%, second one done → 100%". */
      cumulativePct: Math.round(((allocated / (agreed || allocated || 1)) * 100) * 10) / 10,
      expected,
      paid: 0,
      outstanding: expected,
      status: 'due',
      paidOn: null,
      payments: [],
    };
  });

  /* Walk the payments across the plan, filling each instalment before moving
     to the next. `paidOn` is the date the instalment was COMPLETED, which is
     the date that answers "when was instalment 2 settled". */
  let pool = payments
    .slice()
    .sort((a, b) => String(a.paidOn || a.at || '').localeCompare(String(b.paidOn || b.at || '')));
  for (const row of rows) {
    while (pool.length && row.paid < row.expected) {
      const p = pool[0];
      const left = row.expected - row.paid;
      const avail = num(p.amount) - num(p._used);
      const take = Math.min(left, avail);
      row.paid += take;
      row.payments.push({ amount: take, paidOn: p.paidOn || null, reference: str(p.reference) || null });
      p._used = num(p._used) + take;
      if (num(p._used) >= num(p.amount) - 0.5) { row.paidOn = p.paidOn || null; pool = pool.slice(1); }
      else break;
    }
    row.outstanding = Math.max(row.expected - row.paid, 0);
    row.status = row.expected > 0 && row.paid >= row.expected ? 'paid' : (row.paid > 0 ? 'part' : 'due');
    if (row.status !== 'paid') row.paidOn = null;
    else if (!row.paidOn) row.paidOn = row.payments[row.payments.length - 1]?.paidOn || null;
  }

  const usedTotal = rows.reduce((n, r) => n + r.paid, 0);
  const receivedTotal = payments.reduce((n, p) => n + num(p.amount), 0);
  /* The scratch marker must not leak out of this function. */
  payments.forEach((p) => { delete p._used; });

  const settledRows = rows.filter((r) => r.status === 'paid').length;
  return {
    count,
    /* True when the LOI named a count but no usable split, so these shares
       are this function's arithmetic rather than the document's. Said out
       loud on screen — an assumed split should not read as an agreed one. */
    evenSplit: even,
    instalments: rows,
    settled: settledRows,
    next: rows.find((r) => r.status !== 'paid') || null,
    over: Math.max(receivedTotal - usedTotal, 0),
  };
}

/**
 * How many things each phase actually has, and how many are done.
 *
 * A phase's progress is a count of REAL THINGS — 37 drawings, 7 BOQs, 4
 * assessments, 14 department sign-offs — not an abstract percentage and not a
 * count of tasks. "0 of 2 tasks" tells a project manager nothing; "24 of 37
 * drawings" tells them exactly what is left and roughly how long it will take.
 *
 * The NOUN comes from the stage's own `recordNoun`, so the board says
 * "properties", "drawings", "vendors", "BOQ items", "contracts", "roles"
 * without a word of it being written here. A template that adds a phase
 * tomorrow counts correctly with no code change.
 *
 * One aggregate for the whole project rather than a query per phase: a
 * 17-phase board would otherwise open with seventeen round trips.
 */
export async function getPhaseCounts(projectId) {
  const project = await Project.findById(projectId).select('stages.key stages.recordNoun stages.captureMode').lean();
  if (!project) throw new ApiError(404, 'Project not found');

  const rows = await Record.aggregate([
    { $match: { project: new mongoose.Types.ObjectId(String(projectId)) } },
    {
      $group: {
        _id: '$stageKey',
        total: { $sum: 1 },
        done: {
          $sum: {
            $cond: [{ $in: ['$status', [RECORD_STATUS.APPROVED, RECORD_STATUS.SHORTLISTED]] }, 1, 0],
          },
        },
        /* Rejected and archived rows are not progress, but they are not
           nothing either — a phase with six rejected drawings is a phase in
           trouble, and hiding them would make it look untouched. */
        rejected: { $sum: { $cond: [{ $eq: ['$status', RECORD_STATUS.REJECTED] }, 1, 0] } },
      },
    },
  ]);

  const byStage = new Map(rows.map((r) => [r._id, r]));
  const out = {};
  for (const s of project.stages || []) {
    const hit = byStage.get(s.key);
    const total = hit?.total || 0;
    out[s.key] = {
      total,
      done: hit?.done || 0,
      rejected: hit?.rejected || 0,
      /* Said once, here, so every screen says it the same way. */
      noun: nounFor(str(s.recordNoun) || 'record', total),
    };
  }
  return out;
}

/**
 * A record noun, in the right number and the right case.
 *
 * Two things a naive `noun.toLowerCase() + 's'` gets wrong, and both were
 * visible on the board within a minute of it shipping:
 *
 *   "Property"  → "propertys"   — consonant + y takes -ies
 *   "BOQ Item"  → "boq items"   — an acronym is not a word to lowercase
 *
 * So only ordinary Capitalised words are lowered; a token that is all capitals
 * keeps them. Nothing here is a list of nouns — the noun comes from the
 * template, and this only has to inflect whatever it is given.
 */
export function nounFor(noun, count) {
  const cased = noun
    .split(/\s+/)
    .map((w) => (w === w.toUpperCase() && /[A-Z]/.test(w) ? w : w.toLowerCase()))
    .join(' ');
  if (count === 1) return cased;

  const head = cased.slice(0, -1);
  const last = cased.slice(-1);
  if (last === 'y' && !/[aeiou]/i.test(cased.slice(-2, -1))) return `${head}ies`;
  if (/(s|x|z|ch|sh)$/i.test(cased)) return `${cased}es`;
  return `${cased}s`;
}

/* ══════════════════════════════════════════════════════════════════════
   Everything at once — one call for the flow board
   ══════════════════════════════════════════════════════════════════════ */

export async function getFlow(projectId) {
  const project = await requireProject(projectId);
  const [drawingRecords, vendorRecords, lines, contractRecords] = await Promise.all([
    rowsFor(projectId, STAGE.DRAWINGS),
    rowsFor(projectId, STAGE.VENDORS),
    rowsFor(projectId, STAGE.BOQ),
    rowsFor(projectId, STAGE.CONTRACTS),
  ]);

  const drawingRows = mergeDrawings(drawingRecords);
  const drawings = drawingSummary(drawingRows);
  const panel = summarisePanel(vendorRecords);
  const boq = summariseBoqs(lines);
  const contracts = summariseContracts(contractRecords);
  const orders = orderability(lines, contracts);
  const phaseCounts = await getPhaseCounts(projectId);
  const deposit = await getDeposit(projectId);

  return {
    project,
    drawings: { ...drawings, rows: drawingRows },
    panel,
    boq: {
      ...boq,
      inputs: {
        quantitiesReady: drawings.boqUnlocked,
        blockingDrawings: drawings.blocking,
        ratesReady: panel.ratesReady,
        missingRates: panel.missing,
        canStart: drawings.boqUnlocked && panel.ratesReady,
      },
    },
    contracts,
    orders,
    phaseCounts,
    deposit,
    /** The five rules of PMS_UI_SPEC_00 §3 that have a computable answer. */
    rules: {
      set1UnlocksBoq: drawings.boqUnlocked,
      quantitiesAndRates: drawings.boqUnlocked && panel.ratesReady,
      nothingOrderedWithoutContract: orders.blocked === 0,
    },
  };
}

export const flowService = {
  getFlow,
  getDrawings,
  getPanel,
  getPanelBoard,
  getRateCard,
  getBoq,
  getContracts,
  getOrderability,
  getPhaseCounts,
  getDeposit,
  assertOrderable,
  assertMayRaisePurchaseOrder,
  contractRuleApplies,
};

export default flowService;
