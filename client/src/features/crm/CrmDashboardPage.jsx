import { useNavigate } from 'react-router-dom';
import {
  Inbox, UserX, Clock, Repeat, TrendingUp, Plus, AlertTriangle, ArrowRight,
} from 'lucide-react';
import { useState } from 'react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Badge, EmptyState, Avatar } from '../../components/ui/primitives.jsx';
import { useCrmDashboard } from '../../app/api/crmApi.js';
import { NewLeadModal } from './NewLeadModal.jsx';
import './crm.css';

/**
 * The CRM dashboard — what came in, and what has been ignored.
 *
 * ORDERED BY WHAT THE READER SHOULD DO, not by what is easiest to compute.
 * The two "needs attention" tiles come first and are the only coloured ones,
 * because they are the only numbers on the page that are a to-do list rather
 * than a statistic. A dashboard where the alarming number sits third, in the
 * same grey as everything else, is a dashboard people learn to scroll past.
 *
 * EVERY TILE IS A LINK. A count you cannot open is a poster: it tells you 14
 * leads are untouched and leaves you to go and find them by hand. Each one
 * navigates to the list with the same filter the count was computed from — the
 * server builds both from one query (see leadService.filtersToQuery), so the
 * tile and the rows it opens can never disagree.
 *
 * WHAT IS DELIBERATELY MISSING. No funnel, no leaderboard, no revenue. Those
 * are questions about deals, and deals do not exist yet — a funnel drawn from
 * an empty collection reads as a broken report, not as an honest "nothing
 * here". They arrive with the pipeline phase.
 */

const fmtMinutes = (m) => {
  if (m == null) return '—';
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
};

const timeAgo = (date) => {
  const mins = Math.floor((Date.now() - new Date(date).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
};

const STATUS_TONE = {
  new: 'var(--primary)',
  contacted: '#3b82f6',
  qualified: '#10b981',
  converted: '#059669',
  disqualified: 'var(--text-subtle)',
};

/** One number, and the list it opens. */
function Tile({
  icon: Icon, label, value, hint, tone, onClick, disabled,
}) {
  return (
    <button
      type="button"
      className={`crm-tile ${tone ? `crm-tile--${tone}` : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={`${label}: ${value}`}
    >
      <span className="crm-tile__icon"><Icon size={16} aria-hidden /></span>
      <span className="crm-tile__value">{value}</span>
      <span className="crm-tile__label">{label}</span>
      {hint && <span className="crm-tile__hint">{hint}</span>}
      {!disabled && <ArrowRight className="crm-tile__go" size={14} aria-hidden />}
    </button>
  );
}

export function CrmDashboardPage() {
  const navigate = useNavigate();
  const { data, isLoading, isError, refetch } = useCrmDashboard();
  const [adding, setAdding] = useState(false);

  const go = (params) => navigate(`/crm/leads?${new URLSearchParams(params)}`);

  if (isError) {
    return (
      <>
        <Topbar title="CRM" />
        <div className="content">
          <EmptyState
            icon={AlertTriangle}
            title="The dashboard could not be loaded"
            hint="The API refused the request. Check that you are still signed in."
            action={<button type="button" className="btn btn-subtle" onClick={refetch}>Try again</button>}
          />
        </div>
      </>
    );
  }

  const d = data || {};
  const attention = d.attention || {};
  const capture = d.capture || {};
  const sources = d.sources || [];
  const topSource = sources[0];

  return (
    <>
      <Topbar
        title="CRM"
        actions={(
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            <Plus size={16} /> New lead
          </button>
        )}
      />

      <div className="content col gap-4">
        {isLoading ? (
          <div className="sm muted" style={{ padding: 24 }}>Loading…</div>
        ) : (
          <>
            {/* ── What needs answering ─────────────────────────────
                First on the page and the only coloured tiles, because these are
                the only two numbers here that are somebody's outstanding work. */}
            <section className="crm-section">
              <h2 className="crm-section__title">Needs attention</h2>
              <div className="crm-tiles">
                {/* A zero here means one of two opposite things, and they must
                    not look alike: "0 of 40 — everyone is being worked" is good
                    news, "0 of 0 — nothing has been assigned long enough to
                    measure" is not news at all. An unmeasurable tile says so
                    with an em dash rather than a reassuring green zero. */}
                <Tile
                  icon={AlertTriangle}
                  tone={attention.unworked ? 'alert' : undefined}
                  label="Never contacted"
                  value={attention.unworkedMeasurable ? (attention.unworked ?? 0) : '—'}
                  hint={attention.unworkedMeasurable
                    ? `of ${attention.unworkedMeasurable} assigned over a day ago`
                    : 'nothing assigned long enough to judge yet'}
                  onClick={() => go({ unworked: 'true' })}
                  disabled={!attention.unworkedMeasurable}
                />
                {/* Only a manager can see this one: an agent's view is scoped to
                    their own leads, where an unassigned lead cannot appear, so
                    the tile would read 0 forever and mean nothing. */}
                {attention.unassigned != null && (
                  <Tile
                    icon={UserX}
                    tone={attention.unassigned ? 'alert' : undefined}
                    label="Unassigned"
                    value={attention.unassigned}
                    hint="Nobody owns these yet"
                    onClick={() => go({ assignedTo: 'unassigned' })}
                  />
                )}
                <Tile
                  icon={Clock}
                  label="Avg response time"
                  value={fmtMinutes(d.responseTime?.avgMinutes)}
                  // "nothing contacted yet" contradicted a BY STATUS panel
                  // showing 17 contacted and 21 qualified. Those statuses came
                  // in with an import and never had an activity logged against
                  // them, so this metric genuinely cannot see them — and the
                  // wording has to say that, not deny the statuses.
                  hint={d.responseTime?.measuredOn
                    ? `across ${d.responseTime.measuredOn} leads with a logged activity`
                    : 'no activity logged yet'}
                  disabled
                />
              </div>
            </section>

            {/* ── What came in ───────────────────────────────────── */}
            <section className="crm-section">
              <h2 className="crm-section__title">
                Captured
                <span className="crm-section__scope">
                  {d.scope === 'company' ? 'across the company' : 'assigned to you'}
                </span>
              </h2>
              <div className="crm-tiles">
                <Tile icon={Inbox} label="Today" value={capture.today ?? 0} onClick={() => go({ sort: 'newest' })} />
                <Tile icon={Inbox} label="Last 7 days" value={capture.last7 ?? 0} onClick={() => go({ sort: 'newest' })} />
                <Tile icon={Inbox} label="Last 30 days" value={capture.last30 ?? 0} onClick={() => go({ sort: 'newest' })} />
                <Tile
                  icon={Repeat}
                  label="Re-enquiries"
                  value={capture.reEnquiries ?? 0}
                  hint="Asked more than once — a buying signal"
                  onClick={() => go({ sort: 'newest' })}
                />
              </div>
            </section>

            <div className="crm-split">
              {/* ── Where it comes from ──────────────────────────── */}
              <section className="crm-card">
                <div className="crm-card__head">
                  <h2 className="crm-section__title"><TrendingUp size={15} aria-hidden /> Sources</h2>
                  {topSource && (
                    <span className="crm-muted">
                      {topSource.source.replace(/_/g, ' ')} leads
                    </span>
                  )}
                </div>

                {sources.length ? (
                  <ul className="crm-bars">
                    {sources.map((s) => {
                      const pct = capture.total ? Math.round((s.leads / capture.total) * 100) : 0;
                      return (
                        <li key={s.source}>
                          <button type="button" className="crm-bar" onClick={() => go({ source: s.source })}>
                            <span className="crm-bar__label">{s.source.replace(/_/g, ' ')}</span>
                            <span className="crm-bar__track">
                              {/* Width from the share, so the eye compares
                                  proportions rather than reading numbers. */}
                              <span className="crm-bar__fill" style={{ width: `${Math.max(pct, 2)}%` }} />
                            </span>
                            <span className="crm-bar__value">{s.leads}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="crm-muted">
                    Nothing captured yet. A web form or a manually entered lead will show up here.
                  </p>
                )}
              </section>

              {/* ── Where they are ───────────────────────────────── */}
              <section className="crm-card">
                <div className="crm-card__head">
                  <h2 className="crm-section__title">By status</h2>
                </div>
                <ul className="crm-statuses">
                  {Object.entries(d.status || {}).map(([status, n]) => (
                    <li key={status}>
                      <button type="button" className="crm-status" onClick={() => go({ status })}>
                        <Badge color={STATUS_TONE[status] || 'var(--text-subtle)'} soft="var(--surface-2)" dot>
                          {status}
                        </Badge>
                        <strong>{n}</strong>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            </div>

            {/* ── The latest enquiries ─────────────────────────────
                Eight rows, not a full list. This answers "what just came in",
                and the Leads page answers "show me all of them". */}
            <section className="crm-card">
              <div className="crm-card__head">
                <h2 className="crm-section__title">Latest enquiries</h2>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => go({})}>
                  See all <ArrowRight size={14} />
                </button>
              </div>

              {d.recent?.length ? (
                <div className="crm-recent">
                  {d.recent.map((lead) => (
                    <button
                      type="button"
                      key={lead._id}
                      className="crm-recent__row"
                      onClick={() => navigate(`/crm/leads?open=${lead._id}`)}
                    >
                      <Avatar name={lead.name} size={30} />
                      <span className="crm-recent__who">
                        <strong>{lead.name}</strong>
                        <span className="crm-muted">
                          {[lead.company, lead.city].filter(Boolean).join(' · ') || 'No company recorded'}
                        </span>
                      </span>
                      <span className="crm-recent__meta">
                        <Badge color={STATUS_TONE[lead.status]} soft="var(--surface-2)">{lead.status}</Badge>
                        {lead.reEnquiryCount > 0 && (
                          <Badge color="var(--primary)" soft="var(--surface-2)">
                            <Repeat size={11} aria-hidden /> {lead.reEnquiryCount + 1}×
                          </Badge>
                        )}
                      </span>
                      <span className="crm-recent__owner">
                        {lead.assignedTo?.name || <span className="crm-muted">Unassigned</span>}
                      </span>
                      <span className="crm-muted crm-recent__when">{timeAgo(lead.createdAt)}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={Inbox}
                  title="No enquiries yet"
                  hint="Leads captured from a web form, a Meta ad, or entered by hand will appear here."
                />
              )}
            </section>
          </>
        )}

      </div>

      <NewLeadModal open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

export default CrmDashboardPage;
