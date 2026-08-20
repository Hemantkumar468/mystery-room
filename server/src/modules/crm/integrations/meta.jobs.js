import { fetchLeadFromGraph, mapGraphLead } from './meta.service.js';
import { leadIntakeService } from '../intake/leadIntake.service.js';
import { LEAD_SOURCE } from '../crm.constants.js';
import { logger } from '../../../config/logger.js';

/** The job name, exported so the webhook queues the same string this defines. */
export const FETCH_META_LEAD = 'crm.meta.fetchLead';

/**
 * The deferred half of Meta lead capture.
 *
 * The webhook answers Meta in milliseconds and queues this; this does the slow,
 * fallible part — a network call to the Graph API — where a failure can be
 * retried instead of becoming a webhook timeout that Meta responds to by
 * sending the whole thing again.
 */
export function defineMetaLeadJobs(agenda) {
  agenda.define(FETCH_META_LEAD, async (job) => {
    const { leadgenId, platform } = job.attrs.data || {};
    if (!leadgenId) throw new Error('No leadgenId on the job');

    const graphLead = await fetchLeadFromGraph(leadgenId);
    const payload = mapGraphLead(graphLead, { platform: platform || LEAD_SOURCE.FACEBOOK });

    // `externalId` makes this safe to run twice: intake returns the existing
    // lead rather than creating a second one. That matters because a job that
    // throws AFTER the lead was written would otherwise duplicate it on retry.
    const { lead, created } = await leadIntakeService.intake(payload);

    logger.info(
      created
        ? `Meta lead ${leadgenId} captured as ${lead._id} (${lead.name})`
        : `Meta lead ${leadgenId} was already known — no new record`,
    );
  }, { priority: 'high', concurrency: 3 });
}

export default defineMetaLeadJobs;
