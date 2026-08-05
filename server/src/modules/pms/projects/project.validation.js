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

/**
 * A draft (status: 'draft') may be saved with any subset of fields filled
 * in — it hasn't committed to being a real project yet, so `name`/`city`/
 * `plannedStartDate` are optional here even though the Project model (and
 * `publishDraft`) still requires them before a draft can become real. A
 * non-draft create (status omitted) keeps the original strict requirements,
 * enforced below via `superRefine` rather than the field schema itself, so
 * both shapes can share one schema/route.
 */
export const createProjectSchema = z.object({
  body: z
    .object({
      name: z.string().min(2).optional(),
      city: z.string().min(2).optional(),
      address: z.string().optional(),
      areaSqft: z.number().min(0).optional(),
      description: z.string().optional(),
      code: z.string().optional(),
      // A caller may only ever request DRAFT here — every other status is
      // assigned by the server (PLANNING on real create, or via publishDraft).
      status: z.enum([PROJECT_STATUS.DRAFT]).optional(),
      priority: z.enum(PRIORITY_VALUES).optional(),
      owner: objectId.optional(),
      members: z.array(objectId).optional(),
      plannedStartDate: z.coerce.date().optional(),
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
    })
    .superRefine((data, ctx) => {
      if (data.status === PROJECT_STATUS.DRAFT) return;
      if (!data.name || data.name.trim().length < 2) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['name'], message: 'Name must be at least 2 characters.' });
      }
      if (!data.city || data.city.trim().length < 2) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['city'], message: 'City must be at least 2 characters.' });
      }
      if (!data.plannedStartDate) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['plannedStartDate'], message: 'Required' });
      }
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
    // Only actually applied by the service when the target project is still
    // a draft — city/plannedStartDate/code are otherwise immutable identity
    // fields once a project is real. Accepted here (shape-only) so a draft
    // can be re-saved with these filled in; project.service.js#update's
    // `editable` whitelist is what enforces the draft-only restriction.
    city: z.string().min(2).optional(),
    plannedStartDate: z.coerce.date().optional(),
    code: z.string().optional(),
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
