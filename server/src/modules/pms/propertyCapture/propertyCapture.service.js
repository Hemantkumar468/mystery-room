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
const ASSESSMENT_VALUE_FIELDS = {
  feasibility: ['purpose', 'market_potential', 'accessibility', 'expansion_potential', 'footfall_assessment'],
  financial: ['purpose', 'roi', 'payback_period', 'estimated_investment'],
  technical: ['purpose', 'building_condition', 'water_supply', 'internet_availability', 'fire_safety', 'parking', 'electrical_capacity'],
  operational: ['purpose', 'utility_availability', 'vendor_availability', 'operations_readiness', 'staff_requirement'],
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
        ...(valueFields && isFiled(c.status)
          ? {
            values: pickValues(c.values, valueFields[c.assessmentType]),
            /* Who actually filled the form in and when they did — stamped on
               submit, so it is the person who answered it rather than the last
               person to open it. */
            by: str(c.submittedBy?.name) || null,
            at: c.submittedAt || null,
          }
          : {}),
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
function stageOf(record, assessments, commercialCount) {
  /* REJECTED FIRST, and it is the reason this function was wrong.
     A property we said no to is a decision that was made, not work that is
     outstanding — but nothing here looked at `status` for a negative, so a
     rejected site kept reporting as "captured" and sat in Step 1 forever,
     identical to the live ones. Two of them were doing it. Archived belongs
     with it: neither is a thing anybody is going to act on. */
  if (record.status === RECORD_STATUS.REJECTED || record.status === RECORD_STATUS.ARCHIVED) return 'rejected';
  if (commercialCount > 0 || record.status === RECORD_STATUS.APPROVED) return 'commercial';
  if (assessments.length > 0) return 'assessment';
  return 'capture';
}

/** One franchise/broker property, as a queue row. Not yet a p1 record. */
function rowFromEnquiryProperty(enquiry, property, index, total) {
  return {
    id: `enq:${enquiry._id}:${index}`,
    source: enquiry.source === 'broker' ? 'broker' : 'franchise',
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
function rowFromDemand({ id, city, area, who, phone, createdAt, projectId, projectName }) {
  return {
    id,
    source: 'demand',
    enquiryId: null,
    propertyIndex: null,
    recordId: null,
    projectId: projectId || null,
    projectName: projectName || null,

    title: city ? `Property wanted — ${city}` : 'Property wanted',
    city: str(city),
    locality: str(area),
    address: '',
    areaSqft: null,
    floor: '',
    ownership: '',
    remarks: '',
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
    source, city, stage, search,
    sort = 'createdAt', dir = 'desc',
    page = 1, limit = DEFAULT_LIMIT,
    includeRejected = false,
  } = {}) {
    const [records, enquiries, projects] = await Promise.all([
      Record.find({ stageKey: 'p1' })
        .populate('project', 'name city status')
        .populate('createdBy', 'name role')
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
    const plans = await Record.find({ stageKey: 'p20', project: { $in: projectIds } })
      .select('project status values').lean();
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
    const [assessmentTasks, commercialTasks, planningTasks] = await Promise.all([
      Task.find({ stageKey: 'p2', subjectRecord: { $in: recordIds } })
        .select('subjectRecord assignee plannedEnd status completedOnTime')
        .populate('assignee', 'name')
        .lean(),
      Task.find({ stageKey: 'p3', project: { $in: projectIds } })
        .select('project assignee plannedEnd status completedOnTime')
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
      const documents = bestPerType(kids, 'p3', DOCUMENT_KEYS);
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
        status: r.status,
        assessments,
        documents,
        assessmentsComplete,
        assessmentsFiled: filedCount,
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
      if (source && r.source !== source) return false;
      if (cityKey && r.city.toLowerCase() !== cityKey) return false;
      if (q) {
        const hay = [r.title, r.city, r.locality, r.address, r.submittedByName, r.submittedByPhone, r.projectName]
          .filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    /* The dropdown's options come from the WHOLE queue, not from the page or
       even from the current filters: a city list that shrinks as you filter by
       city can never be used to change your mind. */
    const cities = [...new Set(rows.map((r) => r.city).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));

    const counts = {
      capture: scoped.filter((r) => r.stage === 'demand' || r.stage === 'capture').length,
      rejected: scoped.filter((r) => r.stage === 'rejected').length,
      assessment: scoped.filter((r) => r.stage === 'assessment').length,
      commercial: scoped.filter((r) => r.stage === 'commercial').length,
      planning: scoped.filter((r) => r.stage === 'commercial' && r.plan).length,
      all: scoped.length,
    };

    /* Rejected properties are OUT of every step by default and findable on
       request. Hiding them outright would lose "why did we say no to that one
       in Agra?", which is the question the rejection reason exists to answer;
       leaving them in made every step lie about how much work was left. */
    const live = includeRejected || stage === 'rejected'
      ? scoped
      : scoped.filter((r) => r.stage !== 'rejected');

    const staged = stage
      ? live.filter((r) => (stage === 'capture'
        ? (r.stage === 'demand' || r.stage === 'capture')
        : r.stage === stage))
      : live;

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
  async route(recordId, { assessments = [], skip = false } = {}, userId) {
    const record = await Record.findById(recordId);
    if (!record) throw ApiError.notFound('Property not found');
    if (record.stageKey !== 'p1') throw ApiError.badRequest('That is not a property record.');

    const wanted = skip ? [] : [...new Set(assessments)].filter((a) => ASSESSMENT_KEYS.has(a));
    if (!skip && wanted.length === 0) {
      throw ApiError.badRequest('Choose at least one assessment, or skip assessment entirely.');
    }

    /* Shortlisting is what marks a property as one we are pursuing, and it is
       the same decision Phase 1 has always recorded — reused rather than given
       a parallel flag, so the project board and this queue cannot disagree.
       Already-shortlisted properties are left alone; re-deciding would stamp a
       fresh decision date on an old call. */
    if (record.status !== RECORD_STATUS.SHORTLISTED && record.status !== RECORD_STATUS.APPROVED) {
      await recordService.decide(recordId, 'shortlist', undefined, userId);
    }

    /* Skipping assessment sends the property to commercial closure, so its six
       documents open here exactly as they would have on the Step 2 shortlist.
       Without this the skip road arrived at Step 3 with nothing to count. */
    const created = skip
      ? await openChildForms(record, 'p3', DOCUMENT_KEY_LIST, userId)
      : await openChildForms(record, 'p2', wanted, userId);

    return {
      recordId: String(record._id),
      skipped: skip,
      created,
      /* Told, not guessed at: the caller navigates on this rather than
         re-deriving where the property went. */
      nextStage: skip ? 'commercial' : 'assessment',
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
    decision = 'approve', propertyIds = [], assessments = [], skip = false, reason,
  } = {}, user) {
    if (decision === 'reject') {
      const rejected = await franchiseService.decide(enquiryId, { decision: 'reject', reason }, user);
      return { decision: 'reject', enquiryId: String(rejected._id), nextStage: 'rejected' };
    }

    const wanted = skip ? [] : [...new Set(assessments)].filter((a) => ASSESSMENT_KEYS.has(a));
    if (!skip && wanted.length === 0) {
      throw ApiError.badRequest('Choose at least one assessment, or send it straight to commercial.');
    }

    /* 'loi' is the road that means "this is THE site" — it files one property
       as approved and stands the project at Phase 3. Going there with three
       properties ticked is not a thing anybody means, so franchiseService
       refuses it; saying so in this language beats relaying its wording. */
    if (skip && propertyIds.length > 1) {
      throw ApiError.badRequest('Going straight to commercial means one chosen site — tick just the one.');
    }

    const mode = skip ? 'loi' : 'assess';
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
      status: skip ? RECORD_STATUS.APPROVED : RECORD_STATUS.SHORTLISTED,
    });

    const routed = [];
    for (const rec of taken) {
      routed.push({
        recordId: String(rec._id),
        opened: skip
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
      nextStage: skip ? 'commercial' : 'assessment',
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
