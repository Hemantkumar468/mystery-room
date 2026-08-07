import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, FileDown, Pencil, FileText, CheckCircle2, AlertCircle, Clock, Check, Play, Volume2, Paperclip, ChevronRight } from 'lucide-react';
import { isValidId } from '../../lib/id.js';
import { useTemplate } from '../../app/api/templatesApi.js';
import { useRecord, useStageRecords } from '../../app/api/recordsApi.js';
import { useProject, useProjectActivity } from '../../app/api/projectsApi.js';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { SectionCard, Badge, Avatar } from '../../components/ui/primitives.jsx';
import { SkDetail } from '../../components/ui/Skeletons.jsx';
import { fmtDateTime, fmtDate, fromNow } from '../../lib/format.js';

export function AssessmentReportPage() {
  const { id, propertyId, recordId } = useParams();
  const navigate = useNavigate();

  const { data: project, isLoading: projectLoading } = useProject(id);
  const { data: record, isLoading: recordLoading } = useRecord(recordId);
  const { data: property } = useRecord(propertyId);

  const templateId = project?.template?.ref?._id || project?.template?.ref;
  const { data: template } = useTemplate(templateId);
  const { data: activities } = useProjectActivity(id);
  const { data: allRecords } = useStageRecords(id, 'p2', { parentRecordId: propertyId }, { enabled: isValidId(id) && isValidId(propertyId) });

  const [activeTab, setActiveTab] = useState('images'); // 'images', 'documents', 'videos', 'audio'

  if (projectLoading || recordLoading || !record) {
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
  const type = stage?.assessmentTypes?.find((t) => t.key === record.assessmentType);
  const title = type ? `${type.name} Assessment Report` : 'Assessment Report';

  // Get submission number
  const sameTypeRecords = (allRecords || [])
    .filter((r) => r.assessmentType === record.assessmentType)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const subIdx = sameTypeRecords.findIndex((r) => String(r._id) === String(record._id));
  const submissionNo = subIdx >= 0 ? subIdx + 1 : 1;

  // Resolve Edited/Completed status
  const createdTime = new Date(record.createdAt).getTime();
  const updatedTime = new Date(record.updatedAt).getTime();
  const isEdited = updatedTime - createdTime > 1000;

  const statusLabel = isEdited ? 'Edited' : 'Completed';
  const statusColor = isEdited ? '#2563EB' : '#059669';
  const statusSoft = isEdited ? '#DBEAFE' : '#DCFCE7';

  // Group attachments
  const attachments = record.attachments || [];
  const images = attachments.filter((a) => a.mimetype?.startsWith('image/'));
  const docs = attachments.filter((a) => a.mimetype?.includes('pdf') || a.mimetype?.includes('word') || a.mimetype?.includes('sheet') || a.mimetype?.includes('zip') || (!a.mimetype?.startsWith('image/') && !a.mimetype?.startsWith('video/') && !a.mimetype?.startsWith('audio/')));
  const videos = attachments.filter((a) => a.mimetype?.startsWith('video/'));
  const audios = attachments.filter((a) => a.mimetype?.startsWith('audio/'));

  // Activity log for this assessment record
  const recordActivities = (activities || [])
    .filter((a) => a.meta?.recordId === recordId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const handleBack = () => navigate(-1);
  const handleEdit = () => navigate(`/projects/${id}/site-evaluation/${propertyId}`, { state: { editRecordId: recordId } });

  const handleDownloadPDF = () => {
    alert('Generating PDF Report... The download will start automatically.');
    window.print();
  };

  // Render values helper
  const renderFieldValue = (field) => {
    const val = record.values?.[field.key];
    if (val === undefined || val === null || val === '') return '—';

    // Badge styling for common options
    if (['high', 'low', 'medium', 'excellent', 'good', 'average', 'poor', 'compliant', 'not compliant', 'yes', 'no'].includes(String(val).toLowerCase())) {
      let color = '#6B7280';
      let soft = '#F3F4F6';

      if (['high', 'excellent', 'compliant', 'yes', 'good'].includes(String(val).toLowerCase())) {
        color = '#059669';
        soft = '#DCFCE7';
      } else if (['medium', 'average'].includes(String(val).toLowerCase())) {
        color = '#D97706';
        soft = '#FEF3C7';
      } else if (['low', 'poor', 'not compliant', 'no'].includes(String(val).toLowerCase())) {
        color = '#DC2626';
        soft = '#FEE2E2';
      }

      return <Badge color={color} soft={soft}>{String(val)}</Badge>;
    }

    if (field.type === 'currency') {
      return <span>₹{Number(val).toLocaleString('en-IN')}</span>;
    }

    return <span style={{ fontWeight: 600, color: 'var(--text)' }}>{String(val)}</span>;
  };

  // Total Score / Priority — real submitted values only. No fallback numbers:
  // a blank footfall/ROI field means the report shows "—", not an invented
  // "looks fine" figure.
  let totalScore = '—';
  let priority = null;
  if (record.assessmentType === 'feasibility') {
    totalScore = typeof record.values?.footfall_assessment === 'number' || record.values?.footfall_assessment
      ? `${record.values.footfall_assessment} / 10` : '—';
    priority = record.values?.market_potential || null;
  } else if (record.assessmentType === 'financial') {
    totalScore = record.values?.roi ? `${record.values.roi}% Return on Investment` : '—';
    priority = record.values?.financial_risk || null;
  }
  let priorityColor = '#D97706';
  let prioritySoft = '#FEF3C7';
  if (priority?.toLowerCase() === 'high') {
    priorityColor = '#DC2626';
    prioritySoft = '#FEE2E2';
  } else if (priority?.toLowerCase() === 'low') {
    priorityColor = '#059669';
    prioritySoft = '#DCFCE7';
  }

  // Recommendation — a real next-step read off the record's actual decision
  // state, not a canned "proceed to X" narrative asserting an outcome that
  // hasn't happened.
  const RECOMMENDATION_BY_STATUS = {
    approved: { text: 'Approved — cleared to proceed', color: '#059669', soft: '#DCFCE7' },
    rejected: { text: 'Rejected — needs revision', color: '#DC2626', soft: '#FEE2E2' },
    submitted: { text: 'Submitted — awaiting review', color: '#2563EB', soft: '#DBEAFE' },
    draft: { text: 'Draft — not yet submitted', color: '#6B7280', soft: '#F3F4F6' },
  };
  const recommendation = RECOMMENDATION_BY_STATUS[record.status] || RECOMMENDATION_BY_STATUS.draft;

  return (
    <>
      <Topbar
        title={
          <span className="row gap-3">
            <button className="btn btn-ghost btn-icon" onClick={handleBack} aria-label="Back">
              <ArrowLeft size={16} />
            </button>
            {title}
          </span>
        }
        subtitle={`${property?.title || 'Property'} · Submission #${submissionNo}`}
      />

      <div className="content" style={{ background: '#F8FAFC', minHeight: 'calc(100vh - var(--topbar-height))' }}>
        <div className="content-wide col gap-4 fade-in" style={{ paddingBottom: 60 }}>

          {/* Top Audit Header Section */}
          <div className="card" style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 12, background: '#fff', border: '1px solid #E5E7EB' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
              <div className="col gap-1 text-left">
                <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', margin: 0 }}>
                  {type?.name || 'Evaluation'} Assessment Report
                </h1>
                <span style={{ fontSize: 13, color: 'var(--text-subtle)', fontWeight: 500 }}>
                  Submission #{submissionNo}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status</span>
                  <Badge color={statusColor} soft={statusSoft} dot>{statusLabel}</Badge>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Submitted By</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                    {record.submittedBy?.name || record.createdBy?.name || '—'}
                  </span>
                  <span style={{ fontSize: 11, color: '#6B7280' }}>
                    {record.submittedBy?.role || ''}
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Submitted On</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                    {fmtDate(record.createdAt)}
                  </span>
                  <span style={{ fontSize: 11, color: '#6B7280' }}>
                    {record.createdAt ? new Date(record.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Last Updated By</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                    {record.updatedBy?.name || '—'}
                  </span>
                  <span style={{ fontSize: 11, color: '#6B7280' }}>
                    {record.updatedBy?.role || ''}
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Last Updated On</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                    {fmtDate(record.updatedAt)}
                  </span>
                  <span style={{ fontSize: 11, color: '#6B7280' }}>
                    {record.updatedAt ? new Date(record.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: 10 }}>
                <button type="button" className="btn btn-ghost" onClick={handleDownloadPDF} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderColor: '#D1D5DB' }}>
                  <FileDown size={15} /> Download PDF
                </button>
                <button type="button" className="btn btn-primary" onClick={handleEdit} style={{ background: '#2563EB', display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none' }}>
                  <Pencil size={14} /> Edit
                </button>
              </div>
            </div>
          </div>

          {/* Two Column Grid layout */}
          <div style={{ display: 'grid', gridTemplateColumns: '70fr 30fr', gap: '20px', width: '100%', alignItems: 'start' }} className="grid-responsive">

            {/* Left Column (70%) */}
            <div className="col gap-4">

              {/* Card 1: Assessment Details */}
              <div className="card" style={{ background: '#fff', border: '1px solid #E5E7EB', padding: 24 }}>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 20, textAlign: 'left' }}>
                  Assessment Details
                </h2>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                  {type?.masterDataSchema?.map((field, idx) => {
                    const val = record.values?.[field.key];
                    const isRemarks = field.key === 'remarks' || field.key === 'notes' || field.key.includes('comment') || field.key.includes('analysis') || field.key.includes('factor');

                    return (
                      <div
                        key={field.key}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '25% 15% 60%',
                          alignItems: 'start',
                          padding: '16px 0',
                          borderBottom: idx === type.masterDataSchema.length - 1 ? 'none' : '1px solid #F1F5F9',
                          textAlign: 'left'
                        }}
                      >
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#4B5563' }}>{field.label}</span>
                        <div>{renderFieldValue(field)}</div>
                        <span style={{ fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.5, paddingLeft: 12 }}>
                          {isRemarks && val ? String(val) : '—'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Card 2: Attachments */}
              <div className="card" style={{ background: '#fff', border: '1px solid #E5E7EB', padding: 24 }}>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 16, textAlign: 'left' }}>
                  Attachments
                </h2>

                {/* Professional Tab selectors */}
                <div style={{ display: 'flex', gap: 20, borderBottom: '1px solid #E5E7EB', marginBottom: 20 }}>
                  <button
                    type="button"
                    onClick={() => setActiveTab('images')}
                    style={{
                      paddingBottom: 10,
                      fontWeight: 650,
                      fontSize: 13.5,
                      color: activeTab === 'images' ? '#2563EB' : '#6B7280',
                      borderBottom: activeTab === 'images' ? '2px solid #2563EB' : '2px solid transparent',
                      background: 'none'
                    }}
                  >
                    Images ({images.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('documents')}
                    style={{
                      paddingBottom: 10,
                      fontWeight: 650,
                      fontSize: 13.5,
                      color: activeTab === 'documents' ? '#2563EB' : '#6B7280',
                      borderBottom: activeTab === 'documents' ? '2px solid #2563EB' : '2px solid transparent',
                      background: 'none'
                    }}
                  >
                    Documents ({docs.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('videos')}
                    style={{
                      paddingBottom: 10,
                      fontWeight: 650,
                      fontSize: 13.5,
                      color: activeTab === 'videos' ? '#2563EB' : '#6B7280',
                      borderBottom: activeTab === 'videos' ? '2px solid #2563EB' : '2px solid transparent',
                      background: 'none'
                    }}
                  >
                    Videos ({videos.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('audio')}
                    style={{
                      paddingBottom: 10,
                      fontWeight: 650,
                      fontSize: 13.5,
                      color: activeTab === 'audio' ? '#2563EB' : '#6B7280',
                      borderBottom: activeTab === 'audio' ? '2px solid #2563EB' : '2px solid transparent',
                      background: 'none'
                    }}
                  >
                    Audio ({audios.length})
                  </button>
                </div>

                {/* Tab content area */}
                <div>

                  {/* Images Tab */}
                  {activeTab === 'images' && (
                    <div>
                      {images.length ? (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 16 }}>
                          {images.map((img, i) => (
                            <div
                              key={i}
                              className="col card"
                              style={{
                                padding: 8,
                                border: '1px solid #E5E7EB',
                                background: '#F9FAFB',
                                transition: 'transform 0.2s',
                                overflow: 'hidden'
                              }}
                            >
                              <div style={{ height: 90, width: '100%', borderRadius: 6, overflow: 'hidden', background: '#E5E7EB', position: 'relative' }}>
                                <img src={img.url} alt={img.originalName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              </div>
                              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', marginTop: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%', textAlign: 'left' }} title={img.originalName}>
                                {img.originalName}
                              </span>
                              <span style={{ fontSize: 10, color: 'var(--text-subtle)', textAlign: 'left', marginTop: 2 }}>
                                {img.bytes ? `${(img.bytes / (1024 * 1024)).toFixed(1)} MB` : '—'}
                              </span>
                              <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                                <a href={img.url} target="_blank" rel="noreferrer" className="btn btn-sm btn-ghost" style={{ flex: 1, fontSize: 10, padding: '3px 0', border: '1px solid #E5E7EB', background: '#fff' }}>
                                  Preview
                                </a>
                                <a href={img.url} download className="btn btn-sm btn-ghost" style={{ flex: 1, fontSize: 10, padding: '3px 0', border: '1px solid #E5E7EB', background: '#fff' }}>
                                  Download
                                </a>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="empty sm" style={{ padding: '24px 0' }}>No image attachments found.</div>
                      )}
                    </div>
                  )}

                  {/* Documents Tab */}
                  {activeTab === 'documents' && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
                      {docs.length ? (
                        docs.map((doc, i) => (
                          <div
                            key={i}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 12,
                              padding: 12,
                              border: '1px solid #E5E7EB',
                              borderRadius: 8,
                              background: '#F9FAFB'
                            }}
                          >
                            <div style={{ width: 36, height: 36, borderRadius: 6, background: '#FEE2E2', color: '#DC2626', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                              <FileText size={18} />
                            </div>
                            <div className="col grow" style={{ minWidth: 0, textAlign: 'left' }}>
                              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={doc.originalName}>
                                {doc.originalName}
                              </span>
                              <span style={{ fontSize: 10, color: 'var(--text-subtle)', marginTop: 2 }}>
                                {doc.bytes ? `${(doc.bytes / (1024 * 1024)).toFixed(2)} MB` : 'PDF Document'}
                              </span>
                            </div>
                            <a href={doc.url} download className="btn btn-ghost btn-icon" style={{ borderColor: '#E5E7EB', background: '#fff' }} title="Download File">
                              <FileDown size={14} />
                            </a>
                          </div>
                        ))
                      ) : (
                        <div className="empty sm" style={{ padding: '24px 0', gridColumn: 'span 2' }}>No document attachments found.</div>
                      )}
                    </div>
                  )}

                  {/* Videos Tab */}
                  {activeTab === 'videos' && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
                      {videos.length ? (
                        videos.map((vid, i) => (
                          <div
                            key={i}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 12,
                              padding: 12,
                              border: '1px solid #E5E7EB',
                              borderRadius: 8,
                              background: '#F9FAFB'
                            }}
                          >
                            <div style={{ width: 36, height: 36, borderRadius: 6, background: '#DBEAFE', color: '#2563EB', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                              <Play size={18} />
                            </div>
                            <div className="col grow" style={{ minWidth: 0, textAlign: 'left' }}>
                              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={vid.originalName}>
                                {vid.originalName}
                              </span>
                              <span style={{ fontSize: 10, color: 'var(--text-subtle)', marginTop: 2 }}>
                                {vid.duration ? `${Math.round(vid.duration)}s · ` : ''}MP4 Video
                              </span>
                            </div>
                            <div style={{ display: 'flex', gap: 4 }}>
                              <a href={vid.url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-icon" style={{ borderColor: '#E5E7EB', background: '#fff' }} title="Play">
                                <Play size={12} />
                              </a>
                              <a href={vid.url} download className="btn btn-ghost btn-icon" style={{ borderColor: '#E5E7EB', background: '#fff' }} title="Download Video">
                                <FileDown size={12} />
                              </a>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="empty sm" style={{ padding: '24px 0', gridColumn: 'span 2' }}>No video attachments found.</div>
                      )}
                    </div>
                  )}

                  {/* Audio Tab */}
                  {activeTab === 'audio' && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
                      {audios.length ? (
                        audios.map((aud, i) => (
                          <div
                            key={i}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 12,
                              padding: 12,
                              border: '1px solid #E5E7EB',
                              borderRadius: 8,
                              background: '#F9FAFB'
                            }}
                          >
                            <div style={{ width: 36, height: 36, borderRadius: 6, background: '#E0F2FE', color: '#0284C7', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                              <Volume2 size={18} />
                            </div>
                            <div className="col grow" style={{ minWidth: 0, textAlign: 'left' }}>
                              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={aud.originalName}>
                                {aud.originalName}
                              </span>
                              <span style={{ fontSize: 10, color: 'var(--text-subtle)', marginTop: 2 }}>
                                {aud.duration ? `${Math.round(aud.duration)}s · ` : ''}MP3 Audio
                              </span>
                            </div>
                            <div style={{ display: 'flex', gap: 4 }}>
                              <audio src={aud.url} controls style={{ display: 'none' }} id={`aud-${i}`} />
                              <button
                                type="button"
                                onClick={() => {
                                  const el = document.getElementById(`aud-${i}`);
                                  if (el) el.play();
                                }}
                                className="btn btn-ghost btn-icon"
                                style={{ borderColor: '#E5E7EB', background: '#fff' }}
                                title="Play Audio"
                              >
                                <Play size={12} />
                              </button>
                              <a href={aud.url} download className="btn btn-ghost btn-icon" style={{ borderColor: '#E5E7EB', background: '#fff' }} title="Download Audio">
                                <FileDown size={12} />
                              </a>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="empty sm" style={{ padding: '24px 0', gridColumn: 'span 2' }}>No audio attachments found.</div>
                      )}
                    </div>
                  )}

                </div>
              </div>

            </div>

            {/* Right Column Sidebar (30%) */}
            <div className="col gap-4">

              {/* Card 1: Activity History */}
              <div className="card" style={{ background: '#fff', border: '1px solid #E5E7EB', padding: 24 }}>
                <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 20, textAlign: 'left' }}>
                  Activity History
                </h2>

                {recordActivities.length ? (
                  <div className="col gap-4" style={{ position: 'relative', paddingLeft: 12, textAlign: 'left' }}>

                    {/* Vertical timeline line */}
                    <div style={{ position: 'absolute', left: 24, top: 12, bottom: 12, width: 2, background: '#E5E7EB', zindex: 1 }}></div>

                    {recordActivities.map((act, i) => {
                      let iconBg = '#6B7280';
                      let icon = <Clock size={12} />;

                      if (act.action === 'created' || act.message.includes('created') || act.message.includes('submitted')) {
                        iconBg = '#059669';
                        icon = <Check size={12} />;
                      } else if (act.action === 'updated' || act.message.includes('updated')) {
                        iconBg = '#2563EB';
                        icon = <Pencil size={12} />;
                      }

                      return (
                        <div key={act._id} style={{ display: 'flex', gap: 16, position: 'relative', zIndex: 2 }}>
                          <div style={{ width: 24, height: 24, borderRadius: '50%', background: iconBg, color: '#fff', display: 'grid', placeItems: 'center', flexShrink: 0, marginTop: 2 }}>
                            {icon}
                          </div>
                          <div className="col gap-1">
                            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                              {act.message.includes('submitted') ? 'Submitted' : act.message.includes('updated') ? 'Updated' : 'Created'}
                            </span>
                            <span style={{ fontSize: 12, color: 'var(--text-subtle)', lineHeight: 1.4 }}>
                              {act.message}
                            </span>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 10.5, color: '#6B7280', marginTop: 4 }}>
                              <span>by <b>{act.actor?.name || 'System'}</b></span>
                              <span>·</span>
                              <span>{fmtDate(act.createdAt)} {act.createdAt ? new Date(act.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="empty sm" style={{ padding: '16px 0' }}>No activity logged for this submission yet.</div>
                )}
              </div>

              {/* Card 2: Report Summary */}
              <div className="card" style={{ background: '#fff', border: '1px solid #E5E7EB', padding: 24 }}>
                <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 20, textAlign: 'left' }}>
                  Report Summary
                </h2>

                <div className="col gap-3" style={{ fontSize: 13.5, textAlign: 'left' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #F1F5F9', paddingBottom: 8 }}>
                    <span style={{ color: '#6B7280' }}>Assessment Type</span>
                    <strong style={{ color: 'var(--text)' }}>{type?.name || 'Feasibility'}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #F1F5F9', paddingBottom: 8 }}>
                    <span style={{ color: '#6B7280' }}>Submission No.</span>
                    <strong style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>#{submissionNo}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #F1F5F9', paddingBottom: 8, alignItems: 'center' }}>
                    <span style={{ color: '#6B7280' }}>Status</span>
                    <Badge color={statusColor} soft={statusSoft}>{statusLabel}</Badge>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #F1F5F9', paddingBottom: 8 }}>
                    <span style={{ color: '#6B7280' }}>Total Score</span>
                    <strong style={{ color: 'var(--text)' }}>{totalScore}</strong>
                  </div>
                  {priority && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #F1F5F9', paddingBottom: 8, alignItems: 'center' }}>
                      <span style={{ color: '#6B7280' }}>{record.assessmentType === 'financial' ? 'Financial Risk' : 'Market Potential'}</span>
                      <Badge color={priorityColor} soft={prioritySoft}>{priority}</Badge>
                    </div>
                  )}
                  <div className="col gap-1" style={{ paddingTop: 4 }}>
                    <span style={{ color: '#6B7280' }}>Recommendation</span>
                    <span style={{ fontWeight: 650, color: recommendation.color, background: recommendation.soft, padding: '6px 10px', borderRadius: 6, fontSize: 12, marginTop: 4, display: 'inline-block' }}>
                      {recommendation.text}
                    </span>
                  </div>
                </div>
              </div>

            </div>

          </div>

        </div>
      </div>
    </>
  );
}

export default AssessmentReportPage;
