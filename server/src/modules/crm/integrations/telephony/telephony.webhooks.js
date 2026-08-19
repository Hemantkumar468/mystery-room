import { Router } from 'express';
import { asyncHandler } from '../../../../core/utils/asyncHandler.js';
import { telephonyProvider } from './telephony.provider.js';
import { telephonyService } from './telephony.service.js';
import { FETCH_RECORDING } from './recording.job.js';
import { getAgenda } from '../../../../core/jobs/agenda.js';
import { logger } from '../../../../config/logger.js';

/**
 * What the phone provider posts back.
 *
 * Mounted under `/crm/public`, so nothing here has a session. Three rules
 * shape every handler:
 *
 *   1. VERIFY FIRST. An unverified POST is somebody who found the URL, and the
 *      only safe thing to do with it is nothing.
 *   2. ANSWER FAST. Providers redeliver anything they do not get a quick 2xx
 *      for, so the slow half (downloading a recording) goes to a job.
 *   3. TREAT EVERY FIELD AS UNTRUSTED. Exotel does not sign its callbacks —
 *      the URL token proves the caller knew a secret, not that the body is
 *      true — so nothing here writes a field straight through.
 */
const router = Router();

/** Shared by all three: reject anything that cannot prove it belongs. */
function verified(req, res) {
  if (telephonyProvider().verifyWebhook(req)) return true;
  logger.warn(`Telephony webhook rejected from ${req.ip}`);
  res.sendStatus(403);
  return false;
}

/**
 * A call finished (or changed state). Log it, and fetch the recording.
 *
 * Exotel posts form-encoded, which `express.urlencoded` has already parsed.
 */
router.post('/status', asyncHandler(async (req, res) => {
  if (!verified(req, res)) return;

  const event = telephonyProvider().parseStatusWebhook(req.body);
  if (!event) { res.sendStatus(200); return; }

  // Acknowledged before the work, so a slow database cannot turn into a
  // redelivery of a call that was already logged.
  res.sendStatus(200);

  const activity = await telephonyService.recordCallEnded(event);

  if (activity && event.recordingUrl) {
    await getAgenda().now(FETCH_RECORDING, {
      activityId: String(activity._id),
      recordingUrl: event.recordingUrl,
      providerCallId: event.providerCallId,
    });
  }
}));

/**
 * A call is RINGING — the screen-pop.
 *
 * This has to answer in milliseconds: on Exotel a "passthru" applet holds the
 * call while it waits for us, so a slow response is dead air the customer is
 * listening to.
 */
router.post('/inbound', asyncHandler(async (req, res) => {
  if (!verified(req, res)) return;

  const event = telephonyProvider().parseInboundWebhook(req.body);
  if (!event) { res.sendStatus(200); return; }

  res.sendStatus(200);
  await telephonyService.registerRing(event);
}));

/** Some accounts are configured to post the recording separately, once the
 *  file is ready rather than when the call ends. */
router.post('/recording', asyncHandler(async (req, res) => {
  if (!verified(req, res)) return;

  const event = telephonyProvider().parseStatusWebhook(req.body);
  res.sendStatus(200);
  if (!event?.recordingUrl) return;

  const activity = await telephonyService.recordCallEnded(event);
  if (activity) {
    await getAgenda().now(FETCH_RECORDING, {
      activityId: String(activity._id),
      recordingUrl: event.recordingUrl,
      providerCallId: event.providerCallId,
    });
  }
}));

export default router;
