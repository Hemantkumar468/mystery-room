/**
 * The BOQ Master — PMS_UI_SPEC_03 §2, and fix F-2 of PMS_UI_SPEC_00 §1.
 *
 * ── Why six and not one (fix F-2) ────────────────────────────────────
 * The old Phase 5 held one flat BOQ list. The business works from six
 * documents with different owners, vendors and timelines, each approved on
 * its own. The contractor's work is a contract, not an automatically created
 * BOQ, so it is intentionally excluded here.
 *
 * ── Why the BOQ is not the trade ─────────────────────────────────────
 * A BOQ is a DOCUMENT, not a category. One BOQ carries lines of many trades,
 * and two of the seven ("All games furniture", "Common area furniture") are
 * the SAME trade. So `category` cannot stand in for it, and deriving one from
 * the other would merge two BOQs that must stay apart. That is why lines carry
 * their own `boq_type`.
 *
 * ── The three streams ────────────────────────────────────────────────
 * Seven sheets, but only three kinds of work, and each kind is handed to a
 * different track. That is what the BOQ actually splits into, and it is what
 * decides where a line goes after approval:
 *
 *   construction → built on site by the local contractor → Site Execution
 *   furniture    → made to drawing at the Delhi facility → production, Assembly
 *   procurement  → bought in from panel vendors          → Purchase Orders
 */

/** The six operational BOQs, in the order the business lists them. */
export const BOQ_TYPES = Object.freeze([
  'All games furniture BOQ',
  'All games electronic BOQ',
  'All games cameras BOQ',
  'All games speaker BOQ',
  'Common area furniture BOQ',
  'Procurement BOQ of all games',
]);

export const BOQ_STREAMS = Object.freeze({
  CONSTRUCTION: 'construction',
  FURNITURE: 'furniture',
  PROCUREMENT: 'procurement',
});

export const BOQ_STREAM_META = Object.freeze([
  {
    key: BOQ_STREAMS.CONSTRUCTION,
    label: 'Construction',
    what: 'the local contractor builds it on site',
    goesTo: 'Site Execution',
  },
  {
    key: BOQ_STREAMS.FURNITURE,
    label: 'Furniture',
    what: 'made to drawing at the Delhi facility',
    goesTo: 'Delhi production, then Assembly',
  },
  {
    key: BOQ_STREAMS.PROCUREMENT,
    label: 'Procurement',
    what: 'bought in from panel vendors',
    goesTo: 'Purchase Orders, then Assembly',
  },
]);

/**
 * The six BOQs with the vendor category each maps onto.
 *
 * The one-to-one mapping between a BOQ and a vendor category in Phase 6 is
 * what makes the chain work: a category with no vendor confirmed produces a
 * BOQ with no rates, and the BOQ workspace can say so by name instead of
 * showing an empty total.
 *
 * `share` is the indicative share of spend from the client's own walkthrough.
 * It is a PLANNING figure for the empty state only — once lines exist, every
 * total on screen is summed from the lines themselves and this is not used.
 */
export const BOQ_MASTER = Object.freeze([
  {
    no: 1,
    name: 'All games furniture BOQ',
    stream: BOQ_STREAMS.FURNITURE,
    vendorCategory: 'Games Furniture (panel)',
    supply: 'Delhi stock + production',
    share: 20,
    covers: 'Props, sets, custom furniture per game',
  },
  {
    no: 2,
    name: 'All games electronic BOQ',
    stream: BOQ_STREAMS.PROCUREMENT,
    vendorCategory: 'Games Electronic (internal)',
    supply: 'Delhi production',
    share: 14,
    covers: 'Sensors, RFID, control boxes, game logic',
  },
  {
    no: 3,
    name: 'All games cameras BOQ',
    stream: BOQ_STREAMS.PROCUREMENT,
    vendorCategory: 'Games Cameras (panel)',
    supply: 'Outside procurement',
    share: 4,
    covers: 'CCTV, game cameras, DVR/NVR',
  },
  {
    no: 4,
    name: 'All games speaker BOQ',
    stream: BOQ_STREAMS.PROCUREMENT,
    vendorCategory: 'Games Speaker (panel)',
    supply: 'Outside procurement',
    share: 3,
    covers: 'Audio, amplifiers, speaker runs',
  },
  {
    no: 5,
    name: 'Common area furniture BOQ',
    stream: BOQ_STREAMS.FURNITURE,
    vendorCategory: 'Games Furniture (panel)',
    supply: 'Outside procurement',
    share: 7,
    covers: 'Reception, waiting, lockers, briefing room',
  },
  {
    no: 6,
    name: 'Procurement BOQ of all games',
    stream: BOQ_STREAMS.PROCUREMENT,
    vendorCategory: 'MR Central Facility (internal)',
    supply: 'Delhi stock + production',
    share: 8,
    covers: 'Everything drawn from or produced by the central facility',
  },
]);

/** The seven vendor categories Phase 6 must confirm a team and a rate for. */
export const VENDOR_CATEGORIES = Object.freeze(
  [...new Set(BOQ_MASTER.map((b) => b.vendorCategory))],
);

/**
 * Source of supply — fix F-5, and the addition the client's flow demands.
 *
 * A BOQ line is not automatically an order. Much of what a branch needs
 * already exists in Delhi, and issuing a purchase order for stock the company
 * is holding is how you buy the same thing twice.
 *
 *   Delhi stock       → earmarked. NEVER becomes a PO.
 *   Delhi production  → enters the 20–25 day production queue. No vendor PO.
 *   Outside procurement → a real GST purchase order, against a signed contract.
 */
export const SOURCE_OF_SUPPLY = Object.freeze({
  STOCK: 'Delhi stock',
  PRODUCTION: 'Delhi production',
  PROCURE: 'Outside procurement',
});

export const SOURCE_OF_SUPPLY_VALUES = Object.freeze(Object.values(SOURCE_OF_SUPPLY));

/** Only this one ever produces a vendor purchase order. */
export function needsPurchaseOrder(source) {
  return source === SOURCE_OF_SUPPLY.PROCURE;
}

export function boqByName(name) {
  return BOQ_MASTER.find((b) => b.name === name) || null;
}

export function streamOf(boqName) {
  return boqByName(boqName)?.stream || null;
}

export default BOQ_MASTER;
