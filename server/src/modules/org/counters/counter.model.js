import mongoose from 'mongoose';
import { attachTenancy } from '../../../core/tenancy/tenancy.js';

const { Schema, model } = mongoose;

/**
 * Atomic sequences for human-facing codes (DLG-000123, CHK-00045…).
 *
 * `countDocuments() + 1` collides the moment a row is deleted or two requests
 * race; a single `$inc` on a counter document can't.
 *
 * One sequence per company: each company's codes start at 1 and are unique
 * within it (the code indexes on the ops models are per company too).
 */
const counterSchema = new Schema(
  {
    name: { type: String, required: true }, // sequence name, e.g. "delegation"
    seq: { type: Number, default: 0 },
  },
  { versionKey: false },
);

attachTenancy(counterSchema, { modelName: 'OpsCounter' });
counterSchema.index({ tenant: 1, name: 1 }, { unique: true });

export const Counter = model('OpsCounter', counterSchema, 'org_counters');

/**
 * Sequences were once keyed by `_id` (one per deployment). If such a document
 * exists and this company has no counter yet, carry its number over so codes
 * continue from where they were instead of restarting at 1 and colliding.
 */
async function carryOverLegacy(name) {
  if (await Counter.exists({ name })) return;
  const legacy = await Counter.collection.findOne({ _id: name, name: { $exists: false } });
  if (!legacy?.seq) return;
  await Counter.updateOne({ name }, { $setOnInsert: { seq: legacy.seq } }, { upsert: true })
    .catch((err) => { if (err?.code !== 11000) throw err; }); // lost a race: someone else created it
}

/** Reserve `count` consecutive numbers and return the first one. */
export async function reserveSequence(name, count = 1) {
  await carryOverLegacy(name);
  const doc = await Counter.findOneAndUpdate(
    { name },
    { $inc: { seq: count } },
    { new: true, upsert: true },
  );
  return doc.seq - count + 1;
}

/** Next formatted code, e.g. nextCode('delegation', 'DLG', 6) → "DLG-000042". */
export async function nextCode(name, prefix, width = 6) {
  const n = await reserveSequence(name, 1);
  return `${prefix}-${String(n).padStart(width, '0')}`;
}

/** A local allocator over a reserved block — for bulk inserts. */
export async function codeAllocator(name, prefix, count, width = 6) {
  let n = await reserveSequence(name, count);
  return () => `${prefix}-${String(n++).padStart(width, '0')}`;
}

export default Counter;
