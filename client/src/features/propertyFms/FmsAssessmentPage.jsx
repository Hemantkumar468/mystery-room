import { useMemo, useState } from 'react';
import {
  ShieldCheck, FileText, CheckCircle2, Clock, XCircle, Check, MapPin,
  Phone, Wallet, Users, CalendarClock,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Badge, EmptyState, Avatar } from '../../components/ui/primitives.jsx';
import { PhaseHero } from './components/PhaseHero.jsx';
import { PhaseStepper } from './components/PhaseStepper.jsx';
import { StatTile } from './components/StatTile.jsx';
import { DetailPanel } from './components/DetailPanel.jsx';
import { Fact, FactSection } from './components/Fact.jsx';
import { opportunitiesForStage, teamMember } from './propertyFmsData.js';
import { ASSESSMENT_STATUS_META, STAT_TONES } from './propertyFmsUi.js';
import { fmtDate, fmtCurrency } from '../../lib/format.js';

const TABS = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'in-progress', label: 'In Progress', match: (o) => o.assessment?.status === 'in-progress' },
  { key: 'completed', label: 'Completed', match: (o) => o.assessment?.status === 'completed' },
  { key: 'need-info', label: 'Need Info', match: (o) => o.assessment?.status === 'need-info' },
  { key: 'not-feasible', label: 'Not Feasible', match: (o) => o.assessment?.status === 'not-feasible' },
];

const CHECK_ICON = { done: <Check size={11} strokeWidth={3} />, 'in-progress': <Clock size={11} />, pending: null };
const PAGE_SIZE = 8;

export function FmsAssessmentPage() {
  const records = useMemo(() => opportunitiesForStage('assessment').filter((o) => o.assessment), []);
  const [tab, setTab] = useState('all');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState(null);
  const [detailTab, setDetailTab] = useState('details');

  const stats = useMemo(() => ({
    inProgress: records.filter((o) => o.assessment.status === 'in-progress').length,
    completed: records.filter((o) => o.assessment.status === 'completed').length,
    needInfo: records.filter((o) => o.assessment.status === 'need-info').length,
    notFeasible: records.filter((o) => o.assessment.status === 'not-feasible').length,
  }), [records]);

  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.key, records.filter(t.match).length])), [records]);
  const changeTab = (key) => { setTab(key); setPage(1); };
  const filtered = useMemo(() => records.filter((TABS.find((t) => t.key === tab) || TABS[0]).match), [records, tab]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const selected = records.find((o) => o.id === selectedId) || null;

  return (
    <>
      <Topbar title="Assessment" />
      <div className="content">
        <div className="content-wide col gap-4 fade-in">
          <PhaseHero
            icon={ShieldCheck}
            title="Assessment"
            subtitle="Evaluate shortlisted properties for technical, financial, operational and market feasibility."
            quote="Right evaluation today, stronger Mystery Rooms tomorrow."
            phaseKey="assessment"
          />

          <div className="fms-stat-grid">
            <StatTile icon={FileText} value={stats.inProgress} label="Under Assessment" sub="Properties being evaluated" tone={STAT_TONES.purple} onClick={() => changeTab('in-progress')} />
            <StatTile icon={CheckCircle2} value={stats.completed} label="Assessment Completed" sub="Ready for LOI & Commercial" tone={STAT_TONES.green} onClick={() => changeTab('completed')} />
            <StatTile icon={Clock} value={stats.needInfo} label="Additional Information" sub="Awaiting clarification" tone={STAT_TONES.gold} onClick={() => changeTab('need-info')} />
            <StatTile icon={XCircle} value={stats.notFeasible} label="Not Feasible" sub="Closed at assessment stage" tone={STAT_TONES.red} onClick={() => changeTab('not-feasible')} />
          </div>

          <PhaseStepper activeKey="assessment" />

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
                  <EmptyState icon={ShieldCheck} title="Nothing here yet" hint="Try another tab." />
                ) : (
                  <div className="fms-table-wrap">
                    <table className="table table-clickable">
                      <thead>
                        <tr>
                          <th>Lead / Project</th>
                          <th>Property Details</th>
                          <th>Location</th>
                          <th>Assessment Type</th>
                          <th>Status</th>
                          <th>Assigned To</th>
                          <th>Target Date</th>
                          <th style={{ width: 70 }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pageRows.map((o) => {
                          const statusMeta = ASSESSMENT_STATUS_META[o.assessment.status];
                          const assignee = teamMember(o.assessment.assignedTo);
                          return (
                            <tr
                              key={o.id}
                              className={`fms-row-select${selectedId === o.id ? ' is-selected' : ''}`}
                              onClick={() => { setSelectedId(o.id); setDetailTab('details'); }}
                            >
                              <td>
                                <div className="row gap-2" style={{ alignItems: 'center' }}>
                                  <Avatar name={o.name} size={26} />
                                  <div className="col" style={{ gap: 1 }}>
                                    <span style={{ fontWeight: 650 }}>{o.name}</span>
                                    <span className="tiny muted">{o.phone}</span>
                                  </div>
                                </div>
                              </td>
                              <td><span className="sm">{o.property?.name}</span></td>
                              <td><span className="sm">{o.city}</span></td>
                              <td><span className="sm">{(o.assessment.types || []).join(' + ')}</span></td>
                              <td><Badge color={statusMeta.color} dot>{statusMeta.label}</Badge></td>
                              <td>{assignee && <Avatar name={assignee.name} color={assignee.color} size={24} title={assignee.name} />}</td>
                              <td className="tiny muted">{fmtDate(o.assessment.targetDate)}</td>
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
                  <span className="tiny muted">Showing {pageRows.length ? (page - 1) * PAGE_SIZE + 1 : 0} to {(page - 1) * PAGE_SIZE + pageRows.length} of {filtered.length}</span>
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
                  icon={ShieldCheck}
                  title={selected.property?.name}
                  eyebrow={<span className="tiny muted">{selected.id}</span>}
                  badge={<Badge color={ASSESSMENT_STATUS_META[selected.assessment.status].color}>{ASSESSMENT_STATUS_META[selected.assessment.status].label}</Badge>}
                  tabs={[{ key: 'details', label: 'Details' }, { key: 'assessment', label: 'Assessment' }, { key: 'notes', label: 'Notes' }, { key: 'activity', label: 'Activity' }]}
                  activeTab={detailTab}
                  onTabChange={setDetailTab}
                  onClose={() => setSelectedId(null)}
                  footer={(
                    <>
                      <button type="button" className="btn btn-subtle">View Full Report</button>
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={selected.assessment.status !== 'completed'}
                      >
                        Move to LOI
                      </button>
                    </>
                  )}
                >
                  {detailTab === 'details' && (
                    <>
                      <FactSection title="Lead Information">
                        <Fact icon={Users} label="Name" value={selected.name} />
                        <Fact icon={Phone} label="Phone" value={selected.phone} />
                      </FactSection>
                      <FactSection title="Location">
                        <Fact icon={MapPin} label="Address" value={selected.property?.address} />
                      </FactSection>
                      <FactSection title="Assessment Progress">
                        <div className="col" style={{ gap: 0 }}>
                          {selected.assessment.checklist.map((c) => (
                            <div className="fms-checklist-item" key={c.key}>
                              <span
                                className="fms-checklist-dot"
                                style={{
                                  background: c.status === 'done' ? 'var(--success)' : c.status === 'in-progress' ? 'var(--info)' : 'var(--bg-subtle)',
                                  color: c.status === 'pending' ? 'var(--text-subtle)' : '#fff',
                                  border: c.status === 'pending' ? '1.5px solid var(--border-strong)' : 'none',
                                }}
                              >
                                {CHECK_ICON[c.status]}
                              </span>
                              <span className="sm" style={{ flex: 1 }}>{c.label}</span>
                              <span className="tiny muted">{c.date ? fmtDate(c.date) : c.status === 'in-progress' ? 'In Progress' : 'Pending'}</span>
                            </div>
                          ))}
                        </div>
                      </FactSection>
                    </>
                  )}
                  {detailTab === 'assessment' && (
                    <>
                      <FactSection title="Scope">
                        <Fact icon={FileText} label="Assessment Types" value={(selected.assessment.types || []).join(' + ')} />
                        <Fact icon={Users} label="Assigned To" value={teamMember(selected.assessment.assignedTo)?.name} />
                        <Fact icon={CalendarClock} label="Target Date" value={fmtDate(selected.assessment.targetDate)} />
                        <Fact icon={Wallet} label="Rent" value={selected.property?.rentPerMonth ? `${fmtCurrency(selected.property.rentPerMonth)} / month` : null} />
                      </FactSection>
                      {selected.assessment.needInfoNote && (
                        <div className="info-panel info-panel--info">
                          <Clock size={16} className="info-panel-icon" />
                          <div className="info-panel-body">{selected.assessment.needInfoNote}</div>
                        </div>
                      )}
                      {selected.assessment.notFeasibleNote && (
                        <div className="info-panel info-panel--danger">
                          <XCircle size={16} className="info-panel-icon" />
                          <div className="info-panel-body">{selected.assessment.notFeasibleNote}</div>
                        </div>
                      )}
                    </>
                  )}
                  {detailTab === 'notes' && <p className="sm muted">No notes added yet.</p>}
                  {detailTab === 'activity' && (
                    <div className="fms-activity-row">
                      <span className="fms-activity-dot" style={{ background: 'var(--primary)' }} />
                      <div className="col" style={{ gap: 1 }}>
                        <span className="sm">Assessment opened</span>
                        <span className="tiny muted">{fmtDate(selected.assessment.checklist[0]?.date)}</span>
                      </div>
                    </div>
                  )}
                </DetailPanel>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default FmsAssessmentPage;
