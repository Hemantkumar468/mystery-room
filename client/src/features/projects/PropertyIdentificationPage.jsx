import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Plus, Search, LayoutGrid, ClipboardList, RotateCcw,
  Check, X, Pencil,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { MarkDoneButton } from '../../components/ui/MarkDoneButton.jsx';
import { useProjectReadOnly, ReadOnlyProjectBanner } from '../../components/ui/ReadOnlyProjectBanner.jsx';
import { SectionCard, Badge, Avatar, EmptyState } from '../../components/ui/primitives.jsx';
import { SkPropertyIdentification, SkeletonTable, SkeletonActivity } from '../../components/ui/Skeletons.jsx';
import { useTemplate } from '../../app/api/templatesApi.js';
import {
  useStageRecords, useCreateRecord, useUpdateRecord,
  useRecordDecision,
} from '../../app/api/recordsApi.js';
import { useProject, useProjectActivity, useCompleteStage, useReopenStage } from '../../app/api/projectsApi.js';
import { useBoard } from '../../app/api/tasksApi.js';
import { STAGE_STATUS_META } from '../../lib/ui.js';
import { fmtDate, fmtDateTime, fromNow } from '../../lib/format.js';
import { getEmployeeById } from '../../lib/employees.js';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { RecordFormModal } from './records/RecordFormModal.jsx';
import { RejectDialog } from './records/RejectDialog.jsx';
import { RECORD_STATUS_META, propertyNo } from './records/recordUi.js';

const ASSIGNMENT_STATUS = {
  not_started: 'Pending assignment',
  in_progress: 'Active',
  blocked: 'Blocked',
  completed: 'Completed',
};

const SORTS = [
  { key: 'updated', label: 'Last Updated' },
  { key: 'created', label: 'Created Date' },
  { key: 'status', label: 'Status' },
];

function InfoTile({ label, value, tone }) {
  return (
    <div className="col gap-1" style={{ minWidth: 100 }}>
      <span className="tiny subtle upper">{label}</span>
      <span className="sm" style={{ fontWeight: 650, color: tone || 'var(--text)' }}>{value ?? '—'}</span>
    </div>
  );
}

const tileGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 'var(--space-4)' };
// Stage Overview specifically can carry up to 8 tiles (Stage/Status/Progress/
// SLA/Started/Expected Completion/Completed By/Completed At) — a narrower
// minmax than the general tileGrid keeps all of them on one row at desktop
// widths, while auto-fit still wraps naturally on tablet/mobile.
const stageOverviewGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 'var(--space-3)' };

// Keeps a table cell's content on a single line — long values truncate with an
// ellipsis instead of wrapping the row onto a second line.
const ellipsisCell = (maxWidth) => ({
  display: 'block',
  maxWidth,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export function PropertyIdentificationPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: project, isLoading } = useProject(id);
  const readOnly = useProjectReadOnly(project);
  const templateId = project?.template?.ref?._id || project?.template?.ref;
  const { data: template, isLoading: templateLoading } = useTemplate(templateId);
  const { data: board } = useBoard(id);
  const { data: activities, isLoading: activitiesLoading } = useProjectActivity(id);

  // Explicit key, not just "first collection-mode stage" — Site Evaluation
  // (p2) is collection-mode too now, so that generic match would be ambiguous.
  const stage = project?.stages?.find((s) => s.key === 'p1');
  const stageKey = stage?.key;
  const { data: records, isLoading: recordsLoading } = useStageRecords(id, stageKey);
  const createRecord = useCreateRecord(id, stageKey);
  const updateRecord = useUpdateRecord(id, stageKey);
  const completeStage = useCompleteStage(id);
  const reopenStage = useReopenStage(id);
  const decide = useRecordDecision(id, stageKey);
  const user = useAppSelector(selectCurrentUser);
  const canReopen = user?.role === 'admin' || user?.role === 'manager';
  const canDecide = user?.role === 'admin' || user?.role === 'manager';

  const [formOpen, setFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('updated');
  const [confirmDone, setConfirmDone] = useState(false);
  const [rejectTarget, setRejectTarget] = useState(null);

  if (isLoading || !project) {
    return (<><Topbar title="Property Identification" /><div className="content"><SkPropertyIdentification /></div></>);
  }
  if (!stage) {
    return (
      <>
        <Topbar
          title={<span className="row gap-3"><button className="btn btn-ghost btn-icon" onClick={() => navigate(`/projects/${id}`)}><ArrowLeft size={16} /></button>Property Identification</span>}
        />
        <div className="content">
          <EmptyState icon={ClipboardList} title="No collection-mode stage" hint="This project has no Property Identification (collection) stage." />
        </div>
      </>
    );
  }

  const recordSchema = template?.stages?.find((s) => s.key === stageKey)?.masterDataSchema || [];
  const meta = STAGE_STATUS_META[stage.status] || { label: stage.status, color: '#7c7784' };
  const recordNoun = stage.recordNoun || 'Property';

  const stageTasks = (board?.columns || []).flatMap((c) => c.tasks || []).filter((t) => t.stageKey === stageKey);

  // Task assignment — derived from the stage's tasks + project owner (some fields are not tracked).
  const firstTask = stageTasks[0];
  const primary = getEmployeeById(firstTask?.primaryAssignee);
  const backup = getEmployeeById(firstTask?.backupAssignee);
  const owner = project.owner;

  // Records: search + sort (client side).
  const q = search.trim().toLowerCase();
  const rows = (records || [])
    .filter((r) => !q || [r.title, r.values?.city, r.values?.locality].some((val) => (val || '').toLowerCase().includes(q)))
    .sort((a, b) => {
      if (sort === 'status') return (a.status || '').localeCompare(b.status || '');
      if (sort === 'created') return new Date(b.createdAt) - new Date(a.createdAt);
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    });

  // Record actions + stage-level actions (e.g. "marked as Completed") both log
  // with meta.stageKey, so one filter covers the whole timeline for this stage.
  const stageActivity = (activities || []).filter(
    (a) => (a.entityType === 'record' || a.entityType === 'stage') && a.meta?.stageKey === stageKey,
  );

  const isCompleted = stage.status === 'completed';
  // Business rule, derived from live data — never hardcoded: at least one
  // record must exist before this (collection-mode) stage can be marked done.
  const propertyCount = (records || []).length;
  const canMarkDone = propertyCount >= 1;

  const openCreate = () => setFormOpen(true);
  const closeForm = () => setFormOpen(false);
  const openDetail = (r) => navigate(`/projects/${id}/property-identification/${r._id}`);
  // mutateAsync (not mutate) so a failed save rejects the promise
  // RecordFormModal awaits — otherwise a backend error would vanish
  // silently instead of showing in the modal.
  const saveRecord = async (values, status) => {
    await createRecord.mutateAsync({ values, status });
    closeForm();
  };
  const openEdit = (r, e) => {
    e.stopPropagation();
    setEditingRecord(r);
  };
  const saveEdit = async (values, status) => {
    await updateRecord.mutateAsync({ id: editingRecord._id, values, status });
    setEditingRecord(null);
  };
  const confirmMarkDone = () => completeStage.mutate(stageKey, { onSuccess: () => setConfirmDone(false) });
  const doShortlist = (r, e) => {
    e.stopPropagation();
    decide.mutate({ id: r._id, decision: 'shortlist' });
  };
  const openReject = (r, e) => {
    e.stopPropagation();
    setRejectTarget(r);
  };
  const doReject = (reason) => {
    decide.mutate(
      { id: rejectTarget._id, decision: 'reject', reason },
      { onSuccess: () => setRejectTarget(null) },
    );
  };

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
        {readOnly && <ReadOnlyProjectBanner />}
        <div className="content-narrow col gap-3 fade-in">
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
                    disabled={reopenStage.isPending || readOnly}
                  >
                    <RotateCcw size={14} /> Reopen Stage
                  </button>
                )
              ) : (
                <div className="col" style={{ alignItems: 'flex-end', gap: 4 }}>
                  <MarkDoneButton
                    onClick={() => setConfirmDone(true)}
                    disabled={!canMarkDone || readOnly}
                    disabledTitle={`Create at least one ${recordNoun.toLowerCase()} before completing this stage.`}
                  />
                </div>
              )
            }
          >
            <div style={stageOverviewGrid}>
              <InfoTile label="Stage" value={stage.name} />
              <InfoTile label="SLA" value={`${stage.slaDays || 0} days`} />
              <InfoTile label="Expected Completion" value={fmtDate(stage.plannedEnd)} />
              {/* Completion audit — set once by Mark Done and preserved across a
                  reopen (never overwritten); a new Mark Done replaces it fresh. */}
              {stage.completedBy && <InfoTile label="Completed By" value={stage.completedBy.name} />}
              {stage.completedAt && <InfoTile label="Completed At" value={fmtDateTime(stage.completedAt)} tone={isCompleted ? 'var(--success)' : undefined} />}
              {!stage.completedAt && <InfoTile label="Actual Completion" value="—" />}
              {/* Reopen audit — only meaningful once the stage has actually been reopened. */}
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

          {/* 3. Property Records */}
          <SectionCard
            title={`${recordNoun} Records`}
            subtitle={`${(records || []).length} total`}
            action={
              <button type="button" className="btn btn-primary btn-sm" onClick={openCreate} disabled={readOnly}>
                <Plus size={14} /> Add New {recordNoun}
              </button>
            }
          >
            <div className="col gap-4">
              <div className="row gap-3 wrap">
                <div className="input-icon-wrap grow" style={{ minWidth: 200 }}>
                  <Search size={15} className="input-icon" />
                  <input
                    className="input"
                    placeholder={`Search ${recordNoun.toLowerCase()} by name, city, locality…`}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <select className="select" style={{ maxWidth: 200 }} value={sort} onChange={(e) => setSort(e.target.value)}>
                  {SORTS.map((s) => <option key={s.key} value={s.key}>Sort: {s.label}</option>)}
                </select>
              </div>

              {recordsLoading ? (
                <SkeletonTable
                  columns={['6%', '20%', '12%', '12%', '10%', '12%', '12%', '12%', '12%', '12%']}
                  rows={5}
                />
              ) : rows.length ? (
                <div style={{ overflowX: 'auto' }}>
                  <table className="table table-clickable">
                    <thead>
                      <tr>
                        <th>No.</th>
                        <th>Property Name</th>
                        <th>City</th>
                        <th>Locality</th>
                        <th>Status</th>
                        <th>Created By</th>
                        <th>Created On</th>
                        <th>Last Updated By</th>
                        <th>Last Updated On</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => {
                        const rmeta = RECORD_STATUS_META[r.status] || { label: r.status, color: '#7c7784' };
                        const canAct = canDecide && r.status === 'submitted';
                        // A reviewed record's values are frozen server-side
                        // (record.service.js#update) — editing them after a
                        // decision would silently invalidate that decision.
                        const decided = ['shortlisted', 'approved', 'rejected', 'archived', 'locked'].includes(r.status);
                        return (
                          <tr key={r._id} onClick={() => openDetail(r)} style={{ height: 52 }}>
                            <td className="mono tiny subtle" style={{ whiteSpace: 'nowrap' }}>{r.seq ?? '—'}</td>
                            <td style={{ fontWeight: 650, whiteSpace: 'nowrap' }}>
                              <span style={ellipsisCell(220)} title={r.title || `Untitled ${recordNoun}`}>
                                {r.title || `Untitled ${recordNoun}`}
                              </span>
                            </td>
                            <td style={{ whiteSpace: 'nowrap' }}>
                              <span style={ellipsisCell(120)}>{r.values?.city || '—'}</span>
                            </td>
                            <td style={{ whiteSpace: 'nowrap' }}>
                              <span style={ellipsisCell(140)}>{r.values?.locality || '—'}</span>
                            </td>
                            <td style={{ whiteSpace: 'nowrap' }}><Badge color={rmeta.color}>{rmeta.label}</Badge></td>
                            <td style={{ whiteSpace: 'nowrap' }}>
                              <span style={ellipsisCell(140)}>{r.createdBy?.name || '—'}</span>
                            </td>
                            <td className="tiny muted" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(r.createdAt)}</td>
                            <td style={{ whiteSpace: 'nowrap' }}>
                              <span style={ellipsisCell(140)}>{r.updatedBy?.name || '—'}</span>
                            </td>
                            <td className="tiny muted" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(r.updatedAt)}</td>
                            <td onClick={(e) => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
                              <div className="row gap-1" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                                {/* Shortlist/Reject only apply to a submitted, not-yet-decided
                                    record — both disappear together the moment a decision is made. */}
                                {canAct && (
                                  <button
                                    type="button"
                                    className="btn btn-sm"
                                    title="Shortlist"
                                    disabled={decide.isPending || readOnly}
                                    onClick={(e) => doShortlist(r, e)}
                                    style={{ background: 'var(--success)', color: '#fff', whiteSpace: 'nowrap', flexShrink: 0 }}
                                  >
                                    <Check size={13} /> Shortlist
                                  </button>
                                )}
                                {canAct && (
                                  <button
                                    type="button"
                                    className="btn btn-danger btn-sm"
                                    title="Reject"
                                    disabled={decide.isPending || readOnly}
                                    onClick={(e) => openReject(r, e)}
                                    style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
                                  >
                                    <X size={13} /> Reject
                                  </button>
                                )}
                                {/* Edit is icon-only and always last. */}
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-icon btn-sm"
                                  title={decided ? `Already ${rmeta.label.toLowerCase()} — undo the decision to edit` : 'Edit Property'}
                                  aria-label="Edit Property"
                                  onClick={(e) => openEdit(r, e)}
                                  disabled={readOnly || decided}
                                  style={{ flexShrink: 0 }}
                                >
                                  <Pencil size={13} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState
                  icon={LayoutGrid}
                  title={search ? 'No matches' : `No ${recordNoun.toLowerCase()} yet`}
                  hint={search ? 'Try a different search.' : `Add the first ${recordNoun.toLowerCase()} to get started.`}
                />
              )}
            </div>
          </SectionCard>

          {/* 4. Activity Timeline */}
          <SectionCard title="Activity Timeline">
            {activitiesLoading ? (
              <SkeletonActivity rows={4} />
            ) : stageActivity.length ? (
              <div className="col gap-4" style={{ maxHeight: 170, overflowY: 'auto' }}>
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

      {formOpen && (
        <RecordFormModal
          open
          onClose={closeForm}
          schema={recordSchema}
          recordNoun={recordNoun}
          initialValues={null}
          saving={createRecord.isPending}
          loading={templateLoading}
          onSaveDraft={({ values }) => saveRecord(values, 'draft')}
          onSubmit={({ values }) => saveRecord(values, 'submitted')}
        />
      )}

      {editingRecord && (
        <RecordFormModal
          open
          onClose={() => setEditingRecord(null)}
          schema={recordSchema}
          recordNoun={recordNoun}
          recordNo={propertyNo(editingRecord.seq)}
          initialValues={editingRecord.values}
          saving={updateRecord.isPending}
          loading={templateLoading}
          onSaveDraft={({ values }) => saveEdit(values, 'draft')}
          onSubmit={({ values }) => saveEdit(values, 'submitted')}
        />
      )}

      <RejectDialog
        open={!!rejectTarget}
        title={`Reject ${rejectTarget ? (rejectTarget.title || recordNoun) : ''}`}
        onClose={() => setRejectTarget(null)}
        onConfirm={doReject}
        pending={decide.isPending}
        placeholder="Why is this property being rejected?"
      />

      {confirmDone && (
        <Modal
          open
          onClose={() => setConfirmDone(false)}
          title={`Complete ${stage.name}?`}
          width={440}
          footer={
            <div className="row gap-2">
              <button type="button" className="btn btn-subtle" onClick={() => setConfirmDone(false)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={confirmMarkDone} disabled={completeStage.isPending || readOnly}>
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

export default PropertyIdentificationPage;
