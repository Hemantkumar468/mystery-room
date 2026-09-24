import mongoose from 'mongoose';
import { attachTenancy } from '../../core/tenancy/tenancy.js';
import {
  REMINDER_UNITS,
  REMINDER_TRIGGERS,
  REMINDER_CHANNELS,
  FOLLOWUP_CALL_STATUS,
} from '../../core/constants/ops.js';

const { Schema, model } = mongoose;

/**
 * The trails that hang off a delegation. Separate collections (not embedded
 * arrays) because they grow without bound and are read across sub-task trees.
 */

/** Comment thread — plus mirrored management / coordinator remarks and system notes. */
const remarkSchema = new Schema(
  {
    delegation: { type: Schema.Types.ObjectId, ref: 'Delegation', required: true, index: true },
    author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true, maxlength: 4000 },
    kind: { type: String, enum: ['comment', 'management', 'coordinator', 'system'], default: 'comment' },
    attachments: [{ type: String }],
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
remarkSchema.index({ delegation: 1, createdAt: 1 });

/** Every due-date or status change, with the reason given. */
const revisionSchema = new Schema(
  {
    delegation: { type: Schema.Types.ObjectId, ref: 'Delegation', required: true, index: true },
    oldDueDate: Date,
    newDueDate: Date,
    oldStatus: String,
    newStatus: String,
    reason: { type: String, maxlength: 2000 },
    changedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

/** A scheduled nudge relative to the due date ("1 day before", "2 hours after"). */
const reminderSchema = new Schema(
  {
    delegation: { type: Schema.Types.ObjectId, ref: 'Delegation', required: true, index: true },
    channel: { type: String, enum: REMINDER_CHANNELS, default: 'in_app' },
    value: { type: Number, required: true, min: 1 },
    unit: { type: String, enum: REMINDER_UNITS, required: true },
    trigger: { type: String, enum: REMINDER_TRIGGERS, required: true },
    fireAt: { type: Date, required: true },
    sentAt: { type: Date },
  },
  { timestamps: true },
);
reminderSchema.index({ sentAt: 1, fireAt: 1 });

/** An operations coordinator's call to the doer — an observation, not a status change. */
const followupSchema = new Schema(
  {
    delegation: { type: Schema.Types.ObjectId, ref: 'Delegation', required: true, index: true },
    follower: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    callStatus: { type: String, enum: FOLLOWUP_CALL_STATUS, required: true },
    observedStatus: { type: String, maxlength: 100 },
    response: { type: String, maxlength: 2000 },
    systemUpdated: { type: Boolean }, // had the doer updated the ERP?
    nextFollowUpDate: Date,
    escalationRequired: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

attachTenancy(remarkSchema, { modelName: 'DelegationRemark' });
attachTenancy(revisionSchema, { modelName: 'DelegationRevision' });
attachTenancy(reminderSchema, { modelName: 'DelegationReminder' });
attachTenancy(followupSchema, { modelName: 'DelegationFollowup' });
export const DelegationRemark = model('DelegationRemark', remarkSchema, 'dlg_remarks');
export const DelegationRevision = model('DelegationRevision', revisionSchema, 'dlg_revisions');
export const DelegationReminder = model('DelegationReminder', reminderSchema, 'dlg_reminders');
export const DelegationFollowup = model('DelegationFollowup', followupSchema, 'dlg_followups');
