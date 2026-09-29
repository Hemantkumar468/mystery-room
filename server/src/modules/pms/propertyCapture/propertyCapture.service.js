import { FranchiseEnquiry } from '../franchise/franchiseEnquiry.model.js';
import { Record } from '../records/record.model.js';
import { Project } from '../projects/project.model.js';
import { Task } from '../tasks/task.model.js';
import { recordService } from '../records/record.service.js';
import { franchiseService } from '../franchise/franchise.service.js';
import { ApiError } from '../../../core/utils/ApiError.js';
import { PROJECT_STATUS, RECORD_STATUS, TASK_STATUS } from '../../../core/constants/index.js';
import { logger } from '../../../config/logger.js';

/**
 * Property capture — one queue for every property the business is looking at,
 * whatever door it came in through.
 *
 * WHY THIS IS A READ MODEL AND NOT A NEW COLLECTION. The client's flow calls
 * for "one common property record" that four different intakes feed. That
 * record already exists: a Phase 1 (`p1`) Record. The franchise decision
 * already files an applicant's properties as p1 records, and our own scouting
 * files them there too. Adding a `PropertyCapture` table would mean the same
 * property in two places, drifting apart the first time somebody edited one —
 * and every downstream phase (assessment, LOI, the whole project) reads p1.
 * So this module OWNS NO DATA. It unions the four intakes into one row shape
 * and gives that row the two actions the client asked for.
 *
 * THE FOUR INTAKES, in the client's own terms:
 *
 *  'franchise' — a franchisee applied through the franchise link AND sent
 *      properties. Rows come straight off the enquiry, before any decision:
 *      the MD can act on the property here without first approving the lead.
 *  'broker'    — a broker or partner submitted a property through the open
 *      property link. Same submission shape, different intent, so it is the
 *      same model with `source: 'broker'` (see franchiseEnquiry.model.js).
 *  'demand'    — somebody wants a store in a city but has no property yet.
 *      Two things produce this: a franchise applicant who ticked "interested,
 *      no property", and the MD pressing New Project for a city. Both are a
 *      standing ASK, not a property, and the queue shows them as such — this
 *      is the case the client specifically asked not to be dropped.
 *  'captured'  — already a p1 record on a project. The rows the pipeline
 *      actually moves through assessment and commercial closure.
 *
 * WHAT A ROW IS NOT. It is not a status machine of its own. `stage` below is
 * read off the record's real status and its real child assessments, so this
 * page can never claim a property is somewhere the project does not agree it
 * is.
 */

/* The four Site Evaluation assessments a property can be sent through. Keys
   match p2's `assessmentTypes` in storeLaunchTemplate.js — the MD picks any
   subset, which is the "for which assessment?" question in the client's flow. */
export const ASSESSMENTS = Object.freeze([
  { key: 'feasibility', label: 'Feasibility' },
  { key: 'financial', label: 'Financial' },
  { key: 'technical', label: 'Technical' },
  { key: 'operational', label: 'Operational' },
]);

/**
 * The six documents commercial closure has to produce, in the order they are
 * actually worked. Keys match p3's `assessmentTypes` in storeLaunchTemplate.js.
 *
 * `project_creation` is deliberately NOT one of them: it is the handover that
 * happens once the six are done, not a document somebody files. Step 3 counts
 * completion out of six, and counting it out of seven would mean the bar never
 * reaches full until the project had already started.
 */
export const DOCUMENTS = Object.freeze([
  { key: 'loi', label: 'LOI' },
  { key: 'lease', label: 'Lease Agreement' },
  { key: 'legal', label: 'Legal Check' },
  { key: 'deposit', label: 'Deposit' },
  { key: 'nocs', label: 'NOCs' },
  { key: 'approvals', label: 'Approvals' },
]);

const ASSESSMENT_KEYS = new Set(ASSESSMENTS.map((a) => a.key));
const DOCUMENT_KEYS = new Set(DOCUMENTS.map((d) => d.key));

/** A filed document/assessment counts as done once it is past draft. */
const isDone = (status) => status === RECORD_STATUS.APPROVED || status === RECORD_STATUS.LOCKED;
const isFiled = (status) => status && status !== RECORD_STATUS.DRAFT;
const LIVE = [PROJECT_STATUS.PLANNING, PROJECT_STATUS.ACTIVE, PROJECT_STATUS.ON_HOLD];

const str = (v) => String(v ?? '').trim();

/**
 * Everything attached to a property, in one shape whatever door it came in
 * through.
 *
 * A franchisee's submission carries `photos`/`videos`/`documents`/`driveLinks`
 * on the enquiry; once it is filed as a p1 record those land in `values` as
 * `photos`/`videos`/`documents`/`drive_links`, plus `audio` which only the
 * in-app capture produces. Normalising here means the page has ONE thing to
 * render instead of knowing which of the two it is looking at.
 *
 * A Drive link is a bare string, not a `{ url, name }` — kept as a link with
 * its own label rather than coerced into a file it is not.
 */
const asFiles = (list, kind) => (Array.isArray(list) ? list : [])
  .map((f) => (typeof f === 'string'
    ? { url: f, name: '', kind }
    : { url: f?.url || '', name: f?.name || '', kind }))
  .filter((f) => f.url);

function mediaOf({ photos, videos, documents, driveLinks, audio }) {
  const files = [
    ...asFiles(photos, 'photo'),
    ...asFiles(videos, 'video'),
    ...asFiles(documents, 'document'),
    ...asFiles(audio, 'audio'),
    ...asFiles(driveLinks, 'link'),
  ];
  return {
    files,
    counts: {
      photo: files.filter((f) => f.kind === 'photo').length,
      video: files.filter((f) => f.kind === 'video').length,
      document: files.filter((f) => f.kind === 'document').length,
      audio: files.filter((f) => f.kind === 'audio').length,
      link: files.filter((f) => f.kind === 'link').length,
      total: files.length,
    },
  };
}

/**
 * Rank a record's status so two of the same document can be compared.
 *
 * A property CAN legitimately carry more than one record of a type — an LOI
 * that was superseded, a lease redrafted — and counting them all is how the
 * page came to report "11 of 6 documents filed", which is nonsense on its face
 * and quietly wrong in the progress bar beside it. One row per type, and the
 * one that survives is the furthest along: a signed lease is the truth about
 * the lease even if an abandoned draft of it still exists.
 */
const STATUS_RANK = {
  [RECORD_STATUS.DRAFT]: 0,
  [RECORD_STATUS.SUBMITTED]: 1,
  [RECORD_STATUS.EVALUATION_IN_PROGRESS]: 2,
  [RECORD_STATUS.REJECTED]: 1,
  [RECORD_STATUS.SHORTLISTED]: 3,
  [RECORD_STATUS.APPROVED]: 4,
  [RECORD_STATUS.LOCKED]: 5,
};

/**
 * The fields each assessment's answer is READ from, on the queue.
 *
 * A WHITELIST, and a deliberately small one. The queue shows a score and one
 * telling figure per assessment; it does not show the form. Sending whole
 * `values` objects would put every textarea, every uploaded document array and
 * every doer's note on the wire for twenty-five rows at a time to render two
 * numbers.
 *
 * The first group in each list is exactly what the SCORERS read
 * (`client/src/features/projects/records/scoring.js` — `feasibilityPercent`
 * and friends); the rest is the one figure worth printing under the score.
 * Keeping them in step matters: a field dropped from here silently lowers a
 * score rather than failing, because a scorer averages the parts it can find.
 */
/**
 * WIDENED TO WHAT STEP 3 ACTUALLY DRAWS — and it must stay that way.
 *
 * This list used to hold the five or six fields the SCORE needed. Step 3 then
 * grew a column for every short answer and a "See more" dialog for every long
 * one (client/src/features/property/assessmentFields.js), and nobody widened
 * this. The result was a sheet that looked broken without being broken: a
 * feasibility assessment with ten answers filed against it arrived here
 * carrying five, so Target audience, Competitor analysis, Risk factors,
 * Remarks and the doer's Notes printed "—" on every row, and the dialog that
 * exists to show exactly those paragraphs had nothing to show.
 *
 * THE TWO LISTS ARE ONE LIST. Every key below is in `COLUMN_FIELDS` or
 * `LONG_FIELDS` on the client, and vice versa. Adding a column there without
 * adding its key here does not fail — it silently prints a dash, which is
 * indistinguishable from an answer nobody gave. If you touch one, touch both.
 *
 * ON SIZE, which is why it was narrow to begin with: these are still only the
 * fields the step renders, not the whole `values` object. Attachments, audio
 * and anything the forms gain later stay off the wire until something asks to
 * display them.
 */
const ASSESSMENT_VALUE_FIELDS = {
  feasibility: [
    'purpose',
    'market_potential', 'footfall_assessment', 'accessibility', 'target_audience', 'expansion_potential',
    'competitor_analysis', 'risk_factors', 'remarks', 'notes',
  ],
  financial: [
    'purpose',
    'estimated_investment', 'monthly_revenue', 'roi', 'payback_period', 'capex', 'opex',
    'profit_margin', 'financial_risk',
    'financial_remarks', 'notes',
  ],
  technical: [
    'purpose',
    'building_condition', 'civil_condition', 'electrical_capacity', 'hvac',
    'water_supply', 'internet_availability', 'fire_safety', 'parking',
    'maintenance', 'structural_assessment', 'technical_remarks', 'notes',
  ],
  operational: [
    'purpose',
    'staff_requirement', 'operating_hours', 'operations_readiness', 'security',
    'inventory', 'training', 'utility_availability', 'vendor_availability',
    'customer_flow', 'operational_risks', 'operational_remarks', 'notes',
  ],
};

/**
 * WHAT EACH COMMERCIAL DOCUMENT IS READ FOR.
 *
 * Closure is six documents and the queue reported six words: filed, or not.
 * Whether the LOI expires on Friday, when the lease runs to, which NOC lapses
 * next month - all of it was inside the forms, and the only way to find out was
 * to open all six on every property. The dates are the whole reason somebody
 * is on this screen.
 *
 * Only the fields the sheet shows. A document's full form stays where it is
 * filled; this is what a queue has to be able to say about it without being
 * opened.
 */
/**
 * WRITTEN AGAINST THE FORMS, and it had drifted badly.
 *
 * Three faults, all of which made a filed document look untouched on Step 5:
 *
 *  - THE UPLOADS WERE NEVER SENT. Every one of these forms keeps its file in
 *    a VALUE (`documents`, `lease_document`, `noc_document`,
 *    `approval_document`, `payment_proof`), not in `attachments` — and not
 *    one of them was on this list. So the Uploaded column read an object the
 *    server had already stripped and printed "None" for every document on
 *    every property, including ones with a signed lease behind them. The
 *    column closure exists to answer could not answer it.
 *
 *  - DEPOSIT NAMED THE WRONG FORM ENTIRELY. `deposit`, `available_from`,
 *    `lease_amount`, `lease_duration`, `owner_name` are Phase 1 PROPERTY
 *    fields. The deposit document asks for `security_deposit`,
 *    `advance_rent`, `payment_mode`, `transaction_number`, `payment_date`
 *    and `payment_proof`, so every deposit row was blank by construction.
 *
 *  - LEGAL DROPPED THE ONE FIELD PEOPLE FILL. `property_ownership` is the
 *    first question on that form and was not on the wire.
 *
 * THE RULE: a key belongs here if Step 5 renders it — see DATES, DETAIL and
 * `attachmentsOf` in PropertyCommercialPage.jsx. Adding a column there
 * without adding its key here does not fail; it prints a dash, which is
 * indistinguishable from work nobody has done.
 */
const DOCUMENT_VALUE_FIELDS = {
  loi: ['loi_number', 'loi_date', 'valid_until', 'proposed_rent', 'deposit_amount',
    'lockin_period_months', 'documents'],
  lease: ['lease_start_date', 'lease_end_date', 'renewal_option', 'stamp_duty',
    'registration_details', 'lease_document'],
  legal: ['property_ownership', 'title_verification', 'encumbrance_check', 'litigation_status',
    'legal_opinion', 'advocate_name', 'verification_date', 'documents'],
  deposit: ['security_deposit', 'advance_rent', 'payment_mode', 'transaction_number',
    'payment_date', 'payment_proof'],
  nocs: ['noc_type', 'expiry_date', 'noc_document'],
  approvals: ['approval_level', 'approval_document'],
};

/** Just the named fields, and only the ones that were actually answered. */
function pickValues(values, fields) {
  if (!values || !fields) return undefined;
  const out = {};
  for (const f of fields) {
    const v = values[f];
    if (v !== undefined && v !== null && v !== '') out[f] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** One entry per declared type, taking the furthest-along record of each. */
function bestPerType(children, stageKey, allowedKeys, valueFields = null) {
  const best = new Map();
  for (const c of children) {
    if (c.stageKey !== stageKey || !allowedKeys.has(c.assessmentType)) continue;
    const current = best.get(c.assessmentType);
    const rank = STATUS_RANK[c.status] ?? 0;
    if (!current || rank > current.rank) {
      best.set(c.assessmentType, {
        type: c.assessmentType,
        status: c.status,
        id: String(c._id),
        /* Only once it is past draft: an unfinished form has no answer to
           report, and half-entered values would score as though they were
           somebody's verdict. */
        /* WHO ANSWERED IT AND WHEN — on every filed child, assessment or
           document alike. It used to ride along only where `valueFields` was
           passed, which meant the six commercial documents could say they were
           filed but never by whom: the one question asked of a signed LOI. */
        ...(isFiled(c.status)
          ? {
            by: str(c.submittedBy?.name) || null,
            at: c.submittedAt || null,
          }
          : {}),
        ...(valueFields && isFiled(c.status)
          ? { values: pickValues(c.values, valueFields[c.assessmentType]) }
          : {}),
        /**
         * ITS OWN ATTACHMENTS, NOT THE PROPERTY'S.
         *
         * Every assessment form has Documents and Audio fields of its own, and
         * people have been filling them in - the survey photos went on the
         * feasibility form, the quotes on the financial one. None of it ever
         * reached the queue: the row carried one Files column built from the
         * PROPERTY's media, so four sets of evidence collapsed into a column
         * that did not contain any of them, and the only way to see what an
         * assessor had attached was to open their form.
         *
         * Only attached when there is something to attach, so a queue of
         * filed-but-empty assessments does not grow a `media` object each.
         */
        ...(() => {
          if (!isFiled(c.status)) return {};
          const media = mediaOf({
            photos: c.values?.photos,
            videos: c.values?.videos,
            documents: c.values?.documents,
            audio: c.values?.audio,
            driveLinks: c.values?.drive_links,
          });
          return media.files.length ? { media } : {};
        })(),
        rank,
      });
    }
  }
  return [...best.values()].map(({ rank, ...rest }) => rest);
}

/**
 * Open a set of child forms under a property — the p2 assessments it was
 * routed to, or the p3 documents commercial closure has to produce.
 *
 * ONE HELPER FOR BOTH, because they are the same act: a decision says which
 * forms this property now needs, and this opens exactly those. They were two
 * near-identical loops, and the copies had already drifted — skipping
 * assessment shortlisted a property to commercial closure WITHOUT opening its
 * six documents, so Step 3 showed it as 0/6 with six identical Start buttons,
 * while the same property arriving via Step 2's shortlist got all six.
 *
 * IDEMPOTENT ON TYPE: asking twice for Feasibility does not create a second
 * Feasibility form. Somebody pressing a button again because they were not
 * sure it registered is not a data-entry event.
 *
 * DRAFT, NOT SUBMITTED: `recordService.create` validates required fields on a
 * submitted record, and a form nobody has filled in yet has none of them —
 * opening the form IS the point.
 *
 * BEST-EFFORT PER TYPE: one form failing must not undo the decision that asked
 * for it. The decision is the important half and is already recorded; a form
 * that did not open shows on its step as "Start", which is where it would have
 * been anyway, so the worst case is a button rather than a broken row.
 */
async function openChildForms(record, stageKey, types, userId) {
  const existing = await Record.find({ parentRecordId: record._id, stageKey })
    .select('assessmentType').lean();
  const already = new Set(existing.map((r) => r.assessmentType));

  const created = [];
  for (const type of types) {
    if (already.has(type)) continue;
    try {
      const made = await recordService.create({
        projectId: record.project,
        stageKey,
        assessmentType: type,
        parentRecordId: record._id,
        status: RECORD_STATUS.DRAFT,
        values: {},
      }, userId);
      created.push({ type, id: String(made._id) });
    } catch (err) {
      logger.warn(`Could not open ${stageKey}/${type} for property ${record._id}: ${err.message}`);
    }
  }
  return created;
}

/** Every document commercial closure has to produce, as form keys. */
const DOCUMENT_KEY_LIST = DOCUMENTS.map((d) => d.key);

/**
 * The three roads out of Property Capture — the one decision Step 2 exists to
 * take, in the MD's own words: where does this property START?
 *
 *   assessment  the four Site Evaluations (any subset) open on it
 *   commercial  no assessment; the six closure documents open instead
 *   project     the six documents open AND the property is approved, so
 *               games and dates can be planned while closure runs
 *
 * `project` is the road the client asked for and the one worth reading twice.
 * It does NOT mean the paperwork is cancelled — a store still cannot open on a
 * site with no lease. It means nobody is waiting on the paperwork before
 * planning the build, so BOTH start at once: the six documents open as drafts
 * exactly as they would on the commercial road, and the property is approved
 * as well, which is what puts it in front of Project & Games. This road adds
 * a step; it never skips one.
 */
export const ROADS = Object.freeze(['assessment', 'commercial', 'project']);

/**
 * Who is doing a step's work, by when, and whether that is still realistic —
 * built from the real Task documents so it can never disagree with My Tasks.
 *
 * WHY A DERIVED SUMMARY AND NOT THE TASKS THEMSELVES. Assessment can be up to
 * four tasks (one per chosen type, each its own assignee), commercial closure
 * is five, and a row on this queue has room for one date and one name. So the
 * PLAN DATE is the latest `plannedEnd` among them — the date the step, as a
 * whole, is due — and the ASSIGNEES are everyone named across those tasks,
 * deduplicated. Two people sharing a step is normal (Legal does the lease
 * while Finance does the deposit); the column names both rather than picking
 * one and hiding the other.
 *
 * WHY RED/GREEN AND HOW IT IS DECIDED. Reusing `completedOnTime` — the same
 * flag My Tasks and MIS already snapshot at completion — rather than a second
 * rule that could disagree with it:
 *   done, none of them finished late   → green ("done_ontime")
 *   done, at least one finished late   → red   ("done_late")
 *   not done, past the plan date       → red   ("delayed")
 *   not done, still within the plan    → green ("ontime")
 *   no tasks yet (nothing to plan)     → null — the column stays blank rather
 *                                         than asserting a status about work
 *                                         that has not been assigned.
 */
/**
 * The four assessments as FOUR SLOTS, whether or not each one exists yet.
 *
 * WHY SLOTS AND NOT JUST THE RECORDS. The phase HAS four assessments; a
 * property simply has not been sent down all of them yet. Reporting only the
 * ones that exist meant a property routed to one read "1/1 — complete" beside
 * a property routed to four reading "1/4", and the two looked equally done.
 * Four slots, always, and each says its own state.
 *
 * WHO DOES EACH ONE comes off the real Task for that assessment — four tasks,
 * four assignees, which is how the template describes the step (a Feasibility
 * Expert, a Finance Expert, a Technical Expert, an Operations Expert). Who
 * FILED it is separate and comes off the record: the person who answered the
 * form is not always the person it was assigned to, and when they differ that
 * is worth seeing rather than smoothing over.
 */
/**
 * DOCUMENTS SUBMITTED AND WAITING ON SOMEBODY.
 *
 * A doer fills the LOI and submits it; from that moment it is not their work
 * any more and not yet anybody else's, and until it is approved nothing
 * downstream can rely on it. The queue had no way to ask "what is sitting in
 * my in-tray" - closure reported six-of-six filed while every one of the six
 * was still unapproved, which reads as finished and is not.
 *
 * `submitted` is the count that drives the new step: filed by its doer, not
 * yet approved or turned back.
 */
function docReviewCounts(documents) {
  let submitted = 0;
  let approved = 0;
  let rejected = 0;
  for (const d of documents) {
    if (d.status === RECORD_STATUS.APPROVED || d.status === RECORD_STATUS.LOCKED) approved += 1;
    else if (d.status === RECORD_STATUS.REJECTED) rejected += 1;
    else if (isFiled(d.status)) submitted += 1;
  }
  return { submitted, approved, rejected };
}

/**
 * THE SIX DOCUMENTS AS SIX SLOTS, whether or not each one exists yet.
 *
 * The same shape and the same reason as `assessmentSlots`: a document nobody
 * has filed still has somebody it is waiting on and a date it is wanted by,
 * and reporting only the ones that exist left the queue unable to say who to
 * chase. Who each one is FOR comes off the real p3 task; who filed it comes
 * off the record, and when those differ that is worth seeing.
 */
function documentSlots(documents, tasks) {
  const byType = new Map(documents.map((d) => [d.type, d]));
  const taskFor = (key) => (tasks || []).find((t) => new RegExp(`\\b${key}\\b`, 'i').test(str(t.title)));

  return DOCUMENTS.map(({ key, label }) => {
    const record = byType.get(key) || null;
    const task = taskFor(key);
    return {
      type: key,
      label,
      state: record ? (isFiled(record.status) ? 'filed' : 'open') : 'not_started',
      status: record?.status || null,
      recordId: record?.id || null,
      filedBy: record?.by || null,
      filedAt: record?.at || null,
      assignedTo: str(task?.assignee?.name) || null,
      planDate: task?.plannedEnd || null,
    };
  });
}

function assessmentSlots(assessments, tasks) {
  const byType = new Map(assessments.map((a) => [a.type, a]));

  /* Match a task to an assessment by its title. Keys are matched as whole
     words so "financial" cannot claim a task about "finance approval". */
  const taskFor = (key) => (tasks || []).find((t) => new RegExp(`\\b${key}\\b`, 'i').test(str(t.title)));

  return ASSESSMENTS.map(({ key, label }) => {
    const record = byType.get(key) || null;
    const task = taskFor(key);
    return {
      type: key,
      label,
      /* 'filed' | 'open' | 'not_routed' — the three states a slot can be in,
         named rather than inferred from a null on the client. */
      state: record ? (isFiled(record.status) ? 'filed' : 'open') : 'not_routed',
      status: record?.status || null,
      recordId: record?.id || null,
      filedBy: record?.by || null,
      filedAt: record?.at || null,
      assignedTo: str(task?.assignee?.name) || null,
      planDate: task?.plannedEnd || null,
      taskDone: task ? task.status === TASK_STATUS.COMPLETE : false,
    };
  });
}

function planFrom(tasks) {
  if (!tasks || tasks.length === 0) return null;

  const assignedNames = [...new Set(tasks.map((t) => t.assignee?.name).filter(Boolean))];

  const dated = tasks.filter((t) => t.plannedEnd);
  const planDate = dated.length
    ? new Date(Math.max(...dated.map((t) => new Date(t.plannedEnd).valueOf())))
    : null;

  const allComplete = tasks.every((t) => t.status === TASK_STATUS.COMPLETE);
  let status = null;
  if (allComplete) {
    status = tasks.some((t) => t.completedOnTime === false) ? 'done_late' : 'done_ontime';
  } else if (planDate) {
    status = Date.now() > planDate.valueOf() ? 'delayed' : 'ontime';
  }

  return { assignedNames, planDate: planDate ? planDate.toISOString() : null, status };
}

/**
 * Where a captured property stands, derived rather than stored.
 *
 * 'commercial' the moment commercial closure has started on it, 'assessment'
 * once assessments exist, otherwise 'capture'. Derived in that order because
 * a property in commercial closure still has its assessment records sitting
 * underneath it — the later fact is the true one.
 */
/** What a property's decision currently SAYS — the queue's own wording. */
function decisionStateOf(record) {
  if (record.status === RECORD_STATUS.REJECTED) return 'rejected';
  if (record.status === RECORD_STATUS.APPROVED) return 'approved';
  if (record.status === RECORD_STATUS.SHORTLISTED) return 'shortlisted';
  return 'waiting';
}

/**
 * WHERE THE WORK ON A PROPERTY HAD REACHED, with the decision ignored.
 *
 * Split out of `stageOf` so a rejected property can still say where it was
 * standing when we said no — which is the one thing the MD needs before
 * putting it back. The forms a property has are the honest record of how far
 * it got: closure documents mean it had reached commercial, assessments mean
 * it had reached assessment, neither means it never left capture.
 */
function workStageOf(record, assessments, commercialCount) {
  if (commercialCount > 0 || record.status === RECORD_STATUS.APPROVED) return 'commercial';
  if (assessments.length > 0) return 'assessment';
  return 'capture';
}

function stageOf(record, assessments, commercialCount) {
  /* REJECTED FIRST, and it is the reason this function was wrong.
     A property we said no to is a decision that was made, not work that is
     outstanding — but nothing here looked at `status` for a negative, so a
     rejected site kept reporting as "captured" and sat in Step 1 forever,
     identical to the live ones. Two of them were doing it. Archived belongs
     with it: neither is a thing anybody is going to act on. */
  if (record.status === RECORD_STATUS.REJECTED || record.status === RECORD_STATUS.ARCHIVED) return 'rejected';
  return workStageOf(record, assessments, commercialCount);
}

/**
 * Everything else the Phase 1 form holds — the commercial terms, the contacts
 * and the pin — as one flat object per row.
 *
 * WHY IT IS FLAT AND WHY IT IS HERE. The queue is read as a sheet: one
 * property per line, every fact it carries in its own column. Those facts
 * already exist on the record; leaving them out meant the only way to compare
 * two rents was to open two dialogs. Keyed by what the fact IS, not by the
 * template key it happens to live under, so a renamed field is a change in one
 * function rather than in every column that reads it.
 */
function detailsOfRecord(v = {}) {
  const num = (x) => (x === 0 || Number.isFinite(Number(x)) ? Number(x) : null);
  const loc = v.live_location && Number.isFinite(Number(v.live_location.lat))
    ? { lat: Number(v.live_location.lat), lng: Number(v.live_location.lng) }
    : null;
  return {
    commercialType: str(v.commercial_type),
    frontageFt: num(v.frontage_ft),
    monthlyRent: num(v.monthly_rent),
    deposit: num(v.deposit),
    leaseAmount: num(v.lease_amount),
    leaseDuration: num(v.lease_duration),
    availableFrom: v.available_from || null,
    ownerName: str(v.owner_name),
    ownerPhone: str(v.owner_phone),
    brokerName: str(v.broker_name),
    brokerPhone: str(v.broker_phone),
    liveLocation: loc,
  };
}

/** The same shape for a property that is still only an enquiry: it carries a
 *  pin and nothing commercial, and the sheet must not invent the rest. */
function detailsOfEnquiryProperty(property = {}) {
  const loc = Number.isFinite(Number(property.location?.lat))
    ? { lat: Number(property.location.lat), lng: Number(property.location.lng) }
    : null;
  return {
    commercialType: '', frontageFt: null, monthlyRent: null, deposit: null,
    leaseAmount: null, leaseDuration: null, availableFrom: null,
    ownerName: '', ownerPhone: '', brokerName: '', brokerPhone: '',
    liveLocation: loc,
  };
}

/** One franchise/broker property, as a queue row. Not yet a p1 record. */
function rowFromEnquiryProperty(enquiry, property, index, total) {
  return {
    id: `enq:${enquiry._id}:${index}`,
    /* Pass the origin through as it was recorded. Collapsing anything that is
       not 'broker' into 'franchise' would file every "a friend told us"
       property as a franchise application — a lead somebody would then try to
       approve as one. */
    source: ['broker', 'other'].includes(enquiry.source) ? enquiry.source : 'franchise',
    enquiryId: String(enquiry._id),
    propertyIndex: index,
    recordId: null,
    projectId: null,
    projectName: null,

    title: str(property.label) || str(property.locality) || str(property.city) || 'Untitled property',
    city: str(property.city),
    locality: str(property.locality),
    address: str(property.address),
    areaSqft: property.carpetAreaSqft ?? null,
    floor: str(property.floor),
    ownership: str(property.ownership),
    remarks: str(property.remarks),
    details: detailsOfEnquiryProperty(property),
    media: mediaOf(property),
    /**
     * Which submission this property belongs to, and where in it.
     *
     * One applicant can send six sites in one form, and as six flat rows they
     * are six strangers that happen to share a phone number. Carried on every
     * row rather than expressed as nesting, because the queue is sortable:
     * order by city and a parent/child grouping either breaks apart or has to
     * silently refuse the sort. "Site 2 of 6" survives every ordering.
     */
    submission: {
      id: String(enquiry._id),
      index: index + 1,
      total,
      by: str(enquiry.name),
    },

    submittedByName: str(enquiry.name),
    submittedByPhone: str(enquiry.phone),
    submittedByEmail: str(enquiry.email),

    stage: 'capture',
    status: enquiry.status === 'submitted' ? 'awaiting_review' : enquiry.status,
    assessments: [],
    documents: [],
    assessmentsComplete: false,
    assessmentsFiled: 0,
    assessmentSlots: assessmentSlots([], []),
    /* An enquiry has no project yet, so there are no capture tasks to read. */
    capturePlan: null,
    decision: null,
    filedBy: null,
    filedAt: null,
    documentsDone: 0,
    documentsFiled: 0,
    loiFiled: false,
    loiDone: false,
    plan: null,
    assessmentPlan: null,
    commercialPlan: null,
    planningPlan: null,
    /* An enquiry property cannot be routed until the lead itself is approved —
       that is what creates the project the record would hang from. The queue
       says so on the row rather than failing the click. */
    blockedReason: enquiry.status === 'submitted'
      ? 'Approve the franchise enquiry first — that creates the project this property files into.'
      : null,
    createdAt: enquiry.createdAt,
  };
}

/** A lead or a project that wants a store in a city but has no property yet. */
function rowFromDemand({ id, city, area, who, phone, createdAt, projectId, projectName, capturePlan = null }) {
  return {
    id,
    source: 'demand',
    enquiryId: null,
    propertyIndex: null,
    recordId: null,
    projectId: projectId || null,
    projectName: projectName || null,

    /* Named as what it IS — a store we have committed to opening — rather
       than as what it lacks. Same word as the button that creates it and the
       tab that lists it. */
    title: city ? `New store — ${city}` : 'New store',
    city: str(city),
    locality: str(area),
    address: '',
    areaSqft: null,
    floor: '',
    ownership: '',
    remarks: '',
    details: detailsOfEnquiryProperty({}),
    media: mediaOf({}),

    submittedByName: str(who),
    submittedByPhone: str(phone),
    submittedByEmail: '',

    stage: 'demand',
    status: 'sourcing',
    assessments: [],
    documents: [],
    assessmentsComplete: false,
    assessmentsFiled: 0,
    assessmentSlots: assessmentSlots([], []),
    /**
     * WHO IS ON THE HUNT, on a store that has no property yet.
     *
     * This was hardcoded null, and that was the bug behind "I assigned
     * somebody and the queue still says Unassigned": a new store IS a demand
     * row until its first site is filed, so the one row that most needs an
     * owner was the one row that could never show one. It reads the same p1
     * tasks every other row does.
     */
    capturePlan,
    decision: null,
    filedBy: null,
    filedAt: null,
    documentsDone: 0,
    documentsFiled: 0,
    loiFiled: false,
    loiDone: false,
    plan: null,
    assessmentPlan: null,
    commercialPlan: null,
    planningPlan: null,
    submission: null,
    blockedReason: null,
    createdAt,
  };
}

/**
 * Page size.
 *
 * Twenty-five is what fits on a laptop screen without scrolling the page
 * itself, and the cap exists so a caller cannot ask for the whole table back
 * by passing `limit=100000` and undo the point of paginating at all.
 */
export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 200;

/**
 * The columns a caller may order by, and how each one is READ rather than
 * printed.
 *
 * Dates sort by their instant and areas by their number — sorting either as
 * text puts "9,000 sq ft" below "10,000" and "1 Mar" below "1 Feb". `stage`
 * sorts by pipeline position, not alphabetically, so the queue groups by how
 * far along it is instead of putting Assessment before Captured.
 *
 * A whitelist, not a passthrough: this is a sort key arriving from a query
 * string, and handing it straight to a comparator over arbitrary property
 * paths is how you get one that reads fields the caller was never shown.
 */
/**
 * WHERE A PROPERTY STANDS, IN ONE WORD — decided HERE, not in the browser.
 *
 * The queue's Status chip has always been worked out on the client. That was
 * fine while it was only being displayed; it stopped being fine the moment
 * somebody wanted to FILTER by it, because a filter that runs in the browser
 * can only see the twenty-five rows the server already sent. "Shortlisted"
 * would have returned the shortlisted rows on page 1 and nothing on page 2,
 * under a footer still claiming 54 — a filter that quietly lies about what it
 * found is worse than no filter.
 *
 * So the ladder moves here, where the whole set is, and the label rides along
 * on every row. The client renders what it is given instead of deriving it
 * again, which is also how the chip and the filter are kept from disagreeing.
 *
 * THE DECISION LEADS, because that is the thing people are waiting on and the
 * thing that changes under them: a site sitting in Assessment that the MD has
 * just turned down is Rejected, not "In Review". Stage is the fallback, for a
 * property nobody has ruled on yet.
 */
const STATUS_LADDER = [
  { key: 'rejected', label: 'Rejected' },
  { key: 'approved', label: 'Approved' },
  { key: 'shortlisted', label: 'Shortlisted' },
  { key: 'commercial', label: 'In Commercial' },
  { key: 'in_review', label: 'In Review' },
  { key: 'draft', label: 'Draft' },
  { key: 'awaiting_review', label: 'Awaiting review' },
  { key: 'captured', label: 'Captured' },
  { key: 'assigned', label: 'Assigned' },
  { key: 'not_started', label: 'Not Started' },
];

/**
 * THE HEADER STRIP'S TILES, AS PREDICATES.
 *
 * Each tile is now a link: press "Shortlisted 21" and the queue shows those
 * twenty-one. That only holds if the number and the list are the same
 * question, so they are the same FUNCTION — counted with it below, filtered
 * with it when `view` names one. Two copies of "what does Shortlisted mean"
 * is how a tile comes to open a table with a different number on it.
 *
 * Note none of these is expressible as a `status` filter. "Shortlisted" here
 * means a site we said yes to WHEREVER it has got to since, and those rows
 * wear "In Review" and "In Commercial" chips; a status filter would return a
 * fraction of them. That is exactly why `view` exists alongside `status`.
 */
/**
 * Step 4's set: a property the MD has weighed, or can now weigh.
 *
 * Shared by the stage filter and the `selection` count, so the rail badge
 * cannot disagree with the table it opens.
 */
const selectionScope = (r) => (
  (r.stage === 'assessment' && r.assessmentsFiled > 0)
  || r.stage === 'commercial'
  || r.statusKey === 'approved'
);

const TILE_VIEWS = {
  shortlisted: (r) => ['assessment', 'commercial'].includes(r.stage),
  assessment: (r) => r.stage === 'assessment',
  assigned: (r) => (r.capturePlan?.assignedNames?.length || 0) > 0 && !r.recordId,
  documentsPending: (r) => r.stage === 'commercial'
    && (r.documentsDone || 0) < DOCUMENT_KEY_LIST.length,
  /* `statusKey`, not `record.status`: a form still marked draft on a property
     that has reached assessment shows an "In Review" chip, and a Drafts tile
     that counted it would point at a row that does not say Draft. */
  draft: (r) => r.statusKey === 'draft',
};

export const TILE_VIEW_KEYS = Object.keys(TILE_VIEWS);

const STATUS_LABEL = Object.fromEntries(STATUS_LADDER.map((s) => [s.key, s.label]));

export const STATUS_KEYS = STATUS_LADDER.map((s) => s.key);

function statusOf(row) {
  const d = row.decision?.state;
  if (d === 'rejected' || row.stage === 'rejected') return 'rejected';
  if (d === 'approved') return 'approved';
  if (d === 'shortlisted' || row.status === 'shortlisted') return 'shortlisted';

  if (row.stage === 'commercial') return 'commercial';
  if (row.stage === 'assessment') return 'in_review';
  if (row.status === 'draft') return 'draft';
  if (row.status === 'awaiting_review' || row.status === 'submitted') return 'awaiting_review';
  if (row.filedAt || row.recordId) return 'captured';
  if (row.capturePlan?.assignedNames?.length) return 'assigned';
  return 'not_started';
}

const STAGE_ORDER = { demand: 0, capture: 1, assessment: 2, commercial: 3 };
const time = (d) => (d ? new Date(d).valueOf() || null : null);

const SORTABLE = {
  createdAt: (r) => time(r.createdAt),
  title: (r) => r.title || null,
  city: (r) => r.city || null,
  source: (r) => r.source || null,
  submittedBy: (r) => r.submittedByName || null,
  project: (r) => r.projectName || null,
  area: (r) => (r.areaSqft ?? null),
  stage: (r) => STAGE_ORDER[r.stage] ?? 9,
  assessments: (r) => (r.assessments.length ? r.assessmentsFiled / r.assessments.length : null),
  documents: (r) => (r.documentsFiled ?? null),
  loi: (r) => (r.loiDone ? 2 : r.loiFiled ? 1 : 0),
  games: (r) => (r.plan?.games?.length ?? null),
  opening: (r) => time(r.plan?.openingDate),
  trial: (r) => time(r.plan?.trialDate),
};

export const SORT_KEYS = Object.keys(SORTABLE);

export const propertyCaptureService = {
  /**
   * Every property in front of the business right now, newest first.
   *
   * Four queries, not four round trips per row: the p1 records, their child
   * assessments, the open enquiries, and the projects with nothing captured
   * yet. Everything else is done in memory over a few hundred rows.
   */
  async list({
    source, city, stage, search, status, view,
    sort = 'createdAt', dir = 'desc',
    page = 1, limit = DEFAULT_LIMIT,
    includeRejected = false,
  } = {}) {
    const [records, enquiries, projects] = await Promise.all([
      Record.find({ stageKey: 'p1' })
        .populate('project', 'name city status')
        .populate('createdBy', 'name role')
        /* WHO DECIDED, and when. The four pillars ask "who owns this step and
           when was it done"; for the capture step the answer is the stamp the
           decision left on the record itself, and it was being thrown away. */
        .populate('submittedBy', 'name')
        .populate('shortlistedBy', 'name')
        .populate('rejectedBy', 'name')
        .populate('approvedBy', 'name')
        .sort({ createdAt: -1 })
        .lean(),
      /* Decided enquiries are already filed as p1 records by the franchise
         decision, so listing them again would double every row. Only the
         undecided ones are shown here, which is also the only state in which
         this queue can tell the MD something the project board cannot. */
      FranchiseEnquiry.find({ status: 'submitted' }).sort({ createdAt: -1 }).lean(),
      Project.find({ status: { $in: LIVE } }).select('name city createdAt createdBy').lean(),
    ]);

    const recordIds = records.map((r) => r._id);
    const children = await Record.find({
      parentRecordId: { $in: recordIds },
      stageKey: { $in: ['p2', 'p3'] },
    })
      .select('parentRecordId stageKey assessmentType status values submittedBy submittedAt')
      .populate('submittedBy', 'name')
      .lean();

    /* Step 4's plan is filed PER PROJECT, not per property — p20 is "this
       outlet's games and dates", and an outlet has one of them however many
       properties were looked at on the way. So it is fetched by project and
       joined on, rather than pulled out of `children` above. */
    const projectIds = records.map((r) => r.project?._id).filter(Boolean);
    /* Every live project as well — see the p1 task query below. */
    const projectIdsWithTasks = [...new Set([
      ...projectIds.map(String),
      ...projects.map((p) => String(p._id)),
    ])];
    const plans = await Record.find({ stageKey: 'p20', project: { $in: projectIds } })
      .select('project status values submittedBy submittedAt')
      .populate('submittedBy', 'name')
      .lean();
    const planByProject = new Map(plans.map((pl) => [String(pl.project), pl]));

    /* WHO IS DOING THE WORK, AND BY WHEN — for the three steps that have a
       "which person, by which date" question: Assessment, Commercial, and
       Project & Games Planning. Step 1 (plain capture) has neither yet, which
       is why this is fetched once here rather than baked into `children`.
       Read straight from Task, never guessed at, so a plan date here can never
       disagree with the same task open in My Tasks.
       - p2 tasks are assigned PER PROPERTY (`subjectRecord` = the p1 record —
         see project.service.js#syncAssessmentTasks), so they are matched by
         recordId, same as the assessment records above.
       - p3 and p20 tasks are phase-wide for the project (there is only ever
         one property active in commercial closure or planning at a time), so
         they are matched by projectId instead. */
    const [captureTasks, assessmentTasks, commercialTasks, planningTasks] = await Promise.all([
      /**
       * WHOSE JOB THE CAPTURE ITSELF IS.
       *
       * Scoped to EVERY live project, not just the ones that already have a
       * property on them (`projectIds` is built from p1 records). A store with
       * no site yet is precisely the row whose owner matters most — it is the
       * hunt that has not started — and reading only record-bearing projects
       * meant its assignment was fetched for every row except that one.
       */
      Task.find({ stageKey: 'p1', project: { $in: projectIdsWithTasks } })
        .select('project assignee plannedEnd status completedOnTime')
        .populate('assignee', 'name')
        .lean(),
      Task.find({ stageKey: 'p2', subjectRecord: { $in: recordIds } })
        /* `title` rides along because the four assessments are four separate
           tasks with four different owners ("Do the Feasibility assessment",
           "Do the Financial assessment", …) and the title is what says which
           is which — the task carries no assessmentType of its own. */
        .select('subjectRecord assignee plannedEnd status completedOnTime title')
        .populate('assignee', 'name')
        .lean(),
      Task.find({ stageKey: 'p3', project: { $in: projectIds } })
        /* `title` rides along for the same reason p2's does: closure is six
           separate tasks with six different owners ("Issue Letter of Intent",
           "Draft & finalize lease agreement", "Security deposit & token
           payment"...) and the title is what says which document a task is
           for - the task carries no document type of its own. Without it
           `documentSlots` matched nothing, so all six documents on all
           seventeen properties reported no owner and no plan date. */
        .select('project assignee plannedEnd status completedOnTime title')
        .populate('assignee', 'name')
        .lean(),
      Task.find({ stageKey: 'p20', project: { $in: projectIds } })
        .select('project assignee plannedEnd status completedOnTime')
        .populate('assignee', 'name')
        .lean(),
    ]);

    const groupBy = (list, keyOf) => {
      const map = new Map();
      for (const item of list) {
        const k = keyOf(item);
        if (!k) continue;
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(item);
      }
      return map;
    };
    const captureTasksByProject = groupBy(captureTasks, (t) => String(t.project || ''));
    const assessmentTasksByProperty = groupBy(assessmentTasks, (t) => String(t.subjectRecord || ''));
    const commercialTasksByProject = groupBy(commercialTasks, (t) => String(t.project || ''));
    const planningTasksByProject = groupBy(planningTasks, (t) => String(t.project || ''));

    const byParent = new Map();
    for (const c of children) {
      const k = String(c.parentRecordId);
      if (!byParent.has(k)) byParent.set(k, []);
      byParent.get(k).push(c);
    }

    const rows = [];

    for (const r of records) {
      const kids = byParent.get(String(r._id)) || [];
      const assessments = bestPerType(kids, 'p2', ASSESSMENT_KEYS, ASSESSMENT_VALUE_FIELDS);
      const documents = bestPerType(kids, 'p3', DOCUMENT_KEYS, DOCUMENT_VALUE_FIELDS);
      const commercialCount = kids.filter((c) => c.stageKey === 'p3').length;
      const v = r.values || {};
      /* "All four passed" is the rule the client asked for: once every
         assessment that was ASKED FOR is filed, the property is ready to be
         shortlisted for commercial. Counted against what was asked for, not
         against four — a property routed to two assessments is ready when
         those two are in, and holding it against four it never needed would
         park it here forever. */
      const filedCount = assessments.filter((a) => isFiled(a.status)).length;
      const assessmentsComplete = assessments.length > 0 && filedCount === assessments.length;
      rows.push({
        id: `rec:${r._id}`,
        source: 'captured',
        enquiryId: null,
        propertyIndex: null,
        recordId: String(r._id),
        projectId: r.project ? String(r.project._id) : null,
        projectName: r.project?.name || null,

        title: str(v.property_name) || str(v.locality) || 'Untitled property',
        city: str(r.project?.city) || str(v.city),
        locality: str(v.locality),
        address: str(v.address) || str(v.locality),
        areaSqft: v.carpet_area ?? null,
        floor: str(v.floor),
        ownership: str(v.ownership),
        remarks: str(v.notes) || str(v.remarks),
        details: detailsOfRecord(v),
        media: mediaOf({
          photos: v.photos,
          videos: v.videos,
          documents: v.documents,
          audio: v.audio,
          driveLinks: v.drive_links,
        }),

        submittedByName: str(r.createdBy?.name) || 'System',
        submittedByPhone: str(v.broker_phone) || str(v.owner_phone),
        submittedByEmail: '',

        stage: stageOf(r, assessments, commercialCount),
        /**
         * WHERE IT WAS WHEN WE SAID NO — null unless it is rejected.
         *
         * Reverting a rejected property is not "put it back at the top": the
         * MD's question is where it should pick up, and the only sensible
         * default for that is where it had got to. A rejected row that shows
         * nothing but "Rejected" makes that a guess, so the queue carries the
         * fact rather than leaving the UI to invent one.
         */
        rejectedFrom: stageOf(r, assessments, commercialCount) === 'rejected'
          ? workStageOf(r, assessments, commercialCount)
          : null,
        status: r.status,
        assessments,
        documents,
        assessmentsComplete,
        assessmentsFiled: filedCount,
        /* The four, always — see assessmentSlots. */
        assessmentSlots: assessmentSlots(assessments, assessmentTasksByProperty.get(String(r._id))),
        /* The six, always — see documentSlots. */
        documentSlots: documentSlots(documents, commercialTasksByProject.get(String(r.project?._id))),
        /* What is waiting on an approver, what has had one, and what came
           back - see docReviewCounts and the `docreview` step. */
        docReview: docReviewCounts(documents),
        documentsDone: documents.filter((d) => isDone(d.status)).length,
        documentsFiled: documents.filter((d) => isFiled(d.status)).length,
        /* THE LOI IS THE ONE DOCUMENT STEP 4 CARES ABOUT. Signed and uploaded,
           the site is committed and planning it is safe. Reported as a fact,
           not as a lock: the client was explicit that a promising site should
           not have its games and dates held hostage to a slow landlord, so
           Step 4 shows this and still lets planning start. */
        submission: null,
        loiFiled: documents.some((d) => d.type === 'loi' && isFiled(d.status)),
        loiDone: documents.some((d) => d.type === 'loi' && isDone(d.status)),
        /**
         * Phase 4's plan, read with the schema's OWN field keys.
         *
         * This guessed at `games` / `games_selected` / `opening_date` and hit
         * none of them: p20 calls them `selected_games` and `target_opening`
         * (clientFlowTemplate.js). A guess that misses does not fail loudly —
         * it returns undefined, and the column reported "None chosen yet" for
         * outlets whose games had been picked weeks earlier. Keys are copied
         * from the template now, not inferred.
         */
        plan: (() => {
          const pl = r.project ? planByProject.get(String(r.project._id)) : null;
          if (!pl) return null;
          const gv = pl.values || {};
          const games = Array.isArray(gv.selected_games) ? gv.selected_games.filter(Boolean) : [];
          return {
            id: String(pl._id),
            status: pl.status,
            /* Who filed the plan and when — Step 6's "actual". */
            by: str(pl.submittedBy?.name) || null,
            at: pl.submittedAt || null,
            games,
            /* The form's own count where somebody typed one, otherwise the
               length of what they actually ticked — the two can disagree and
               the ticked list is the one that is true. */
            gameCount: games.length || (Number(gv.game_count) || 0),
            confirmedArea: gv.confirmed_area ?? null,
            openingDate: gv.target_opening || null,
            trialDate: gv.testing_date || null,
            constructionStart: gv.construction_start || null,
            handoverDate: gv.handover_date || null,
          };
        })(),
        /* Who's doing this step's work, by when, on schedule or not — see
           `planFrom`. Keyed by which QUESTION each is answering, not by stage
           key, so the three pages can read `row.assessmentPlan` etc. without
           knowing p2/p3/p20 are the phases behind them. */
        /**
         * The capture step's own four pillars, per property.
         *
         * `capturePlan` is WHO owns filing it and WHEN it is due (its p1
         * tasks); `decision` is who answered the step and when they did — the
         * two halves of "planned vs actual" that every other step reports and
         * this one could not.
         */
        capturePlan: planFrom(r.project ? captureTasksByProject.get(String(r.project._id)) : null),
        decision: (() => {
          const at = r.rejectedAt || r.shortlistedAt || r.approvedAt || null;
          const who = r.rejectedBy || r.shortlistedBy || r.approvedBy || null;
          if (!at && !who) return null;
          return {
            state: r.rejectedAt ? 'rejected' : r.approvedAt && !r.shortlistedAt ? 'approved' : 'shortlisted',
            by: str(who?.name) || null,
            at,
            reason: str(r.rejectReason) || null,
          };
        })(),
        /* Who filed the capture form itself, and when — the "actual" against
           `capturePlan`. `createdBy` is who opened it; `submittedBy` is who
           stood behind it, and they are not always the same person. */
        filedBy: str(r.submittedBy?.name) || str(r.createdBy?.name) || null,
        filedAt: r.submittedAt || r.createdAt || null,
        assessmentPlan: planFrom(assessmentTasksByProperty.get(String(r._id))),
        commercialPlan: planFrom(r.project ? commercialTasksByProject.get(String(r.project._id)) : null),
        planningPlan: planFrom(r.project ? planningTasksByProject.get(String(r.project._id)) : null),

        blockedReason: null,
        createdAt: r.createdAt,
      });
    }

    for (const e of enquiries) {
      const props = Array.isArray(e.properties) ? e.properties : [];
      if (e.hasProperty === false || props.length === 0) {
        rows.push(rowFromDemand({
          id: `enq:${e._id}:demand`,
          city: e.interestCity || e.city,
          area: e.interestArea,
          who: e.name,
          phone: e.phone,
          createdAt: e.createdAt,
        }));
        continue;
      }
      props.forEach((p, i) => rows.push(rowFromEnquiryProperty(e, p, i, props.length)));
    }

    /* A project with nothing captured yet IS the MD's New Project ask — "find
       me a site in this city". It belongs in this queue for the same reason a
       franchise lead with no property does: somebody has to go and find one. */
    const projectsWithRecords = new Set(records.map((r) => (r.project ? String(r.project._id) : '')));
    for (const p of projects) {
      if (projectsWithRecords.has(String(p._id))) continue;
      rows.push(rowFromDemand({
        id: `prj:${p._id}`,
        city: p.city,
        area: '',
        who: 'New project',
        phone: '',
        createdAt: p.createdAt,
        projectId: String(p._id),
        projectName: p.name,
        /* The Phase 1 tasks the MD assigned when the store was created. */
        capturePlan: planFrom(captureTasksByProject.get(String(p._id))),
      }));
    }

    /* ── narrow, count, order, slice ──────────────────────────────────
       In that order, deliberately.

       The COUNTS are taken after search/city/source but BEFORE the stage
       filter, because they drive the stepper: on "Bhopal" the stepper should
       report Bhopal's pipeline across all four phases, not the whole country's
       and not just the phase you happen to be looking at. Counting after the
       stage filter would make three of the four numbers permanently zero.

       The PAGE is the last thing that happens. Sorting a page instead of the
       set is the classic pagination bug — you get the top of page 3, not the
       third page of the top. */
    const q = str(search).toLowerCase();
    const cityKey = str(city).toLowerCase();

    const scoped = rows.filter((r) => {
      /* MATCHED HERE, NOT IN THE BROWSER. A tab that covers two sources
         could have filtered the fetched page instead, but a page filter can
         only see the 25 rows already in hand — it would find nothing on page
         2 while the footer still claimed 40. Same reason the status filter
         is server-side. */
      if (source) {
        const hit = source === 'company'
          ? (r.source === 'captured' || r.source === 'demand')
          : r.source === source;
        if (!hit) return false;
      }
      if (cityKey && r.city.toLowerCase() !== cityKey) return false;
      if (q) {
        /**
         * SEARCH THE ROW, NOT SEVEN FIELDS OF IT.
         *
         * It read title, city, locality, address, the sender's name and
         * phone, and the project — so a note saying "landlord wants a nine
         * year lease", an owner's name, a broker's number or the status word
         * on screen were all invisible to the box sitting above them. People
         * type what they can see.
         */
        const d = r.details || {};
        const hay = [
          r.title, r.city, r.locality, r.address, r.projectName,
          r.submittedByName, r.submittedByPhone, r.submittedByEmail,
          r.remarks, r.floor, r.ownership, r.statusLabel, r.source,
          d.commercialType, d.ownerName, d.ownerPhone, d.brokerName, d.brokerPhone,
          r.filedBy, r.decision?.by, r.decision?.reason,
          (r.capturePlan?.assignedNames || []).join(' '),
          (r.assessmentPlan?.assignedNames || []).join(' '),
        ].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    /* ONE PASS, ONCE. Every row carries its own status from here on, so the
       chip, the filter and the counts are the same answer rather than three
       that agree most of the time. */
    for (const r of rows) {
      r.statusKey = statusOf(r);
      r.statusLabel = STATUS_LABEL[r.statusKey];
    }

    /* The dropdowns' options come from the WHOLE queue, not from the page or
       even from the current filters: a city list that shrinks as you filter by
       city can never be used to change your mind. The same is true of the
       status list - offering "Rejected" when nothing is rejected sends people
       looking for rows that do not exist. */
    const cities = [...new Set(rows.map((r) => r.city).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));
    const statuses = STATUS_LADDER
      .filter((s) => rows.some((r) => r.statusKey === s.key))
      .map((s) => ({ key: s.key, label: s.label }));

    const counts = {
      /**
       * WHAT STEPS 1 AND 2 ACTUALLY LIST.
       *
       * Both pages ask for the queue with no stage filter, so both show every
       * property that is not rejected. Their figures on the flow rail said 29
       * and 18 - the phase-1 subtotal and the old narrower routing queue - and
       * neither matched the 54 their own footers printed. A step's badge that
       * disagrees with the table it opens is the kind of number people stop
       * trusting the rest of the screen over.
       */
      live: scoped.filter((r) => r.stage !== 'rejected').length,
      /**
       * HOW MANY PLACES, not how many properties.
       *
       * The sheet folds every property in a city into one row, so "54
       * properties" and the dozen rows on screen are two true statements that
       * look like a contradiction. This is the number that reconciles them,
       * and it is worth having on its own: four sites in Bhopal is one
       * decision about Bhopal.
       *
       * Keyed exactly as `groupByCity` keys it - trimmed and lower-cased - so
       * the figure equals the number of rows the table actually draws. A
       * looser or stricter match here and the card would disagree with the
       * sheet under it, which is the one thing it must not do.
       */
      locations: new Set(
        scoped
          .filter((r) => r.stage !== 'rejected')
          .map((r) => String(r.city || '').trim().toLowerCase())
          .filter(Boolean),
      ).size,
      capture: scoped.filter((r) => r.stage === 'demand' || r.stage === 'capture').length,
      /* What Step 2 lists: everything with a property to rule on. */
      decide: scoped.filter((r) => r.stage !== 'demand' && r.stage !== 'rejected').length,
      /* What Step 2 actually has to decide — see the `routing` filter below. */
      routing: scoped.filter((r) => r.stage === 'capture').length,
      /* Ready for the MD's pick — see the `selection` filter below. */
      selection: scoped.filter(selectionScope).length,
      /* Properties with at least one document a doer has submitted and nobody
         has ruled on yet. Not "in commercial" - a closure whose six documents
         are all still being written has nothing for an approver to do. */
      docreview: scoped.filter((r) => (r.docReview?.submitted || 0) > 0).length,
      rejected: scoped.filter((r) => r.stage === 'rejected').length,
      /* The In Review TILE: under evaluation right now. Deliberately narrower
         than what Step 3 lists — a property in closure is not "in review",
         but its assessments are still worth reading. */
      assessment: scoped.filter((r) => r.stage === 'assessment').length,
      /**
       * What Step 3 LISTS: anything with assessments to show.
       *
       * Counted over the non-rejected rows, because that is the population
       * the step itself paginates — `live` drops rejected properties before
       * the stage filter runs. Counting `scoped` made the badge say 19 over
       * a table of 18: a property turned down after its assessments were
       * filed still has them, so the second clause below caught it while the
       * list did not. `assessment` above needs no such guard — a rejected
       * property's stage IS 'rejected', so its first clause can never match.
       */
      assessmentStep: scoped.filter((r) => r.stage !== 'rejected'
        && (r.stage === 'assessment' || (r.assessments || []).length > 0)).length,
      commercial: scoped.filter((r) => r.stage === 'commercial').length,
      planning: scoped.filter((r) => r.stage === 'commercial' && r.plan).length,
      /**
       * THE THREE THE HEADER STRIP ASKS FOR.
       *
       * Added because the strip displays them; the alternative was to point a
       * tile at a count that means something else, which is worse than a zero
       * because it reads as true.
       *
       * `shortlisted` is past the capture queue and not turned down — a site
       * somebody said yes to, wherever it has got to since. `assigned` is a
       * site with somebody's name on the capture task but nothing filed yet,
       * which is exactly the pile that goes quiet. `documentsPending` is a
       * property in commercial closure whose six documents are not all done.
       */
      shortlisted: scoped.filter(TILE_VIEWS.shortlisted).length,
      assigned: scoped.filter(TILE_VIEWS.assigned).length,
      documentsPending: scoped.filter(TILE_VIEWS.documentsPending).length,
      /* Forms somebody started and did not finish. They were countable
         nowhere and reachable only by scrolling the queue looking for the
         grey chip — which is how a half-filled capture sits for a fortnight
         with nobody aware it is waiting on anything. */
      draft: scoped.filter(TILE_VIEWS.draft).length,
      all: scoped.length,
    };

    /* Rejected properties are OUT of every step by default and findable on
       request. Hiding them outright would lose "why did we say no to that one
       in Agra?", which is the question the rejection reason exists to answer;
       leaving them in made every step lie about how much work was left. */
    const live = includeRejected || stage === 'rejected'
      ? scoped
      : scoped.filter((r) => r.stage !== 'rejected');

    /**
     * `routing` is Step 2's own question, and it is narrower than `capture`
     * by exactly one thing: demand.
     *
     * `capture` deliberately includes demand — Step 1 counts a standing ask as
     * something in front of us. Step 2 asks which road a PROPERTY takes, and a
     * standing ask is not a property, so it is the one kind of row left out.
     *
     * IT USED TO LEAVE OUT MORE, AND THAT WAS WRONG. A franchise or referral
     * submission that had not been filed as a record yet (no `recordId`) was
     * excluded too, on the reasoning that its decision was the enquiry one
     * taken on Step 1. The effect was that Bhopal showed five properties on
     * Step 1 and two on Step 2, with nothing on either screen to say where the
     * other three had gone — and the three that vanished were the ones an
     * outsider had sent in, which are precisely the ones somebody is waiting
     * on an answer about. A property proposed to us is a property to decide
     * about, wherever it came from.
     *
     * The decision such a row takes is still the submission one — see the
     * Action column in PropertyMdReviewPage, which opens the enquiry dialog
     * for them. That dialog asks the same question this step asks (assess and
     * which, or straight to closure, or no) and files the property as part of
     * answering it, so the two roads meet rather than fork.
     */
    /* One of the header tiles, opened. Same predicate that produced the
       figure on it, so the table cannot come back with a different number
       from the one that was pressed. */
    const viewed = TILE_VIEWS[view] ? live.filter(TILE_VIEWS[view]) : live;

    /* Applied BEFORE the step filter and before paging, so "Shortlisted" means
       every shortlisted property in the step, not the ones that happened to
       land on this page. */
    const byStatus = status ? viewed.filter((r) => r.statusKey === status) : viewed;

    const staged = stage
      ? byStatus.filter((r) => {
        if (stage === 'capture') return r.stage === 'demand' || r.stage === 'capture';
        if (stage === 'routing') return r.stage === 'capture';
        /**
         * EVERYTHING THERE IS A DECISION TO TAKE ABOUT.
         *
         * Step 2 asked for the queue with no stage filter at all, which is
         * right in one way — narrowing it is what once made properties vanish
         * between Step 1 and Step 2 with nothing on either screen to say
         * where they had gone — and wrong in one: it also brought in stores
         * we have committed to but found no site for. Those rows have no
         * property record, so Shortlist and Reject have nothing to act on,
         * and the step printed "Nothing to decide yet" where its three
         * buttons belong.
         *
         * `routing` is too narrow for this step (it is `capture` only, so
         * everything already in assessment or closure would disappear along
         * with the Revert that is the only thing to do to them). `decide` is
         * the honest cut: every row with a property, at whatever stage. The
         * standing asks stay on Step 1, which is the register and lists them
         * with the capture task assigned against each.
         */
        if (stage === 'decide') return r.stage !== 'demand';
        /**
         * ONE ANSWER IS ENOUGH TO BE LOOKED AT.
         *
         * This required EVERY assessment to be filed, on the reasoning that
         * comparing a site with four scores against one with two is not a
         * comparison. True, and not the MD's problem to be protected from: a
         * feasibility score of 31% is a decision that can be taken on the spot,
         * and holding that site off the screen until three more forms come back
         * means waiting a fortnight to say no. Worse, the outstanding forms
         * were invisible from here, so nobody could see what they were waiting
         * for or fill one in.
         *
         * So the gate is one filed assessment, not all of them. The sheet says
         * how far through each property is (1/4), the unfilled assessments show
         * as empty cells that open their form, and the approve dialog states
         * what is still outstanding before it takes the answer. The reader is
         * told what they are deciding on rather than prevented from deciding.
         *
         * Still not zero: a property nobody has assessed at all has nothing to
         * weigh, and it is killed or chased from Step 3 where its forms are.
         */
        /**
         * AT THE GATE, OR THROUGH IT — not only the undecided.
         *
         * This was `assessment && assessmentsFiled > 0`: the properties still
         * waiting on the MD's pick, and nothing else. The moment one was
         * approved it moved to `commercial` and VANISHED from the step that
         * approved it, so the step could never answer "which ones did we take
         * forward?" — the question it exists to record the answer to. Nine of
         * the forty-four were hidden this way.
         *
         * It also broke the status filter, invisibly: the stage filter runs
         * BEFORE the status one, so asking for "Shortlisted" or "Approved"
         * here searched a set those rows had already been removed from and
         * came back empty. Not a filter bug — this line.
         *
         * Rejected stays out; it has its own tab (see the note on `live`).
         */
        if (stage === 'selection') return selectionScope(r);
        /**
         * THE APPROVAL STEP, between closure and project creation.
         *
         * Submitting a document and having it accepted are two different acts
         * by two different people, and the queue only modelled the first. A
         * doer filed the lease and it sat there looking done; the approver had
         * no list to work from and the row could not say whether anything was
         * blocked on them.
         *
         * Everything with a submitted document appears, including properties
         * whose other five are still blank - the point is the approver's
         * in-tray, not whether closure is finished. Once every document is
         * ruled on the property leaves this step on its own.
         */
        /**
         * STEP 3 IS ABOUT THE ASSESSMENTS, NOT ABOUT WHERE THE PROPERTY IS.
         *
         * This fell through to `r.stage === 'assessment'`, and `stage` is
         * derived from how far the property has got — so the moment one was
         * shortlisted onward to closure it became 'commercial' and dropped
         * off the assessment step, taking its four assessments, their scores
         * and their owners with it. Somebody asking "what did Feasibility say
         * about kirti nagar" had nowhere to look.
         *
         * A property that HAS assessments belongs on the step that shows
         * them, for as long as they exist. Same reasoning as `selection`
         * above: the step is a subject, not a waiting room.
         */
        if (stage === 'assessment') {
          return r.stage === 'assessment' || (r.assessments || []).length > 0;
        }
        if (stage === 'docreview') return (r.docReview?.submitted || 0) > 0;
        return r.stage === stage;
      })
      : byStatus;

    const pick = SORTABLE[sort] || SORTABLE.createdAt;
    const direction = dir === 'asc' ? 1 : -1;
    const ordered = [...staged].sort((a, b) => {
      const av = pick(a);
      const bv = pick(b);
      /* Blanks sink whichever way the column points. A column of dashes
         floating to the top is never what somebody sorted for. */
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * direction;
      return String(av).localeCompare(String(bv), undefined, { numeric: true }) * direction;
    });

    const total = ordered.length;
    const safeLimit = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const totalPages = Math.max(Math.ceil(total / safeLimit), 1);
    /* Clamped rather than trusted. Deleting the last row of page 9 while
       somebody is on it must not hand them an empty table with no way back —
       they land on the new last page instead. */
    const safePage = Math.min(Math.max(Number(page) || 1, 1), totalPages);
    const start = (safePage - 1) * safeLimit;

    return {
      rows: ordered.slice(start, start + safeLimit),
      page: safePage,
      limit: safeLimit,
      total,
      totalPages,
      counts,
      cities,
      statuses,
    };
  },

  /**
   * The decision the client's flow hangs everything on: does this property
   * need assessing, and if so which assessments?
   *
   *   assess → the property is shortlisted and one Site Evaluation record is
   *            opened per chosen assessment. Nothing is auto-answered; the
   *            forms are opened, not filled.
   *   skip   → the property is shortlisted and goes straight to commercial
   *            closure, which is the client's "No → Legal + Commercial +
   *            Finalization" branch.
   *
   * Idempotent on the assessments: asking twice for Feasibility does not
   * create a second Feasibility form. Somebody pressing the button again
   * because they were not sure it registered is not a data-entry event.
   */
  async route(recordId, { road, assessments = [], skip = false } = {}, userId) {
    const record = await Record.findById(recordId);
    if (!record) throw ApiError.notFound('Property not found');
    if (record.stageKey !== 'p1') throw ApiError.badRequest('That is not a property record.');

    /* `road` is what the caller now sends. `skip` is the older two-road shape
       and still works — the enquiry flow and any saved client speak it — so it
       is translated rather than broken. */
    const chosen = ROADS.includes(road) ? road : (skip ? 'commercial' : 'assessment');

    const wanted = chosen === 'assessment'
      ? [...new Set(assessments)].filter((a) => ASSESSMENT_KEYS.has(a))
      : [];
    if (chosen === 'assessment' && wanted.length === 0) {
      throw ApiError.badRequest('Choose at least one assessment, or send the property straight to commercial or project.');
    }

    /* Shortlisting is what marks a property as one we are pursuing, and it is
       the same decision Phase 1 has always recorded — reused rather than given
       a parallel flag, so the project board and this queue cannot disagree.
       Already-shortlisted properties are left alone; re-deciding would stamp a
       fresh decision date on an old call. */
    if (record.status !== RECORD_STATUS.SHORTLISTED && record.status !== RECORD_STATUS.APPROVED) {
      await recordService.decide(recordId, 'shortlist', undefined, userId);
    }

    /**
     * What each road actually opens.
     *
     * assessment → the chosen Site Evaluations.
     * commercial → the six closure documents, exactly as they would have
     *              opened on a Step 3 shortlist. Without this the road arrived
     *              at Commercial with nothing to count.
     * project    → NOTHING is opened, and the record is approved instead.
     *              `stageOf` reads an approved p1 as past closure, which is
     *              what puts it in front of Project & Games. The six documents
     *              stay unfiled on purpose — see ROADS.
     */
    let created = [];
    if (chosen === 'assessment') {
      created = await openChildForms(record, 'p2', wanted, userId);
    } else if (chosen === 'commercial') {
      created = await openChildForms(record, 'p3', DOCUMENT_KEY_LIST, userId);
    } else {
      /**
       * STRAIGHT TO PROJECT OPENS THE PAPERWORK TOO.
       *
       * It used to open nothing, on the reasoning that this road means
       * "start planning, the documents can wait". That was half right and
       * the wrong half: the road is taken for a site the company is sure
       * of, and being sure of it is exactly when the LOI and the lease
       * should already be moving. Nobody chose this road meaning "never
       * file a lease" — they chose it meaning "do not make me wait for one
       * before I can pick the games".
       *
       * So both start: the six documents open as drafts and the property is
       * approved, which is what puts it in front of Project & Games. This is
       * the same rule Step 4's approve dialog states out loud — ticking
       * project creation leaves commercial ticked and cannot untick it.
       */
      created = await openChildForms(record, 'p3', DOCUMENT_KEY_LIST, userId);
      if (record.status !== RECORD_STATUS.APPROVED) {
        await recordService.decide(recordId, 'approve', undefined, userId);
      }
    }

    return {
      recordId: String(record._id),
      road: chosen,
      /* Kept for the callers that still read it. */
      skipped: chosen !== 'assessment',
      created,
      /* Told, not guessed at: the caller navigates on this rather than
         re-deriving where the property went. */
      nextStage: chosen === 'assessment' ? 'assessment'
        : chosen === 'commercial' ? 'commercial'
          : 'planning',
    };
  },

  /**
   * A submitted property's next step, decided in ONE question.
   *
   * WHY THIS EXISTS. A property from the franchise or referral link used to
   * need two decisions in two places: approve the lead here, then find the
   * property it created and route it to assessment or commercial over there.
   * But "approve" was never the real question — nobody approves a submission
   * and then wonders what to do with it. The question is the same one every
   * other property in this queue is asked: does it need assessing, or does it
   * go straight to commercial closure? Answering THAT is what approves it.
   *
   * So the road is derived from the answer, never asked for separately:
   *   assessment → 'assess': the ticked properties are filed and shortlisted,
   *                and the assessment forms that were chosen are opened on
   *                each of them.
   *   commercial → 'loi': the one chosen property is filed as the site, the
   *                project stands at Phase 3, and its six documents open.
   *   reject     → the lead is declined with its reason, and nothing is filed.
   *
   * ONE CALL, not two. The client cannot be left holding an approved lead
   * whose properties were never routed because the second request failed —
   * and the records to route are the ones this just created, so the server is
   * the only place that knows them without going looking.
   */
  async routeSubmission(enquiryId, {
    decision = 'approve', propertyIds = [], assessments = [], skip = false, road, reason,
  } = {}, user) {
    if (decision === 'reject') {
      const rejected = await franchiseService.decide(enquiryId, { decision: 'reject', reason }, user);
      return { decision: 'reject', enquiryId: String(rejected._id), nextStage: 'rejected' };
    }

    /**
     * THE SAME THREE ROADS A CAPTURED PROPERTY GETS.
     *
     * A submission used to be asked only "assess, or straight to commercial",
     * while a property captured by our own team was asked a third thing —
     * straight to project. There is no reason the answer should depend on
     * which door the site came in through, and the third road is the one the
     * client asks for most: a site they are sure of, where planning starts
     * now and the paperwork runs beside it.
     *
     * `skip` is the older two-road shape and still works — the same
     * translation `route()` does — so a client that has not been updated
     * keeps behaving exactly as before.
     */
    const chosenRoad = ROADS.includes(road) ? road : (skip ? 'commercial' : 'assessment');
    const closes = chosenRoad === 'commercial' || chosenRoad === 'project';

    const wanted = closes ? [] : [...new Set(assessments)].filter((a) => ASSESSMENT_KEYS.has(a));
    if (!closes && wanted.length === 0) {
      throw ApiError.badRequest('Choose at least one assessment, or send it straight to commercial.');
    }

    /* 'loi' is the road that means "this is THE site" — it files one property
       as approved and stands the project at Phase 3. Going there with three
       properties ticked is not a thing anybody means, so franchiseService
       refuses it; saying so in this language beats relaying its wording. */
    if (closes && propertyIds.length > 1) {
      throw ApiError.badRequest('Going straight to commercial or project means one chosen site — tick just the one.');
    }

    /* Both closing roads file the one site as THE site, which is what 'loi'
       means to franchiseService. They differ only in where the reader is
       sent afterwards, and in nothing the database does. */
    const mode = closes ? 'loi' : 'assess';
    const approved = await franchiseService.decide(
      enquiryId, { decision: 'approve', mode, propertyIds }, user,
    );

    const projectId = approved.project?._id;
    const userId = user._id || user.id;

    /* The properties just taken forward, found by the status that road gave
       them — 'loi' approves its single site, 'assess' shortlists every ticked
       one. The untickled rest are filed as `submitted` and stay in Step 1 as
       ordinary captured properties, which is where somebody would look for
       them. */
    const taken = await Record.find({
      project: projectId,
      stageKey: 'p1',
      status: closes ? RECORD_STATUS.APPROVED : RECORD_STATUS.SHORTLISTED,
    });

    const routed = [];
    for (const rec of taken) {
      routed.push({
        recordId: String(rec._id),
        /* Project takes the same six documents as commercial — see ROADS.
           The only difference is which step the reader lands on. */
        opened: closes
          ? await openChildForms(rec, 'p3', DOCUMENT_KEY_LIST, userId)
          : await openChildForms(rec, 'p2', wanted, userId),
      });
    }

    return {
      decision: 'approve',
      enquiryId: String(enquiryId),
      projectId: String(projectId),
      projectName: approved.project?.name || null,
      routed,
      /* Told, not guessed at: the client follows the property to the step the
         server says it landed on. */
      road: chosenRoad,
      nextStage: chosenRoad === 'project' ? 'planning'
        : chosenRoad === 'commercial' ? 'commercial'
          : 'assessment',
    };
  },

  /**
   * The verdict AFTER assessment — step 2's own action.
   *
   * 'shortlist' is the property we are taking forward: it moves to commercial
   * closure, which is what the client means by "selected goes to shortlisted,
   * then commercial". 'reject' takes it off the table with a reason, which the
   * expansion team's map needs as much as the decision does.
   *
   * Deliberately thin — `recordService.decide` already owns the legal state
   * transitions (a rejected property cannot be re-shortlisted, an archived one
   * cannot be decided at all), so this adds the property-queue meaning on top
   * rather than a second, looser copy of the rules.
   */

  /**
   * CHANGING a decision that was already taken.
   *
   * A decision is a judgement, and judgements are revisited: the rent moves,
   * the landlord stops answering, a rejected shop turns out to be the best one
   * on the street. Until now the answer was final in one direction — Step 2
   * still showed Shortlist and Reject on a decided row, but a rejected
   * property cannot be re-shortlisted (recordService.decide's own transition
   * table says so), so the click failed and the row stayed where it was.
   *
   * This is that change, said out loud:
   *   to: 'shortlist'  take it forward after all (optionally re-routing it)
   *   to: 'reject'     take it off the table after all
   *   to: 'waiting'    withdraw the decision; the row goes back to Step 2
   *
   * HOW. `recordService` owns the legal transitions and refuses to decide a
   * rejected or approved record twice, so a change CLEARS the old decision
   * first — the same undo the record page offers — and then records the new
   * one. Both halves land in the record's own `decisionHistory`, plus an entry
   * naming what was replaced and why, so "why is this shortlisted now?" has an
   * answer months later.
   *
   * WHAT IS NOT UNDONE. Anything the old decision opened stays: assessments
   * already filed, closure documents already answered. Rejecting a property
   * with filed paperwork does not shred it — the row simply reports as
   * rejected (see stageOf) and the count comes back if the decision changes
   * again. The caller is told how many filed children there were so the UI can
   * say it plainly.
   */
  async changeDecision(recordId, { to, reason, road, assessments = [] } = {}, userId) {
    if (!['shortlist', 'reject', 'waiting'].includes(to)) {
      throw ApiError.badRequest('Change it to shortlist, reject, or back to waiting.');
    }
    /**
     * A WITHDRAWAL IS NOT A NEW ANSWER, so it does not need a reason.
     *
     * Changing shortlist to reject replaces one verdict with another, and the
     * next person reading the property has to know why - so that still
     * demands a written reason. Withdrawing a decision replaces it with
     * nothing: the property goes back to waiting, both buttons return, and
     * the next thing that happens to it will carry its own reason. Demanding
     * one here meant a dialog in front of the commonest correction on the
     * step - "I pressed the wrong button" - which is the whole reason it was
     * asked for without one.
     *
     * The audit still records the act, who did it and when; see the note
     * passed to `undoDecision` below.
     */
    if (to !== 'waiting' && !str(reason)) {
      throw ApiError.badRequest('Say why the decision is changing — it is kept beside the old one.');
    }
    const record = await Record.findById(recordId);
    if (!record) throw ApiError.notFound('Property not found');
    if (record.stageKey !== 'p1') throw ApiError.badRequest('That is not a property record.');

    const from = decisionStateOf(record);
    /**
     * A PROPERTY CAN BE PAST THIS STEP WITHOUT CARRYING A DECISION.
     *
     * Its STEP comes from its children, not its verdict, so a site whose
     * decision was already withdrawn - or one routed by a path that left no
     * verdict on the record - still sits in assessment or commercial with
     * nothing to withdraw. Refusing there made Revert a button that offered
     * itself on twelve rows and worked on none of them: the queue shows it
     * because the property has moved, and the service answered "no decision
     * yet" to the person trying to bring it back.
     *
     * So only a NEW ANSWER needs an old one to replace. Withdrawal is allowed
     * either way and does the part that is still meaningful - closing the
     * untouched forms that are holding the property forward.
     */
    if (from === 'waiting' && to !== 'waiting') {
      throw ApiError.badRequest('That property has no decision yet — shortlist or reject it instead.');
    }
    /* The state a record is IN and the answer being asked for are different
       words for the same thing — 'shortlisted' vs 'shortlist' — so they are
       mapped rather than compared, which is why this guard used to pass
       everything. Re-shortlisting IS allowed when a different road is chosen:
       that is "same answer, different destination", the commonest change of
       all (assessment → straight to commercial). */
    const SAID = { shortlisted: 'shortlist', approved: 'shortlist', rejected: 'reject', waiting: 'waiting' };
    if (SAID[from] === to && to !== 'waiting' && !road) {
      throw ApiError.badRequest(to === 'reject'
        ? 'It is already rejected — change it to shortlist, or back to waiting.'
        : 'It is already shortlisted. Choose a different road for it, or change it to reject or back to waiting.');
    }
    const fromStatus = record.status;

    /* Counted BEFORE anything changes: the answer to "what happens to the
       work already done on it?" is "nothing", and the UI says so. */
    /* `values` rides along because a withdrawal has to tell an empty draft
       from one somebody has worked on - see the `to === 'waiting'` branch. */
    const children = await Record.find({ parentRecordId: record._id })
      .select('stageKey status values').lean();
    const filedChildren = children.filter((c) => isFiled(c.status)).length;
    /* THE ONE GUARD THIS DELIBERATELY OVERRIDES. `decide` refuses to shortlist
       a property with no assessment filed against it — a yes about nothing.
       Changing a decision is not that: the MD is overruling an answer already
       given, in writing, and the property may never have been on the
       assessment road at all (Step 2 rejections never are). So it is allowed
       and recorded instead of blocked, and the dialog says it out loud. */
    const filedAssessments = children.filter((c) => c.stageKey === 'p2' && isFiled(c.status)).length;

    /* Clear the old decision — the only way past the transition table. Only
       where there IS one: a withdrawal of a property that already has none is
       the form-closing below and nothing else. */
    if (from !== 'waiting') await recordService.undoDecision(recordId, userId);

    let documentsOpened = [];
    let nextStage = 'routing';
    let formsClosed = 0;
    let formsKept = 0;

    /**
     * WITHDRAWING HAS TO ACTUALLY WITHDRAW IT.
     *
     * Clearing the decision was not enough and the bug was invisible from the
     * server: a property's STEP is derived from its children, not from its
     * verdict (see workStageOf - any p3 child means "commercial"). So a
     * withdrawn shortlist lost its decision and stayed in commercial, which
     * on Step 2 shows Revert again instead of Shortlist and Reject. The one
     * thing the button exists to do was the one thing it did not do.
     *
     * So the forms the decision opened are closed with it - but ONLY the ones
     * nobody has touched. Every shortlist opens six empty drafts; those are
     * the decision's own leftovers and deleting them destroys nothing. A form
     * somebody has typed into is their work, and no amount of "put it back"
     * justifies throwing that away, so it stays and the property stays where
     * it is. The caller is told how many survived and says so rather than
     * leaving the reader to wonder why the row did not move.
     */
    if (to === 'waiting') {
      const openable = children.filter((c) => ['p2', 'p3'].includes(c.stageKey));
      const ids = [];
      for (const c of openable) {
        const values = c.values || {};
        const touched = isFiled(c.status)
          || Object.values(values).some((v) => (Array.isArray(v) ? v.length > 0 : v !== '' && v != null));
        if (touched) formsKept += 1;
        else ids.push(c._id);
      }
      if (ids.length) {
        const res = await Record.deleteMany({ _id: { $in: ids } });
        formsClosed = res?.deletedCount ?? ids.length;
      }
    }
    if (to === 'reject') {
      await recordService.decide(recordId, 'reject', reason, userId);
      nextStage = 'rejected';
    } else if (to === 'shortlist') {
      if (road) {
        /* Re-routing is the same call Step 2 makes, so a changed decision can
           also change WHERE the property goes, not only whether it goes. */
        const routed = await propertyCaptureService.route(recordId, { road, assessments }, userId);
        documentsOpened = routed.created || [];
        nextStage = routed.nextStage || (road === 'assessment' ? 'assessment' : road);
      } else {
        await recordService.decide(recordId, 'shortlist', reason, userId);
        const fresh = await Record.findById(recordId).select('project stageKey');
        documentsOpened = await openChildForms(fresh, 'p3', DOCUMENT_KEY_LIST, userId);
        nextStage = 'commercial';
      }
    }

    const after = await Record.findById(recordId).select('status');
    await Record.updateOne({ _id: recordId }, {
      $push: {
        decisionHistory: {
          decision: 'change',
          fromStatus,
          toStatus: after?.status,
          by: userId,
          at: new Date(),
          reason: str(reason),
          remarks: `Decision changed from ${from} to ${to}`
            + (to === 'shortlist' && !filedAssessments ? ' — no assessment had been filed at the time' : ''),
        },
      },
    });

    return {
      recordId: String(recordId),
      from,
      to,
      road: road || null,
      nextStage,
      documentsOpened,
      filedChildren,
      filedAssessments,
      /* Only meaningful for a withdrawal: how many empty forms went with the
         decision, and how many stayed because there was work in them. */
      formsClosed,
      formsKept,
    };
  },

  async decide(recordId, { decision, reason } = {}, userId) {
    if (!['shortlist', 'reject'].includes(decision)) {
      throw ApiError.badRequest('Decide shortlist or reject.');
    }
    const record = await Record.findById(recordId).select('stageKey project');
    if (!record) throw ApiError.notFound('Property not found');
    if (record.stageKey !== 'p1') throw ApiError.badRequest('That is not a property record.');
    if (decision === 'reject' && !str(reason)) {
      throw ApiError.badRequest('A rejected property needs a reason.');
    }

    /**
     * NOTHING ASSESSED, NOTHING TO TAKE FORWARD.
     *
     * Shortlisting is the word "yes" — it opens six commercial documents and
     * commits the expansion team to a site. Said over a property whose four
     * assessments are all still blank, it is a yes about nothing: there is no
     * score, no finding, and no one who has been there. The queue was letting
     * that through, so a property could reach commercial closure without a
     * single evaluation ever having been filed against it.
     *
     * REJECT IS DELIBERATELY NOT GATED. A property falls through for reasons
     * that have nothing to do with the assessments — the owner withdraws, the
     * rent moves, a better site appears on the same road — and `reason` above
     * already forces that to be written down. Gating it too would leave a dead
     * property with no way out of the queue.
     */
    if (decision === 'shortlist') {
      const filed = await Record.countDocuments({
        parentRecordId: record._id,
        stageKey: 'p2',
        /* The same four the queue counts — an `assessmentType` outside the
           known set is not one of this property's assessments, so it must not
           unlock the decision on their behalf. */
        assessmentType: { $in: [...ASSESSMENT_KEYS] },
        status: { $ne: RECORD_STATUS.DRAFT },
      });
      if (!filed) {
        throw ApiError.badRequest(
          'No assessment has been filed against this property yet. '
          + 'Open one from its cell and file it before shortlisting.',
        );
      }
    }

    await recordService.decide(recordId, decision, reason, userId);

    /* SHORTLISTING OPENS THE PAPERWORK. Commercial closure is six documents,
       and until they exist Step 3 shows a property with six identical "Start"
       buttons and no sense of what is outstanding. Creating them here means
       the moment a property is shortlisted its closure checklist is real and
       countable — which is the whole of "0/6 → 6/6" on that step.
       Drafts, not submissions: the forms are opened, never answered. */
    const created = decision === 'shortlist'
      ? await openChildForms(record, 'p3', DOCUMENT_KEY_LIST, userId)
      : [];

    return {
      recordId: String(recordId),
      decision,
      documentsOpened: created,
      nextStage: decision === 'shortlist' ? 'commercial' : 'rejected',
    };
  },
};

export default propertyCaptureService;
