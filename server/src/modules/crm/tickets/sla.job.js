import { logger } from '../../../config/logger.js';
import { ticketService } from './ticket.service.js';
import { withoutTenant } from '../../../core/tenancy/tenantContext.js';

export const SWEEP_SLA_BREACHES = 'crm.tickets.sweepBreaches';

/**
 * Stamp tickets that have gone past their deadline.
 *
 * A SWEEP RATHER THAN A TIMER PER TICKET. Scheduling a job for each deadline
 * means thousands of pending jobs that all have to be cancelled or rescheduled
 * whenever a priority changes — and a missed cancellation marks a ticket
 * breached after it was answered.
 *
 * Every five minutes is enough: the number is used for reporting and for a
 * list filter, not to page anybody, and a breach that is recorded four minutes
 * late is still recorded on the right side of the deadline.
 *
 * ARGUMENT ORDER: `define(name, processor, options)`. Passing options second
 * stores them as the job function and every run dies with "definition.fn is
 * not a function" — see core/jobs/agenda.js, where the boot guard now refuses
 * to start if that happens again.
 */
export function defineSlaJobs(agenda) {
  agenda.define(
    SWEEP_SLA_BREACHES,
    async () => {
      // Deadlines pass on the same clock for every company.
      const result = await withoutTenant(
        'the SLA breach sweep runs for every company',
        () => ticketService.sweepBreaches(),
      );
      if (result.firstResponse || result.resolution) {
        logger.warn(`SLA breaches recorded: ${result.firstResponse} first-response, ${result.resolution} resolution.`);
      }

      /* Warnings and escalations run in the SAME job, right after the breach
         stamp, because they read the same tickets. Splitting them into two
         schedules would double the only heavy query in this module and let the
         two views of the same ticket drift a few minutes apart — which is
         exactly long enough to escalate something that was just answered. */
      const ladder = await withoutTenant(
        'escalation reaches whoever can act, in every company',
        () => ticketService.sweepEscalations(),
      );
      if (ladder.warned || ladder.escalated) {
        logger.warn(`SLA ladder: ${ladder.warned} warned before breach, ${ladder.escalated} escalated.`);
      }
    },
    { concurrency: 1 },
  );
}

/** Scheduled after `agenda.start()`, like every other CRM job. */
export async function scheduleSlaJobs(agenda) {
  await agenda.every('5 minutes', SWEEP_SLA_BREACHES);
}
