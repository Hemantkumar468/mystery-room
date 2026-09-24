import { telephonyProvider } from './telephony.provider.js';
import { CrmActivity } from '../../activities/crmActivity.model.js';
import { uploadBuffer, isS3Configured } from '../../../../config/s3.js';
import { logger } from '../../../../config/logger.js';

export const FETCH_RECORDING = 'crm.telephony.fetchRecording';

/**
 * Download a call recording and own it.
 *
 * PROVIDER URLS EXPIRE. Storing one on the activity means a link that works in
 * testing, works for a week, and is dead by the time anybody needs it for a
 * dispute — or needs the provider's credentials attached to play it, which
 * makes it unshareable. Downloaded once, it is ours: served through the
 * presigner the app already has, deleted by a lifecycle rule we control, and
 * removable on a DPDP request without asking anyone.
 *
 * In a job because it is slow and fallible: a 3MB download inside a webhook
 * handler is a timeout, and a timeout is a redelivery of the whole webhook.
 */
export function defineRecordingJobs(agenda) {
  agenda.define(FETCH_RECORDING, async (job) => {
    const { activityId, recordingUrl, providerCallId } = job.attrs.data || {};
    if (!recordingUrl || !activityId) throw new Error('Nothing to fetch');

    if (!isS3Configured) {
      // Not an error — a laptop with no bucket is a supported state. But it is
      // said out loud, because "the recordings are missing" three months later
      // is otherwise an unexplainable bug.
      logger.warn(`S3 is not configured — recording for ${providerCallId} was not stored`);
      return;
    }

    const activity = await CrmActivity.findById(activityId).select('meta').lean();
    if (activity?.meta?.recordingKey) return; // already fetched

    const audio = await telephonyProvider().fetchRecording(recordingUrl);
    const stored = await uploadBuffer(audio, {
      folder: 'crm/recordings',
      filename: `${providerCallId}.mp3`,
      contentType: 'audio/mpeg',
    });

    await CrmActivity.updateOne({ _id: activityId }, {
      $set: {
        'meta.recordingKey': stored.public_id,
        'meta.recordingBytes': stored.bytes,
      },
      // The provider's link goes once ours works. Two sources for one file is
      // how the expiring one ends up being the one that gets used.
      $unset: { 'meta.recordingUrl': '' },
    });

    logger.info(`Recording for ${providerCallId} stored (${Math.round(stored.bytes / 1024)}KB)`);
  }, { concurrency: 2 });
}

export default defineRecordingJobs;
