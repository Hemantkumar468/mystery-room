/* eslint-disable no-console */
import dayjs from 'dayjs';
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { User } from '../modules/auth/auth.model.js';
import { Template } from '../modules/pms/templates/template.model.js';
import { Project } from '../modules/pms/projects/project.model.js';
import { Task } from '../modules/pms/tasks/task.model.js';
import { Activity } from '../modules/pms/activity/activity.model.js';
import { projectService } from '../modules/pms/projects/project.service.js';
import { ROLES, DEPARTMENTS, TASK_STATUS } from '../core/constants/index.js';
import { franchiseLaunchTemplate } from './franchiseTemplate.js';
import { storeLaunchTemplate } from './storeLaunchTemplate.js';

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[rand(0, arr.length - 1)];

const USERS = [
  { name: 'Rahul Yadav', email: 'admin@mysteryrooms.in', role: ROLES.MD, title: 'Managing Director', avatarColor: '#6E45FF' },
  { name: 'Priya Menon', email: 'priya@mysteryrooms.in', role: ROLES.MANAGER, department: DEPARTMENTS.EXPANSION, title: 'Expansion Lead', avatarColor: '#F5A623' },
  { name: 'Arjun Nair', email: 'arjun@mysteryrooms.in', role: ROLES.MANAGER, department: DEPARTMENTS.PROJECTS, title: 'Projects Head', avatarColor: '#14B8A6' },
  { name: 'Neha Kapoor', email: 'neha@mysteryrooms.in', role: ROLES.MANAGER, department: DEPARTMENTS.HR, title: 'HR Manager', avatarColor: '#F43F5E' },
  // employeeId links each executor to their department's primary "doer" in the
  // roster (client/src/lib/employees.js) so they can own that task's status.
  { name: 'Vikram Rao', email: 'vikram@mysteryrooms.in', role: ROLES.EMPLOYEE, department: DEPARTMENTS.EXPANSION, employeeId: 'emp-exp-001', title: 'Site Scout', avatarColor: '#A855F7' },
  { name: 'Sana Sheikh', email: 'sana@mysteryrooms.in', role: ROLES.EMPLOYEE, department: DEPARTMENTS.LEGAL, employeeId: 'emp-leg-001', title: 'Legal Associate', avatarColor: '#38BDF8' },
  { name: 'Karan Gupta', email: 'karan@mysteryrooms.in', role: ROLES.EMPLOYEE, department: DEPARTMENTS.PROJECTS, employeeId: 'emp-prj-002', title: 'Site Engineer', avatarColor: '#0EA5A4' },
  { name: 'Divya Iyer', email: 'divya@mysteryrooms.in', role: ROLES.EMPLOYEE, department: DEPARTMENTS.MARKETING, employeeId: 'emp-mkt-001', title: 'Marketing Exec', avatarColor: '#84CC16' },
  { name: 'Rohit Sharma', email: 'rohit@mysteryrooms.in', role: ROLES.EMPLOYEE, department: DEPARTMENTS.OPERATIONS, employeeId: 'emp-ops-001', title: 'Ops Executive', avatarColor: '#EC4899' },
  { name: 'Ananya Das', email: 'ananya@mysteryrooms.in', role: ROLES.EMPLOYEE, department: DEPARTMENTS.FINANCE, employeeId: 'emp-fin-001', title: 'Finance Analyst', avatarColor: '#F59E0B' },
];

const DEFAULT_PASSWORD = 'Admin@123';

// city, start offset (days from today; negative = past), lagging days behind schedule.
const PROJECTS = [
  { name: 'Mystery Rooms — Koregaon Park', city: 'Pune', startOffset: -62, lagging: 0, area: 3200, budget: 4800000 },
  { name: 'Mystery Rooms — Sector 26', city: 'Chandigarh', startOffset: -88, lagging: 14, area: 2800, budget: 4200000 },
  { name: 'Mystery Rooms — C-Scheme', city: 'Jaipur', startOffset: -34, lagging: 3, area: 3000, budget: 4500000 },
  { name: 'Mystery Rooms — Hazratganj', city: 'Lucknow', startOffset: -12, lagging: 0, area: 2600, budget: 3900000 },
  { name: 'Mystery Rooms — Beach Road', city: 'Visakhapatnam', startOffset: 8, lagging: 0, area: 2900, budget: 4100000 },
];

async function clearAll() {
  await Promise.all([
    User.deleteMany({}),
    Template.deleteMany({}),
    Project.deleteMany({}),
    Task.deleteMany({}),
    Activity.deleteMany({}),
  ]);
  console.log('🧹 Cleared existing collections');
}

/**
 * Seed-only: populate a freshly created demo project with realistic Task
 * documents cascaded from its template's `stages[].tasks` blueprint, so
 * `simulateProgress()` below has something to mutate into a believable
 * progress history for the dashboard/MIS demo data.
 *
 * Production project creation deliberately does NOT do this anymore — see
 * `materializeFromTemplate()`'s doc comment in project.service.js. A real
 * project's tasks only ever exist because a real user allocated one via
 * AllocateTaskModal. This mirrors that same cascade (planned dates, code
 * numbering, checklist, roster assignees) but only ever runs here, once, at
 * `npm run seed` — never on a live project.
 */
async function seedTasksForTemplateStages(project, template, createdBy) {
  const taskDocs = [];
  const stageByKey = new Map(project.stages.map((s) => [s.key, s]));
  const orderedStages = [...template.stages].sort((a, b) => a.order - b.order);

  for (const stage of orderedStages) {
    const liveStage = stageByKey.get(stage.key);
    if (!liveStage) continue;
    let taskCursor = dayjs(liveStage.plannedStart);
    const orderedTasks = [...(stage.tasks || [])].sort((a, b) => a.order - b.order);
    for (const [taskIdx, task] of orderedTasks.entries()) {
      const plannedStart = taskCursor.toDate();
      const plannedEnd = taskCursor.add(task.estimatedDays || 1, 'day').toDate();
      taskCursor = dayjs(plannedEnd);

      taskDocs.push({
        project: project._id,
        code: `${project.code}-T${String(taskDocs.length + 1).padStart(3, '0')}`,
        templateTaskKey: task.key,
        stageKey: stage.key,
        stageName: stage.name,
        title: task.title,
        description: task.description,
        priority: task.priority,
        department: task.department || stage.ownerDepartment,
        taskCategory: task.taskCategory,
        assignees: task.assignees || [],
        primaryAssignee: task.primaryAssignee || null,
        backupAssignee: task.backupAssignee || null,
        reassignNeeded: task.primaryAssigneeUnavailable === true && !!task.primaryAssignee,
        estimatedHours: (task.estimatedDays || 1) * 8,
        plannedStart,
        plannedEnd,
        order: task.order ?? taskIdx,
        checklist: (task.checklist || []).map((c) => ({ label: c.label, required: c.required })),
        createdBy,
      });
    }
  }

  if (taskDocs.length) await Task.insertMany(taskDocs);
}

/** Move a project's tasks into a realistic state based on how far it has progressed. */
async function simulateProgress(project, laggingDays) {
  const cutoff = dayjs().subtract(laggingDays, 'day');
  const tasks = await Task.find({ project: project._id }).sort({ plannedEnd: 1 });
  const usersByDept = project._usersByDept;

  for (const task of tasks) {
    // Assign someone from the matching department (fallback: any executor).
    const pool = usersByDept[task.department] || usersByDept._any;
    task.assignee = pick(pool)._id;

    const plannedEnd = dayjs(task.plannedEnd);
    const plannedStart = dayjs(task.plannedStart);

    if (plannedEnd.isBefore(cutoff)) {
      task.status = TASK_STATUS.DONE;
      task.actualStart = plannedStart.add(rand(-1, 1), 'day').toDate();
      let actualEnd = plannedEnd.add(rand(-2, 3), 'day');
      if (actualEnd.isBefore(dayjs(task.actualStart))) actualEnd = dayjs(task.actualStart).add(1, 'day');
      task.actualEnd = actualEnd.toDate();
      task.actualHours = Math.round(task.estimatedHours * (0.8 + Math.random() * 0.6));
      task.checklist.forEach((c) => (c.done = true));
    } else if (plannedStart.isBefore(cutoff)) {
      task.status = Math.random() > 0.4 ? TASK_STATUS.IN_PROGRESS : TASK_STATUS.TODO;
      if (task.status === TASK_STATUS.IN_PROGRESS) task.actualStart = plannedStart.toDate();
    } else {
      task.status = TASK_STATUS.TODO;
    }
    await task.save();
  }
  await projectService.recompute(project._id);
}

async function seed() {
  await connectDatabase();
  await clearAll();

  // 1. Users
  const users = [];
  for (const u of USERS) {
    users.push(await User.create({ ...u, password: DEFAULT_PASSWORD }));
  }
  const admin = users[0];
  const managers = users.filter((u) => u.role === ROLES.MANAGER);
  const usersByDept = { _any: users.filter((u) => u.role === ROLES.EMPLOYEE) };
  for (const dept of Object.values(DEPARTMENTS)) {
    const pool = users.filter((u) => u.department === dept);
    usersByDept[dept] = pool.length ? pool : usersByDept._any;
  }
  console.log(`👥 Created ${users.length} users (login: ${admin.email} / ${DEFAULT_PASSWORD})`);

  // 2. Templates — the official 10-phase workflow is the default; projects use it.
  const template = await Template.create({ ...storeLaunchTemplate, createdBy: admin._id });
  const altTemplate = await Template.create({ ...franchiseLaunchTemplate, createdBy: admin._id });
  for (const tpl of [template, altTemplate]) {
    console.log(
      `📋 Template "${tpl.name}" — ${tpl.totalStages} phases, ${tpl.totalTasks} tasks, ` +
        `${tpl.totalChecklistItems} checklist items${tpl.isDefault ? '  ⭐ default' : ''}`,
    );
  }

  // 3. Projects + progress simulation
  for (const p of PROJECTS) {
    const project = await projectService.create(
      {
        name: p.name,
        templateId: template._id,
        city: p.city,
        address: `${p.city} prime retail location`,
        areaSqft: p.area,
        owner: pick(managers)._id,
        members: [pick(users)._id, pick(users)._id],
        plannedStartDate: dayjs().add(p.startOffset, 'day').toDate(),
        budget: { planned: p.budget, actual: Math.round(p.budget * (0.2 + Math.random() * 0.5)) },
        broker: { name: 'Realty Connect', phone: '98xxxxxx01', commissionPct: 2 },
        tags: ['franchise', p.city.toLowerCase()],
      },
      admin._id,
    );
    // Seed demo tasks from the template's blueprint (production no longer
    // does this automatically — see seedTasksForTemplateStages' doc comment),
    // then attach the dept pools for the simulator and progress the tasks.
    await seedTasksForTemplateStages(project, template, admin._id);
    const doc = await Project.findById(project._id);
    doc._usersByDept = usersByDept;
    await simulateProgress(doc, p.lagging);
    const fresh = await Project.findById(project._id).select('code progress health status');
    console.log(`🏗️  ${fresh.code.padEnd(11)} ${p.city.padEnd(14)} ${String(fresh.progress).padStart(3)}%  ${fresh.status}/${fresh.health}`);
  }

  const counts = {
    users: await User.countDocuments(),
    templates: await Template.countDocuments(),
    projects: await Project.countDocuments(),
    tasks: await Task.countDocuments(),
  };
  console.log('\n✅ Seed complete:', counts);
}

async function main() {
  try {
    if (process.argv.includes('--destroy')) {
      await connectDatabase();
      await clearAll();
    } else {
      await seed();
    }
  } catch (err) {
    console.error('✖ Seed failed:', err);
    process.exitCode = 1;
  } finally {
    await disconnectDatabase();
    await mongoose.connection.close().catch(() => {});
    process.exit(process.exitCode || 0);
  }
}

main();
