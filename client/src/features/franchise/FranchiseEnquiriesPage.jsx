/**
 * Every franchise enquiry — the queue. Waiting ones first by default; the
 * chips switch to what was approved (and the project each one became) or
 * rejected (and why). Click a row to read the whole enquiry and decide.
 */
import { useMemo } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { Search, Inbox, FolderKanban } from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { SectionCard, EmptyState, Badge } from '../../components/ui/primitives.jsx';
import { SkTable } from '../../components/ui/Skeletons.jsx';
import { useGetFranchiseEnquiriesQuery } from '../../app/api/franchiseApi.js';
import { fmtDate, fromNow } from '../../lib/format.js';
import { ENQUIRY_STATUS_META } from './franchiseUi.js';

const CHIPS = [
  { key: 'submitted', label: 'Awaiting decision' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All' },
];

export function FranchiseEnquiriesPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || 'submitted';
  const search = params.get('q') || '';
  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };
  const navigate = useNavigate();

  /* One unfiltered read: the chip counts need every status, and the list is
     capped at 200 server-side, so filtering here costs nothing. */
  const { data, isLoading } = useGetFranchiseEnquiriesQuery(undefined);
  const all = useMemo(() => data || [], [data]);
  const visible = all.filter((e) => {
    if (status !== 'all' && e.status !== status) return false;
    if (search) {
      const hay = [
        e.name, e.phone, e.email, e.background, e.investmentReady, e.interestCity,
        ...(e.properties || []).flatMap((p) => [p.label, p.city, p.locality, p.address]),
      ].join(' ').toLowerCase();
      if (!hay.includes(search.toLowerCase())) return false;
    }
    return true;
  });

  /* Where an applicant wants to be — first property's city, or their city of interest. */
  const cityOf = (e) => e.properties?.[0]?.city || e.interestCity || '—';

  return (
    <>
      <Topbar title="Franchise Enquiries" />
      <div className="content">
        <div className="content-narrow col gap-3 fade-in">
          <div className="row gap-2 wrap" style={{ alignItems: 'center' }}>
            <div className="input-icon-wrap grow" style={{ minWidth: 220, maxWidth: 380 }}>
              <Search size={15} className="input-icon" />
              <input className="input" placeholder="Search name, phone, city, locality…" value={search} onChange={(e) => setParam('q', e.target.value)} />
            </div>
            <div className="pt-chips" style={{ margin: 0 }} data-guide="fr-chips">
              {CHIPS.map((c) => (
                <button type="button" key={c.key} className={`pt-chip${status === c.key ? ' is-on' : ''}`} onClick={() => setParam('status', c.key === 'submitted' ? '' : c.key)}>
                  {c.label} <span>{c.key === 'all' ? all.length : all.filter((e) => e.status === c.key).length}</span>
                </button>
              ))}
            </div>
          </div>

          <SectionCard title={`Enquiries (${visible.length})`}>
            {isLoading ? <SkTable rows={5} /> : visible.length === 0 ? (
              <EmptyState
                icon={Inbox}
                title={status === 'submitted' ? 'Nothing waiting for a decision' : 'No enquiries here'}
                hint={all.length === 0 ? 'Share the enquiry link from the Overview — submissions land here.' : 'Try another filter or clear the search.'}
              />
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="table table-clickable" data-guide="fr-table">
                  <thead>
                    <tr><th>Applicant</th><th>City</th><th>Property</th><th>Investment</th><th>Received</th><th>Status</th><th>Decision</th></tr>
                  </thead>
                  <tbody>
                    {visible.map((e) => {
                      const m = ENQUIRY_STATUS_META[e.status] || {};
                      return (
                        <tr key={e._id} onClick={() => navigate(`/franchise/enquiries/${e._id}`)}>
                          <td>
                            <div className="col">
                              <span className="sm" style={{ fontWeight: 650 }}>{e.name}</span>
                              <span className="tiny muted">{e.phone}{e.email ? ` · ${e.email}` : ''}</span>
                            </div>
                          </td>
                          <td>
                            <div className="col">
                              <span className="sm">{cityOf(e)}</span>
                              {e.properties?.[0]?.locality && <span className="tiny muted">{e.properties[0].locality}</span>}
                            </div>
                          </td>
                          <td>
                            <div className="col">
                              {(e.properties || []).length > 0 ? (
                                <>
                                  <span className="sm">{e.properties.length} propert{e.properties.length === 1 ? 'y' : 'ies'}</span>
                                  <span className="tiny muted">
                                    {e.properties[0].carpetAreaSqft ? `${Number(e.properties[0].carpetAreaSqft).toLocaleString('en-IN')} sq ft` : ''}
                                    {e.properties.length > 1 ? ' + more' : ''}
                                  </span>
                                </>
                              ) : (
                                <span className="tiny muted">No property yet — interested</span>
                              )}
                            </div>
                          </td>
                          <td className="sm">{e.investmentReady || <span className="muted">—</span>}</td>
                          <td className="tiny muted" title={fmtDate(e.createdAt)}>{fromNow(e.createdAt)}</td>
                          <td><Badge color={m.color} soft={m.soft} dot>{m.label || e.status}</Badge></td>
                          <td className="tiny">
                            {e.status === 'submitted' && <span className="muted">Open the application to decide</span>}
                            {e.status === 'approved' && (
                              <span className="col">
                                <span>{e.decidedBy?.name || '—'} · {fmtDate(e.decidedAt)}</span>
                                {e.project && (
                                  <Link to={`/projects/${e.project._id || e.project}`} onClick={(ev) => ev.stopPropagation()} style={{ color: 'var(--primary)' }}>
                                    <FolderKanban size={11} /> {e.project.name || 'Open the project'}
                                  </Link>
                                )}
                              </span>
                            )}
                            {e.status === 'rejected' && (
                              <span className="col">
                                <span>{e.decidedBy?.name || '—'} · {fmtDate(e.decidedAt)}</span>
                                {e.rejectReason && <span className="muted truncate" style={{ maxWidth: 220 }} title={e.rejectReason}>{e.rejectReason}</span>}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </div>
      </div>

    </>
  );
}

export default FranchiseEnquiriesPage;
