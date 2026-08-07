import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Plus, Search, LayoutGrid, ClipboardList, RotateCcw,
  Check, X, Pencil, Sparkles,
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
import {
  useAiStatus, useProjectAiScores, useRunPropertyAnalysisMutation,
  useProjectSweep, useRunProjectSweepMutation,
} from '../../app/api/aiApi.js';
import { AiScoreCell } from '../ai/AiScoreCell.jsx';
import { SiteComparisonPanel } from '../ai/SiteComparisonPanel.jsx';
import { STAGE_STATUS_META } from '../../lib/ui.js';
import { fmtDate, fmtDateTime, fromNow, daysUntil } from '../../lib/format.js';
import { getEmployeeById } from '../../lib/employees.js';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { RecordFormModal } from './records/RecordFormModal.jsx';
import { RejectDialog } from './records/RejectDialog.jsx';
import { RECORD_STATUS_META, propertyNo } from './records/recordUi.js';
import { can } from '../../lib/roles.js';

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
  const canReopen = can.decide(user?.role);
  const canDecide = can.decide(user?.role);

  // AI scores are a bonus column: fetched only when the module is actually
  // configured, so an unconfigured deployment never issues the request and the
  // column simply does not appear.
  const { data: aiStatus } = useAiStatus();
  const aiEnabled = Boolean(aiStatus?.available);

  const [formOpen, setFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('updated');
  const [confirmDone, setConfirmDone] = useState(false);
  const [rejectTarget, setRejectTarget] = useState(null);
  // Which record ids have an analysis in flight — a Set because several can be
  // queued while one is live. The bulk sweep is no longer tracked here: it runs
  // on the server, so its state comes back off `useProjectSweep` instead of
  // living in this component and dying with it.
  const [aiRunning, setAiRunning] = useState(() => new Set());
  const [sweepKicked, setSweepKicked] = useState(false);
  const [runAnalysis] = useRunPropertyAnalysisMutation();
  const [startSweep, sweepReq] = useRunProjectSweepMutation();
  const { data: sweep } = useProjectSweep(id, sweepKicked);

  // Declared after the sweep hook because the scores query polls while a sweep
  // (or any single run started here) is in flight, so the table's own rows
  // update as the server works through them.
  const { data: aiScores } = useProjectAiScores(
    id,
    aiEnabled,
    Boolean(sweep) || sweepKicked || aiRunning.size > 0,
  );
  const aiScoreByRecord = new Map((aiScores || []).map((s) => [s.recordId, s]));

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

  // The counts the left rail's checklist reads. Shortlisting is not required to
  // close the stage — the checklist says so rather than implying a blocker,
  // because a false "you must do this" is worse than no guidance at all.
  const shortlistedCount = (records || []).filter((r) => r.status === 'shortlisted').length;
  const reviewedCount = (records || []).filter((r) =>
    ['shortlisted', 'rejected', 'approved'].includes(r.status)).length;
  const awaitingCount = propertyCount - reviewedCount;

  // Plain-English description of the step, straight from the template so it
  // stays in sync with the seed data rather than being retyped here.
  const stageDescription =
    template?.stages?.find((s) => s.key === stageKey)?.description
    || 'Capture every candidate property, then shortlist the ones worth assessing.';
  const phaseIndex = (project.stages || []).findIndex((s) => s.key === stageKey);
  const phaseTotal = (project.stages || []).length;

  const daysLeft = daysUntil(stage.plannedEnd);

  /**
   * Running the AI analysis used to be reachable only from a property's own
   * detail page, one property at a time — so the comparison panel below could
   * ask for "at least two analysed properties" while offering no way to
   * produce one. Both the per-row action and the bulk run live here now.
   *
   * The bulk run is a single call to the server, which sweeps the project with
   * bounded concurrency. It used to be a `for` loop in this component awaiting
   * one property at a time: ten properties meant ten minutes parked on this
   * page, and navigating away abandoned the rest of the queue.
   */
  const unanalysed = (records || []).filter(
    (r) => aiScoreByRecord.get(String(r._id))?.overall == null,
  );

  // Truth comes from the server while a sweep is live; `sweepKicked` only
  // covers the gap between the click and the first poll answering.
  const sweeping = Boolean(sweep) || sweepReq.isLoading || sweepKicked;
  const sweepRemaining = sweep ? sweep.queued - sweep.done - sweep.failed : unanalysed.length;

  /**
   * A row is mid-analysis when the server says so. `aiRunning` only knows about
   * runs this component started, which is nothing during a server-side sweep —
   * the scores endpoint carries each run's status for exactly this reason.
   */
  const isRowAnalysing = (recordId) => {
    const status = aiScoreByRecord.get(String(recordId))?.status;
    return status === 'queued' || status === 'running';
  };

  const runOne = async (recordId) => {
    setAiRunning((s) => new Set(s).add(recordId));
    try {
      await runAnalysis({ recordId, force: false }).unwrap();
    } catch {
      // Surfaced by the mutation's own error state; a failed property must not
      // abort the queue behind it.
    } finally {
      setAiRunning((s) => {
        const next = new Set(s);
        next.delete(recordId);
        return next;
      });
    }
  };

  const runAll = async () => {
    setSweepKicked(true);
    try {
      await startSweep({ projectId: id, force: false }).unwrap();
    } catch {
      // Surfaced by `sweepReq.error` below; the poll also self-corrects, since
      // a sweep that never started reports no progress.
    } finally {
      // Hand over to the poll — from here the server is the source of truth.
      setSweepKicked(false);
    }
  };

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
        <div className="content-wide col gap-3 fade-in">
          {/* What this step is, in one sentence, before any metadata. Someone
              landing here from a task assignment has no idea what the phase is
              for — the page previously opened with 14 tiles of audit fields and
              never said. */}
          <div className="stage-explain">
            <div className="stage-explain-main">
              <span className="stage-explain-step">
                Step {phaseIndex >= 0 ? phaseIndex + 1 : 1} of {phaseTotal || 10}
              </span>
              <p className="stage-explain-text">{stageDescription}</p>
            </div>
            <Badge color={meta.color}>{meta.label}</Badge>
          </div>

          <div className="stage-split">
            {/* ── Left rail: state, timing, ownership, and how to finish ── */}
            <aside className="stage-rail">
              <SectionCard title="Timing">
                <div className="col gap-3">
                  <InfoTile label="Allowed" value={`${stage.slaDays || 0} days`} />
                  <InfoTile label="Due" value={fmtDate(stage.plannedEnd)} />
                  {!isCompleted && daysLeft != null && (
                    <InfoTile
                      label={daysLeft < 0 ? 'Overdue by' : 'Time left'}
                      value={daysLeft < 0 ? `${-daysLeft} days` : `${daysLeft} days`}
                      tone={daysLeft < 0 ? 'var(--danger)' : daysLeft <= 2 ? 'var(--warning)' : undefined}
                    />
                  )}
                  {stage.startedAt && <InfoTile label="Started" value={fmtDateTime(stage.startedAt)} />}
                  {stage.completedAt && (
                    <InfoTile label="Completed" value={fmtDateTime(stage.completedAt)} tone="var(--success)" />
                  )}
                  {stage.completedBy && <InfoTile label="Completed by" value={stage.completedBy.name} />}
                  {stage.reopenedAt && <InfoTile label="Reopened" value={fmtDateTime(stage.reopenedAt)} />}
                </div>
              </SectionCard>

              {/* Only fields that actually hold a value. Six tiles reading "—"
                  told the reader nothing except that the page had six fields. */}
              <SectionCard title="Who's on it">
                <div className="col gap-3">
                  <InfoTile label="Owner" value={owner?.name || 'Not assigned'} />
                  {primary && <InfoTile label="Doer" value={primary.name} />}
                  {backup && <InfoTile label="Backup" value={backup.name} />}
                  {!primary && !backup && (
                    <span className="tiny muted">
                      No doer assigned yet — the owner is accountable until someone is.
                    </span>
                  )}
                </div>
              </SectionCard>

              {/* The whole point of the redesign: say what finishing requires,
                  show which parts are already true, then offer the button. */}
              <SectionCard title={isCompleted ? 'This step is done' : 'To finish this step'}>
                {isCompleted ? (
                  <div className="col gap-3">
                    <span className="sm muted">
                      Marked done{stage.completedBy ? ` by ${stage.completedBy.name}` : ''}
                      {stage.completedAt ? ` · ${fmtDate(stage.completedAt)}` : ''}.
                    </span>
                    {canReopen && (
                      <button
                        type="button"
                        className="btn btn-subtle btn-sm"
                        onClick={() => reopenStage.mutate(stageKey)}
                        disabled={reopenStage.isPending || readOnly}
                      >
                        <RotateCcw size={14} /> Reopen step
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="col gap-3">
                    <ul className="stage-check">
                      <li className={propertyCount >= 1 ? 'done' : ''}>
                        {propertyCount >= 1 ? <Check size={13} strokeWidth={3} /> : <span className="stage-check-dot" />}
                        <span>
                          Add at least one {recordNoun.toLowerCase()}
                          <b> · {propertyCount} added</b>
                        </span>
                      </li>
                      <li className={awaitingCount === 0 && propertyCount > 0 ? 'done' : ''}>
                        {awaitingCount === 0 && propertyCount > 0
                          ? <Check size={13} strokeWidth={3} />
                          : <span className="stage-check-dot" />}
                        <span>
                          Shortlist or reject each one
                          <b> · {awaitingCount} still waiting</b>
                          <em className="stage-check-opt"> optional</em>
                        </span>
                      </li>
                    </ul>

                    <MarkDoneButton
                      onClick={() => setConfirmDone(true)}
                      disabled={!canMarkDone || readOnly}
                      disabledTitle={`Add at least one ${recordNoun.toLowerCase()} first.`}
                    />
                    {!canMarkDone && (
                      <span className="tiny muted">
                        Add a {recordNoun.toLowerCase()} to unlock this.
                      </span>
                    )}
                  </div>
                )}
              </SectionCard>

              {/* Activity moved into the rail: it is context on the work, not
                  the work, and at the foot of the page nobody scrolled to it. */}
              <SectionCard title="Recent activity">
                {activitiesLoading ? (
                  <SkeletonActivity rows={3} />
                ) : stageActivity.length ? (
                  <div className="col gap-3" style={{ maxHeight: 260, overflowY: 'auto' }}>
                    {stageActivity.slice(0, 12).map((a) => (
                      <div key={a._id} className="row gap-2" style={{ alignItems: 'flex-start' }}>
                        <Avatar name={a.actor?.name || 'System'} color={a.actor?.avatarColor || 'var(--ink-500)'} size={24} />
                        <div className="col grow" style={{ minWidth: 0 }}>
                          <div className="tiny">
                            <b>{a.actor?.name || 'System'}</b> <span className="muted">{a.message}</span>
                          </div>
                          <div className="tiny muted">{fromNow(a.createdAt)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className="tiny muted">Nothing has happened here yet.</span>
                )}
              </SectionCard>
            </aside>

            {/* ── Main column: the actual work ── */}
            <div className="stage-main col gap-3">
          <SectionCard
            title={`${recordNoun} Records`}
            subtitle={`${(records || []).length} total`}
            action={
              <div className="row gap-2">
                {/* Only offered when there is something to analyse — a button
                    that does nothing is worse than no button. */}
                {aiEnabled && (unanalysed.length > 0 || sweeping) && can.capture(user?.role) && (
                  <button
                    type="button"
                    className="btn btn-subtle btn-sm"
                    onClick={runAll}
                    disabled={readOnly || sweeping}
                    title={
                      sweeping
                        ? `Running ${sweep?.concurrency ?? ''} at a time on the server — you can leave this page.`
                        : `Score ${unanalysed.length} ${unanalysed.length === 1 ? 'property' : 'properties'} against the rubric. Runs on the server, several at a time.`
                    }
                  >
                    {sweeping ? <span className="spinner" /> : <Sparkles size={14} />}
                    {sweeping
                      ? `Analysing… ${Math.max(0, sweepRemaining)} left`
                      : `Analyse ${unanalysed.length}`}
                  </button>
                )}
                <button type="button" className="btn btn-primary btn-sm" onClick={openCreate} disabled={readOnly}>
                  <Plus size={14} /> Add New {recordNoun}
                </button>
              </div>
            }
          >
            <div className="col gap-4">
              {/* The sweep outlives this page, so it needs to say so — otherwise
                  people sit and watch it the way the old in-browser loop forced
                  them to. */}
              {sweep && (
                <div className="info-panel info-panel--info">
                  <span className="spinner info-panel-icon" />
                  <div className="col gap-1">
                    <div className="info-panel-title">
                      Analysing {sweep.queued} {sweep.queued === 1 ? 'property' : 'properties'},{' '}
                      {sweep.concurrency} at a time
                    </div>
                    <div className="info-panel-body">
                      {sweep.done} done{sweep.failed ? `, ${sweep.failed} failed` : ''} ·{' '}
                      {sweep.running} running
                      {sweep.skippedFresh ? ` · ${sweep.skippedFresh} already current` : ''}. This
                      runs on the server — you can leave this page and come back.
                    </div>
                  </div>
                </div>
              )}
              {sweepReq.isError && (
                <div className="info-panel info-panel--danger">
                  <div className="col gap-1">
                    <div className="info-panel-title">Could not start the sweep</div>
                    <div className="info-panel-body">
                      {sweepReq.error?.data?.message || 'The AI service did not accept the request.'}
                    </div>
                  </div>
                </div>
              )}
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
                  // Must track the real header: the AI Score column is
                  // conditional, so the placeholder counts it the same way.
                  columns={[
                    '6%', '30%', '22%',
                    ...(aiEnabled ? ['10%'] : []),
                    '12%', '14%', '16%',
                  ]}
                  rows={5}
                />
              ) : rows.length ? (
                <div className="pi-table-wrap">
                  <table className="table table-clickable pi-table">
                    <thead>
                      {/* Eleven columns forced a horizontal scrollbar that hid
                          the Actions column — the one part of the row anybody
                          needs to click. City+Locality merged into Location,
                          and the four created/updated audit columns into one
                          Updated cell; the full audit lives on the record's
                          own page, which is one click away. */}
                      <tr>
                        <th style={{ width: 48 }}>No.</th>
                        <th>Property</th>
                        <th>Location</th>
                        {aiEnabled && (
                          <th style={{ width: 90 }} title="AI location-intelligence score out of 100 — advisory only">
                            AI Score
                          </th>
                        )}
                        <th style={{ width: 120 }}>Status</th>
                        <th style={{ width: 150 }}>Updated</th>
                        <th style={{ width: 200, textAlign: 'right' }}>Actions</th>
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
                              <span style={ellipsisCell(200)}>
                                {[r.values?.locality, r.values?.city].filter(Boolean).join(', ') || '—'}
                              </span>
                            </td>
                            {aiEnabled && (
                              <td style={{ whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                                {aiScoreByRecord.get(String(r._id))?.overall != null ? (
                                  <AiScoreCell score={aiScoreByRecord.get(String(r._id))} />
                                ) : aiRunning.has(r._id) || isRowAnalysing(r._id) ? (
                                  <span className="tiny muted row gap-1">
                                    <span className="spinner" />
                                    {aiScoreByRecord.get(String(r._id))?.progress?.label || 'analysing'}
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-sm"
                                    title="Score this property against the 8-pillar rubric — web research, ~60s"
                                    onClick={() => runOne(r._id)}
                                    disabled={readOnly || sweeping || !can.capture(user?.role)}
                                    style={{ padding: '2px 8px' }}
                                  >
                                    <Sparkles size={13} /> Analyse
                                  </button>
                                )}
                              </td>
                            )}
                            <td style={{ whiteSpace: 'nowrap' }}><Badge color={rmeta.color}>{rmeta.label}</Badge></td>
                            <td style={{ whiteSpace: 'nowrap' }} title={`Created by ${r.createdBy?.name || '—'} on ${fmtDateTime(r.createdAt)}`}>
                              <span className="col" style={{ lineHeight: 1.3 }}>
                                <span className="tiny" style={ellipsisCell(140)}>{r.updatedBy?.name || r.createdBy?.name || '—'}</span>
                                <span className="tiny muted">{fromNow(r.updatedAt)}</span>
                              </span>
                            </td>
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

              {/* AI Property Comparison — ranks whichever properties already
                  have an analysis. Hidden entirely when the AI module is off. */}
              {aiEnabled && (
                <SiteComparisonPanel
                  projectId={id}
                  analysedCount={(aiScores || []).filter((s) => s.overall != null).length}
                  readOnly={readOnly}
                  canRun={can.capture(user?.role)}
                />
              )}
            </div>
          </div>
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
