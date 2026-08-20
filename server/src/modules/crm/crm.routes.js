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
import { emailDropboxService } from './integrations/email/emailDropbox.service.js';
import { crmEmailService } from './integrations/email/crmEmail.service.js';
import { canManageCrm } from './shared/scope.js';
import { ticketService } from './tickets/ticket.service.js';
import { performanceService } from './performance/performance.service.js';
import { exportService } from './exports/export.service.js';
import { offboardService } from './exports/offboard.service.js';
import { AuditLog } from '../../core/audit/audit.model.js';
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


/* ── The BCC dropbox ──────────────────────────────────────────────────
   Reading the status is open to anyone in the CRM: "did my email land on the
   record?" is a question the person who sent it should be able to answer.
   Working the unfiled queue is a manager's job, because resolving an entry
   discards a customer's message from the queue nobody else is watching. */

router.get('/email/dropbox/status', asyncHandler(async (_req, res) =>
  ApiResponse.ok(res, await emailDropboxService.status(), 'Dropbox status')));

router.get('/email/dropbox/unfiled', asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await emailDropboxService.listUnfiled(req.query), 'Unfiled email')));

router.patch('/email/dropbox/unfiled/:id/resolve', asyncHandler(async (req, res) => {
  if (!canManageCrm(req.user)) {
    throw ApiError.forbidden('Only a manager can clear the unfiled queue', { code: 'EMAIL_DROPBOX_FORBIDDEN' });
  }
  const row = await emailDropboxService.resolveUnfiled(req.params.id, req.user);
  if (!row) throw ApiError.notFound('That message is not in the queue');
  return ApiResponse.ok(res, row, 'Marked as dealt with');
}));


/* ── Tickets, and the clock on them ───────────────────────────────────
   Every duration here is WORKING minutes against the policy's calendar —
   a Friday-evening ticket is not late on Saturday morning. See
   tickets/businessHours.js. */

router.get('/tickets', asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await ticketService.list(req.query, req.user), 'Tickets')));

router.get('/tickets/summary', asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await ticketService.summary(req.user), 'Ticket summary')));

router.get('/tickets/sla-policies', asyncHandler(async (_req, res) =>
  ApiResponse.ok(res, await ticketService.policies(), 'SLA policies')));

router.patch('/tickets/sla-policies/:id', asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await ticketService.updatePolicy(req.params.id, req.body, req.user), 'Saved')));

router.post('/tickets', asyncHandler(async (req, res) =>
  ApiResponse.created(res, await ticketService.create(req.body, req.user), 'Ticket raised')));

router.get('/tickets/:id', asyncHandler(async (req, res) => {
  const found = await ticketService.detail(req.params.id, req.user);
  // null rather than a 403: "that exists but is not yours" is itself a fact
  // about the customer database, and the same rule every other record follows.
  if (!found) throw ApiError.notFound('Ticket not found');
  return ApiResponse.ok(res, found, 'Ticket');
}));

router.post('/tickets/:id/respond', asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await ticketService.respond(req.params.id, req.body, req.user), 'Response recorded')));

router.patch('/tickets/:id/status', asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await ticketService.setStatus(req.params.id, req.body, req.user), 'Status updated')));

router.patch('/tickets/:id/priority', asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await ticketService.setPriority(req.params.id, req.body, req.user), 'Priority updated')));

router.patch('/tickets/:id/assign', asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await ticketService.assign(req.params.id, req.body, req.user), 'Assigned')));

/* ── Sending email, and reading a conversation ────────────────────────── */

router.post('/email/send', asyncHandler(async (req, res) =>
  ApiResponse.created(res, await crmEmailService.send(req.body, req.user), 'Email sent')));

router.get('/email/thread/:threadId', asyncHandler(async (req, res) => {
  const messages = await crmEmailService.thread(req.params.threadId, req.user);
  // null rather than 403 — the same rule as every other record.
  if (!messages) throw ApiError.notFound('That conversation could not be found');
  return ApiResponse.ok(res, messages, 'Thread');
}));

router.post('/email/dropbox/unfiled/:id/create-lead', asyncHandler(async (req, res) => {
  const made = await emailDropboxService.createLeadFrom(req.params.id, req.body, req.user);
  if (!made) throw ApiError.notFound('That message is not in the queue');
  return ApiResponse.created(res, made, 'Lead created from the email');
}));


/* ── Performance and loss analysis ────────────────────────────────────
   Scoped through buildScope inside the service, not by hiding columns here:
   an agent gets exactly their own row. A leaderboard everyone can see is a
   decision a company makes deliberately, not a default. */

router.get('/performance', asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await performanceService.scorecard(req.query, req.user), 'Scorecard')));

router.get('/performance/dropoff', asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await performanceService.dropOff(req.query, req.user), 'Stage drop-off')));

router.get('/performance/losses', asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await performanceService.losses(req.query, req.user), 'Loss analysis')));


/* ── Exports, the audit trail, and offboarding ────────────────────────
   Taking customer data out is a request with a reason and an approver, not a
   button. See exports/export.service.js for why the thresholds are about
   intent rather than bytes. */

router.get('/exports', asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await exportService.list(req.query, req.user), 'Exports')));

router.post('/exports', asyncHandler(async (req, res) =>
  ApiResponse.created(res, await exportService.request(req.body, req.user), 'Export requested')));

router.patch('/exports/:id/approve', asyncHandler(async (req, res) => {
  const done = await exportService.approve(req.params.id, req.user);
  if (!done) throw ApiError.notFound('That request is not waiting for approval');
  return ApiResponse.ok(res, done, 'Approved');
}));

router.patch('/exports/:id/reject', asyncHandler(async (req, res) => {
  const done = await exportService.reject(req.params.id, req.body, req.user);
  if (!done) throw ApiError.notFound('That request is not waiting for approval');
  return ApiResponse.ok(res, done, 'Rejected');
}));

router.get('/exports/:id/link', asyncHandler(async (req, res) => {
  const link = await exportService.link(req.params.id, req.user);
  // 404 rather than 403: whether somebody else's export exists is not this
  // caller's business.
  if (!link) throw ApiError.notFound('That file is not available');
  return ApiResponse.ok(res, link, 'Download link');
}));

/** The trail for one record, or for one person. Managers only — an audit log
 *  readable by everybody is a map of who to talk to. */
router.get('/audit', asyncHandler(async (req, res) => {
  if (!canManageCrm(req.user)) {
    throw ApiError.forbidden('Only a manager can read the audit trail', { code: 'AUDIT_FORBIDDEN' });
  }
  const where = {};
  if (req.query.entity) where.entity = req.query.entity;
  if (req.query.entityId) where.entityId = req.query.entityId;
  if (req.query.actor) where.actor = req.query.actor;
  if (req.query.action) where.action = req.query.action;

  const items = await AuditLog.find(where)
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(req.query.limit) || 100, 500))
    .lean();
  return ApiResponse.ok(res, { items, total: items.length }, 'Audit trail');
}));

/* Offboarding. Dry run unless `apply` is set, because this touches every
   record a person owned and "how many, and to whom" has to be answerable
   before the fact. */
router.get('/offboard/:userId/preview', asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await offboardService.run(req.params.userId, {}, req.user), 'Preview')));

router.get('/offboard/candidates', asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await offboardService.candidates(req.user._id || req.user.id), 'Who can inherit')));

router.post('/offboard/:userId', asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await offboardService.run(req.params.userId, { ...req.body, apply: true }, req.user), 'Offboarded')));

export default router;
