import mongoose from 'mongoose';
import { PRIORITY_VALUES } from '../../core/constants/index.js';

const { Schema, model } = mongoose;

/**
 * Reusable task preset ("Weekly lock & prop audit", "Monthly fire-safety check")
 * that pre-fills the new-task form. Unrelated to PMS project templates.
 */
const taskTemplateSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 250 },
    description: { type: String, trim: true, maxlength: 5000 },
    category: { type: String, trim: true },
    priority: { type: String, enum: PRIORITY_VALUES },
    checklistItems: [{ text: { type: String, trim: true } }],
    evidenceRequired: { type: Boolean, default: false },
    verificationRequired: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

export const DelegationTemplate = model('DelegationTemplate', taskTemplateSchema, 'dlg_templates');
export default DelegationTemplate;
