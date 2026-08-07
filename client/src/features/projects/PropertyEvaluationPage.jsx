import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  ArrowLeft, ClipboardList, Plus, Pencil, Trash2, Info, CheckCircle2, Clock, Circle,
  ShieldAlert, ThumbsUp, CalendarDays, TrendingUp, TrendingDown, Lightbulb, AlertTriangle,
  FileText, Download, MapPin, ExternalLink, Building2, ArrowRight, Save,
  Percent, Wallet, Timer, Flag, DollarSign, Settings, Users, MessageSquare, X, Play,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { SectionCard, Avatar, EmptyState, ProgressRing, Badge } from '../../components/ui/primitives.jsx';
import { SkDetail, SkeletonActivity } from '../../components/ui/Skeletons.jsx';
import { ScoreRadar } from '../../components/charts/chartkit.jsx';
import { useTemplate } from '../../app/api/templatesApi.js';
import {
  useRecord,
  useCreateRecord, useUpdateRecord, useDeleteRecord, useStageRecords, useMarkRecordOpened,
  useUploadMedia, useDestroyMedia,
} from '../../app/api/recordsApi.js';
import { useProject, useProjectActivity } from '../../app/api/projectsApi.js';
import { fmtDate, fmtDateTime, fmtDateTimeLong, fromNow, fmtFileSize, daysUntil, fmtCurrency } from '../../lib/format.js';
import { ROLE_META } from '../../lib/ui.js';
import { useAppSelector } from '../../app/hooks.js';
import { selectCanDecide } from '../../app/slices/authSlice.js';
import { RecordFormModal } from './records/RecordFormModal.jsx';
import { RecordsTable } from './records/RecordsTable.jsx';
import { LocationPreviewModal } from './records/LocationPreviewModal.jsx';
import { MediaCaptureModal } from './records/MediaCaptureModal.jsx';
import { propertyNo, buildRecordMeta } from './records/recordUi.js';
import {
  computeScorecard, scoreGradeFor, RISK_META, RECOMMENDATION_META,
  feasibilityPercent, financialPercent, technicalPercent, operationalPercent,
} from './records/scoring.js';
import { useProjectReadOnly, ReadOnlyProjectBanner } from '../../components/ui/ReadOnlyProjectBanner.jsx';

const SECTION_SCORERS = {
  feasibility: feasibilityPercent,
  financial: financialPercent,
  technical: technicalPercent,
  operational: operationalPercent,
};

/** Per-section icon + accent — matches the four assessment types. */
const SECTION_ICON = {
  feasibility: { icon: Flag, color: 'var(--success)' },
  financial: { icon: DollarSign, color: '#8B5CF6' },
  technical: { icon: Settings, color: 'var(--info)' },
  operational: { icon: Users, color: 'var(--warning)' },
};

/** Assessment-card accent per type; falls back to a stable palette by index so
 * a custom template type still gets a distinct colour. */
const CARD_ACCENT_FALLBACK = ['#22C55E', '#3B82F6', '#F59E0B', '#8B5CF6', '#EC4899'];
const CARD_ACCENT = { feasibility: '#22C55E', financial: '#3B82F6', technical: '#F59E0B', operational: '#8B5CF6' };
const accentFor = (key, i) => CARD_ACCENT[key] || CARD_ACCENT_FALLBACK[i % CARD_ACCENT_FALLBACK.length];

/** Card status label from a sectionStatus() key, worded for the card UI. */
const CARD_STATUS_LABEL = {
  approved: 'Completed',
  submitted: 'In Review',
  in_progress: 'In Progress',
  rejected: 'Rejected',
  none: 'Not Started',
};

/* ── small helpers ────────────────────────────────────────────────────── */
const isGps = (v) => v && typeof v === 'object' && typeof v.lat === 'number' && typeof v.lng === 'number';
const hasLoc = (v) => isGps(v) || (v && v.mapUrl);
const mapEmbed = (v) => (isGps(v) ? `https://maps.google.com/maps?q=${v.lat},${v.lng}&z=15&hl=en&output=embed` : null);
const isMediaEntry = (e) => e && typeof e === 'object' && (e.url || e.secureUrl || e.publicId);
const mediaUrl = (e) => e?.url || e?.secureUrl || e?.previewUrl || '';
const mediaKind = (e) => {
  const mt = e?.mimetype || '';
  if (mt.startsWith('image/')) return 'image';
  if (mt.startsWith('video/')) return 'video';
  if (mt.startsWith('audio/')) return 'audio';
  return 'document';
};
/** Pull every media entry out of a record's `values` map, schema-free. */
function collectMedia(valuesObj) {
  if (!valuesObj) return [];
  const out = [];
  for (const v of Object.values(valuesObj)) {
    const arr = Array.isArray(v) ? v : [v];
    for (const e of arr) if (isMediaEntry(e)) out.push(e);
  }
  return out;
}

/** Per-section display status from its latest/approved record. */
function sectionStatus(section) {
  if (!section) return { label: 'Not started', color: 'var(--text-subtle)', key: 'none' };
  if (section.approvedRecord) return { label: 'Approved', color: 'var(--success)', key: 'approved' };
  const st = section.status;
  if (st === 'rejected') return { label: 'Rejected', color: 'var(--danger)', key: 'rejected' };
  if (st === 'submitted') return { label: 'In Review', color: 'var(--warning)', key: 'submitted' };
  if (st === 'draft') return { label: 'In Progress', color: 'var(--info)', key: 'in_progress' };
  return { label: 'Not started', color: 'var(--text-subtle)', key: 'none' };
}

/** SWOT — derived purely from the real scorecard numbers/states (no fabrication). */
function deriveInsights(sc, sectionMeta) {
  const strengths = [];
  const weaknesses = [];
  const opportunities = [];
  const threats = [];
  for (const { key, name } of sectionMeta) {
    const s = sc.sections[key];
    if (s?.percent != null && s.percent >= 75) strengths.push(`Strong ${name.toLowerCase()} (${s.percent}%)`);
    if (s?.percent != null && s.percent < 60) weaknesses.push(`Weak ${name.toLowerCase()} (${s.percent}%)`);
    const st = sectionStatus(s);
    if (st.key === 'none') threats.push(`${name} assessment not started`);
    if (st.key === 'rejected') threats.push(`${name} assessment rejected`);
  }
  if (sc.riskLevel === 'Low') strengths.push('Low overall risk profile');
  if (sc.roi != null && sc.roi >= 20) opportunities.push(`Strong Return on Investment (${sc.roi}%)`);
  if (sc.monthlyRevenue != null) opportunities.push('Revenue projection on record');
  if (sc.paybackMonths != null && sc.paybackMonths <= 24) opportunities.push(`Fast investment recovery (${sc.paybackMonths} mo)`);
  if (sc.paybackMonths != null && sc.paybackMonths > 36) threats.push(`Long investment recovery time (${sc.paybackMonths} mo)`);
  if (sc.riskLevel === 'High') threats.push('High overall risk profile');
  return { strengths, weaknesses, opportunities, threats };
}

/** Concrete concerns, worst first — derived from real section states/scores. */
function deriveRisks(sc, sectionMeta) {
  const risks = [];
  for (const { key, name } of sectionMeta) {
    const s = sc.sections[key];
    const st = sectionStatus(s);
    if (st.key === 'rejected') risks.push({ label: `${name} assessment rejected`, level: 'High' });
    else if (st.key === 'none') risks.push({ label: `${name} assessment pending`, level: 'Medium' });
    else if (s?.percent != null && s.percent < 60) risks.push({ label: `Low ${name.toLowerCase()} score (${s.percent}%)`, level: 'Medium' });
  }
  if (sc.paybackMonths != null && sc.paybackMonths > 36) risks.push({ label: `Long investment recovery time (${sc.paybackMonths} months)`, level: 'Medium' });
  if (sc.riskLevel === 'High') risks.push({ label: 'High overall risk profile', level: 'High' });
  const order = { High: 0, Medium: 1, Low: 2 };
  return risks.sort((a, b) => order[a.level] - order[b.level]).slice(0, 6);
}

const LEVEL_COLOR = { High: 'var(--danger)', Medium: 'var(--warning)', Low: 'var(--success)' };

function InfoTile({ label, value, tone }) {
  return (
    <div className="col gap-1" style={{ minWidth: 100 }}>
      <span className="tiny subtle upper">{label}</span>
      <span className="sm" style={{ fontWeight: 650, color: tone || 'var(--text)' }}>{value ?? '—'}</span>
    </div>
  );
}

/* Top stat card (icon + label + big value + sub). */
function StatCard({ icon: Icon, label, value, sub, color, children }) {
  return (
    <div className="card" style={{ padding: '14px 16px', flex: '1 1 175px', minWidth: 165 }}>
      <div className="row gap-2" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="tiny subtle upper">{label}</span>
        {Icon && <div className="list-row-icon" style={{ width: 26, height: 26, background: `${color}1A`, color }}><Icon size={14} /></div>}
      </div>
      {children || (
        <>
          <div style={{ fontSize: 22, fontWeight: 750, color: color || 'var(--text)', marginTop: 6, lineHeight: 1.1 }}>{value}</div>
          {sub && <div className="tiny muted" style={{ marginTop: 3 }}>{sub}</div>}
        </>
      )}
    </div>
  );
}

/**
 * Property Evaluation dashboard — the full workspace reached by clicking a
 * shortlisted property in Site Evaluation. Every figure here is real, derived
 * data: the Overall Score / Risk / Recommendation come from the same scoring
 * engine the comparison page ranks by; SWOT and Risks are derived from those
 * numbers (never fabricated); documents, photos, location and activity are the
 * property's own uploaded/real data. The four assessment cards and the records
 * history/modals below keep the original submit/edit/view behaviour.
 */
export function PropertyEvaluationPage() {
  const { id, propertyId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { data: project } = useProject(id);
  const readOnly = useProjectReadOnly(project);
  // Server: `DELETE /pms/records/:id` requires `canDecide` (admin|manager).
  const canDecide = useAppSelector(selectCanDecide);
  const templateId = project?.template?.ref?._id || project?.template?.ref;
  const { data: template, isLoading: templateLoading } = useTemplate(templateId);
  const { data: property, isLoading: propertyLoading } = useRecord(propertyId);
  const { data: activities, isLoading: activitiesLoading } = useProjectActivity(id);

  const stageKey = 'p2';
  const { data: assessmentRecords, isLoading: assessmentsLoading } = useStageRecords(id, stageKey, { parentRecordId: propertyId });
  const createAssessment = useCreateRecord(id, stageKey);
  const updateAssessment = useUpdateRecord(id, stageKey);
  const deleteAssessment = useDeleteRecord(id, stageKey);
  const markOpened = useMarkRecordOpened(id, 'p1');

  const [activeForm, setActiveForm] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [locOpen, setLocOpen] = useState(false);
  const [photoModalOpen, setPhotoModalOpen] = useState(false);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [previewMedia, setPreviewMedia] = useState(null);
  const openLoggedRef = useRef(false);

  // Site Photos live on the property record itself (values.site_photos), so the
  // gallery below picks them up via collectMedia. "Upload More" pushes the
  // S3-uploaded entries into that array.
  const uploadMedia = useUploadMedia();
  const destroyMedia = useDestroyMedia();
  const updateProperty = useUpdateRecord(id, 'p1');

  const assessmentTypes = template?.stages?.find((s) => s.key === stageKey)?.assessmentTypes || [];
  const sectionMeta = assessmentTypes.map((t) => ({ key: t.key, name: t.name }));
  const steps = assessmentTypes.map((type) => {
    const typeRecords = (assessmentRecords || []).filter((r) => r.assessmentType === type.key);
    const sorted = [...typeRecords].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return { type, record: sorted[0] || null, hasRecord: typeRecords.length > 0 };
  });
  const doneCount = steps.filter((s) => s.hasRecord).length;
  const allRecords = [...(assessmentRecords || [])].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const scorecard = useMemo(
    () => (property ? computeScorecard(property, assessmentRecords || [], assessmentTypes.map((t) => t.key)) : null),
    [property, assessmentRecords, assessmentTypes],
  );

  // Real media across the property + all its assessment submissions.
  const allMedia = useMemo(() => {
    const m = collectMedia(property?.values);
    for (const r of assessmentRecords || []) m.push(...collectMedia(r.values));
    // de-dupe by url/publicId
    const seen = new Set();
    return m.filter((e) => {
      const k = e.publicId || mediaUrl(e);
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [property, assessmentRecords]);
  const photos = allMedia.filter((e) => mediaKind(e) === 'image');
  const documents = allMedia.filter((e) => mediaKind(e) !== 'image');

  // Upload one or more images and persist them onto the property record. Uploads
  // run sequentially, then a single PATCH merges them into values.site_photos —
  // the existing values are preserved (the server replaces `values` wholesale).
  const savePhotos = async (files) => {
    const imgs = [...files].filter((f) => (f.type || '').startsWith('image/'));
    if (!imgs.length || uploadingPhotos) return;
    setUploadingPhotos(true);
    try {
      const uploaded = [];
      for (const file of imgs) uploaded.push(await uploadMedia.mutateAsync({ file }));
      const existing = Array.isArray(property.values?.site_photos) ? property.values.site_photos : [];
      await updateProperty.mutateAsync({
        id: propertyId,
        values: { ...property.values, site_photos: [...existing, ...uploaded] },
      });
    } catch {
      // eslint-disable-next-line no-alert
      alert('Could not upload the photo. Please try again.');
    } finally {
      setUploadingPhotos(false);
    }
  };

  // Only photos we uploaded here (stored in values.site_photos) can be removed
  // from this screen — photos pulled from assessment records are owned elsewhere.
  const sitePhotos = Array.isArray(property?.values?.site_photos) ? property.values.site_photos : [];
  const ownedPhotoIds = new Set(sitePhotos.map((e) => e.publicId).filter(Boolean));

  const removePhoto = async (entry) => {
    if (uploadingPhotos) return;
    setUploadingPhotos(true);
    try {
      const key = entry.publicId || mediaUrl(entry);
      const remaining = sitePhotos.filter((e) => (e.publicId || mediaUrl(e)) !== key);
      await updateProperty.mutateAsync({
        id: propertyId,
        values: { ...property.values, site_photos: remaining },
      });
      // Reference removed from the record first; now free the S3 asset.
      if (entry.publicId) destroyMedia.mutate({ publicId: entry.publicId, resourceType: entry.resourceType });
    } catch {
      // eslint-disable-next-line no-alert
      alert('Could not remove the photo. Please try again.');
    } finally {
      setUploadingPhotos(false);
    }
  };

  useEffect(() => {
    if (openLoggedRef.current || assessmentsLoading || !property) return;
    openLoggedRef.current = true;
    if ((assessmentRecords || []).length === 0) markOpened.mutate(propertyId);
  }, [assessmentsLoading, property]);

  useEffect(() => {
    if (assessmentsLoading || !assessmentRecords) return;
    const editId = location.state?.editRecordId;
    if (editId) {
      const rec = assessmentRecords.find((r) => String(r._id) === String(editId));
      if (rec) {
        openEdit(rec);
        navigate(location.pathname, { replace: true, state: {} });
      }
    }
  }, [assessmentsLoading, assessmentRecords, location.state]);

  const backToList = () => navigate(-1);

  if (propertyLoading || !property) {
    return (<><Topbar title="Site Evaluation" /><div className="content"><SkDetail /></div></>);
  }
  if (property.status !== 'shortlisted') {
    return (
      <>
        <Topbar title={<span className="row gap-3"><button className="btn btn-ghost btn-icon" onClick={backToList} aria-label="Back"><ArrowLeft size={16} /></button>Site Evaluation</span>} />
        <div className="content">
          <EmptyState icon={ClipboardList} title="Not eligible for Site Evaluation" hint="Only properties shortlisted in Property Identification can be evaluated here." />
        </div>
      </>
    );
  }

  const totalSections = assessmentTypes.length || 1;
  const completionPct = Math.round((doneCount / totalSections) * 100);
  const grade = scoreGradeFor(scorecard?.overallScore);
  const risk = RISK_META[scorecard?.riskLevel] || RISK_META.Unknown;
  const rec = scorecard?.recommendation || 'Evaluation Incomplete';
  const recColor = (RECOMMENDATION_META[rec] || {}).color || 'var(--text-subtle)';
  const recProceed = rec === 'Highly Recommended' || rec === 'Recommended';

  // Target opening from the project's own schedule (last stage's planned end).
  const targetOpen = (project?.stages || []).reduce((max, s) => (s.plannedEnd && (!max || new Date(s.plannedEnd) > new Date(max)) ? s.plannedEnd : max), null);
  const daysRemaining = targetOpen ? daysUntil(targetOpen) : null;

  const lastUpdated = allRecords[0]?.updatedAt || property.updatedAt || property.createdAt;
  const radarData = sectionMeta.map(({ key, name }) => ({ axis: name, value: scorecard?.sections[key]?.percent ?? 0 }));
  const insights = scorecard ? deriveInsights(scorecard, sectionMeta) : { strengths: [], weaknesses: [], opportunities: [], threats: [] };
  const risks = scorecard ? deriveRisks(scorecard, sectionMeta) : [];

  // Reviewer remarks left on any assessment's Approve/Reject decision.
  const reviewerComments = (assessmentRecords || [])
    .map((r) => {
      const text = r.rejectReason || r.decisionReason;
      if (!text) return null;
      const reviewer = r.decidedBy || r.approvedBy || r.rejectedBy;
      return {
        id: r._id,
        name: reviewer?.name || 'Reviewer',
        role: reviewer?.role,
        at: r.decidedAt || r.approvedAt || r.rejectedAt || r.updatedAt,
        section: assessmentTypes.find((t) => t.key === r.assessmentType)?.name,
        text,
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.at) - new Date(a.at));

  const liveLoc = property.values?.live_location;
  // Map always shows: exact GPS point when captured, otherwise a search on the
  // property's locality/city so there's still a real map to orient by.
  const locQuery = [property.values?.locality, property.values?.city, property.values?.state].filter(Boolean).join(', ');
  const mapPreviewSrc = isGps(liveLoc)
    ? mapEmbed(liveLoc)
    : (liveLoc?.mapUrl ? null : (locQuery ? `https://maps.google.com/maps?q=${encodeURIComponent(locQuery)}&z=13&hl=en&output=embed` : null));
  const mapsLink = isGps(liveLoc)
    ? `https://www.google.com/maps?q=${liveLoc.lat},${liveLoc.lng}`
    : (liveLoc?.mapUrl || (locQuery ? `https://www.google.com/maps?q=${encodeURIComponent(locQuery)}` : `https://www.google.com/maps?q=${encodeURIComponent(property.title || '')}`));

  const relevantIds = new Set([String(propertyId), ...(assessmentRecords || []).map((r) => String(r._id))]);
  const isDecisionEvent = (a) => /\b(approved|rejected|reverted)\b/i.test(a.message || '');
  const propertyActivity = (activities || []).filter((a) => (relevantIds.has(a.meta?.recordId) || a.meta?.parentRecordId === String(propertyId)) && !isDecisionEvent(a));

  const scoreFor = (record) => {
    if (record.status !== 'approved') return null;
    const scorer = SECTION_SCORERS[record.assessmentType];
    return scorer ? scorer(record.values) : null;
  };

  const openStep = (index) => setActiveForm({ type: steps[index].type, record: null, readOnly: false });
  const openView = (record) => navigate(`/projects/${id}/site-evaluation/${propertyId}/assessment/${record._id}`);
  function openEdit(record) {
    const type = assessmentTypes.find((t) => t.key === record.assessmentType);
    setActiveForm({ type, record, readOnly: false });
  }
  const switchToEdit = () => setActiveForm((f) => (f ? { ...f, readOnly: false } : f));
  const closeForm = () => setActiveForm(null);

  const saveAssessment = async (values, status) => {
    const { type, record } = activeForm;
    if (record) await updateAssessment.mutateAsync({ id: record._id, values, status });
    else await createAssessment.mutateAsync({ values, status, assessmentType: type.key, parentRecordId: propertyId });
    closeForm();
  };

  // "Continue to Next Assessment" → the first section not yet approved.
  const nextIncomplete = steps.findIndex((s) => {
    const sec = scorecard?.sections[s.type.key];
    return !sec?.approvedRecord;
  });

  const timelineIcon = (msg = '', action = '') => {
    const base = { width: 28, height: 28, borderRadius: '50%', display: 'grid', placeItems: 'center', flexShrink: 0, color: '#fff' };
    if (msg.includes('submitted') || msg.includes('created') || action === 'created') return <div style={{ ...base, background: '#059669' }}><Plus size={14} strokeWidth={2.5} /></div>;
    if (msg.includes('updated') || action === 'updated') return <div style={{ ...base, background: '#2563EB' }}><Pencil size={14} strokeWidth={2.5} /></div>;
    if (msg.includes('deleted') || action === 'deleted') return <div style={{ ...base, background: '#DC2626' }}><Trash2 size={14} strokeWidth={2.5} /></div>;
    return <div style={{ ...base, background: '#6B7280' }}><Info size={14} strokeWidth={2.5} /></div>;
  };

  return (
    <>
      <Topbar
        title={<span className="row gap-3"><button className="btn btn-ghost btn-icon" onClick={backToList} aria-label="Back to Site Evaluation"><ArrowLeft size={16} /></button>{property.title || 'Property'}</span>}
        subtitle={`${propertyNo(property.seq)} · Site Evaluation`}
      />
      <div className="content page-compact">
        {readOnly && <ReadOnlyProjectBanner />}
        <div className="content-wide fade-in pe-detail-grid">
          {/* ─── main column ─────────────────────────────────────────── */}
          <div className="col gap-3">

            {/* Assessment stepper — connected steps with status pills */}
            <SectionCard title="Assessment Progress" subtitle={readOnly ? undefined : 'Click any step to open or continue its assessment'}>
              <div className="ae-grid">
                {steps.map(({ type }, i) => {
                  const section = scorecard?.sections[type.key];
                  const st = sectionStatus(section);
                  const record = section?.latestRecord || null;
                  const accent = accentFor(type.key, i);
                  const statusLabel = CARD_STATUS_LABEL[st.key] || st.label;
                  const assignee = record?.submittedBy?.name || record?.createdBy?.name || record?.updatedBy?.name || '—';
                  const lastUpdated = record ? fmtDate(record.updatedAt || record.createdAt) : '—';

                  // CTA maps to the existing actions: view an approved record,
                  // continue an in-progress one, or start a new assessment.
                  let ctaLabel; let ctaAction;
                  if (readOnly) {
                    ctaLabel = 'View Assessment';
                    ctaAction = record ? () => openView(record) : null;
                  } else if (st.key === 'approved') {
                    ctaLabel = 'View Assessment';
                    ctaAction = () => openView(section.approvedRecord || record);
                  } else if (record) {
                    ctaLabel = 'Continue Assessment';
                    ctaAction = () => openEdit(record);
                  } else {
                    ctaLabel = 'Start Assessment';
                    ctaAction = () => openStep(i);
                  }

                  return (
                    <div key={type.key} className="ae-card" style={{ '--ae': accent }}>
                      <button type="button" className="ae-card-head" onClick={ctaAction || undefined} disabled={!ctaAction}>
                        <span className="ae-num">{i + 1}</span>
                        <span className="ae-title">{type.name}</span>
                        <ArrowRight size={16} className="ae-arrow" />
                      </button>

                      <div className="ae-status"><span className="ae-dot" style={{ background: accent }} /> {statusLabel}</div>

                      <div className="ae-meta">
                        <div className="ae-meta-row">
                          <Users size={13} />
                          <div className="ae-meta-text">
                            <span className="ae-meta-label">Assignee</span>
                            <span className="ae-meta-val">{assignee}</span>
                          </div>
                        </div>
                        <div className="ae-meta-row">
                          <CalendarDays size={13} />
                          <div className="ae-meta-text">
                            <span className="ae-meta-label">Last Updated</span>
                            <span className="ae-meta-val">{lastUpdated}</span>
                          </div>
                        </div>
                      </div>

                      <button type="button" className="ae-btn" onClick={ctaAction || undefined} disabled={!ctaAction}>
                        {ctaLabel}
                      </button>
                    </div>
                  );
                })}
              </div>
            </SectionCard>

            {/* Assessment Records history */}
            <RecordsTable
              title="Assessment Records"
              typeColumnLabel="Assessment Type"
              records={allRecords}
              assessmentTypes={assessmentTypes}
              onView={openView}
              showStatus
              showScore
              scoreFor={scoreFor}
              emptyTitle="No assessments filed yet"
              emptyHint="Fill and submit an assessment above to see it here."
              onEdit={readOnly ? undefined : openEdit}
              onDelete={readOnly || !canDecide ? undefined : setDeleteTarget}
            />

            {/* Reviewer Comments */}
            <SectionCard
              title="Reviewer Comments"
              action={reviewerComments.length > 3 ? <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/projects/${id}/site-evaluation/report?propertyId=${propertyId}`)}>View All</button> : null}
            >
              {reviewerComments.length ? (
                <div className="col gap-2">
                  {reviewerComments.slice(0, 3).map((c) => (
                    <div key={c.id} className="row gap-3" style={{ alignItems: 'flex-start', padding: 12, border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                      <div className="list-row-icon" style={{ width: 32, height: 32, borderRadius: 9, flexShrink: 0, background: 'var(--info-soft)', color: 'var(--info)' }}>
                        <MessageSquare size={16} />
                      </div>
                      <div className="col grow" style={{ minWidth: 0, gap: 4 }}>
                        <div className="row gap-2" style={{ alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                          <span className="sm">
                            <span style={{ fontWeight: 700 }}>{c.name}</span>
                            {c.role && <span className="muted"> ({ROLE_META[c.role]?.label || c.role})</span>}
                            {c.section && <span className="tiny muted"> · {c.section}</span>}
                          </span>
                          <span className="tiny muted">{fmtDateTimeLong(c.at)}</span>
                        </div>
                        <span className="sm" style={{ color: 'var(--text-muted)' }}>{c.text}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState icon={MessageSquare} title="No reviewer comments yet" hint="Comments appear when a manager approves or rejects an assessment with remarks." />
              )}
            </SectionCard>

            {/* Documents & Attachments (files + site photos, one card) */}
            <SectionCard title={`Documents & Attachments (${documents.length + photos.length})`}>
              <div className="col gap-3">
                {documents.length ? (
                  <div className="col">
                    {documents.slice(0, 6).map((e, i) => {
                      const kind = mediaKind(e);
                      const playable = kind === 'video' || kind === 'audio';
                      return (
                        <div key={e.publicId || i} className="row gap-2" style={{ alignItems: 'center', padding: '8px 0', borderTop: i ? '1px solid var(--border)' : 'none' }}>
                          <FileText size={15} style={{ color: 'var(--danger)', flexShrink: 0 }} />
                          <div className="col grow" style={{ minWidth: 0 }}>
                            <span className="sm" style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.originalName || e.name || 'Document'}</span>
                            <span className="tiny muted">{e.bytes ? fmtFileSize(e.bytes) : ''}</span>
                          </div>
                          {playable && mediaUrl(e) && (
                            <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => setPreviewMedia(e)} title={kind === 'video' ? 'Play video' : 'Play audio'}><Play size={14} /></button>
                          )}
                          {mediaUrl(e) && <a className="btn btn-ghost btn-icon btn-sm" href={mediaUrl(e)} target="_blank" rel="noreferrer" title="Download"><Download size={14} /></a>}
                        </div>
                      );
                    })}
                  </div>
                ) : <EmptyState icon={FileText} title="No documents yet" hint="Attach documents from an assessment." />}

                <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
                  {photos.slice(0, 8).map((e, i) => (
                    <div key={e.publicId || i} style={{ position: 'relative', flexShrink: 0 }}>
                      <a href={mediaUrl(e)} target="_blank" rel="noreferrer" style={{ display: 'block' }}>
                        <img src={mediaUrl(e)} alt={e.originalName || 'Site photo'} style={{ width: 104, height: 78, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} />
                      </a>
                      {e.publicId && ownedPhotoIds.has(e.publicId) && (
                        <button
                          type="button"
                          onClick={() => removePhoto(e)}
                          disabled={uploadingPhotos || readOnly}
                          title="Remove photo"
                          style={{
                            position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: '50%',
                            border: 'none', background: 'rgba(0,0,0,0.55)', color: '#fff', padding: 0,
                            display: 'grid', placeItems: 'center', cursor: uploadingPhotos ? 'wait' : 'pointer',
                          }}
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setPhotoModalOpen(true)}
                    disabled={uploadingPhotos || readOnly}
                    title="Capture or upload more site photos"
                    style={{
                      width: 104, height: 78, borderRadius: 8, flexShrink: 0, padding: 0,
                      border: '1.5px dashed var(--primary)', background: 'var(--primary-soft)',
                      color: 'var(--primary)', cursor: uploadingPhotos ? 'wait' : 'pointer',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5,
                    }}
                  >
                    {uploadingPhotos ? (
                      <span className="tiny" style={{ fontWeight: 600 }}>Uploading…</span>
                    ) : (
                      <>
                        <span style={{ width: 26, height: 26, borderRadius: '50%', border: '1.5px solid var(--primary)', display: 'grid', placeItems: 'center' }}>
                          <Plus size={15} />
                        </span>
                        <span className="tiny" style={{ fontWeight: 600 }}>Upload More</span>
                      </>
                    )}
                  </button>
                </div>
                {!photos.length && !uploadingPhotos && (
                  <span className="tiny muted">No site photos yet — capture or upload to get started.</span>
                )}
              </div>
            </SectionCard>
          </div>

          {/* ─── sidebar ─────────────────────────────────────────────── */}
          <div className="col gap-3">
            <SectionCard title="Property Summary" action={<button className="btn btn-ghost btn-sm" onClick={() => navigate(`/projects/${id}/property-identification/${propertyId}`)}>Edit</button>}>
              <div className="col gap-3">
                <PropRow icon={Building2} label="Property Name" value={property.title} />
                <PropRow label="Property Code" value={propertyNo(property.seq)} />
                <PropRow icon={MapPin} label="City" value={[property.values?.city, property.values?.locality].filter(Boolean).join(', ') || '—'} />
                <PropRow label="Area" value={property.values?.area ? `${property.values.area} sq.ft` : (property.values?.carpet_area ? `${property.values.carpet_area} sq.ft` : '—')} />
                <PropRow label="Property Type" value={property.values?.property_type || property.values?.commercial_type || '—'} />
                <PropRow label="Captured" value={property.createdBy?.name ? `${property.createdBy.name} · ${fmtDate(property.createdAt)}` : fmtDate(property.createdAt)} />
              </div>
            </SectionCard>

            <SectionCard
              title="Location Preview"
              action={hasLoc(liveLoc) && isGps(liveLoc)
                ? <button className="btn btn-ghost btn-sm" onClick={() => setLocOpen(true)}>View <ExternalLink size={12} style={{ marginLeft: 4 }} /></button>
                : <a className="btn btn-ghost btn-sm" href={mapsLink} target="_blank" rel="noreferrer">View in Google Maps <ExternalLink size={12} style={{ marginLeft: 4 }} /></a>}
            >
              {mapPreviewSrc ? (
                isGps(liveLoc) ? (
                  <button type="button" onClick={() => setLocOpen(true)} style={{ display: 'block', width: '100%', padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}>
                    <iframe title="Location" src={mapPreviewSrc} style={{ width: '100%', height: 160, border: 0, borderRadius: 8, pointerEvents: 'none' }} loading="lazy" />
                  </button>
                ) : (
                  <>
                    <iframe title="Location" src={mapPreviewSrc} style={{ width: '100%', height: 160, border: 0, borderRadius: 8 }} loading="lazy" />
                    <span className="tiny muted" style={{ display: 'block', marginTop: 6 }}>Approximate area — {locQuery}. No exact GPS captured yet.</span>
                  </>
                )
              ) : (
                <div className="row gap-2 tiny muted" style={{ alignItems: 'center' }}><MapPin size={14} /> No location or city on record yet.</div>
              )}
            </SectionCard>

            <SectionCard title="Activity Timeline">
              {activitiesLoading ? (
                <SkeletonActivity rows={4} />
              ) : propertyActivity.length ? (
                <div className="col gap-2" style={{ maxHeight: 170, overflowY: 'auto' }}>
                  {propertyActivity.slice(0, 8).map((a) => (
                    <div key={a._id} className="row gap-2" style={{ alignItems: 'flex-start', padding: '4px 0' }}>
                      {timelineIcon(a.message, a.action)}
                      <div className="col grow" style={{ minWidth: 0 }}>
                        <span className="tiny" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.message}</span>
                        <span className="tiny muted">by {a.actor?.name || 'System'} · {fromNow(a.createdAt)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : <div className="empty sm" style={{ padding: '12px' }}>No activity yet</div>}
            </SectionCard>
          </div>
        </div>
      </div>

      <LocationPreviewModal open={locOpen} onClose={() => setLocOpen(false)} value={liveLoc} />

      <Modal
        open={!!previewMedia}
        onClose={() => setPreviewMedia(null)}
        title={previewMedia?.originalName || previewMedia?.name || 'Preview'}
        width={720}
        footer={previewMedia && mediaUrl(previewMedia) ? (
          <a className="btn btn-subtle" href={mediaUrl(previewMedia)} target="_blank" rel="noreferrer" download>
            <Download size={14} style={{ marginRight: 6 }} /> Download
          </a>
        ) : null}
      >
        {previewMedia && mediaKind(previewMedia) === 'video' && (
          <video src={mediaUrl(previewMedia)} controls autoPlay style={{ width: '100%', maxHeight: '70vh', borderRadius: 8, background: '#000' }} />
        )}
        {previewMedia && mediaKind(previewMedia) === 'audio' && (
          <audio src={mediaUrl(previewMedia)} controls autoPlay style={{ width: '100%' }} />
        )}
      </Modal>

      <MediaCaptureModal
        open={photoModalOpen}
        onClose={() => setPhotoModalOpen(false)}
        onCapture={({ file }) => savePhotos([file])}
        onSelectFiles={(files) => savePhotos(files)}
        accept="image/*"
        multiple
      />

      {activeForm && (
        <RecordFormModal
          open
          onClose={closeForm}
          schema={activeForm.type.masterDataSchema}
          recordNoun={activeForm.type.name}
          initialValues={activeForm.record?.values || null}
          submitLabel="Submit Assessment"
          saving={activeForm.record ? updateAssessment.isPending : createAssessment.isPending}
          loading={templateLoading}
          readOnly={activeForm.readOnly}
          meta={activeForm.readOnly ? buildRecordMeta(activeForm.record, allRecords, activeForm.type.name) : null}
          activity={activeForm.readOnly ? (activities || []).filter((a) => a.meta?.recordId === String(activeForm.record?._id)) : null}
          onEdit={!readOnly && activeForm.readOnly && activeForm.record && activeForm.record.status !== 'approved' ? switchToEdit : null}
          onSaveDraft={({ values }) => saveAssessment(values, 'draft')}
          onSubmit={({ values }) => saveAssessment(values, 'submitted')}
        />
      )}

      {deleteTarget && (
        <Modal open onClose={() => setDeleteTarget(null)} title="">
          <div className="col center gap-4 text-center" style={{ padding: '20px 10px 10px' }}>
            <div style={{ width: 50, height: 50, borderRadius: '50%', background: '#FEE2E2', color: '#DC2626', display: 'grid', placeItems: 'center' }}>
              <Trash2 size={24} />
            </div>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginTop: 10 }}>Delete Assessment?</h3>
            <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>This action cannot be undone.</p>
            <div className="row gap-3 full" style={{ marginTop: 20 }}>
              <button type="button" className="btn btn-ghost grow" onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button type="button" className="btn btn-danger grow" onClick={async () => { await deleteAssessment.mutateAsync(deleteTarget._id); setDeleteTarget(null); }} disabled={deleteAssessment.isPending || readOnly || !canDecide}>
                {deleteAssessment.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

/* Sidebar property-summary row. */
function PropRow({ icon: Icon, label, value }) {
  return (
    <div className="row gap-2" style={{ alignItems: 'flex-start' }}>
      {Icon && <Icon size={14} className="muted" style={{ marginTop: 2, flexShrink: 0 }} />}
      <div className="col" style={{ minWidth: 0 }}>
        <span className="tiny subtle upper">{label}</span>
        <span className="sm" style={{ fontWeight: 600, wordBreak: 'break-word' }}>{value || '—'}</span>
      </div>
    </div>
  );
}

export default PropertyEvaluationPage;
