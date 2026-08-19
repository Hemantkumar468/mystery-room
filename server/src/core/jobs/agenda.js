// Named export, not default — agenda v6 ships ESM with no default binding, and
// v6 also moved storage backends into their own packages.
import { Agenda } from 'agenda';
import { MongoBackend } from '@agendajs/mongo-backend';
import mongoose from 'mongoose';
import { logger } from '../../config/logger.js';

/**
 * Background work, persisted in Mongo.
 *
 * WHY A QUEUE AND NOT A TIMER. Work that must survive a restart cannot live in
 * `setInterval`: a deploy in the middle of an hour silently drops whatever was
 * pending. Agenda stores jobs as documents in the same database the app
 * already uses, so a queued job outlives the process that queued it — and a
 * failed one can be retried, inspected, and counted.
 *
 * WHAT BELONGS HERE. Anything slow or fallible that a request should not wait
 * for: fetching lead data from Meta's Graph API, sending a batch of WhatsApp
 * messages, transcribing a call recording, computing nightly report snapshots.
 * The rule of thumb is whether a provider having a bad minute should turn into
 * a customer-facing timeout. If it would, it goes in a job.
 *
 * WHAT DOES NOT. Lead routing. It runs inline, because a lead that exists for
 * even a second without an owner is invisible to every list view.
 *
 * Jobs are DEFINED at boot and INVOKED from anywhere. A job whose definition
 * is missing when it comes due is not an error Agenda can report usefully — it
 * simply never runs — so every definition is registered in one place below.
 */

let agenda = null;
let started = false;

/** The single instance. Created lazily so importing this file costs nothing. */
export function getAgenda() {
  if (agenda) return agenda;

  agenda = new Agenda({
    backend: new MongoBackend({
      // The connection Mongoose already has, rather than a second one built
      // from the same URI. Two pools to the same Atlas cluster doubles the
      // connection count for no benefit, and Atlas's tiers cap that.
      mongo: mongoose.connection.db,
      collection: 'jobs',
    }),
    // One at a time per job name by default. The Graph API and every messaging
    // provider rate-limit per account, and a queue that fans out twenty
    // concurrent calls just converts a backlog into a 429 storm.
    defaultConcurrency: 3,
    maxConcurrency: 10,
    // Long enough for a slow provider, short enough that a wedged job is
    // reclaimed rather than blocking its queue until someone notices.
    defaultLockLifetime: 5 * 60 * 1000,
  });

  agenda.on('fail', (err, job) => {
    logger.error(`Job "${job.attrs.name}" failed: ${err.message}`, {
      jobId: String(job.attrs._id),
      attempts: job.attrs.failCount,
    });
  });

  return agenda;
}

/**
 * Register every job definition, then start processing.
 *
 * MUST be called after connectDatabase(): the backend is handed Mongoose's own
 * `connection.db`, which is undefined until that resolves. Starting earlier
 * fails with a confusing property error rather than a clear boot failure.
 */
export async function startJobs() {
  if (started) return getAgenda();
  const a = getAgenda();

  // Definitions are imported here rather than at module scope so this file has
  // no dependency on any feature module — features depend on the queue, never
  // the other way round.
  const { defineMetaLeadJobs } = await import('../../modules/crm/integrations/meta.jobs.js');
  defineMetaLeadJobs(a);
  const { defineTaskJobs, scheduleTaskJobs } = await import('../../modules/crm/tasks/reminder.job.js');
  defineTaskJobs(a);
  const { defineRecordingJobs } = await import('../../modules/crm/integrations/telephony/recording.job.js');
  defineRecordingJobs(a);

  await a.start();

  // Scheduled AFTER start, and after the definitions: Agenda refuses to
  // schedule a job name it has never been told about.
  await scheduleTaskJobs(a);
  started = true;
  logger.info('Job queue started');
  return a;
}

export async function stopJobs() {
  if (!agenda || !started) return;
  // `false` → do not force-cancel running jobs; let them finish their lock.
  await agenda.stop(false);
  started = false;
}

export default getAgenda;
