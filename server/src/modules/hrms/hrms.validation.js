import { z } from 'zod';
import { DEPARTMENT_VALUES, ROLE_VALUES } from '../../core/constants/index.js';
import {
  REQUISITION_STATUS_VALUES, EMPLOYMENT_TYPE_VALUES, CANDIDATE_STAGE_VALUES, CANDIDATE_SOURCE_VALUES,
} from './hrms.constants.js';

const objectId = z.string().length(24);
const money = z.coerce.number().min(0).optional();
const years = z.coerce.number().min(0).max(60).optional();
const line = z.string().trim().max(300);

const jdSchema = z.object({
  summary: z.string().trim().max(2000).optional(),
  responsibilities: z.array(line).max(20).optional(),
  requirements: z.array(line).max(20).optional(),
  niceToHave: z.array(line).max(20).optional(),
}).optional();

const requisitionBody = z.object({
  title: z.string().trim().min(2).max(120),
  department: z.enum(DEPARTMENT_VALUES).optional(),
  project: objectId.optional().nullable(),
  city: z.string().trim().max(80).optional(),
  location: z.string().trim().max(160).optional(),
  headcount: z.coerce.number().int().min(1).max(500).optional(),
  employmentType: z.enum(EMPLOYMENT_TYPE_VALUES).optional(),
  experienceMinYears: years,
  experienceMaxYears: years,
  salaryMin: money,
  salaryMax: money,
  showSalary: z.boolean().optional(),
  jd: jdSchema,
  status: z.enum(REQUISITION_STATUS_VALUES).optional(),
  acceptingApplications: z.boolean().optional(),
  targetDate: z.coerce.date().optional().nullable(),
  hiringManager: objectId.optional().nullable(),
});

export const listRequisitionsSchema = z.object({
  query: z.object({
    status: z.enum(REQUISITION_STATUS_VALUES).optional(),
    department: z.enum(DEPARTMENT_VALUES).optional(),
    project: objectId.optional(),
    city: z.string().max(80).optional(),
    search: z.string().max(120).optional(),
  }),
});

export const requisitionIdSchema = z.object({ params: z.object({ id: objectId }) });

export const createAccountSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({
    role: z.enum(ROLE_VALUES).optional(),
    employeeId: z.string().trim().max(40).optional(),
  }).default({}),
});
export const createRequisitionSchema = z.object({ body: requisitionBody });
export const updateRequisitionSchema = z.object({ params: z.object({ id: objectId }), body: requisitionBody.partial() });
export const deleteSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ reason: z.string().trim().min(3).max(300) }),
});

export const draftJdSchema = z.object({
  body: z.object({
    title: z.string().trim().min(2).max(120),
    department: z.enum(DEPARTMENT_VALUES).optional(),
    city: z.string().trim().max(80).optional(),
    employmentType: z.enum(EMPLOYMENT_TYPE_VALUES).optional(),
    experienceMinYears: years,
    experienceMaxYears: years,
    headcount: z.coerce.number().int().min(1).max(500).optional(),
    projectName: z.string().trim().max(120).optional(),
    notes: z.string().trim().max(1000).optional(),
  }),
});

const candidateBody = z.object({
  requisition: objectId,
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(24).optional(),
  email: z.string().trim().email().max(160).optional().or(z.literal('')),
  city: z.string().trim().max(80).optional(),
  resumeUrl: z.string().trim().max(2048).optional().or(z.literal('')),
  coverNote: z.string().trim().max(2000).optional(),
  experienceYears: years,
  currentSalary: money,
  expectedSalary: money,
  noticePeriodDays: z.coerce.number().int().min(0).max(365).optional(),
  source: z.enum(CANDIDATE_SOURCE_VALUES).optional(),
  referredBy: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(4000).optional(),
  owner: objectId.optional().nullable(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
});

export const listCandidatesSchema = z.object({
  query: z.object({
    requisition: objectId.optional(),
    stage: z.enum(CANDIDATE_STAGE_VALUES).optional(),
    source: z.enum(CANDIDATE_SOURCE_VALUES).optional(),
    search: z.string().max(120).optional(),
  }),
});
export const candidateIdSchema = z.object({ params: z.object({ id: objectId }) });
export const createCandidateSchema = z.object({ body: candidateBody });
export const updateCandidateSchema = z.object({ params: z.object({ id: objectId }), body: candidateBody.partial().omit({ requisition: true }) });
export const moveCandidateSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({
    stage: z.enum(CANDIDATE_STAGE_VALUES),
    note: z.string().trim().max(500).optional(),
    rejectionReason: z.string().trim().max(300).optional(),
    rating: z.coerce.number().int().min(1).max(5).optional(),
  }),
});

/** The public form. Only what an applicant should be asked for. */
export const publicApplySchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({
    name: z.string().trim().min(2).max(120),
    phone: z.string().trim().min(6).max(24),
    email: z.string().trim().email().max(160).optional().or(z.literal('')),
    city: z.string().trim().max(80).optional(),
    resumeUrl: z.string().trim().max(2048).optional().or(z.literal('')),
    coverNote: z.string().trim().max(2000).optional(),
    experienceYears: years,
    // Honeypot — a real browser never fills it.
    website: z.string().max(200).optional(),
  }),
});
