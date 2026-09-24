import { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Search, Plus, Inbox, AlertTriangle, RefreshCw, Repeat, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Badge, EmptyState, Avatar } from '../../components/ui/primitives.jsx';
import { useLeads, useCrmOptions } from '../../app/api/crmApi.js';
import { NewLeadModal } from './NewLeadModal.jsx';
import { LeadDrawer } from './LeadDrawer.jsx';
import './crm.css';

/**
 * Every enquiry, from every source.
 *
 * FILTERS LIVE IN THE URL, not in component state. Three reasons, all of them
 * about how this page is actually used: a dashboard tile can link straight to
 * a filtered view, an agent can send "look at these" to their manager, and the
 * back button works. Filter state held in `useState` does none of that.
 *
 * PHONE NUMBERS ARRIVE MASKED. The server does the masking, not this page —
 * the list is where a customer database gets copied out one screenshot at a
 * time, and the real number is only in the record you deliberately opened.
 */

const STATUS_TONE = {
  new: 'var(--primary)',
  contacted: '#3b82f6',
  qualified: '#10b981',
  converted: '#059669',
  disqualified: 'var(--text-subtle)',
};

const timeAgo = (date) => {
  const mins = Math.floor((Date.now() - new Date(date).getTime()) / 60_000);
  if (mins < 60) return `${Math.max(mins, 1)}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
};

export function LeadListPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);

  const { data: options } = useCrmOptions();

  const query = {
    status: params.get('status') || undefined,
    source: params.get('source') || undefined,
    assignedTo: params.get('assignedTo') || undefined,
    unworked: params.get('unworked') || undefined,
    search: params.get('search') || undefined,
    sort: params.get('sort') || undefined,
    page: params.get('page') || undefined,
  };
  const { data, isFetching, isError, refetch } = useLeads(query);

  /** Change one filter, and always reset to page 1 — staying on page 4 of a
   *  narrower result set shows an empty table and reads as "no results". */
  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    next.delete('page');
    setParams(next, { replace: true });
  };

  const openId = params.get('open');

  /** The screen-pop's "Add as lead" carries the caller's number here, so
   *  the form opens with it already filled in rather than asking the agent
   *  to retype what was on screen a second ago. */
  const prefillPhone = params.get('new');
  const closeDrawer = () => setFilter('open', '');

  /** The heading says which question is being asked. A filtered list whose
   *  title still reads "Leads" is how people misread 12 rows as everything. */
  const heading = query.unworked ? 'Never contacted'
    : query.assignedTo === 'unassigned' ? 'Unassigned leads'
      : query.status ? `${query.status[0].toUpperCase()}${query.status.slice(1)} leads`
        : query.source ? `Leads from ${query.source.replace(/_/g, ' ')}`
          : 'Leads';

  const hasFilters = Boolean(
    query.status || query.source || query.assignedTo || query.unworked || query.search,
  );

  return (
    <>
      <Topbar
        title={heading}
        actions={(
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            <Plus size={16} /> New lead
          </button>
        )}
      />

      <div className="content col gap-4">
        {/* ── Filter bar ─────────────────────────────────────── */}
        <div className="crm-toolbar">
          <label className="crm-search">
            <Search size={15} aria-hidden />
            <input
              className="crm-search__input"
              placeholder="Search name, company, city, phone…"
              defaultValue={query.search || ''}
              // On Enter, not on every keystroke: this is a server query, and
              // firing one per character makes the list flicker while it lands.
              onKeyDown={(e) => { if (e.key === 'Enter') setFilter('search', e.currentTarget.value.trim()); }}
              aria-label="Search leads"
            />
          </label>

          <select
            className="crm-select" value={query.status || ''}
            onChange={(e) => setFilter('status', e.target.value)} aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            {(options?.statuses || []).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>

          <select
            className="crm-select" value={query.source || ''}
            onChange={(e) => setFilter('source', e.target.value)} aria-label="Filter by source"
          >
            <option value="">All sources</option>
            {(options?.sources || []).map((s) => (
              <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
            ))}
          </select>

          <select
            className="crm-select" value={query.sort || 'newest'}
            onChange={(e) => setFilter('sort', e.target.value)} aria-label="Sort"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="updated">Recently updated</option>
            <option value="name">By name</option>
          </select>

          <button
            type="button" className="btn btn-ghost btn-icon"
            onClick={refetch} title="Refresh" aria-label="Refresh"
          >
            <RefreshCw size={15} className={isFetching ? 'crm-spin' : undefined} />
          </button>
      </div>

      {hasFilters && (
        <div className="crm-activefilters">
          <span className="crm-muted">
            {data ? `${data.total} matching` : 'Filtering'}
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setParams({}, { replace: true })}>
            Clear filters
          </button>
        </div>
      )}

      {/* ── The rows ───────────────────────────────────────── */}
      {isError ? (
        <EmptyState
          icon={AlertTriangle}
          title="That list could not be loaded"
          hint="The server refused the request. Try clearing the filters."
        />
      ) : !data ? (
        <div className="sm muted" style={{ padding: 24 }}>Loading…</div>
      ) : !data.items.length ? (
        <EmptyState
          icon={Inbox}
          title={hasFilters ? 'Nothing matches those filters' : 'No leads yet'}
          hint={hasFilters
            ? 'Try clearing one of them.'
            : 'Leads captured from a web form, a Meta ad, or entered by hand will appear here.'}
        />
      ) : (
        <>
          <div className="crm-rows">
            {data.items.map((lead) => (
              <button
                type="button"
                key={lead._id}
                className="crm-row"
                onClick={() => setFilter('open', lead._id)}
              >
                <Avatar name={lead.name} size={32} />

                <span className="crm-row__who">
                  <strong>{lead.name}</strong>
                  <span className="crm-muted">
                    {[lead.company, lead.city].filter(Boolean).join(' · ') || '—'}
                  </span>
                </span>

                <span className="crm-row__contact crm-muted">{lead.phone || lead.email || '—'}</span>

                <span className="crm-row__tags">
                  <Badge color={STATUS_TONE[lead.status]} soft="var(--surface-2)">{lead.status}</Badge>
                  <Badge color="var(--text-subtle)" soft="var(--surface-2)">
                    {String(lead.source || '').replace(/_/g, ' ')}
                  </Badge>
                  {lead.reEnquiryCount > 0 && (
                    <Badge color="var(--primary)" soft="var(--surface-2)">
                      <Repeat size={11} aria-hidden /> {lead.reEnquiryCount + 1}×
                    </Badge>
                  )}
                  {/* The one status worth calling out in a list: assigned, and
                      still never touched. */}
                  {!lead.firstActivityAt && lead.assignedAt && (
                    <Badge color="#dc2626" soft="var(--surface-2)">never contacted</Badge>
                  )}
                </span>

                <span className="crm-row__owner">
                  {lead.assignedTo?.name || <span className="crm-muted">Unassigned</span>}
                </span>

                <span className="crm-muted crm-row__when">{timeAgo(lead.createdAt)}</span>
              </button>
            ))}
          </div>

          {data.pages > 1 && (
            <div className="crm-pager">
              <button
                type="button" className="btn btn-subtle btn-sm"
                disabled={data.page <= 1}
                onClick={() => setParams((p) => {
                  const n = new URLSearchParams(p); n.set('page', String(data.page - 1)); return n;
                }, { replace: true })}
              >
                <ChevronLeft size={14} /> Previous
              </button>
              <span className="crm-muted">Page {data.page} of {data.pages}</span>
              <button
                type="button" className="btn btn-subtle btn-sm"
                disabled={data.page >= data.pages}
                onClick={() => setParams((p) => {
                  const n = new URLSearchParams(p); n.set('page', String(data.page + 1)); return n;
                }, { replace: true })}
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          )}
        </>
      )}

      <NewLeadModal
        open={adding || Boolean(prefillPhone)}
        phone={prefillPhone || undefined}
        onClose={() => { setAdding(false); if (prefillPhone) setFilter('new', ''); }}
        onCreated={(res) => res?.lead?._id && setFilter('open', res.lead._id)}
      />
      </div>

      <LeadDrawer id={openId} onClose={closeDrawer} onGone={() => navigate('/crm/leads')} />
    </>
  );
}

export default LeadListPage;
