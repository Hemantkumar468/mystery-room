import { z } from 'zod';
import { DEPARTMENT_VALUES, ROLE_VALUES } from '../../core/constants/index.js';
import {
  REQUISITION_STATUS_VALUES, EMPLOYMENT_TYPE_VALUES, CANDIDATE_STAGE_VALUES, CANDIDATE_SOURCE_VALUES,
  INTERVIEW_KIND_VALUES, INTERVIEW_OUTCOME_VALUES,
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
  /* Nullable, not just optional: clearing a schedule is a thing HR does
     ("no end date"), and it has to be expressible as an explicit null. */
  applyOpensAt: z.coerce.date().optional().nullable(),
  applyClosesAt: z.coerce.date().optional().nullable(),
  targetDate: z.coerce.date().optional().nullable(),
  hiringManager: objectId.optional().nullable(),
});

/**
 * A window that shuts before it opens is always a typo — and it would not
 * fail loudly, it would just take the link off the air the moment it was
 * saved. Caught here rather than left for someone to notice from silence.
 *
 * Applied after `.partial()` on the update path, because `.partial()` cannot
 * be called on an already-refined schema.
 */
const orderedWindow = (b) => !(b.applyOpensAt && b.applyClosesAt)
  || new Date(b.applyClosesAt) > new Date(b.applyOpensAt);
const WINDOW_MESSAGE = {
  message: 'The closing time must be after the opening time',
  path: ['applyClosesAt'],
};

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
export const createRequisitionSchema = z.object({ body: requisitionBody.refine(orderedWindow, WINDOW_MESSAGE) });
export const updateRequisitionSchema = z.object({ params: z.object({ id: objectId }), body: requisitionBody.partial().refine(orderedWindow, WINDOW_MESSAGE) });
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
  linkedinUrl: z.string().trim().max(500).optional().or(z.literal('')),
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
    linkedinUrl: z.string().trim().max(500).optional().or(z.literal('')),
    coverNote: z.string().trim().max(2000).optional(),
    experienceYears: years,
    // Honeypot — a real browser never fills it.
    website: z.string().max(200).optional(),
  }),
});

/* ── Interview rounds ─────────────────────────────────────────────────────
   Scheduling and judging are SEPARATE schemas on purpose. They happen days
   apart, by different people, and a single "update the interview" body that
   accepts both is how a feedback save silently wipes a time somebody else
   just corrected. */

export const scheduleInterviewSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({
    kind: z.enum(INTERVIEW_KIND_VALUES).optional(),
    scheduledAt: z.coerce.date(),
    durationMins: z.coerce.number().int().min(5).max(480).optional(),
    interviewer: objectId.optional().nullable(),
    interviewerName: z.string().trim().max(120).optional(),
    location: z.string().trim().max(500).optional(),
    /** Send the invite as part of scheduling — the common case. */
    sendInvite: z.boolean().optional(),
  }),
});

export const updateInterviewSchema = z.object({
  params: z.object({ id: objectId, interviewId: objectId }),
  body: z.object({
    kind: z.enum(INTERVIEW_KIND_VALUES).optional(),
    scheduledAt: z.coerce.date().optional(),
    durationMins: z.coerce.number().int().min(5).max(480).optional(),
    interviewer: objectId.optional().nullable(),
    interviewerName: z.string().trim().max(120).optional(),
    location: z.string().trim().max(500).optional(),
  }),
});

export const decideInterviewSchema = z.object({
  params: z.object({ id: objectId, interviewId: objectId }),
  body: z.object({
    outcome: z.enum(INTERVIEW_OUTCOME_VALUES),
    feedback: z.string().trim().max(2000).optional(),
    rating: z.coerce.number().int().min(1).max(5).optional(),
  }),
});

export const interviewIdSchema = z.object({
  params: z.object({ id: objectId, interviewId: objectId }),
});

export const sendInviteSchema = z.object({
  params: z.object({ id: objectId, interviewId: objectId }),
  body: z.object({
    /** Override the address on file — a candidate who gave a typo'd email
     *  should not need editing before an invite can go out. */
    to: z.string().trim().email().max(160).optional(),
    message: z.string().trim().max(2000).optional(),
  }).default({}),
});

export const exportCandidatesSchema = z.object({
  query: z.object({
    requisition: objectId.optional(),
    stage: z.enum(CANDIDATE_STAGE_VALUES).optional(),
    source: z.enum(CANDIDATE_SOURCE_VALUES).optional(),
    search: z.string().max(120).optional(),
  }),
});
