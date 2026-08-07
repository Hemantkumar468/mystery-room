import { z } from 'zod';
import { RECORD_STATUS } from '../../../core/constants/index.js';

const objectId = z.string().length(24);

/**
 * Live Location is optional; when present it is EITHER captured GPS coordinates
 * or a pasted Google Maps link.
 */
const gpsShape = z
  .object({
    lat: z.number(),
    lng: z.number(),
    capturedAt: z.coerce.date().optional(),
    // Optional capture metadata surfaced in the Location Preview popup.
    accuracy: z.number().optional(), // GPS accuracy radius in metres
    capturedBy: z
      .object({ name: z.string().optional(), role: z.string().optional() })
      .optional(),
  })
  .strict();

const mapUrlShape = z.object({ mapUrl: z.string().url() }).strict();

const liveLocationShape = z.union([gpsShape, mapUrlShape]);

/**
 * `values` is free-form (its shape is defined by the stage's masterDataSchema),
 * but we defensively validate the structured `live_location` field when present.
 */
const valuesSchema = z.record(z.any()).superRefine((vals, ctx) => {
  const loc = vals?.live_location;
  if (loc !== undefined && loc !== null && loc !== '') {
    const parsed = liveLocationShape.safeParse(loc);
    if (!parsed.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['live_location'],
        message: 'live_location must be GPS { lat, lng, capturedAt? } or { mapUrl }',
      });
    }
  }
});

const attachmentSchema = z.object({
  fieldKey: z.string().optional(),
  name: z.string().optional(),
  url: z.string().optional(),
  publicId: z.string().optional(),
  kind: z.string().optional(),
});

// Draft/submitted are the only statuses a client sets directly; shortlist/reject
// go through the decision endpoint.
const writableStatus = z.enum([RECORD_STATUS.DRAFT, RECORD_STATUS.SUBMITTED]);

export const listRecordsSchema = z.object({
  query: z.object({
    projectId: objectId.optional(),
    stageKey: z.string().optional(),
    status: z.string().optional(),
    parentRecordId: objectId.optional(),
    assessmentType: z.string().optional(),
  }),
});

export const createRecordSchema = z.object({
  body: z.object({
    projectId: objectId,
    stageKey: z.string().min(1),
    values: valuesSchema.optional(),
    status: writableStatus.optional(),
    attachments: z.array(attachmentSchema).optional(),
    // Assessment records only (e.g. Site Evaluation): which assessment type
    // this answers, and the record (e.g. shortlisted property) it assesses.
    assessmentType: z.string().optional(),
    parentRecordId: objectId.optional(),
  }),
});

export const updateRecordSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({
    values: valuesSchema.optional(),
    status: writableStatus.optional(),
    attachments: z.array(attachmentSchema).optional(),
  }),
});

export const decisionSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({
    decision: z.enum([
      'draft', 'under_review', 'shortlist', 'evaluation_in_progress',
      'approve', 'reject', 'archive', 'lock',
    ]),
    reason: z.string().max(500).optional(),
    remarks: z.string().max(1000).optional(),
  }),
});

/**
 * Bulk decisions from the Approvals queue.
 *
 * Capped at 100 ids per call: each one runs the full `decide()` path (gates,
 * audit row, notifications, possible stage recomputation), so an unbounded
 * batch is a request that times out halfway and leaves the caller unable to
 * tell what happened.
 *
 * A bulk REJECT requires a reason. One rejection reason applied to a hundred
 * records is already a blunt instrument; an empty one is unusable to whoever
 * has to act on it. Bulk approve needs none, matching the single-record rule.
 */
export const bulkDecisionSchema = z.object({
  body: z.object({
    ids: z.array(objectId).min(1, 'Select at least one record').max(100, 'At most 100 at a time'),
    decision: z.enum(['shortlist', 'approve', 'reject', 'archive']),
    reason: z.string().max(500).optional(),
    remarks: z.string().max(1000).optional(),
  }).superRefine((body, ctx) => {
    if (body.decision === 'reject' && !body.reason?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message: 'A reason is required when rejecting.',
      });
    }
  }),
});

export const idParamSchema = z.object({ params: z.object({ id: objectId }) });

export const commentSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ body: z.string().min(1).max(2000) }),
});
