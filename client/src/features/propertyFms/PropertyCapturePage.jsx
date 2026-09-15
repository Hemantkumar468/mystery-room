import { useMemo, useState } from 'react';
import {
  Inbox, Users, Building2, Landmark, Search, Copy, Share2, Link2,
  MessageCircle, Linkedin, Facebook, Twitter, Phone, Mail, MapPin, CalendarClock, Ruler, Wallet,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Badge, EmptyState } from '../../components/ui/primitives.jsx';
import { PhaseHero } from './components/PhaseHero.jsx';
import { PhaseStepper } from './components/PhaseStepper.jsx';
import { StatTile } from './components/StatTile.jsx';
import { DetailPanel } from './components/DetailPanel.jsx';
import { Fact, FactSection } from './components/Fact.jsx';
import { OPPORTUNITIES } from './propertyFmsData.js';
import { SUBMISSION_TYPE_META, CAPTURE_STATUS_META, STAT_TONES } from './propertyFmsUi.js';
import { fmtDate, fmtCurrency, fmtNumber } from '../../lib/format.js';

const TABS = [
  { key: 'all', label: 'All Opportunities', match: () => true },
  { key: 'interested-lead', label: 'Interested Leads', match: (o) => o.submissionType === 'interested-lead' },
  { key: 'interested-property', label: 'Interested + Property', match: (o) => o.submissionType === 'interested-property' },
  { key: 'property-opportunity', label: 'Property Opportunities', match: (o) => o.submissionType === 'property-opportunity' },
];

const PAGE_SIZE = 7;
const SHARE_LINK = 'https://mysteryrooms.in/submit-property';

function keyDetails(o) {
  if (o.submissionType === 'interested-lead') {
    return `${o.interest?.targetOpening || 'Interested in franchise'} · No property yet`;
  }
  const areaBit = o.property?.areaSqft ? `${fmtNumber(o.property.areaSqft)} sq.ft` : null;
  const rentBit = o.property?.rentPerMonth ? `${fmtCurrency(o.property.rentPerMonth)}/mo` : null;
  return [o.property?.name, [areaBit, rentBit].filter(Boolean).join(' · ')].filter(Boolean).join(' — ');
}

export function PropertyCapturePage() {
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState(null);

  const counts = useMemo(
    () => Object.fromEntries(TABS.map((t) => [t.key, OPPORTUNITIES.filter(t.match).length])),
    [],
  );

  const filtered = useMemo(() => {
    const activeTab = TABS.find((t) => t.key === tab) || TABS[0];
    const q = search.trim().toLowerCase();
    return OPPORTUNITIES
      .filter(activeTab.match)
      .filter((o) => !q || [o.name, o.city, o.locality, o.property?.name].filter(Boolean).join(' ').toLowerCase().includes(q))
      .sort((a, b) => new Date(b.submittedOn) - new Date(a.submittedOn));
  }, [tab, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const selected = OPPORTUNITIES.find((o) => o.id === selectedId) || null;
  const [detailTab, setDetailTab] = useState('details');

  const changeTab = (key) => { setTab(key); setPage(1); };

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(SHARE_LINK); } catch { /* the link is visible to select */ }
  };
  const shareWhatsApp = () => {
    const text = `Have a property or want to open a Mystery Rooms? Tell us here: ${SHARE_LINK}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  };

  return (
    <>
      <Topbar title="Property Capture" />
      <div className="content">
        <div className="content-wide col gap-4 fade-in">
          <PhaseHero
            icon={Inbox}
            title="Property Capture"
            subtitle="Capture opportunities from interested partners, property owners or external sources."
            quote="Every great Mystery Room starts with the right location."
            phaseKey="capture"
          />

          <div className="row gap-4 wrap" style={{ alignItems: 'stretch' }}>
            <div className="fms-stat-grid" style={{ flex: '2 1 480px' }}>
              <StatTile icon={Users} value={counts['interested-lead']} label="Interested Leads" sub="People interested, no property yet" tone={STAT_TONES.indigo} onClick={() => changeTab('interested-lead')} />
              <StatTile icon={Building2} value={counts['interested-property']} label="Interested + Property" sub="Partners who already have a property" tone={STAT_TONES.gold} onClick={() => changeTab('interested-property')} />
              <StatTile icon={Landmark} value={counts['property-opportunity']} label="Property Opportunities" sub="Submitted by owners, brokers or others" tone={STAT_TONES.blue} onClick={() => changeTab('property-opportunity')} />
            </div>

            <div className="fms-share-card" style={{ flex: '1.2 1 320px' }}>
              <div className="row gap-2" style={{ alignItems: 'center', marginBottom: 10 }}>
                <Link2 size={16} style={{ color: 'var(--success)' }} />
                <b className="sm">Share Submission Link</b>
              </div>
              <p className="sm muted" style={{ margin: '0 0 10px' }}>
                Share this link with brokers, partners or anyone to submit a property opportunity.
              </p>
              <div className="fms-share-link">
                <code>{SHARE_LINK}</code>
                <button type="button" className="btn btn-subtle btn-sm" onClick={copyLink}><Copy size={12} /> Copy</button>
              </div>
              <div className="fms-share-socials" style={{ marginTop: 10 }}>
                <button type="button" title="Share on WhatsApp" onClick={shareWhatsApp}><MessageCircle size={15} /></button>
                <button type="button" title="Share on LinkedIn"><Linkedin size={15} /></button>
                <button type="button" title="Share on Facebook"><Facebook size={15} /></button>
                <button type="button" title="Share on X"><Twitter size={15} /></button>
                <button type="button" title="Open link" onClick={copyLink} style={{ marginLeft: 'auto' }}><Share2 size={15} /></button>
              </div>
            </div>
          </div>

          <PhaseStepper activeKey="capture" />

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
                    <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search by name, location, property…" />
                  </div>
                  <button type="button" className="btn btn-subtle btn-sm">Export</button>
                </div>
              </div>
            </div>

            <div className="fms-split" style={{ padding: 'var(--space-3) var(--space-4) var(--space-4)' }}>
              <div className="fms-split-main col gap-3">
                {pageRows.length === 0 ? (
                  <EmptyState icon={Inbox} title="Nothing here yet" hint="Try another tab or clear the search." />
                ) : (
                  <div className="fms-table-wrap">
                    <table className="table table-clickable">
                      <thead>
                        <tr>
                          <th>Type</th>
                          <th>Person / Property</th>
                          <th>Key Details</th>
                          <th>Location</th>
                          <th>Submitted On</th>
                          <th>Status</th>
                          <th style={{ width: 90 }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pageRows.map((o) => {
                          const typeMeta = SUBMISSION_TYPE_META[o.submissionType];
                          const statusMeta = CAPTURE_STATUS_META[o.captureStatus] || CAPTURE_STATUS_META.pending;
                          return (
                            <tr
                              key={o.id}
                              className={`fms-row-select${selectedId === o.id ? ' is-selected' : ''}`}
                              onClick={() => { setSelectedId(o.id); setDetailTab('details'); }}
                            >
                              <td><Badge color={typeMeta.color} dot>{typeMeta.label}</Badge></td>
                              <td>
                                <div className="col" style={{ gap: 1 }}>
                                  <span style={{ fontWeight: 650 }}>{o.name}</span>
                                  <span className="tiny muted">{o.phone}</span>
                                </div>
                              </td>
                              <td><span className="sm">{keyDetails(o)}</span></td>
                              <td><span className="sm">{o.city}{o.state ? `, ${o.state}` : ''}</span></td>
                              <td className="tiny muted">{fmtDate(o.submittedOn)}</td>
                              <td><Badge color={statusMeta.color} dot>{statusMeta.label}</Badge></td>
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
                  badge={<Badge color={(CAPTURE_STATUS_META[selected.captureStatus] || CAPTURE_STATUS_META.pending).color}>{(CAPTURE_STATUS_META[selected.captureStatus] || CAPTURE_STATUS_META.pending).label}</Badge>}
                  tabs={[{ key: 'details', label: 'Details' }, { key: 'notes', label: 'Notes' }, { key: 'activity', label: 'Activity' }]}
                  activeTab={detailTab}
                  onTabChange={setDetailTab}
                  onClose={() => setSelectedId(null)}
                  footer={(
                    <>
                      <button type="button" className="btn btn-subtle">View Full Details</button>
                      <button type="button" className="btn btn-primary">Send to Review & Decision</button>
                    </>
                  )}
                >
                  {detailTab === 'details' && (
                    <>
                      <FactSection title="Contact">
                        <Fact icon={Users} label="Name" value={selected.name} />
                        <Fact icon={Phone} label="Phone" value={selected.phone} />
                        <Fact icon={Mail} label="Email" value={selected.email} />
                      </FactSection>
                      <FactSection title="Location">
                        <Fact icon={MapPin} label="Address" value={[selected.locality, selected.city, selected.state].filter(Boolean).join(', ')} />
                      </FactSection>
                      {selected.submissionType === 'interested-lead' ? (
                        <FactSection title="Interest">
                          <Fact icon={Wallet} label="Budget" value={selected.interest?.budget} />
                          <Fact icon={Ruler} label="Space Requirement" value={selected.interest?.spaceReq} />
                          <Fact icon={CalendarClock} label="Target Opening" value={selected.interest?.targetOpening} />
                        </FactSection>
                      ) : (
                        <FactSection title="Property Details">
                          <Fact icon={MapPin} label="Property" value={selected.property?.address} />
                          <Fact icon={Ruler} label="Area" value={selected.property?.areaSqft ? `${fmtNumber(selected.property.areaSqft)} sq.ft` : null} />
                          <Fact icon={Wallet} label="Rent / Value" value={selected.property?.rentPerMonth ? `${fmtCurrency(selected.property.rentPerMonth)} / month` : null} />
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
                        <span className="sm">Submission received</span>
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

export default PropertyCapturePage;
