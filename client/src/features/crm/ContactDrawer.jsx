import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  X, Phone, Mail, MessageSquare, Building2, PhoneOff, Pencil, Briefcase, CalendarClock,
} from 'lucide-react';
import { Avatar, Badge, Spinner } from '../../components/ui/primitives.jsx';
import { useContact, useClickToCall } from '../../app/api/crmApi.js';
import { ContactFormModal } from './ContactFormModal.jsx';
import { CrmTimeline } from './CrmTimeline.jsx';

/**
 * One person, and everything attached to them.
 *
 * CLICK-TO-CALL IS THE PRIMARY ACTION and sits first, because the reason
 * somebody opens a contact is almost always to ring them. It rings the agent's
 * own phone first and shows the customer the company number — that masking is
 * the whole reason this is a button rather than a `tel:` link.
 *
 * The real phone number is shown here, unmasked. The list hides it; opening a
 * record is the deliberate act that reveals it.
 */

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', {
  day: 'numeric', month: 'short', year: 'numeric',
}) : '—');

export function ContactDrawer({ id, onClose }) {
  const { data, isLoading, isError } = useContact(id);
  const call = useClickToCall();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState(null);

  if (!id) return null;

  const contact = data?.contact;

  const ring = async () => {
    setError(null);
    try {
      await call.mutateAsync({ entityType: 'contact', entityId: id });
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not place that call.');
    }
  };

  return (
    <>
      <div className="crm-scrim" role="presentation" onClick={onClose} />

      <aside className="crm-drawer" aria-label="Contact details">
        <header className="crm-drawer__head">
          <div className="row gap-2" style={{ alignItems: 'center', minWidth: 0 }}>
            {contact && <Avatar name={contact.name} size={34} />}
            <div style={{ minWidth: 0 }}>
              <strong className="crm-drawer__name">{contact?.name || 'Contact'}</strong>
              {contact && (
                <div className="crm-muted crm-drawer__sub">
                  {[contact.designation, contact.company?.name].filter(Boolean).join(' · ') || 'No company recorded'}
                </div>
              )}
            </div>
          </div>
          <div className="row gap-1">
            {contact && (
              <button
                type="button" className="btn btn-ghost btn-icon"
                onClick={() => setEditing(true)} title="Edit" aria-label="Edit contact"
              >
                <Pencil size={16} />
              </button>
            )}
            <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </header>

        {isLoading && <div style={{ padding: 24 }}><Spinner label="Loading…" /></div>}
        {isError && (
          <div className="crm-drawer__body">
            <p className="crm-muted">That contact could not be opened — it may belong to someone else.</p>
          </div>
        )}

        {contact && (
          <div className="crm-drawer__body">
            {error && <div className="crm-form__error">{error}</div>}

            {/* Do Not Disturb replaces the call button rather than sitting
                beside it. A greyed-out button invites a click and an
                explanation; an absent one states the rule. */}
            {contact.doNotDisturb ? (
              <div className="crm-dnc">
                <PhoneOff size={15} aria-hidden />
                <span>
                  <strong>{contact.name} has asked not to be called.</strong>
                  <span className="crm-muted"> Calling them is blocked, not discouraged.</span>
                </span>
              </div>
            ) : (
              <div className="crm-drawer__contact">
                <button
                  type="button" className="btn btn-primary btn-sm"
                  onClick={ring} disabled={call.isPending || !contact.phone}
                >
                  <Phone size={14} /> {call.isPending ? 'Ringing you…' : 'Call'}
                </button>
                {contact.email && (
                  <a className="crm-chip" href={`mailto:${contact.email}`}>
                    <Mail size={14} aria-hidden /> {contact.email}
                  </a>
                )}
                {contact.phone && (
                  <a
                    className="crm-chip"
                    href={`https://wa.me/${contact.phone.replace(/\D/g, '')}`}
                    target="_blank" rel="noreferrer"
                  >
                    <MessageSquare size={14} aria-hidden /> WhatsApp
                  </a>
                )}
              </div>
            )}

            <dl className="crm-facts">
              <div>
                <dt>Phone</dt>
                <dd>{contact.phone || '—'}</dd>
              </div>
              <div>
                <dt>Owner</dt>
                <dd>{contact.owner?.name || 'Unowned'}</dd>
              </div>
              <div>
                <dt>City</dt>
                <dd>{contact.city || '—'}</dd>
              </div>
              <div>
                <dt>WhatsApp consent</dt>
                <dd>
                  {contact.whatsappOptIn ? (
                    <>
                      <Badge color="#10b981" soft="var(--surface-2)">opted in</Badge>
                      {/* When and how, not just whether — this is evidence
                          under Meta's policy and the DPDP Act, and a bare
                          "yes" evidences nothing. */}
                      <span className="crm-muted"> {fmtDate(contact.whatsappOptInAt)}</span>
                    </>
                  ) : <span className="crm-muted">not given</span>}
                </dd>
              </div>
            </dl>

            {data.sourceLead && (
              <p className="crm-muted">
                Came in as a lead via {data.sourceLead.source?.replace(/_/g, ' ')} on{' '}
                {fmtDate(data.sourceLead.createdAt)}.
              </p>
            )}

            {/* `contact.company`, not `data.company` — the detail payload
                returns the company populated ON the contact, and reading it
                from the wrong place made this link never render at all. */}
            {Boolean(contact.company?._id) && (
              <Link className="crm-chip" to={`/crm/companies?open=${contact.company._id}`}>
                <Building2 size={14} aria-hidden /> {contact.company.name}
              </Link>
            )}

            {Boolean(data.deals?.length) && (
              <section>
                <h3 className="crm-section__title"><Briefcase size={14} aria-hidden /> Deals</h3>
                <ul className="crm-minilist">
                  {data.deals.map((d) => (
                    <li key={d._id}>
                      <Link to={`/crm/pipeline?open=${d._id}`}>
                        <strong>{d.title}</strong>
                        <span className="crm-muted">
                          {d.value ? `₹${(d.value / 100000).toFixed(1)}L` : ''}
                          {d.closedAt ? ' · closed' : ''}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {Boolean(data.tasks?.length) && (
              <section>
                <h3 className="crm-section__title"><CalendarClock size={14} aria-hidden /> Open tasks</h3>
                <ul className="crm-minilist">
                  {data.tasks.map((t) => (
                    <li key={t._id}>
                      <span style={{ padding: '7px 8px', display: 'block' }}>
                        <strong>{t.title}</strong>
                        <span className="crm-muted"> · due {fmtDate(t.dueAt)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <h3 className="crm-section__title">History</h3>
            <CrmTimeline items={data.timeline} />
          </div>
        )}
      </aside>

      <ContactFormModal open={editing} contact={contact} onClose={() => setEditing(false)} />
    </>
  );
}

export default ContactDrawer;
