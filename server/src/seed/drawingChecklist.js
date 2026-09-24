/**
 * The Drawing Checklist Master — PMS_UI_SPEC_03 §1.
 *
 * Thirty-seven drawings in nine categories, split into two sets. This is a
 * COMPANY MASTER, not project data: the same 37 rows apply to every branch, so
 * they live here rather than being typed in per project.
 *
 * ── Why a checklist and not an upload list (Spec 00 §1, fix F-1) ──────
 * The old Phase 4 was a flat list of whatever the architect happened to
 * upload, with a free-text "drawing type". That can say what arrived; it can
 * never say what is MISSING — and "what is still missing" is the only question
 * this phase exists to answer, because the BOQ cannot start without it.
 *
 * So the checklist is the deliverable. All 37 rows are present on every
 * project from the first day, at "not started"; an upload fills a row in,
 * it does not create one.
 *
 * ── The two sets ─────────────────────────────────────────────────────
 * SET 1 (29 drawings) is what quantities are extracted from, so the BOQ waits
 * for it — that is the hard dependency between design and ordering, and the
 * only one. SET 2 (8 drawings — wall finishes, the 3D reception, the four
 * coordination sets) is needed for execution, not for counting, so it blocks
 * NOTHING and runs on into the build.
 *
 * Getting that split wrong in either direction is expensive: put a Set 2
 * drawing in Set 1 and the BOQ is held up for a finish schedule nobody is
 * counting; put a Set 1 drawing in Set 2 and quantities are extracted from an
 * incomplete set.
 */

/** The nine categories, in the order the master lists them. */
export const DRAWING_CATEGORIES = Object.freeze([
  'Architectural',
  'Electrical',
  'Electronic',
  'Automation',
  'Fire Fighting',
  'HVAC',
  'Plumbing',
  'Reception',
  'Coordination',
]);

export const DRAWING_SETS = Object.freeze(['Set 1', 'Set 2']);

/**
 * Where a drawing has got to. Deliberately four states and no more — a
 * checklist that offers ten shades of "nearly" stops being answerable at a
 * glance, which is the whole point of it.
 *
 * Only `Approved` counts towards the Set 1 gate. "Submitted" means the
 * architect has sent it; it is not the same as somebody having checked it,
 * and quantities must never be extracted from a drawing nobody has reviewed.
 */
export const DRAWING_STATUSES = Object.freeze([
  'Not started',
  'In progress',
  'Submitted for review',
  'Approved',
]);

export const DRAWING_STATUS_APPROVED = 'Approved';

/** [no, category, name, set] — transcribed from the client's own sheet. */
const ROWS = [
  [1, 'Architectural', 'Floor layout plan with furniture', 1],
  [2, 'Architectural', 'Partition Layout plan with door details', 1],
  [3, 'Architectural', 'Door schedule (Normal / Hidden / Tunnel Doors)', 1],
  [4, 'Architectural', 'Mezzanine floor plan with its LVL from FFL', 1],
  [5, 'Architectural', 'Furniture and Prop on-site making drawing', 1],
  [6, 'Architectural', 'Wall panelling drawings', 2],
  [7, 'Architectural', '4-Wall open layout drawing of all game rooms', 1],
  [8, 'Architectural', 'Ceiling layout', 1],
  [9, 'Architectural', 'Wall finish layout', 2],
  [10, 'Architectural', 'Tile / Floor finish layout', 1],
  [11, 'Electrical', 'Electrical Layout Plan', 1],
  [12, 'Electrical', 'Reset Light Layout', 1],
  [13, 'Electrical', 'Control Box Layout', 1],
  [14, 'Electrical', 'Electrical Looping Diagram', 1],
  [15, 'Electrical', 'AC/DC Single line diagram (220V / 12V)', 1],
  [16, 'Electrical', 'Main Line Single Line Diagram', 1],
  [17, 'Electrical', 'Distribution Board (DB) Layout', 1],
  [18, 'Electrical', 'Server room Layout', 1],
  [19, 'Electronic', 'Sensor layout (RFID / Switches)', 1],
  [20, 'Electronic', 'RFID / Sensor Wiring Layout', 1],
  [21, 'Electronic', 'Game Control System Layout', 1],
  [22, 'Automation', 'Audio Speaker Layout', 1],
  [23, 'Automation', 'CCTV Layout', 1],
  [24, 'Automation', 'Network Layout (LAN / CAT-6)', 1],
  [25, 'Fire Fighting', 'Sprinkler and Pipe Layout', 1],
  [26, 'Fire Fighting', 'Fire Detection Layout (Smoke detector, MCP & Hooter)', 1],
  [27, 'HVAC', 'Duct and Diffuser Layout', 1],
  [28, 'HVAC', 'Diffuser Layout', 1],
  [29, 'HVAC', 'Equipment Layout', 1],
  [30, 'HVAC', 'Heat Load Sheet', 1],
  [31, 'Plumbing', 'Drainage Layout', 1],
  [32, 'Reception', '3D Drawing of Reception', 2],
  /**
   * Row 33's label is cut off in the client's sheet as "Working Drawing for".
   * It sits in the Reception block, so "Reception" is the reading — but it is
   * a READING, not the client's word, and it is open question Q-1 in
   * PMS_UI_SPEC_03 §7. Marked so the UI can say so rather than presenting a
   * guess as if it were the master.
   */
  [33, 'Reception', 'Working Drawing for Reception', 2, { unconfirmed: true }],
  [34, 'Coordination', 'Architectural / Drawings Set', 2],
  [35, 'Coordination', 'Electrical Drawings Set', 2],
  [36, 'Coordination', 'Fire Fighting & Alarm Drawings Set', 2],
  [37, 'Coordination', 'HVAC Drawings Set', 2],
];

/**
 * The master, as objects. `no` is the stable identity of a row — a record
 * carries it in `values.drawing_no`, which is how an upload is matched back to
 * its checklist line. Never renumber these.
 */
export const DRAWING_CHECKLIST = Object.freeze(
  ROWS.map(([no, category, name, set, extra]) => Object.freeze({
    no,
    category,
    name,
    set,
    setLabel: `Set ${set}`,
    /* Set 1 is the gate. This is stored rather than derived at each call site
       so that "does this drawing block the BOQ?" has exactly one answer. */
    blocksBoq: set === 1,
    ...(extra || {}),
  })),
);

export const DRAWING_SET_1 = DRAWING_CHECKLIST.filter((d) => d.set === 1);
export const DRAWING_SET_2 = DRAWING_CHECKLIST.filter((d) => d.set === 2);

/** Drawing names, for the checklist field's `options`. */
export const DRAWING_NAMES = DRAWING_CHECKLIST.map((d) => d.name);

export function drawingByNo(no) {
  return DRAWING_CHECKLIST.find((d) => d.no === Number(no)) || null;
}

export default DRAWING_CHECKLIST;
