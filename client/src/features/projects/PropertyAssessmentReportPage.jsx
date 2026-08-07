import { useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, FileDown, Pencil, Shield, Check, Play, Volume2, Landmark, TrendingUp, FileText } from 'lucide-react';
import { isValidId } from '../../lib/id.js';
import { useTemplate } from '../../app/api/templatesApi.js';
import { useRecord, useStageRecords } from '../../app/api/recordsApi.js';
import { useProject, useProjectActivity } from '../../app/api/projectsApi.js';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Badge } from '../../components/ui/primitives.jsx';
import { SkDetail } from '../../components/ui/Skeletons.jsx';
import { fmtDate, fromNow } from '../../lib/format.js';
import { computeScorecard } from './records/scoring.js';

/** Hex color pairing per recommendation tier, matching this report's own
 * inline-hex palette (the shared RECOMMENDATION_META in scoring.js uses CSS
 * custom properties, which don't compose with this page's `${hex}1A` soft-
 * background pattern). Same five tiers scoring.js's recommendationFor()
 * returns. */
const RECOMMENDATION_COLORS = {
  'Highly Recommended': { color: '#059669', bg: '#DCFCE7' },
  Recommended: { color: '#2563EB', bg: '#DBEAFE' },
  Consider: { color: '#D97706', bg: '#FEF3C7' },
  'Low Priority': { color: '#DC2626', bg: '#FEE2E2' },
  'Evaluation Incomplete': { color: '#6B7280', bg: '#F3F4F6' },
};

/** Honest, rubric-level description per recommendation tier — describes what
 * the tier means in this scoring model, never a specific unverified claim
 * about this particular property (no "exhibits exceptional market
 * potential" unless that's actually derived from real submitted data). */
const RECOMMENDATION_COPY = {
  'Highly Recommended': 'This property scores 85 or above on the weighted Feasibility, Financial, Technical and Operational evaluation — the strongest tier in this scoring model.',
  Recommended: 'This property scores 70–84 overall on the weighted evaluation — meets the bar to proceed, with room to strengthen any lower-scoring section.',
  Consider: 'This property scores 50–69 overall on the weighted evaluation — proceed only after addressing the weaker-scoring sections below.',
  'Low Priority': 'This property scores below 50 overall on the weighted evaluation — significant concerns in one or more sections.',
  'Evaluation Incomplete': 'Not every Site Evaluation section has an Approved submission yet, so an overall score cannot be computed.',
};

export function PropertyAssessmentReportPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  // Extract propertyId from the query string — this page is only ever
  // linked to with it present (see PropertyEvaluationPage.jsx), so no
  // localStorage fallback is needed (nothing in the app ever wrote one).
  const queryParams = new URLSearchParams(location.search);
  const propertyId = queryParams.get('propertyId') || '';

  const { data: project, isLoading: projectLoading } = useProject(id);
  const { data: property, isLoading: propertyLoading } = useRecord(propertyId, { enabled: isValidId(propertyId) });
  const { data: allRecords, isLoading: recordsLoading } = useStageRecords(id, 'p2', { parentRecordId: propertyId }, { enabled: isValidId(id) && isValidId(propertyId) });
  const { data: activities } = useProjectActivity(id);

  const templateId = project?.template?.ref?._id || project?.template?.ref;
  const { data: template } = useTemplate(templateId, { enabled: isValidId(templateId) });

  const [activeMediaTab, setActiveMediaTab] = useState('images');

  if (projectLoading || propertyLoading || recordsLoading || !property) {
    return (
      <>
        <Topbar title="Assessment Report" />
        <div className="content">
          <SkDetail />
        </div>
      </>
    );
  }

  const stage = template?.stages?.find((s) => s.key === 'p2');
  const assessmentTypes = stage?.assessmentTypes || [];

  // Map assessment records by type key
  const recordsMap = {};
  assessmentTypes.forEach((type) => {
    const typeRecords = (allRecords || [])
      .filter((r) => r.assessmentType === type.key)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    recordsMap[type.key] = typeRecords[0] || null;
  });

  const feasibility = recordsMap['feasibility'];
  const financial = recordsMap['financial'];
  const technical = recordsMap['technical'];
  const operational = recordsMap['operational'];

  // Combined stats
  const roi = financial?.values?.roi || 0;
  const paybackMonths = financial?.values?.payback_period || 0;

  // Real scoring — the same engine (records/scoring.js) every other Site
  // Evaluation surface uses (comparison table, PropertyEvaluationPage KPI
  // cards). Overall Score stays null (renders "—") until every section has
  // an Approved submission — never a fabricated placeholder number.
  const assessmentTypeKeys = assessmentTypes.length ? assessmentTypes.map((t) => t.key) : ['feasibility', 'financial', 'technical', 'operational'];
  const scorecard = computeScorecard(property, allRecords || [], assessmentTypeKeys);
  const overallScore = scorecard.overallScore;
  const recommendation = scorecard.recommendation;
  const recMeta = RECOMMENDATION_COLORS[recommendation] || RECOMMENDATION_COLORS['Evaluation Incomplete'];
  const recommendationColor = recMeta.color;
  const recommendationBg = recMeta.bg;
  const recommendationDesc = RECOMMENDATION_COPY[recommendation] || RECOMMENDATION_COPY['Evaluation Incomplete'];

  // Merge attachments
  let allAttachments = [];
  allRecords?.forEach((r) => {
    if (r.attachments) allAttachments = [...allAttachments, ...r.attachments];
  });
  const seenUrls = new Set();
  const uniqueAttachments = allAttachments.filter((a) => {
    if (seenUrls.has(a.url)) return false;
    seenUrls.add(a.url);
    return true;
  });

  const images = uniqueAttachments.filter((a) => a.mimetype?.startsWith('image/'));
  const docs = uniqueAttachments.filter((a) => a.mimetype?.includes('pdf') || a.mimetype?.includes('word') || a.mimetype?.includes('sheet') || a.mimetype?.includes('zip') || (!a.mimetype?.startsWith('image/') && !a.mimetype?.startsWith('video/') && !a.mimetype?.startsWith('audio/')));
  const videos = uniqueAttachments.filter((a) => a.mimetype?.startsWith('video/'));
  const audios = uniqueAttachments.filter((a) => a.mimetype?.startsWith('audio/'));

  // Activity Log
  const p2RecordIds = new Set((allRecords || []).map((r) => String(r._id)));
  const stageActivities = (activities || [])
    .filter((a) => p2RecordIds.has(a.meta?.recordId) || a.meta?.parentRecordId === propertyId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const handleBack = () => navigate(-1);
  const handleEdit = () => navigate(`/projects/${id}/site-evaluation/${propertyId}`);

  const handlePrint = () => {
    window.print();
  };

  return (
    <>
      <Topbar
        title={
          <span className="row gap-3 no-print">
            <button className="btn btn-ghost btn-icon" onClick={handleBack} aria-label="Back">
              <ArrowLeft size={16} />
            </button>
            Site Evaluation Report
          </span>
        }
        subtitle={`${property.title} · Audit Dossier`}
      />

      <div className="content" style={{ background: '#F8FAFC', minHeight: 'calc(100vh - var(--topbar-height))', padding: '24px 0 80px 0' }}>

        {/* Sticky Action Bar at the top, hidden when printing */}
        <div className="no-print" style={{ maxWidth: 1000, margin: '0 auto 16px auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 16px' }}>
          <button type="button" className="btn btn-ghost" onClick={handleBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderColor: '#D1D5DB', background: '#fff' }}>
            <ArrowLeft size={15} /> Back
          </button>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="btn btn-ghost" onClick={handlePrint} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderColor: '#D1D5DB', background: '#fff' }}>
              <FileDown size={15} /> Export PDF
            </button>
            <button type="button" className="btn btn-primary" onClick={handleEdit} style={{ background: '#2563EB', display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none' }}>
              <Pencil size={14} /> Edit Assessment
            </button>
          </div>
        </div>

        {/* ONE continuous paper sheet */}
        <div className="report-sheet">

          {/* Header block / Dossier Cover Meta */}
          <div className="report-section" style={{ borderBottom: '2px solid #1A202C', paddingBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h1 style={{ fontSize: 24, fontWeight: 800, color: '#111827', margin: 0, textTransform: 'uppercase', letterSpacing: '-0.02em' }}>
                  Site Evaluation Report
                </h1>
                <span style={{ fontSize: 13, color: '#4B5563', fontWeight: 650, marginTop: 4, display: 'block' }}>
                  Dossier Ref: {property.seq ? `MR-PMS-${property.seq}` : '—'}
                </span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase' }}>Overall Score</span>
                <strong style={{ fontSize: 28, color: '#2563EB', display: 'block', fontWeight: 800, marginTop: 2 }}>{overallScore != null ? `${overallScore} / 100` : '—'}</strong>
              </div>
            </div>
          </div>

          {/* Audit Metadata Info */}
          <div className="report-section" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, padding: '12px 0', borderBottom: '1px dashed #E2E8F0' }}>
            <div className="col gap-0.5">
              <span className="tiny muted">Project Name</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{project.title}</span>
            </div>
            <div className="col gap-0.5">
              <span className="tiny muted">Property Name</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{property.title}</span>
            </div>
            <div className="col gap-0.5">
              <span className="tiny muted">Submitted By</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{feasibility?.submittedBy?.name || project.owner?.name || '—'}</span>
            </div>
            <div className="col gap-0.5">
              <span className="tiny muted">Generated On</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{fmtDate(new Date())}</span>
            </div>
          </div>

          {/* Executive Summary Section */}
          <div className="report-section" style={{ marginTop: 24 }}>
            <h2 className="report-h2">I. Executive Summary</h2>
            <hr className="report-divider" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 3fr', gap: 16, alignItems: 'start' }}>
              <div className="col gap-2">
                <div className="col gap-0.5">
                  <span className="tiny muted">Decision Status</span>
                  <div><Badge color={recommendationColor} soft={recommendationBg}>{recommendation}</Badge></div>
                </div>
                <div className="col gap-0.5">
                  <span className="tiny muted">Return on Investment Estimate</span>
                  <strong style={{ fontSize: 15, color: '#111827' }}>{roi ? `${roi}%` : '—'}</strong>
                </div>
                <div className="col gap-0.5">
                  <span className="tiny muted">Estimated Investment Recovery Time</span>
                  <strong style={{ fontSize: 15, color: '#111827' }}>{paybackMonths ? `${paybackMonths} Months` : '—'}</strong>
                </div>
              </div>
              <div style={{ padding: '8px 16px', background: '#F8FAFC', borderLeft: `4px solid ${recommendationColor}`, minHeight: 100 }}>
                <strong style={{ fontSize: 13, color: '#111827', display: 'block', marginBottom: 4 }}>Dossier Finding Details</strong>
                <p style={{ fontSize: 13.5, color: '#4B5563', lineHeight: 1.5, margin: 0 }}>
                  {recommendationDesc}
                </p>
              </div>
            </div>
          </div>

          {/* Property Information Section */}
          <div className="report-section" style={{ marginTop: 24 }}>
            <h2 className="report-h2">II. Property Parameters</h2>
            <hr className="report-divider" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 40px' }}>
              <div className="row between"><span className="report-title-label">Property Title</span><span className="report-value-text">{property.title}</span></div>
              <div className="row between"><span className="report-title-label">City / Locality</span><span className="report-value-text">{property.values?.city || '—'} / {property.values?.locality || '—'}</span></div>
              <div className="row between"><span className="report-title-label">Total Floor Area</span><span className="report-value-text">{property.values?.areaSqft ? `${property.values.areaSqft} Sq.ft` : '—'}</span></div>
              <div className="row between"><span className="report-title-label">Floor Number</span><span className="report-value-text">{property.values?.floor || 'Ground'}</span></div>
              <div className="row between"><span className="report-title-label">Monthly Rental</span><span className="report-value-text">₹{Number(property.values?.monthlyRent || 0).toLocaleString('en-IN')}</span></div>
              <div className="row between"><span className="report-title-label">Security Deposit</span><span className="report-value-text">₹{Number(property.values?.securityDeposit || 0).toLocaleString('en-IN')}</span></div>
              <div className="row between"><span className="report-title-label">Landlord Name</span><span className="report-value-text">{property.values?.ownerName || '—'}</span></div>
              <div className="row between"><span className="report-title-label">Broker Partner</span><span className="report-value-text">{project.broker?.name || '—'}</span></div>
            </div>
          </div>

          {/* Feasibility Assessment Section */}
          <div className="report-section" style={{ marginTop: 24 }}>
            <h2 className="report-h2">III. Feasibility Assessment</h2>
            <hr className="report-divider" />
            {feasibility ? (
              <div className="col gap-3">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 40px' }}>
                  <div className="row between"><span className="report-title-label">Purpose</span><span className="report-value-text">{feasibility.values?.purpose || '—'}</span></div>
                  <div className="row between"><span className="report-title-label">Market Potential</span><span className="report-value-text">{feasibility.values?.market_potential || '—'}</span></div>
                  <div className="row between"><span className="report-title-label">Footfall Assessment</span><span className="report-value-text">{feasibility.values?.footfall_assessment || 0} / 10</span></div>
                  <div className="row between"><span className="report-title-label">Accessibility</span><span className="report-value-text">{feasibility.values?.accessibility || '—'}</span></div>
                  <div className="row between"><span className="report-title-label">Target Demographics</span><span className="report-value-text">{feasibility.values?.target_audience || '—'}</span></div>
                  <div className="row between"><span className="report-title-label">Expansion Potential</span><span className="report-value-text">{feasibility.values?.expansion_potential || '—'}</span></div>
                </div>
                <div className="col gap-1" style={{ marginTop: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#4A5568' }}>Remarks & Competitor Notes</span>
                  <p style={{ fontSize: 13, color: '#4B5563', lineHeight: 1.4, margin: 0 }}>
                    {feasibility.values?.competitor_analysis || 'No competitor notes provided.'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="empty sm" style={{ padding: '8px 0' }}>Feasibility record has not been completed.</div>
            )}
          </div>

          {/* Financial Assessment Section */}
          <div className="report-section" style={{ marginTop: 24 }}>
            <h2 className="report-h2">IV. Financial Feasibility</h2>
            <hr className="report-divider" />
            {financial ? (
              <div className="col gap-3">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 40px' }}>
                  <div className="row between"><span className="report-title-label">Purpose</span><span className="report-value-text">{financial.values?.purpose || '—'}</span></div>
                  <div className="row between"><span className="report-title-label">Estimated Setup Cost</span><span className="report-value-text">₹{Number(financial.values?.estimated_investment || 0).toLocaleString('en-IN')}</span></div>
                  <div className="row between"><span className="report-title-label">Projected Revenue</span><span className="report-value-text">₹{Number(financial.values?.monthly_revenue || 0).toLocaleString('en-IN')}</span></div>
                  <div className="row between"><span className="report-title-label">Target Return on Investment (%)</span><span className="report-value-text">{financial.values?.roi || 0} %</span></div>
                  <div className="row between"><span className="report-title-label">Investment Recovery Time (Months)</span><span className="report-value-text">{financial.values?.payback_period || 0} Months</span></div>
                  <div className="row between"><span className="report-title-label">Profit Margin (%)</span><span className="report-value-text">{financial.values?.profit_margin != null ? `${financial.values.profit_margin} %` : '—'}</span></div>
                  <div className="row between"><span className="report-title-label">Financial Risk</span><span className="report-value-text">{financial.values?.financial_risk || '—'}</span></div>
                </div>
                <div className="col gap-1" style={{ marginTop: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#4A5568' }}>Financial Remarks</span>
                  <p style={{ fontSize: 13, color: '#4B5563', lineHeight: 1.4, margin: 0 }}>
                    {financial.values?.financial_remarks || 'No financial remarks.'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="empty sm" style={{ padding: '8px 0' }}>Financial record has not been completed.</div>
            )}
          </div>

          {/* Technical Assessment Section */}
          <div className="report-section" style={{ marginTop: 24 }}>
            <h2 className="report-h2">V. Technical Assessment</h2>
            <hr className="report-divider" />
            {technical ? (
              <div className="col gap-3">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 40px' }}>
                  <div className="row between"><span className="report-title-label">Purpose</span><span className="report-value-text">{technical.values?.purpose || '—'}</span></div>
                  <div className="row between"><span className="report-title-label">Building Condition</span><span className="report-value-text">{technical.values?.building_condition || '—'}</span></div>
                  <div className="row between"><span className="report-title-label">Civil</span><span className="report-value-text">{technical.values?.civil_condition || '—'}</span></div>
                  <div className="row between"><span className="report-title-label">Electrical Power (kW)</span><span className="report-value-text">{technical.values?.electrical_capacity || '—'} kW</span></div>
                  <div className="row between"><span className="report-title-label">HVAC</span><span className="report-value-text">{technical.values?.hvac || '—'}</span></div>
                  <div className="row between"><span className="report-title-label">Water Source</span><span className="report-value-text">{technical.values?.water_supply || '—'}</span></div>
                  <div className="row between"><span className="report-title-label">Fire Compliance</span><span className="report-value-text">{technical.values?.fire_safety || '—'}</span></div>
                  <div className="row between"><span className="report-title-label">Parking</span><span className="report-value-text">{technical.values?.parking || '—'}</span></div>
                  <div className="row between"><span className="report-title-label">Maintenance</span><span className="report-value-text">{technical.values?.maintenance || '—'}</span></div>
                </div>
                <div className="col gap-1" style={{ marginTop: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#4A5568' }}>Structural Comments</span>
                  <p style={{ fontSize: 13, color: '#4B5563', lineHeight: 1.4, margin: 0 }}>
                    {technical.values?.structural_assessment || 'No technical remarks.'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="empty sm" style={{ padding: '8px 0' }}>Technical record has not been completed.</div>
            )}
          </div>

          {/* Operational Assessment Section */}
          <div className="report-section" style={{ marginTop: 24 }}>
            <h2 className="report-h2">VI. Operational Readiness</h2>
            <hr className="report-divider" />
            {operational ? (
              <div className="col gap-3">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 40px' }}>
                  <div className="row between"><span className="report-title-label">Purpose</span><span className="report-value-text">{operational.values?.purpose || '—'}</span></div>
                  <div className="row between"><span className="report-title-label">Staffing Plan</span><span className="report-value-text">{operational.values?.staff_requirement || '—'}</span></div>
                  <div className="row between"><span className="report-title-label">Operational Hours</span><span className="report-value-text">{operational.values?.operating_hours || '—'}</span></div>
                  <div className="row between"><span className="report-title-label">Operations Readiness</span><span className="report-value-text">{operational.values?.operations_readiness || '—'}</span></div>
                  <div className="row between"><span className="report-title-label">Security Plan</span><span className="report-value-text">{operational.values?.security || '—'}</span></div>
                  <div className="row between"><span className="report-title-label">Inventory</span><span className="report-value-text">{operational.values?.inventory || '—'}</span></div>
                  <div className="row between"><span className="report-title-label">Training</span><span className="report-value-text">{operational.values?.training || '—'}</span></div>
                  <div className="row between"><span className="report-title-label">Vendors Onboard</span><span className="report-value-text">{operational.values?.vendor_availability || '—'}</span></div>
                </div>
                <div className="col gap-1" style={{ marginTop: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#4A5568' }}>Customer Flow</span>
                  <p style={{ fontSize: 13, color: '#4B5563', lineHeight: 1.4, margin: 0 }}>
                    {operational.values?.customer_flow || 'No customer flow notes provided.'}
                  </p>
                </div>
                <div className="col gap-1" style={{ marginTop: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#4A5568' }}>Operational Comments</span>
                  <p style={{ fontSize: 13, color: '#4B5563', lineHeight: 1.4, margin: 0 }}>
                    {operational.values?.operational_remarks || 'No operational remarks.'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="empty sm" style={{ padding: '8px 0' }}>Operational record has not been completed.</div>
            )}
          </div>

          {/* Assessment Comparison Table */}
          <div className="report-section" style={{ marginTop: 24 }}>
            <h2 className="report-h2">VII. Assessment Matrix</h2>
            <hr className="report-divider" />
            <table className="table" style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #E2E8F0', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#F8FAFC', borderBottom: '1px solid #E2E8F0', height: 34 }}>
                  <th style={{ padding: '8px 12px' }}>Assessment Domain</th>
                  <th style={{ padding: '8px 12px' }}>Section Score</th>
                  <th style={{ padding: '8px 12px' }}>Submission Status</th>
                  <th style={{ padding: '8px 12px' }}>Key Findings</th>
                </tr>
              </thead>
              <tbody style={{ textAlign: 'left' }}>
                <tr style={{ borderBottom: '1px solid #E2E8F0', height: 34 }}>
                  <td style={{ padding: '8px 12px', fontWeight: 650 }}>Feasibility & Traffic</td>
                  <td style={{ padding: '8px 12px' }}>{scorecard.sections.feasibility?.percent != null ? `${scorecard.sections.feasibility.percent}%` : '—'}</td>
                  <td style={{ padding: '8px 12px' }}><Badge color={feasibility ? '#059669' : '#6B7280'} soft={feasibility ? '#DCFCE7' : '#F3F4F6'}>{feasibility ? 'Completed' : 'Pending'}</Badge></td>
                  <td style={{ padding: '8px 12px', color: '#4B5563' }}>{feasibility?.values?.remarks || '—'}</td>
                </tr>
                <tr style={{ borderBottom: '1px solid #E2E8F0', height: 34 }}>
                  <td style={{ padding: '8px 12px', fontWeight: 650 }}>Financials & Setup Cost</td>
                  <td style={{ padding: '8px 12px' }}>{scorecard.sections.financial?.percent != null ? `${scorecard.sections.financial.percent}%` : '—'}</td>
                  <td style={{ padding: '8px 12px' }}><Badge color={financial ? '#059669' : '#6B7280'} soft={financial ? '#DCFCE7' : '#F3F4F6'}>{financial ? 'Completed' : 'Pending'}</Badge></td>
                  <td style={{ padding: '8px 12px', color: '#4B5563' }}>{financial?.values?.financial_remarks || '—'}</td>
                </tr>
                <tr style={{ borderBottom: '1px solid #E2E8F0', height: 34 }}>
                  <td style={{ padding: '8px 12px', fontWeight: 650 }}>Technical & Utilities</td>
                  <td style={{ padding: '8px 12px' }}>{scorecard.sections.technical?.percent != null ? `${scorecard.sections.technical.percent}%` : '—'}</td>
                  <td style={{ padding: '8px 12px' }}><Badge color={technical ? '#059669' : '#6B7280'} soft={technical ? '#DCFCE7' : '#F3F4F6'}>{technical ? 'Completed' : 'Pending'}</Badge></td>
                  <td style={{ padding: '8px 12px', color: '#4B5563' }}>{technical?.values?.structural_assessment || '—'}</td>
                </tr>
                <tr style={{ height: 34 }}>
                  <td style={{ padding: '8px 12px', fontWeight: 650 }}>Operations & Logistics</td>
                  <td style={{ padding: '8px 12px' }}>{scorecard.sections.operational?.percent != null ? `${scorecard.sections.operational.percent}%` : '—'}</td>
                  <td style={{ padding: '8px 12px' }}><Badge color={operational ? '#059669' : '#6B7280'} soft={operational ? '#DCFCE7' : '#F3F4F6'}>{operational ? 'Completed' : 'Pending'}</Badge></td>
                  <td style={{ padding: '8px 12px', color: '#4B5563' }}>{operational?.values?.operational_remarks || '—'}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Consolidated Attachments Section */}
          <div className="report-section" style={{ marginTop: 24 }}>
            <h2 className="report-h2">VIII. Attachments & Records</h2>
            <hr className="report-divider" />

            {/* Tab buttons only visible on screen, hidden on print */}
            <div className="no-print" style={{ display: 'flex', gap: 20, borderBottom: '1px solid #E5E7EB', marginBottom: 20 }}>
              <button type="button" onClick={() => setActiveMediaTab('images')} style={{ paddingBottom: 10, fontWeight: 650, fontSize: 13.5, color: activeMediaTab === 'images' ? '#2563EB' : '#6B7280', borderBottom: activeMediaTab === 'images' ? '2px solid #2563EB' : '2px solid transparent', background: 'none' }}>
                Images ({images.length})
              </button>
              <button type="button" onClick={() => setActiveMediaTab('documents')} style={{ paddingBottom: 10, fontWeight: 650, fontSize: 13.5, color: activeMediaTab === 'documents' ? '#2563EB' : '#6B7280', borderBottom: activeMediaTab === 'documents' ? '2px solid #2563EB' : '2px solid transparent', background: 'none' }}>
                Documents ({docs.length})
              </button>
              <button type="button" onClick={() => setActiveMediaTab('videos')} style={{ paddingBottom: 10, fontWeight: 650, fontSize: 13.5, color: activeMediaTab === 'videos' ? '#2563EB' : '#6B7280', borderBottom: activeMediaTab === 'videos' ? '2px solid #2563EB' : '2px solid transparent', background: 'none' }}>
                Videos ({videos.length})
              </button>
              <button type="button" onClick={() => setActiveMediaTab('audio')} style={{ paddingBottom: 10, fontWeight: 650, fontSize: 13.5, color: activeMediaTab === 'audio' ? '#2563EB' : '#6B7280', borderBottom: activeMediaTab === 'audio' ? '2px solid #2563EB' : '2px solid transparent', background: 'none' }}>
                Audio ({audios.length})
              </button>
            </div>

            {/* Screen layout shows active tab; Print layout prints ALL attachment blocks in sequence */}
            <div>
              {/* Images block */}
              <div style={{ display: activeMediaTab === 'images' ? 'block' : 'none' }} className="print-show">
                {images.length ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 16 }}>
                    {images.map((img, i) => (
                      <div key={i} style={{ padding: 8, border: '1px solid #E5E7EB', background: '#F9FAFB', borderRadius: 4, display: 'flex', flexDirection: 'column' }}>
                        <div style={{ height: 90, overflow: 'hidden', background: '#E5E7EB' }}>
                          <img src={img.url} alt={img.originalName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', marginTop: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>
                          {img.originalName}
                        </span>
                        <a href={img.url} download className="btn btn-sm btn-ghost no-print" style={{ fontSize: 10, padding: '3px 0', border: '1px solid #E5E7EB', background: '#fff', marginTop: 8 }}>
                          Download
                        </a>
                      </div>
                    ))}
                  </div>
                ) : <span className="tiny muted">No images attached.</span>}
              </div>

              {/* Documents block */}
              <div style={{ display: activeMediaTab === 'documents' ? 'block' : 'none', marginTop: 12 }} className="print-show">
                {docs.length ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
                    {docs.map((doc, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, border: '1px solid #E5E7EB', borderRadius: 6, background: '#F9FAFB' }}>
                        <FileText size={18} color="#DC2626" />
                        <div className="col grow" style={{ minWidth: 0, textAlign: 'left' }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {doc.originalName}
                          </span>
                        </div>
                        <a href={doc.url} download className="btn btn-ghost btn-icon no-print" style={{ borderColor: '#E5E7EB', background: '#fff' }}>
                          <FileDown size={14} />
                        </a>
                      </div>
                    ))}
                  </div>
                ) : <span className="tiny muted">No documents attached.</span>}
              </div>

              {/* Videos block */}
              <div style={{ display: activeMediaTab === 'videos' ? 'block' : 'none', marginTop: 12 }} className="print-show">
                {videos.length ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
                    {videos.map((vid, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, border: '1px solid #E5E7EB', borderRadius: 6, background: '#F9FAFB' }}>
                        <Play size={18} color="#2563EB" />
                        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {vid.originalName}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : <span className="tiny muted">No videos attached.</span>}
              </div>

              {/* Audio block */}
              <div style={{ display: activeMediaTab === 'audio' ? 'block' : 'none', marginTop: 12 }} className="print-show">
                {audios.length ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
                    {audios.map((aud, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, border: '1px solid #E5E7EB', borderRadius: 6, background: '#F9FAFB' }}>
                        <Volume2 size={18} color="#0284C7" />
                        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {aud.originalName}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : <span className="tiny muted">No audio files attached.</span>}
              </div>
            </div>
          </div>

          {/* Activity History Section */}
          <div className="report-section" style={{ marginTop: 24 }}>
            <h2 className="report-h2">IX. Audit Activity Log</h2>
            <hr className="report-divider" />
            {stageActivities.length ? (
              <div className="col gap-3" style={{ textAlign: 'left', fontSize: 12.5, color: '#4B5563' }}>
                {stageActivities.slice(0, 4).map((act) => (
                  <div key={act._id} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed #F1F5F9', paddingBottom: 6 }}>
                    <div>
                      <strong>{act.message}</strong>
                      <span style={{ fontSize: 11, color: '#9CA3AF', marginLeft: 8 }}>by {act.actor?.name || 'System'}</span>
                    </div>
                    <span style={{ fontSize: 11.5, color: '#9CA3AF' }}>{fmtDate(act.createdAt)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <span className="tiny muted">No activity logs recorded.</span>
            )}
          </div>

          {/* Footer Signature Block — every name here is a real person off the
              real project/property record (owner, or whoever actually
              decided the property at Site Evaluation), never an invented
              approver. Blank until that real decision exists. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20, borderTop: '2px solid #1A202C', paddingTop: 30, marginTop: 40, fontSize: 12, color: '#4B5563' }}>
            <div>
              <span>Report Prepared By:</span>
              <strong style={{ display: 'block', color: '#111827', marginTop: 4 }}>{project.owner?.name || '—'}</strong>
              <span style={{ fontSize: 10 }}>{project.owner?.title || ''}</span>
            </div>
            <div>
              <span>Operations Approval:</span>
              <strong style={{ display: 'block', color: '#111827', marginTop: 4 }}>{property.decidedBy?.name || 'Pending'}</strong>
              <span style={{ fontSize: 10 }}>{property.decidedBy?.title || ''}</span>
            </div>
            <div>
              <span>Audit Version:</span>
              <strong style={{ display: 'block', color: '#111827', marginTop: 4 }}>v1.0 (Consolidated)</strong>
            </div>
            <div>
              <span>Verification Date:</span>
              <strong style={{ display: 'block', color: '#111827', marginTop: 4 }}>{fmtDate(new Date())}</strong>
            </div>
          </div>

          {/* Signature lines — blank space above a rule for a physical / e-sign
              on the printed or exported dossier. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 64, marginTop: 48, fontSize: 12, color: '#4B5563' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ height: 52 }} />
              <div style={{ borderTop: '1.5px solid #1A202C', paddingTop: 8 }}>
                <strong style={{ color: '#111827', display: 'block' }}>{project.owner?.name || '—'}</strong>
                <span style={{ fontSize: 10 }}>Report Prepared By — Signature &amp; Date</span>
              </div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ height: 52 }} />
              <div style={{ borderTop: '1.5px solid #1A202C', paddingTop: 8 }}>
                <strong style={{ color: '#111827', display: 'block' }}>{property.decidedBy?.name || '—'}</strong>
                <span style={{ fontSize: 10 }}>Operations Approval — Signature &amp; Date</span>
              </div>
            </div>
          </div>

        </div>

      </div>
    </>
  );
}

export default PropertyAssessmentReportPage;
