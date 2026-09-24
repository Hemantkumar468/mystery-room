import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Search, Plus, Users, AlertTriangle, RefreshCw, PhoneOff, MessageSquare,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { EmptyState, Avatar, Badge } from '../../components/ui/primitives.jsx';
import { useContacts } from '../../app/api/crmApi.js';
import { ContactDrawer } from './ContactDrawer.jsx';
import { ContactFormModal } from './ContactFormModal.jsx';
import './crm.css';

/**
 * The people, as distinct from the enquiries.
 *
 * A lead is an event that closes once; a contact is a standing relationship
 * that outlives it. This list is therefore sorted by *recently touched* rather
 * than newest — the useful question here is "who am I dealing with", not "who
 * arrived last".
 *
 * Phone numbers arrive masked from the server. Opening the record shows the
 * real one, which is a deliberate act rather than something a screenshot of
 * this page hands over.
 */
export function ContactListPage() {
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(false);

  const query = {
    search: params.get('search') || undefined,
    company: params.get('company') || undefined,
    sort: params.get('sort') || undefined,
    page: params.get('page') || undefined,
  };
  const { data, isFetching, isError, refetch } = useContacts(query);

  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    next.delete('page');
    setParams(next, { replace: true });
  };

  const openId = params.get('open');

  return (
    <>
      <Topbar
        title="Contacts"
        actions={(
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            <Plus size={16} /> New contact
          </button>
        )}
      />

      <div className="content col gap-4">
        <div className="crm-toolbar">
          <label className="crm-search">
            <Search size={15} aria-hidden />
            <input
              className="crm-search__input"
              placeholder="Search name, email, phone, designation…"
              defaultValue={query.search || ''}
              onKeyDown={(e) => { if (e.key === 'Enter') setFilter('search', e.currentTarget.value.trim()); }}
              aria-label="Search contacts"
            />
          </label>

          <select
            className="crm-select" value={query.sort || 'updated'}
            onChange={(e) => setFilter('sort', e.target.value)} aria-label="Sort"
          >
            <option value="updated">Recently touched</option>
            <option value="name">By name</option>
          </select>

          <button
            type="button" className="btn btn-ghost btn-icon"
            onClick={refetch} title="Refresh" aria-label="Refresh"
          >
            <RefreshCw size={15} className={isFetching ? 'crm-spin' : undefined} />
          </button>
        </div>

        {isError ? (
          <EmptyState icon={AlertTriangle} title="That list could not be loaded" />
        ) : !data ? (
          <div className="sm muted" style={{ padding: 24 }}>Loading…</div>
        ) : !data.items.length ? (
          <EmptyState
            icon={Users}
            title={query.search ? 'Nobody matches that' : 'No contacts yet'}
            hint={query.search
              ? 'Try a different search.'
              : 'A qualified lead becomes a contact, or add one by hand.'}
          />
        ) : (
          <div className="crm-rows">
            {data.items.map((c) => (
              <button
                type="button" key={c._id} className="crm-row crm-row--contact"
                onClick={() => setFilter('open', c._id)}
              >
                <Avatar name={c.name} size={32} />

                <span className="crm-row__who">
                  <strong>{c.name}</strong>
                  <span className="crm-muted">
                    {[c.designation, c.company?.name].filter(Boolean).join(' · ') || '—'}
                  </span>
                </span>

                <span className="crm-row__contact crm-muted">{c.phone || c.email || '—'}</span>

                <span className="crm-row__tags">
                  {c.status === 'inactive' && (
                    <Badge color="var(--text-subtle)" soft="var(--surface-2)">inactive</Badge>
                  )}
                  {/* Two flags worth seeing without opening the record: one is
                      a compliance rule, the other decides whether a message
                      can legally be sent at all. */}
                  {c.doNotDisturb && (
                    <Badge color="#dc2626" soft="var(--surface-2)">
                      <PhoneOff size={11} aria-hidden /> do not call
                    </Badge>
                  )}
                  {c.whatsappOptIn && (
                    <Badge color="#10b981" soft="var(--surface-2)">
                      <MessageSquare size={11} aria-hidden /> opted in
                    </Badge>
                  )}
                </span>

                <span className="crm-row__owner">
                  {c.owner?.name || <span className="crm-muted">Unowned</span>}
                </span>

                <span className="crm-muted crm-row__when">{c.city || ''}</span>
              </button>
            ))}
          </div>
        )}

        {data?.pages > 1 && (
          <div className="crm-pager">
            <button
              type="button" className="btn btn-subtle btn-sm" disabled={data.page <= 1}
              onClick={() => setFilter('page', String(data.page - 1))}
            >
              Previous
            </button>
            <span className="crm-muted">Page {data.page} of {data.pages}</span>
            <button
              type="button" className="btn btn-subtle btn-sm" disabled={data.page >= data.pages}
              onClick={() => setFilter('page', String(data.page + 1))}
            >
              Next
            </button>
          </div>
        )}
      </div>

      <ContactFormModal open={adding} onClose={() => setAdding(false)} />
      <ContactDrawer id={openId} onClose={() => setFilter('open', '')} />
    </>
  );
}

export default ContactListPage;
