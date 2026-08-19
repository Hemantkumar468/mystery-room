import { Router } from 'express';
import { authenticate } from '../../core/middleware/auth.js';
import { asyncHandler } from '../../core/utils/asyncHandler.js';
import { ApiResponse } from '../../core/utils/ApiResponse.js';
import { validate } from '../../core/middleware/validate.js';
import { manualLeadSchema, duplicateCheckSchema } from './intake/intake.validation.js';
import { leadIntakeService } from './intake/leadIntake.service.js';
import { leadService } from './leads/lead.service.js';
import { crmDashboardService } from './dashboard/crmDashboard.service.js';
import { dealService } from './deals/deal.service.js';
import { pipelineService } from './pipelines/pipeline.service.js';
import { taskService } from './tasks/task.service.js';
import { telephonyService } from './integrations/telephony/telephony.service.js';
import { contactService, companyService } from './contacts/contact.service.js';
import { routingRuleService, routingVocabulary } from './routing/routingRule.service.js';
import { User } from '../auth/auth.model.js';
import { maskPhone } from './intake/phone.js';
import { ApiError } from '../../core/utils/ApiError.js';
import {
  LEAD_SOURCE, LEAD_STATUS_VALUES, LEAD_SOURCE_VALUES,
  LOST_REASON_VALUES, LOST_REASON_LABELS, TASK_TYPE_VALUES,
} from './crm.constants.js';

/**
 * The authenticated CRM surface, mounted at /crm.
 *
 * The public counterpart — web forms and provider webhooks — lives in
 * crm.public.routes.js and is mounted separately, so nothing here can end up
 * reachable without a session by accident.
 *
 * PHASE 5 SCOPE. Capture and what immediately follows it: manual entry, the
 * duplicate check behind it, the dashboard those leads land on, and the list,
 * detail, reassign and status actions needed to actually work one. Deals,
 * pipeline, tickets and analytics arrive in later phases — and will read
 * through `buildScope` exactly as everything here does.
 */
const router = Router();

router.use(authenticate);

/**
 * The live duplicate check the manual-entry form calls while the phone number
 * is being typed.
 *
 * Its own endpoint rather than a flag on create, because it answers a question
 * asked BEFORE anything is submitted — "is this person already here?" — and the
 * answer changes what the agent does next.
 */
router.get('/leads/check-duplicate', validate(duplicateCheckSchema), asyncHandler(async (req, res) => {
  const result = await leadIntakeService.check(req.validatedQuery || req.query);

  if (!result.matchedOn) return ApiResponse.ok(res, { duplicate: false });

  const existing = result.lead || result.contact;
  return ApiResponse.ok(res, {
    duplicate: result.isDuplicate,
    // `low` means "same name at the same company" — a prompt to look, not a
    // reason to stop. The UI wording depends on this.
    confidence: result.confidence,
    matchedOn: result.matchedOn,
    reason: result.reason,
    match: existing && {
      _id: existing._id,
      name: existing.name,
      company: existing.company,
      // Masked, because this endpoint answers a yes/no question. An agent who
      // needs the number opens the record, which is a logged action.
      phone: maskPhone(existing.phone),
      assignedTo: existing.assignedTo || existing.owner || null,
      createdAt: existing.createdAt,
    },
  });
}));

/**
 * Manual entry — a walk-in, a phone call, a conversation at an event.
 *
 * Goes through the same `intake()` as every webhook: dedupe, normalisation and
 * routing are rules about leads, not about where a lead came from, and a
 * second creation path is where one of them quietly stops happening.
 */
router.post('/leads', validate(manualLeadSchema), asyncHandler(async (req, res) => {
  const { force, ...body } = req.body;

  const { lead, created, duplicate } = await leadIntakeService.intake(
    { ...body, source: body.source || LEAD_SOURCE.MANUAL },
    { actor: req.user, force },
  );

  const message = created
    ? 'Lead created'
    : 'This person already had an open enquiry — recorded as a re-enquiry on it';

  return ApiResponse.created(res, { lead, created, duplicate }, message);
}));

/** The dashboard's counters. One call, so the tiles cannot describe different
 *  moments — and scoped, so an agent sees their desk and a manager the company. */
router.get('/dashboard', asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await crmDashboardService.summary(req.user), 'Dashboard')));

/** The choices the filter bar and the entry form offer, served rather than
 *  duplicated in the client — a value the API would reject must not appear in
 *  a dropdown. */
router.get('/options', asyncHandler(async (_req, res) => ApiResponse.ok(res, {
  statuses: LEAD_STATUS_VALUES,
  sources: LEAD_SOURCE_VALUES,
  // The lost-reason list is served, not hardcoded in the modal: it is a fixed
  // vocabulary the reporting depends on, and a seventh option typed into the
  // client would silently never appear in any chart.
  lostReasons: LOST_REASON_VALUES.map((value) => ({ value, label: LOST_REASON_LABELS[value] })),
  taskTypes: TASK_TYPE_VALUES,
})));

/* ── Pipelines and deals ─────────────────────────────────────
   Declared BEFORE the /leads/:id routes above stay literal-first; these are a
   separate prefix so ordering between the two groups does not matter. */

/** Every pipeline with its stages — what the board's pipeline switcher reads. */
router.get('/pipelines', asyncHandler(async (req, res) => {
  // Creates the starter pipeline on first call. A board that opens on "no
  // pipeline is set up" is a board nobody gets past.
  await pipelineService.ensureDefault(req.user);
  return ApiResponse.ok(res, await pipelineService.list(), 'Pipelines');
}));

router.post('/pipelines', asyncHandler(async (req, res) =>
  ApiResponse.created(res, await pipelineService.create(req.body, req.user), 'Pipeline created')));

router.patch('/pipelines/:id/stages', asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await pipelineService.updateStages(req.params.id, req.body.stages || [], req.user), 'Stages updated')));

/* ── Contacts and companies ──────────────────────────────── */

router.get('/contacts', asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await contactService.list(req.query, req.user), 'Contacts')));

router.post('/contacts', asyncHandler(async (req, res) =>
  ApiResponse.created(res, await contactService.create(req.body, req.user), 'Contact created')));

router.get('/contacts/:id', asyncHandler(async (req, res) => {
  const found = await contactService.detail(req.params.id, req.user);
  if (!found) throw ApiError.notFound('Contact not found');
  return ApiResponse.ok(res, found, 'Contact');
}));

router.patch('/contacts/:id', asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await contactService.update(req.params.id, req.body, req.user), 'Saved')));

router.get('/companies', asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await companyService.list(req.query, req.user), 'Companies')));

router.post('/companies', asyncHandler(async (req, res) =>
  ApiResponse.created(res, await companyService.create(req.body, req.user), 'Company created')));

router.get('/companies/:id', asyncHandler(async (req, res) => {
  const found = await companyService.detail(req.params.id, req.user);
  if (!found) throw ApiError.notFound('Company not found');
  return ApiResponse.ok(res, found, 'Company');
}));

router.patch('/companies/:id', asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await companyService.update(req.params.id, req.body, req.user), 'Saved')));

/* ── Routing rules ───────────────────────────────────────────
   Readable by anyone in the CRM ("why did I get this lead?"), editable only
   by a manager — a rule decides who receives business. */

router.get('/routing/vocabulary', asyncHandler(async (_req, res) =>
  ApiResponse.ok(res, routingVocabulary(), 'Vocabulary')));

router.get('/routing/rules', asyncHandler(async (_req, res) =>
  ApiResponse.ok(res, await routingRuleService.list(), 'Rules')));

router.post('/routing/rules', asyncHandler(async (req, res) =>
  ApiResponse.created(res, await routingRuleService.create(req.body, req.user), 'Rule created')));

router.patch('/routing/rules/:id', asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await routingRuleService.update(req.params.id, req.body, req.user), 'Saved')));

router.delete('/routing/rules/:id', asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await routingRuleService.remove(req.params.id, req.user), 'Deleted')));

/* ── The signed-in user's own CRM preferences ────────────────
   Their own, always — no id in the path, so there is no version of this
   request that edits somebody else's notification settings. */

router.get('/preferences', asyncHandler(async (req, res) => {
  const me = await User.findById(req.user._id || req.user.id)
    .select('name phone quietHoursStart quietHoursEnd crmAvailable crmOpenLeadCap').lean();
  return ApiResponse.ok(res, me, 'Preferences');
}));

router.patch('/preferences', asyncHandler(async (req, res) => {
  const update = {};
  // Hours only, 0–23. A reminder held until "25:00" would never be released.
  for (const key of ['quietHoursStart', 'quietHoursEnd']) {
    if (req.body[key] === null || req.body[key] === '') update[key] = undefined;
    else if (req.body[key] !== undefined) {
      const h = Number(req.body[key]);
      if (!Number.isInteger(h) || h < 0 || h > 23) {
        throw ApiError.badRequest(`${key} must be an hour between 0 and 23`);
      }
      update[key] = h;
    }
  }
  if (req.body.crmAvailable !== undefined) update.crmAvailable = Boolean(req.body.crmAvailable);
  if (req.body.crmOpenLeadCap !== undefined) {
    update.crmOpenLeadCap = Math.max(0, Number(req.body.crmOpenLeadCap) || 0);
  }
  // The agent's own mobile — the leg click-to-call rings first.
  if (req.body.phone !== undefined) update.phone = String(req.body.phone).trim();

  const me = await User.findByIdAndUpdate(
    req.user._id || req.user.id,
    { $set: update },
    { new: true },
  ).select('name phone quietHoursStart quietHoursEnd crmAvailable crmOpenLeadCap').lean();

  return ApiResponse.ok(res, me, 'Saved');
}));

/* ── Deals ───────────────────────────────────────────────── */

/** One deal, its timeline and its stage history — what a board card opens. */
router.get('/deals/:id', asyncHandler(async (req, res) => {
  const found = await dealService.detail(req.params.id, req.user);
  if (!found) throw ApiError.notFound('Deal not found');
  return ApiResponse.ok(res, found, 'Deal');
}));

/* ── Telephony ───────────────────────────────────────────── */

/** Ring the agent, then the customer. The customer sees the company number,
 *  never the agent's own — that masking is why this is not a tel: link. */
router.post('/telephony/call', asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await telephonyService.clickToCall(req.body, req.user), 'Calling')));

/**
 * THE SCREEN-POP. A long poll: held open until a call rings for this agent,
 * or until it times out.
 *
 * Long-polled rather than socketed because the token lives in localStorage —
 * EventSource cannot send an Authorization header, and a token in a query
 * string ends up in every access log. This needs no new auth path at all.
 */
router.get('/telephony/ringing', asyncHandler(async (req, res) => {
  // Capped well under the proxy and browser idle timeouts, so the request
  // completes rather than being cut off and retried.
  const waitMs = Math.min(30_000, Math.max(1_000, Number(req.query.wait) || 25_000));
  const ring = await telephonyService.waitForRing(req.user, waitMs);
  // 204 = nothing rang. The client simply asks again.
  if (!ring) return res.sendStatus(204);
  return ApiResponse.ok(res, ring, 'Ringing');
}));

/* ── Tasks ───────────────────────────────────────────────── */

/** The Today screen, in one call: overdue, due today, what is coming, new
 *  leads nobody has answered, and deals going stale. */
router.get('/today', asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await taskService.today(req.user), 'Today')));

router.get('/tasks', asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await taskService.list(req.query, req.user), 'Tasks')));

router.post('/tasks', asyncHandler(async (req, res) =>
  ApiResponse.created(res, await taskService.create(req.body, req.user), 'Task created')));

router.patch('/tasks/:id/complete', asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await taskService.complete(req.params.id, req.user), 'Done')));

router.patch('/tasks/:id/cancel', asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await taskService.cancel(req.params.id, req.user), 'Cancelled')));

/** THE BOARD: stages, their deals, and every total, in one round trip. */
router.get('/board', asyncHandler(async (req, res) => {
  await pipelineService.ensureDefault(req.user);
  return ApiResponse.ok(res, await dealService.board(req.query.pipeline, req.user, req.query), 'Board');
}));

/** The same deals as a sortable list — 200 rows is a table, not a board. */
router.get('/deals', asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await dealService.list(req.query, req.user), 'Deals')));

router.post('/deals', asyncHandler(async (req, res) =>
  ApiResponse.created(res, await dealService.create(req.body, req.user), 'Deal created')));

/** One drag = one call. Stage change, reposition, or both. */
router.patch('/deals/:id/move', asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await dealService.move(req.params.id, req.body, req.user), 'Moved')));

/** The listing: filters, search, pagination. Phone numbers arrive masked. */
router.get('/leads', asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await leadService.list(req.query, req.user), 'Leads fetched')));

/** One lead and its whole timeline — what the detail drawer opens. */
router.get('/leads/:id', asyncHandler(async (req, res) => {
  const found = await crmDashboardService.detail(req.params.id, req.user);
  // 404, not 403, when it exists but is not theirs: "that record is not yours"
  // is itself a fact about the customer database.
  if (!found) throw ApiError.notFound('Lead not found');
  return ApiResponse.ok(res, found, 'Lead fetched');
}));

router.patch('/leads/:id/assign', asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await leadService.reassign(req.params.id, req.body, req.user), 'Reassigned')));

router.patch('/leads/:id/status', asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await leadService.setStatus(req.params.id, req.body, req.user), 'Status updated')));

router.post('/leads/:id/activities', asyncHandler(async (req, res) =>
  ApiResponse.created(res, await leadService.logActivity(req.params.id, req.body, req.user), 'Logged')));

export default router;
