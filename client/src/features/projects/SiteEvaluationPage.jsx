import { useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ClipboardList, CheckCircle2, RotateCcw, Search } from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { SectionCard, Badge, Avatar, EmptyState, ProgressBar } from '../../components/ui/primitives.jsx';
import { SkPropertyIdentification, SkeletonTable, SkeletonActivity } from '../../components/ui/Skeletons.jsx';
import {
  useProject, useProjectActivity, useTemplate, useBoard,
  useStageRecords, useCompleteStage, useReopenStage,
} from '../../lib/queries.js';
import { STAGE_STATUS_META } from '../../lib/ui.js';
import { fmtDateTime, fromNow, fmtDate } from '../../lib/format.js';
import { getEmployeeById } from '../../lib/employees.js';
import { useAuthStore } from '../../store/authStore.js';
import { STEP_STATUS_META, stepStatusOf } from './records/recordUi.js';

const ASSIGNMENT_STATUS = {
  not_started: 'Pending assignment',
  in_progress: 'Active',
  blocked: 'Blocked',
  completed: 'Completed',
};

const SORTS = [
  { key: 'updated', label: 'Last Updated' },
  { key: 'progress', label: 'Progress' },
];

function InfoTile({ label, value, tone }) {
  return (
    <div className="col gap-1" style={{ minWidth: 140 }}>
      <span className="tiny subtle upper">{label}</span>
      <span className="sm" style={{ fontWeight: 650, color: tone || 'var(--text)' }}>{value ?? '—'}</span>
    </div>
  );
}

const tileGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 'var(--space-4)' };

const ellipsisCell = (maxWidth) => ({
  display: 'block',
  maxWidth,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

/** Aggregate a property's step statuses into one Pending/In Progress/Completed badge. */
function evaluationStatusOf(doneCount, total) {
  if (!total || doneCount === 0) return 'pending';
  if (doneCount === total) return 'completed';
  return 'in_progress';
}

/**
 * Site Evaluation home — a dashboard/list of shortlisted properties only. No
 * assessment work happens here; opening a property navigates to its own
 * dedicated PropertyEvaluationPage (`/site-evaluation/:propertyId`).
 */
export function SiteEvaluationPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  // Search/sort live in the URL so returning from a property's page restores
  // them (and the browser's native scroll position) exactly.
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get('q') || '';
  const sort = searchParams.get('sort') || 'updated';
  const setSearch = (value) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set('q', value); else next.delete('q');
    setSearchParams(next, { replace: true });
  };
  const setSort = (value) => {
    const next = new URLSearchParams(searchParams);
    next.set('sort', value);
    setSearchParams(next, { replace: true });
  };

  const { data: project, isLoading } = useProject(id);
  const templateId = project?.template?.ref?._id || project?.template?.ref;
  const { data: template } = useTemplate(templateId);
  const { data: board } = useBoard(id);
  const { data: activities, isLoading: activitiesLoading } = useProjectActivity(id);

  const stage = project?.stages?.find((s) => s.key === 'p2');
  const stageKey = 'p2';

  // Eligible properties: only Phase 1 records already shortlisted — Site
  // Evaluation never creates properties of its own, and rejected properties
  // never reach this query at all.
  const { data: properties, isLoading: propertiesLoading } = useStageRecords(id, 'p1', { status: 'shortlisted' });
  // Every Phase 2 assessment record for the project, used to derive each
  // property's per-step status and the Mark Done gate.
  const { data: assessmentRecords } = useStageRecords(id, stageKey);

  const completeStage = useCompleteStage(id);
  const reopenStage = useReopenStage(id);
  const user = useAuthStore((s) => s.user);
  const canReopen = user?.role === 'admin' || user?.role === 'manager';

  const [confirmDone, setConfirmDone] = useState(false);

  if (isLoading || !project) {
    return (<><Topbar title="Site Evaluation" /><div className="content"><SkPropertyIdentification /></div></>);
  }
  if (!stage) {
    return (
      <>
        <Topbar
          title={<span className="row gap-3"><button className="btn btn-ghost btn-icon" onClick={() => navigate(`/projects/${id}`)}><ArrowLeft size={16} /></button>Site Evaluation</span>}
        />
        <div className="content">
          <EmptyState icon={ClipboardList} title="No Site Evaluation stage" hint="This project has no Site Evaluation stage." />
        </div>
      </>
    );
  }

  // Every step is driven by the template's assessmentTypes — never a
  // hardcoded list, so a 5th assessment added later needs no component change.
  const assessmentTypes = template?.stages?.find((s) => s.key === stageKey)?.assessmentTypes || [];
  const meta = STAGE_STATUS_META[stage.status] || { label: stage.status, color: '#7c7784' };

  const stageTasks = (board?.columns || []).flatMap((c) => c.tasks || []).filter((t) => t.stageKey === stageKey);
  const doneTasks = stageTasks.filter((t) => t.status === 'done').length;
  const progress = stageTasks.length ? Math.round((doneTasks / stageTasks.length) * 100) : 0;

  const firstTask = stageTasks[0];
  const primary = getEmployeeById(firstTask?.primaryAssignee);
  const backup = getEmployeeById(firstTask?.backupAssignee);
  const owner = project.owner;

  const stageActivity = (activities || []).filter(
    (a) => (a.entityType === 'record' || a.entityType === 'stage') && a.meta?.stageKey === stageKey,
  );

  const isCompleted = stage.status === 'completed';

  const doneCountFor = (propertyId) =>
    assessmentTypes.filter((t) =>
      stepStatusOf((assessmentRecords || []).find((r) => String(r.parentRecordId) === String(propertyId) && r.assessmentType === t.key)) === 'completed',
    ).length;

  // Business rule: Site Evaluation is done only once EVERY shortlisted
  // property has completed (submitted) all four assessment steps.
  const canMarkDone =
    assessmentTypes.length > 0 &&
    (properties || []).length > 0 &&
    (properties || []).every((p) => doneCountFor(p._id) === assessmentTypes.length);

  const confirmMarkDone = () => completeStage.mutate(stageKey, { onSuccess: () => setConfirmDone(false) });
  const openProperty = (p) => navigate(`/projects/${id}/site-evaluation/${p._id}`);

  const q = search.trim().toLowerCase();
  const rows = (properties || [])
    .filter((p) => !q || [p.title, p.values?.city, p.values?.locality].some((v) => (v || '').toLowerCase().includes(q)))
    .map((p) => ({ ...p, __done: doneCountFor(p._id) }))
    .sort((a, b) => {
      if (sort === 'progress') return b.__done - a.__done;
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    });

  return (
    <>
      <Topbar
        title={
          <span className="row gap-3">
            <button className="btn btn-ghost btn-icon" onClick={() => navigate(`/projects/${id}`)} aria-label="Back to project">
              <ArrowLeft size={16} />
            </button>
            {stage.name}
          </span>
        }
        subtitle={`${project.code} · ${project.name}`}
      />
      <div className="content">
        <div className="content-narrow col gap-5 fade-in">
          {/* 1. Stage Overview */}
          <SectionCard
            title="Stage Overview"
            action={
              isCompleted ? (
                canReopen && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => reopenStage.mutate(stageKey)}
                    disabled={reopenStage.isPending}
                  >
                    <RotateCcw size={14} /> Reopen Stage
                  </button>
                )
              ) : (
                <div className="col" style={{ alignItems: 'flex-end', gap: 4 }}>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => setConfirmDone(true)}
                    disabled={!canMarkDone}
                    title={canMarkDone ? undefined : 'Every shortlisted property must reach 4/4 Completed before completing this stage.'}
                  >
                    <CheckCircle2 size={14} /> Mark Done
                  </button>
                </div>
              )
            }
          >
            <div style={tileGrid}>
              <InfoTile label="Stage" value={stage.name} />
              <InfoTile label="Status" value={meta.label} tone={meta.color} />
              <InfoTile label="Progress" value={`${progress}%`} />
              <InfoTile label="SLA" value={`${stage.slaDays || 0} days`} />
              <InfoTile label="Started" value={fmtDate(stage.startedAt)} />
              <InfoTile label="Expected Completion" value={fmtDate(stage.plannedEnd)} />
              {stage.completedBy && <InfoTile label="Completed By" value={stage.completedBy.name} />}
              {stage.completedAt && <InfoTile label="Completed At" value={fmtDateTime(stage.completedAt)} tone={isCompleted ? 'var(--success)' : undefined} />}
              {!stage.completedAt && <InfoTile label="Actual Completion" value="—" />}
              {stage.reopenedBy && <InfoTile label="Reopened By" value={stage.reopenedBy.name} />}
              {stage.reopenedAt && <InfoTile label="Reopened At" value={fmtDateTime(stage.reopenedAt)} />}
            </div>
          </SectionCard>

          {/* 2. Task Assignment (derived — some fields are not tracked in the model) */}
          <SectionCard title="Task Assignment">
            <div style={tileGrid}>
              <InfoTile label="Primary Doer" value={primary?.name || '—'} />
              <InfoTile label="Backup Doer" value={backup?.name || '—'} />
              <InfoTile label="Assigned By" value={owner?.name || '—'} />
              <InfoTile label="Assigned On" value={fmtDateTime(stage.startedAt || stage.plannedStart)} />
              <InfoTile label="Current Owner" value={owner?.name || '—'} />
              <InfoTile label="Assignment Status" value={ASSIGNMENT_STATUS[stage.status] || '—'} tone={meta.color} />
            </div>
          </SectionCard>

          {/* 3. Shortlisted Properties — a plain list/dashboard. All
              assessment work happens on the dedicated Property Evaluation
              page; creating a property is never possible from this stage. */}
          <SectionCard title="Shortlisted Properties" subtitle={`${(properties || []).length} eligible`}>
            <div className="col gap-4">
              <div className="row gap-3 wrap">
                <div className="input-icon-wrap grow" style={{ minWidth: 200 }}>
                  <Search size={15} className="input-icon" />
                  <input
                    className="input"
                    placeholder="Search by property name, city, locality…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <select className="select" style={{ maxWidth: 200 }} value={sort} onChange={(e) => setSort(e.target.value)}>
                  {SORTS.map((s) => <option key={s.key} value={s.key}>Sort: {s.label}</option>)}
                </select>
              </div>

              {propertiesLoading ? (
                <SkeletonTable columns={['6%', '26%', '14%', '14%', '14%', '16%', '10%']} rows={4} />
              ) : rows.length ? (
                <div style={{ overflowX: 'auto' }}>
                  <table className="table table-clickable">
                    <thead>
                      <tr>
                        <th>No.</th>
                        <th>Property Name</th>
                        <th>City</th>
                        <th>Locality</th>
                        <th>Evaluation Status</th>
                        <th>Progress</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((p) => {
                        const evalStatus = evaluationStatusOf(p.__done, assessmentTypes.length);
                        const emeta = STEP_STATUS_META[evalStatus];
                        return (
                          <tr key={p._id} onClick={() => openProperty(p)} style={{ height: 52 }}>
                            <td className="mono tiny subtle" style={{ whiteSpace: 'nowrap' }}>{p.seq ?? '—'}</td>
                            <td style={{ fontWeight: 650, whiteSpace: 'nowrap' }}>
                              <span style={ellipsisCell(240)} title={p.title || 'Untitled Property'}>{p.title || 'Untitled Property'}</span>
                            </td>
                            <td style={{ whiteSpace: 'nowrap' }}><span style={ellipsisCell(140)}>{p.values?.city || '—'}</span></td>
                            <td style={{ whiteSpace: 'nowrap' }}><span style={ellipsisCell(160)}>{p.values?.locality || '—'}</span></td>
                            <td style={{ whiteSpace: 'nowrap' }}><Badge color={emeta.color}>{emeta.label}</Badge></td>
                            <td style={{ whiteSpace: 'nowrap', minWidth: 120 }}>
                              <div className="row gap-2" style={{ alignItems: 'center' }}>
                                <div style={{ width: 60 }}><ProgressBar value={(p.__done / (assessmentTypes.length || 1)) * 100} height={6} /></div>
                                <span className="tiny muted">{p.__done}/{assessmentTypes.length}</span>
                              </div>
                            </td>
                            <td onClick={(e) => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
                              <button type="button" className="btn btn-ghost btn-sm" onClick={() => openProperty(p)}>
                                Open
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState
                  icon={ClipboardList}
                  title={search ? 'No matches' : 'No shortlisted properties yet'}
                  hint={search ? 'Try a different search.' : 'Shortlist a property in Property Identification to begin its Site Evaluation.'}
                />
              )}
            </div>
          </SectionCard>

          {/* 4. Activity Timeline */}
          <SectionCard title="Activity Timeline">
            {activitiesLoading ? (
              <SkeletonActivity rows={4} />
            ) : stageActivity.length ? (
              <div className="col gap-4">
                {stageActivity.map((a) => (
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

      {confirmDone && (
        <Modal
          open
          onClose={() => setConfirmDone(false)}
          title={`Complete ${stage.name}?`}
          width={440}
          footer={
            <div className="row gap-2">
              <button type="button" className="btn btn-subtle" onClick={() => setConfirmDone(false)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={confirmMarkDone} disabled={completeStage.isPending}>
                {completeStage.isPending ? <span className="spinner" /> : 'Mark Done'}
              </button>
            </div>
          }
        >
          <p className="sm muted">Are you sure you want to mark this stage as completed?</p>
          {completeStage.isError && (
            <p className="sm" style={{ color: 'var(--danger)' }}>
              {completeStage.error?.response?.data?.message || 'Could not complete the stage.'}
            </p>
          )}
        </Modal>
      )}
    </>
  );
}

export default SiteEvaluationPage;
