/* eslint-disable no-console */
/**
 * Demo data for the Delegation & Checklist modules.
 *
 *   npm run seed:ops            add demo data (only where the ops collections are empty)
 *   npm run seed:ops:reset      clear ONLY the ops collections (org_*, dlg_*, chk_*) first
 *   --link-users                also set demo branches / reporting managers / ops flags
 *                               on the seeded demo users (off by default — existing
 *                               user documents are otherwise never modified)
 *
 * It never touches users, PMS templates, projects, tasks or PMS activity.
 */
import mongoose from 'mongoose';
import dayjs from 'dayjs';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { User } from '../modules/auth/auth.model.js';
import { Branch } from '../modules/org/branches/branch.model.js';
import { Team } from '../modules/org/teams/team.model.js';
import { WorkGroup } from '../modules/org/groups/group.model.js';
import { TaskCategory, TaskTag } from '../modules/org/catalog/catalog.model.js';
import { Holiday } from '../modules/org/holidays/holiday.model.js';
import { Delegation } from '../modules/delegation/delegation.model.js';
import { DelegationTemplate } from '../modules/delegation/template.model.js';
import { ChecklistMaster, ChecklistTask, ChecklistSite } from '../modules/checklist/checklist.model.js';
import { delegationService } from '../modules/delegation/delegation.service.js';
import { lifecycle } from '../modules/delegation/delegation.lifecycle.js';
import { checklistService } from '../modules/checklist/checklist.service.js';
import { dateKey, endOfDay } from '../core/utils/opsTime.js';
import '../modules/delegation/delegation.hooks.js';
import '../modules/checklist/checklist.hooks.js';

const OPS_COLLECTIONS = [
  'org_branches', 'org_teams', 'org_groups', 'org_categories', 'org_tags', 'org_holidays',
  'org_notifications', 'org_activity_log', 'org_counters',
  'dlg_delegations', 'dlg_remarks', 'dlg_revisions', 'dlg_reminders', 'dlg_followups', 'dlg_recurrences', 'dlg_templates',
  'chk_masters', 'chk_tasks', 'chk_sites',
];

const args = new Set(process.argv.slice(2));
const day = (offset) => dayjs().add(offset, 'day').format('YYYY-MM-DD');
const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;

async function reset() {
  const existing = new Set((await mongoose.connection.db.listCollections().toArray()).map((c) => c.name));
  for (const name of OPS_COLLECTIONS) {
    if (existing.has(name)) await mongoose.connection.db.collection(name).deleteMany({});
  }
  console.log('🧹 Cleared the ops collections (users and PMS data untouched)');
}

async function seed() {
  const byEmail = async (email) => User.findOne({ email });
  const admin = (await byEmail('admin@mysteryrooms.in')) || (await User.findOne({ role: 'admin' }));
  if (!admin) {
    console.log('No admin user found — run `npm run seed` (or create an admin) first.');
    return;
  }

  // ── Branches ────────────────────────────────────────────
  if (!(await Branch.countDocuments())) {
    await Branch.insertMany([
      { name: 'Head Office', code: 'HQ', type: 'headquarters', city: 'Delhi', isDefault: true, createdBy: admin._id },
      { name: 'Pune Outlet', code: 'PUN-01', type: 'outlet', city: 'Pune', createdBy: admin._id },
      { name: 'Jaipur Outlet', code: 'JAI-01', type: 'outlet', city: 'Jaipur', createdBy: admin._id },
    ]);
    console.log('🏢 Branches: Head Office (default), Pune Outlet, Jaipur Outlet');
  }
  const hq = await Branch.findOne({ code: 'HQ' });
  const pune = await Branch.findOne({ code: 'PUN-01' });

  // ── Catalog & holidays ─────────────────────────────────
  if (!(await TaskCategory.countDocuments())) {
    await TaskCategory.insertMany(
      [
        ['Maintenance', '#F59E0B'], ['Game Upkeep', '#6E45FF'], ['Vendor & Purchase', '#14B8A6'],
        ['Compliance', '#F43F5E'], ['Marketing', '#EC4899'], ['Finance', '#10B981'],
        ['HR & Staffing', '#38BDF8'], ['Guest Experience', '#8B5CF6'],
      ].map(([name, color]) => ({ name, color, createdBy: admin._id })),
    );
    await TaskTag.insertMany(
      [['urgent-fix', '#F43F5E'], ['weekend', '#F59E0B'], ['audit', '#6366F1'], ['safety', '#EF4444'], ['franchise', '#14B8A6']]
        .map(([name, color]) => ({ name, color, createdBy: admin._id })),
    );
    console.log('🏷️  Categories and tags');
  }
  if (!(await Holiday.countDocuments())) {
    const y = dayjs().year();
    await Holiday.insertMany([
      { name: 'Republic Day', date: `${y}-01-26`, createdBy: admin._id },
      { name: 'Independence Day', date: `${y}-08-15`, createdBy: admin._id },
      { name: 'Gandhi Jayanti', date: `${y}-10-02`, createdBy: admin._id },
    ]);
    console.log('📅 Fixed national holidays for', y);
  }

  // Demo people from the main seed (skipped gracefully if absent).
  const people = Object.fromEntries(
    await Promise.all(['priya', 'arjun', 'neha', 'vikram', 'sana', 'karan', 'divya', 'rohit', 'ananya'].map(async (n) => [n, await byEmail(`${n}@mysteryrooms.in`)])),
  );
  const have = Object.values(people).every(Boolean);

  if (have && args.has('--link-users')) {
    const reports = { vikram: 'priya', sana: 'priya', karan: 'arjun', divya: 'arjun', rohit: 'arjun', ananya: 'neha' };
    for (const [who, mgr] of Object.entries(reports)) {
      await User.updateOne({ _id: people[who]._id }, { reportingManager: people[mgr]._id });
    }
    await User.updateMany({ _id: { $in: [people.karan._id, people.rohit._id] } }, { branch: pune._id });
    await User.updateOne({ _id: admin._id }, { 'opsFlags.director': true });
    await User.updateOne({ _id: people.neha._id }, { 'opsFlags.coordinator': true });
    console.log('🔗 Linked demo users: reporting lines, Pune branch for Karan & Rohit, director + coordinator flags');
  }

  if (!have) {
    console.log('ℹ️  Demo users not found — skipping teams, groups, tasks and routines.');
    return;
  }
  const P = people;

  // ── Teams & groups ─────────────────────────────────────
  if (!(await Team.countDocuments())) {
    const t = (user, role = 'member') => ({ user: user._id, role, addedBy: admin._id });
    await Team.insertMany([
      { name: 'Expansion Desk', color: '#F5A623', branch: hq._id, members: [t(P.priya, 'manager'), t(P.vikram), t(P.sana)], createdBy: admin._id },
      { name: 'Launch Crew', color: '#14B8A6', branch: pune._id, members: [t(P.arjun, 'manager'), t(P.karan), t(P.rohit), t(P.divya)], createdBy: admin._id },
      { name: 'People & Finance', color: '#F43F5E', branch: hq._id, members: [t(P.neha, 'manager'), t(P.ananya)], createdBy: admin._id },
    ]);
    console.log('👥 Teams: Expansion Desk, Launch Crew, People & Finance');
  }
  let warRoom = await WorkGroup.findOne({ name: 'Pune Launch War-room' });
  if (!warRoom) {
    warRoom = await WorkGroup.create({
      name: 'Pune Launch War-room',
      description: 'Everyone pushing the Koregaon Park outlet to go-live',
      color: '#6E45FF',
      branch: pune._id,
      members: [admin._id, P.arjun._id, P.karan._id, P.rohit._id, P.divya._id],
      createdBy: admin._id,
    });
    console.log('🧩 Group: Pune Launch War-room');
  }

  if (!(await DelegationTemplate.countDocuments())) {
    await DelegationTemplate.insertMany([
      {
        title: 'Room reset audit', category: 'Game Upkeep', priority: 'high', evidenceRequired: true,
        description: 'Walk every room after the last slot: props reset, locks re-coded, clues restocked.',
        checklistItems: [{ text: 'All padlocks reset to the room code' }, { text: 'Clue cards restocked' }, { text: 'Photos of every room uploaded' }],
        createdBy: admin._id,
      },
      {
        title: 'Vendor quotation comparison', category: 'Vendor & Purchase', priority: 'medium',
        description: 'Collect at least three quotations and share a comparison sheet.',
        checklistItems: [{ text: 'Three quotations collected' }, { text: 'Comparison sheet shared' }],
        createdBy: admin._id,
      },
    ]);
  }

  // ── Delegations ────────────────────────────────────────
  if (!(await Delegation.countDocuments())) {
    const mk = (assigner, body) => delegationService.create({ reminders: [], ...body }, assigner);
    const [t1] = await mk(admin, {
      title: 'Finalise lease for Koregaon Park site', description: 'Close the lease with the landlord and share the signed copy with Legal.',
      doers: [String(P.priya._id)], inLoop: [String(P.sana._id)], category: 'Compliance', priority: 'critical',
      dueDate: day(3), branch: String(pune._id), group: String(warRoom._id), verificationRequired: true, tags: ['franchise'],
    });
    await mk(P.priya, {
      title: 'Collect site-visit photos for shortlisted locations', description: 'Frontage, parking and interiors — at least 10 photos per site.',
      doers: [String(P.vikram._id)], category: 'Vendor & Purchase', priority: 'high', dueDate: day(-4), branch: String(hq._id),
      checklistItems: [{ text: 'Site A photos' }, { text: 'Site B photos' }, { text: 'Site C photos' }],
    });
    const [t3] = await mk(P.arjun, {
      title: 'Install maglock controllers in Room 2', description: 'Coordinate with the electrician; test every lock with the game master.',
      doers: [String(P.karan._id)], inLoop: [String(P.rohit._id)], category: 'Maintenance', priority: 'high',
      dueDate: day(1), branch: String(pune._id), group: String(warRoom._id), evidenceRequired: true, tags: ['safety'],
    });
    await mk(P.arjun, {
      title: 'Launch-week social media calendar', description: 'Two posts a day for launch week, with reels from the soft-launch.',
      doers: [String(P.divya._id)], category: 'Marketing', priority: 'medium', dueDate: day(6), branch: String(pune._id), group: String(warRoom._id),
    });
    await mk(P.neha, {
      title: 'Hire two game masters for Pune', description: 'Screen, trial-run and onboard two game masters before soft launch.',
      doers: [String(P.neha._id)], inLoop: [String(P.arjun._id)], category: 'HR & Staffing', priority: 'high', dueDate: day(8), branch: String(pune._id),
    });
    await mk(admin, {
      title: 'Weekly cash reconciliation', description: 'Reconcile POS vs. bank deposits for every outlet.',
      doers: [String(P.ananya._id)], category: 'Finance', priority: 'medium', dueDate: day(0), branch: String(hq._id),
      repeat: { frequency: 'weekly', startDate: day(0), weeklyDays: [1] },
    });

    // Move a couple along the lifecycle so every screen has something to show.
    await lifecycle.setStatus(t3._id, { status: 'in_progress', remark: 'Electrician booked for tomorrow morning' }, P.karan);
    await lifecycle.setStatus(t1._id, { status: 'accepted' }, P.priya);
    console.log('📌 Delegations created (incl. a weekly repeat rule)');
  }

  // ── Checklist routines ─────────────────────────────────
  if (!(await ChecklistMaster.countDocuments())) {
    for (const site of ['Room 1 — The Heist', 'Room 2 — Asylum', 'Reception & Lobby']) {
      await ChecklistSite.create({ name: site, branch: pune._id, createdBy: admin._id });
    }
    const start = day(-35);
    const routines = [
      { taskName: 'Opening check — lights, locks, AC, music', doer: P.rohit, frequency: 'daily', site: 'Reception & Lobby', department: 'operations' },
      { taskName: 'Room reset & prop inventory', doer: P.karan, frequency: 'weekly', site: 'Room 1 — The Heist', department: 'projects', proofRequired: true },
      { taskName: 'Fire extinguisher & emergency exit check', doer: P.karan, frequency: 'monthly', site: 'Room 2 — Asylum', department: 'projects', proofRequired: true },
      { taskName: 'CCTV & electrical safety audit', doer: P.rohit, frequency: 'quarterly', department: 'operations' },
    ];
    for (const r of routines) {
      await checklistService.createMaster(
        { ...r, doer: String(r.doer._id), startDate: start, branch: String(pune._id), weeklyOffs: [] },
        P.arjun,
      );
    }
    // Close most past occurrences so compliance and the scoreboard have history.
    const past = await ChecklistTask.find({ plannedKey: { $lt: dateKey() }, actualDate: null });
    for (const t of past) {
      const roll = Math.random();
      if (roll < 0.72) {
        t.actualDate = dayjs(endOfDay(t.plannedKey)).subtract(rand(2, 10), 'hour').toDate();
        t.status = 'completed';
      } else if (roll < 0.8) {
        t.actualDate = dayjs(endOfDay(t.plannedKey)).add(rand(1, 2), 'day').toDate();
        t.status = 'completed';
      } else if (roll < 0.84) {
        t.actualDate = endOfDay(t.plannedKey);
        t.status = 'non_functional';
        t.isNonFunctional = true;
        t.coordinatorRemark = 'Room closed for maintenance';
      }
      await t.save();
    }
    console.log('✅ Checklist routines with ~5 weeks of history');
  }
}

async function main() {
  try {
    await connectDatabase();
    if (args.has('--reset')) await reset();
    await seed();
    console.log('\nDone.');
  } catch (err) {
    console.error('✖ Ops seed failed:', err);
    process.exitCode = 1;
  } finally {
    await disconnectDatabase().catch(() => {});
    process.exit(process.exitCode || 0);
  }
}

main();
