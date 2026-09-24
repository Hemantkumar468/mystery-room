import mongoose from 'mongoose';
import { attachTenancy } from '../../../core/tenancy/tenancy.js';
import {
  TASK_TYPE, TASK_TYPE_VALUES, TASK_STATUS, TASK_STATUS_VALUES,
  TASK_PRIORITY, TASK_PRIORITY_VALUES, ENTITY_TYPE_VALUES,
} from '../crm.constants.js';

const { Schema, model } = mongoose;

/**
 * A follow-up somebody owes somebody else.
 *
 * More deals die of a missed follow-up than of price or product, which makes
 * this the highest-value collection in the module even though it is the
 * simplest. Everything the "Today" screen shows is a query over these rows.
 *
 * NAMED `CrmTask`, not `Task`: PMS already registers a `Task` model for
 * project work, and a second `model('Task', …)` throws at import time and
 * takes the whole API down at boot. Same reason CrmActivity is not Activity.
 */
const crmTaskSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    notes: { type: String, maxlength: 2000 },

    /** What KIND of work — the field that makes an activity-mix report
     *  possible. See TASK_TYPE for why it is not free text. */
    type: { type: String, enum: TASK_TYPE_VALUES, default: TASK_TYPE.CALL, index: true },
    status: { type: String, enum: TASK_STATUS_VALUES, default: TASK_STATUS.OPEN, index: true },
    priority: { type: String, enum: TASK_PRIORITY_VALUES, default: TASK_PRIORITY.NORMAL },

    /* ── Who and what ───────────────────────────────────── */
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    entityType: { type: String, enum: ENTITY_TYPE_VALUES, index: true },
    entityId: { type: Schema.Types.ObjectId, index: true },
    /** Denormalised so the Today screen can render a row without a second
     *  lookup per task. Refreshed when the record is renamed is NOT attempted:
     *  a task's label is what the record was called when the task was made. */
    entityLabel: { type: String, trim: true, maxlength: 200 },

    /* ── When ───────────────────────────────────────────── */
    dueAt: { type: Date, required: true, index: true },
    durationMinutes: { type: Number, min: 0 },
    completedAt: { type: Date },

    /**
     * HOW we know this was done — not just that somebody said so.
     *
     * Completion is self-reported: an agent clearing their list can tick a
     * call they never made, and every response-time figure downstream then
     * reports a number nobody earned. That cannot be fully prevented, and
     * pretending otherwise would be worse than admitting it.
     *
     * What CAN be done is record which claims are backed by something. Once
     * telephony lands (§4), completing a call-type task looks for a real call
     * activity against the same record inside a window: found → `telephony`,
     * not found → `self_reported`. The task still completes either way —
     * blocking it would just teach people to log a fake call first — but the
     * two are then distinguishable, and "X% of this agent's completions have
     * no matching call" becomes a question that can be asked.
     *
     * The FIELD ships now, before the verification does, because it cannot be
     * filled in retroactively: a completion recorded today without it is
     * unverifiable forever.
     */
    completionSource: {
      type: String,
      enum: ['self_reported', 'telephony', 'whatsapp', 'email', 'system'],
      default: undefined,
    },
    /** The activity that corroborated it, when one did. */
    completionEvidence: { type: Schema.Types.ObjectId, ref: 'CrmActivity' },

    /**
     * Minutes BEFORE `dueAt` to be reminded; null for no reminder.
     *
     * The OFFSET is stored, not the instant. Rescheduling a task has to move
     * its reminder with it, and an absolute `remindAt` silently detaches the
     * moment you change the due date — the reminder then fires for a time that
     * no longer exists. `remindAt` below is derived from this by the hook.
     */
    reminderOffsetMinutes: { type: Number, default: null },
    /** Derived. Never set directly. */
    remindAt: { type: Date, index: true },
    /** Stamped when the sweeper has handled it, so a reminder fires once. */
    reminderSentAt: { type: Date },

    /* ── Provenance ─────────────────────────────────────── */
    /**
     * The rule that created this task, if a rule did.
     *
     * Without it, an agent opening their Today screen cannot tell work they
     * planned from work the system decided they owe — and automated tasks that
     * cannot be explained are automated tasks people start ignoring wholesale.
     */
    createdByRule: { type: String, trim: true, maxlength: 80 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'crmtasks' },
);

/**
 * `remindAt` follows the offset and the due date, always.
 *
 * Recomputed whenever either changes, and the sent stamp is cleared with it so
 * a rescheduled task can fire again. Deriving this on read instead would mean
 * the sweeper could not use an index to find what is due.
 */
crmTaskSchema.pre('save', function deriveRemindAt(next) {
  if (this.isModified('reminderOffsetMinutes') || this.isModified('dueAt')) {
    const offset = this.reminderOffsetMinutes;
    if (offset == null || !this.dueAt) this.remindAt = undefined;
    else this.remindAt = new Date(new Date(this.dueAt).getTime() - offset * 60_000);
    this.reminderSentAt = undefined;
  }
  next();
});

/** THE Today query: one person's open work, soonest first. */
crmTaskSchema.index({ owner: 1, status: 1, dueAt: 1 });
/** The reminder sweep: what is due to be announced and has not been. */
crmTaskSchema.index({ remindAt: 1, reminderSentAt: 1, status: 1 });
/** "Does this record already have an open task of this kind?" — the check that
 *  stops the rule engine creating the same follow-up twice. */
crmTaskSchema.index({ entityType: 1, entityId: 1, type: 1, status: 1 });

attachTenancy(crmTaskSchema, { modelName: 'CrmTask' });

export const CrmTask = model('CrmTask', crmTaskSchema);
export default CrmTask;
