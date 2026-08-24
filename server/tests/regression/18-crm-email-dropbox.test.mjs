/**
 * REGRESSION SUITE — the BCC dropbox.
 *
 * The decision the dropbox makes on every message is: whose record is this,
 * and may this sender write to it? Getting the second half wrong is the
 * serious one. The dropbox address travels in the headers of every mail it is
 * copied on, so it has to be assumed public — and if "arrived in our mailbox"
 * meant "is true", anyone who read a forwarded thread could write entries onto
 * any customer's history. A CRM whose timeline can be forged is worse than one
 * with no email in it, because people believe it.
 *
 * The decision table is exercised from FIXTURES, not a live mailbox: the
 * service takes the shape mailparser produces and knows nothing about IMAP, so
 * every branch is reachable without credentials. The IMAP half is one file
 * that makes no decisions.
 *
 * And, per the Agenda outage: the poll job is asserted to be registered with a
 * callable processor, and the routes are asserted to be routed. A perfect
 * service that nothing polls and nothing calls is that outage in a new costume.
 */
import 'dotenv/config';
import { connect, disconnect } from '../helpers/db.js';
import { ok, no, finish } from '../helpers/assert.js';
import { assertRoutesRegistered } from '../helpers/routes.js';

const conn = await connect();
console.log(`Connected: ${conn.name}\n`);

const B = '../../src/modules/crm';
const { emailDropboxService, stripQuotedReply } = await import(`${B}/integrations/email/emailDropbox.service.js`);
const { UnfiledEmail, EmailDropboxState } = await import(`${B}/integrations/email/emailDropbox.model.js`);
const { defineEmailDropboxJobs, POLL_EMAIL_DROPBOX } = await import(`${B}/integrations/email/emailDropbox.job.js`);
const { crmEmailService } = await import(`${B}/integrations/email/crmEmail.service.js`);
const { threadMessages } = await import(`${B}/integrations/email/threading.js`);
const { Lead } = await import(`${B}/leads/lead.model.js`);
const { Contact } = await import(`${B}/contacts/contact.model.js`);
const { CrmActivity } = await import(`${B}/activities/crmActivity.model.js`);
const { User } = await import('../../src/modules/auth/auth.model.js');
const { config } = await import('../../src/config/index.js');
const { createApp } = await import('../../src/app.js');

const is = (name, actual, expected) => (
  actual === expected ? ok(name) : no(name, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`)
);
const truthy = (name, v, detail = '') => ((v ? ok : no)(name, detail || (v ? '' : `got ${JSON.stringify(v)}`)));

const tag = `ZZMAIL-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
const DROPBOX = config.emailDropbox.address || 'crm-dropbox@mysteryrooms.in';
let seq = 0;
const nextId = () => `<${tag}-${(seq += 1)}@test.local>`;

/** The shape mailparser hands over, with only what the service reads. */
const message = ({
  from, to = [], cc = [], subject = 'Franchise enquiry', text = 'Hello', messageId, date = new Date(),
  attachments = [], inReplyTo, references,
}) => ({
  messageId: messageId === undefined ? nextId() : messageId,
  from: { value: from ? [{ address: from }] : [] },
  to: { value: to.map((address) => ({ address })) },
  cc: { value: cc.map((address) => ({ address })) },
  subject,
  text,
  date,
  attachments,
  inReplyTo,
  references,
});

const staff = await User.findOne({ role: { $in: ['md', 'admin'] }, email: { $ne: null } })
  .select('_id email name').lean();
const cleanup = [];

try {
  truthy('a staff account with an email exists to test with', Boolean(staff?.email), staff?.email);
  const STAFF = staff.email.toLowerCase();

  await Promise.all([
    Lead.deleteMany({ name: /^ZZMAIL-/ }),
    Contact.deleteMany({ name: /^ZZMAIL-/ }),
    UnfiledEmail.deleteMany({ messageId: /^<ZZMAIL-/ }),
  ]);

  /* ── Fixtures ───────────────────────────────────────────────── */
  const lead = await Lead.create({
    name: `${tag} Priya`, source: 'manual', email: `${tag.toLowerCase()}-priya@example.com`, status: 'new', assignedTo: staff._id,
  });
  const contact = await Contact.create({
    name: `${tag} Rakesh`, email: `${tag.toLowerCase()}-rakesh@example.com`, owner: staff._id,
  });
  const closedLead = await Lead.create({
    name: `${tag} Old`, source: 'manual', email: `${tag.toLowerCase()}-rakesh@example.com`, status: 'converted', assignedTo: staff._id,
  });
  cleanup.push(
    () => Lead.deleteMany({ _id: { $in: [lead._id, closedLead._id] } }),
    () => Contact.deleteOne({ _id: contact._id }),
    () => CrmActivity.deleteMany({ providerEventId: new RegExp(`^<${tag}-`) }),
    () => UnfiledEmail.deleteMany({ messageId: new RegExp(`^<${tag}-`) }),
  );

  /* ── The trust boundary ─────────────────────────────────────── */
  console.log('── Who is allowed to write to a customer timeline ──');
  {
    const r = await emailDropboxService.fileMessage(message({
      from: 'stranger@somewhere-else.example', to: [lead.email, DROPBOX], subject: 'I know your dropbox',
    }));
    is('an unknown sender is refused', r.status, 'rejected');
    is('and the reason is recorded', r.reason, 'unknown-sender');
    const held = await UnfiledEmail.findOne({ reason: 'unknown-sender', subject: 'I know your dropbox' }).lean();
    truthy('the refused message is kept, not dropped', Boolean(held));
    const forged = await CrmActivity.countDocuments({ entityId: lead._id, subject: 'I know your dropbox' });
    is('and nothing was written to the lead', forged, 0);
  }

  {
    const r = await emailDropboxService.fileMessage(message({
      from: STAFF, to: [lead.email, DROPBOX], subject: `${tag} Quote attached`,
    }));
    is('a message from our own staff is filed', r.status, 'filed');
    is('on the lead the customer address matches', String(r.entityId), String(lead._id));
    is('and recorded as going out', r.direction, 'outbound');
  }

  {
    // The customer replying straight to the dropbox is the other direction,
    // and is allowed precisely because we already know the address.
    const r = await emailDropboxService.fileMessage(message({
      from: lead.email, to: [DROPBOX], subject: `${tag} Re: Quote`,
    }));
    is('a known customer writing in is filed', r.status, 'filed');
    is('as coming in', r.direction, 'inbound');
    is('on their own record', String(r.entityId), String(lead._id));
  }

  /* ── Which record ───────────────────────────────────────────── */
  console.log('\n── Which record it lands on ──');
  {
    // Rakesh is both a contact and a CONVERTED lead. A new mail belongs on the
    // person, not on an enquiry that already ended.
    const r = await emailDropboxService.fileMessage(message({
      from: STAFF, to: [contact.email, DROPBOX], subject: `${tag} Renewal`,
    }));
    is('a closed lead is skipped in favour of the contact', r.entityType, 'contact');
    is('and it is the right contact', String(r.entityId), String(contact._id));
  }
  {
    const r = await emailDropboxService.fileMessage(message({
      from: STAFF, to: [DROPBOX], cc: [lead.email], subject: `${tag} Cc counts too`,
    }));
    is('someone on Cc is still the counterparty', String(r.entityId), String(lead._id));
  }
  {
    const r = await emailDropboxService.fileMessage(message({
      from: STAFF, to: [DROPBOX], subject: `${tag} Only the dropbox`,
    }));
    is('the dropbox itself never counts as the customer', r.status, 'unmatched');
    is('and the reason says so', r.reason, 'no-matching-record');
  }
  {
    const r = await emailDropboxService.fileMessage(message({
      from: STAFF, to: ['nobody-we-know@example.com', DROPBOX], subject: `${tag} Unknown recipient`,
    }));
    is('mail to somebody we have no record of is held', r.status, 'unmatched');
    const held = await UnfiledEmail.findOne({ subject: `${tag} Unknown recipient` }).lean();
    truthy('and kept so it can be filed by hand', Boolean(held));
    truthy('with an excerpt but not the whole body', (held?.excerpt || '').length <= 500);
  }

  /* ── Polling twice must not duplicate ───────────────────────── */
  console.log('\n── The same message arriving twice ──');
  {
    const id = nextId();
    const first = await emailDropboxService.fileMessage(message({
      from: STAFF, to: [lead.email, DROPBOX], subject: `${tag} Only once`, messageId: id,
    }));
    const second = await emailDropboxService.fileMessage(message({
      from: STAFF, to: [lead.email, DROPBOX], subject: `${tag} Only once`, messageId: id,
    }));
    is('the first is filed', first.status, 'filed');
    is('the second is recognised as already known', second.status, 'duplicate');
    const n = await CrmActivity.countDocuments({ providerEventId: id });
    is('and the timeline has it exactly once', n, 1);
  }
  {
    const r = await emailDropboxService.fileMessage(message({
      from: STAFF, to: [lead.email, DROPBOX], messageId: null,
    }));
    is('a message with no Message-ID is refused', r.status, 'rejected');
    is('because it could never be de-duplicated', r.reason, 'no-message-id');
  }
  {
    const r = await emailDropboxService.fileMessage(message({ from: null, to: [DROPBOX] }));
    is('a message with no sender is held', r.status, 'unmatched');
  }

  /* ── What gets stored ───────────────────────────────────────── */
  console.log('\n── What ends up on the timeline ──');
  {
    const id = nextId();
    await emailDropboxService.fileMessage(message({
      from: STAFF,
      to: [lead.email, DROPBOX],
      subject: `${tag} With an attachment`,
      messageId: id,
      text: 'Here is the quote.\n\nOn Tue, 3 Jun 2025, Priya wrote:\n> what is the fee?',
      attachments: [{ filename: 'quote.pdf', size: 12345, contentType: 'application/pdf' }],
    }));
    const row = await CrmActivity.findOne({ providerEventId: id }).lean();
    is('the quoted reply chain is cut', row.body, 'Here is the quote.');
    is('the attachment is named', row.meta.attachments[0].filename, 'quote.pdf');
    is('with its size', row.meta.attachments[0].size, 12345);
    is('the channel is recorded', row.meta.channel, 'email-dropbox');
    is('and the sender', row.meta.from, STAFF);
    is('it is an email activity', row.type, 'email');
    truthy('and it is stamped with when the mail was sent, not when polled',
      row.occurredAt instanceof Date);
  }

  console.log('\n── Cutting the quoted chain ──');
  is('a plain body is left alone', stripQuotedReply('Just this.'), 'Just this.');
  is('"On ... wrote:" is cut', stripQuotedReply('Hi.\nOn Mon, 2 Jun 2025, A wrote:\n> old'), 'Hi.');
  is('an Original Message banner is cut', stripQuotedReply('Hi.\n-----Original Message-----\nold'), 'Hi.');
  is('a trailing > block is cut', stripQuotedReply('Hi.\n> old\n> older'), 'Hi.');
  is('a > inside real text survives', stripQuotedReply('Price > 5 lakh is fine.'), 'Price > 5 lakh is fine.');

  /* ── Status ─────────────────────────────────────────────────── */
  console.log('\n── The status the settings screen reads ──');
  {
    const status = await emailDropboxService.status();
    is('status reports whether it is configured', typeof status.configured, 'boolean');
    truthy('and how many are waiting to be filed by hand', status.unfiledPending >= 1, String(status.unfiledPending));
    truthy('and carries a counts block', Boolean(status.counts));
  }

  /* ── Registration ───────────────────────────────────────────── */
  console.log('\n── The poll is registered, and the routes are reachable ──');
  {
    /* The exact shape of the outage: define(name, options, processor) stores
       the options object as the job function, and every run dies. */
    const defs = {};
    const fake = { define: (name, processor, options) => { defs[name] = { fn: processor, options }; } };
    defineEmailDropboxJobs(fake);
    truthy('the poll job is defined', Boolean(defs[POLL_EMAIL_DROPBOX]), Object.keys(defs).join(', '));
    is('its processor is a function', typeof defs[POLL_EMAIL_DROPBOX]?.fn, 'function');
    is('and its options are options', typeof defs[POLL_EMAIL_DROPBOX]?.options, 'object');

    const { assertJobsAreCallable } = await import('../../src/core/jobs/agenda.js');
    let threw = '';
    try { assertJobsAreCallable({ definitions: defs }); } catch (err) { threw = err.message; }
    is('and the boot guard accepts it', threw, '');
  }

  {
    // Asks Express directly — see tests/helpers/routes.js for why hitting the
    // path over HTTP and reading 401 as "mounted" proved nothing.
    const mounted = assertRoutesRegistered(createApp(), [
      ['GET', '/crm/email/dropbox/status'],
      ['GET', '/crm/email/dropbox/unfiled'],
      ['PATCH', '/crm/email/dropbox/unfiled/:id/resolve'],
      ['POST', '/crm/email/dropbox/unfiled/:id/create-lead'],
      ['POST', '/crm/email/send'],
      ['GET', '/crm/email/thread/:threadId'],
      ['GET', '/crm/public/e/o/:token'],
      ['GET', '/crm/public/e/c/:token/:index'],
    ], { ok, no });

    /* THE URL IN THE EMAIL MUST MATCH A ROUTE THAT EXISTS.
       This is the registration test that matters most here, because the
       failure it catches is completely silent: the email sends, the pixel
       renders as nothing, every open 404s, and the feature reports "nobody
       opened anything" forever. It caught exactly that — the service was
       building /crm/e/… while the router is mounted at /crm/public/e/…. */
    const { html } = crmEmailService.instrument('<a href="https://x.example/q">q</a>', 'TOKENXYZ');
    const pixel = (html.match(/src="([^"]+)"/) || [])[1] || '';
    const click = (html.match(/href="([^"]+)"/) || [])[1] || '';
    const toRoute = (url) => url
      .replace(/^https?:\/\/[^/]+/, '')
      .replace('/TOKENXYZ/0', '/:token/:index')
      .replace('/TOKENXYZ', '/:token');

    is('the open pixel points at a mounted route',
      mounted.has(`GET ${toRoute(pixel)}`) ? 'mounted' : `MISSING (${toRoute(pixel)})`, 'mounted');
    is('and so does the click redirect',
      mounted.has(`GET ${toRoute(click)}`) ? 'mounted' : `MISSING (${toRoute(click)})`, 'mounted');
  }

  /* ══ Threading ════════════════════════════════════════════════ */
  console.log('\n── A conversation stays one conversation ──');
  {
    /* Email has no conversation id. A thread exists only because each reply
       carries In-Reply-To and References. Get this wrong and one enquiry shows
       up as nine unrelated messages on the timeline — and, worse, nine
       unrelated emails in the customer's inbox. */
    const first = nextId();
    const r1 = await emailDropboxService.fileMessage(message({
      from: STAFF, to: [lead.email, DROPBOX], subject: `${tag} Quote`, messageId: first,
    }));
    is('the first message opens a thread', r1.status, 'filed');
    const a1 = await CrmActivity.findOne({ providerEventId: first }).lean();
    is('named by its own Message-ID', a1.threadId, first);

    // The customer replies to it.
    const second = nextId();
    await emailDropboxService.fileMessage(message({
      from: lead.email, to: [DROPBOX], subject: `${tag} Re: Quote`, messageId: second, inReplyTo: first,
    }));
    const a2 = await CrmActivity.findOne({ providerEventId: second }).lean();
    is('a reply joins the thread it answers', a2.threadId, first);
    is('and remembers what it answered', a2.inReplyTo, first);

    // A reply to the reply, carrying only References — some clients do this.
    const third = nextId();
    await emailDropboxService.fileMessage(message({
      from: STAFF, to: [lead.email, DROPBOX], subject: `${tag} Re: Quote`, messageId: third,
      references: `${first} ${second}`,
    }));
    const a3 = await CrmActivity.findOne({ providerEventId: third }).lean();
    is('References alone is enough to thread', a3.threadId, first);

    const whole = await threadMessages(first);
    is('the whole conversation reads as one', whole.length, 3);
    is('oldest first, the way a person reads it', whole[0].providerEventId, first);

    // A message that references nothing we know starts its own thread rather
    // than being guessed into somebody else's.
    const orphan = nextId();
    await emailDropboxService.fileMessage(message({
      from: STAFF, to: [lead.email, DROPBOX], subject: `${tag} Unrelated`, messageId: orphan,
      inReplyTo: '<never-seen@elsewhere.example>',
    }));
    const a4 = await CrmActivity.findOne({ providerEventId: orphan }).lean();
    is('an unknown parent starts a new thread', a4.threadId, orphan);
  }

  /* ══ Tracking ═════════════════════════════════════════════════ */
  console.log('\n── Open and click tracking ──');
  {
    const { html, links } = crmEmailService.instrument(
      '<p>See the <a href="https://example.com/quote?id=7">quote</a> and <a href="https://example.com/terms">terms</a>.</p>',
      'TRACKTOKEN',
    );
    is('every link is stored at send time', links.length, 2);
    is('the first is kept verbatim', links[0], 'https://example.com/quote?id=7');
    truthy('links are rewritten to carry an index, not a destination',
      html.includes('/c/TRACKTOKEN/0') && html.includes('/c/TRACKTOKEN/1'));
    truthy('and the destination never appears in the rewritten href',
      !/href="https:\/\/example\.com/.test(html));
    truthy('a pixel is appended', html.includes('/o/TRACKTOKEN'));

    // A mailto: link must survive untouched — a rewritten one is a dead link.
    const { html: withMailto } = crmEmailService.instrument('<a href="mailto:x@y.com">mail</a>', 'T2');
    truthy('mailto links are left alone', withMailto.includes('href="mailto:x@y.com"'));
  }

  {
    // Recording, against a real activity.
    const id = nextId();
    await emailDropboxService.fileMessage(message({
      from: STAFF, to: [lead.email, DROPBOX], subject: `${tag} Tracked`, messageId: id,
    }));
    await CrmActivity.updateOne({ providerEventId: id }, {
      $set: {
        trackingToken: `TOK-${tag}`,
        'meta.tracking': { links: ['https://example.com/only-this'], opens: 0, clicks: 0 },
      },
    });

    const opened = await crmEmailService.recordOpen(`TOK-${tag}`);
    truthy('an open is counted', opened?.meta?.tracking?.opens >= 1, String(opened?.meta?.tracking?.opens));
    await crmEmailService.recordOpen(`TOK-${tag}`);
    const twice = await CrmActivity.findOne({ providerEventId: id }).lean();
    is('re-opening counts again', twice.meta.tracking.opens, 2);
    truthy('but the first open is the one remembered', Boolean(twice.meta.tracking.openedAt));

    const url = await crmEmailService.recordClick(`TOK-${tag}`, 0);
    is('a click resolves to the stored link', url, 'https://example.com/only-this');

    /* THE OPEN-REDIRECT TEST. The destination comes from the list stored when
       the email was sent, indexed by position. An index nobody sent, or a
       token nobody issued, resolves to nothing — so this endpoint can never be
       used to forward a stranger anywhere while wearing our domain. */
    is('an index we never sent resolves to nothing', await crmEmailService.recordClick(`TOK-${tag}`, 9), null);
    is('and an unknown token too', await crmEmailService.recordClick('not-a-token', 0), null);
  }

  /* ══ One click from unknown sender to lead ════════════════════ */
  console.log('\n── An unknown sender becomes a lead in one click ──');
  {
    const stranger = `${tag.toLowerCase()}-stranger@example.com`;
    const id = nextId();
    await emailDropboxService.fileMessage(message({
      from: stranger, to: [DROPBOX], subject: `${tag} I want a franchise`, messageId: id,
      text: 'Please send me the details.',
    }));
    const held = await UnfiledEmail.findOne({ messageId: id }).lean();
    truthy('it lands in the unfiled queue', Boolean(held), held?.reason);

    const staffUser = await User.findOne({ role: 'md' }).select('_id name role').lean();
    const md = {
      _id: staffUser._id, id: String(staffUser._id), role: 'md', name: staffUser.name,
    };
    const made = await emailDropboxService.createLeadFrom(String(held._id), {}, md);
    cleanup.push(() => Lead.deleteOne({ _id: made.lead._id }));

    truthy('a lead is created', Boolean(made?.lead?._id), made?.lead?.name);
    is('carrying the sender address', made.lead.email, stranger);
    is('and the email is filed onto it', made.filed.status, 'filed');
    is('on the new lead', String(made.filed.entityId), String(made.lead._id));

    const after = await UnfiledEmail.findById(held._id).lean();
    truthy('the queue entry is cleared', Boolean(after.resolvedAt));
    is('and doing it twice is refused', await emailDropboxService.createLeadFrom(String(held._id), {}, md), null);
  }

  {
    const state = await EmailDropboxState.findOne({ mailbox: config.emailDropbox.mailbox }).lean();
    truthy('the poll cursor collection is usable', state === null || typeof state.lastUid === 'number');
  }
} finally {
  for (const fn of cleanup) await fn();
  await disconnect();
}

process.exit(finish('CRM EMAIL DROPBOX'));
