import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * Atomic sequences for human-facing codes (DLG-000123, CHK-00045…).
 *
 * `countDocuments() + 1` collides the moment a row is deleted or two requests
 * race; a single `$inc` on a counter document can't.
 */
const counterSchema = new Schema(
  {
    _id: { type: String }, // sequence name, e.g. "delegation"
    seq: { type: Number, default: 0 },
  },
  { versionKey: false },
);

export const Counter = model('OpsCounter', counterSchema, 'org_counters');

/** Reserve `count` consecutive numbers and return the first one. */
export async function reserveSequence(name, count = 1) {
  const doc = await Counter.findOneAndUpdate(
    { _id: name },
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
