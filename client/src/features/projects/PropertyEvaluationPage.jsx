import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight, Lock, ClipboardList, CheckCircle2 } from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { SectionCard, Avatar, EmptyState, ProgressBar } from '../../components/ui/primitives.jsx';
import { SkDetail, SkeletonActivity } from '../../components/ui/Skeletons.jsx';
import {
  useProject, useProjectActivity, useTemplate, useRecord,
  useCreateRecord, useUpdateRecord, useStageRecords, useMarkRecordOpened,
} from '../../lib/queries.js';
import { fmtDateTime, fromNow } from '../../lib/format.js';
import { RecordFormModal } from './records/RecordFormModal.jsx';
import { STEP_STATUS_META, stepStatusOf, propertyNo, assessmentTypeIcon } from './records/recordUi.js';

function InfoTile({ label, value, tone }) {
  return (
    <div className="col gap-1" style={{ minWidth: 140 }}>
      <span className="tiny subtle upper">{label}</span>
      <span className="sm" style={{ fontWeight: 650, color: tone || 'var(--text)' }}>{value ?? '—'}</span>
    </div>
  );
}

const tileGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 'var(--space-4)' };

function evaluationStatusOf(doneCount, total) {
  if (!total || doneCount === 0) return 'pending';
  if (doneCount === total) return 'completed';
  return 'in_progress';
}

/**
 * Dedicated per-property Site Evaluation workspace — a full page (never a
 * modal, never inline in the Shortlisted Properties table), reached only
 * from a shortlisted property's row/Open button in SiteEvaluationPage. Walks
 * the property through its four assessment steps in strict order: each
 * unlocks only once the one before it is submitted. Completed steps stay
 * open for review/edit.
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
  const steps = assessmentTypes.map((type) => ({
    type,
    record: (assessmentRecords || []).find((r) => r.assessmentType === type.key),
  }));
  const doneCount = steps.filter(({ record }) => stepStatusOf(record) === 'completed').length;
  // The first not-yet-completed step is the only NEW step open for work;
  // steps before it stay reviewable/editable, steps after it stay locked.
  const activeStepIndex = steps.findIndex(({ record }) => stepStatusOf(record) !== 'completed');

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
  // start/complete event from its four assessment records.
  const relevantIds = new Set([String(propertyId), ...(assessmentRecords || []).map((r) => String(r._id))]);
  const propertyActivity = (activities || []).filter((a) => relevantIds.has(a.meta?.recordId));

  const openStep = (index) => {
    // Steps before the active one are completed but stay editable; the
    // active step is open for first-time work; anything after stays locked.
    const isLocked = activeStepIndex !== -1 && index > activeStepIndex;
    if (isLocked) return;
    const { type, record } = steps[index];
    setActiveForm({ type, record: record || null, index });
  };
  const closeForm = () => setActiveForm(null);
  const saveAssessment = (values, status) => {
    const { type, record, index } = activeForm;
    const isLastStep = index === assessmentTypes.length - 1;
    const onSaved = () => {
      closeForm();
      // Once the final step is submitted, this property's evaluation is
      // fully done — return to the Site Evaluation list, where its Progress
      // column now reads 4/4 and Evaluation Status reads Completed.
      if (status === 'submitted' && isLastStep) navigate(`/projects/${id}/site-evaluation`);
    };
    if (record) {
      updateAssessment.mutate({ id: record._id, values, status }, { onSuccess: onSaved });
    } else {
      createAssessment.mutate(
        { values, status, assessmentType: type.key, parentRecordId: propertyId },
        { onSuccess: onSaved },
      );
    }
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
      <div className="content">
        <div className="content-narrow col gap-5 fade-in">
          <button type="button" className="btn btn-ghost btn-sm" onClick={backToList} style={{ alignSelf: 'flex-start' }}>
            <ChevronLeft size={14} /> Back to Site Evaluation
          </button>

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

          {/* Four assessment stages, horizontal stepper */}
          <SectionCard title="Site Evaluation">
            {assessmentTypes.length ? (
              <div className="col gap-4">
                <ProgressBar value={(doneCount / assessmentTypes.length) * 100} />
                <div className="row gap-2 wrap" style={{ alignItems: 'center' }}>
                  {steps.map(({ type, record }, i) => {
                    const status = stepStatusOf(record);
                    const smeta = STEP_STATUS_META[status];
                    const isLocked = activeStepIndex !== -1 && i > activeStepIndex;
                    const isActive = i === activeStepIndex;
                    const isCompleted = status === 'completed';
                    const StepIcon = isLocked ? Lock : assessmentTypeIcon(type.key);
                    return (
                      <div key={type.key} className="row gap-2" style={{ alignItems: 'center' }}>
                        <button
                          type="button"
                          disabled={isLocked}
                          onClick={() => openStep(i)}
                          className="col gap-1"
                          title={isCompleted ? 'Completed — click to review or edit' : isLocked ? 'Locked — complete the previous step first' : undefined}
                          style={{
                            position: 'relative',
                            padding: '10px 16px',
                            borderRadius: 10,
                            border: `1px solid ${isActive ? 'var(--primary)' : 'var(--border)'}`,
                            background: isCompleted ? 'var(--success)' : isActive ? 'var(--primary)' : 'var(--surface-2)',
                            color: isCompleted || isActive ? '#fff' : 'var(--text)',
                            opacity: isLocked ? 0.55 : 1,
                            cursor: isLocked ? 'not-allowed' : 'pointer',
                            minWidth: 160,
                            alignItems: 'flex-start',
                          }}
                        >
                          {/* Completion indicator — distinct from the step icon, only
                              shown once the step is actually submitted. */}
                          {isCompleted && (
                            <CheckCircle2
                              size={16}
                              style={{ position: 'absolute', top: -7, right: -7, background: 'var(--surface)', borderRadius: '50%', color: 'var(--success)' }}
                            />
                          )}
                          <span className="tiny" style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <StepIcon size={13} /> {i + 1}. {type.name}
                          </span>
                          <span className="tiny" style={{ opacity: 0.85 }}>{smeta.label}</span>
                        </button>
                        {i < steps.length - 1 && <ChevronRight size={16} className="subtle" style={{ flexShrink: 0 }} />}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <EmptyState icon={ClipboardList} title="No assessments configured" hint="Add assessment types to the Site Evaluation stage in the template." />
            )}
          </SectionCard>

          {/* Activity Timeline — scoped to this property's evaluation only */}
          <SectionCard title="Activity Timeline">
            {activitiesLoading ? (
              <SkeletonActivity rows={4} />
            ) : propertyActivity.length ? (
              <div className="col gap-4">
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
          onSaveDraft={({ values }) => saveAssessment(values, 'draft')}
          onSubmit={({ values }) => saveAssessment(values, 'submitted')}
        />
      )}
    </>
  );
}

export default PropertyEvaluationPage;
