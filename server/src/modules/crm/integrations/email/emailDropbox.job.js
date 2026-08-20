import { config } from '../../../../config/index.js';
import { logger } from '../../../../config/logger.js';
import { imapSource } from './imapSource.js';
import { withoutTenant } from '../../../../core/tenancy/tenantContext.js';

export const POLL_EMAIL_DROPBOX = 'crm.email.pollDropbox';

/**
 * Poll the BCC dropbox on a schedule.
 *
 * REGISTERED EVEN WHEN THE MAILBOX IS NOT CONFIGURED. The job then exits
 * immediately, which is deliberate: a job that is absent from the list is
 * indistinguishable from a job that is broken, and this project has already
 * paid for that confusion once.
 *
 * NOTE THE ARGUMENT ORDER — `define(name, processor, options)`. Passing the
 * options object second stores it as the job function and every run dies with
 * "definition.fn is not a function". That is not hypothetical: it took out all
 * four jobs for hours while the tests stayed green. assertJobsAreCallable() in
 * core/jobs/agenda.js now refuses to boot if it happens again.
 */
export function defineEmailDropboxJobs(agenda) {
  agenda.define(
    POLL_EMAIL_DROPBOX,
    async () => {
      if (!config.emailDropbox.configured) return;
      // One mailbox per deployment today. When a second company arrives it
      // needs its own dropbox address, and this becomes a per-tenant poll.
      const result = await withoutTenant('the dropbox mailbox is deployment-wide', () => imapSource.poll());
      if (!result.skipped && result.seen) {
        logger.info(`Email dropbox: ${result.seen} new message(s) — ${result.filed} filed, ${result.duplicate} already known, ${result.unmatched} unmatched, ${result.rejected} refused.`);
      }
    },
    // One at a time. Two concurrent polls would race on the UID cursor and
    // re-read the same messages.
    { concurrency: 1 },
  );
}

/** Schedule it. Called after `agenda.start()`, like every other CRM job. */
export async function scheduleEmailDropboxJobs(agenda) {
  if (!config.emailDropbox.configured) {
    logger.info('Email dropbox not configured — poll registered but not scheduled.');
    return;
  }
  await agenda.every(`${config.emailDropbox.pollMinutes} minutes`, POLL_EMAIL_DROPBOX);
  logger.info(`Email dropbox: polling ${config.emailDropbox.mailbox} every ${config.emailDropbox.pollMinutes} minutes.`);
}
