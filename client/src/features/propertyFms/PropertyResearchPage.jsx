import { useMemo, useState } from 'react';
import {
  Search, Users, Building2, CalendarClock, CheckCircle2, Phone, Mail,
  MapPin, Wallet, Ruler, Target, Info,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Badge, EmptyState, Avatar } from '../../components/ui/primitives.jsx';
import { PhaseHero } from './components/PhaseHero.jsx';
import { PhaseStepper } from './components/PhaseStepper.jsx';
import { StatTile } from './components/StatTile.jsx';
import { DetailPanel } from './components/DetailPanel.jsx';
import { Fact, FactSection } from './components/Fact.jsx';
import { opportunitiesForStage, teamMember } from './propertyFmsData.js';
import { RESEARCH_STATUS_META, STAT_TONES } from './propertyFmsUi.js';
import { fmtDate, fromNow } from '../../lib/format.js';

const TABS = [
  { key: 'active', label: 'Active Searches', match: (o) => o.research?.status !== 'closed' },
  { key: 'shortlisted', label: 'Suggested Properties', match: (o) => (o.research?.suggested || []).length > 0 },
  { key: 'site-visits', label: 'Site Visits', match: (o) => (o.research?.siteVisitsDone || 0) > 0 },
  { key: 'ready-for-review', label: 'Ready for Review', match: (o) => o.research?.status === 'ready-for-review' },
  { key: 'closed', label: 'Closed', match: (o) => o.research?.status === 'closed' },
];

const PAGE_SIZE = 8;

export function PropertyResearchPage() {
  const leads = useMemo(
    () => opportunitiesForStage('research').filter((o) => o.submissionType === 'interested-lead'),
    [],
  );
  const [tab, setTab] = useState('active');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState(null);
  const [detailTab, setDetailTab] = useState('lead');

  const stats = useMemo(() => {
    const active = leads.filter((o) => o.research?.status !== 'closed').length;
    const shortlisted = leads.reduce((s, o) => s + (o.research?.propertiesFound || 0), 0);
    const siteVisits = leads.reduce((s, o) => s + (o.research?.siteVisitsDone || 0), 0);
    const readyForReview = leads.filter((o) => o.research?.status === 'ready-for-review').length;
    return { active, shortlisted, siteVisits, readyForReview };
  }, [leads]);

  const counts = useMemo(
    () => Object.fromEntries(TABS.map((t) => [t.key, leads.filter(t.match).length])),
    [leads],
  );

  const changeTab = (key) => { setTab(key); setPage(1); };
  const filtered = useMemo(() => leads.filter((TABS.find((t) => t.key === tab) || TABS[0]).match), [leads, tab]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const selected = leads.find((o) => o.id === selectedId) || null;

  return (
    <>
      <Topbar title="Property Research" />
      <div className="content">
        <div className="content-wide col gap-4 fade-in">
          <PhaseHero
            icon={Search}
            title="Property Research"
            subtitle="Find and evaluate suitable properties for interested leads (No Property)."
            quote="Great locations turn interest into reality."
            phaseKey="research"
          />

          <div className="fms-stat-grid">
            <StatTile icon={Users} value={stats.active} label="Active Searches" sub="Leads without property" tone={STAT_TONES.purple} onClick={() => changeTab('active')} />
            <StatTile icon={Building2} value={stats.shortlisted} label="Properties Shortlisted" sub="Across all leads" tone={STAT_TONES.blue} onClick={() => changeTab('shortlisted')} />
            <StatTile icon={CalendarClock} value={stats.siteVisits} label="Site Visits Scheduled" sub="This month" tone={STAT_TONES.blue} onClick={() => changeTab('site-visits')} />
            <StatTile icon={CheckCircle2} value={stats.readyForReview} label="Ready for MD Review" sub="Potential matches found" tone={STAT_TONES.green} onClick={() => changeTab('ready-for-review')} />
          </div>

          <PhaseStepper activeKey="research" />

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
                  <EmptyState icon={Search} title="Nothing here yet" hint="Try another tab." />
                ) : (
                  <div className="fms-table-wrap">
                    <table className="table table-clickable">
                      <thead>
                        <tr>
                          <th>Person (Lead)</th>
                          <th>Preferred Location</th>
                          <th>Search Status</th>
                          <th>Properties Found</th>
                          <th>Next Action</th>
                          <th>Assigned To</th>
                          <th>Last Updated</th>
                          <th style={{ width: 70 }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pageRows.map((o) => {
                          const statusMeta = RESEARCH_STATUS_META[o.research?.status] || RESEARCH_STATUS_META.searching;
                          const assignee = teamMember(o.research?.assignedTo);
                          return (
                            <tr
                              key={o.id}
                              className={`fms-row-select${selectedId === o.id ? ' is-selected' : ''}`}
                              onClick={() => { setSelectedId(o.id); setDetailTab('lead'); }}
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
                              <td><span className="sm">{[o.locality, o.city].filter(Boolean).join(', ') || o.city}</span></td>
                              <td><Badge color={statusMeta.color} dot>{statusMeta.label}</Badge></td>
                              <td className="tabular">{o.research?.propertiesFound ?? 0}</td>
                              <td><span className="sm">{o.research?.nextAction || '—'}</span></td>
                              <td>{assignee && <Avatar name={assignee.name} color={assignee.color} size={24} title={assignee.name} />}</td>
                              <td className="tiny muted">{fromNow(o.submittedOn)}</td>
                              <td onClick={(e) => e.stopPropagation()}>
                                <button type="button" className="btn btn-subtle btn-sm" onClick={() => { setSelectedId(o.id); setDetailTab('lead'); }}>View</button>
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
                  icon={Users}
                  title={selected.name}
                  eyebrow={<Badge color={RESEARCH_STATUS_META[selected.research?.status]?.color} dot>{RESEARCH_STATUS_META[selected.research?.status]?.label}</Badge>}
                  tabs={[{ key: 'lead', label: 'Lead Details' }, { key: 'properties', label: `Properties (${selected.research?.suggested?.length || 0})` }, { key: 'notes', label: 'Notes' }, { key: 'activity', label: 'Activity' }]}
                  activeTab={detailTab}
                  onTabChange={setDetailTab}
                  onClose={() => setSelectedId(null)}
                  footer={(
                    <>
                      <button type="button" className="btn btn-subtle">Add Suggested Property</button>
                      <button type="button" className="btn btn-primary">Mark for Review</button>
                    </>
                  )}
                >
                  {detailTab === 'lead' && (
                    <>
                      <FactSection title="Lead Information">
                        <Fact icon={Phone} label="Phone" value={selected.phone} />
                        <Fact icon={Mail} label="Email" value={selected.email} />
                        <Fact icon={Target} label="Interested In" value="Mystery Rooms Franchise" />
                        <Fact icon={MapPin} label="Preferred Location" value={[selected.locality, selected.city].filter(Boolean).join(', ') || selected.city} />
                        <Fact icon={Wallet} label="Budget" value={selected.interest?.budget} />
                        <Fact icon={Ruler} label="Space Requirement" value={selected.interest?.spaceReq} />
                        <Fact icon={CalendarClock} label="Target Opening" value={selected.interest?.targetOpening} />
                      </FactSection>

                      {selected.mdDecision?.outcome === 'approved' && (
                        <div className="info-panel info-panel--info">
                          <Info size={16} className="info-panel-icon" />
                          <div className="info-panel-body">
                            MD approved this lead for property search on {fmtDate(selected.mdDecision.decidedOn)}.
                          </div>
                        </div>
                      )}

                      <FactSection title="Research Summary">
                        <Fact icon={Building2} label="Properties Shortlisted" value={selected.research?.propertiesFound} />
                        <Fact icon={CalendarClock} label="Site Visits Done" value={selected.research?.siteVisitsDone} />
                        <Fact icon={Target} label="Next Action" value={selected.research?.nextAction} />
                        <Fact icon={Users} label="Assigned To" value={teamMember(selected.research?.assignedTo)?.name} />
                      </FactSection>
                    </>
                  )}
                  {detailTab === 'properties' && (
                    (selected.research?.suggested || []).length ? (
                      <div className="col gap-2">
                        {selected.research.suggested.map((p) => (
                          <div key={p.name} className="col gap-1" style={{ padding: 10, border: '1px solid var(--border)', borderRadius: 10 }}>
                            <span className="sm" style={{ fontWeight: 650 }}>{p.name}</span>
                            <span className="tiny muted">{p.areaSqft.toLocaleString('en-IN')} sq.ft · ₹{(p.rentPerMonth / 1000).toFixed(0)}K/mo · Score {p.score}/100</span>
                          </div>
                        ))}
                      </div>
                    ) : <p className="sm muted">No properties suggested yet.</p>
                  )}
                  {detailTab === 'notes' && <p className="sm muted">No notes added yet.</p>}
                  {detailTab === 'activity' && (
                    <div className="fms-activity-row">
                      <span className="fms-activity-dot" style={{ background: 'var(--primary)' }} />
                      <div className="col" style={{ gap: 1 }}>
                        <span className="sm">Research started</span>
                        <span className="tiny muted">{fmtDate(selected.submittedOn)}</span>
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

export default PropertyResearchPage;
