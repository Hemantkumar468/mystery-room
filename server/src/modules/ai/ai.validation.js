import { z } from 'zod';

const objectId = z.string().length(24);

/** Booleans arrive as querystring/body strings; accept both spellings. */
const boolish = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

export const analysePropertySchema = z.object({
  params: z.object({ recordId: objectId }),
  body: z
    .object({
      // Bypass the cache and pay for a fresh report — e.g. after the broker
      // revises the rent, or when a stale report needs refreshing.
      force: boolish.optional(),
    })
    .optional()
    .default({}),
});

export const recordIdParamSchema = z.object({
  params: z.object({ recordId: objectId }),
  query: z
    .object({ includeBrief: boolish.optional() })
    .optional()
    .default({}),
});

export const historySchema = z.object({
  params: z.object({ recordId: objectId }),
  query: z
    .object({ limit: z.coerce.number().int().min(1).max(50).optional() })
    .optional()
    .default({}),
});

export const projectIdParamSchema = z.object({
  params: z.object({ projectId: objectId }),
});

export const analyseAllSchema = z.object({
  params: z.object({ projectId: objectId }),
  body: z
    .object({
      // Re-analyse properties that already hold a current report, rather than
      // only the ones missing one. The expensive spelling of the same button.
      force: boolish.optional(),
    })
    .optional()
    .default({}),
});

export const analysisIdParamSchema = z.object({
  params: z.object({ id: objectId }),
});

/**
 * AI draft of one assessment form. `assessmentType` is validated against the
 * allow-list in assessmentPrefill.service.js (feasibility/operational only) —
 * kept there rather than duplicated here, since that file also carries the
 * reasoning for why Financial and Technical are excluded.
 */
export const prefillAssessmentSchema = z.object({
  body: z.object({
    recordId: objectId,
    stageKey: z.string().min(1),
    assessmentType: z.string().min(1),
  }),
});

/** Design ideas / drawing feedback. `mode` is checked again in the service. */
export const designGuidanceSchema = z.object({
  body: z.object({
    propertyRecordId: objectId,
    mode: z.enum(['ideas', 'review']),
    drawingRecordId: objectId.optional(),
    // Absent/false reuses the stored run; true pays for a fresh one.
    force: z.boolean().optional(),
  }),
});

/** Read the saved guidance — no provider call, so no rate limit applies. */
export const savedDesignGuidanceSchema = z.object({
  params: z.object({ propertyRecordId: objectId }),
  query: z.object({
    mode: z.enum(['ideas', 'review']).optional(),
    drawingRecordId: objectId.optional(),
  }),
});
