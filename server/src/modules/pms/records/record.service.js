import mongoose from 'mongoose';
import { Record } from './record.model.js';
import { User } from '../../auth/auth.model.js';
import { Project } from '../projects/project.model.js';
import { Template } from '../templates/template.model.js';
import { activityService } from '../activity/activity.service.js';
import { projectService } from '../projects/project.service.js';
/* Rule 4's write-path guard. Imports flow.SERVICE, which reads the Record
   MODEL — not this service — so there is no import cycle. */
import { assertMayRaisePurchaseOrder, assertRateLineExplained } from '../flow/flow.service.js';
import { ApiError } from '../../../core/utils/ApiError.js';
import { logger } from '../../../config/logger.js';
import {
  RECORD_STATUS, ACTIVITY_ACTIONS, PROJECT_STATUS, can, PRE_LAUNCH_STAGE_KEYS, TASK_STATUS, LEADERSHIP,
} from '../../../core/constants/index.js';
import { Task } from '../tasks/task.model.js';
import {
  uploadBuffer,
  destroyAsset,
  isS3Configured,
} from '../../../config/s3.js';

/**
 * Tick off the task this form was somebody's job.
 *
 * WHY IT IS A JOIN RATHER THAN A LINK. The assessment task is created for the
 * PROPERTY (`subjectRecord`) and names which form it is (`formKey`), because
 * it exists from the moment the property is shortlisted — before the child
 * record for that form has been opened. So the pair that identifies the work
 * is (property, form), and that is what this looks up: the child record knows
 * its property (`parentRecordId`) and its form (`assessmentType`).
 *
 * ONLY ON THE WAY UP. It completes a task, never reopens one. Submitting the
 * same form twice must not undo a sign-off somebody has already given, and a
 * form edited after approval is a different conversation (see the frozen-
 * record rule in update()).
 *
 * BEST EFFORT, DELIBERATELY. Filing the form is the thing the person came to
 * do; if the task bookkeeping fails, their work is still saved and the task
 * can be ticked by hand. Failing the submit would lose the form.
 */
async function completeTaskForForm(record, userId) {
  if (!record?.parentRecordId || !record?.assessmentType) return;
  try {
    const now = new Date();
    const done = {
      $set: {
        status: TASK_STATUS.COMPLETE,
        completedAt: now,
        completedBy: userId,
        /**
         * `actualEnd` TOO — it is not decoration.
         *
         * Completing a task through the task service stamps it (see
         * task.service.js, the status transition); completing one by
         * SUBMITTING ITS FORM came through here and never did. So every
         * assessment and every closure document finished the normal way had
         * a `completedAt` and no `actualEnd` — and My Tasks' Completed tab
         * selects on `actualEnd`, so those tasks were finished, gone from
         * the open list, and absent from Completed. Thirty-one of the
         * forty-one completed tasks on this deployment are in that state.
         * MIS reads it for schedule variance as well.
         */
        actualEnd: now,
      },
    };
    const base = {
      project: record.project,
      stageKey: record.stageKey,
      formKey: record.assessmentType,
      status: { $ne: TASK_STATUS.COMPLETE },
    };

    /* The exact pair first: Phase 2 opens one task per property per form, so
       the property is what tells four otherwise identical tasks apart. */
    let res = await Task.updateOne({ ...base, subjectRecord: record.parentRecordId }, done);

    /**
     * AND THEN THE ONES THAT CARRY NO PROPERTY AT ALL.
     *
     * Phase 3's six documents are per PROJECT, not per property: a project
     * closes on one site, so its LOI task is simply "the LOI task", created
     * long before anybody knows which property it will be about. Requiring
     * `subjectRecord` matched nothing for the whole of closure, and every
     * filed LOI, lease and NOC left its task open.
     *
     * Only reached when the precise match found nothing, and still pinned to
     * one project, one stage and one form — so it cannot reach across to a
     * per-property task, which by definition has a `subjectRecord`.
     */
    if (!res.modifiedCount) {
      res = await Task.updateOne(
        { ...base, $or: [{ subjectRecord: null }, { subjectRecord: { $exists: false } }] },
        done,
      );
    }

    if (res.modifiedCount) {
      logger.info(`Task completed by filing ${record.assessmentType} on property ${record.parentRecordId}`);
    }
  } catch (err) {
    logger.warn(`Could not complete the task for ${record.assessmentType}: ${err.message}`);
  }
}


/**
 * Close a purchase step's task once the step has nothing left to do.
 *
 * ── WHY THIS IS NOT `completeTaskForForm` ─────────────────────────────
 * An assessment task is about ONE property, so filing its form finishes it.
 * A purchase task is about the whole project's BOQ: "Choose the vendor" is
 * one job covering forty lines, and picking a vendor for line three does not
 * finish it. Closing on the first write would tick off work that is barely
 * started — the opposite failure, and a worse one, because the sheet would
 * then say a step was done while thirty-seven lines sat waiting.
 *
 * So each step declares when it is SETTLED: nothing outstanding anywhere on
 * the project. The rules below are read off the lines themselves, so they
 * cannot drift from what the sheet shows.
 *
 * ── ONLY ON THE WAY UP ────────────────────────────────────────────────
 * A settled step closes its task; an unsettled one is left exactly as it is.
 * Nothing here reopens a task somebody has already finished — adding a
 * fortieth line to an approved BOQ must not silently undo the MD's sign-off
 * on the other thirty-nine. That is a decision for a person.
 *
 * BEST EFFORT. The line the person just wrote is the thing they came to do;
 * if the task bookkeeping fails, their work is saved and the task can be
 * ticked by hand. Failing the write would lose the line.
 */
const PURCHASE_STAGE_KEYS = ['p13', 'p15'];

/** A line nobody is going to buy — out of every count below. */
const isLiveLine = (r) => r.status !== RECORD_STATUS.REJECTED && r.status !== RECORD_STATUS.ARCHIVED;
const filled = (x) => String(x ?? '').trim().length > 0;
const DELIVERED = ['Delivered', 'Partly Received', 'Received (GRN)', 'Short / Damaged'];

/**
 * taskKey -> "is this step finished for the whole project?"
 *
 * `lines` is every live p13 BOQ line. A step with no lines at all is never
 * settled: an empty BOQ is a BOQ nobody has written yet, not one that is
 * done, and closing the steps behind it would mark a project complete before
 * it had ordered anything.
 */
const PURCHASE_SETTLED = {
  /* Every line submitted — nothing left with the builder. Matters now that
     the plan opens the BOQ as drafts: the build is finished when the builder
     has priced and submitted every one of them. */
  p13_t1: (lines) => lines.length > 0 && lines.every((r) => r.status !== RECORD_STATUS.DRAFT),

  /* Approved or sent back — either way the checker has ruled on it. */
  p13_t2: (lines) => lines.length > 0
    && lines.every((r) => r.status === RECORD_STATUS.APPROVED || r.status === RECORD_STATUS.REJECTED),

  /* Only approved lines are bought, so only they need a vendor. */
  p15_vendor: (lines) => {
    const buying = lines.filter((r) => r.status === RECORD_STATUS.APPROVED);
    return buying.length > 0 && buying.every((r) => filled(r.values?.vendor));
  },

  p15_t1: (lines) => {
    const ready = lines.filter((r) => r.status === RECORD_STATUS.APPROVED && filled(r.values?.vendor));
    return ready.length > 0 && ready.every((r) => filled(r.values?.po_number));
  },

  p15_track: (lines) => {
    const sent = lines.filter((r) => filled(r.values?.po_number));
    return sent.length > 0 && sent.every((r) => DELIVERED.includes(r.values?.order_status)
      || filled(r.values?.received_date));
  },

  p15_t3: (lines) => {
    const arrived = lines.filter((r) => DELIVERED.includes(r.values?.order_status)
      || filled(r.values?.received_date));
    return arrived.length > 0 && arrived.every((r) => filled(r.values?.grn_number)
      || r.values?.received_quantity != null);
  },
};

async function settlePurchaseTasks(projectId, userId) {
  if (!projectId) return;
  try {
    const lines = (await Record.find({ project: projectId, stageKey: 'p13' })
      .select('status values.vendor values.po_number values.order_status values.received_date values.grn_number values.received_quantity')
      .lean()).filter(isLiveLine);

    /* IN ORDER, AND ONLY WHILE EVERY STEP BEFORE IS DONE. Each rule reads
       the lines that have reached its step, so on its own the vendor rule
       said "finished" the moment ONE approved BOQ had a vendor — while five
       more were still waiting to be checked and would reach it later. A step
       is finished only when nothing more can still arrive at it, which is
       exactly when every step before it is finished too. */
    const settled = [];
    for (const [taskKey, done] of Object.entries(PURCHASE_SETTLED)) {
      if (!done(lines)) break;
      settled.push(taskKey);
    }
    if (!settled.length) return;

    const res = await Task.updateMany(
      {
        project: projectId,
        stageKey: { $in: PURCHASE_STAGE_KEYS },
        templateTaskKey: { $in: settled },
        status: { $ne: TASK_STATUS.COMPLETE },
      },
      { $set: { status: TASK_STATUS.COMPLETE, completedAt: new Date(), completedBy: userId } },
    );
    if (res.modifiedCount) {
      logger.info(`Purchase step(s) settled on ${projectId}: ${settled.join(', ')} — ${res.modifiedCount} task(s) closed`);
    }
  } catch (err) {
    logger.warn(`Could not settle the purchase tasks for ${projectId}: ${err.message}`);
  }
}


/**
 * Close the task whose whole job was to fill one form.
 *
 * ── WHY IT IS NOT `completeTaskForForm` ───────────────────────────────
 * That one joins on (property, form) because a Phase 2 assessment is one of
 * four forms about one of several properties. A single-form phase has
 * neither: Phase 4's plan is ONE record for the whole project, with no
 * `parentRecordId` and no `assessmentType`, so the join matched nothing and
 * the task stayed open after the plan was filed.
 *
 * ── AND NOT `settlePurchaseTasks` EITHER ──────────────────────────────
 * That one waits for a whole BOQ to be finished. Here one submission IS the
 * job — there is only ever one record — so it closes on the first.
 *
 * Only on the way up, and only on a real submission: a draft plan is a plan
 * somebody is still writing.
 */
const SINGLE_FORM_TASK = { p20: 'p20_games' };

async function completeSingleFormTask(record, userId) {
  const taskKey = SINGLE_FORM_TASK[record?.stageKey];
  if (!taskKey) return;
  try {
    const res = await Task.updateOne(
      {
        project: record.project,
        templateTaskKey: taskKey,
        status: { $ne: TASK_STATUS.COMPLETE },
      },
      { $set: { status: TASK_STATUS.COMPLETE, completedAt: new Date(), completedBy: userId } },
    );
    if (res.modifiedCount) {
      logger.info(`Task ${taskKey} completed by filing the ${record.stageKey} form on ${record.project}`);
    }
  } catch (err) {
    logger.warn(`Could not complete ${taskKey} after the ${record?.stageKey} form: ${err.message}`);
  }
}


/**
 * Open the project's BOQ the moment its plan is filed.
 *
 * ── WHAT IT WRITES, AND WHAT IT DOES NOT ─────────────────────────────
 * The plan names the games. The BOQ master (seed/boqMaster.js) names the six
 * BOQs every centre is bought against and what each one covers. Between them
 * they say, exactly, which pieces of purchasing this project owes: every
 * selected game needs its furniture, its electronics, its cameras, its
 * speakers and its central-facility procurement, and the centre needs one
 * common-area fit-out.
 *
 * So that is what is written — one line per game per BOQ, one lot each, in
 * the BOQ it belongs to, plus the common area once. What is NOT written is a
 * bill of materials: no game record in the system says a room needs twelve
 * speaker mounts, and inventing that would put numbers on a BOQ that nobody
 * chose. Quantity is "1 lot" and the rate is blank, so every line arrives
 * saying plainly what still has to be decided, and the Check step will not
 * let it through without a rate somebody has entered.
 *
 * The lines land as DRAFTS on Step 1, with the BOQ builder: generated work
 * is exactly the work that needs a person to price it and a second person
 * to check it before money is spent.
 *
 * ── ONCE ─────────────────────────────────────────────────────────────
 * Only when the project has no BOQ lines at all. Re-filing a plan, or filing
 * it after somebody has started a BOQ by hand, must not stack a second set of
 * lines on top of real ones — duplicate purchase lines are how a centre gets
 * two sets of speakers.
 *
 * Best effort: the plan is what the person came to file. If generation
 * fails, the plan is saved and the BOQ can still be written by hand.
 */
const BOQ_STAGE = 'p13';

/**
 * THE SIX BOQs, ONE LINE EACH — however many games the plan names.
 *
 * A BOQ is a DOCUMENT the business orders against: one electronics BOQ for
 * the whole centre, one cameras BOQ, one furniture BOQ, and so on. It is not
 * split per game — every game's sensors go on the one electronics order,
 * because that is how the vendor is paid and how the goods arrive. The first
 * version of this wrote a line per game per BOQ (31 for six games), which
 * turned six purchase orders into thirty-one fragments nobody orders by.
 *
 * So: six lines, named after their BOQ, in the order the business lists them
 * (seed/boqMaster.js). The games the plan chose ride along in the remarks so
 * whoever fills each BOQ knows what it has to cover.
 */
const BOQ_SIX = [
  ['All games furniture BOQ', 'Furniture', 'Props, sets and custom furniture'],
  ['All games electronic BOQ', 'Electrical', 'Sensors, RFID, control boxes and game logic'],
  ['All games cameras BOQ', 'AV', 'CCTV, game cameras and recorder'],
  ['All games speaker BOQ', 'AV', 'Audio, amplifiers and speaker runs'],
  ['Common area furniture BOQ', 'Furniture', 'Reception, waiting area, lockers and briefing room'],
  ['Procurement BOQ of all games', 'Game Props', 'Everything drawn from the central facility'],
];

export async function generateBoqFromPlan(record, userId) {
  if (record?.stageKey !== 'p20') return;
  try {
    const already = await Record.countDocuments({ project: record.project, stageKey: BOQ_STAGE });
    if (already) return;

    const games = (Array.isArray(record.values?.selected_games) ? record.values.selected_games : [])
      .map((g) => String(g || '').trim()).filter(Boolean);
    if (!games.length) return;
    const forGames = `For ${games.length} game${games.length === 1 ? '' : 's'}: ${games.join(', ')}.`;

    /* Through `create`, not a bulk insert: it numbers each line, derives its
       title, stamps the tenant and writes the activity — the same path a
       line written by hand takes, so a generated line is not a lesser one. */
    for (const [boqType, category, covers] of BOQ_SIX) {
      // eslint-disable-next-line no-await-in-loop
      await recordService.create({
        projectId: String(record.project),
        stageKey: BOQ_STAGE,
        /* DRAFT, because nothing is priced yet and the BOQ form requires a
           rate to submit. The builder fills it (Fill BOQ), which is what
           moves it to Step 2 for checking. */
        status: RECORD_STATUS.DRAFT,
        values: {
          boq_type: boqType,
          item: boqType,
          category,
          quantity: 1,
          unit: 'lot',
          description: covers,
          remarks: `Opened from the project plan. ${forGames} Fill in the items, quantity and rate, then submit it for checking.`,
        },
      }, userId);
    }
    logger.info(`BOQ opened from the plan on ${record.project}: 6 BOQs for ${games.length} game(s)`);
  } catch (err) {
    logger.warn(`Could not open the BOQ from the plan on ${record?.project}: ${err.message}`);
  }
}

/** Phase 4's single master form — mirrors MASTER_KEY in ProjectCreationPage.jsx. */
const P4_MASTER_KEY = 'project_creation';

/**
 * The approved LOI is the commercial commitment that starts property-level
 * Project Creation. Keep this on the write path, not in the browser: the MD
 * may approve from the approvals sheet, a task, or a record detail page and
 * every route must create the same hand-off exactly once.
 *
 * `p20` is the Project & Games form used by the property's “All Project
 * Creation” step. Its task is already allocated from the project's template;
 * opening a draft here makes that task actionable in My Tasks. The upsert-like
 * lookup keeps an LOI re-open/re-approve cycle from creating duplicate plans.
 */
async function startProjectCreationFromApprovedLoi(record, userId) {
  if (record.stageKey !== 'p3' || record.assessmentType !== 'loi' || !record.parentRecordId) return null;

  const property = await Record.findOne({ _id: record.parentRecordId, project: record.project, stageKey: 'p1' })
    .select('_id')
    .lean();
  if (!property) return null;

  await Record.updateOne(
    { _id: property._id },
    { $set: { routedTo: 'project' }, $unset: { routeWithdrawnAt: '' } },
  );

  const existing = await Record.findOne({ project: record.project, stageKey: 'p20' }).select('_id').lean();
  if (existing) return { propertyId: String(property._id), planId: String(existing._id), created: false };

  try {
    const plan = await recordService.create({
      projectId: String(record.project),
      stageKey: 'p20',
      status: RECORD_STATUS.DRAFT,
      values: {},
    }, userId);
    return { propertyId: String(property._id), planId: String(plan._id), created: true };
  } catch (err) {
    /* The LOI approval itself is authoritative and must not be rolled back by
       a missing optional project-plan schema. The row is still routed to Step
       7, where the normal Start action can recover the draft. */
    logger.warn(`Could not open Project Creation after LOI approval on ${record.project}: ${err.message}`);
    return { propertyId: String(property._id), planId: null, created: false };
  }
}

/** A rejected document becomes the doer's work again, not a completed task. */
async function reopenCommercialDocumentTask(record) {
  if (record.stageKey !== 'p3' || !record.assessmentType) return;
  await Task.updateOne(
    {
      project: record.project,
      stageKey: 'p3',
      formKey: record.assessmentType,
      $or: [{ subjectRecord: null }, { subjectRecord: { $exists: false } }],
    },
    {
      $set: { status: TASK_STATUS.PENDING },
      $unset: { completedAt: '', completedBy: '', actualEnd: '' },
    },
  );
}

/** Phase 7 — Approval Workflow. */
const P7_STAGE_KEY = 'p7';

/**
 * Phase 7's assessmentTypes are an ORDERED gate sequence (Department Review →
 * Functional Review → Finance Approval → Legal Review → Management Approval →
 * Final Approval), unlike every other stage's unordered form set. Approving
 * one tier therefore requires every earlier tier to already be Approved for
 * the same property — no skipping ahead to Final Approval, and no approving
 * out of order. Rejection is always allowed at any tier.
 *
 * The order comes from the template itself, so adding or reordering a gate
 * needs no code change here.
 */
async function assertApprovalTierOrder(record, decision) {
  if (decision !== 'approve') return;
  if (!record.assessmentType || !record.parentRecordId) return;

  const { assessmentTypes } = await loadStageContext(record.project, record.stageKey);
  const order = assessmentTypes.map((t) => t.key);
  const idx = order.indexOf(record.assessmentType);
  if (idx <= 0) return; // unknown type, or the first gate — nothing precedes it

  const earlier = order.slice(0, idx);
  const approved = await Record.find({
    project: record.project,
    stageKey: record.stageKey,
    parentRecordId: record.parentRecordId,
    assessmentType: { $in: earlier },
    status: RECORD_STATUS.APPROVED,
  }).select('assessmentType');

  const cleared = new Set(approved.map((r) => r.assessmentType));
  const pending = earlier.filter((k) => !cleared.has(k));
  if (pending.length) {
    const nameOf = (k) => assessmentTypes.find((t) => t.key === k)?.name || k;
    throw ApiError.badRequest(
      `${nameOf(record.assessmentType)} can’t be approved yet — ${pending.map(nameOf).join(', ')} ${pending.length === 1 ? 'is' : 'are'} still outstanding.`,
      { code: 'APPROVAL_OUT_OF_ORDER', details: pending },
    );
  }
}

const DECISION_MAP = {
  draft: RECORD_STATUS.DRAFT,
  under_review: RECORD_STATUS.SUBMITTED,
  shortlist: RECORD_STATUS.SHORTLISTED,
  evaluation_in_progress: RECORD_STATUS.EVALUATION_IN_PROGRESS,
  reject: RECORD_STATUS.REJECTED,
  approve: RECORD_STATUS.APPROVED,
  archive: RECORD_STATUS.ARCHIVED,
  lock: RECORD_STATUS.LOCKED,
};

/** Mirrors recordUi.js's RECORD_STATUS_META labels — kept small and local so the audit/activity message reads naturally instead of a raw enum value. */
const STATUS_LABELS = {
  [RECORD_STATUS.DRAFT]: 'Draft',
  [RECORD_STATUS.SUBMITTED]: 'Under Review',
  [RECORD_STATUS.SHORTLISTED]: 'Shortlisted',
  [RECORD_STATUS.EVALUATION_IN_PROGRESS]: 'Evaluation In Progress',
  [RECORD_STATUS.REJECTED]: 'Rejected',
  [RECORD_STATUS.APPROVED]: 'Approved',
  [RECORD_STATUS.ARCHIVED]: 'Archived',
  [RECORD_STATUS.LOCKED]: 'Locked',
};

/**
 * Stages whose "all workflows done" event fires on manager approval of every
 * assessment type, and whose assessment types allow unlimited resubmissions
 * per workflow (see maybeLogDecisionGatedStageCompleted / submissionNoFor) —
 * a stage joining this list needs no new completion-logging code, just its
 * own assessmentTypes in the template. Currently every assessment-type stage
 * (Site Evaluation, Commercial Finalization, Project Creation, Department
 * Planning, Approval Workflow, Store Readiness Checklist, Store Launch) is
 * decision-gated.
 */
const DECISION_GATED_STAGES = new Set(['p2', 'p3', 'p4', 'p5', 'p7', 'p8', 'p9', 'p10']);

const isEmpty = (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0);

/**
 * Statuses that represent a decision already taken by a reviewer. A record
 * sitting in one of these was reviewed on the strength of its values, and
 * every downstream consumer (the scoring engine, Phase 2/3 approvals, stage
 * completion gates) trusts that those values are what was actually reviewed
 * — so they're frozen until the decision is explicitly undone.
 */
const DECIDED_STATUSES = new Set([
  RECORD_STATUS.SHORTLISTED,
  RECORD_STATUS.APPROVED,
  RECORD_STATUS.REJECTED,
  RECORD_STATUS.ARCHIVED,
  RECORD_STATUS.LOCKED,
]);

/**
 * Which decisions are legal from a record's current status. The UI already
 * only offers Shortlist/Reject on a `submitted` record — this is the
 * server-side half of that rule, so a direct API call can't re-shortlist a
 * rejected record, decide an already-locked one, or apply a p2/p3-only
 * decision to a record that never entered review. `undoDecision()` remains
 * the one sanctioned way back to `submitted`.
 */
const LEGAL_DECISIONS_BY_STATUS = {
  [RECORD_STATUS.DRAFT]: ['draft', 'under_review'],
  [RECORD_STATUS.SUBMITTED]: [
    'draft', 'under_review', 'shortlist', 'evaluation_in_progress',
    'reject', 'approve', 'archive', 'lock',
  ],
  [RECORD_STATUS.EVALUATION_IN_PROGRESS]: ['shortlist', 'reject', 'approve', 'archive', 'lock'],
  // 'shortlist' from SHORTLISTED is NOT a no-op: Site Evaluation's own
  // Approve button re-issues decide('shortlist') on a property that Phase 1
  // already shortlisted — that second decision (and its fresh `decidedAt`)
  // is precisely what marks the property approved at Phase 2. See
  // isPropertyApprovedAtP2 in project.service.js.
  [RECORD_STATUS.SHORTLISTED]: ['shortlist', 'evaluation_in_progress', 'reject', 'approve', 'archive', 'lock'],
  [RECORD_STATUS.APPROVED]: ['archive', 'lock'],
  [RECORD_STATUS.REJECTED]: ['archive'],
  [RECORD_STATUS.ARCHIVED]: [],
  [RECORD_STATUS.LOCKED]: [],
};

/**
 * Decisions a STAGE simply does not have, whatever a record's status allows.
 *
 * PHASE 1 SHORTLISTS CANDIDATES; IT NEVER APPROVES THEM. A property is
 * captured, then shortlisted or rejected — and the one that eventually wins is
 * marked by a SECOND shortlist decision after Site Evaluation, not by
 * "approve" (see isPropertyApprovedAtP2, which requires `status ===
 * SHORTLISTED` and will never recognise an approved record).
 *
 * So an approved Phase 1 property is not a cosmetic wrong label. It is a
 * property that can never be selected: Site Evaluation cannot resolve it,
 * Commercial Finalization cannot find it, and the project silently stops
 * being able to progress with no error anywhere saying why. It happened
 * because the Approvals queue offered a generic Approve button on every
 * submitted record, and the status table below — which only ever asked what
 * the record's CURRENT status permits — had no opinion about the phase.
 */
const STAGE_DECISION_BANS = Object.freeze({
  p1: {
    approve: 'Properties are shortlisted or rejected at Phase 1, never approved. '
      + 'Use Shortlist — the property is then approved later, at Site Evaluation, '
      + 'once its assessments are in.',
  },
});

/**
 * Phase 10's Archive Project makes the whole project read-only — enforced
 * here (not only in the UI) so an archived project's records can't be
 * created, edited or decided through a direct API call. `stageKey`, when
 * passed, additionally enforces the Store Launch Lock: a pre-launch-phase
 * record (p1-p8) becomes read-only the moment project.status hits
 * STORE_LIVE, matching the Confirm Launch modal's own "Phases 1-8 become
 * read-only" promise — previously only a UI claim, never enforced here.
 * p9/p10 are deliberately exempt — see PRE_LAUNCH_STAGE_KEYS.
 */
async function assertProjectNotArchived(projectId, stageKey) {
  const project = await Project.findById(projectId).select('status');
  if (project?.status === PROJECT_STATUS.ARCHIVED) {
    throw ApiError.badRequest('This project is archived and read-only.');
  }
  if (
    stageKey
    && PRE_LAUNCH_STAGE_KEYS.includes(stageKey)
    && project?.status === PROJECT_STATUS.STORE_LIVE
  ) {
    throw ApiError.badRequest(
      'The store has gone live — earlier-phase work is now read-only history and can no longer be edited.',
      { code: 'PROJECT_LIVE_READ_ONLY' },
    );
  }
}

/** Compact reference for activity messages, e.g. `#3 "Title"`. */
const labelOf = (r) => (r.seq ? `#${r.seq} "${r.title}"` : `"${r.title}"`);

/**
 * THE OTHER HALF OF THE BELL: telling the MD that something is waiting on
 * THEM.
 *
 * Every notification this app sent was about work going OUT — a task landing
 * on a doer. Nothing was sent when work came BACK, which meant the one person
 * whose entire job in this flow is answering (route it, shortlist it, approve
 * the paperwork) was the only person never told there was anything to answer.
 * They found out by opening the queue and looking, which is the thing a
 * notification exists to replace.
 *
 * NARROW ON PURPOSE. This runs inside the record service, which every module
 * files through — design drawings, purchase, checklists, the lot. A hook here
 * that fired on everything would ring the MD's bell for every row anybody
 * saves anywhere, and a bell that rings for everything is a bell nobody
 * reads. So it answers to exactly three stages of the Property FMS and
 * returns immediately for anything else.
 *
 * FIRE AND FORGET. A filing must succeed even when the bell cannot be
 * written; everything below is swallowed.
 */
const PROPERTY_CAPTURE_STAGE = 'p1';
const PROPERTY_ASSESSMENT_STAGE = 'p2';
const PROPERTY_COMMERCIAL_STAGE = 'p3';

async function notifyPropertyFiling(record, userId) {
  try {
    const stageKey = record?.stageKey;
    const STAGES = [PROPERTY_CAPTURE_STAGE, PROPERTY_ASSESSMENT_STAGE, PROPERTY_COMMERCIAL_STAGE];
    if (!STAGES.includes(stageKey)) return;

    const { propertyNotify } = await import('../propertyCapture/propertyNotify.js');
    const actor = userId ? await User.findById(userId).select('name').lean() : null;
    const actorName = actor?.name || null;

    /* ── a property has been captured: the MD owes it a road ──────────── */
    if (stageKey === PROPERTY_CAPTURE_STAGE) {
      await propertyNotify.decisionNeeded({
        property: { title: record.title || record.values?.property_name || 'A property', city: record.values?.city || record.values?.location || '' },
        projectId: record.project,
        /* The queue ids a captured property as `rec:<id>` — see the list
           builder in propertyCapture.service. */
        rowId: `rec:${record._id}`,
        actorId: userId,
        actorName,
      });
      return;
    }

    /* ── a commercial document has been filed: the MD owes it a verdict ─ */
    if (stageKey === PROPERTY_COMMERCIAL_STAGE) {
      /* Only the five closure documents. p3 carries other children too,
         and the MD does not approve those. */
      const { DOCUMENTS } = await import('../propertyCapture/propertyCapture.service.js');
      const doc = DOCUMENTS.find((d) => d.key === record.assessmentType);
      if (!doc) return;
      const owner = record.parentRecordId
        ? await Record.findById(record.parentRecordId).select('title values').lean()
        : null;
      await propertyNotify.approvalNeeded({
        property: { title: owner?.title || '', city: owner?.values?.city || '' },
        projectId: record.project,
        documentLabel: doc.label,
        actorId: userId,
        actorName,
      });
      return;
    }

    /* ── an assessment has been filed ─────────────────────────────────── */

    /* WHICH assessments this property was sent for, and how many are in.
       The children ARE the selection — Step 2 records the MD's choice by
       opening one child form per ticked assessment, so counting them is
       reading the decision itself rather than guessing at four. */
    const parentId = record.parentRecordId;
    if (!parentId) return;

    const siblings = await Record.find({
      project: record.project,
      stageKey: PROPERTY_ASSESSMENT_STAGE,
      parentRecordId: parentId,
    }).select('status assessmentType').lean();

    const total = siblings.length;
    const filed = siblings.filter((s) => s.status !== RECORD_STATUS.DRAFT).length;
    if (!total) return;

    const parent = await Record.findById(parentId).select('title values').lean();
    const property = {
      title: parent?.title || '',
      city: parent?.values?.city || parent?.values?.location || '',
    };

    /**
     * EVERY FILING RINGS, AND THE LAST ONE RINGS TWICE — for two different
     * reasons.
     *
     * This used to `return` unless `filed === total`, so a property sent for
     * four assessments said nothing at all until the fourth landed. The
     * thinking was that the Step 4 shortlist cannot be taken before then,
     * which is true and is not the whole job: each assessment arrives
     * `submitted`, and a submitted record is an approval somebody owes. The
     * doer who filed the first one was waiting on an MD who had not been
     * told it existed.
     *
     * So the per-assessment bell goes on every filing, carrying the count so
     * three of them never read as the same message three times. The
     * ready-to-shortlist bell still fires once, when the last one lands, and
     * says the thing only it can say.
     */
    const { ASSESSMENTS } = await import('../propertyCapture/propertyCapture.service.js');
    const label = ASSESSMENTS.find((a) => a.key === record.assessmentType)?.label;

    await propertyNotify.assessmentFiled({
      property,
      projectId: record.project,
      assessmentLabel: label,
      filed,
      total,
      actorId: userId,
      actorName,
    });

    if (filed < total) return;

    await propertyNotify.readyToShortlist({
      property,
      projectId: record.project,
      filed,
      total,
      actorId: userId,
      actorName,
    });
  } catch (err) {
    logger.warn('Property notification skipped', { error: err.message });
  }
}


/**
 * Load the stage + its master-data schema (which lives on the template). When
 * `assessmentType` is given, the schema instead comes from that entry in the
 * stage's `assessmentTypes` (e.g. Site Evaluation's Feasibility/Financial/
 * Technical/Operational forms) — one stage, several independent schemas.
 */
async function loadStageContext(projectId, stageKey, assessmentType) {
  const project = await Project.findById(projectId).select('stages template');
  if (!project) throw ApiError.notFound('Project not found');
  const stage = project.stages.find((s) => s.key === stageKey);
  if (!stage) throw ApiError.badRequest(`Unknown stage "${stageKey}" for this project`);

  const templateId = project.template?.ref;
  const template = templateId ? await Template.findById(templateId).select('stages') : null;
  const templateStage = template?.stages?.find((s) => s.key === stageKey);

  // Fail loudly rather than falling through with an empty schema: an empty
  // schema makes assertRequired() a silent no-op, so a missing/deleted
  // template would let records be submitted and approved with no field
  // validation at all and no error surfaced anywhere.
  if (templateId && !template) {
    throw ApiError.badRequest(
      'This project’s template no longer exists, so its forms can’t be validated. Restore the template before filing records.',
    );
  }

  const allAssessmentTypes = templateStage?.assessmentTypes || [];
  if (assessmentType) {
    const type = allAssessmentTypes.find((a) => a.key === assessmentType);
    if (!type) {
      throw ApiError.badRequest(`Unknown assessment type "${assessmentType}" for stage "${stageKey}"`);
    }
    return {
      project,
      stage,
      schema: type.masterDataSchema || [],
      assessmentName: type.name,
      assessmentTypes: allAssessmentTypes,
    };
  }

  const schema = templateStage?.masterDataSchema || [];
  return { project, stage, schema, assessmentName: undefined, assessmentTypes: allAssessmentTypes };
}

/**
 * 1-based submission number for an assessment-type record, scoped to its own
 * (project, stage, parent, assessmentType) — counts how many sibling records
 * were created before it. Every assessment type across every stage supports
 * unlimited resubmissions, so this is what activity messages ("Feasibility
 * Assessment Submission #2 …") use to identify which submission changed;
 * it's recomputed from creation order rather than stored, so it never
 * drifts even if an earlier submission is later deleted.
 */
async function submissionNoFor(record) {
  if (!record.assessmentType || !record.parentRecordId) return null;
  const earlierCount = await Record.countDocuments({
    project: record.project,
    stageKey: record.stageKey,
    parentRecordId: record.parentRecordId,
    assessmentType: record.assessmentType,
    createdAt: { $lt: record.createdAt },
  });
  return earlierCount + 1;
}

/**
 * For a DECISION_GATED_STAGES stage: once every workflow in the stage's
 * (template-driven) assessmentTypes has at least one Approved record against
 * the same parent, log one summary event — "at least one", not "the latest",
 * because these stages allow multiple resubmissions per workflow (a later
 * draft/rejected resubmission after approval doesn't undo an already-earned
 * Approved). Guards against a duplicate log if a later re-approval
 * re-triggers the same all-approved state.
 */
async function maybeLogDecisionGatedStageCompleted(record, stage, assessmentTypes, userId) {
  const keys = (assessmentTypes || []).map((t) => t.key);
  if (!keys.length) return;

  const approvedSiblings = await Record.find({
    project: record.project,
    stageKey: record.stageKey,
    parentRecordId: record.parentRecordId,
    status: RECORD_STATUS.APPROVED,
  }).select('assessmentType');
  const approvedKeys = new Set(approvedSiblings.map((r) => r.assessmentType));
  if (!keys.every((k) => approvedKeys.has(k))) return;

  const parent = await Record.findById(record.parentRecordId).select('title seq');
  const message = `${stage.name} completed for ${parent ? labelOf(parent) : 'the property'}`;

  const alreadyLogged = await Record.db.model('Activity').findOne({ project: record.project, message });
  if (alreadyLogged) return;

  await activityService.log({
    project: record.project,
    entityType: 'record',
    entityId: record.parentRecordId,
    action: ACTIVITY_ACTIONS.COMPLETED,
    actor: userId,
    message,
    meta: { stageKey: record.stageKey, recordId: String(record.parentRecordId) },
  });
}


/** Row title = the first required text-ish value, falling back to common keys. */
function deriveTitle(values = {}, schema = []) {
  const titleField = schema.find((f) => f.required && (f.type === 'text' || !f.type));
  const fromSchema = titleField ? values[titleField.key] : undefined;
  return fromSchema || values.property_name || values.name || values.title || 'Untitled';
}

/**
 * Mirror of the client's showIf visibility rule (RecordFormModal). The
 * template schema stores `showIf.in` as strings ([String] coercion turns
 * `true` into 'true'), so both sides compare as strings.
 */
function isFieldVisible(field, values = {}) {
  const cond = field?.showIf;
  if (!cond?.field) return true;
  const v = values[cond.field];
  return (cond.in || []).some((x) => String(x) === String(v));
}

/**
 * Enforce required fields when a record is submitted (drafts skip this).
 * A field hidden by its showIf condition is NOT required: the form never
 * showed it, so demanding it 400s every submission that answered "No" to
 * the question that reveals it (the daily report's blocker details did
 * exactly that).
 */
function assertRequired(values = {}, schema = []) {
  const missing = schema
    .filter((f) => f.required && isFieldVisible(f, values) && isEmpty(values[f.key]))
    .map((f) => ({ field: f.key, message: `${f.label} is required` }));
  if (missing.length) {
    throw ApiError.badRequest('Please complete all required fields before submitting', {
      details: missing,
      code: 'REQUIRED_FIELDS_MISSING',
    });
  }
}

async function logRecord(record, action, actor, message) {
  await activityService.log({
    project: record.project,
    entityType: 'record',
    entityId: record._id,
    action,
    actor,
    message,
    meta: {
      stageKey: record.stageKey,
      recordId: String(record._id),
      parentRecordId: record.parentRecordId ? String(record.parentRecordId) : undefined
    },
  });
}

/**
 * Assessment-type keys marked `noDecision` on any template — the forms that are
 * logs rather than submissions (the Daily Site Report). Read from the templates
 * so adding another log form needs no change here.
 */
async function logFormKeys() {
  const templates = await Template.find({ 'stages.assessmentTypes.noDecision': true })
    .select('stages.assessmentTypes.key stages.assessmentTypes.noDecision');
  const keys = new Set();
  for (const template of templates) {
    for (const stage of template.stages || []) {
      for (const type of stage.assessmentTypes || []) if (type.noDecision) keys.add(type.key);
    }
  }
  return [...keys];
}

export const recordService = {
  /**
   * HOW MANY ARE WAITING - and nothing else.
   *
   * The sidebar draws a number on the Approvals entry, and it was getting that
   * number by asking for EVERY submitted record in the business, with its
   * project and its author populated, and then reading `.length`. Sixty
   * kilobytes, on every page, for every person who can approve something, to
   * render two digits.
   *
   * Same filter as the approval queue in `list` below - including the daily-log
   * exclusion, or the badge would promise decisions that are not on the page.
   */
  async pendingCount() {
    const filter = { status: RECORD_STATUS.SUBMITTED };
    const logs = await logFormKeys();
    if (logs.length) filter.assessmentType = { $nin: logs };
    return Record.countDocuments(filter);
  },

  async list(query = {}) {
    const filter = {};
    if (query.projectId) filter.project = query.projectId;
    if (query.stageKey) filter.stageKey = query.stageKey;
    if (query.status) filter.status = query.status;
    if (query.parentRecordId) filter.parentRecordId = query.parentRecordId;
    if (query.assessmentType) filter.assessmentType = query.assessmentType;

    /* The approvals queue asks for every submitted record everywhere
       (status=submitted, no project, no type). Daily site reports are filed as
       `submitted` too — that is what "filed" means for a record — so without
       this every diary entry from every site would queue up behind the
       decisions that actually need a human. A caller asking for a specific
       project, stage or type still gets them; only the global queue filters.
       `$nin` also matches records with no assessmentType at all, so ordinary
       records are unaffected. */
    const isApprovalQueue = query.status === RECORD_STATUS.SUBMITTED
      && !query.projectId && !query.assessmentType && !query.stageKey;
    if (isApprovalQueue) {
      const logs = await logFormKeys();
      if (logs.length) filter.assessmentType = { $nin: logs };
    }

    return Record.find(filter)
      .sort({ createdAt: -1 })
      // `city` is not decoration: the master lists (Vendors, Approvals) show
      // records from every project at once, where a bare project name says
      // nothing about WHERE the work is. Same select the task queries already
      // use, so both halves of the approvals page can show the same breadcrumb.
      .populate('project', 'name code city')
      .populate('createdBy', 'name role avatarColor title')
      .populate('updatedBy', 'name role avatarColor title')
      .populate('submittedBy', 'name role avatarColor title')
      .populate('approvedBy', 'name role avatarColor title')
      .populate('rejectedBy', 'name role avatarColor title')
      .populate('shortlistedBy', 'name role avatarColor title')
      .populate('decidedBy', 'name role avatarColor title')
      .populate('comments.author', 'name role avatarColor title')
      .populate('changeLog.by', 'name role avatarColor title');
  },

  /**
   * Update an order's TRACKING fields — PO/indent numbers, send stamps, vendor
   * status, dispatch and receipt details. The Phase 6 tracker writes here.
   *
   * Deliberately separate from update(): a BOQ line is approved in Phase 5 and
   * its values are frozen from then on (see DECIDED_STATUSES), but what
   * happened to that order afterwards must still be recordable. Only fields
   * the template marks `tracker: true` are writable here, so the approved
   * content (item, quantity, rate, vendor) stays exactly what was signed off.
   * Every change is appended to `changeLog` with who and when.
   */
  async updateTracking(id, { values = {}, note } = {}, userId) {
    const record = await Record.findById(id);
    if (!record) throw ApiError.notFound('Record not found');
    await assertProjectNotArchived(record.project, record.stageKey);

    const { stage, schema } = await loadStageContext(record.project, record.stageKey, record.assessmentType);
    const trackable = new Map(schema.filter((f) => f.tracker).map((f) => [f.key, f]));
    if (!trackable.size) {
      throw ApiError.badRequest('This phase has no tracking fields.', { code: 'NO_TRACKER_FIELDS' });
    }
    const unknown = Object.keys(values).filter((k) => !trackable.has(k));
    if (unknown.length) {
      throw ApiError.badRequest(`Not a tracking field: ${unknown.join(', ')}`, {
        code: 'NOT_TRACKER_FIELD', details: unknown,
      });
    }

    /**
     * Rule 4 — nothing is ordered before a contract exists.
     *
     * Raising a purchase order happens HERE, by writing a PO number or a sent
     * timestamp onto a BOQ line, so this is where the rule has to hold. The
     * screen greys the same lines out, but a rule only the UI knows is a
     * suggestion: without this, a POST straight to the API raises an order
     * against a vendor who never signed anything.
     *
     * It deliberately no-ops on projects with no Contracts phase — see
     * flow.service.js#contractRuleApplies for why applying it retroactively
     * would be an outage rather than a control.
     */
    await assertMayRaisePurchaseOrder({
      projectId: record.project,
      recordId: record._id,
      stageKey: record.stageKey,
      values,
      previous: record.values || {},
    });

    const current = { ...(record.values || {}) };
    const now = new Date();
    const changes = [];
    for (const [key, next] of Object.entries(values)) {
      const prev = current[key];
      const same = (isEmpty(prev) && isEmpty(next)) || String(prev ?? '') === String(next ?? '');
      if (same) continue;
      changes.push({
        field: key,
        label: trackable.get(key).label || key,
        from: isEmpty(prev) ? null : prev,
        to: isEmpty(next) ? null : next,
        note,
        by: userId,
        at: now,
      });
      if (isEmpty(next)) delete current[key]; else current[key] = next;
    }
    if (!changes.length) return this.getById(id);

    record.values = current;
    record.markModified('values');
    record.changeLog.push(...changes);
    record.updatedBy = userId;
    await record.save();

    const noun = stage.recordNoun || 'Record';
    const summary = changes.map((c) => `${c.label}: ${c.from ?? '—'} → ${c.to ?? '—'}`).join('; ');
    await logRecord(record, ACTIVITY_ACTIONS.UPDATED, userId, `${noun} ${labelOf(record)} — ${summary}`);

    /* Vendor, PO number, delivery status and the GRN all arrive through this
       one call, so this is where a purchase step can become finished. */
    if (record.stageKey === 'p13') await settlePurchaseTasks(record.project, userId);

    return this.getById(id);
  },

  /**
   * The deposit ledger: money actually received, instalment by instalment.
   *
   * A franchise deposit is rarely one payment. The agreed figure comes from the
   * LOI ("security_deposit"), and what arrives against it turns up in parts,
   * weeks apart, each with its own UTR and its own receipt. The form captured a
   * single payment, so the second instalment had nowhere to go and the honest
   * answer to "how much have we actually received?" lived in somebody's inbox.
   *
   * Every payment is appended, never edited in place, and carries who recorded
   * it and when. `deposit_received` and `deposit_balance` are recomputed here
   * rather than typed, so the arithmetic cannot drift from the entries.
   *
   * Allowed on an APPROVED record on purpose — the same reasoning as the order
   * tracker: an instalment paid in September is not a change to what was
   * agreed in June, it is what happened afterwards.
   */
  async addPayment(id, data, userId) {
    const record = await Record.findById(id);
    if (!record) throw ApiError.notFound('Record not found');
    await assertProjectNotArchived(record.project, record.stageKey);

    const amount = Number(data.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw ApiError.badRequest('Enter the amount received.', { code: 'BAD_AMOUNT' });
    }

    const values = { ...(record.values || {}) };
    const payments = Array.isArray(values.deposit_payments) ? [...values.deposit_payments] : [];
    const who = await User.findById(userId).select('name');
    const entry = {
      id: new mongoose.Types.ObjectId().toString(),
      amount,
      paidOn: data.paidOn || new Date().toISOString().slice(0, 10),
      mode: data.mode || null,
      reference: data.reference || null,
      note: data.note || null,
      proof: Array.isArray(data.proof) ? data.proof.slice(0, 5) : [],
      byId: userId ? String(userId) : null,
      byName: who?.name || null,
      at: new Date().toISOString(),
    };
    payments.push(entry);

    values.deposit_payments = payments;
    values.deposit_received = payments.reduce((n, p) => n + (Number(p.amount) || 0), 0);
    const agreed = Number(values.security_deposit);
    values.deposit_balance = Number.isFinite(agreed) ? Math.max(agreed - values.deposit_received, 0) : null;

    record.values = values;
    record.markModified('values');
    record.changeLog.push({
      field: 'deposit_payments',
      label: 'Payment received',
      from: null,
      to: `₹${amount.toLocaleString('en-IN')}${entry.mode ? ` by ${entry.mode}` : ''}${entry.reference ? ` (${entry.reference})` : ''}`,
      note: data.note || undefined,
      by: userId,
      at: new Date(),
    });
    record.updatedBy = userId;
    await record.save();

    await logRecord(record, ACTIVITY_ACTIONS.UPDATED, userId,
      `Deposit payment of ₹${amount.toLocaleString('en-IN')} recorded — ₹${values.deposit_received.toLocaleString('en-IN')} received so far`);
    return this.getById(id);
  },

  /**
   * Remove a payment that was entered in error.
   *
   * Kept as a real deletion of the ENTRY but a permanent line in the change
   * log: a wrong instalment must be correctable, and a ledger that cannot be
   * corrected gets abandoned for a spreadsheet — but money moving out of the
   * running total is exactly the kind of edit that has to leave a mark.
   */
  async removePayment(id, paymentId, userId) {
    const record = await Record.findById(id);
    if (!record) throw ApiError.notFound('Record not found');
    await assertProjectNotArchived(record.project, record.stageKey);

    const values = { ...(record.values || {}) };
    const payments = Array.isArray(values.deposit_payments) ? [...values.deposit_payments] : [];
    const gone = payments.find((p) => String(p.id) === String(paymentId));
    if (!gone) throw ApiError.notFound('That payment is not on this record');

    values.deposit_payments = payments.filter((p) => String(p.id) !== String(paymentId));
    values.deposit_received = values.deposit_payments.reduce((n, p) => n + (Number(p.amount) || 0), 0);
    const agreed = Number(values.security_deposit);
    values.deposit_balance = Number.isFinite(agreed) ? Math.max(agreed - values.deposit_received, 0) : null;

    record.values = values;
    record.markModified('values');
    record.changeLog.push({
      field: 'deposit_payments',
      label: 'Payment removed',
      from: `₹${Number(gone.amount).toLocaleString('en-IN')}${gone.reference ? ` (${gone.reference})` : ''}`,
      to: null,
      by: userId,
      at: new Date(),
    });
    record.updatedBy = userId;
    await record.save();

    await logRecord(record, ACTIVITY_ACTIONS.UPDATED, userId,
      `Deposit payment of ₹${Number(gone.amount).toLocaleString('en-IN')} removed`);
    return this.getById(id);
  },

  async getById(id) {
    const record = await Record.findById(id)
      .populate('createdBy', 'name role avatarColor title')
      .populate('updatedBy', 'name role avatarColor title')
      .populate('submittedBy', 'name role avatarColor title')
      .populate('approvedBy', 'name role avatarColor title')
      .populate('rejectedBy', 'name role avatarColor title')
      .populate('shortlistedBy', 'name role avatarColor title')
      .populate('decidedBy', 'name role avatarColor title')
      .populate('comments.author', 'name role avatarColor title')
      .populate('changeLog.by', 'name role avatarColor title');
    if (!record) throw ApiError.notFound('Record not found');
    return record;
  },

  async create(data, userId) {
    await assertProjectNotArchived(data.projectId, data.stageKey);
    const { stage, schema, assessmentName } = await loadStageContext(
      data.projectId,
      data.stageKey,
      data.assessmentType,
    );
    const status = data.status || RECORD_STATUS.SUBMITTED;
    const values = data.values || {};
    if (status === RECORD_STATUS.SUBMITTED) assertRequired(values, schema);
    /* A rate that differs from the panel's standard one must say why — a rule
       about two fields together, which `required: true` cannot express.
       See flow.service.js#assertRateLineExplained. */
    if (data.assessmentType === 'rate_line') assertRateLineExplained(values);

    const submitted = status === RECORD_STATUS.SUBMITTED;

    // Stable sequential number, scoped to this project's stage. Continues from
    // the highest existing seq so deletions never renumber surviving records.
    //
    // Read-then-write is inherently racy: two submissions filed at the same
    // moment both read the same highest seq and both claim it, so the
    // "Property No." users cite can end up shared by two records. The loop
    // below re-reads and retries on a duplicate-key rejection, which is what
    // makes it safe once the unique {project, stageKey, seq} index exists —
    // see seed/migrateRecordSeqUniqueness.js, which repairs the existing
    // duplicates and creates that index. Until it has been run the retry is
    // simply inert, and behaviour is exactly as before.
    const MAX_ATTEMPTS = 5;
    let record = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const last = await Record.findOne({ project: data.projectId, stageKey: data.stageKey })
        .sort({ seq: -1 })
        .select('seq');
      const seq = (last?.seq || 0) + 1;
      try {
        record = await Record.create({
          project: data.projectId,
          stageKey: data.stageKey,
          assessmentType: data.assessmentType,
          parentRecordId: data.parentRecordId,
          // Only set when the form was opened from a task — see Record.task.
          task: data.taskId || undefined,
          seq,
          // Fallback chain ends at the stage's recordNoun: a Project Plan
          // whose schema has no required text field used to queue for the
          // MD's approval as "Untitled", which names nothing.
          title: assessmentName
            || (deriveTitle(values, schema) !== 'Untitled' ? deriveTitle(values, schema) : null)
            || stage.recordNoun
            || 'Untitled',
          values,
          status,
          attachments: data.attachments || [],
          submittedAt: submitted ? new Date() : undefined,
          submittedBy: submitted ? userId : undefined,
          createdBy: userId,
          updatedBy: userId,
        });
        break;
      } catch (err) {
        const isDuplicateSeq = err?.code === 11000 && JSON.stringify(err.keyPattern || {}).includes('seq');
        if (!isDuplicateSeq || attempt === MAX_ATTEMPTS) throw err;
        logger.warn(`Record seq ${seq} was taken concurrently — retrying (${attempt}/${MAX_ATTEMPTS})`);
      }
    }

    const noun = stage.recordNoun || 'Record';
    const message = data.assessmentType
      ? `New ${assessmentName.toLowerCase()} submitted.`
      : `${noun} ${labelOf(record)} ${submitted ? 'submitted' : 'saved as draft'}`;
    await logRecord(record, ACTIVITY_ACTIONS.CREATED, userId, message);

    /**
     * FILING THE FORM CLOSES ITS TASK — on the FIRST submission too.
     *
     * This call existed only in `update()`, so the flow everybody actually
     * takes did not close anything: a doer opens Start Assessment on a form
     * nobody has touched, fills it in and presses Submit, which CREATES the
     * record. The task stayed Pending. It only closed if they later reopened
     * the same assessment and submitted a second time — which nobody does,
     * because as far as they are concerned the work is finished.
     *
     * So the promise the task page makes ("marked complete automatically once
     * you submit") was kept on the path nobody walks and broken on the one
     * everybody does, and the fix people found was to go back and mark it
     * done by hand — the exact double step this was built to remove.
     *
     * Guarded by `submitted`: a draft is not a submission, and closing a task
     * over a half-filled form is worse than leaving it open.
     */
    if (submitted) await completeTaskForForm(record, userId);
    if (submitted) await completeSingleFormTask(record, userId);
    if (submitted) await generateBoqFromPlan(record, userId);
    /* The MD is told what is now waiting on them — see notifyPropertyFiling. */
    if (submitted) await notifyPropertyFiling(record, userId);

    // A new assessment-type record's completion event (if any) fires on
    // approval, not here (see maybeLogDecisionGatedStageCompleted in
    // decide()) — creating/submitting a workflow isn't itself the
    // completion signal.
    return this.getById(record._id);
  },

  async update(id, data, userId) {
    const record = await Record.findById(id);
    if (!record) throw ApiError.notFound('Record not found');
    await assertProjectNotArchived(record.project, record.stageKey);

    // A reviewed record's values are frozen — changing them after a decision
    // would silently invalidate that decision (and everything downstream that
    // trusts it) with no re-review. Undo the decision first to reopen it.
    const changesContent = data.values !== undefined || data.attachments !== undefined;
    if (changesContent && DECIDED_STATUSES.has(record.status)) {
      throw ApiError.badRequest(
        `This record was already ${STATUS_LABELS[record.status]?.toLowerCase() || record.status} — undo that decision before editing it.`,
        { code: 'RECORD_DECIDED' },
      );
    }

    const { stage, schema, assessmentName } = await loadStageContext(
      record.project,
      record.stageKey,
      record.assessmentType,
    );

    const nextValues = data.values !== undefined ? data.values : record.values;
    const nextStatus = data.status || record.status;
    const submitting =
      nextStatus === RECORD_STATUS.SUBMITTED && record.status !== RECORD_STATUS.SUBMITTED;
    if (nextStatus === RECORD_STATUS.SUBMITTED) assertRequired(nextValues, schema);
    if (record.assessmentType === 'rate_line') assertRateLineExplained(nextValues);

    if (data.values !== undefined) {
      record.values = nextValues;
      record.markModified('values');
      // Assessment records keep their fixed title (the assessment's name,
      // e.g. "Feasibility Assessment") — deriveTitle only makes sense for
      // flat schemas like Property Identification's.
      if (!record.assessmentType) record.title = deriveTitle(nextValues, schema);
    }
    if (data.attachments !== undefined) record.attachments = data.attachments;
    if (data.status) record.status = nextStatus;
    if (submitting) {
      record.submittedAt = record.submittedAt || new Date();
      record.submittedBy = userId;
    }
    record.updatedBy = userId;
    await record.save();

    /* The doer's side of the loop closes here: they opened this form from
       their own task list, filled it in and pressed submit, and the task it
       came from is now done without them having to go and say so. */
    if (submitting) await completeTaskForForm(record, userId);
    if (submitting) await completeSingleFormTask(record, userId);
    if (submitting) await generateBoqFromPlan(record, userId);
    /* A draft becoming a submission is the same filing event as creating
       one outright, so the MD hears about it on both roads. */
    if (submitting) await notifyPropertyFiling(record, userId);
    /* A BOQ line leaving draft is what finishes Step 1. */
    if (submitting && record.stageKey === 'p13') await settlePurchaseTasks(record.project, userId);

    const noun = stage.recordNoun || 'Record';
    const message = record.assessmentType
      ? `${assessmentName} updated.`
      : submitting
        ? `${noun} ${labelOf(record)} submitted`
        : `${noun} ${labelOf(record)} updated`;
    await logRecord(record, submitting ? ACTIVITY_ACTIONS.STATUS_CHANGED : ACTIVITY_ACTIONS.UPDATED, userId, message);

    return this.getById(id);
  },

  async decide(id, decision, reason, userId, remarks, actor) {
    const record = await Record.findById(id);
    if (!record) throw ApiError.notFound('Record not found');
    const status = DECISION_MAP[decision];
    if (!status) throw ApiError.badRequest(`Unknown decision "${decision}"`);
    await assertProjectNotArchived(record.project, record.stageKey);

    /* Decisions this PHASE does not have — checked before the status table
       because "Phase 1 has no Approve" is a more useful thing to be told than
       "a submitted record can't be set to Approved". */
    const bannedHere = STAGE_DECISION_BANS[record.stageKey]?.[decision];
    if (bannedHere) {
      throw ApiError.badRequest(bannedHere, {
        code: 'DECISION_NOT_ON_STAGE',
        details: { stageKey: record.stageKey, decision },
      });
    }

    // Only decisions that are legal from the record's *current* status —
    // without this, a direct API call could re-shortlist a rejected record or
    // decide an already-locked one, breaking the one-way review workflow the
    // scoring engine and stage gates assume is authoritative.
    const legal = LEGAL_DECISIONS_BY_STATUS[record.status] ?? [];
    if (!legal.includes(decision)) {
      throw ApiError.badRequest(
        `A record that is ${STATUS_LABELS[record.status]?.toLowerCase() || record.status} can’t be ${decision === 'reject' ? 'rejected' : `set to "${STATUS_LABELS[status] || status}"`} — undo the current decision first.`,
        { code: 'ILLEGAL_RECORD_TRANSITION', details: { from: record.status, decision, allowed: legal } },
      );
    }

    if (decision === 'reject' && !reason?.trim()) {
      throw ApiError.badRequest('A reason is required when rejecting a record');
    }

    // Approval Workflow's own rules — scoped to p7, whose assessmentTypes are
    // an ordered gate sequence rather than an unordered form set.
    if (record.stageKey === P7_STAGE_KEY) {
      // Defence in depth: the route already applies `canDecide`, but a
      // decision that gates a whole phase shouldn't rely on the routing layer
      // alone. `actor` is absent for trusted internal callers (seeds), which
      // skip the check exactly as completeStage's role gate does.
      if (actor && !can.decide(actor.role)) {
        throw ApiError.forbidden(
          'Only an MD, EA or Manager can decide an approval request.',
          { code: 'APPROVAL_ROLE_REQUIRED' },
        );
      }
      await assertApprovalTierOrder(record, decision);
      // Separation of duties: whoever filed the request can't sign it off.
      if (userId && record.submittedBy && String(record.submittedBy) === String(userId)) {
        throw ApiError.forbidden(
          'You submitted this approval request — it needs a different reviewer to decide it.',
          { code: 'SELF_APPROVAL' },
        );
      }
    }

    /**
     * COMMERCIAL CLOSURE: THE SAME TWO RULES AS THE APPROVAL WORKFLOW ABOVE.
     *
     * The six p3 documents — LOI, lease, legal check, deposit, NOCs,
     * approvals — are filed by one person and accepted by another. Neither
     * half of that was enforced: anybody with Manage could accept a lease,
     * and the person who uploaded it could accept their own. On the screen
     * that prompted this, the EA who submitted the LOI was shown Approve and
     * Reject on her own submission.
     *
     * Written out here rather than folded into the p7 branch because the two
     * phases are allowed to diverge — p7 has a tier ORDER as well, which
     * closure does not — and a shared branch would make the next change to
     * one of them silently change the other.
     */
    if (record.stageKey === 'p3' && (decision === 'approve' || decision === 'reject')) {
      /* Accepting the paperwork is the MD's desk. LEADERSHIP rather than the
         MD alone for the reason stated wherever else this app uses it: an EA
         who cannot act while the MD is unreachable is not an EA. Narrowing
         this to [MD] is a one-word change if that is what is wanted. */
      if (actor && !LEADERSHIP.includes(actor.role)) {
        throw ApiError.forbidden(
          'Accepting a commercial document is the Managing Director’s decision.',
          { code: 'APPROVAL_ROLE_REQUIRED' },
        );
      }
      /* And never your own, whatever your role. */
      if (userId && record.submittedBy && String(record.submittedBy) === String(userId)) {
        throw ApiError.forbidden(
          'You submitted this document — it needs a different reviewer to accept it.',
          { code: 'SELF_APPROVAL' },
        );
      }
    }
    // Site Evaluation's own rule: only one property may be Approved at Phase 2
    // at a time. 'shortlist' from an already-SHORTLISTED record is exactly the
    // "Approve at Site Evaluation" action (see LEGAL_DECISIONS_BY_STATUS above
    // — the original Phase 1 shortlist decision happens from SUBMITTED or
    // EVALUATION_IN_PROGRESS, never from SHORTLISTED). Every downstream gate
    // (Commercial Finalization onward) resolves THE ONE approved property via
    // projectService.getP2ApprovedProperty's `.find()` — two simultaneously
    // approved properties would leave that resolution silently ambiguous.
    if (record.stageKey === 'p1' && decision === 'shortlist' && record.status === RECORD_STATUS.SHORTLISTED) {
      const alreadyApproved = await projectService.getP2ApprovedProperty(record.project);
      if (alreadyApproved && String(alreadyApproved._id) !== String(record._id)) {
        throw ApiError.badRequest(
          `"${alreadyApproved.title}" is already the approved property for this project's Site Evaluation — only one property can be approved. Reject or undo that decision first if you need to approve a different one.`,
          {
            code: 'PROPERTY_ALREADY_APPROVED',
            details: { approvedPropertyId: alreadyApproved._id, approvedPropertyTitle: alreadyApproved.title },
          },
        );
      }
    }

    const now = new Date();
    const fromStatus = record.status;
    record.status = status;
    record.decidedBy = userId;
    record.decidedAt = now;
    // Reviewer Remarks — optional, distinct from the required rejectReason
    // below (e.g. reason "Low ROI", remarks "Rental exceeds approved budget").
    // Captured for any decision (e.g. Approval Remarks on an approve/shortlist).
    record.decisionReason = remarks?.trim() || undefined;

    // Each decision type has its own dedicated audit stamp; only one applies at
    // a time, so making a new decision clears whatever a prior one left behind.
    record.approvedBy = undefined;
    record.approvedAt = undefined;
    record.rejectedBy = undefined;
    record.rejectedAt = undefined;
    record.rejectReason = undefined;
    record.shortlistedBy = undefined;
    record.shortlistedAt = undefined;

    if (decision === 'approve') {
      record.approvedBy = userId;
      record.approvedAt = now;
    } else if (decision === 'reject') {
      record.rejectedBy = userId;
      record.rejectedAt = now;
      record.rejectReason = reason.trim();
    } else if (decision === 'shortlist') {
      record.shortlistedBy = userId;
      record.shortlistedAt = now;
    }

    // Append to the permanent trail before saving — the stamps above only
    // ever describe the latest decision, so this is what makes a
    // reject → resubmit → approve cycle auditable on the record itself.
    record.decisionHistory.push({
      decision,
      fromStatus,
      toStatus: status,
      by: userId,
      at: now,
      reason: decision === 'reject' ? reason.trim() : undefined,
      remarks: remarks?.trim() || undefined,
    });

    await record.save();

    /* A property joining or leaving the shortlist changes Phase 2's work: each
       shortlisted property has its own assessment tasks. Best-effort — the
       decision itself must stand even if the task sync hits a problem. */
    if (record.stageKey === 'p1') {
      await projectService.syncAssessmentTasks(record.project, { actorId: userId }).catch((err) => {
        logger.warn(`Phase 2 assessment tasks not synced: ${err.message}`, { project: String(record.project) });
      });
    }

    const statusLabel = decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : `set to "${STATUS_LABELS[status] || status}"`;
    const activityMessage = record.assessmentType
      ? `${record.title} Submission #${await submissionNoFor(record)} ${statusLabel}${record.rejectReason ? ` (${record.rejectReason})` : ''}`
      : `${labelOf(record)} — ${statusLabel}${record.rejectReason ? ` (${record.rejectReason})` : ''}`;

    await logRecord(
      record,
      ACTIVITY_ACTIONS.STATUS_CHANGED,
      userId,
      activityMessage,
    );

    if (decision === 'approve' && DECISION_GATED_STAGES.has(record.stageKey) && record.assessmentType && record.parentRecordId) {
      const { stage, assessmentTypes } = await loadStageContext(record.project, record.stageKey);
      await maybeLogDecisionGatedStageCompleted(record, stage, assessmentTypes, userId);
    }

    // Project Creation (p4) is the one DECISION_GATED_STAGES phase with no
    // "Mark Done" button anywhere in the UI — ProjectCreationPage.jsx's own
    // comment says so explicitly: "Approval — not submission — creates the
    // project... there is deliberately no client-side completion here."
    // Approving the single Project Setup master record IS meant to be the
    // completion trigger, not merely the activity-log event the block above
    // produces. `completeStage`'s own p4 branch re-validates everything
    // (including copying the approved form's values onto the Project doc via
    // applyProjectSetup) and is idempotent, so this just invokes the same
    // authoritative path a manual "Mark Done" would elsewhere. Best-effort:
    // if the project turns out not to be eligible for some other reason, the
    // record approval itself must still succeed — the stage simply stays
    // open until that other condition clears.
    if (decision === 'approve' && record.stageKey === 'p4' && record.assessmentType === P4_MASTER_KEY) {
      try {
        /* The phase no longer "completes" — it reads complete when its tasks
           do. What DOES still have to happen is the data flow: the approved
           form's budget, opening date and manager belong on the project. */
        await projectService.applyProjectSetupValues(record.project, record.values, userId);
      } catch (err) {
        logger.warn(`Auto-complete of Phase 4 after Project Setup approval did not apply: ${err.message}`, { project: String(record.project) });
      }
    }

    // Project Creation (p4) closes on the manager's approval of its single
    // master form — that approval IS the completion event. This used to be a
    // useEffect in ProjectCreationPage that fired on *submission*, so the
    // stage completed with nobody having approved anything. Now the server
    // owns it, and completeStage re-validates the approval independently, so
    // this can't complete a stage the gate wouldn't allow on its own.
    if (decision === 'approve' && record.stageKey === 'p4' && record.assessmentType === P4_MASTER_KEY) {
      /* The phase completes by arithmetic — see phaseProgress(). There is
         no stage status left to set, so nothing is called here. */
    }

    /*
     * Property FMS Step 6 → Step 7.
     *
     * A submitted LOI is evidence; an approved LOI is the MD's commitment to
     * the site. That approval therefore opens the Project Creation draft and
     * places the property in its Create Project queue. This sits beside the
     * generic decision handling so it applies equally to an approval made in
     * the FMS sheet, from My Tasks, or on the full document page.
     */
    if (decision === 'approve' && record.stageKey === 'p3' && record.assessmentType === 'loi') {
      await startProjectCreationFromApprovedLoi(record, userId);
    }

    /* Sending a commercial document back reopens its original task. Without
       this, the document left the review queue but remained “Complete” for
       the doer who now has to correct it, so it never returned to My Tasks. */
    if (decision === 'reject' && record.stageKey === 'p3') {
      await reopenCommercialDocumentTask(record);
    }

    // Project Closure (p10) closes the same way: approving a closure module
    // is the trigger, and completeStage's own p10 gate decides whether that
    // was in fact the last thing outstanding (every prior phase complete,
    // store live, every module approved, no open task). Harmlessly a no-op
    // until then — which is why this replaced the client-side useEffect that
    // used to fire it off "all modules approved" alone.
    if (decision === 'approve' && record.stageKey === 'p10') {
      /* The phase completes by arithmetic — see phaseProgress(). There is
         no stage status left to set, so nothing is called here. */
    }

    /* Ruling on a BOQ line is what finishes Step 2 — once every line has
       been approved or sent back, "Check the BOQ" has nothing left in it. */
    if (record.stageKey === 'p13') await settlePurchaseTasks(record.project, userId);

    return this.getById(id);
  },

  async undoDecision(id, userId) {
    const record = await Record.findById(id);
    if (!record) throw ApiError.notFound('Record not found');
    await assertProjectNotArchived(record.project, record.stageKey);
    record.status = RECORD_STATUS.SUBMITTED;
    record.decidedBy = undefined;
    record.decidedAt = undefined;
    record.decisionReason = undefined;
    record.approvedBy = undefined;
    record.approvedAt = undefined;
    record.rejectedBy = undefined;
    record.rejectedAt = undefined;
    record.rejectReason = undefined;
    record.shortlistedBy = undefined;
    record.shortlistedAt = undefined;
    await record.save();

    /* A property joining or leaving the shortlist changes Phase 2's work: each
       shortlisted property has its own assessment tasks. Best-effort — the
       decision itself must stand even if the task sync hits a problem. */
    if (record.stageKey === 'p1') {
      await projectService.syncAssessmentTasks(record.project, { actorId: userId }).catch((err) => {
        logger.warn(`Phase 2 assessment tasks not synced: ${err.message}`, { project: String(record.project) });
      });
    }
    await logRecord(
      record,
      ACTIVITY_ACTIONS.STATUS_CHANGED,
      userId,
      `${labelOf(record)} — decision reverted to submitted`,
    );
    return this.getById(id);
  },

  /**
   * Log that a doer opened a record's dedicated workspace (e.g. a shortlisted
   * property's Site Evaluation page) — purely an activity-timeline entry, no
   * state change. Callers re-fire this on every visit while the record still
   * has no assessments (each page mount resets its own "already logged"
   * guard), so idempotency has to live here: skip the write if an "opened"
   * entry for this record already exists, instead of spamming the timeline.
   */
  async markOpened(id, userId) {
    const record = await Record.findById(id);
    if (!record) throw ApiError.notFound('Record not found');
    const alreadyLogged = await activityService.exists({
      entityType: 'record',
      entityId: record._id,
      action: ACTIVITY_ACTIONS.VIEWED,
    });
    if (!alreadyLogged) {
      await logRecord(record, ACTIVITY_ACTIONS.VIEWED, userId, `${labelOf(record)} opened`);
    }
    return record;
  },

  async addComment(id, body, userId) {
    const record = await Record.findById(id);
    if (!record) throw ApiError.notFound('Record not found');
    record.comments.push({ author: userId, body });
    await record.save();
    await logRecord(record, ACTIVITY_ACTIONS.COMMENTED, userId, `Commented on ${labelOf(record)}`);
    return this.getById(id);
  },

  async remove(id, userId) {
    const record = await Record.findByIdAndDelete(id);
    if (!record) throw ApiError.notFound('Record not found');

    let message = `${record.title || 'Record'} deleted`;
    try {
      const { stage, assessmentName } = await loadStageContext(
        record.project,
        record.stageKey,
        record.assessmentType,
      );
      message = record.assessmentType
        ? `${assessmentName} deleted.`
        : `${stage.recordNoun || 'Record'} ${labelOf(record)} deleted`;
    } catch (e) {
      // fallback if context loading fails
    }

    await logRecord(record, ACTIVITY_ACTIONS.DELETED, userId, message);
    // A deleted shortlisted property takes its untouched assessment tasks with it.
    if (record.stageKey === 'p1') {
      await projectService.syncAssessmentTasks(record.project, { actorId: userId }).catch((err) => {
        logger.warn(`Phase 2 assessment tasks not synced: ${err.message}`, { project: String(record.project) });
      });
    }
    return record;
  },

  /**
   * Upload a media file to S3 without attaching it to a record yet — the
   * create form uploads before the record exists and keeps the returned ref in
   * `values`. Reuses the shared S3 helper (no new upload implementation).
   */
  async uploadMedia(file) {
    if (!file) throw ApiError.badRequest('No file provided');
    if (!isS3Configured) {
      throw new ApiError(503, 'File uploads are not configured', {
        code: 'S3_NOT_CONFIGURED',
      });
    }
    const result = await uploadBuffer(file.buffer, {
      folder: 'records',
      filename: file.originalname,
      contentType: file.mimetype,
    });
    return {
      url: result.secure_url,
      publicId: result.public_id,
      resourceType: result.resource_type,
      originalName: file.originalname,
      mimetype: file.mimetype,
      bytes: result.bytes,
      duration: result.duration, // audio/video only — undefined otherwise
    };
  },

  /** Delete an uploaded media asset (used when removing before/after save). */
  async destroyMedia(publicId, resourceType) {
    if (!publicId) throw ApiError.badRequest('publicId is required');
    await destroyAsset(publicId, resourceType || 'image');
    return { publicId };
  },
};

export default recordService;
