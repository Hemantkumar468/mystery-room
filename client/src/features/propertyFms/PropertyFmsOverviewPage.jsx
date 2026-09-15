import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Building2, Clock, Search, ShieldCheck, FileSignature, Rocket, AlertTriangle,
  Plus, Users, Landmark,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { SectionCard, Badge, Avatar } from '../../components/ui/primitives.jsx';
import { DonutChart } from '../../components/charts/chartkit.jsx';
import { PhaseHero } from './components/PhaseHero.jsx';
import { OPPORTUNITIES, opportunitiesForStage, STAGE_ORDER } from './propertyFmsData.js';
import { FMS_PHASES, SUBMISSION_TYPE_META, STAT_TONES } from './propertyFmsUi.js';
import { fmtDate, fromNow, fmtCurrency } from '../../lib/format.js';

const STAGE_LABEL = {
  capture: 'Property Capture', review: 'Review & Decision', research: 'Property Research',
  assessment: 'Assessment', loi: 'LOI & Commercial', project: 'Project Creation',
};

export function PropertyFmsOverviewPage() {
  const navigate = useNavigate();

  const funnel = useMemo(
    () => STAGE_ORDER.map((key) => ({ key, label: STAGE_LABEL[key], count: opportunitiesForStage(key).length })),
    [],
  );

  const kpis = useMemo(() => {
    const underReview = opportunitiesForStage('review').filter((o) => (o.mdDecision?.outcome || 'pending') === 'pending').length;
    const research = opportunitiesForStage('research').filter((o) => o.submissionType === 'interested-lead' && o.research?.status !== 'closed').length;
    const assessment = opportunitiesForStage('assessment').filter((o) => o.assessment?.status === 'in-progress').length;
    const loi = opportunitiesForStage('loi').filter((o) => o.deal && o.deal.stage !== 'closed').length;
    const projects = opportunitiesForStage('project').length;
    return { total: OPPORTUNITIES.length, underReview, research, assessment, loi, projects };
  }, []);

  const typeBreakdown = useMemo(() => {
    const groups = { 'interested-lead': 0, 'interested-property': 0, 'property-opportunity': 0 };
    for (const o of OPPORTUNITIES) groups[o.submissionType] = (groups[o.submissionType] || 0) + 1;
    return groups;
  }, []);

  const actionRequired = useMemo(() => {
    const pendingDecision = opportunitiesForStage('review').filter((o) => (o.mdDecision?.outcome || 'pending') === 'pending').length;
    const needSearch = opportunitiesForStage('research').filter((o) => o.research?.status === 'searching').length;
    const loiWaiting = OPPORTUNITIES.filter((o) => o.deal?.stage === 'ready-for-finalization').length;
    const legalPending = OPPORTUNITIES.filter((o) => o.deal?.stage === 'legal-review').length;
    const onHold = OPPORTUNITIES.filter((o) => o.project?.status === 'on-hold').length;
    return [
      { label: 'Properties waiting for MD decision', count: pendingDecision, to: '/property-fms/review-decision', color: 'var(--danger)' },
      { label: 'Leads need property search', count: needSearch, to: '/property-fms/research', color: 'var(--info)' },
      { label: 'LOIs waiting for approval', count: loiWaiting, to: '/property-fms/loi-commercial', color: 'var(--warning)' },
      { label: 'Legal review pending', count: legalPending, to: '/property-fms/loi-commercial', color: 'var(--info)' },
      { label: 'Delayed / on-hold records', count: onHold, to: '/property-fms/project-creation', color: 'var(--danger)' },
    ];
  }, []);

  const topOpportunities = useMemo(() => {
    const all = OPPORTUNITIES.flatMap((o) => (o.research?.suggested || []).map((p) => ({ ...p, city: o.city, state: o.state })));
    return all.sort((a, b) => b.score - a.score).slice(0, 3);
  }, []);

  const pipelineHealth = useMemo(() => {
    const waiting = OPPORTUNITIES.filter((o) => o.stage === 'capture' || o.stage === 'review').length;
    const atRisk = OPPORTUNITIES.filter((o) => o.assessment?.status === 'need-info' || o.deal?.stage === 'legal-review').length;
    const delayed = OPPORTUNITIES.filter((o) => o.project?.status === 'on-hold' || o.assessment?.status === 'not-feasible').length;
    const onTrack = Math.max(0, OPPORTUNITIES.length - waiting - atRisk - delayed);
    return [
      { name: 'On Track', value: onTrack, color: '#059669' },
      { name: 'At Risk', value: atRisk, color: '#D97706' },
      { name: 'Delayed', value: delayed, color: '#DC2626' },
      { name: 'Waiting', value: waiting, color: '#6B7280' },
    ];
  }, []);

  const financials = useMemo(() => {
    const projects = OPPORTUNITIES.filter((o) => o.project);
    const investment = projects.reduce((s, o) => s + (o.project.areaSqft || 0) * 1600, 0);
    const monthlyRevenue = projects.length * 1200000;
    return { investment, monthlyRevenue, roi: 24, breakEven: 18 };
  }, []);

  const recent = useMemo(
    () => [...OPPORTUNITIES].sort((a, b) => new Date(b.submittedOn) - new Date(a.submittedOn)).slice(0, 5),
    [],
  );

  const activity = useMemo(() => recent.map((o) => {
    if (o.project) return { text: `Project created — ${o.project.name}`, who: o.name, when: o.project.startDate, color: 'var(--success)' };
    if (o.deal) return { text: `LOI ${o.deal.stage === 'legal-review' ? 'sent for legal review' : 'drafting started'} — ${o.property?.name}`, who: o.name, when: o.deal.startedOn, color: 'var(--info)' };
    if (o.assessment) return { text: `Assessment ${o.assessment.status} — ${o.property?.name}`, who: o.name, when: o.assessment.targetDate, color: 'var(--primary)' };
    if (o.research) return { text: `Property research ${o.research.status} — ${o.name}`, who: o.name, when: o.submittedOn, color: '#8b5cf6' };
    return { text: `New submission — ${o.name}`, who: o.name, when: o.submittedOn, color: 'var(--text-subtle)' };
  }), [recent]);

  return (
    <>
      <Topbar
        title="Property FMS Overview"
        actions={<button type="button" className="btn btn-primary btn-sm" onClick={() => navigate('/property-fms/capture')}><Plus size={14} /> Add Opportunity</button>}
      />
      <div className="content">
        <div className="content-wide col gap-4 fade-in">
          <PhaseHero
            icon={Building2}
            title="Property FMS Overview"
            subtitle="Complete visibility from opportunity to project creation."
            quote="Better spaces. Brighter experiences. Bigger tomorrows."
          />

          <div className="fms-kpi-row">
            <div className="fms-kpi-tile">
              <Building2 size={16} style={{ color: STAT_TONES.blue }} />
              <span className="fms-kpi-value">{kpis.total}</span>
              <Link to="/property-fms/capture" className="fms-kpi-label">Total Opportunities</Link>
            </div>
            <div className="fms-kpi-tile">
              <Clock size={16} style={{ color: STAT_TONES.gold }} />
              <span className="fms-kpi-value">{kpis.underReview}</span>
              <Link to="/property-fms/review-decision" className="fms-kpi-label">Under Review</Link>
              <span className="fms-kpi-sub">Awaiting MD decision</span>
            </div>
            <div className="fms-kpi-tile">
              <Search size={16} style={{ color: STAT_TONES.purple }} />
              <span className="fms-kpi-value">{kpis.research}</span>
              <Link to="/property-fms/research" className="fms-kpi-label">Property Research</Link>
              <span className="fms-kpi-sub">In research phase</span>
            </div>
            <div className="fms-kpi-tile">
              <ShieldCheck size={16} style={{ color: STAT_TONES.indigo }} />
              <span className="fms-kpi-value">{kpis.assessment}</span>
              <Link to="/property-fms/assessment" className="fms-kpi-label">Assessment</Link>
              <span className="fms-kpi-sub">Feasibility checks</span>
            </div>
            <div className="fms-kpi-tile">
              <FileSignature size={16} style={{ color: STAT_TONES.blue }} />
              <span className="fms-kpi-value">{kpis.loi}</span>
              <Link to="/property-fms/loi-commercial" className="fms-kpi-label">LOI & Commercial</Link>
              <span className="fms-kpi-sub">In negotiation</span>
            </div>
            <div className="fms-kpi-tile">
              <Rocket size={16} style={{ color: STAT_TONES.green }} />
              <span className="fms-kpi-value">{kpis.projects}</span>
              <Link to="/property-fms/project-creation" className="fms-kpi-label">Projects Created</Link>
              <span className="fms-kpi-sub">Ready / active</span>
            </div>
          </div>

          <div className="row gap-4 wrap" style={{ alignItems: 'stretch' }}>
            <SectionCard title="Property Pipeline" subtitle="Track opportunities across all stages" style={{ flex: '1.6 1 460px' }}>
              <div className="fms-funnel">
                {funnel.map((f, i) => {
                  const phase = FMS_PHASES[i];
                  return (
                    <div className="fms-funnel-node" key={f.key}>
                      <button
                        type="button"
                        className="fms-funnel-circle"
                        style={{ background: i === funnel.length - 1 ? 'var(--gold-500)' : 'var(--success)', border: 'none', cursor: 'pointer' }}
                        onClick={() => navigate(phase.path)}
                        title={phase.label}
                      >
                        {i + 1}
                      </button>
                      {i < funnel.length - 1 && <span className="fms-funnel-line" />}
                      <span className="fms-funnel-count">{f.count}</span>
                      <span className="fms-funnel-label">{f.label}</span>
                    </div>
                  );
                })}
              </div>
            </SectionCard>

            <SectionCard
              title="Opportunity Types"
              subtitle="Different ways opportunities enter the pipeline"
              style={{ flex: '1 1 300px' }}
              action={<Link className="tbrief-link" to="/property-fms/capture">View All →</Link>}
            >
              <div className="fms-type-grid">
                <div className="fms-type-card">
                  <span className="fms-type-icon" style={{ color: SUBMISSION_TYPE_META['interested-lead'].color, background: `color-mix(in srgb, ${SUBMISSION_TYPE_META['interested-lead'].color} 14%, transparent)` }}><Users size={16} /></span>
                  <span className="fms-type-value">{typeBreakdown['interested-lead']}</span>
                  <span className="fms-type-label">Interested Lead</span>
                </div>
                <div className="fms-type-card">
                  <span className="fms-type-icon" style={{ color: SUBMISSION_TYPE_META['interested-property'].color, background: `color-mix(in srgb, ${SUBMISSION_TYPE_META['interested-property'].color} 14%, transparent)` }}><Building2 size={16} /></span>
                  <span className="fms-type-value">{typeBreakdown['interested-property']}</span>
                  <span className="fms-type-label">Interested + Property</span>
                </div>
                <div className="fms-type-card">
                  <span className="fms-type-icon" style={{ color: SUBMISSION_TYPE_META['property-opportunity'].color, background: `color-mix(in srgb, ${SUBMISSION_TYPE_META['property-opportunity'].color} 14%, transparent)` }}><Landmark size={16} /></span>
                  <span className="fms-type-value">{typeBreakdown['property-opportunity']}</span>
                  <span className="fms-type-label">Property Opportunity</span>
                </div>
              </div>
            </SectionCard>
          </div>

          <div className="row gap-4 wrap" style={{ alignItems: 'stretch' }}>
            <SectionCard title="Action Required" subtitle="Items that need immediate attention" style={{ flex: '1 1 280px' }}>
              <div className="col">
                {actionRequired.map((a) => (
                  <button key={a.label} type="button" className="fms-action-row" style={{ width: '100%', background: 'none', border: 'none', font: 'inherit', cursor: 'pointer', textAlign: 'left' }} onClick={() => navigate(a.to)}>
                    <span className="row gap-2" style={{ alignItems: 'center' }}>
                      <AlertTriangle size={13} style={{ color: a.color }} />
                      <span className="sm">{a.label}</span>
                    </span>
                    <span className="fms-action-count" style={{ color: a.color }}>{a.count}</span>
                  </button>
                ))}
              </div>
            </SectionCard>

            <SectionCard title="Top Property Opportunities" subtitle="Highest potential based on score" style={{ flex: '1 1 280px' }}>
              {topOpportunities.length ? (
                <div className="col">
                  {topOpportunities.map((p, i) => (
                    <div className="fms-rank-row" key={p.name}>
                      <span className="fms-rank-badge">{i + 1}</span>
                      <div className="col" style={{ gap: 1, flex: 1, minWidth: 0 }}>
                        <span className="sm truncate" style={{ fontWeight: 650 }}>{p.name}</span>
                        <span className="tiny muted">{p.city}, {p.state} · {p.areaSqft.toLocaleString('en-IN')} sq.ft</span>
                      </div>
                      <span className="fms-rank-score" style={{ color: 'var(--success)' }}>{p.score}/100</span>
                    </div>
                  ))}
                </div>
              ) : <p className="sm muted">No suggested properties yet.</p>}
            </SectionCard>

            <SectionCard title="Pipeline Health" subtitle="Overall pipeline status" style={{ flex: '1 1 260px' }}>
              <DonutChart data={pipelineHealth} height={190} centerLabel={{ value: OPPORTUNITIES.length, label: 'Total' }} />
              <div className="col gap-1" style={{ marginTop: 6 }}>
                {pipelineHealth.map((s) => (
                  <div key={s.name} className="row gap-2" style={{ justifyContent: 'space-between', fontSize: 12 }}>
                    <span className="row gap-2 muted"><span style={{ width: 8, height: 8, borderRadius: 2, background: s.color }} />{s.name}</span>
                    <b>{s.value}</b>
                  </div>
                ))}
              </div>
            </SectionCard>

            <SectionCard title="Financial Snapshot" subtitle="Based on approved opportunities" style={{ flex: '1 1 240px' }}>
              <div className="col" style={{ gap: 0 }}>
                <div className="fms-finsnap-row">
                  <span className="sm muted">Estimated Investment</span>
                  <span className="fms-finsnap-value">{fmtCurrency(financials.investment)}</span>
                </div>
                <div className="fms-finsnap-row">
                  <span className="sm muted">Expected Monthly Revenue</span>
                  <span className="fms-finsnap-value">{fmtCurrency(financials.monthlyRevenue)}</span>
                </div>
                <div className="fms-finsnap-row">
                  <span className="sm muted">Average ROI</span>
                  <span className="fms-finsnap-value">{financials.roi}%</span>
                </div>
                <div className="fms-finsnap-row">
                  <span className="sm muted">Average Break-even</span>
                  <span className="fms-finsnap-value">{financials.breakEven} Months</span>
                </div>
              </div>
            </SectionCard>
          </div>

          <div className="row gap-4 wrap" style={{ alignItems: 'flex-start' }}>
            <SectionCard
              title="Recent Opportunities"
              subtitle="Latest opportunities in the system"
              style={{ flex: '1.6 1 420px' }}
              action={<Link className="tbrief-link" to="/property-fms/capture">View All →</Link>}
            >
              <div className="fms-table-wrap">
                <table className="table table-clickable">
                  <thead>
                    <tr><th>#</th><th>Person / Lead</th><th>Location</th><th>Current Phase</th><th>Updated On</th></tr>
                  </thead>
                  <tbody>
                    {recent.map((o, i) => {
                      const phase = FMS_PHASES[STAGE_ORDER.indexOf(o.stage)];
                      return (
                        <tr key={o.id} onClick={() => navigate(phase.path)}>
                          <td className="tiny muted">{i + 1}</td>
                          <td>
                            <div className="row gap-2" style={{ alignItems: 'center' }}>
                              <Avatar name={o.name} size={24} />
                              <span className="sm" style={{ fontWeight: 600 }}>{o.name}</span>
                            </div>
                          </td>
                          <td><span className="sm">{o.city}</span></td>
                          <td><Badge color="#6366f1" dot>{phase.label}</Badge></td>
                          <td className="tiny muted">{fromNow(o.submittedOn)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </SectionCard>

            <SectionCard title="Recent Activity" subtitle="Latest updates across all properties" style={{ flex: '1 1 320px' }}>
              <div className="col">
                {activity.map((a, i) => (
                  <div className="fms-activity-row" key={i}>
                    <span className="fms-activity-dot" style={{ background: a.color }} />
                    <div className="col" style={{ gap: 1, minWidth: 0 }}>
                      <span className="sm truncate">{a.text}</span>
                      <span className="tiny muted">{a.who} · {fromNow(a.when)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          </div>
        </div>
      </div>
    </>
  );
}

export default PropertyFmsOverviewPage;
