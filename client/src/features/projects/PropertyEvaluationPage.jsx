import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, ClipboardList } from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { SectionCard, Avatar, EmptyState } from '../../components/ui/primitives.jsx';
import { SkDetail, SkeletonActivity } from '../../components/ui/Skeletons.jsx';
import {
  useProject, useProjectActivity, useTemplate, useRecord,
  useCreateRecord, useUpdateRecord, useStageRecords, useMarkRecordOpened,
} from '../../lib/queries.js';
import { fmtDateTime, fromNow } from '../../lib/format.js';
import { RecordFormModal } from './records/RecordFormModal.jsx';
import { AssessmentCard } from './records/AssessmentCard.jsx';
import { RecordsTable } from './records/RecordsTable.jsx';
import { STEP_STATUS_META, propertyNo, buildRecordMeta } from './records/recordUi.js';

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
  const { data: project } = useProject(id);
  const templateId = project?.template?.ref?._id || project?.template?.ref;
  const { data: template, isLoading: templateLoading } = useTemplate(templateId);
  const { data: property, isLoading: propertyLoading } = useRecord(propertyId);
  const { data: activities, isLoading: activitiesLoading } = useProjectActivity(id);

  const stageKey = 'p2';
  const { data: assessmentRecords, isLoading: assessmentsLoading } = useStageRecords(id, stageKey, { parentRecordId: propertyId });
  const createAssessment = useCreateRecord(id, stageKey);
  const updateAssessment = useUpdateRecord(id, stageKey);
  // Logged against the property itself (a Phase 1 record), so it invalidates
  // the same caches a Phase 1 record mutation would.
  const markOpened = useMarkRecordOpened(id, 'p1');

  const [activeForm, setActiveForm] = useState(null); // { type, record } | null
  const openLoggedRef = useRef(false);

  const assessmentTypes = template?.stages?.find((s) => s.key === stageKey)?.assessmentTypes || [];
  // One card per assessment type, showing its most recent submission — but
  // "done" is "has ever been approved", independent of what the latest
  // submission's status happens to be (an approved type can still be
  // resubmitted without losing credit for the earlier approval).
  const steps = assessmentTypes.map((type) => {
    const typeRecords = (assessmentRecords || []).filter((r) => r.assessmentType === type.key);
    const sorted = [...typeRecords].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return { type, record: sorted[0] || null, hasApproved: typeRecords.some((r) => r.status === 'approved') };
  });
  const doneCount = steps.filter((s) => s.hasApproved).length;
  // Full history, newest first — every submission ever filed for this
  // property, not just the latest per type.
  const allRecords = [...(assessmentRecords || [])].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // "Property opened" is logged once — the very first time this workspace is
  // visited for a property that has no assessment activity yet. Revisits
  // don't spam the timeline (starting/submitting a step already logs its own
  // event once real work happens).
  useEffect(() => {
    if (openLoggedRef.current || assessmentsLoading || !property) return;
    openLoggedRef.current = true;
    if ((assessmentRecords || []).length === 0) {
      markOpened.mutate(propertyId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assessmentsLoading, property]);

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

  const evalStatus = evaluationStatusOf(doneCount, assessmentTypes.length);
  const emeta = STEP_STATUS_META[evalStatus];

  // This property's own activity — its "opened" event plus every
  // create/update/submit event from its four assessment records. Approve/
  // Reject/revert-decision events are excluded: this page's timeline is a
  // submission history only, since property approval now happens on the
  // Comparison Dashboard, not here (backend still logs them unchanged —
  // this is a display-only filter).
  const relevantIds = new Set([String(propertyId), ...(assessmentRecords || []).map((r) => String(r._id))]);
  const isDecisionEvent = (a) => /\b(approved|rejected|reverted)\b/i.test(a.message || '');
  const propertyActivity = (activities || []).filter((a) => relevantIds.has(a.meta?.recordId) && !isDecisionEvent(a));

  // A card's primary button always starts a brand-new submission — clicking
  // "New Assessment" never resumes an existing draft, so a prior submission
  // (of any status) is never touched by it. Resuming a specific draft/
  // rejected/submitted record only happens via the table's Edit action.
  const openStep = (index) => {
    const { type } = steps[index];
    setActiveForm({ type, record: null, readOnly: false });
  };
  // Records-table row click — the whole row is the action, opening the
  // read-only view (there's no Actions column). Edit lives inside that
  // view's footer (see RecordFormModal); there is no Approve/Reject here.
  const openView = (record) => {
    const type = assessmentTypes.find((t) => t.key === record.assessmentType);
    setActiveForm({ type, record, readOnly: true });
  };
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
    if (record && record.status !== 'approved') {
      await updateAssessment.mutateAsync({ id: record._id, values, status });
    } else {
      await createAssessment.mutateAsync({ values, status, assessmentType: type.key, parentRecordId: propertyId });
    }
    closeForm();
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
              <InfoTile label="City" value={property.values?.city} />
              <InfoTile label="Locality" value={property.values?.locality} />
              <InfoTile label="Evaluation Status" value={emeta.label} tone={emeta.color} />
              <InfoTile
                label="Overall Progress"
                value={`${doneCount}/${assessmentTypes.length} Completed (${Math.round((doneCount / (assessmentTypes.length || 1)) * 100)}%)`}
              />
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
                    actionLabel="New Assessment"
                    showStatus={false}
                    onOpen={() => openStep(i)}
                  />
                ))}
              </div>
            ) : (
              <EmptyState icon={ClipboardList} title="No assessments configured" hint="Add assessment types to the Site Evaluation stage in the template." />
            )}
          </SectionCard>

          {/* Assessment Records — full submission history, newest first.
              Every assessment type supports unlimited resubmissions, so a
              type can appear more than once here; it's a read-only history —
              opening a row shows the read-only view, never Approve/Reject
              (see RecordsTable/RecordFormModal — omitting onApprove/onReject
              drops those entirely). */}
          <RecordsTable
            title="Assessment Records"
            typeColumnLabel="Assessment Type"
            records={allRecords}
            assessmentTypes={assessmentTypes}
            onView={openView}
            showStatus={false}
            emptyTitle="No assessments filed yet"
            emptyHint="Fill and submit an assessment above to see it here."
          />

          {/* Activity Timeline — scoped to this property's evaluation only */}
          <SectionCard title="Activity Timeline">
            {activitiesLoading ? (
              <SkeletonActivity rows={4} />
            ) : propertyActivity.length ? (
              <div className="col gap-2">
                {propertyActivity.map((a) => (
                  <div key={a._id} className="row gap-3">
                    <Avatar name={a.actor?.name || 'System'} color={a.actor?.avatarColor || 'var(--ink-500)'} size={28} />
                    <div className="col grow">
                      <div className="sm"><b>{a.actor?.name || 'System'}</b> <span className="muted">{a.message}</span></div>
                      <div className="tiny muted">{fmtDateTime(a.createdAt)} · {fromNow(a.createdAt)}</div>
                    </div>
                  </div>
                ))}
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
    </>
  );
}

export default PropertyEvaluationPage;
