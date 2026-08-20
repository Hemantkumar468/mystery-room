import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { config } from '../../../../config/index.js';
import { logger } from '../../../../config/logger.js';
import { EmailDropboxState } from './emailDropbox.model.js';
import { emailDropboxService } from './emailDropbox.service.js';

/**
 * The IMAP half of the dropbox — fetching, and nothing else.
 *
 * Every decision about what a message MEANS lives in emailDropbox.service.js,
 * which knows nothing about mailboxes. That split is the point: the decision
 * table is then testable from fixtures, and the only thing that needs a live
 * mailbox to exercise is this file.
 *
 * NOT IDLE. IMAP can push, but a long-lived IDLE connection has to be
 * supervised, reconnected, and reasoned about across restarts. A poll every
 * few minutes is the honest fit for a channel whose whole premise is that
 * somebody remembered to BCC it — and it costs one connection per interval
 * rather than one held open forever.
 */

/** A message that will not parse must not stop the ones behind it. */
async function parseSafely(source) {
  try {
    return await simpleParser(source);
  } catch (err) {
    logger.warn(`Email dropbox: a message failed to parse — ${err.message}`);
    return null;
  }
}

export const imapSource = {
  /**
   * Poll once: fetch everything new, hand each message to the service.
   *
   * Resumes from a stored UID high-water mark, so a restart re-reads nothing
   * and a slow run is picked up where it stopped. The cursor moves only after
   * a message has been dealt with — a crash halfway through re-reads a few
   * messages, and the unique index on Message-ID makes that harmless. The
   * other way round would lose mail permanently.
   *
   * @param {{limit?: number}} options
   */
  async poll({ limit = 200 } = {}) {
    if (!config.emailDropbox.configured) {
      return { skipped: true, reason: 'not-configured' };
    }

    const { mailbox } = config.emailDropbox;
    const client = new ImapFlow({
      host: config.emailDropbox.host,
      port: config.emailDropbox.port,
      secure: config.emailDropbox.secure,
      auth: { user: config.emailDropbox.user, pass: config.emailDropbox.pass },
      // ImapFlow logs every protocol frame at info by default, which buries
      // everything else in the application log within a day.
      logger: false,
    });

    const tally = {
      seen: 0, filed: 0, duplicate: 0, unmatched: 0, rejected: 0,
    };
    let lock = null;

    try {
      await client.connect();
      lock = await client.getMailboxLock(mailbox);

      let state = await EmailDropboxState.findOne({ mailbox });
      if (!state) state = await EmailDropboxState.create({ mailbox, lastUid: 0 });

      const uidValidity = String(client.mailbox?.uidValidity ?? '');
      if (state.uidValidity && uidValidity && state.uidValidity !== uidValidity) {
        /* The mailbox was rebuilt and UID numbering restarted. Carrying the old
           high-water mark across would skip every message below it, silently
           and forever, so the cursor is reset and the Message-ID index is left
           to absorb whatever gets re-read. */
        logger.warn(`Email dropbox: uidValidity changed (${state.uidValidity} → ${uidValidity}); restarting from the beginning of ${mailbox}.`);
        state.lastUid = 0;
      }
      state.uidValidity = uidValidity;

      const since = state.lastUid || 0;
      // `${n}:*` is the IMAP idiom for "from here to the end". It always
      // returns at least one message (the last), so the already-seen guard
      // below is required rather than defensive.
      const range = `${since + 1}:*`;
      let highest = since;
      let processed = 0;

      for await (const item of client.fetch(range, { uid: true, source: true }, { uid: true })) {
        if (item.uid <= since) continue;
        if (processed >= limit) break;
        processed += 1;
        tally.seen += 1;

        const parsed = await parseSafely(item.source);
        if (parsed) {
          const result = await emailDropboxService.fileMessage(parsed);
          if (tally[result.status] !== undefined) tally[result.status] += 1;
          if (result.status === 'filed') {
            logger.info(`Email dropbox: filed "${(parsed.subject || '').slice(0, 60)}" on ${result.entityType} ${result.name}`);
          }
        }

        // Only after the message is dealt with.
        highest = Math.max(highest, item.uid);
        state.lastUid = highest;
        await state.save();
      }

      state.lastPolledAt = new Date();
      state.lastError = null;
      state.counts.filed += tally.filed;
      state.counts.duplicate += tally.duplicate;
      state.counts.unmatched += tally.unmatched;
      state.counts.rejected += tally.rejected;
      await state.save();

      return { skipped: false, ...tally, lastUid: state.lastUid };
    } catch (err) {
      /* Recorded on the state document as well as logged. "Nothing has arrived
         for three days" and "the password expired three days ago" look
         identical from the outside, and only one of them is a working feature.
         The settings screen reads this. */
      await EmailDropboxState.updateOne(
        { mailbox },
        { $set: { lastError: err.message, lastPolledAt: new Date() }, $setOnInsert: { mailbox } },
        { upsert: true },
      );
      logger.error(`Email dropbox poll failed: ${err.message}`);
      throw err;
    } finally {
      if (lock) lock.release();
      // `close` rather than `logout` in a finally: logout can itself hang on a
      // half-dead socket, and this runs every few minutes forever.
      try { await client.close(); } catch { /* already gone */ }
    }
  },
};

export default imapSource;
