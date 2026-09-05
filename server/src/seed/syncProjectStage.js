/**
 * Bring one phase of LIVE projects up to date with the template — used when a
 * phase is re-shaped after projects already exist on it (first use: Phase 6
 * becoming the order tracker over Phase 5's BOQ lines).
 *
 * What it does, per project:
 *   1. Refreshes the stage's snapshot (name, owner, What/Who/When/How, gate,
 *      exit criteria, capture mode) from the template.
 *   2. Keeps every FINISHED task of the phase as history; removes unfinished
 *      ones the old definition generated; issues the template's current tasks
 *      with the same scheduling and doer resolution as project creation.
 *   3. --migrate-orders (p15 only): copies what the OLD Phase 6 "indent"
 *      records knew (indent/PO number, status, promised delivery, pending
 *      quantity) onto the matching Phase 5 BOQ line, and turns the PO page's
 *      "sent via WhatsApp/email" comments into send stamps — so the tracker
 *      opens already populated. Every copied value is logged in changeLog
 *      with a "migrated" note. The old records are left untouched.
 *   4. --reopen: a stage already marked complete goes back to in-progress,
 *      because its work has been redefined.
 *
 * SAFE BY DEFAULT: dry run, prints the plan. Pass --apply to write.
 *
 *   node src/seed/syncProjectStage.js --stage p15 --project MR-BHO-003
 *   node src/seed/syncProjectStage.js --stage p15 --template MR-PMS-CLIENT-FLOW   # every project on it
 *   … --apply --reopen --migrate-orders
 */
import mongoose from 'mongoose';
import { config } from '../config/index.js';
import { Project } from '../modules/pms/projects/project.model.js';
import { Record } from '../modules/pms/records/record.model.js';
import { Template } from '../modules/pms/templates/template.model.js';
import { syncStageFromTemplate } from '../modules/pms/projects/project.service.js';
import { withTenant, withoutTenant } from '../core/tenancy/tenantContext.js';

const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const flag = (name) => process.argv.includes(name);
const APPLY = flag('--apply');
const STAGE = arg('--stage') || 'p15';

/** Old Phase 6 indent statuses → tracker vocabulary. */
const STATUS_MAP = {
  'Ordered': 'Ordered', 'In Production': 'Ordered', 'QC Passed': 'Ordered',
  'Dispatched': 'Dispatched', 'In Transit': 'Dispatched', 'Delivered': 'Delivered',
  'Received (GRN)': 'Received (GRN)', 'Installed': 'Received (GRN)',
};
const isEmpty = (v) => v == null || v === '';

/** Copy old p15 indent facts + PO-page send comments onto the p13 lines. */
async function migrateOrders(project) {
  const lines = await Record.find({ project: project._id, stageKey: 'p13' }).sort({ seq: 1 });
  const indents = await Record.find({ project: project._id, stageKey: 'p15' });
  const log = [];
  const now = new Date();

  for (const line of lines) {
    const v = { ...(line.values || {}) };
    const changes = [];
    const set = (key, label, to, note, by, at) => {
      if (isEmpty(to) || !isEmpty(v[key])) return;
      changes.push({ field: key, label, from: null, to, note, by: by || line.updatedBy || line.createdBy, at: at || now });
      v[key] = to;
    };

    // 1. Send stamps from the PO page's own comments ("📤 Purchase order PO-001 sent via WhatsApp to 98…").
    for (const c of line.comments || []) {
      const m = /sent via (WhatsApp|email)(?: to (.+?))?\.?$/i.exec(c.body || '');
      if (!m) continue;
      const ch = m[1].toLowerCase() === 'whatsapp' ? 'whatsapp' : 'email';
      set(`sent_${ch}_at`, `${ch === 'whatsapp' ? 'WhatsApp' : 'Email'} sent at`, new Date(c.createdAt).toISOString(), 'From the send log', c.author, c.createdAt);
      if (m[2]) set(`sent_${ch}_to`, `${ch === 'whatsapp' ? 'WhatsApp' : 'Email'} sent to`, m[2].trim(), 'From the send log', c.author, c.createdAt);
      // The PO number is NOT taken from the comment: before seq numbering it
      // was derived from the record id ("PO-3F8F66"). The tracker derives
      // PO-### from seq while the field is blank and fixes it on the next send.
      set('order_status', 'Order Status', 'Ordered', 'Sent to the vendor', c.author, c.createdAt);
    }

    // 2. The old Phase 6 indent for this line: matched by the BOQ item it picked, else by vendor.
    const item = String(v.item || line.title || '').trim().toLowerCase();
    const indent = indents.find((r) => String(r.values?.boq_item || '').trim().toLowerCase() === item)
      || (indents.filter((r) => String(r.values?.vendor || '').trim().toLowerCase() === String(v.vendor || '').trim().toLowerCase()).length === 1
        ? indents.find((r) => String(r.values?.vendor || '').trim().toLowerCase() === String(v.vendor || '').trim().toLowerCase())
        : null);
    if (indent) {
      const iv = indent.values || {};
      const note = `Migrated from the old Phase 6 indent #${indent.seq}`;
      const by = indent.updatedBy || indent.createdBy;
      set('indent_number', 'Indent Number', iv.indent_number, note, by, indent.updatedAt);
      set('po_number', 'PO Number', iv.po_number, note, by, indent.updatedAt);
      set('promised_delivery', 'Vendor promised delivery', iv.expected_delivery, note, by, indent.updatedAt);
      set('dispatch_date', 'Dispatched on', iv.expected_dispatch && MOVED_FROM_OLD(iv.status) ? iv.expected_dispatch : null, note, by, indent.updatedAt);
      set('pending_quantity', 'Quantity still pending', iv.pending_quantity, note, by, indent.updatedAt);
      set('tracking_remarks', 'Tracking remarks', [iv.production_stage && `Production stage: ${iv.production_stage}`, iv.remarks].filter(Boolean).join(' — ') || null, note, by, indent.updatedAt);
      const mapped = STATUS_MAP[iv.status];
      if (mapped && mapped !== v.order_status && !(v.order_status && !isEmpty(v.order_status) && mapped === 'Ordered')) {
        changes.push({ field: 'order_status', label: 'Order Status', from: v.order_status || null, to: mapped, note: `${note} (was "${iv.status}")`, by, at: indent.updatedAt || now });
        v.order_status = mapped;
      }
    }

    if (!changes.length) { log.push(`  ${line.title}: nothing to migrate`); continue; }
    log.push(`  ${line.title}: ${changes.map((c) => `${c.label} → ${c.to}`).join('; ')}`);
    if (APPLY) {
      line.values = v;
      line.markModified('values');
      line.changeLog.push(...changes);
      await line.save();
    }
  }
  return log;
}
const MOVED_FROM_OLD = (old) => ['Dispatched', 'In Transit', 'Delivered', 'Received (GRN)', 'Installed'].includes(old);

async function main() {
  await mongoose.connect(config.db.uri);
  console.log(APPLY ? '\n== APPLYING ==' : '\n== DRY RUN (no writes) — pass --apply to persist ==');

  /* Finding the work spans every company by definition — one template is
     shared, and `--template` is meant to reach all of its projects. */
  const projects = await withoutTenant(
    'a template sync deliberately covers every company using that template',
    async () => {
      if (arg('--project')) return Project.find({ code: arg('--project') });
      if (arg('--template')) {
        const tpl = await Template.findOne({ code: arg('--template') }).select('_id');
        if (!tpl) throw new Error(`Template ${arg('--template')} not found`);
        return Project.find({ 'template.ref': tpl._id });
      }
      throw new Error('Pass --project <CODE> or --template <CODE>');
    },
  );
  if (!projects.length) throw new Error('No matching projects');

  for (const project of projects) {
    console.log(`\n# ${project.code}  ${project.name}`);
    /* DOING the work is scoped to the project's own company, because tasks
       created here are stamped from the ambient context. Run this unscoped
       and the new tasks are born tenant-less: present in the database, absent
       from every screen, with nothing to show that anything went wrong. */
    const run = (fn) => (project.tenant ? withTenant(String(project.tenant), fn) : fn());

    const plan = await run(() => syncStageFromTemplate(project, STAGE, { apply: APPLY, reopen: flag('--reopen') }));
    if (plan.rename) console.log(`  rename: "${plan.rename.from}" → "${plan.rename.to}"`);
    if (plan.reopen) console.log('  reopen: completed → in progress');
    for (const t of plan.keepTasks) console.log(`  keep   ${t}`);
    for (const t of plan.removeTasks) console.log(`  remove ${t}`);
    for (const t of plan.addTasks) console.log(`  add    ${t}`);
    if (STAGE === 'p15' && flag('--migrate-orders')) {
      console.log('  orders:');
      for (const line of await run(() => migrateOrders(project))) console.log(line);
    }
  }
  console.log(APPLY ? '\nDone.' : '\nNothing written. Re-run with --apply.');
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
