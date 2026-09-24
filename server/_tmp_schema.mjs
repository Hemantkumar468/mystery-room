import { connectDatabase, disconnectDatabase } from './src/config/database.js';
import { Project } from './src/modules/pms/projects/project.model.js';
import { Template } from './src/modules/pms/templates/template.model.js';

await connectDatabase();
const p = await Project.findOne({ code: 'MR-AHM-001' }).lean();
const tId = p.template?.ref || p.template;
const t = await Template.findById(tId).lean();
const p3 = t.stages.find(s => s.key === 'p3');
for (const type of p3.assessmentTypes) {
  console.log('---', type.key, type.name, 'subKeyField:', type.subKeyField, '---');
  console.log(JSON.stringify(type.masterDataSchema, null, 2).slice(0, 1500));
}
await disconnectDatabase();
