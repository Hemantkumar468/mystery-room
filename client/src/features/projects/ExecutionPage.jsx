import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ClipboardList, Plus,
  CheckCircle2, XCircle, Clock, Eye, FilePenLine, Circle,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { SectionCard, Badge, EmptyState, ProgressBar, PriorityBadge } from '../../components/ui/primitives.jsx';
import { SkPropertyIdentification, SkeletonActivity } from '../../components/ui/Skeletons.jsx';
import {
  useProject, useProjectActivity, useTemplate,
  useStageRecords, useCreateRecord, useUpdateRecord, useMarkRecordOpened, useCompleteStage,
} from '../../lib/queries.js';
import { fmtDateTime, fromNow, fmtDate } from '../../lib/format.js';
import { RecordFormModal } from './records/RecordFormModal.jsx';
import { approvedTypeCount, propertyNo, buildRecordMeta } from './records/recordUi.js';

/**
 * One accent color per department card — the exact same ten-color sequence
 * Department Planning (p5) uses for the same ten departments, so a
 * department's identity color stays consistent from planning through
 * execution. No new colors invented.
 */
const MODULE_ACCENTS = [
  'var(--chart-5)', 'var(--chart-1)', 'var(--chart-7)', 'var(--info)', 'var(--chart-3)',
  'var(--chart-8)', 'var(--chart-6)', 'var(--warning)', 'var(--chart-2)', 'var(--danger)',
];

/**
 * A single execution task's own status — the seven states the Phase 6 spec
 * calls for. Distinct from a Record's generic draft/submitted workflow
 * status (Execution has no approve/reject decision step — a task is created
 * and updated directly, see saveTask), this is purely the operational state
 * stored in the task's own `values.status`.
 */
const EXEC_TASK_STATUS_META = {
  'Not Started': { label: 'Not Started', color: '#7c7784', soft: 'var(--surface-hover)' },
  'In Progress': { label: 'In Progress', color: 'var(--info)', soft: 'var(--info-soft)' },
  'Completed': { label: 'Completed', color: 'var(--success)', soft: 'var(--success-soft)' },
  'Delayed': { label: 'Delayed', color: 'var(--warning)', soft: 'var(--warning-soft)' },
  'Blocked': { label: 'Blocked', color: 'var(--danger)', soft: 'var(--danger-soft)' },
  'On Hold': { label: 'On Hold', color: 'var(--chart-4)', soft: 'var(--surface-hover)' },
  'Cancelled': { label: 'Cancelled', color: 'var(--text-subtle)', soft: 'var(--surface-hover)' },
};

/** 3-tier read for the whole Execution stage — Property Summary's "Execution Status". */
const EXEC_OVERALL_META = {
  pending: { label: 'Not Started', color: '#7c7784', soft: 'var(--surface-hover)' },
  in_progress: { label: 'In Progress', color: 'var(--info)', soft: 'var(--info-soft)' },
  completed: { label: 'Completed', color: 'var(--success)', soft: 'var(--success-soft)' },
};

/**
 * A department module's own aggregate status, worst-first: any Blocked task
 * wins, then any Delayed, then any On Hold, then "every task Completed", else
 * "In Progress" (some tasks filed, none of the above) — "Not Started" only
 * when the department has no tasks filed yet at all.
 */
function moduleExecStatus(typeRecords) {
  if (!typeRecords.length) return 'Not Started';
  if (typeRecords.some((r) => r.values?.status === 'Blocked')) return 'Blocked';
  if (typeRecords.some((r) => r.values?.status === 'Delayed')) return 'Delayed';
  if (typeRecords.some((r) => r.values?.status === 'On Hold')) return 'On Hold';
  if (typeRecords.every((r) => r.values?.status === 'Completed')) return 'Completed';
  return 'In Progress';
}

/** Average of a department's own tasks' Progress % — 0 for an empty department. */
function moduleProgressPct(typeRecords) {
  if (!typeRecords.length) return 0;
  const sum = typeRecords.reduce((s, r) => s + (Number(r.values?.progress_pct) || 0), 0);
  return Math.round(sum / typeRecords.length);
}

/** "3 Days" once a task is Delayed/Blocked past its own due date, else "—". */
function delayOf(record) {
  const status = record.values?.status;
  if (status !== 'Delayed' && status !== 'Blocked') return '—';
  const due = record.values?.due_date;
  if (!due) return status;
  const days = Math.max(1, Math.round((Date.now() - new Date(due).getTime()) / 86400000));
  return `${days} Day${days === 1 ? '' : 's'}`;
}

/** Icon + color for one activity-timeline entry, read off its message text — every record.service.js message uses one of these verbs. */
function timelineMetaFor(message = '') {
  const m = message.toLowerCase();
  if (m.includes('rejected')) return { Icon: XCircle, color: 'var(--danger)' };
  if (m.includes('approved') || m.includes('completed')) return { Icon: CheckCircle2, color: 'var(--success)' };
  if (m.includes('submitted')) return { Icon: Clock, color: 'var(--warning)' };
  if (m.includes('opened')) return { Icon: Eye, color: 'var(--text-subtle)' };
  if (m.includes('created') || m.includes('updated') || m.includes('draft')) return { Icon: FilePenLine, color: 'var(--info)' };
  return { Icon: Circle, color: 'var(--text-subtle)' };
}

function InfoTile({ label, value, tone }) {
  return (
    <div className="col gap-1" style={{ minWidth: 0 }}>
      <span className="tiny subtle upper">{label}</span>
      <span className="sm" style={{ fontWeight: 650, color: tone || 'var(--text)' }}>{value ?? '—'}</span>
    </div>
  );
}

/** Full (non-compact) Indian-grouped currency, e.g. ₹12,50,000 — same convention Department Planning's Property Summary uses. */
const fmtBudget = (n) => (n == null ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n));

const ellipsisCell = (maxWidth) => ({
  display: 'block', maxWidth, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
});

/**
 * One Execution Workspace card — number badge, department name, aggregate
 * status, task count, average progress (with its own compact bar), short
 * description, and an "Open Tasks" button that opens this department's task
 * board (see DepartmentTaskBoard). Unlike Commercial Finalization/Department
 * Planning's module card, this one always shows a progress bar — a
 * department here tracks many ongoing tasks, not a single submission.
 */
function ExecutionModuleCard({ index, type, taskCount, progressPct, statusKey, onOpenTasks }) {
  const smeta = EXEC_TASK_STATUS_META[statusKey] || EXEC_TASK_STATUS_META['Not Started'];
  return (
    <div className="card pc-module-card">
      <div className="pc-module-head">
        <span className="pc-module-num" style={{ background: MODULE_ACCENTS[index % MODULE_ACCENTS.length] }}>{index + 1}</span>
        <span className="pc-module-title" title={type.name}>{type.name}</span>
      </div>
      <div><Badge color={smeta.color} soft={smeta.soft} dot>{smeta.label}</Badge></div>
      <span className="pc-module-count">{taskCount} {taskCount === 1 ? 'Task' : 'Tasks'}</span>
      <div className="col gap-1">
        <div className="pc-module-progress-label"><span>Progress</span><span>{progressPct}%</span></div>
        <ProgressBar value={progressPct} height={5} />
      </div>
      <span className="pc-module-desc">{type.subtitle}</span>
      <button type="button" className="btn btn-outline-primary btn-sm pc-module-action" onClick={onOpenTasks}>
        Open Tasks
      </button>
    </div>
  );
}

/**
 * Execution Records — one row per task across every department, newest
 * first. Columns match the Phase 6 spec exactly (No./Department/Task/
 * Assigned To/Status/Progress/Delay/Updated By/Updated On/Remarks); the whole
 * row opens the task in RecordFormModal's read-only view, same convention as
 * every other stage's records table. No Approve/Reject Actions column —
 * Execution tasks aren't a decision-gated workflow like p3/p4/p5's
 * assessment records, they're tracked directly by their own status field.
 */
function ExecutionRecordsTable({ records, assessmentTypes, onView }) {
  const sorted = [...(records || [])].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return (
    <SectionCard title="3. Execution Records" subtitle={`${sorted.length} tasks filed`}>
      {sorted.length ? (
        <div style={{ overflowX: 'auto' }}>
          <table className="table table-clickable">
            <thead>
              <tr>
                <th>No.</th><th>Department</th><th>Task</th><th>Assigned To</th>
                <th>Status</th><th>Progress</th><th>Delay</th>
                <th>Updated By</th><th>Updated On</th><th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((record, i) => {
                const type = assessmentTypes.find((t) => t.key === record.assessmentType);
                const status = record.values?.status || 'Not Started';
                const smeta = EXEC_TASK_STATUS_META[status] || EXEC_TASK_STATUS_META['Not Started'];
                const remarks = record.values?.remarks || '';
                const delay = delayOf(record);
                return (
                  <tr key={record._id} onClick={() => onView(record)}>
                    <td className="mono tiny subtle" style={{ whiteSpace: 'nowrap' }}>{i + 1}</td>
                    <td style={{ fontWeight: 650, whiteSpace: 'nowrap' }}>{type?.name || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{record.values?.task_name || record.title}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{record.values?.assigned_to || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}><Badge color={smeta.color} soft={smeta.soft}>{smeta.label}</Badge></td>
                    <td style={{ whiteSpace: 'nowrap' }}>{record.values?.progress_pct != null ? `${record.values.progress_pct}%` : '—'}</td>
                    <td className={delay !== '—' ? 'tiny' : 'tiny muted'} style={{ whiteSpace: 'nowrap', color: delay !== '—' ? 'var(--warning)' : undefined, fontWeight: delay !== '—' ? 650 : 400 }}>{delay}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{record.updatedBy?.name || '—'}</td>
                    <td className="tiny muted" style={{ whiteSpace: 'nowrap' }}>{fmtDate(record.updatedAt)}</td>
                    <td style={{ maxWidth: 200 }}>
                      <span style={ellipsisCell(200)} title={remarks || undefined}>{remarks || '—'}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState icon={ClipboardList} title="No tasks filed yet" hint="Open a department above and click New Task to file the first one." />
      )}
    </SectionCard>
  );
}

/**
 * Department Task Board — opened from a module card's "Open Tasks" button.
 * Every department supports unlimited tasks; this is that department's own
 * scoped list, with its own New Task action, reusing the same Modal +
 * RecordFormModal building blocks the rest of the app uses rather than a
 * dedicated route/page.
 */
function DepartmentTaskBoard({ type, records, onClose, onNewTask, onView }) {
  const sorted = [...records].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return (
    <Modal
      open
      onClose={onClose}
      title={`${type.name} — Task Board`}
      subtitle={`${sorted.length} ${sorted.length === 1 ? 'task' : 'tasks'}`}
      width={920}
      footer={<button type="button" className="btn btn-subtle" onClick={onClose}>Close</button>}
    >
      <div className="col gap-3">
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-primary btn-sm" onClick={onNewTask}>
            <Plus size={14} /> New Task
          </button>
        </div>
        {sorted.length ? (
          <div style={{ overflowX: 'auto' }}>
            <table className="table table-clickable">
              <thead>
                <tr>
                  <th>No.</th><th>Task</th><th>Assigned To</th><th>Priority</th>
                  <th>Status</th><th>Progress</th><th>Due Date</th><th>Remarks</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((record, i) => {
                  const status = record.values?.status || 'Not Started';
                  const smeta = EXEC_TASK_STATUS_META[status] || EXEC_TASK_STATUS_META['Not Started'];
                  const remarks = record.values?.remarks || '';
                  return (
                    <tr key={record._id} onClick={() => onView(record)}>
                      <td className="mono tiny subtle" style={{ whiteSpace: 'nowrap' }}>{i + 1}</td>
                      <td style={{ fontWeight: 650, whiteSpace: 'nowrap' }}>{record.values?.task_name || record.title}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{record.values?.assigned_to || '—'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}><PriorityBadge value={(record.values?.priority || '').toLowerCase()} /></td>
                      <td style={{ whiteSpace: 'nowrap' }}><Badge color={smeta.color} soft={smeta.soft}>{smeta.label}</Badge></td>
                      <td style={{ whiteSpace: 'nowrap' }}>{record.values?.progress_pct != null ? `${record.values.progress_pct}%` : '—'}</td>
                      <td className="tiny muted" style={{ whiteSpace: 'nowrap' }}>{record.values?.due_date ? fmtDate(record.values.due_date) : '—'}</td>
                      <td style={{ maxWidth: 200 }}>
                        <span style={ellipsisCell(200)} title={remarks || undefined}>{remarks || '—'}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={ClipboardList} title="No tasks yet" hint="Click New Task to file the first one for this department." />
        )}
      </div>
    </Modal>
  );
}

/**
 * Execution — single-page workspace, same shape as Commercial Finalization /
 * Project Creation / Department Planning: the workflow never asks the user to
 * pick a property, it always resolves to the one shortlisted property that
 * has fully cleared Department Planning (every one of p5's ten departments
 * Approved) and loads its workspace directly.
 *
 * Unlike the earlier collection-mode stages, Execution isn't a decision-gated
 * workflow (no Approve/Reject) — each department is an unlimited stream of
 * task records tracked by their own status/progress fields, and the stage
 * completes itself (unlocking Phase 7) once every filed task's status is
 * Completed.
 *
 * Layout mirrors the same enterprise reference pixel-for-pixel: breadcrumb +
 * header (title/subtitle + progress card + next-phase card), Property
 * Summary, the ten departments as a single non-wrapping row of cards, then a
 * 65/35 split of Execution Records and Activity Timeline.
 */
export function ExecutionPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data: project, isLoading } = useProject(id);
  const templateId = project?.template?.ref?._id || project?.template?.ref;
  const { data: template, isLoading: templateLoading } = useTemplate(templateId);
  const { data: activities, isLoading: activitiesLoading } = useProjectActivity(id);

  const stageKey = 'p6';

  // Base pool: every shortlisted property, same as every earlier stage.
  // Narrowed below to only those that have fully cleared Department Planning
  // — exactly one of those (the first) becomes this page's workspace.
  const { data: shortlisted, isLoading: propertiesLoading } = useStageRecords(id, 'p1', { status: 'shortlisted' });
  const { data: projectCreationRecords } = useStageRecords(id, 'p4');
  const { data: planningRecords } = useStageRecords(id, 'p5');
  const { data: executionRecords, isLoading: recordsLoading } = useStageRecords(id, stageKey);

  const createRecord = useCreateRecord(id, stageKey);
  const updateRecord = useUpdateRecord(id, stageKey);
  const completeStage = useCompleteStage(id);
  // Logged against the property itself (a Phase 1 record), so it invalidates
  // the same caches a Phase 1 record mutation would.
  const markOpened = useMarkRecordOpened(id, 'p1');

  const [activeForm, setActiveForm] = useState(null); // { type, record, readOnly } | null
  const [taskBoardType, setTaskBoardType] = useState(null); // assessmentType | null
  const openLoggedRef = useRef(false);
  const autoCompletedRef = useRef(false);

  const planningTypes = template?.stages?.find((s) => s.key === 'p5')?.assessmentTypes || [];
  const assessmentTypes = template?.stages?.find((s) => s.key === stageKey)?.assessmentTypes || [];

  // Only properties whose every Department Planning module has at least one
  // Approved record ever qualify — never rejected or still in-progress ones.
  const isPlanned = (propId) =>
    planningTypes.length > 0 && approvedTypeCount(planningRecords, propId, planningTypes) === planningTypes.length;
  const properties = (shortlisted || []).filter((p) => isPlanned(p._id));
  // The single property this page ever works on — no picker, no route param.
  const property = properties[0] || null;
  const propertyId = property?._id;

  const propertyRecords = useMemo(
    () => (executionRecords || []).filter((r) => String(r.parentRecordId) === String(propertyId)),
    [executionRecords, propertyId],
  );
  const steps = assessmentTypes.map((type, index) => {
    const typeRecords = propertyRecords.filter((r) => r.assessmentType === type.key);
    return {
      type,
      index,
      typeRecords,
      taskCount: typeRecords.length,
      statusKey: moduleExecStatus(typeRecords),
      progressPct: moduleProgressPct(typeRecords),
    };
  });
  const allRecords = [...propertyRecords].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // Overall progress counts individual tasks, not departments — "12/19 Tasks
  // Completed" — since a department here is an open-ended stream of tasks,
  // not a single pass/fail submission like earlier stages' modules.
  const totalTasks = propertyRecords.length;
  const completedTasks = propertyRecords.filter((r) => r.values?.status === 'Completed').length;
  const overallPct = totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0;

  // Project Creation facts for the Property Summary — Budget, Target Opening
  // Date and Project Manager, same lookup Department Planning's Property
  // Summary already uses.
  const p4Records = (projectCreationRecords || []).filter((r) => String(r.parentRecordId) === String(propertyId));
  const latestApprovedOfType = (key) => {
    const approved = p4Records.filter((r) => r.assessmentType === key && r.status === 'approved');
    return approved.length ? [...approved].sort((a, b) => new Date(b.approvedAt) - new Date(a.approvedAt))[0] : null;
  };
  const budget = latestApprovedOfType('budget')?.values?.estimated_budget;
  const targetOpeningDate = latestApprovedOfType('timeline')?.values?.target_opening_date;
  const projectManager = latestApprovedOfType('manager_assignment')?.values?.project_manager;

  const stage = project?.stages?.find((s) => s.key === stageKey);
  const isCompleted = stage?.status === 'completed';
  const execStatusKey = !property ? 'pending' : totalTasks === 0 ? 'pending' : completedTasks === totalTasks ? 'completed' : 'in_progress';
  const execMeta = EXEC_OVERALL_META[execStatusKey];

  // "Property opened" is logged once — the very first time this workspace is
  // visited for a property that has no Execution records yet.
  useEffect(() => {
    if (openLoggedRef.current || recordsLoading || !property) return;
    openLoggedRef.current = true;
    if (propertyRecords.length === 0) {
      markOpened.mutate(propertyId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordsLoading, property]);

  // Every filed task Completed → the stage completes itself and Phase 7
  // unlocks, no manual "Mark Done" click. Guarded so it only ever fires once
  // per visit (completeStage is idempotent server-side too).
  useEffect(() => {
    if (autoCompletedRef.current || !stage || isCompleted) return;
    if (totalTasks > 0 && completedTasks === totalTasks) {
      autoCompletedRef.current = true;
      completeStage.mutate(stageKey);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalTasks, completedTasks, stage, isCompleted]);

  if (isLoading || !project) {
    return (<><Topbar title="Execution" /><div className="content"><SkPropertyIdentification /></div></>);
  }
  if (!stage) {
    return (
      <>
        <Topbar
          title={<span className="row gap-3"><button className="btn btn-ghost btn-icon" onClick={() => navigate(`/projects/${id}`)}><ArrowLeft size={16} /></button>Execution</span>}
        />
        <div className="content">
          <EmptyState icon={ClipboardList} title="No Execution stage" hint="This project has no Execution stage." />
        </div>
      </>
    );
  }

  const relevantIds = new Set([String(propertyId), ...propertyRecords.map((r) => String(r._id))]);
  const propertyActivity = (activities || [])
    .filter((a) => relevantIds.has(a.meta?.recordId))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // A module card's own action opens that department's task board — new
  // tasks are always filed from there (or the board's own New Task button),
  // never resuming a draft directly from the card.
  const openTaskBoard = (type) => setTaskBoardType(type);
  const closeTaskBoard = () => setTaskBoardType(null);
  const openNewTask = (type) => setActiveForm({ type, record: null, readOnly: false });
  const openView = (record) => {
    const type = assessmentTypes.find((t) => t.key === record.assessmentType);
    setActiveForm({ type, record, readOnly: true });
  };
  const switchToEdit = () => setActiveForm((f) => (f ? { ...f, readOnly: false } : f));
  const closeForm = () => setActiveForm(null);

  const saveTask = async (values, status) => {
    const { type, record } = activeForm;
    if (record) {
      await updateRecord.mutateAsync({ id: record._id, values, status });
    } else {
      await createRecord.mutateAsync({ values, status, assessmentType: type.key, parentRecordId: propertyId });
    }
    closeForm();
  };

  const taskBoardRecords = taskBoardType ? propertyRecords.filter((r) => r.assessmentType === taskBoardType.key) : [];

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
      <div className="content page-compact">
        <div className="content-narrow col gap-3 fade-in">
          {propertiesLoading || templateLoading ? (
            <SectionCard title="1. Project Summary">
              <div className="dp-summary-row1"><InfoTile label="Property Name" value="Loading…" /></div>
            </SectionCard>
          ) : !property ? (
            <SectionCard title="1. Project Summary">
              <EmptyState
                icon={ClipboardList}
                title="This property is not yet eligible for Execution."
                hint="Complete every Department Planning module (all ten departments approved) before starting Execution."
              />
            </SectionCard>
          ) : (
            <>
              {/* 1. Project Summary — auto-loaded, never re-selected here, read-only. */}
              <SectionCard title="1. Project Summary">
                <div className="col gap-3">
                  <div className="dp-summary-row1">
                    <InfoTile label="Property Number" value={propertyNo(property.seq)} />
                    <InfoTile label="Property Name" value={property.title} />
                    <InfoTile label="Project Name" value={project.name} />
                    <InfoTile label="City" value={property.values?.city} />
                    <InfoTile label="Locality" value={property.values?.locality} />
                    <InfoTile label="Project Manager" value={projectManager || '—'} />
                    <InfoTile label="Target Opening Date" value={targetOpeningDate ? fmtDate(targetOpeningDate) : '—'} />
                    <InfoTile label="Budget" value={fmtBudget(budget)} />
                  </div>
                  <div className="ex-summary-row2">
                    <div className="col gap-1">
                      <span className="tiny subtle upper">Current Phase</span>
                      <div><Badge color="var(--primary)" soft="var(--surface-hover)">{stage.name}</Badge></div>
                    </div>
                    <div className="col gap-1">
                      <span className="tiny subtle upper">Execution Status</span>
                      <div><Badge color={execMeta.color} soft={execMeta.soft} dot>{execMeta.label}</Badge></div>
                    </div>
                    <div className="col gap-1">
                      <span className="tiny subtle upper">Overall Progress</span>
                      <ProgressBar value={overallPct} height={7} />
                      <span className="tiny muted">{completedTasks}/{totalTasks} Tasks Completed</span>
                    </div>
                  </div>
                </div>
              </SectionCard>

              {/* 2. Execution Workspace — ten departments, one non-wrapping row. */}
              <SectionCard title="2. Execution Workspace" bodyClass="card-body-compact">
                {assessmentTypes.length ? (
                  <div className="execution-grid">
                    {steps.map(({ type, index, taskCount, progressPct, statusKey }) => (
                      <ExecutionModuleCard
                        key={type.key}
                        index={index}
                        type={type}
                        taskCount={taskCount}
                        progressPct={progressPct}
                        statusKey={statusKey}
                        onOpenTasks={() => openTaskBoard(type)}
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyState icon={ClipboardList} title="No departments configured" hint="Add assessment types to the Execution stage in the template." />
                )}
              </SectionCard>

              {/* 3. Execution Records (65%) / 4. Activity Timeline (35%). */}
              <div className="pc-bottom-grid">
                <ExecutionRecordsTable records={allRecords} assessmentTypes={assessmentTypes} onView={openView} />

                <SectionCard title="4. Activity Timeline">
                  {activitiesLoading ? (
                    <SkeletonActivity rows={4} />
                  ) : propertyActivity.length ? (
                    <div className="pc-timeline">
                      {propertyActivity.map((a, i) => {
                        const { Icon, color } = timelineMetaFor(a.message);
                        return (
                          <div key={a._id} className="pc-timeline-item">
                            <div className="pc-timeline-rail">
                              <span className="pc-timeline-icon" style={{ color }}>
                                <Icon size={14} />
                              </span>
                              {i < propertyActivity.length - 1 && <span className="pc-timeline-rail-line" />}
                            </div>
                            <div className="pc-timeline-body">
                              <div className="sm" style={{ fontWeight: 600 }}>{a.message}</div>
                              <div className="tiny muted">{a.actor?.name || 'System'} · {fmtDateTime(a.createdAt)} · {fromNow(a.createdAt)}</div>
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
            </>
          )}
        </div>
      </div>

      {taskBoardType && (
        <DepartmentTaskBoard
          type={taskBoardType}
          records={taskBoardRecords}
          onClose={closeTaskBoard}
          onNewTask={() => openNewTask(taskBoardType)}
          onView={openView}
        />
      )}

      {activeForm && (
        <RecordFormModal
          open
          onClose={closeForm}
          schema={activeForm.type.masterDataSchema}
          recordNoun={`${activeForm.type.name} Task`}
          initialValues={activeForm.record?.values || null}
          submitLabel="Save Task"
          saving={activeForm.record ? updateRecord.isPending : createRecord.isPending}
          loading={templateLoading}
          readOnly={activeForm.readOnly}
          meta={activeForm.readOnly ? buildRecordMeta(activeForm.record, allRecords, activeForm.type.name) : null}
          activity={activeForm.readOnly ? (activities || []).filter((a) => a.meta?.recordId === String(activeForm.record?._id)) : null}
          onEdit={activeForm.readOnly && activeForm.record ? switchToEdit : null}
          onSaveDraft={({ values }) => saveTask(values, 'draft')}
          onSubmit={({ values }) => saveTask(values, 'submitted')}
        />
      )}
    </>
  );
}

export default ExecutionPage;
