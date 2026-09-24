import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../../core/middleware/validate.js';
import { authenticate, authorize } from '../../../core/middleware/auth.js';
import { CAN_CAPTURE, CAN_MANAGE } from '../../../core/constants/index.js';
import { designDrawingsFmsController as controller } from './designDrawingsFms.controller.js';
import { FMS_METRICS } from './designDrawingsFms.service.js';

/**
 * Design & Drawings FMS — the management dashboard over the drawing
 * checklist, across every project.
 *
 * Assign is a capture-tier action (the PM/architect coordinating the work),
 * same tier as filing the checklist form itself. Approve/Resend are
 * manager-tier — the same `CAN_MANAGE` bar record.routes.js already holds
 * the generic decide endpoint to, since Approve here calls that same
 * decide() under the hood.
 */
const router = Router();
router.use(authenticate);

const canCapture = authorize(...CAN_CAPTURE);
const canDecide = authorize(...CAN_MANAGE);

/* The six KPI cards, straight off the service — a metric the dashboard
   cannot show is a 400 here, not an empty page. */
const FMS_METRIC_KEYS = Object.keys(FMS_METRICS);

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Not a valid id');
const drawingNoParam = z.coerce.number().int().min(1).max(37);

const assignSchema = z.object({
  params: z.object({ projectId: objectId, drawingNo: drawingNoParam }),
  body: z.object({
    assignedTo: objectId.optional().nullable(),
    designerOwner: objectId.optional().nullable(),
    plannedDate: z.string().optional().nullable(),
    plannedTime: z.string().max(20).optional().nullable(),
    notes: z.string().max(2000).optional().nullable(),
  }),
});

const resendSchema = z.object({
  params: z.object({ projectId: objectId, drawingNo: drawingNoParam }),
  body: z.object({ reason: z.string().min(1, 'Say what needs to change').max(2000) }),
});

const projectParam = z.object({ params: z.object({ projectId: objectId }) });
const drawingParam = z.object({ params: z.object({ projectId: objectId, drawingNo: drawingNoParam }) });

const breakdownSchema = z.object({
  params: z.object({ metric: z.enum(FMS_METRIC_KEYS) }),
  query: z.object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(5).max(200).optional(),
    projectId: objectId.optional(),
    set: z.coerce.number().int().min(1).max(2).optional(),
    q: z.string().max(200).optional(),
    sort: z.string().max(40).optional(),
    dir: z.enum(['asc', 'desc']).optional(),
    /* The drill-downs behind each tile and group bar on the breakdown page.
       `owner` takes the literal "none" as well as a user id — "nobody is on
       these" is one of the answers the Owner grouping gives. */
    category: z.string().max(60).optional(),
    status: z.string().max(60).optional(),
    owner: z.union([objectId, z.literal('none')]).optional(),
    flag: z.string().max(24).optional(),
    location: z.string().max(80).optional(),
    manager: objectId.optional(),
    projectStatus: z.string().max(40).optional(),
  }).partial(),
});

/* `/overview` and `/breakdown` are registered before `/:projectId` so they are
   matched as literal paths rather than as a (invalid) projectId. */
router.get('/overview', controller.getOverview);
router.get('/breakdown/:metric', validate(breakdownSchema), controller.getBreakdown);
router.get('/:projectId', validate(projectParam), controller.getProject);
router.post('/:projectId/:drawingNo/assign', canCapture, validate(assignSchema), controller.assign);
router.post('/:projectId/:drawingNo/approve', canDecide, validate(drawingParam), controller.approve);
router.post('/:projectId/:drawingNo/resend', canDecide, validate(resendSchema), controller.resend);
router.get('/:projectId/:drawingNo/revisions', validate(drawingParam), controller.getRevisions);

export default router;
