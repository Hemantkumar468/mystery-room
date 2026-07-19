import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, ClipboardList, Plus, Pencil, Trash2, Info } from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { SectionCard, Avatar, EmptyState } from '../../components/ui/primitives.jsx';
import { SkDetail, SkeletonActivity } from '../../components/ui/Skeletons.jsx';
import {
  useProject, useProjectActivity, useTemplate, useRecord,
  useCreateRecord, useUpdateRecord, useDeleteRecord, useStageRecords, useMarkRecordOpened,
} from '../../lib/queries.js';
import { fmtDateTime, fromNow } from '../../lib/format.js';
import { RecordFormModal } from './records/RecordFormModal.jsx';
import { AssessmentCard } from './records/AssessmentCard.jsx';
import { RecordsTable } from './records/RecordsTable.jsx';
import { STEP_STATUS_META, propertyNo, buildRecordMeta } from './records/recordUi.js';
import { feasibilityPercent, financialPercent, technicalPercent, operationalPercent } from './records/scoring.js';

const SECTION_SCORERS = {
  feasibility: feasibilityPercent,
  financial: financialPercent,
  technical: technicalPercent,
  operational: operationalPercent,
};

function InfoTile({ label, value, tone }) {
  return (
    <div className="col gap-1" style={{ minWidth: 100 }}>
      <span className="tiny subtle upper">{label}</span>
      <span className="sm" style={{ fontWeight: 650, color: tone || 'var(--text)' }}>{value ?? '—'}</span>
    </div>
  );
}

const tileGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 'var(--space-3)' };

/** Aggregate a property's four cards into one Pending/In Progress/Completed badge. */
function evaluationStatusOf(doneCount, total) {
  if (!total || doneCount === 0) return 'pending';
  if (doneCount === total) return 'completed';
  return 'in_progress';
}

/**
 * Dedicated per-property Site Evaluation workspace — a full page (never a
 * modal, never inline in the Shortlisted Properties table), reached only
 * from a shortlisted property's row/Open button in SiteEvaluationPage.
 *
 * Every assessment type supports unlimited submissions, same as Project
 * Creation/Department Planning: a card's primary button always starts a
 * brand-new submission (never resumes a draft in place — "New Assessment"
 * means new, every time), so history is never overwritten. A card shows its
 * type's most recent submission for display; the Assessment Records table
 * below lists every submission ever filed, newest first, as a read-only
 * history/audit trail — there is no per-assessment or per-property Approve/
 * Reject here. Progress counts a type as done once it has ever had an
 * Approved submission (approvals happen upstream of this page) — a later
 * resubmission after approval doesn't undo that. Only an Approved record is
 * immutable going forward; draft, submitted and rejected records all stay
 * editable in place via the table row's read-only view (Edit lives there).
 * Property-level Approve/Reject is decided from the Site Evaluation
 * Comparison Dashboard, where shortlisted properties are compared side-by-
 * side, not from this single-property workspace.
 */
export function PropertyEvaluationPage() {
  const { id, propertyId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { data: project } = useProject(id);
  const templateId = project?.template?.ref?._id || project?.template?.ref;
  const { data: template, isLoading: templateLoading } = useTemplate(templateId);
  const { data: property, isLoading: propertyLoading } = useRecord(propertyId);
  const { data: activities, isLoading: activitiesLoading } = useProjectActivity(id);

  const stageKey = 'p2';
  const { data: assessmentRecords, isLoading: assessmentsLoading } = useStageRecords(id, stageKey, { parentRecordId: propertyId });
  const createAssessment = useCreateRecord(id, stageKey);
  const updateAssessment = useUpdateRecord(id, stageKey);
  const deleteAssessment = useDeleteRecord(id, stageKey);
  // Logged against the property itself (a Phase 1 record), so it invalidates
  // the same caches a Phase 1 record mutation would.
  const markOpened = useMarkRecordOpened(id, 'p1');

  const [activeForm, setActiveForm] = useState(null); // { type, record } | null
  const [deleteTarget, setDeleteTarget] = useState(null); // record to delete
  const openLoggedRef = useRef(false);

  const assessmentTypes = template?.stages?.find((s) => s.key === stageKey)?.assessmentTypes || [];
  // One card per assessment type, showing its most recent submission — but
  // "done" is "has ever been submitted/completed", meaning a record exists
  const steps = assessmentTypes.map((type) => {
    const typeRecords = (assessmentRecords || []).filter((r) => r.assessmentType === type.key);
    const sorted = [...typeRecords].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return { type, record: sorted[0] || null, hasRecord: typeRecords.length > 0 };
  });
  const doneCount = steps.filter((s) => s.hasRecord).length;
  // Full history, newest first — every submission ever filed for this
  // property, not just the latest per type.
  const allRecords = [...(assessmentRecords || [])].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // "Property opened" is logged once
  useEffect(() => {
    if (openLoggedRef.current || assessmentsLoading || !property) return;
    openLoggedRef.current = true;
    if ((assessmentRecords || []).length === 0) {
      markOpened.mutate(propertyId);
    }
  }, [assessmentsLoading, property]);

  // Hook to handle direct navigation editing (editRecordId check)
  useEffect(() => {
    if (assessmentsLoading || !assessmentRecords) return;
    const editId = location.state?.editRecordId;
    if (editId) {
      const rec = assessmentRecords.find((r) => String(r._id) === String(editId));
      if (rec) {
        openEdit(rec);
        // Clear state so it doesn't open again on re-render/back
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
        <Topbar
          title={<span className="row gap-3"><button className="btn btn-ghost btn-icon" onClick={backToList} aria-label="Back"><ArrowLeft size={16} /></button>Site Evaluation</span>}
        />
        <div className="content">
          <EmptyState
            icon={ClipboardList}
            title="Not eligible for Site Evaluation"
            hint="Only properties shortlisted in Property Identification can be evaluated here."
          />
        </div>
      </>
    );
  }

  // Evaluation Status calculation based on user requirements:
  // - 0 assessments: Not Started (Gray)
  // - All 4 completed: Completed (Green)
  // - 1-3 completed: In Progress (Blue)
  const getEvaluationStatus = () => {
    if (doneCount === 0) {
      return { label: 'Not Started', color: '#6B7280', soft: '#F3F4F6' };
    }
    if (doneCount === assessmentTypes.length) {
      return { label: 'Completed', color: '#059669', soft: '#DCFCE7' };
    }
    return { label: 'In Progress', color: '#2563EB', soft: '#DBEAFE' };
  };
  const evalStatusMeta = getEvaluationStatus();

  const progressPct = Math.round((doneCount / (assessmentTypes.length || 1)) * 100);
  const progressText = doneCount === assessmentTypes.length
    ? `${doneCount}/${assessmentTypes.length} Completed (${progressPct}%)`
    : `${doneCount}/${assessmentTypes.length} (${progressPct}%)`;

  // Evaluation started once the first assessment of any type was ever filed;
  // last updated is the most recent touch across every submission (or the
  // property itself, if no assessment has been filed yet).
  const startedAt = allRecords.length
    ? allRecords.reduce((min, r) => (new Date(r.createdAt) < new Date(min) ? r.createdAt : min), allRecords[0].createdAt)
    : null;
  const lastUpdatedAt = allRecords.length
    ? allRecords.reduce((max, r) => (new Date(r.updatedAt) > new Date(max) ? r.updatedAt : max), allRecords[0].updatedAt)
    : property.updatedAt;

  const scoreFor = (record) => {
    if (record.status !== 'approved') return null;
    const scorer = SECTION_SCORERS[record.assessmentType];
    return scorer ? scorer(record.values) : null;
  };

  // This property's own activity — its "opened" event plus every
  // create/update/submit event from its four assessment records. Approve/
  // Reject/revert-decision events are excluded: this page's timeline is a
  // submission history only, since property approval now happens on the
  // Comparison Dashboard, not here (backend still logs them unchanged —
  // this is a display-only filter).
  const relevantIds = new Set([String(propertyId), ...(assessmentRecords || []).map((r) => String(r._id))]);
  const isDecisionEvent = (a) => /\b(approved|rejected|reverted)\b/i.test(a.message || '');
  const propertyActivity = (activities || []).filter((a) => (relevantIds.has(a.meta?.recordId) || a.meta?.parentRecordId === String(propertyId)) && !isDecisionEvent(a));

  // A card's primary button always starts a brand-new submission — clicking
  // "New Assessment" never resumes an existing draft, so a prior submission
  // (of any status) is never touched by it. Resuming a specific draft/
  // rejected/submitted record only happens via the table's Edit action.
  const openStep = (index) => {
    const { type } = steps[index];
    setActiveForm({ type, record: null, readOnly: false });
  };
  const openView = (record) => {
    navigate(`/projects/${id}/site-evaluation/${propertyId}/assessment/${record._id}`);
  };
  function openEdit(record) {
    const type = assessmentTypes.find((t) => t.key === record.assessmentType);
    setActiveForm({ type, record, readOnly: false });
  }
  // Switches the currently-open view into the editable form, in place —
  // same record, same modal instance.
  const switchToEdit = () => setActiveForm((f) => (f ? { ...f, readOnly: false } : f));
  const closeForm = () => setActiveForm(null);

  // mutateAsync (not mutate) so a failed save rejects the promise
  // RecordFormModal awaits — otherwise a backend error (validation,
  // permission, network) would vanish silently: the modal would neither
  // show an error nor close, which is exactly the "nothing happens" symptom.
  // On success, cache invalidation (already wired into useCreateRecord/
  // useUpdateRecord) refetches assessmentRecords automatically, so the new
  // or updated row appears in the table below without a manual refresh.
  //
  // Any non-Approved record (draft, submitted, or rejected — rejected
  // records stay editable in place) is updated in place; an Approved record
  // is left untouched and a brand-new record is created instead — never
  // overwriting an already-earned approval, and always the case when opened
  // via a card's "New Assessment" button (record is always null there).
  const saveAssessment = async (values, status) => {
    const { type, record } = activeForm;
    if (record) {
      await updateAssessment.mutateAsync({ id: record._id, values, status });
    } else {
      await createAssessment.mutateAsync({ values, status, assessmentType: type.key, parentRecordId: propertyId });
    }
    closeForm();
  };

  const getTimelineItemDetails = (a) => {
    const msg = a.message || '';
    let title = 'Activity';
    let desc = msg;
    let iconType = 'info'; // 'plus', 'pencil', 'trash', 'info'

    if (msg.includes('submitted') || msg.includes('created') || a.action === 'created') {
      iconType = 'plus';
      const match = msg.match(/New (.*?) submitted/i) || msg.match(/(.*?) created/i);
      const name = match ? match[1] : 'Assessment';
      const capName = name.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      title = `${capName} Created`;
      desc = msg;
    } else if (msg.includes('updated') || a.action === 'updated') {
      iconType = 'pencil';
      const match = msg.match(/(.*?) updated/i);
      const name = match ? match[1] : 'Assessment';
      const capName = name.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      title = `${capName} Updated`;
      desc = msg;
    } else if (msg.includes('deleted') || a.action === 'deleted') {
      iconType = 'trash';
      const match = msg.match(/(.*?) deleted/i);
      const name = match ? match[1] : 'Assessment';
      const capName = name.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      title = `${capName} Deleted`;
      desc = msg;
    }

    return { title, desc, iconType };
  };

  const renderTimelineIcon = (type) => {
    const baseStyle = {
      width: 28,
      height: 28,
      borderRadius: '50%',
      display: 'grid',
      placeItems: 'center',
      flexShrink: 0,
      color: '#fff',
    };

    if (type === 'plus') {
      return (
        <div style={{ ...baseStyle, background: '#059669' }}>
          <Plus size={14} strokeWidth={2.5} />
        </div>
      );
    }
    if (type === 'pencil') {
      return (
        <div style={{ ...baseStyle, background: '#2563EB' }}>
          <Pencil size={14} strokeWidth={2.5} />
        </div>
      );
    }
    if (type === 'trash') {
      return (
        <div style={{ ...baseStyle, background: '#DC2626' }}>
          <Trash2 size={14} strokeWidth={2.5} />
        </div>
      );
    }
    return (
      <div style={{ ...baseStyle, background: '#6B7280' }}>
        <Info size={14} strokeWidth={2.5} />
      </div>
    );
  };

  return (
    <>
      <Topbar
        title={
          <span className="row gap-3">
            <button className="btn btn-ghost btn-icon" onClick={backToList} aria-label="Back to Site Evaluation">
              <ArrowLeft size={16} />
            </button>
            {property.title || 'Property'}
          </span>
        }
        subtitle={`${propertyNo(property.seq)} · Site Evaluation`}
      />
      <div className="content page-compact">
        <div className="content-wide col gap-3 fade-in">
          {/* No standalone "Back to Site Evaluation" button — the Topbar's
              back icon (above) already does this; a second identical control
              here would be redundant. Browser Back also just works, since
              this route is reached via a normal push navigation. */}

          {/* Header — property name, city, locality, overall progress */}
          <SectionCard title="Property">
            <div style={tileGrid}>
              <InfoTile label="Property Name" value={property.title} />
              <InfoTile label="Property Code" value={propertyNo(property.seq)} />
              <InfoTile label="City" value={property.values?.city} />
              <InfoTile label="Locality" value={property.values?.locality} />
              <InfoTile label="Project Name" value={project?.name} />
              <InfoTile label="Evaluation Status" value={evalStatusMeta.label} tone={evalStatusMeta.color} />
              <InfoTile label="Overall Progress" value={progressText} />
              <InfoTile label="Evaluation Started On" value={startedAt ? fmtDateTime(startedAt) : 'Not started'} />
              <InfoTile label="Last Updated" value={lastUpdatedAt ? fmtDateTime(lastUpdatedAt) : '—'} />
            </div>
          </SectionCard>

          {/* Four assessment modules, as clickable enterprise cards (see
              AssessmentCard) — entry points only. Every card is always
              enabled — assessments can be opened in any order. */}
          <SectionCard title="Site Evaluation" bodyClass="card-body-compact">
            {assessmentTypes.length ? (
              // Fixed 4-column grid (not auto-fit) — never wraps a 4th card
              // to a second row on desktop/laptop; collapses to 2 then 1
              // column at tablet/mobile widths (see .site-evaluation-grid).
              <div className="site-evaluation-grid">
                {steps.map(({ type, record }, i) => (
                  <AssessmentCard
                    key={type.key}
                    type={type}
                    record={record}
                    onOpen={() => openStep(i)}
                    onContinue={() => openEdit(record)}
                    onViewReport={() => openView(record)}
                  />
                ))}
              </div>
            ) : (
              <EmptyState icon={ClipboardList} title="No assessments configured" hint="Add assessment types to the Site Evaluation stage in the template." />
            )}
          </SectionCard>

          <div className="row end" style={{ marginBottom: 12 }}>
            <button
              type="button"
              className="btn btn-outline-primary"
              onClick={() => navigate(`/projects/${id}/site-evaluation/report?propertyId=${propertyId}`)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 650 }}
            >
              📄 View Complete Assessment Report
            </button>
          </div>

          {/* Assessment Records — full submission history, newest first. */}
          <RecordsTable
            title="Assessment Records"
            typeColumnLabel="Assessment Type"
            records={allRecords}
            assessmentTypes={assessmentTypes}
            onView={openView}
            showStatus={true}
            showScore={true}
            scoreFor={scoreFor}
            emptyTitle="No assessments filed yet"
            emptyHint="Fill and submit an assessment above to see it here."
            onEdit={openEdit}
            onDelete={setDeleteTarget}
          />

          {/* Activity Timeline — scoped to this property's evaluation only */}
          <SectionCard title="Activity Timeline">
            {activitiesLoading ? (
              <SkeletonActivity rows={4} />
            ) : propertyActivity.length ? (
              <div className="col gap-2">
                {propertyActivity.map((a) => {
                  const details = getTimelineItemDetails(a);
                  return (
                    <div key={a._id} className="row gap-3" style={{ alignItems: 'flex-start', padding: '6px 0' }}>
                      {renderTimelineIcon(details.iconType)}
                      <div className="col grow" style={{ textAlign: 'left' }}>
                        <div style={{ fontSize: 13.5, fontWeight: 650, color: 'var(--text)' }}>
                          {details.title}
                        </div>
                        <div style={{ fontSize: 12.5, color: 'var(--text-subtle)', marginTop: 2 }}>
                          {details.desc}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 4 }}>
                          by <b>{a.actor?.name || 'System'}</b> · {fmtDateTime(a.createdAt)} · {fromNow(a.createdAt)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="empty sm" style={{ padding: '16px 12px' }}>No activity yet</div>
            )}
          </SectionCard>
        </div>
      </div>

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
          onEdit={activeForm.readOnly && activeForm.record && activeForm.record.status !== 'approved' ? switchToEdit : null}
          onSaveDraft={({ values }) => saveAssessment(values, 'draft')}
          onSubmit={({ values }) => saveAssessment(values, 'submitted')}
        />
      )}

      {deleteTarget && (
        <Modal
          open
          onClose={() => setDeleteTarget(null)}
          title=""
        >
          <div className="col center gap-4 text-center" style={{ padding: '20px 10px 10px' }}>
            <div style={{
              width: 50,
              height: 50,
              borderRadius: '50%',
              background: '#FEE2E2',
              color: '#DC2626',
              display: 'grid',
              placeItems: 'center',
            }}>
              <Trash2 size={24} />
            </div>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginTop: 10 }}>Delete Assessment?</h3>
            <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>
              This action cannot be undone.
            </p>
            <div className="row gap-3 full" style={{ marginTop: 20 }}>
              <button
                type="button"
                className="btn btn-ghost grow"
                onClick={() => setDeleteTarget(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger grow"
                onClick={async () => {
                  await deleteAssessment.mutateAsync(deleteTarget._id);
                  setDeleteTarget(null);
                }}
                disabled={deleteAssessment.isPending}
              >
                {deleteAssessment.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

export default PropertyEvaluationPage;
