import { useMemo, useState } from 'react';
import {
  ClipboardCheck, Users, Building2, Landmark, Search, Phone, Mail, MapPin,
  CalendarClock, Ruler, Wallet, CheckCircle2, XCircle, HelpCircle,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Badge, EmptyState } from '../../components/ui/primitives.jsx';
import { PhaseHero } from './components/PhaseHero.jsx';
import { PhaseStepper } from './components/PhaseStepper.jsx';
import { StatTile } from './components/StatTile.jsx';
import { DetailPanel } from './components/DetailPanel.jsx';
import { Fact, FactSection } from './components/Fact.jsx';
import { opportunitiesForStage } from './propertyFmsData.js';
import { SUBMISSION_TYPE_META, MD_DECISION_META, STAT_TONES } from './propertyFmsUi.js';
import { fmtDate, fmtCurrency, fmtNumber } from '../../lib/format.js';

const TABS = [
  { key: 'all', label: 'All Submissions', match: () => true },
  { key: 'interested-lead', label: 'Interested Leads', match: (o) => o.submissionType === 'interested-lead' },
  { key: 'interested-property', label: 'Interested + Property', match: (o) => o.submissionType === 'interested-property' },
  { key: 'property-opportunity', label: 'Property Opportunities', match: (o) => o.submissionType === 'property-opportunity' },
];

const PAGE_SIZE = 7;

export function ReviewDecisionPage() {
  const records = useMemo(() => opportunitiesForStage('review'), []);
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState(null);
  const [detailTab, setDetailTab] = useState('details');
  const [decisionOverrides, setDecisionOverrides] = useState({});

  const decisionOf = (o) => decisionOverrides[o.id] || o.mdDecision?.outcome || 'pending';

  const pendingCounts = useMemo(() => {
    const pendingOf = (t) => records.filter((o) => t.match(o) && decisionOf(o) === 'pending').length;
    return Object.fromEntries(TABS.map((t) => [t.key, pendingOf(t)]));
  }, [records, decisionOverrides]);

  const weekTally = useMemo(() => {
    let approved = 0, needInfo = 0, rejected = 0;
    for (const o of records) {
      const d = decisionOf(o);
      if (d === 'approved') approved += 1;
      else if (d === 'need-info') needInfo += 1;
      else if (d === 'rejected') rejected += 1;
    }
    return { approved, needInfo, rejected };
  }, [records, decisionOverrides]);

  const counts = useMemo(
    () => Object.fromEntries(TABS.map((t) => [t.key, records.filter(t.match).length])),
    [records],
  );

  const filtered = useMemo(() => {
    const activeTab = TABS.find((t) => t.key === tab) || TABS[0];
    const q = search.trim().toLowerCase();
    return records
      .filter(activeTab.match)
      .filter((o) => !q || [o.name, o.city, o.property?.name].filter(Boolean).join(' ').toLowerCase().includes(q));
  }, [records, tab, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const selected = records.find((o) => o.id === selectedId) || null;
  const changeTab = (key) => { setTab(key); setPage(1); };
  const decide = (id, outcome) => setDecisionOverrides((prev) => ({ ...prev, [id]: outcome }));

  return (
    <>
      <Topbar title="Review & Decision" />
      <div className="content">
        <div className="content-wide col gap-4 fade-in">
          <PhaseHero
            icon={ClipboardCheck}
            title="Review & Decision"
            subtitle="MD reviews all submitted opportunities and takes the first key decision."
            quote="Right decisions today, iconic locations tomorrow."
            phaseKey="review"
          />

          <div className="row gap-4 wrap" style={{ alignItems: 'stretch' }}>
            <div className="fms-stat-grid" style={{ flex: '2 1 480px' }}>
              <StatTile icon={Users} value={pendingCounts['interested-lead']} label="Interested Leads (No Property)" sub="Pending MD decision" tone={STAT_TONES.indigo} onClick={() => changeTab('interested-lead')} />
              <StatTile icon={Building2} value={pendingCounts['interested-property']} label="Interested + Property (Has Property)" sub="Pending MD decision" tone={STAT_TONES.gold} onClick={() => changeTab('interested-property')} />
              <StatTile icon={Landmark} value={pendingCounts['property-opportunity']} label="Property Opportunities (External / Broker)" sub="Pending MD decision" tone={STAT_TONES.blue} onClick={() => changeTab('property-opportunity')} />
            </div>

            <div className="fms-decision-week" style={{ flex: '1 1 240px' }}>
              <b className="sm">Decision This Week</b>
              <div className="fms-decision-week-row">
                <span className="row gap-2 muted"><CheckCircle2 size={14} style={{ color: 'var(--success)' }} /> Approved</span>
                <span className="fms-decision-week-value" style={{ color: 'var(--success)' }}>{weekTally.approved}</span>
              </div>
              <div className="fms-decision-week-row">
                <span className="row gap-2 muted"><HelpCircle size={14} style={{ color: 'var(--warning)' }} /> Need Info</span>
                <span className="fms-decision-week-value" style={{ color: 'var(--warning)' }}>{weekTally.needInfo}</span>
              </div>
              <div className="fms-decision-week-row">
                <span className="row gap-2 muted"><XCircle size={14} style={{ color: 'var(--danger)' }} /> Rejected</span>
                <span className="fms-decision-week-value" style={{ color: 'var(--danger)' }}>{weekTally.rejected}</span>
              </div>
            </div>
          </div>

          <PhaseStepper activeKey="review" />

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
                  <div className="fms-search">
                    <Search size={14} className="subtle" />
                    <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search submissions…" />
                  </div>
                  <button type="button" className="btn btn-subtle btn-sm">Export</button>
                </div>
              </div>
            </div>

            <div className="fms-split" style={{ padding: 'var(--space-3) var(--space-4) var(--space-4)' }}>
              <div className="fms-split-main col gap-3">
                {pageRows.length === 0 ? (
                  <EmptyState icon={ClipboardCheck} title="Nothing here yet" hint="Try another tab or clear the search." />
                ) : (
                  <div className="fms-table-wrap">
                    <table className="table table-clickable">
                      <thead>
                        <tr>
                          <th>Type</th>
                          <th>Person / Property</th>
                          <th>Location</th>
                          <th>Submitted On</th>
                          <th>Status</th>
                          <th style={{ width: 170 }}>MD Decision</th>
                          <th style={{ width: 70 }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pageRows.map((o) => {
                          const typeMeta = SUBMISSION_TYPE_META[o.submissionType];
                          const outcome = decisionOf(o);
                          const decisionMeta = MD_DECISION_META[outcome];
                          return (
                            <tr
                              key={o.id}
                              className={`fms-row-select${selectedId === o.id ? ' is-selected' : ''}`}
                              onClick={() => { setSelectedId(o.id); setDetailTab('details'); }}
                            >
                              <td><Badge color={typeMeta.color} dot>{typeMeta.label}</Badge></td>
                              <td>
                                <div className="col" style={{ gap: 1 }}>
                                  <span style={{ fontWeight: 650 }}>{o.property?.name || o.name}</span>
                                  <span className="tiny muted">{o.name} · {o.phone}</span>
                                </div>
                              </td>
                              <td><span className="sm">{o.city}{o.state ? `, ${o.state}` : ''}</span></td>
                              <td className="tiny muted">{fmtDate(o.submittedOn)}</td>
                              <td><Badge color={decisionMeta.color} dot>{decisionMeta.label}</Badge></td>
                              <td onClick={(e) => e.stopPropagation()}>
                                <select
                                  className="fms-decision-select"
                                  value={outcome}
                                  onChange={(e) => decide(o.id, e.target.value)}
                                  style={{ width: '100%', padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12.5 }}
                                >
                                  {Object.entries(MD_DECISION_META).map(([key, m]) => (
                                    <option key={key} value={key}>{m.label}</option>
                                  ))}
                                </select>
                              </td>
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
                    {Array.from({ length: totalPages }, (_, i) => i + 1).slice(0, 5).map((n) => (
                      <button key={n} type="button" className={`fms-page-btn${page === n ? ' active' : ''}`} onClick={() => setPage(n)}>{n}</button>
                    ))}
                    <button type="button" className="fms-page-btn" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>›</button>
                  </div>
                </div>
              </div>

              {selected && (
                <DetailPanel
                  icon={selected.submissionType === 'interested-lead' ? Users : Building2}
                  title={selected.property?.name || selected.name}
                  eyebrow={<Badge color={SUBMISSION_TYPE_META[selected.submissionType].color} dot>{SUBMISSION_TYPE_META[selected.submissionType].label}</Badge>}
                  badge={<Badge color={MD_DECISION_META[decisionOf(selected)].color}>{MD_DECISION_META[decisionOf(selected)].label}</Badge>}
                  tabs={[{ key: 'details', label: 'Details' }, { key: 'notes', label: 'Notes' }, { key: 'activity', label: 'Activity' }]}
                  activeTab={detailTab}
                  onTabChange={setDetailTab}
                  onClose={() => setSelectedId(null)}
                  footer={(
                    <>
                      <button type="button" className="btn btn-outline-success" onClick={() => decide(selected.id, 'approved')}>Approve</button>
                      <div className="row gap-2">
                        <button type="button" className="btn btn-subtle" style={{ flex: 1 }} onClick={() => decide(selected.id, 'need-info')}>Need More Info</button>
                        <button type="button" className="btn btn-outline-danger" style={{ flex: 1 }} onClick={() => decide(selected.id, 'rejected')}>Reject</button>
                      </div>
                    </>
                  )}
                >
                  {detailTab === 'details' && (
                    <>
                      <FactSection title="Submitted By">
                        <Fact icon={Users} label="Name" value={selected.submittedBy?.name || selected.name} />
                        {selected.submittedBy?.role && <Fact icon={Landmark} label="Role" value={selected.submittedBy.role} />}
                        <Fact icon={Phone} label="Phone" value={selected.phone} />
                        <Fact icon={Mail} label="Email" value={selected.email} />
                      </FactSection>
                      {selected.property && (
                        <FactSection title="Property Details">
                          <Fact icon={MapPin} label="Location" value={selected.property.address} />
                          <Fact icon={Building2} label="Type" value={selected.property.type} />
                          <Fact icon={Ruler} label="Area" value={selected.property.areaSqft ? `${fmtNumber(selected.property.areaSqft)} sq.ft` : null} />
                          <Fact icon={Wallet} label="Value" value={selected.property.rentPerMonth ? `${fmtCurrency(selected.property.rentPerMonth)} / month (${selected.property.dealType || 'Lease'})` : null} />
                        </FactSection>
                      )}
                      <FactSection title="Submission">
                        <Fact icon={CalendarClock} label="Submitted On" value={fmtDate(selected.submittedOn)} />
                      </FactSection>
                    </>
                  )}
                  {detailTab === 'notes' && <p className="sm muted">No notes added yet.</p>}
                  {detailTab === 'activity' && (
                    <div className="fms-activity-row">
                      <span className="fms-activity-dot" style={{ background: 'var(--primary)' }} />
                      <div className="col" style={{ gap: 1 }}>
                        <span className="sm">Submission received, awaiting MD review</span>
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

export default ReviewDecisionPage;
