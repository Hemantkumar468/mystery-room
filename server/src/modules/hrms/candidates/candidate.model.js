import mongoose from 'mongoose';
import { attachTenancy } from '../../../core/tenancy/tenancy.js';
import {
  CANDIDATE_STAGE, CANDIDATE_STAGE_VALUES, CANDIDATE_SOURCE, CANDIDATE_SOURCE_VALUES,
  INTERVIEW_KIND, INTERVIEW_KIND_VALUES, INTERVIEW_OUTCOME, INTERVIEW_OUTCOME_VALUES,
} from '../hrms.constants.js';

const { Schema, model } = mongoose;

/**
 * One application to one requisition.
 *
 * The same person applying to two roles is two candidates — deliberately. A
 * pipeline stage is per application, and merging people across roles (a CRM
 * "contact") is a later concern once the volume justifies it.
 */
const stageEventSchema = new Schema(
  {
    stage: { type: String, enum: CANDIDATE_STAGE_VALUES, required: true },
    at: { type: Date, default: Date.now },
    by: { type: Schema.Types.ObjectId, ref: 'User' },
    note: { type: String, trim: true, maxlength: 500 },
  },
  { _id: false },
);

/**
 * One round of interviewing — a call, a meeting, or the HR conversation.
 *
 * Kept as a list on the candidate rather than its own collection because a
 * round has no life of its own: it is never queried without the person it is
 * about, never shared between candidates, and dies with them. The moment
 * rounds need their own calendar or their own permissions, that changes.
 *
 * `_id` is left ON (unlike the stage events above) — the UI edits, reschedules
 * and cancels a specific round, and addressing one by array index is how a
 * concurrent edit silently rewrites the wrong row.
 */
const interviewSchema = new Schema(
  {
    round: { type: Number, min: 1, required: true },
    kind: { type: String, enum: INTERVIEW_KIND_VALUES, default: INTERVIEW_KIND.IN_PERSON },
    scheduledAt: { type: Date, required: true },
    durationMins: { type: Number, min: 5, max: 480, default: 30 },

    /** An employee where possible; free text covers a panel member with no
     *  login, which is most of them at a new centre. */
    interviewer: { type: Schema.Types.ObjectId, ref: 'User' },
    interviewerName: { type: String, trim: true, maxlength: 120 },

    /** An address for in-person, a meeting link for video, a number for a call.
     *  One field on purpose — three would be three empty boxes every time. */
    location: { type: String, trim: true, maxlength: 500 },

    outcome: { type: String, enum: INTERVIEW_OUTCOME_VALUES, default: INTERVIEW_OUTCOME.PENDING, index: true },
    feedback: { type: String, trim: true, maxlength: 2000 },
    rating: { type: Number, min: 1, max: 5 },

    /* When the invite actually left the building. Null is not "failed" — it is
       also "mail is not configured on this deployment", which is a supported
       state. The UI must say which. */
    inviteSentAt: { type: Date },
    inviteTo: { type: String, trim: true, maxlength: 160 },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    decidedAt: { type: Date },
  },
  { timestamps: true },
);

const candidateSchema = new Schema(
  {
    requisition: { type: Schema.Types.ObjectId, ref: 'Requisition', required: true, index: true },

    name: { type: String, required: true, trim: true, maxlength: 120 },
    phone: { type: String, trim: true, maxlength: 24, index: true },
    email: { type: String, trim: true, lowercase: true, maxlength: 160, index: true },
    city: { type: String, trim: true, maxlength: 80 },

    /** A link to the CV — Drive, a portal profile, a PDF already hosted.
     *  Uploads come later; a link covers every case today without S3 plumbing. */
    resumeUrl: { type: String, trim: true, maxlength: 2048 },
    /* The CV is uploaded and lives in S3; this is the profile the candidate
       pastes. Two different things, so two fields — a single 'link' column
       forced whoever screens to guess which one they were looking at. */
    linkedinUrl: { type: String, trim: true, maxlength: 500 },
    coverNote: { type: String, trim: true, maxlength: 2000 },
    experienceYears: { type: Number, min: 0 },
    currentSalary: { type: Number, min: 0 },
    expectedSalary: { type: Number, min: 0 },
    noticePeriodDays: { type: Number, min: 0 },

    source: { type: String, enum: CANDIDATE_SOURCE_VALUES, default: CANDIDATE_SOURCE.OTHER, index: true },
    referredBy: { type: String, trim: true, maxlength: 120 },

    stage: { type: String, enum: CANDIDATE_STAGE_VALUES, default: CANDIDATE_STAGE.APPLIED, index: true },
    stageHistory: [stageEventSchema],
    /** Every round, in the order they were scheduled. */
    interviews: [interviewSchema],
    /** 1–5, the interviewer's call. */
    rating: { type: Number, min: 1, max: 5 },
    rejectionReason: { type: String, trim: true, maxlength: 300 },
    notes: { type: String, trim: true, maxlength: 4000 },

    /** Whose desk this sits on — defaults to the requisition's hiring manager. */
    owner: { type: Schema.Types.ObjectId, ref: 'User', index: true },

    // The login account created from this hire (shows on the Employees page).
    // Set once by createEmployeeAccount; its presence is what replaces the
    // "Create login" button with a done-stamp.
    user: { type: Schema.Types.ObjectId, ref: 'User' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },

    deletedAt: { type: Date },
    deleteReason: { type: String, trim: true, maxlength: 300 },
  },
  { timestamps: true },
);

candidateSchema.index({ requisition: 1, stage: 1 });
// Same person applying twice to the same role is a duplicate worth flagging,
// not blocking — a phone number is the most reliable key we get from a form.
candidateSchema.index({ requisition: 1, phone: 1 });

attachTenancy(candidateSchema, { modelName: 'Candidate' });

export const Candidate = model('Candidate', candidateSchema);
export default Candidate;
