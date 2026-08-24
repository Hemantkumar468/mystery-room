import mongoose from 'mongoose';
import { config } from './src/config/index.js';
await mongoose.connect(config.db.uri);
// RAW collection read — no Mongoose schema in the way, so this is what is truly stored.
const raw = await mongoose.connection.db.collection('templates').find({}).toArray();
for (const t of raw) {
  const p6 = (t.stages || []).find((s) => s.key === 'p6');
  const types = (p6?.assessmentTypes || []).map((a) => `${a.key}${a.noDecision ? ' [noDecision]' : ''}`);
  console.log(`${t.code}: p6 assessmentTypes = ${types.length ? types.join(', ') : '(none)'}`);
}
await mongoose.disconnect();
