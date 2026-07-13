import { z } from 'zod';
import {
  RECORD_STATUS_VALUES,
  RECORD_DECISION_VALUES,
} from '../../../core/constants/index.js';

const objectId = z.string().length(24);

const attachmentSchema = z.object({
  fieldKey: z.string().optional(),
  name: z.string().optional(),
  url: z.string().optional(),
  kind: z.string().optional(),
});

/**
 * `values` is a free-form record of dynamic answers. As with master data, we
 * defensively reject negative numbers since Mongoose cannot enforce it on Mixed.
 */
const valuesSchema = z
  .record(z.any())
  .refine(
    (vals) => Object.values(vals).every((v) => typeof v !== 'number' || v >= 0),
    { message: 'Numeric field values must be 0 or greater — negative numbers are not allowed.' },
  );

export const createRecordSchema = z.object({
  body: z.object({
    projectId: objectId,
    stageKey: z.string().min(1),
    title: z.string().optional(),
    values: valuesSchema.optional(),
    status: z.enum(RECORD_STATUS_VALUES).optional(),
    attachments: z.array(attachmentSchema).optional(),
  }),
});

export const listRecordsSchema = z.object({
  query: z.object({
    projectId: objectId,
    stageKey: z.string().optional(),
    status: z.enum(RECORD_STATUS_VALUES).optional(),
  }),
});

export const idParamSchema = z.object({ params: z.object({ id: objectId }) });

export const updateRecordSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({
    title: z.string().optional(),
    values: valuesSchema.optional(),
    status: z.enum(RECORD_STATUS_VALUES).optional(),
    attachments: z.array(attachmentSchema).optional(),
  }),
});

export const decisionSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({
    decision: z.enum(RECORD_DECISION_VALUES),
    reason: z.string().optional(),
  }),
});
