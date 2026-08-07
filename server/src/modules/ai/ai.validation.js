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
