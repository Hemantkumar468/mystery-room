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

  // Percentage validation (0 - 100)
  for (const pctKey of ['roi', 'profit_margin', 'revenue_share_pct', 'progress_pct']) {
    const v = vals?.[pctKey];
    if (v !== undefined && v !== null && v !== '') {
      const num = Number(v);
      if (isNaN(num) || num < 0 || num > 100) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [pctKey],
          message: `${pctKey === 'roi' ? 'ROI' : pctKey === 'profit_margin' ? 'Profit Margin' : pctKey} must be between 0% and 100%.`,
        });
      }
    }
  }

  // Month-based validation (1 - 360 months)
  for (const monthKey of ['payback_period', 'lease_duration', 'lockin_period_months', 'notice_period_months']) {
    const v = vals?.[monthKey];
    if (v !== undefined && v !== null && v !== '') {
      const num = Number(v);
      if (isNaN(num) || !Number.isInteger(num) || num < 1 || num > 360) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [monthKey],
          message: `${monthKey === 'payback_period' ? 'Investment Recovery Time' : monthKey} must be a valid whole number between 1 and 360 months.`,
        });
      }
    }
  }

  // Currency / financial figures
  const currencyFieldLabels = {
    estimated_investment: 'Estimated Investment',
    monthly_revenue: 'Monthly Revenue',
    capex: 'Setup Cost',
    opex: 'Monthly Operating Cost',
    setup_cost: 'Estimated Setup Cost',
    monthly_operating_cost: 'Estimated Monthly Operating Cost',
    monthly_rent: 'Monthly Rent',
    deposit: 'Security Deposit',
  };
  for (const currKey of Object.keys(currencyFieldLabels)) {
    const v = vals?.[currKey];
    if (v !== undefined && v !== null && v !== '') {
      const num = Number(String(v).replace(/,/g, ''));
      const label = currencyFieldLabels[currKey] || currKey;
      if (isNaN(num) || num < 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [currKey],
          message: `${label} must be a valid positive amount.`,
        });
      } else if (num > 500000000) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [currKey],
          message: `${label} exceeds maximum limit of ₹50,00,00,000.`,
        });
      }
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
    // The task this is being filed for, when the form was opened from one.
    // See Record.task for why this is optional and what a missing value means.
    taskId: objectId.optional(),
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

/**
 * Tracking update (Phase 6 order tracker). `values` carries ONLY the fields
 * being changed; the service checks each key against the stage's
 * `tracker: true` fields, so nothing approved can be edited through here.
 */
export const trackingSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({
    values: z.record(z.any()),
    note: z.string().max(500).optional(),
  }),
});

/**
 * One deposit instalment. The proof files are already uploaded (the form
 * stores before it records), so only their references travel here.
 */
export const paymentSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({
    amount: z.coerce.number().positive('Enter the amount received.'),
    paidOn: z.string().max(30).optional(),
    mode: z.string().max(40).optional(),
    reference: z.string().max(120).optional(),
    note: z.string().max(500).optional(),
    proof: z.array(z.object({
      url: z.string().max(600).optional(),
      publicId: z.string().max(400).optional(),
      name: z.string().max(300).optional(),
      mimetype: z.string().max(120).optional(),
    })).max(5).optional(),
  }),
});

export const paymentIdParamSchema = z.object({
  params: z.object({ id: objectId, paymentId: z.string().min(1).max(60) }),
});
