import nodemailer from 'nodemailer';
import { config } from '../../config/index.js';
import { logger } from '../../config/logger.js';

/**
 * Outbound email.
 *
 * DEGRADES, NEVER CRASHES. The app has to run on a laptop with no mail server,
 * so an unconfigured mailer is a supported state rather than a failure: every
 * send is skipped and logged. What it must never do is pretend — a silent
 * no-op that returns success is how "the reminders aren't arriving" becomes a
 * week of debugging.
 *
 * Credentials come from the environment only (SMTP_HOST/PORT/USER/PASS). None
 * are defaulted, so nothing is ever sent through a server nobody chose.
 */

let transport = null;
/** Logged once, not once per send — an unconfigured mailer with a minute-ly
 *  sweep would otherwise fill the log with the same line forever. */
let warned = false;

function getTransport() {
  if (transport) return transport;
  if (!config.mail.configured) return null;

  transport = nodemailer.createTransport({
    host: config.mail.host,
    port: config.mail.port,
    secure: config.mail.secure,
    // Auth is optional: an internal relay on a private network commonly has
    // none, and sending `auth: { user: undefined }` makes nodemailer fail.
    ...(config.mail.user ? { auth: { user: config.mail.user, pass: config.mail.pass } } : {}),
  });
  return transport;
}

export const mailService = {
  get configured() {
    return config.mail.configured;
  },

  /**
   * Send one message.
   *
   * @returns {Promise<{sent: boolean, skipped?: string, messageId?: string}>}
   *   Resolves either way — a failed reminder email must not take down the
   *   sweep that is delivering the other twenty.
   */
  async send({ to, subject, html, text }) {
    if (!to) return { sent: false, skipped: 'no recipient' };

    const tx = getTransport();
    if (!tx) {
      if (!warned) {
        warned = true;
        logger.warn(
          'Email is not configured (SMTP_HOST unset) — reminder emails will be '
          + 'skipped. In-app notifications are unaffected. Set SMTP_HOST, '
          + 'SMTP_PORT, SMTP_USER, SMTP_PASS and MAIL_FROM to enable them.',
        );
      }
      return { sent: false, skipped: 'mail not configured' };
    }

    try {
      const info = await tx.sendMail({
        from: config.mail.from,
        to,
        subject,
        text: text || stripHtml(html),
        html,
      });
      return { sent: true, messageId: info.messageId };
    } catch (err) {
      logger.error(`Email to ${to} failed: ${err.message}`);
      return { sent: false, skipped: err.message };
    }
  },

  /** Prove the credentials actually work, without sending anything. */
  async verify() {
    const tx = getTransport();
    if (!tx) return { ok: false, reason: 'mail not configured' };
    try {
      await tx.verify();
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  },

  /** Test seam: swap in nodemailer's jsonTransport to assert on the message
   *  a send WOULD produce, without a server or credentials. */
  __setTransportForTests(t) {
    transport = t;
  },
};

/** A readable plain-text part, so the mail is not HTML-only (which scores as
 *  spam and is unreadable in text clients). */
function stripHtml(html = '') {
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export default mailService;
