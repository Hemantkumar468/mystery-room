/* eslint-disable no-console */
/** THROWAWAY verification script for the StatusDropdown feature — creates one test project with a property eligible for Store Launch and a couple of p9 records to click through in the browser. Delete after verification. */
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { User } from '../modules/auth/auth.model.js';
import { Template } from '../modules/pms/templates/template.model.js';
import { projectService } from '../modules/pms/projects/project.service.js';
import { recordService } from '../modules/pms/records/record.service.js';

async function main() {
  await connectDatabase();

  const admin = await User.findOne({ email: 'admin@mysteryrooms.in' });
  if (!admin) throw new Error('admin@mysteryrooms.in not found');
  const template = await Template.findOne({ code: 'MR-PMS-STORE-LAUNCH' });
  if (!template) throw new Error('Default template not found');

  const project = await projectService.create(
    {
      templateId: template._id,
      name: 'QA — Status Dropdown Verification',
      city: 'Lucknow',
      address: 'Gomti Nagar, Lucknow',
      areaSqft: 2200,
      priority: 'medium',
      owner: admin._id,
      plannedStartDate: new Date('2026-01-01'),
      budget: 1250000,
    },
    admin._id,
  );
  console.log('Created project:', project.code, project._id.toString());

  const property = await recordService.create(
    {
      projectId: project._id,
      stageKey: 'p1',
      status: 'submitted',
      values: {
        property_name: 'Pacific Mall Retail Unit',
        locality: 'Gomti Nagar',
        city: 'Lucknow',
        carpet_area: 1800,
        commercial_type: 'Lease',
      },
    },
    admin._id,
  );
  await recordService.decide(property._id, 'shortlist', undefined, admin._id);

  const p8Stage = template.stages.find((s) => s.key === 'p8');
  for (const type of p8Stage.assessmentTypes) {
    const boolFields = type.masterDataSchema.filter((f) => f.type === 'boolean');
    const values = Object.fromEntries(boolFields.map((f) => [f.key, true]));
    const rec = await recordService.create(
      { projectId: project._id, stageKey: 'p8', assessmentType: type.key, parentRecordId: property._id, status: 'submitted', values },
      admin._id,
    );
    await recordService.decide(rec._id, 'approve', undefined, admin._id);
  }
  console.log('Phase 8 fully approved');

  const p9Stage = template.stages.find((s) => s.key === 'p9');
  // Leave every p9 module as a fresh "submitted" record so the Status
  // dropdown has real rows to click through in the browser.
  for (const type of p9Stage.assessmentTypes.slice(0, 3)) {
    const boolFields = type.masterDataSchema.filter((f) => f.type === 'boolean');
    const values = Object.fromEntries(boolFields.map((f) => [f.key, true]));
    if (type.key === 'go_live_approval') {
      values.store_manager = 'Vikram Sahu';
      values.actual_opening_date = new Date('2026-08-12');
      values.actual_cost = 1137500;
    }
    await recordService.create(
      { projectId: project._id, stageKey: 'p9', assessmentType: type.key, parentRecordId: property._id, status: 'submitted', values },
      admin._id,
    );
  }
  console.log('Phase 9 has 3 fresh submitted records to test the Status dropdown on');

  console.log('\nOpen: http://localhost:5173/projects/' + project._id.toString() + '/store-launch');
}

main()
  .catch((err) => { console.error('✖ Failed:', err); process.exitCode = 1; })
  .finally(async () => {
    await disconnectDatabase();
    await mongoose.connection.close().catch(() => {});
    process.exit(process.exitCode || 0);
  });
