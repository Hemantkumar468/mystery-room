import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * Company holiday. Stored as a calendar-day key ('YYYY-MM-DD') rather than a
 * timestamp, so "is the 26th a holiday?" never depends on server timezone.
 * Checklist generation skips these days, and declaring one moves any open
 * checklist occurrences off it.
 */
const holidaySchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    date: { type: String, required: true, unique: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

export const Holiday = model('Holiday', holidaySchema, 'org_holidays');
export default Holiday;
