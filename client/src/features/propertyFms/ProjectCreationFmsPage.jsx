import { useMemo, useState } from 'react';
import {
  Rocket, Building2, PlayCircle, Clock, PauseCircle, CheckCircle2,
  Phone, Mail, MapPin, Ruler, FileText, Target, Milestone, ExternalLink,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Badge, EmptyState, Avatar } from '../../components/ui/primitives.jsx';
import { PhaseHero } from './components/PhaseHero.jsx';
import { PhaseStepper } from './components/PhaseStepper.jsx';
import { StatTile } from './components/StatTile.jsx';
import { DetailPanel } from './components/DetailPanel.jsx';
import { Fact, FactSection } from './components/Fact.jsx';
import { opportunitiesForStage, teamMember } from './propertyFmsData.js';
import { PROJECT_STATUS_META, STAT_TONES } from './propertyFmsUi.js';
import { fmtDate } from '../../lib/format.js';

const TABS = [
  { key: 'all', label: 'All Projects', match: () => true },
  { key: 'in-progress', label: 'In Progress', match: (o) => o.project?.status === 'in-progress' },
  { key: 'upcoming', label: 'Upcoming', match: (o) => o.project?.status === 'upcoming' },
  { key: 'on-hold', label: 'On Hold', match: (o) => o.project?.status === 'on-hold' },
  { key: 'completed', label: 'Completed', match: (o) => o.project?.status === 'completed' },
];

const PAGE_SIZE = 8;

export function ProjectCreationFmsPage() {
  const records = useMemo(() => opportunitiesForStage('project').filter((o) => o.project), []);
  const [tab, setTab] = useState('all');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState(records[0]?.id ?? null);
  const [detailTab, setDetailTab] = useState('details');

  const stats = useMemo(() => ({
    total: records.length,
    inProgress: records.filter((o) => o.project.status === 'in-progress').length,
    upcoming: records.filter((o) => o.project.status === 'upcoming').length,
    onHold: records.filter((o) => o.project.status === 'on-hold').length,
    completed: records.filter((o) => o.project.status === 'completed').length,
  }), [records]);

  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.key, records.filter(t.match).length])), [records]);
  const changeTab = (key) => { setTab(key); setPage(1); };
  const filtered = useMemo(() => records.filter((TABS.find((t) => t.key === tab) || TABS[0]).match), [records, tab]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const selected = records.find((o) => o.id === selectedId) || null;

  return (
    <>
      <Topbar title="Project Creation" />
      <div className="content">
        <div className="content-wide col gap-4 fade-in">
          <PhaseHero
            icon={Rocket}
            title="Project Creation"
            subtitle="Create and manage projects for approved properties with signed agreements."
            quote="From signed agreements to extraordinary destinations."
            phaseKey="creation"
          />

          <div className="fms-stat-grid">
            <StatTile icon={Building2} value={stats.total} label="Total Projects" sub="Created from signed agreements" tone={STAT_TONES.gold} onClick={() => changeTab('all')} />
            <StatTile icon={PlayCircle} value={stats.inProgress} label="In Progress" sub="Under execution" tone={STAT_TONES.green} onClick={() => changeTab('in-progress')} />
            <StatTile icon={Clock} value={stats.upcoming} label="Upcoming" sub="Kick-off pending" tone={STAT_TONES.blue} onClick={() => changeTab('upcoming')} />
            <StatTile icon={PauseCircle} value={stats.onHold} label="On Hold" sub="Temporary pause" tone={STAT_TONES.purple} onClick={() => changeTab('on-hold')} />
            <StatTile icon={CheckCircle2} value={stats.completed} label="Completed" sub="Successfully launched" tone={STAT_TONES.grey} onClick={() => changeTab('completed')} />
          </div>

          <PhaseStepper activeKey="creation" />

          <div className="card">
            <div className="card-head">
              <div className="fms-toolbar" style={{ width: '100%' }}>
                <div className="fms-tabs">
                  {TABS.map((t) => (
                    <button key={t.key} type="button" className={`fms-tab${tab === t.key ? ' active' : ''}`} onClick={() => changeTab(t.key)}>
                      {t.label} <span className="fms-tab-count">{counts[t.key]}</span>
                    </button>
                  ))}
                </div>
                <div className="fms-toolbar-actions">
                  <button type="button" className="btn btn-subtle btn-sm">Export</button>
                </div>
              </div>
            </div>

            <div className="fms-split" style={{ padding: 'var(--space-3) var(--space-4) var(--space-4)' }}>
              <div className="fms-split-main col gap-3">
                {pageRows.length === 0 ? (
                  <EmptyState icon={Rocket} title="Nothing here yet" hint="Try another tab." />
                ) : (
                  <div className="fms-table-wrap">
                    <table className="table table-clickable">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Project Name</th>
                          <th>Franchisee / Lead</th>
                          <th>Location</th>
                          <th>Property Details</th>
                          <th>Target Opening</th>
                          <th>Status</th>
                          <th>Project Manager</th>
                          <th style={{ width: 70 }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pageRows.map((o, i) => {
                          const statusMeta = PROJECT_STATUS_META[o.project.status];
                          const pm = teamMember(o.project.projectManager);
                          return (
                            <tr
                              key={o.id}
                              className={`fms-row-select${selectedId === o.id ? ' is-selected' : ''}`}
                              onClick={() => { setSelectedId(o.id); setDetailTab('details'); }}
                            >
                              <td className="tiny muted">{(page - 1) * PAGE_SIZE + i + 1}</td>
                              <td>
                                <div className="col" style={{ gap: 1 }}>
                                  <span style={{ fontWeight: 650 }}>{o.project.name}</span>
                                  <span className="tiny muted">{o.project.code}</span>
                                </div>
                              </td>
                              <td>
                                <div className="row gap-2" style={{ alignItems: 'center' }}>
                                  <Avatar name={o.name} size={24} />
                                  <span className="sm">{o.name}</span>
                                </div>
                              </td>
                              <td><span className="sm">{o.city}, {o.state}</span></td>
                              <td><span className="sm">{o.project.areaSqft?.toLocaleString('en-IN')} sq.ft</span></td>
                              <td className="tiny muted">{fmtDate(o.project.targetOpening)}</td>
                              <td><Badge color={statusMeta.color} dot>{statusMeta.label}</Badge></td>
                              <td>{pm && <Avatar name={pm.name} color={pm.color} size={24} title={pm.name} />}</td>
                              <td onClick={(e) => e.stopPropagation()}>
                                <button type="button" className="btn btn-subtle btn-sm" onClick={() => { setSelectedId(o.id); setDetailTab('details'); }}>View</button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="fms-pagination">
                  <span className="tiny muted">Showing {pageRows.length ? (page - 1) * PAGE_SIZE + 1 : 0} to {(page - 1) * PAGE_SIZE + pageRows.length} of {filtered.length} projects</span>
                  <div className="row gap-1">
                    <button type="button" className="fms-page-btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>‹</button>
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                      <button key={n} type="button" className={`fms-page-btn${page === n ? ' active' : ''}`} onClick={() => setPage(n)}>{n}</button>
                    ))}
                    <button type="button" className="fms-page-btn" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>›</button>
                  </div>
                </div>
              </div>

              {selected && (
                <DetailPanel
                  icon={Building2}
                  title={selected.project.name}
                  eyebrow={<span className="tiny muted">{selected.project.code}</span>}
                  badge={<Badge color={PROJECT_STATUS_META[selected.project.status].color}>{PROJECT_STATUS_META[selected.project.status].label}</Badge>}
                  tabs={[{ key: 'details', label: 'Project Details' }, { key: 'timeline', label: 'Timeline' }, { key: 'team', label: 'Team' }, { key: 'documents', label: 'Documents' }]}
                  activeTab={detailTab}
                  onTabChange={setDetailTab}
                  onClose={() => setSelectedId(null)}
                  footer={(
                    <>
                      <button type="button" className="btn btn-subtle">View Project Plan</button>
                      <button type="button" className="btn btn-primary">Start Execution <span aria-hidden>→</span></button>
                    </>
                  )}
                >
                  {detailTab === 'details' && (
                    <>
                      <FactSection title="Franchisee / Lead">
                        <Fact icon={Building2} label="Name" value={selected.name} />
                        <Fact icon={Phone} label="Phone" value={selected.phone} />
                        <Fact icon={Mail} label="Email" value={selected.email} />
                      </FactSection>
                      <FactSection title="Location">
                        <Fact icon={MapPin} label="Address" value={[selected.locality, selected.city, selected.state].filter(Boolean).join(', ')} />
                        <Fact icon={Ruler} label="Area" value={selected.project.areaSqft ? `${selected.project.areaSqft.toLocaleString('en-IN')} sq.ft` : null} />
                      </FactSection>
                      <FactSection title="Agreement Details">
                        <Fact icon={FileText} label="LOI Signed" value={fmtDate(selected.project.agreement?.loiSigned)} />
                        <Fact icon={FileText} label="Lease Signed" value={fmtDate(selected.project.agreement?.leaseSigned)} />
                        {selected.project.agreement?.hasDocument && (
                          <Fact icon={ExternalLink} label="Agreement File" value={<span style={{ color: 'var(--primary)', fontWeight: 650 }}>View Document</span>} />
                        )}
                      </FactSection>
                      <FactSection title="Project Details">
                        <Fact icon={Target} label="Target Opening" value={fmtDate(selected.project.targetOpening)} />
                        <Fact icon={Building2} label="Project Manager" value={teamMember(selected.project.projectManager)?.name} />
                        <Fact icon={Milestone} label="Current Stage" value={selected.project.currentStage} />
                        <Fact icon={Milestone} label="Next Milestone" value={selected.project.nextMilestone} />
                      </FactSection>
                    </>
                  )}
                  {detailTab === 'timeline' && (
                    <div className="fms-activity-row">
                      <span className="fms-activity-dot" style={{ background: 'var(--primary)' }} />
                      <div className="col" style={{ gap: 1 }}>
                        <span className="sm">Project created — {selected.project.currentStage}</span>
                        <span className="tiny muted">{fmtDate(selected.project.startDate)}</span>
                      </div>
                    </div>
                  )}
                  {detailTab === 'team' && (
                    <FactSection title="Assigned">
                      <Fact icon={Building2} label="Project Manager" value={teamMember(selected.project.projectManager)?.name} />
                    </FactSection>
                  )}
                  {detailTab === 'documents' && <p className="sm muted">No documents uploaded yet.</p>}
                </DetailPanel>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default ProjectCreationFmsPage;
