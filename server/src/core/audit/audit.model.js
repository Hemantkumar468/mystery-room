import mongoose from 'mongoose';
import { attachTenancy } from '../tenancy/tenancy.js';

const { Schema, model } = mongoose;

/**
 * Who changed what, when, and what it was before.
 *
 * WHY THE PREVIOUS VALUE MATTERS MORE THAN THE NEW ONE. The new value is
 * already in the record — you can read it. The old one is gone the instant the
 * write lands, and it is what every real question needs: who dropped this
 * deal's value from twelve lakh to four, who moved this lead off Priya, who
 * changed the SLA target the week the report improved. An audit log that only
 * says "someone updated a deal" answers none of them.
 *
 * SEPARATE FROM CrmActivity, deliberately. An activity is a business event a
 * customer would recognise — a call, an email, a stage change — and it is
 * shown on the timeline. This is a forensic record: it captures things nobody
 * wants on a timeline (a permission change, an export request, a bulk
 * reassignment) and it is never rendered next to the customer's history.
 *
 * WRITE-ONLY BY CONVENTION. Nothing in the application updates or deletes a
 * row here. There is no service method for it, and there should not be: a log
 * somebody can edit is not evidence of anything.
 */
const auditLogSchema = new Schema(
  {
    /** The model, as Mongoose knows it: 'Lead', 'Deal', 'Ticket'. */
    entity: { type: String, required: true, index: true },
    entityId: { type: Schema.Types.ObjectId, index: true },
    /** A human-readable handle — the lead's name, the deal's title — captured
     *  at write time so the log still reads sensibly after the record is
     *  deleted, which is exactly when somebody comes looking. */
    label: { type: String, trim: true, maxlength: 200 },

    action: {
      type: String,
      enum: ['create', 'update', 'delete', 'export', 'access', 'offboard'],
      required: true,
      index: true,
    },

    actor: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    actorName: { type: String, trim: true, maxlength: 120 },
    actorRole: { type: String, trim: true, maxlength: 40 },

    /**
     * Field-by-field: what it was, what it became.
     *
     * Only the fields that actually changed. Storing the whole document before
     * and after would double the database for no gain and would quietly
     * archive personal data in a second place with no deletion path.
     */
    changes: [{
      field: { type: String },
      from: { type: Schema.Types.Mixed },
      to: { type: Schema.Types.Mixed },
      _id: false,
    }],

    /** Free context for actions that are not field edits — an export's reason,
     *  a scraping alert's count. */
    detail: { type: String, maxlength: 1000 },

    ip: { type: String, trim: true, maxlength: 64 },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'audit_logs' },
);

/** "Everything that happened to this record" and "everything this person did"
 *  are the only two ways anybody reads this. One index each. */
auditLogSchema.index({ entity: 1, entityId: 1, createdAt: -1 });
auditLogSchema.index({ actor: 1, createdAt: -1 });

attachTenancy(auditLogSchema, { modelName: 'AuditLog' });

export const AuditLog = model('AuditLog', auditLogSchema);
export default AuditLog;
