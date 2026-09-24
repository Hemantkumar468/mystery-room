import mongoose from 'mongoose';
import { attachTenancy } from '../../../core/tenancy/tenancy.js';

const { Schema, model } = mongoose;

const labelSchema = (extra = {}) =>
  new Schema(
    {
      name: { type: String, required: true, trim: true, maxlength: 60 },
      color: { type: String, default: '#6E45FF' },
      createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
      ...extra,
    },
    { timestamps: true },
  );

// Case-insensitive uniqueness, per company: "Maintenance" and "maintenance" are one category.
const ci = { locale: 'en', strength: 2 };

const categorySchema = labelSchema();
categorySchema.index({ tenant: 1, name: 1 }, { unique: true, collation: ci });

const tagSchema = labelSchema();
tagSchema.index({ tenant: 1, name: 1 }, { unique: true, collation: ci });

attachTenancy(categorySchema, { modelName: 'TaskCategory' });
attachTenancy(tagSchema, { modelName: 'TaskTag' });
/** Delegation category — "Maintenance", "Game Upkeep", "Vendor", "Compliance"… */
export const TaskCategory = model('TaskCategory', categorySchema, 'org_categories');
/** Free-form task tag. */
export const TaskTag = model('TaskTag', tagSchema, 'org_tags');
