import { useEffect, useState } from 'react';
import {
  Send, Copy, Check, Link2, X, RefreshCw, MessageCircle, Mail, ExternalLink, UserPlus,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { Badge } from '../../components/ui/primitives.jsx';
import { fmtDate } from '../../lib/format.js';
import {
  useGetOutsourceLinksQuery,
  useCreateOutsourceLinkMutation,
  useRecordOutsourceSendMutation,
  useRevokeOutsourceLinkMutation,
  useRegenerateOutsourceLinkMutation,
} from '../../app/api/outsourceApi.js';

/**
 * "Outsourcing this? Send it to a designer."
 *
 * Mystery Rooms does not always draw its own designs — the front elevations
 * and the working drawings are routinely done by an architect with no login
 * and no reason to ever have one. This is how that person gets the work: a
 * link, sent by WhatsApp or email, that opens the brief and takes their
 * uploads straight into this list.
 *
 * Written for whoever is standing on the phase page with a designer's number
 * in their phone. Three things, in the order they are needed:
 *
 *   1. Who is it going to?   → name, mobile, email, and a line of instruction
 *   2. Send it               → WhatsApp, email, or copy the link
 *   3. Did anything happen?  → sent / opened / delivered, per person
 *
 * The mobile and email are captured even when the link is copied by hand,
 * because they are what the WhatsApp channel will use to chase this person
 * later without anybody re-typing a number out of a chat window.
 */

const STATE_TONE = {
  'not sent': { label: 'Not sent yet', soft: 'var(--surface-2)' },
  sent: { label: 'Sent', color: 'var(--info, #2563EB)', soft: 'var(--info-soft, #DBEAFE)' },
  opened: { label: 'Opened it', color: 'var(--warning)', soft: 'var(--warning-soft)' },
  delivered: { label: 'Work received', color: 'var(--success)', soft: 'var(--success-soft)' },
  expired: { label: 'Expired', soft: 'var(--surface-2)' },
  revoked: { label: 'Turned off', color: 'var(--danger)', soft: 'var(--danger-soft, #FEE2E2)' },
};

/** Only digits reach a wa.me URL, and an Indian mobile needs its country code. */
function waNumber(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `91${digits}`;
  return digits.replace(/^0+/, '');
}

export function OutsourcePanel({ projectId, projectName, stageKey, group, task, canInvite, openInvite = 0 }) {
  const { data } = useGetOutsourceLinksQuery({ projectId, stageKey }, { skip: !projectId });
  const all = data?.data || data || [];
  // One panel per list, so it only shows the people invited to THIS work.
  const links = all.filter((l) => (group ? l.groupKey === group.key : !l.groupKey));

  const [inviting, setInviting] = useState(false);
  const [fresh, setFresh] = useState(null); // { link, url } — shown once, right after creating
  /* A page can open the invite from its own button (the task page puts
     "Send to an outside designer" at the top): each bump of `openInvite`
     opens the form once. */
  useEffect(() => {
    if (openInvite && canInvite) { setFresh(null); setInviting(true); }
  }, [openInvite, canInvite]);

  if (!canInvite && links.length === 0) return null;

  return (
    <div className="os-panel">
      <div className="os-head">
        <span className="os-title"><UserPlus size={13} /> Outside designer</span>
        {canInvite && (
          <button type="button" className="btn btn-subtle btn-sm" onClick={() => { setFresh(null); setInviting(true); }}>
            <Send size={12} /> Send this to a designer
          </button>
        )}
      </div>

      {links.length === 0 ? (
        <p className="os-empty">
          Not outsourced. Send a link and an outside architect can read the brief —
          the site’s area, its city and the games planned for it — and upload their
          work straight into this list, with no login.
        </p>
      ) : (
        <ul className="os-list">
          {links.map((l) => <LinkRow key={l._id} link={l} canInvite={canInvite} />)}
        </ul>
      )}

      {inviting && (
        <InviteModal
          projectId={projectId}
          projectName={projectName}
          stageKey={stageKey}
          group={group}
          task={task}
          onClose={() => setInviting(false)}
          onCreated={(result) => { setFresh(result); setInviting(false); }}
        />
      )}

      {fresh && (
        <ShareModal
          url={fresh.url}
          link={fresh.link}
          projectName={projectName}
          listName={group?.label}
          onClose={() => setFresh(null)}
        />
      )}
    </div>
  );
}

/** One invited person: where it stands, and the controls that change that. */
function LinkRow({ link, canInvite }) {
  const [revoke, revokeState] = useRevokeOutsourceLinkMutation();
  const [regenerate, regenState] = useRegenerateOutsourceLinkMutation();
  const [reshare, setReshare] = useState(null);
  const tone = STATE_TONE[link.state] || STATE_TONE['not sent'];
  const last = link.sends?.[link.sends.length - 1];

  return (
    <li className="os-row">
      <span className="os-who">
        <span className="os-name">{link.contact?.name}</span>
        {link.contact?.company && <span className="os-firm">{link.contact.company}</span>}
        <span className="os-meta">
          {link.contact?.phone && <span>{link.contact.phone}</span>}
          {link.contact?.email && <span>{link.contact.email}</span>}
        </span>
      </span>

      <span className="os-state">
        <Badge color={tone.color} soft={tone.soft}>{tone.label}</Badge>
        <span className="tiny muted">
          {link.records?.length
            ? `${link.records.length} received`
            : link.lastOpenedAt
              ? `opened ${fmtDate(link.lastOpenedAt)}`
              : last
                ? `${last.channel} · ${fmtDate(last.at)}`
                : `link runs out ${fmtDate(link.expiresAt)}`}
        </span>
      </span>

      {canInvite && (
        <span className="os-acts">
          {/* The token is not readable after it was created, so "send it
              again" mints a fresh one rather than pretending to recall it. */}
          <button
            type="button" className="btn btn-ghost btn-sm"
            disabled={regenState.isLoading}
            title="Issue a new link for this person. The previous one stops working."
            onClick={async () => {
              const r = await regenerate(link._id).unwrap();
              setReshare(r.data || r);
            }}
          >
            <RefreshCw size={12} /> New link
          </button>
          {link.state !== 'revoked' && (
            <button
              type="button" className="btn btn-ghost btn-sm"
              disabled={revokeState.isLoading}
              title="Turn this link off now"
              onClick={() => revoke(link._id)}
            >
              <X size={12} /> Turn off
            </button>
          )}
        </span>
      )}

      {reshare && (
        <ShareModal
          url={reshare.url}
          link={reshare.link || link}
          listName={null}
          onClose={() => setReshare(null)}
        />
      )}
    </li>
  );
}

/** Who is this going to, and what should they know before they start? */
function InviteModal({ projectId, projectName, stageKey, group, task, onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', company: '', phone: '', email: '', note: '', expiresInDays: 30 });
  const [create, { isLoading }] = useCreateOutsourceLinkMutation();
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      const r = await create({
        projectId,
        stageKey,
        groupKey: group?.key,
        taskId: task?._id,
        templateTaskKey: group?.taskKey,
        name: form.name.trim(),
        company: form.company.trim() || undefined,
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
        note: form.note.trim() || undefined,
        expiresInDays: Number(form.expiresInDays) || 30,
      }).unwrap();
      onCreated(r.data || r);
    } catch (err) {
      setError(err?.data?.message || err?.message || 'Could not create that link.');
    }
  };

  return (
    <Modal open title="Send this work to an outside designer" onClose={onClose} width={620}>
      <form className="col gap-3" onSubmit={submit}>
        <p className="os-note">
          They will see <strong>{group?.label || 'this phase'}</strong> for{' '}
          <strong>{projectName}</strong> — the site’s city, its area, the games planned
          for it and what to produce. They will not see anything else about the project.
        </p>

        <div className="os-grid">
          <div className="field">
            <label className="label">Their name *</label>
            <input className="input" value={form.name} onChange={set('name')} required placeholder="e.g. Anita Rao" />
          </div>
          <div className="field">
            <label className="label">Firm or studio</label>
            <input className="input" value={form.company} onChange={set('company')} placeholder="e.g. Rao Design Studio" />
          </div>
          <div className="field">
            <label className="label">Mobile</label>
            <input className="input" value={form.phone} onChange={set('phone')} placeholder="98765 43210" inputMode="tel" />
            <span className="tiny muted">Used to WhatsApp the link, and to reach them later.</span>
          </div>
          <div className="field">
            <label className="label">Email</label>
            <input className="input" type="email" value={form.email} onChange={set('email')} placeholder="anita@studio.com" />
          </div>
        </div>

        <div className="field">
          <label className="label">Anything they should know</label>
          <textarea
            className="textarea" rows={3} value={form.note} onChange={set('note')}
            placeholder="e.g. Corner unit with a glass frontage — please show two signage placements."
          />
        </div>

        <div className="field os-expiry">
          <label className="label">The link stops working after</label>
          <select className="input" value={form.expiresInDays} onChange={set('expiresInDays')}>
            <option value={7}>7 days</option>
            <option value={15}>15 days</option>
            <option value={30}>30 days</option>
            <option value={60}>60 days</option>
            <option value={90}>90 days</option>
          </select>
        </div>

        {error && <p className="os-error">{error}</p>}

        <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={isLoading || !form.name.trim()}>
            <Link2 size={14} /> {isLoading ? 'Creating…' : 'Create the link'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * The link, and the three ways to get it to the designer.
 *
 * Shown once. The server keeps only a hash of the token, so this modal is the
 * single moment the link exists in readable form — which is said on screen,
 * because a person who closes it expecting to find it again later will not.
 */
function ShareModal({ url, link, projectName, listName, onClose }) {
  const [copied, setCopied] = useState(false);
  const [noteSend] = useRecordOutsourceSendMutation();

  const message = [
    `Hello${link?.contact?.name ? ` ${link.contact.name}` : ''},`,
    '',
    `Design work for ${projectName || 'our new store'}${listName ? ` — ${listName}` : ''}.`,
    'The brief, the site area and the games planned for it are all on this link. You can upload your work there too:',
    url,
    '',
    link?.expiresAt ? `The link works until ${fmtDate(link.expiresAt)}.` : '',
    '— Mystery Rooms',
  ].filter(Boolean).join('\n');

  const note = (channel, to) => { if (link?._id) noteSend({ id: link._id, channel, to }).catch(() => {}); };

  const wa = waNumber(link?.contact?.phone);
  const mailto = `mailto:${link?.contact?.email || ''}?subject=${encodeURIComponent(`Design brief — ${projectName || 'Mystery Rooms'}`)}&body=${encodeURIComponent(message)}`;

  return (
    <Modal open title={`Link ready for ${link?.contact?.name || 'the designer'}`} onClose={onClose} width={620}>
      <div className="col gap-3">
        <p className="os-note">
          This is the only time the link is shown. Send it now — if it gets lost,
          press <strong>New link</strong> and a fresh one replaces it.
        </p>

        <div className="os-linkbox">
          <code className="os-url">{url}</code>
          <button
            type="button" className="btn btn-subtle btn-sm"
            onClick={async () => {
              try { await navigator.clipboard.writeText(url); } catch { /* an old browser, or no permission */ }
              setCopied(true);
              note('copied');
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}
          </button>
        </div>

        <div className="row gap-2 os-send">
          {wa ? (
            <a
              className="btn btn-primary" target="_blank" rel="noreferrer"
              href={`https://wa.me/${wa}?text=${encodeURIComponent(message)}`}
              onClick={() => note('whatsapp', link?.contact?.phone)}
            >
              <MessageCircle size={14} /> Send on WhatsApp
            </a>
          ) : (
            <span className="tiny muted">Add a mobile number to send this on WhatsApp.</span>
          )}
          {link?.contact?.email && (
            <a className="btn btn-subtle" href={mailto} onClick={() => note('email', link.contact.email)}>
              <Mail size={14} /> Email it
            </a>
          )}
          <a className="btn btn-ghost" href={url} target="_blank" rel="noreferrer">
            <ExternalLink size={14} /> See what they will see
          </a>
        </div>

        <details className="os-preview">
          <summary>The message that will be sent</summary>
          <pre>{message}</pre>
        </details>
      </div>
    </Modal>
  );
}

export default OutsourcePanel;
