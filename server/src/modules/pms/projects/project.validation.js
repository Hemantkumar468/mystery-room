import { z } from 'zod';
import {
  PROJECT_STATUS,
  PROJECT_HEALTH,
  PRIORITY_VALUES,
  CLOSURE_AUDIT_EVENT_KEYS,
} from '../../../core/constants/index.js';

const objectId = z.string().length(24);

const budgetSchema = z.object({
  planned: z.number().min(0).optional(),
  actual: z.number().min(0).optional(),
  currency: z.string().optional(),
});

export const createProjectSchema = z.object({
  body: z.object({
    name: z.string().min(2),
    templateId: objectId,
    city: z.string().min(2),
    address: z.string().optional(),
    areaSqft: z.number().min(0).optional(),
    description: z.string().optional(),
    code: z.string().optional(),
    priority: z.enum(PRIORITY_VALUES).optional(),
    owner: objectId.optional(),
    members: z.array(objectId).optional(),
    plannedStartDate: z.coerce.date(),
    targetEndDate: z.coerce.date().optional(),
    budget: budgetSchema.optional(),
    broker: z
      .object({
        name: z.string().optional(),
        phone: z.string().optional(),
        commissionPct: z.number().min(0).max(100).optional(),
      })
      .optional(),
    tags: z.array(z.string()).optional(),
  }),
});

export const updateProjectSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({
    name: z.string().min(2).optional(),
    description: z.string().optional(),
    address: z.string().optional(),
    areaSqft: z.number().min(0).optional(),
    status: z.enum(Object.values(PROJECT_STATUS)).optional(),
    priority: z.enum(PRIORITY_VALUES).optional(),
    owner: objectId.optional(),
    members: z.array(objectId).optional(),
    targetEndDate: z.coerce.date().optional(),
    budget: budgetSchema.optional(),
    broker: z.object({
      name: z.string().optional(),
      phone: z.string().optional(),
      commissionPct: z.number().min(0).max(100).optional(),
    }).passthrough().optional(),
    tags: z.array(z.string()).optional(),
  }),
});

/**
 * Validate master-data save payload.
 * `values` is a free-form record, but we defensively reject any numeric value
 * that is negative — since masterData uses Mixed on the model, Mongoose cannot
 * enforce this itself.
 */
export const masterDataSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({
    stageKey: z.string().min(1),
    values: z
      .record(z.any())
      .refine(
        (vals) =>
          Object.values(vals).every(
            (v) => typeof v !== 'number' || v >= 0,
          ),
        {
          message: 'Numeric field values must be 0 or greater — negative numbers are not allowed.',
        },
      ),
  }),
});

export const idParamSchema = z.object({ params: z.object({ id: objectId }) });

/** Project codes (e.g. MR-BHO-001) — the human-readable, URL-friendly
 * identifier, mirroring task.validation.js's codeParamSchema. Not yet wired
 * to a route; added ahead of the client-side URL change. */
export const codeParamSchema = z.object({ params: z.object({ code: z.string().min(1) }) });

export const stageKeyParamSchema = z.object({
  params: z.object({ id: objectId, stageKey: z.string().min(1) }),
});

/** Phase 10 "Archive Project" — every gate is re-derived server-side, so the
 * body carries nothing but an optional closure note. */
export const archiveProjectSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ remarks: z.string().max(2000).optional() }).optional(),
});

/** Phase 10 closure audit — `event` must be one of the whitelisted keys; the
 * audit line itself is built server-side from that key. */
export const closureAuditSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ event: z.enum(CLOSURE_AUDIT_EVENT_KEYS) }),
});

export const listProjectsSchema = z.object({
  query: z.object({
    status: z.enum(Object.values(PROJECT_STATUS)).optional(),
    health: z.enum(Object.values(PROJECT_HEALTH)).optional(),
    city: z.string().optional(),
    owner: objectId.optional(),
    search: z.string().optional(),
    page: z.coerce.number().optional(),
    limit: z.coerce.number().optional(),
    sort: z.string().optional(),
  }),
});
