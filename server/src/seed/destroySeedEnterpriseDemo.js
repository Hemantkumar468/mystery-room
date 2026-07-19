/* eslint-disable no-console */
/**
 * Companion cleanup for seedEnterpriseDemo.js — removes only the Projects it
 * tagged with a `SEED-` code prefix, plus their Records, Tasks and
 * Activities. Users created for the demo (Managing Director, department
 * Managers, extra Doers, etc.) are left alone — they're a real roster, not
 * disposable — and any project you built by hand (no `SEED-` prefix) is
 * completely untouched.
 *
 * SAFE BY DEFAULT: runs as a DRY RUN and deletes nothing. Pass --apply to persist.
 *
 *   node src/seed/destroySeedEnterpriseDemo.js            # preview only
 *   node src/seed/destroySeedEnterpriseDemo.js --apply     # actually delete
 */
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { Project } from '../modules/pms/projects/project.model.js';
import { Record } from '../modules/pms/records/record.model.js';
import { Task } from '../modules/pms/tasks/task.model.js';
import { Activity } from '../modules/pms/activity/activity.model.js';

const CODE_PREFIX = 'SEED-';
const APPLY = process.argv.includes('--apply');

async function run() {
  const projects = await Project.find({ code: new RegExp(`^${CODE_PREFIX}`) }).select('_id code');
  const projectIds = projects.map((p) => p._id);

  console.log(`\nFound ${projects.length} seeded project(s) (code prefix "${CODE_PREFIX}").`);
  if (!projects.length) return;

  const [recordCount, taskCount, activityCount] = await Promise.all([
    Record.countDocuments({ project: { $in: projectIds } }),
    Task.countDocuments({ project: { $in: projectIds } }),
    Activity.countDocuments({ project: { $in: projectIds } }),
  ]);

  console.log(`  • Records:    ${recordCount}`);
  console.log(`  • Tasks:      ${taskCount}`);
  console.log(`  • Activities: ${activityCount}`);
  console.log(`  • Projects:   ${projects.length}`);

  if (!APPLY) return;

  await Record.deleteMany({ project: { $in: projectIds } });
  await Task.deleteMany({ project: { $in: projectIds } });
  await Activity.deleteMany({ project: { $in: projectIds } });
  await Project.deleteMany({ _id: { $in: projectIds } });

  console.log('\n🗑️  Deleted all of the above. Users were left untouched.');
}

async function main() {
  await connectDatabase();
  console.log(APPLY ? '\n== APPLYING destroy ==' : '\n== DRY RUN (no writes) — pass --apply to persist ==');
  await run();
}

main()
  .catch((err) => {
    console.error('✖ Destroy failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDatabase();
    await mongoose.connection.close().catch(() => {});
    process.exit(process.exitCode || 0);
  });
