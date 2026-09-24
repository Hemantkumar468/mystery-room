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

/**
 * In-field writing help. `improve` requires the user's text to improve;
 * `context` is the rest of the form, capped so a huge form can't balloon the
 * prompt.
 */
const askFocus = z.object({
  name: z.string().max(120).optional(),
  city: z.string().max(60).optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
});

/** Ask-the-Map conversations. */
export const mapChatCreateSchema = z.object({
  body: z.object({ question: z.string().trim().min(3).max(400), focus: askFocus.optional() }),
});
export const mapChatMessageSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ question: z.string().trim().min(1).max(400), focus: askFocus.optional() }),
});
export const mapChatIdSchema = z.object({ params: z.object({ id: objectId }) });

/** Phase 3B layout: area + shape + the chosen games with their areas. */
export const layoutAdviceSchema = z.object({
  body: z.object({
    areaSqft: z.number().positive(),
    shapeNotes: z.string().max(2000).optional(),
    games: z.array(z.object({
      name: z.string().min(1).max(120),
      sqft: z.number().positive(),
    })).min(1).max(30),
  }),
});

/** Network Map — Ask the Map: free-form question + optional focus. */
export const askMapSchema = z.object({
  body: z.object({
    question: z.string().trim().min(3).max(400),
    // What the user is looking at when they ask — a pin or a city.
    focus: z.object({
      name: z.string().max(120).optional(),
      city: z.string().max(60).optional(),
      lat: z.number().optional(),
      lng: z.number().optional(),
    }).optional(),
  }),
});

/** Network Map — Market Scout: one city, researched. */
export const marketScoutSchema = z.object({
  body: z.object({
    city: z.string().trim().min(2).max(60),
  }),
});

/** Network Map — Expansion Radar: rank the next cities. */
export const expansionRadarSchema = z.object({
  body: z.object({
    force: z.boolean().optional(),
  }).optional().default({}),
});

export const fieldAssistSchema = z.object({
  body: z.object({
    label: z.string().min(1).max(120),
    helpText: z.string().max(300).optional(),
    mode: z.enum(['suggest', 'improve']),
    // 'field' = terse form-box text; 'message' = a full outbound vendor message.
    kind: z.enum(['field', 'message']).optional(),
    // The sender's own direction — tone, language, extra points to make.
    instructions: z.string().max(500).optional(),
    currentValue: z.string().max(4000).optional(),
    context: z.record(z.any()).optional(),
  }).superRefine((body, ctx) => {
    if (body.mode === 'improve' && !body.currentValue?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['currentValue'],
        message: 'There is nothing written yet to improve — use Suggest instead.',
      });
    }
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

/** Phase 6 procurement brief. `force` pays for a fresh run instead of the saved one. */
export const procurementBriefSchema = z.object({
  params: z.object({ projectId: objectId }),
  body: z.object({ force: z.boolean().optional() }),
});

/**
 * Read an uploaded commercial document into its form. The files are already in
 * S3 (the form uploads before it asks), so only their references travel here.
 */
export const documentExtractSchema = z.object({
  body: z.object({
    projectId: objectId,
    stageKey: z.string().min(1).default('p3'),
    // Absent for a phase with one flat form (Property Research, the BOQ);
    // present for a phase with several named modules (Commercial Closure).
    assessmentType: z.string().min(1).optional(),
    files: z.array(z.object({
      publicId: z.string().min(1),
      name: z.string().max(300).optional(),
      mimetype: z.string().max(120).optional(),
    })).min(1).max(3),
  }),
});
