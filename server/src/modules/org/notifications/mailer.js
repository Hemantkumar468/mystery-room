import { config } from '../../../config/index.js';
import { logger } from '../../../config/logger.js';

/**
 * Optional SMTP transport. Email only goes out when SMTP_HOST is configured;
 * otherwise every call is a silent no-op and in-app notifications carry the
 * load. nodemailer is loaded lazily so the API boots even where it isn't
 * installed or configured.
 */
let transportPromise = null;

async function getTransport() {
  if (!config.mail.configured) return null;
  if (!transportPromise) {
    transportPromise = import('nodemailer')
      .then(({ default: nodemailer }) =>
        nodemailer.createTransport({
          host: config.mail.host,
          port: config.mail.port,
          secure: config.mail.secure,
          auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined,
        }),
      )
      .catch((err) => {
        logger.warn('Email disabled — nodemailer could not be loaded', { error: err.message });
        return null;
      });
  }
  return transportPromise;
}

const escapeHtml = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Simple branded wrapper so every email reads the same. */
export function renderEmail({ title, message, link }) {
  const body = escapeHtml(message).replace(/\n/g, '<br/>');
  const cta = link
    ? `<p style="margin-top:20px"><a href="${config.ops.appUrl}${link}" style="background:#4922B4;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">Open in ERP</a></p>`
    : '';
  return `<div style="font-family:Inter,Segoe UI,sans-serif;max-width:620px;padding:24px;border:1px solid #e7e5ef;border-radius:12px">
    <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280">Mystery Rooms ERP</div>
    <h2 style="margin:6px 0 14px;color:#241157">${escapeHtml(title)}</h2>
    <div style="color:#374151;font-size:14px;line-height:1.6">${body}</div>${cta}
  </div>`;
}

export async function sendMail({ to, subject, html, text }) {
  const transport = await getTransport();
  if (!transport || !to) return false;
  try {
    await transport.sendMail({ from: config.mail.from, to, subject, html, text });
    return true;
  } catch (err) {
    logger.warn('Email send failed', { to, subject, error: err.message });
    return false;
  }
}

export default { sendMail, renderEmail };
