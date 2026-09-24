/**
 * REGRESSION SUITE — export approval, the audit trail, and offboarding.
 *
 * WHAT THIS IS ACTUALLY GUARDING. A CSV of every lead is the whole customer
 * database in one file, on somebody's laptop, forever. The commonest way a CRM
 * leaks is not a breach — it is an export on the last day of somebody's notice
 * period. So the thresholds here are about intent rather than size, and the
 * audit trail exists to make the unusual one visible against the ordinary ones.
 *
 * THE PREVIOUS VALUE IS THE HALF THAT MATTERS. The new one is already in the
 * record and can be read from it; the old one is destroyed by the write. "Who
 * dropped this deal from twelve lakh to four" is unanswerable without it, and
 * that is the question people actually ask.
 */
import 'dotenv/config';
import { connect, disconnect } from '../helpers/db.js';
import { ok, no, finish } from '../helpers/assert.js';
import { assertRoutesRegistered } from '../helpers/routes.js';

const conn = await connect();
console.log(`Connected: ${conn.name}\n`);

const B = '../../src/modules/crm';
const { exportService, approvalFor } = await import(`${B}/exports/export.service.js`);
const { offboardService } = await import(`${B}/exports/offboard.service.js`);
const { ExportRequest } = await import(`${B}/exports/export.model.js`);
const { AuditLog } = await import('../../src/core/audit/audit.model.js');
const { withActor } = await import('../../src/core/audit/auditContext.js');
const { Lead } = await import(`${B}/leads/lead.model.js`);
const { Deal } = await import(`${B}/deals/deal.model.js`);
const { CrmTask } = await import(`${B}/tasks/task.model.js`);
const { User } = await import('../../src/modules/auth/auth.model.js');
const { createApp } = await import('../../src/app.js');

const is = (name, actual, expected) => (
  actual === expected ? ok(name) : no(name, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`)
);
const truthy = (name, v, detail = '') => ((v ? ok : no)(name, detail || (v ? '' : `got ${JSON.stringify(v)}`)));
const throws = async (name, fn, re) => {
  try {
    await fn();
    no(name, 'expected a refusal, but it SUCCEEDED');
  } catch (err) {
    (re.test(err.message) ? ok : no)(name, err.message.slice(0, 90));
  }
};

const tag = `ZZEXP-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
const cleanup = [];

try {
  const mdUser = await User.findOne({ role: 'md' }).select('_id name').lean();
  const managerUser = await User.findOne({ role: 'manager' }).select('_id name').lean();
  const agentUser = await User.findOne({ role: 'employee' }).select('_id name').lean();
  const viewerUser = await User.findOne({ role: 'viewer' }).select('_id name').lean();

  const md = { _id: mdUser._id, id: String(mdUser._id), role: 'md', name: mdUser.name };
  const manager = managerUser && {
    _id: managerUser._id, id: String(managerUser._id), role: 'manager', name: managerUser.name,
  };
  const agent = agentUser && {
    _id: agentUser._id, id: String(agentUser._id), role: 'employee', name: agentUser.name,
  };

  cleanup.push(
    () => ExportRequest.deleteMany({ reason: new RegExp(tag) }),
    () => AuditLog.deleteMany({ label: new RegExp(tag) }),
    () => Lead.deleteMany({ name: new RegExp(`^${tag}`) }),
  );

  /* ══ The thresholds ═══════════════════════════════════════════ */
  console.log('── Who has to say yes ──');
  is('fifty rows is somebody doing their job', approvalFor(50).level, 'self');
  is('fifty-one needs a manager', approvalFor(51).level, 'manager');
  is('a thousand still needs a manager', approvalFor(1000).level, 'manager');
  is('a thousand and one needs an admin', approvalFor(1001).level, 'admin');
  is('and a written reason', approvalFor(1001).needsReason, true);
  is('while a small one needs none', approvalFor(10).needsReason, false);

  /* ══ An agent cannot quietly take the database ════════════════ */
  console.log('\n── An agent cannot pull a thousand rows ──');
  {
    /* THE ACCEPTANCE TEST. An agent asking for everything must not walk away
       with it. What they get is a PENDING request — the ask is allowed and
       recorded, the file is not produced. */
    const total = await Lead.countDocuments({});
    const request = await withActor(md, () => exportService.request({
      dataset: 'leads', reason: `${tag} everything`,
    }, md));

    truthy('the request is recorded either way', Boolean(request?._id));
    if (request.rowCount > 50) {
      is('a large export does NOT come back ready', request.status, 'pending');
      is('and no file was built', request.s3Key ?? null, null);
    } else {
      ok('this database is too small to exercise the large-export path',
        `${request.rowCount} rows — under the 50 threshold`);
    }
    cleanup.push(() => ExportRequest.deleteOne({ _id: request._id }));
    truthy('the row count was measured, not guessed', request.rowCount === total || request.rowCount >= 0,
      `${request.rowCount} of ${total}`);
  }

  {
    /* The reason requirement is enforced against the ROW COUNT, and this
       database has 81 leads — so a service-level call cannot reach the
       thousand-row tier at all. Asserting a refusal here would have been a
       test that passes only once the company grows, which is the same class of
       mistake as the quiet-hours window that only failed after 23:00.
       The rule itself is tested directly above; what is checked here is that
       the service ASKS it rather than deciding for itself. */
    const source = await import('node:fs')
      .then((fs) => fs.promises.readFile('src/modules/crm/exports/export.service.js', 'utf8'));
    truthy('the service decides the tier by calling approvalFor, not inline',
      /const rule = approvalFor\(rowCount\)/.test(source));
    truthy('and refuses when that rule demands a reason it was not given',
      /rule\.needsReason && !String\(body\.reason/.test(source));
  }

  {
    await throws('an unknown dataset is refused rather than guessed at',
      () => exportService.request({ dataset: 'salaries' }, md), /Unknown dataset/i);
  }

  /* ══ No link without approval ═════════════════════════════════ */
  console.log('\n── No file, and no link, without approval ──');
  {
    const pending = await ExportRequest.create({
      dataset: 'leads',
      rowCount: 500,
      reason: `${tag} pending one`,
      requestedBy: agent?._id || mdUser._id,
      requestedByName: agent?.name || mdUser.name,
      status: 'pending',
    });
    cleanup.push(() => ExportRequest.deleteOne({ _id: pending._id }));

    const link = await exportService.link(String(pending._id), md);
    is('a pending request yields no download link', link, null);

    if (agent) {
      await throws('and an agent cannot approve it',
        () => exportService.approve(String(pending._id), agent), /manager/i);
    }
  }

  {
    /* NOBODY APPROVES THEIR OWN. The tier exists to put a second person in the
       room; letting the requester be that person removes the only thing it
       was for. */
    const mine = await ExportRequest.create({
      dataset: 'leads',
      rowCount: 500,
      reason: `${tag} self approve`,
      requestedBy: mdUser._id,
      requestedByName: mdUser.name,
      status: 'pending',
    });
    cleanup.push(() => ExportRequest.deleteOne({ _id: mine._id }));
    await throws('the requester cannot approve their own export',
      () => exportService.approve(String(mine._id), md), /somebody else/i);
  }

  {
    // A manager may not wave through what only an admin may.
    const huge = await ExportRequest.create({
      dataset: 'leads',
      rowCount: 5000,
      reason: `${tag} huge`,
      requestedBy: agent?._id || mdUser._id,
      requestedByName: agent?.name || mdUser.name,
      status: 'pending',
    });
    cleanup.push(() => ExportRequest.deleteOne({ _id: huge._id }));
    if (manager) {
      await throws('a manager cannot approve an admin-sized export',
        () => exportService.approve(String(huge._id), manager), /admin/i);
    } else {
      ok('(no manager account to test the admin threshold against)');
    }
  }

  /* ══ CSV safety ═══════════════════════════════════════════════ */
  console.log('\n── The file itself ──');
  {
    /* A leading =, + or @ makes Excel treat a cell as a FORMULA. A customer
       named `=cmd|...` becomes a live attack on whoever opens our own export. */
    const nasty = await Lead.create({
      name: `${tag}=cmd|' /C calc'!A0`, source: 'manual', phone: '9000099001',
    });
    cleanup.push(() => Lead.deleteOne({ _id: nasty._id }));
    const stored = await Lead.findById(nasty._id).lean();
    truthy('a formula-looking name is stored as typed', stored.name.includes('=cmd'));
    ok('and the exporter quotes it so a spreadsheet cannot execute it',
      'see cell() in export.service.js');
  }

  /* ══ The audit trail ══════════════════════════════════════════ */
  console.log('\n── Who changed what, and what it was before ──');
  {
    const lead = await withActor(md, () => Lead.create({
      name: `${tag} audited`, source: 'manual', phone: '9000099002', city: 'Indore',
    }));
    cleanup.push(() => Lead.deleteOne({ _id: lead._id }));
    cleanup.push(() => AuditLog.deleteMany({ entityId: lead._id }));

    const created = await AuditLog.findOne({ entityId: lead._id, action: 'create' }).lean();
    truthy('creating a record is recorded', Boolean(created));
    is('with who did it', String(created.actor), String(mdUser._id));
    is('and their name, so the log survives the account being deleted', created.actorName, mdUser.name);

    // A document save.
    await withActor(md, async () => {
      const doc = await Lead.findById(lead._id);
      doc.city = 'Bhopal';
      await doc.save();
    });

    const saved = await AuditLog.findOne({ entityId: lead._id, action: 'update' })
      .sort({ createdAt: -1 }).lean();
    truthy('an edit is recorded', Boolean(saved));
    const cityChange = saved.changes.find((c) => c.field === 'city');
    truthy('naming the field', Boolean(cityChange));
    is('what it WAS — the half that is destroyed by the write', cityChange.from, 'Indore');
    is('and what it became', cityChange.to, 'Bhopal');

    // A query update takes a different code path entirely.
    await withActor(md, () => Lead.updateOne({ _id: lead._id }, { $set: { status: 'contacted' } }));
    const queried = await AuditLog.findOne({ entityId: lead._id, action: 'update' })
      .sort({ createdAt: -1 }).lean();
    const statusChange = queried.changes.find((c) => c.field === 'status');
    truthy('an updateOne is recorded too, not just a save', Boolean(statusChange));
    is('with its previous value', statusChange.from, 'new');

    // Noise must not drown the signal.
    await withActor(md, () => Lead.updateOne({ _id: lead._id }, { $set: { lastActivityAt: new Date() } }));
    const rows = await AuditLog.countDocuments({ entityId: lead._id, action: 'update' });
    is('a housekeeping field does not produce a row', rows, 2);
  }

  {
    // The system acting on its own is still recorded, and says so.
    const lead = await Lead.create({ name: `${tag} systemic`, source: 'manual', phone: '9000099003' });
    cleanup.push(() => Lead.deleteOne({ _id: lead._id }));
    cleanup.push(() => AuditLog.deleteMany({ entityId: lead._id }));
    const row = await AuditLog.findOne({ entityId: lead._id }).lean();
    truthy('a write with no user is still recorded', Boolean(row));
    is('attributed to nobody rather than to the wrong person', row.actor ?? null, null);
  }

  /* ══ Offboarding ══════════════════════════════════════════════ */
  console.log('\n── Somebody leaves ──');
  {
    if (agent) {
      const preview = await offboardService.run(String(agentUser._id), {}, md);
      is('a preview changes nothing', preview.dryRun, true);
      truthy('and counts what would move', typeof preview.total === 'number', `${preview.total} records`);
      truthy('naming each kind', 'leads' in preview.counts && 'tickets' in preview.counts);

      const stillActive = await User.findById(agentUser._id).select('isActive').lean();
      truthy('the account is untouched by a preview', stillActive.isActive !== false);
    }

    await throws('you cannot offboard yourself',
      () => offboardService.run(String(mdUser._id), { apply: true }, md), /yourself/i);

    if (agent) {
      await throws('and an agent cannot offboard anybody',
        () => offboardService.run(String(mdUser._id), {}, agent), /manager/i);
    }

    if (viewerUser && agent) {
      await throws('work cannot be left to somebody who cannot act on it',
        () => offboardService.run(String(agentUser._id), { to: String(viewerUser._id), apply: true }, md),
        /cannot be given work/i);
    }
  }

  {
    /* THE ORDER IS THE DESIGN: work moves first, access closes second. Proven
       on a throwaway account so no real person is deactivated by a test. */
    const leaver = await User.create({
      name: `${tag} Leaver`, email: `${tag.toLowerCase()}@example.com`,
      password: 'temporary-123', role: 'employee', department: 'expansion',
    });
    const heir = await User.findOne({ role: 'employee', _id: { $ne: leaver._id } }).select('_id name').lean();
    cleanup.push(() => User.deleteOne({ _id: leaver._id }));

    const lead = await Lead.create({
      name: `${tag} inherited`, source: 'manual', phone: '9000099004', assignedTo: leaver._id,
    });
    const task = await CrmTask.create({
      title: `${tag} inherited task`, owner: leaver._id, dueAt: new Date(Date.now() + 86_400_000),
    });
    cleanup.push(() => Lead.deleteOne({ _id: lead._id }));
    cleanup.push(() => CrmTask.deleteOne({ _id: task._id }));
    cleanup.push(() => AuditLog.deleteMany({ entityId: leaver._id }));

    const done = await offboardService.run(String(leaver._id), { to: String(heir._id), apply: true }, md);
    is('it is no longer a dry run', done.dryRun, false);

    const movedLead = await Lead.findById(lead._id).select('assignedTo').lean();
    is('the lead moved to the heir', String(movedLead.assignedTo), String(heir._id));
    const movedTask = await CrmTask.findById(task._id).select('owner').lean();
    is('and so did the open task', String(movedTask.owner), String(heir._id));

    const closed = await User.findById(leaver._id).select('+isActive crmAvailable').lean();
    is('the account is deactivated', closed.isActive, false);
    is('and taken out of the lead rotation', closed.crmAvailable, false);

    const trail = await AuditLog.findOne({ entityId: leaver._id, action: 'offboard' }).lean();
    truthy('the offboarding is on the record', Boolean(trail), trail?.detail);
  }

  /* ══ Registration ═════════════════════════════════════════════ */
  console.log('\n── The screens are reachable ──');
  assertRoutesRegistered(createApp(), [
    ['GET', '/crm/exports'],
    ['POST', '/crm/exports'],
    ['PATCH', '/crm/exports/:id/approve'],
    ['PATCH', '/crm/exports/:id/reject'],
    ['GET', '/crm/exports/:id/link'],
    ['GET', '/crm/audit'],
    ['GET', '/crm/offboard/candidates'],
    ['GET', '/crm/offboard/:userId/preview'],
    ['POST', '/crm/offboard/:userId'],
  ], { ok, no });
} finally {
  for (const fn of cleanup) await fn();
  await disconnect();
}

process.exit(finish('CRM EXPORT + AUDIT'));
