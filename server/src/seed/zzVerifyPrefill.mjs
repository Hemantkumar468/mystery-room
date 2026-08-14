/* eslint-disable no-console */
/**
 * Scratch check (safe to delete): resolves the feasibility form for a real
 * property record exactly the way the prefill service does, WITHOUT calling a
 * provider — so it proves the lookup that was returning 400 now finds the form.
 *
 *   node src/seed/zzVerifyPrefill.mjs <recordId>
 */
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { Record } from '../modules/pms/records/record.model.js';
import { Project } from '../modules/pms/projects/project.model.js';
import { Template } from '../modules/pms/templates/template.model.js';
import { canPrefill, PREFILLABLE } from '../modules/ai/analysis/assessmentPrefill.service.js';

const recordId = process.argv[2];

async function main() {
  await connectDatabase();
  if (!recordId) {
    const sample = await Record.find({ stageKey: 'p1' }).select('_id title values.property_name').limit(5).lean();
    console.log('Pass a property recordId. Recent p1 records:');
    for (const r of sample) console.log(`  ${r._id}  ${r.values?.property_name || r.title || ''}`);
    return;
  }

  const record = await Record.findById(recordId);
  console.log(`record   : ${record ? (record.values?.property_name || record.title) : 'NOT FOUND'}`);
  if (!record) return;

  const project = await Project.findById(record.project).select('name city template');
  console.log(`project  : ${project?.name} (${project?.city})`);
  console.log(`template : ${project?.template?.name}  ref=${project?.template?.ref}`);

  const template = await Template.findById(project?.template?.ref).select('stages');
  const stage = template?.stages?.find((s) => s.key === 'p2');
  console.log(`p2 stage : ${stage ? stage.name : 'MISSING'}`);
  console.log(`forms    : ${(stage?.assessmentTypes || []).map((a) => a.key).join(', ') || 'none'}`);

  for (const type of PREFILLABLE) {
    const form = stage?.assessmentTypes?.find((a) => a.key === type);
    const n = form?.masterDataSchema?.length || 0;
    console.log(`  ${type.padEnd(12)} allowed=${canPrefill(type)}  form=${form ? 'found' : 'MISSING'}  fields=${n}`);
    if (form) {
      const fillable = form.masterDataSchema.filter((f) =>
        ['text', 'textarea', 'number', 'select', 'multiselect', 'boolean'].includes(f.type));
      console.log(`     AI would draft ${fillable.length}: ${fillable.map((f) => f.key).join(', ')}`);
    }
  }
}

main()
  .catch((e) => { console.error('FAILED:', e.message); process.exitCode = 1; })
  .finally(async () => {
    await disconnectDatabase();
    await mongoose.connection.close().catch(() => {});
    process.exit(process.exitCode || 0);
  });
