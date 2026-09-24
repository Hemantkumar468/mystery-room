import { logger } from '../../config/logger.js';
import { currentActor } from './auditContext.js';

/**
 * Record every change to a record, automatically.
 *
 * ONE RULE, ONE PLACE — the same shape as `attachTenancy` and
 * `attachPhoneNormalisation`. An audit call written by hand in each service is
 * one that the next service forgets, and the forgetting is invisible: the
 * feature works perfectly and simply leaves no trace. You discover it the day
 * somebody asks who changed a deal's value, and the answer is missing for
 * exactly the six months nobody was looking.
 *
 * WHAT IT CAPTURES. Only the fields that actually changed, and for each one
 * what it was before. The new value is already in the record and can be read
 * from it; the old one is destroyed by the write, and it is what every real
 * question actually needs.
 *
 * WHAT IT DOES NOT CAPTURE. Fields listed in `skip` — timestamps, computed
 * counters, anything that changes on every save. An audit trail where every
 * row says "updatedAt changed" is one nobody reads, and a log nobody reads is
 * the same as no log.
 *
 * NEVER FAILS THE WRITE. If the audit row cannot be written, the business
 * operation still completes and the failure is logged. Refusing to update a
 * customer's phone number because a log entry could not be saved would be the
 * tail wagging the dog — but it must be loud, because a silently broken audit
 * trail is a compliance problem wearing a working feature's clothes.
 */

/** Fields whose change is noise on every single write. */
const ALWAYS_SKIP = new Set([
  'updatedAt', 'createdAt', '__v', 'lastActivityAt', 'tenant',
]);

/** A value small enough to keep, and readable when somebody reads it back. */
function summarise(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (typeof value === 'object') return String(value._id || value);
  const text = String(value);
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

/**
 * @param {import('mongoose').Schema} schema
 * @param {{modelName: string, label?: string, skip?: string[]}} opts
 *   `label` is the path whose value identifies the record to a human.
 */
export function attachAudit(schema, opts) {
  const modelName = opts?.modelName;
  if (!modelName) throw new Error('attachAudit needs a modelName.');
  const skip = new Set([...ALWAYS_SKIP, ...(opts.skip || [])]);
  const labelPath = opts.label;

  const write = async (row) => {
    try {
      const { AuditLog } = await import('./audit.model.js');
      await AuditLog.create(row);
    } catch (err) {
      logger.error(`Audit row for ${modelName} could not be written: ${err.message}`);
    }
  };

  const actorFields = () => {
    const actor = currentActor();
    return {
      actor: actor?.id,
      actorName: actor?.name,
      actorRole: actor?.role,
      ip: actor?.ip,
    };
  };

  /**
   * Document saves.
   *
   * THE STORED VALUES ARE RE-READ, one extra query per audited save. Mongoose
   * has no supported way to ask a modified document what a field used to be —
   * the previous value lives in `doc.$__.originalValue`, which is private, has
   * changed shape between major versions, and would fail SILENTLY when it does:
   * every `from` would quietly become undefined and the log would keep looking
   * complete. Reading the row is one query and cannot drift.
   *
   * Only for documents that actually changed something worth recording, so an
   * ordinary save with nothing but a timestamp costs nothing extra.
   */
  schema.pre('save', async function captureBefore() {
    this.$locals.auditWasNew = this.isNew;
    if (this.isNew) return;

    /* TOP-LEVEL FIELDS ONLY, and for two reasons.
       Correctness first: Mongoose reports a changed array as both `stageHistory`
       and `stageHistory.0.exitedAt`, and asking MongoDB to project both in one
       query is a "Path collision" error — which is how this plugin broke every
       deal move the moment it was attached.
       Usefulness second: "entry 0's duration changed" is not a fact anybody
       audits. "Who moved this deal, and what was it worth before" is. */
    const changed = [...new Set(
      this.modifiedPaths({ includeChildren: false })
        .filter((path) => !path.includes('.'))
        .filter((path) => !skip.has(path)),
    )];
    if (!changed.length) return;

    const before = await this.constructor.findById(this._id)
      .select([...changed, labelPath].filter(Boolean).join(' '))
      .lean();

    // Stashed rather than written now: the save may still fail, and an audit
    // row for a change that never landed is worse than no row at all.
    this.$locals.auditChanges = changed
      .map((field) => ({
        field,
        from: summarise(before?.[field]),
        to: summarise(this.get(field)),
      }))
      .filter((c) => c.from !== c.to);
  });

  schema.post('save', async function afterSave(doc) {
    const isCreate = doc.$locals.auditWasNew;
    const changes = doc.$locals.auditChanges || [];
    if (!isCreate && !changes.length) return;

    await write({
      entity: modelName,
      entityId: doc._id,
      label: labelPath ? summarise(doc.get(labelPath)) : undefined,
      action: isCreate ? 'create' : 'update',
      changes: isCreate ? [] : changes,
      ...actorFields(),
    });
  });

  /**
   * Query updates. The document is not in hand, so the previous values have to
   * be READ FIRST — after the write they are gone. One extra query per audited
   * update, which is the price of the trail being true.
   */
  schema.pre(['updateOne', 'findOneAndUpdate'], async function captureQueryBefore() {
    const update = this.getUpdate() || {};
    const fields = Object.keys({ ...update.$set, ...(Array.isArray(update) ? {} : update) })
      .filter((f) => !f.startsWith('$'))
      .filter((f) => !skip.has(f));
    if (!fields.length) return;

    /* Projected by their ROOT segment, deduplicated — `meta.tracking.opens`
       and `meta` in the same projection is the same "Path collision" that
       broke the document path above. The full field name is still what gets
       recorded; only the read is widened. */
    const roots = [...new Set([...fields.map((f) => f.split('.')[0]), labelPath].filter(Boolean))];
    const before = await this.model.findOne(this.getFilter())
      .select(roots.join(' '))
      .lean();

    this._auditBefore = before;
    this._auditFields = fields;
  });

  schema.post(['updateOne', 'findOneAndUpdate'], async function afterQueryUpdate(result) {
    const before = this._auditBefore;
    const fields = this._auditFields;
    if (!before || !fields?.length) return;
    if (result?.matchedCount === 0) return; // nothing changed, nothing to log

    const update = this.getUpdate() || {};
    const next = { ...update.$set, ...update };
    const changes = fields
      .map((field) => ({
        field,
        from: summarise(before[field]),
        to: summarise(next[field]),
      }))
      .filter((c) => c.from !== c.to);
    if (!changes.length) return;

    await write({
      entity: modelName,
      entityId: before._id,
      label: labelPath ? summarise(before[labelPath]) : undefined,
      action: 'update',
      changes,
      ...actorFields(),
    });
  });

  schema.pre(['deleteOne', 'findOneAndDelete'], async function captureDeleted() {
    this._auditDeleted = await this.model.findOne(this.getFilter())
      .select([labelPath].filter(Boolean).join(' ')).lean();
  });

  schema.post(['deleteOne', 'findOneAndDelete'], async function afterDelete() {
    const gone = this._auditDeleted;
    if (!gone) return;
    await write({
      entity: modelName,
      entityId: gone._id,
      label: labelPath ? summarise(gone[labelPath]) : undefined,
      action: 'delete',
      ...actorFields(),
    });
  });

  return schema;
}

/** Record something that is not a field edit — an export, an access alert. */
export async function recordAudit(row) {
  const { AuditLog } = await import('./audit.model.js');
  const actor = currentActor();
  try {
    await AuditLog.create({
      actor: actor?.id,
      actorName: actor?.name,
      actorRole: actor?.role,
      ip: actor?.ip,
      ...row,
    });
  } catch (err) {
    logger.error(`Audit row could not be written: ${err.message}`);
  }
}

export default attachAudit;
