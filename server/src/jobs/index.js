import cron from 'node-cron';
import { config } from '../config/index.js';
import { logger } from '../config/logger.js';
import { delegationJobs } from '../modules/delegation/delegation.jobs.js';
import { checklistService } from '../modules/checklist/checklist.service.js';
import { Tenant } from '../core/tenancy/tenant.model.js';
import { withTenant, withoutTenant } from '../core/tenancy/tenantContext.js';

/**
 * Scheduled work for the Delegation & Checklist modules. All times are in the
 * business timezone (OPS_TIMEZONE), whatever the host's clock says.
 *
 *   every minute  fire due task reminders
 *   01:00         auto-renew checklist routines nearing their end date
 *   08:30         checklist digest per doer
 *   09:00         overdue-delegation digest (doers + assigners)
 *   09:30         escalation matrix (3d manager · 7d directors · 15d review badge)
 *   10:00         approval chase for assigners with submitted work
 *   23:50         create tomorrow's recurring delegations
 *
 * Every job is idempotent, so a restart or a second instance can't double-fire
 * anything harmful. Set JOBS_ENABLED=false on extra instances anyway.
 *
 * Each run happens once PER COMPANY, inside that company's tenant context, so
 * every read is limited to it and every notification or task it creates is
 * stamped with it. Before the tenancy migration has created any company, a job
 * runs once, unscoped — a single-company deployment has nothing to leak.
 */
const JOBS = [
  ['* * * * *', 'delegation reminders', () => delegationJobs.dispatchReminders()],
  ['0 1 * * *', 'checklist auto-renew', () => checklistService.autoRenew()],
  ['30 8 * * *', 'checklist digest', () => checklistService.dailyDigest()],
  ['0 9 * * *', 'overdue digest', () => delegationJobs.overdueDigest()],
  ['30 9 * * *', 'escalations', () => delegationJobs.runEscalations()],
  ['0 10 * * *', 'approval chase', () => delegationJobs.approvalChase()],
  ['50 23 * * *', 'recurring delegations', () => delegationJobs.generateRecurring()],
];

const running = new Set();
const tasks = [];

/** Run `fn` once for every active company. */
async function forEachCompany(name, fn) {
  const companies = await withoutTenant(
    'ops jobs run for every company, one company at a time',
    () => Tenant.find({ isActive: { $ne: false } }).select('_id').lean(),
  );
  if (!companies.length) return fn();
  for (const c of companies) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await withTenant(c._id, fn);
    } catch (err) {
      // One company's failure must not stop the others' reminders.
      logger.error(`Job "${name}" failed for company ${c._id}`, { error: err.message, stack: err.stack });
    }
  }
  return undefined;
}

export function startJobs() {
  if (!config.ops.jobsEnabled) {
    logger.info('Scheduled ops jobs disabled (JOBS_ENABLED=false)');
    return;
  }
  for (const [expr, name, fn] of JOBS) {
    tasks.push(
      cron.schedule(
        expr,
        async () => {
          // Never let a slow run overlap the next tick of the same job.
          if (running.has(name)) return;
          running.add(name);
          try {
            await forEachCompany(name, fn);
          } catch (err) {
            logger.error(`Job "${name}" failed`, { error: err.message, stack: err.stack });
          } finally {
            running.delete(name);
          }
        },
        { timezone: config.ops.timezone },
      ),
    );
  }
  logger.info(`⏱  ${JOBS.length} ops jobs scheduled (${config.ops.timezone})`);
}

export function stopJobs() {
  tasks.forEach((t) => t.stop());
  tasks.length = 0;
}

export default startJobs;
