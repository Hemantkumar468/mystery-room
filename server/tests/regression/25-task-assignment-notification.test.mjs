/**
 * REGRESSION SUITE — giving somebody a task tells them.
 *
 * THE GAP THIS EXISTS FOR. Assigning a task wrote an activity-log line and
 * nothing else. The activity feed is a project AUDIT LOG — you read it when
 * you are already looking at the project, which is exactly not the position
 * of someone who does not yet know they have been given work. A task could be
 * allocated on Monday and sit untouched until Friday, with no error, nothing
 * missing from any report, and nobody at fault. The whole system assumes
 * people know what is on their plate.
 *
 * The failure modes on the other side are just as real, so they are pinned
 * too: a bell that re-announces the same task on every save, or fires fifty
 * rows when a project is created, is a bell people mute — and a muted bell is
 * worse than none, because everyone believes it is working.
 *
 * Every assertion counts Notification rows in the database. Nothing here
 * trusts a return value.
 */
import 'dotenv/config';
import { connect, disconnect } from '../helpers/db.js';
import { ok, no, finish } from '../helpers/assert.js';

const conn = await connect();
console.log(`Connected: ${conn.name}\n`);

const B = '../../src/modules/pms';
const { taskService } = await import(`${B}/tasks/task.service.js`);
const { Project } = await import(`${B}/projects/project.model.js`);
const { Task } = await import(`${B}/tasks/task.model.js`);
const { Template } = await import(`${B}/templates/template.model.js`);
const { Notification } = await import(`${B}/notifications/notification.model.js`);
const { User } = await import('../../src/modules/auth/auth.model.js');

const is = (name, actual, expected) => (
  actual === expected ? ok(name) : no(name, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`)
);
const truthy = (name, v, detail = '') => (v ? ok(name) : no(name, detail || `got ${JSON.stringify(v)}`));

const tag = `ZZNOTIF-${Date.now()}`;
const bin = { tasks: [], projects: [], users: [], templates: [] };

const admin = await User.findOne({ role: 'md' }).select('_id name');
const actor = { id: String(admin._id), role: 'md' };

/** Two throwaway people to hand work to. */
const mkUser = async (n) => {
  const u = await User.create({
    name: `${tag} ${n}`, email: `${tag.toLowerCase()}-${n}@example.test`,
    password: 'placeholder-not-a-credential', role: 'employee', department: 'construction',
  });
  bin.users.push(u._id);
  return u;
};
const alice = await mkUser('alice');
const bob = await mkUser('bob');

const tpl = await Template.create({
  name: `${tag}_TPL`, code: `${tag}-T`, status: 'published', version: 1,
  stages: [
    { key: 'p5', name: 'Department Planning', order: 5, captureMode: 'single' },
    { key: 'p6', name: 'Execution', order: 6, captureMode: 'single' },
  ],
});
bin.templates.push(tpl._id);

const project = await Project.create({
  name: `${tag}_PROJ`, code: `${tag}-P`, city: 'Probe',
  plannedStartDate: new Date('2020-01-01'),
  template: { ref: tpl._id, name: tpl.name, version: 1 },
  stages: [
    { key: 'p4', name: 'Project Creation', captureMode: 'collection', status: 'completed' },
    { key: 'p5', name: 'Department Planning', captureMode: 'single', status: 'completed' },
    { key: 'p6', name: 'Execution', captureMode: 'single' },
  ],
});
bin.projects.push(project._id);

let seq = 0;
const mkTask = async (over = {}) => {
  seq += 1;
  const t = await Task.create({
    project: project._id, stageKey: 'p6', stageName: 'Execution',
    code: `${tag}-T${seq}`, title: `${tag} task ${seq}`,
    department: 'construction', plannedEnd: new Date('2027-01-01'),
    ...over,
  });
  bin.tasks.push(t._id);
  return t;
};

/** Notifications of our new type, for one person, on this project. */
const notifsFor = (userId) => Notification.find({
  recipient: userId, project: project._id, type: 'task_assigned',
}).sort({ createdAt: 1 }).lean();

try {
  console.log('── Handing someone a task tells them ──');
  {
    const t = await mkTask({ assignee: admin._id, assigneeRefs: [admin._id] });
    await taskService.update(t._id, { assignee: alice._id, assigneeRefs: [alice._id] }, actor);
    const got = await notifsFor(alice._id);
    is('the new doer is notified exactly once', got.length, 1);
    is('under the task_assigned type', got[0]?.type, 'task_assigned');
    truthy('the message names the task', String(got[0]?.message || '').includes(`${tag} task`));
    // The same link format the approvals list and the Gantt use, so it is
    // wrong or right everywhere at once rather than only here.
    is('the link points at the task', got[0]?.link, `/projects/${project._id}/tasks/${encodeURIComponent(t.code)}`);
  }

  console.log('\n── and does NOT keep telling them ──');
  {
    const t = await mkTask({ assignee: bob._id, assigneeRefs: [bob._id] });
    // A save that changes something else entirely. Re-announcing the task
    // here is how a bell becomes noise.
    await taskService.update(t._id, { priority: 'high' }, actor);
    await taskService.update(t._id, { plannedEnd: new Date('2027-02-01') }, actor);
    const got = await notifsFor(bob._id);
    is('an unrelated save notifies nobody', got.length, 0);
  }

  console.log('\n── adding a second doer tells only the second ──');
  {
    const t = await mkTask({ assignee: alice._id, assigneeRefs: [alice._id] });
    const aliceBefore = (await notifsFor(alice._id)).length;
    const bobBefore = (await notifsFor(bob._id)).length;

    await taskService.update(t._id, { assigneeRefs: [alice._id, bob._id] }, actor);

    is('the person already on it is not told again', (await notifsFor(alice._id)).length, aliceBefore);
    is('the person just added is told', (await notifsFor(bob._id)).length, bobBefore + 1);
  }

  console.log('\n── assigning to yourself is not news ──');
  {
    const t = await mkTask({ assignee: alice._id, assigneeRefs: [alice._id] });
    const before = (await notifsFor(admin._id)).length;
    await taskService.update(t._id, { assignee: admin._id, assigneeRefs: [admin._id] }, actor);
    is('the actor does not notify themselves', (await notifsFor(admin._id)).length, before);
  }

  console.log('\n── a task created with a doer tells them ──');
  {
    const before = (await notifsFor(bob._id)).length;
    const created = await taskService.create({
      project: project._id, stageKey: 'p6', title: `${tag} freshly created`,
      department: 'construction', assignee: bob._id, assigneeRefs: [bob._id],
      plannedEnd: new Date('2027-03-01'),
    }, actor.id);
    bin.tasks.push(created._id);
    is('creating with a doer notifies them', (await notifsFor(bob._id)).length, before + 1);
  }

  console.log('\n── reassigning takes it OFF the previous doer ──');
  {
    /* THE OTHER HALF of this bug, found while testing the first. My Tasks
       queries `$or: [{assignee}, {assigneeRefs}]`, and update()'s editable
       list did not contain assigneeRefs — so reassigning through `assignee`
       left the old doer in assigneeRefs and the task never left their list.
       Two people believed it was theirs and nothing said otherwise. */
    const t = await mkTask({ assignee: alice._id, assigneeRefs: [alice._id] });
    await taskService.update(t._id, { assignee: bob._id }, actor);
    const after = await Task.findById(t._id).select('assignee assigneeRefs').lean();

    is('the new doer holds it', String(after.assignee), String(bob._id));
    is('and is the only one in assigneeRefs', (after.assigneeRefs || []).map(String).join(','), String(bob._id));
    truthy('the previous doer is gone from assigneeRefs',
      !(after.assigneeRefs || []).some((r) => String(r) === String(alice._id)),
      'alice is still on the task — it will never leave her My Tasks');
  }

  console.log('\n── an explicit doer list is honoured, and assignee follows it ──');
  {
    const t = await mkTask({ assignee: alice._id, assigneeRefs: [alice._id] });
    await taskService.update(t._id, { assigneeRefs: [bob._id, alice._id] }, actor);
    const after = await Task.findById(t._id).select('assignee assigneeRefs').lean();
    is('both doers are kept', (after.assigneeRefs || []).length, 2);
    is('assignee is the first of them', String(after.assignee), String(bob._id));
  }

  console.log('\n── the type is actually allowed by the model ──');
  {
    /* The enum is the thing that would silently break this: notify() catches
       its own errors and logs a warning, so a missing enum value produces a
       notification that is never written and never complained about. */
    const enumValues = Notification.schema.path('type').enumValues;
    truthy('"task_assigned" is in the Notification type enum',
      enumValues.includes('task_assigned'), `enum: ${enumValues.join(', ')}`);
  }
} finally {
  await Notification.deleteMany({ project: project._id });
  await Task.deleteMany({ _id: { $in: bin.tasks } });
  await Project.deleteMany({ _id: { $in: bin.projects } });
  await Template.deleteMany({ _id: { $in: bin.templates } });
  await User.deleteMany({ _id: { $in: bin.users } });
  await disconnect();
}

process.exit(finish('TASK ASSIGNMENT NOTIFICATION'));
