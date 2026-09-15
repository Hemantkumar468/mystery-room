import { useMemo, useState } from 'react';
import {
  FileSignature, Handshake, Scale, CheckCircle2, Phone, MapPin,
  Wallet, CalendarClock, Percent, Lock, Users,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Badge, EmptyState, Avatar } from '../../components/ui/primitives.jsx';
import { PhaseHero } from './components/PhaseHero.jsx';
import { PhaseStepper } from './components/PhaseStepper.jsx';
import { StatTile } from './components/StatTile.jsx';
import { DetailPanel } from './components/DetailPanel.jsx';
import { Fact, FactSection } from './components/Fact.jsx';
import { opportunitiesForStage, teamMember } from './propertyFmsData.js';
import { DEAL_STAGE_META, SUBMISSION_TYPE_META, STAT_TONES } from './propertyFmsUi.js';
import { fmtDate, fmtCurrency } from '../../lib/format.js';

const TABS = [
  { key: 'all', label: 'All Deals', match: () => true },
  { key: 'loi-drafting', label: 'LOI Drafting', match: (o) => o.deal?.stage === 'loi-drafting' },
  { key: 'legal-review', label: 'Legal Review', match: (o) => o.deal?.stage === 'legal-review' },
  { key: 'lease-negotiation', label: 'Lease Negotiation', match: (o) => o.deal?.stage === 'lease-negotiation' },
  { key: 'ready-for-finalization', label: 'Finalization', match: (o) => o.deal?.stage === 'ready-for-finalization' },
  { key: 'closed', label: 'Closed', match: (o) => o.deal?.stage === 'closed' },
];

const PAGE_SIZE = 8;

export function LoiCommercialPage() {
  const records = useMemo(() => opportunitiesForStage('loi').filter((o) => o.deal), []);
  const [tab, setTab] = useState('all');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState(null);
  const [detailTab, setDetailTab] = useState('details');

  const stats = useMemo(() => ({
    inProcess: records.length,
    legalReview: records.filter((o) => o.deal.stage === 'legal-review').length,
    negotiation: records.filter((o) => o.deal.stage === 'lease-negotiation').length,
    readyForFinal: records.filter((o) => o.deal.stage === 'ready-for-finalization').length,
  }), [records]);

  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.key, records.filter(t.match).length])), [records]);
  const changeTab = (key) => { setTab(key); setPage(1); };
  const filtered = useMemo(() => records.filter((TABS.find((t) => t.key === tab) || TABS[0]).match), [records, tab]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const selected = records.find((o) => o.id === selectedId) || null;

  return (
    <>
      <Topbar title="LOI & Commercial Finalization" />
      <div className="content">
        <div className="content-wide col gap-4 fade-in">
          <PhaseHero
            icon={FileSignature}
            title="LOI & Commercial Finalization"
            subtitle="Manage LOI, legal clearance, lease negotiation and commercial finalization."
            quote="From agreement to a greater tomorrow."
            phaseKey="loi"
          />

          <div className="fms-stat-grid">
            <StatTile icon={FileSignature} value={stats.inProcess} label="In LOI Process" sub="Deals under commercial discussion" tone={STAT_TONES.blue} onClick={() => changeTab('all')} />
            <StatTile icon={Handshake} value={stats.legalReview} label="Legal Review" sub="With legal team" tone={STAT_TONES.gold} onClick={() => changeTab('legal-review')} />
            <StatTile icon={Scale} value={stats.negotiation} label="Lease Negotiation" sub="Terms & conditions in progress" tone={STAT_TONES.purple} onClick={() => changeTab('lease-negotiation')} />
            <StatTile icon={CheckCircle2} value={stats.readyForFinal} label="Ready for Finalization" sub="Awaiting final approval" tone={STAT_TONES.green} onClick={() => changeTab('ready-for-finalization')} />
          </div>

          <PhaseStepper activeKey="loi" />

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
                  <EmptyState icon={FileSignature} title="Nothing here yet" hint="Try another tab." />
                ) : (
                  <div className="fms-table-wrap">
                    <table className="table table-clickable">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Property / Location</th>
                          <th>Source Type</th>
                          <th>Current Stage</th>
                          <th>Expected Close</th>
                          <th>Assigned To</th>
                          <th style={{ width: 70 }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pageRows.map((o) => {
                          const stageMeta = DEAL_STAGE_META[o.deal.stage];
                          const typeMeta = SUBMISSION_TYPE_META[o.deal.sourceType] || SUBMISSION_TYPE_META['interested-lead'];
                          const assignee = teamMember(o.deal.assignedTo);
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
                              <td>
                                <div className="col" style={{ gap: 1 }}>
                                  <span className="sm" style={{ fontWeight: 600 }}>{o.property?.name}</span>
                                  <span className="tiny muted">{o.city} · {o.property?.areaSqft?.toLocaleString('en-IN')} sq.ft</span>
                                </div>
                              </td>
                              <td><Badge color={typeMeta.color} dot>{typeMeta.label}</Badge></td>
                              <td><Badge color={stageMeta.color} dot>{stageMeta.label}</Badge></td>
                              <td className="tiny muted">{fmtDate(o.deal.expectedClose)}</td>
                              <td>{assignee && <Avatar name={assignee.name} color={assignee.color} size={24} title={assignee.name} />}</td>
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
                  icon={FileSignature}
                  title={selected.property?.name}
                  eyebrow={<span className="tiny muted">{selected.city}, {selected.state}</span>}
                  badge={<Badge color={DEAL_STAGE_META[selected.deal.stage].color}>{DEAL_STAGE_META[selected.deal.stage].label}</Badge>}
                  tabs={[{ key: 'details', label: 'Details' }, { key: 'documents', label: 'Documents' }, { key: 'financials', label: 'Financials' }, { key: 'approvals', label: 'Approvals' }, { key: 'activity', label: 'Activity' }]}
                  activeTab={detailTab}
                  onTabChange={setDetailTab}
                  onClose={() => setSelectedId(null)}
                  footer={(
                    <>
                      <button type="button" className="btn btn-subtle">View LOI Draft</button>
                      <div className="row gap-2">
                        <button type="button" className="btn btn-subtle" style={{ flex: 1 }}>Update Stage</button>
                        <button type="button" className="btn btn-primary" style={{ flex: 1.4 }}>Send for Legal Review <span aria-hidden>→</span></button>
                      </div>
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
                      <FactSection title="Current Stage">
                        <Fact icon={CalendarClock} label="Started On" value={fmtDate(selected.deal.startedOn)} />
                        <Fact icon={CalendarClock} label="Expected Close" value={fmtDate(selected.deal.expectedClose)} />
                        <Fact icon={Users} label="Assigned To" value={teamMember(selected.deal.assignedTo)?.name} />
                      </FactSection>
                    </>
                  )}
                  {(detailTab === 'financials') && (
                    <FactSection title="Commercial Details">
                      <Fact icon={Wallet} label="Expected Rent" value={`${fmtCurrency(selected.deal.commercial.rentPerMonth)} / month`} />
                      <Fact icon={Wallet} label="Security Deposit" value={fmtCurrency(selected.deal.commercial.securityDeposit)} />
                      <Fact icon={CalendarClock} label="Lease Term" value={`${selected.deal.commercial.leaseTermYears} years`} />
                      <Fact icon={Lock} label="Lock-in Period" value={`${selected.deal.commercial.lockInYears} years`} />
                      <Fact icon={Percent} label="Escalation" value={`${selected.deal.commercial.escalationPct}% every ${selected.deal.commercial.escalationFreqYears} years`} />
                    </FactSection>
                  )}
                  {detailTab === 'documents' && <p className="sm muted">No documents uploaded yet.</p>}
                  {detailTab === 'approvals' && <p className="sm muted">No approvals recorded yet.</p>}
                  {detailTab === 'activity' && (
                    <div className="fms-activity-row">
                      <span className="fms-activity-dot" style={{ background: 'var(--primary)' }} />
                      <div className="col" style={{ gap: 1 }}>
                        <span className="sm">Deal opened, LOI drafting started</span>
                        <span className="tiny muted">{fmtDate(selected.deal.startedOn)}</span>
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

export default LoiCommercialPage;
