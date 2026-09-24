import mongoose from 'mongoose';
import { attachTenancy } from '../../core/tenancy/tenancy.js';
import { DELEGATION_FREQUENCY_VALUES } from '../../core/constants/ops.js';
import { PRIORITY_VALUES } from '../../core/constants/index.js';

const { Schema, model } = mongoose;

/**
 * "Repeat this delegation" — the rule behind a recurring task. A nightly job
 * reads it and creates tomorrow's instance when the rule matches. The task
 * blueprint is copied here so later edits to one instance don't change the
 * routine.
 */
const recurrenceSchema = new Schema(
  {
    source: { type: Schema.Types.ObjectId, ref: 'Delegation' }, // first instance
    isActive: { type: Boolean, default: true, index: true },

    frequency: { type: String, enum: DELEGATION_FREQUENCY_VALUES, required: true },
    startDate: { type: String, required: true }, // 'YYYY-MM-DD'
    endDate: { type: String }, // inclusive, optional
    weeklyDays: [{ type: Number, min: 0, max: 6 }], // 0 = Sunday
    monthDates: [{ type: String }], // '1'…'31' or 'last'
    intervalDays: { type: Number, min: 1 }, // periodically
    custom: {
      every: { type: String, enum: ['week', 'month'] },
      value: { type: Number, min: 1 },
      weekdays: [{ type: Number, min: 0, max: 6 }],
      dates: [{ type: String }],
    },
    // Idempotency guard: the day key the last instance was generated for.
    lastGeneratedFor: { type: String },

    blueprint: {
      title: { type: String, required: true },
      description: String,
      assigner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
      doer: { type: Schema.Types.ObjectId, ref: 'User', required: true },
      inLoop: [{ type: Schema.Types.ObjectId, ref: 'User' }],
      branch: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
      group: { type: Schema.Types.ObjectId, ref: 'WorkGroup' },
      category: String,
      tags: [String],
      priority: { type: String, enum: PRIORITY_VALUES },
      checklistItems: [{ text: String }],
      evidenceRequired: Boolean,
      verificationRequired: Boolean,
      voiceNoteUrl: String,
      referenceDocs: [String],
      reminders: [{ channel: String, value: Number, unit: String, trigger: String }],
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

attachTenancy(recurrenceSchema, { modelName: 'DelegationRecurrence' });
export const DelegationRecurrence = model('DelegationRecurrence', recurrenceSchema, 'dlg_recurrences');
export default DelegationRecurrence;
