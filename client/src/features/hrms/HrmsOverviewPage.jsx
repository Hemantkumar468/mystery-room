/**
 * Hiring at a glance: open roles, the pipeline as totals, hiring per centre
 * (the PMS link — a requisition tied to a project rolls up here), and the
 * latest applications.
 */
import { Link } from 'react-router-dom';
import { BriefcaseBusiness, Users, UserCheck, Hourglass, ArrowRight } from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { SectionCard, EmptyState, Badge } from '../../components/ui/primitives.jsx';
import { SkCharts } from '../../components/ui/Skeletons.jsx';
import { useGetHrmsOverviewQuery } from '../../app/api/hrmsApi.js';
import { fromNow } from '../../lib/format.js';
import { STAGE_META, REQ_STATUS_META } from './hrmsUi.js';

function Stat({ icon: Icon, label, value, tone }) {
  return (
    <div className="hrms-stat">
      <span className="hrms-stat-icon" style={{ color: tone, background: `color-mix(in srgb, ${tone} 12%, transparent)` }}>
        <Icon size={16} />
      </span>
      <div className="col">
        <span className="hrms-stat-value">{value}</span>
        <span className="hrms-stat-label">{label}</span>
      </div>
    </div>
  );
}

export function HrmsOverviewPage() {
  const { data, isLoading } = useGetHrmsOverviewQuery();

  if (isLoading || !data) {
    return (<><Topbar title="Hiring Overview" /><div className="content"><SkCharts /></div></>);
  }

  const req = data.requisitions || {};
  const cand = data.candidates || {};
  const inPipeline = (cand.applied || 0) + (cand.screening || 0) + (cand.interview || 0) + (cand.offer || 0);

  return (
    <>
      <Topbar title="Hiring Overview" subtitle="Every role, every application, every centre" />
      <div className="content">
        <div className="content-narrow col gap-4 fade-in">
          <div className="hrms-stat-grid">
            <Stat icon={BriefcaseBusiness} label="Open roles" value={req.open || 0} tone="var(--primary)" />
            <Stat icon={Users} label="In the pipeline" value={inPipeline} tone="var(--info)" />
            <Stat icon={Hourglass} label="At offer stage" value={cand.offer || 0} tone="var(--warning)" />
            <Stat icon={UserCheck} label="Hired" value={cand.hired || 0} tone="var(--success)" />
          </div>

          <div className="row gap-4 wrap" style={{ alignItems: 'flex-start' }}>
            <SectionCard
              title="Hiring by centre"
              subtitle="Open requisitions tied to a store-opening project"
              style={{ flex: '1.4 1 360px' }}
              action={<Link className="tbrief-link" to="/hrms/requisitions">All requisitions <ArrowRight size={12} /></Link>}
            >
              {data.byProject?.length ? (
                <table className="table">
                  <thead><tr><th>Centre</th><th>Open roles</th><th>Positions</th><th>Hired</th></tr></thead>
                  <tbody>
                    {data.byProject.map((p) => (
                      <tr key={p.projectId}>
                        <td><span className="sm" style={{ fontWeight: 600 }}>{p.name}</span> <span className="tiny muted">{p.code}{p.city ? ` · ${p.city}` : ''}</span></td>
                        <td>{p.openRoles}</td>
                        <td>{p.headcount}</td>
                        <td>{p.hired}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <EmptyState icon={BriefcaseBusiness} title="No centre hiring yet" hint="Raise a requisition and tie it to a project — it rolls up here." />
              )}
            </SectionCard>

            <SectionCard title="Latest applications" subtitle="Newest first" style={{ flex: '1 1 300px' }}>
              {data.recent?.length ? (
                <div className="col">
                  {data.recent.map((c) => (
                    <Link key={c._id} to={`/hrms/requisitions/${c.requisition?._id || ''}`} className="hrms-recent-row">
                      <div className="col" style={{ minWidth: 0 }}>
                        <span className="sm truncate" style={{ fontWeight: 600 }}>{c.name}</span>
                        <span className="tiny muted truncate">{c.requisition?.title || '—'} · {fromNow(c.createdAt)}</span>
                      </div>
                      <Badge color={STAGE_META[c.stage]?.color} soft={STAGE_META[c.stage]?.soft} dot>{STAGE_META[c.stage]?.label || c.stage}</Badge>
                    </Link>
                  ))}
                </div>
              ) : (
                <EmptyState icon={Users} title="No applications yet" hint="Share a requisition's apply link and they land here." />
              )}
            </SectionCard>
          </div>

          <SectionCard title="Requisitions by status">
            <div className="row gap-2 wrap">
              {Object.entries(REQ_STATUS_META).map(([k, m]) => (
                <Badge key={k} color={m.color} soft={m.soft} dot>{m.label}: {req[k] || 0}</Badge>
              ))}
            </div>
          </SectionCard>
        </div>
      </div>
    </>
  );
}

export default HrmsOverviewPage;
