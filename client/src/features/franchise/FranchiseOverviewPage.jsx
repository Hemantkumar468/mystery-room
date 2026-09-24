/**
 * Franchising at a glance: how many enquiries are waiting for a yes or no,
 * how many became projects, which cities are asking, the newest arrivals —
 * and the one link to share with the next prospect.
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Inbox, CheckCircle2, XCircle, MapPinned, ArrowRight, Copy, Share2, Store } from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { SectionCard, EmptyState, Badge } from '../../components/ui/primitives.jsx';
import { SkCharts } from '../../components/ui/Skeletons.jsx';
import { useGetFranchiseEnquiriesQuery } from '../../app/api/franchiseApi.js';
import { fromNow } from '../../lib/format.js';
import { ENQUIRY_STATUS_META, franchiseEnquiryLink } from './franchiseUi.js';
import { EnquiryModal } from './EnquiryModal.jsx';

function Stat({ icon: Icon, label, value, tone, to }) {
  const navigate = useNavigate();
  const Tag = to ? 'button' : 'div';
  return (
    <Tag type={to ? 'button' : undefined} className={`fr-stat${to ? ' is-link' : ''}`} onClick={to ? () => navigate(to) : undefined}>
      <span className="fr-stat-icon" style={{ color: tone, background: `color-mix(in srgb, ${tone} 12%, transparent)` }}>
        <Icon size={16} />
      </span>
      <div className="col">
        <span className="fr-stat-value">{value}</span>
        <span className="fr-stat-label">{label}</span>
      </div>
    </Tag>
  );
}

export function FranchiseOverviewPage() {
  const { data, isLoading } = useGetFranchiseEnquiriesQuery(undefined);
  const [open, setOpen] = useState(null);
  const [copied, setCopied] = useState(false);
  const link = franchiseEnquiryLink();

  const all = useMemo(() => data || [], [data]);
  const counts = useMemo(() => ({
    submitted: all.filter((e) => e.status === 'submitted').length,
    approved: all.filter((e) => e.status === 'approved').length,
    rejected: all.filter((e) => e.status === 'rejected').length,
  }), [all]);
  const byCity = useMemo(() => {
    const m = new Map();
    for (const e of all) {
      const key = (e.city || '—').trim();
      const g = m.get(key) || { city: key, total: 0, submitted: 0, approved: 0, rejected: 0 };
      g.total += 1; g[e.status] = (g[e.status] || 0) + 1;
      m.set(key, g);
    }
    return [...m.values()].sort((a, b) => b.submitted - a.submitted || b.total - a.total);
  }, [all]);
  const recent = all.slice(0, 8);

  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* the link is visible to select */ }
  };
  const share = () => {
    const text = `Open a Mystery Rooms in your city — tell us about yourself and your property here: ${link}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  };

  if (isLoading) {
    return (<><Topbar title="Franchise Overview" /><div className="content"><SkCharts /></div></>);
  }

  return (
    <>
      <Topbar title="Franchise Overview" subtitle="Who wants in, where, and what has been decided" />
      <div className="content">
        <div className="content-narrow col gap-4 fade-in">
          <div className="fr-stat-grid">
            <Stat icon={Inbox} label="Awaiting decision" value={counts.submitted} tone={counts.submitted ? 'var(--warning)' : 'var(--text-subtle)'} to="/franchise/enquiries?status=submitted" />
            <Stat icon={CheckCircle2} label="Approved — projects created" value={counts.approved} tone="var(--success)" to="/franchise/enquiries?status=approved" />
            <Stat icon={XCircle} label="Rejected" value={counts.rejected} tone="var(--danger)" to="/franchise/enquiries?status=rejected" />
            <Stat icon={MapPinned} label="Cities asking" value={byCity.filter((c) => c.city !== '—').length} tone="var(--primary)" />
          </div>

          <SectionCard title="Share the enquiry link" subtitle="Anyone who opens it can tell us about their property — no login. Every submission lands in the queue below.">
            <div className="col gap-2">
              <div className="fr-link" data-guide="fr-link">
                <Share2 size={14} />
                <code>{link}</code>
                <button type="button" className="btn btn-subtle btn-sm" onClick={copy}><Copy size={12} /> {copied ? 'Copied' : 'Copy'}</button>
                <button type="button" className="btn btn-primary btn-sm" onClick={share}>Share on WhatsApp</button>
              </div>
            </div>
          </SectionCard>

          <div className="row gap-4 wrap" style={{ alignItems: 'flex-start' }}>
            <SectionCard
              title="Newest enquiries"
              subtitle="Click one to read it and decide"
              style={{ flex: '1.4 1 360px' }}
              action={<Link className="tbrief-link" to="/franchise/enquiries">All enquiries <ArrowRight size={12} /></Link>}
            >
              {recent.length ? (
                <div className="col">
                  {recent.map((e) => {
                    const m = ENQUIRY_STATUS_META[e.status] || {};
                    return (
                      <button type="button" key={e._id} className="fr-recent-row" onClick={() => setOpen(e)}>
                        <div className="col" style={{ minWidth: 0 }}>
                          <span className="sm truncate" style={{ fontWeight: 600 }}>{e.name} · {e.city}{e.locality ? `, ${e.locality}` : ''}</span>
                          <span className="tiny muted truncate">{e.carpetAreaSqft ? `${Number(e.carpetAreaSqft).toLocaleString('en-IN')} sq ft · ` : ''}{fromNow(e.createdAt)}</span>
                        </div>
                        <Badge color={m.color} soft={m.soft} dot>{m.label || e.status}</Badge>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <EmptyState icon={Store} title="No enquiries yet" hint="Share the link above — the first submission appears here." />
              )}
            </SectionCard>

            <SectionCard title="By city" subtitle="Where the interest is" style={{ flex: '1 1 280px' }}>
              {byCity.length ? (
                <table className="table">
                  <thead><tr><th>City</th><th>Waiting</th><th>Approved</th><th>Rejected</th></tr></thead>
                  <tbody>
                    {byCity.map((c) => (
                      <tr key={c.city}>
                        <td><span className="sm" style={{ fontWeight: 600 }}>{c.city}</span></td>
                        <td>{c.submitted ? <span style={{ color: 'var(--warning)', fontWeight: 600 }}>{c.submitted}</span> : <span className="muted">0</span>}</td>
                        <td>{c.approved || <span className="muted">0</span>}</td>
                        <td>{c.rejected || <span className="muted">0</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <EmptyState icon={MapPinned} title="No cities yet" />
              )}
            </SectionCard>
          </div>
        </div>
      </div>

      {open && <EnquiryModal enquiry={open} onClose={() => setOpen(null)} />}
    </>
  );
}

export default FranchiseOverviewPage;
