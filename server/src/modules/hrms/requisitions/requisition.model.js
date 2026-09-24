import mongoose from 'mongoose';
import { attachTenancy } from '../../../core/tenancy/tenancy.js';
import { DEPARTMENT_VALUES } from '../../../core/constants/index.js';
import {
  REQUISITION_STATUS, REQUISITION_STATUS_VALUES, EMPLOYMENT_TYPE, EMPLOYMENT_TYPE_VALUES,
} from '../hrms.constants.js';

const { Schema, model } = mongoose;

/**
 * A requisition: "we need N people for this role, here" — the thing a job
 * description hangs off and candidates apply to.
 *
 * Tied to a PMS project when the hiring is for a centre being opened, which is
 * the common case and the reason this module exists. Left unset for head-
 * office roles. The link is what lets a project page answer "how is hiring
 * going for this launch" without a second source of truth.
 */
const jdSchema = new Schema(
  {
    summary: { type: String, trim: true, maxlength: 2000 },
    responsibilities: [{ type: String, trim: true, maxlength: 300 }],
    requirements: [{ type: String, trim: true, maxlength: 300 }],
    niceToHave: [{ type: String, trim: true, maxlength: 300 }],
    /** Who produced the text — so an AI draft that was never edited is never
     *  mistaken for something a person wrote. */
    generatedBy: { type: String, enum: ['ai', 'user'], default: 'user' },
    generatedAt: { type: Date },
  },
  { _id: false },
);

const requisitionSchema = new Schema(
  {
    /** Human code, e.g. REQ-0007 — what people say out loud. */
    code: { type: String, unique: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    department: { type: String, enum: DEPARTMENT_VALUES, index: true },

    project: { type: Schema.Types.ObjectId, ref: 'Project', index: true },
    city: { type: String, trim: true, maxlength: 80, index: true },
    location: { type: String, trim: true, maxlength: 160 },

    headcount: { type: Number, default: 1, min: 1 },
    employmentType: { type: String, enum: EMPLOYMENT_TYPE_VALUES, default: EMPLOYMENT_TYPE.FULL_TIME },
    experienceMinYears: { type: Number, min: 0 },
    experienceMaxYears: { type: Number, min: 0 },
    /** Monthly, INR. Shown on the public page only when `showSalary`. */
    salaryMin: { type: Number, min: 0 },
    salaryMax: { type: Number, min: 0 },
    showSalary: { type: Boolean, default: false },

    jd: { type: jdSchema, default: () => ({}) },

    status: { type: String, enum: REQUISITION_STATUS_VALUES, default: REQUISITION_STATUS.DRAFT, index: true },
    /** Applications are accepted from the public page only while this is set.
     *  The instant off-switch — HR presses one button and the shared link
     *  stops taking applications, without editing a schedule or the status. */
    acceptingApplications: { type: Boolean, default: true },

    /* The scheduled application window. BOTH optional, and unset is the
       normal state: every requisition that existed before this feature has
       no schedule and must keep behaving exactly as it did — open until
       somebody says otherwise. Only `applyWindow()` interprets these. */
    applyOpensAt: { type: Date },
    applyClosesAt: { type: Date },

    targetDate: { type: Date },

    hiringManager: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },

    /** Soft delete with a reason — never physically lost (client doc §9.7). */
    deletedAt: { type: Date },
    deleteReason: { type: String, trim: true, maxlength: 300 },
  },
  { timestamps: true },
);

requisitionSchema.index({ status: 1, createdAt: -1 });
requisitionSchema.index({ project: 1, status: 1 });

attachTenancy(requisitionSchema, { modelName: 'Requisition' });

export const Requisition = model('Requisition', requisitionSchema);
export default Requisition;
