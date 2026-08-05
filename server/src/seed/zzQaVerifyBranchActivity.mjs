// Temporary, read-only QA verification script — confirms Step 2.1's Branch
// create/update actions actually logged to the shared Activity collection.
// Not a migration, not wired into package.json; delete after use.
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { Activity } from '../modules/pms/activity/activity.model.js';

await connectDatabase();
const entries = await Activity.find({ entityType: 'branch' }).sort({ createdAt: -1 }).limit(15).lean();
console.log(JSON.stringify(entries.map((e) => ({
  action: e.action, message: e.message, entityId: String(e.entityId), createdAt: e.createdAt,
})), null, 2));
await disconnectDatabase();
process.exit(0);
