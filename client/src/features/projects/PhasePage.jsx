import { useMemo, useState } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { ArrowLeft, Plus, CalendarDays, Users, ClipboardList, Wrench, AlertTriangle } from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { flashSuccess } from '../../components/ui/SuccessFlash.jsx';
import { useGoBack } from '../../components/layout/BackButton.jsx';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Badge, EmptyState } from '../../components/ui/primitives.jsx';
import { SkDetail } from '../../components/ui/Skeletons.jsx';
import { TaskFocusBanner, useTaskFocus } from '../../components/ui/TaskFocusBanner.jsx';
import { PhaseSignals } from './PhaseSignals.jsx';
/* Phases 5, 7 and 8 have a board beside their register — the drawing
   checklist, the BOQ workspace and the contracts screen. Renders nothing on
   every other phase. See PhaseBoardLink.jsx for why it is a link, not a
   redirect. */
import { PhaseBoardLink } from './clientFlow/PhaseBoardLink.jsx';
import { PhaseBrief, phaseTiming } from '../../components/ui/PhaseBrief.jsx';
import { RecordFormModal } from './records/RecordFormModal.jsx';
import { useProject } from '../../app/api/projectsApi.js';
import { useTemplate } from '../../app/api/templatesApi.js';
import {
  useStageRecords, useCreateRecord, useUpdateRecord, useRecordDecision,
  useUpdateRecordTracking, useUploadMedia,
} from '../../app/api/recordsApi.js';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { can } from '../../lib/roles.js';
import { useTasks } from '../../app/api/tasksApi.js';
import { fmtDate } from '../../lib/format.js';
import { TASK_STATUS_META } from '../../lib/ui.js';
import { useEmployees } from '../../hooks/useEmployees.js';
import { groupsFor, seedFor, columnsFor, taskFor } from '../../lib/recordGroups.js';
import { positiveDecisionFor } from '../../lib/recordDecisions.js';
import { OutsourcePanel } from './OutsourcePanel.jsx';

/**
 * The ONE phase whose work goes to an outside designer: Design & Drawings.
 * The panel used to render on every phase — a "Send this to a designer"
 * block under the BOQ and even the project plan, which reads as an
 * instruction to outsource budgeting. Drawings are the only outsourced work.
 */
const OUTSOURCE_STAGE = 'p11';

/**
 * Submission states, in the words a non-technical reader uses. `rejected` says
 * "Changes requested" — it is a request to revise, not a verdict on the person,
 * and the label is what the designer actually sees on their own work.
 */
const RECORD_TONE = {
  draft: { label: 'Draft', soft: 'var(--surface-2)' },
  submitted: { label: 'Waiting for review', color: 'var(--warning)', soft: 'var(--warning-soft)' },
  approved: { label: 'Approved', color: 'var(--success)', soft: 'var(--success-soft)' },
  rejected: { label: 'Changes requested', color: 'var(--danger)', soft: 'var(--danger-soft, #FEE2E2)' },
};

/**
 * A real page for any phase that has no purpose-built one — every phase the
 * client flow added (drawings, vendors, BOQ, agreements, procurement, QC,
 * logistics, installation, testing), and anything added to a template later.
 *
 * Route: /projects/:id/phase/:stageKey
 *
 * These used to open in a modal over the project page, which meant no URL to
 * share or bookmark, no back button, and a cramped surface for a full working
 * screen. A phase is a place you work, not a detail popup — so it gets an
 * address like the older phases have.
 *
 * Entirely template-driven: name, description, What/Who/When/How, form fields
 * and tasks all come from the project's own snapshot plus its template, so a
 * phase added tomorrow works here with no code change.
 */
/**
 * Closing a QC Fail: the contractor's side of the loop. Only the
 * RECTIFICATION fields move — status, closure photos, owner, due date —
 * through the tracking channel, so it works even after the MD has approved
 * the Fail, while the inspected facts stay frozen. Every change is logged
 * with name and time.
 */
function RectifyModal({ record, schema, onSave, saving, onClose }) {
  const v = record.values || {};
  const statusField = schema.find((f) => f.key === 'rectification_status');
  const [form, setForm] = useState({
    rectification_status: v.rectification_status || 'In Progress',
    responsible_party: v.responsible_party || '',
    rectification_due: v.rectification_due ? String(v.rectification_due).slice(0, 10) : '',
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const upload = useUploadMedia();
  const [photos, setPhotos] = useState(v.closure_evidence || []);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const addFiles = async (files) => {
    setError(null); setUploading(true);
    try {
      const added = [];
      for (const file of [...files].slice(0, 6)) {
        const ref = await upload.mutateAsync({ file });
        added.push({ url: ref.url, name: file.name, publicId: ref.publicId });
      }
      setPhotos((ps) => [...ps, ...added]);
    } catch (err) { setError(err?.response?.data?.message || 'Upload failed — try again.'); }
    finally { setUploading(false); }
  };
  return (
    <Modal
      open onClose={onClose} title={`Rectify — ${v.check_item || record.title || 'QC item'}`} width={520}
      footer={(
        <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={saving || uploading}
            onClick={() => onSave({ ...form, closure_evidence: photos })}>
            {saving ? 'Saving…' : 'Save the fix'}
          </button>
        </div>
      )}
    >
      <div className="col gap-3">
        <p className="tiny muted" style={{ margin: 0 }}>
          <b>{v.qc_area}</b> — {v.observation || 'no observation recorded'}
          {v.severity ? ` · ${v.severity}` : ''}
        </p>
        <div className="po-ccbcc">
          <label className="pt-field"><span>Rectification status</span>
            <select className="pt-select" value={form.rectification_status} onChange={set('rectification_status')}>
              {(statusField?.options || ['Open', 'In Progress', 'Rectified', 'Re-checked & Closed']).map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
          <label className="pt-field"><span>Who is fixing it</span>
            <input value={form.responsible_party} onChange={set('responsible_party')} />
          </label>
          <label className="pt-field"><span>Fix it by</span>
            <input type="date" value={form.rectification_due} onChange={set('rectification_due')} />
          </label>
        </div>
        <div className="col gap-1">
          <span className="label">Closure photos — the proof it is fixed</span>
          <input type="file" multiple accept="image/*,.pdf" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          {uploading && <span className="tiny muted">Uploading…</span>}
          {photos.length > 0 && (
            <div className="row gap-2 wrap">
              {photos.map((ph, i) => (
                <span key={ph.url || i} className="grn-photo-chip">
                  <a href={ph.url} target="_blank" rel="noreferrer">{ph.name || `file ${i + 1}`}</a>
                  <button type="button" aria-label="Remove" onClick={() => setPhotos((ps) => ps.filter((x) => x !== ph))}>×</button>
                </span>
              ))}
            </div>
          )}
        </div>
        {error && <div className="pt-alert pt-alert--bad"><AlertTriangle size={14} /> {error}</div>}
      </div>
    </Modal>
  );
}

export default function PhasePage() {
  const { id, stageKey } = useParams();
  const navigate = useNavigate();
  const { goBack } = useGoBack(`/projects/${id}`);
  const taskFocus = useTaskFocus();

  const { data: project, isLoading } = useProject(id);
  // `template.ref` arrives POPULATED ({_id, name, code}), not as a raw id —
  // see populateProjectDetail. Passing the object made useTemplate's id check
  // fail, so it silently skipped the fetch and every phase reported "no form".
  const templateId = project?.template?.ref?._id || project?.template?.ref;
  const { data: template } = useTemplate(templateId);
  const { data: records } = useStageRecords(id, stageKey);
  const { data: taskResp } = useTasks({ project: id, stageKey, limit: 200 });

  const stage = useMemo(
    () => project?.stages?.find((s) => s.key === stageKey),
    [project, stageKey],
  );
  // The form definition lives on the template — project stages snapshot
  // scheduling and status, never the schemas (see projectStageSchema).
  const templateStage = template?.stages?.find((s) => s.key === stageKey);
  const schema = templateStage?.masterDataSchema || [];

  const rows = records?.data || records || [];
  const tasks = taskResp?.data || taskResp || [];

  /**
   * Pre-fill the Project Plan (p20) from what the system already knows, so
   * nobody retypes data captured earlier:
   *   confirmed_area  ← the chosen property's carpet area (Phase 1 capture)
   *   target_opening  ← the opening target from the New Project form
   *   setup_cost      ← the estimated budget from the New Project form
   * Only the fields with a clear one-to-one source — anything else would be a
   * guess wearing a prefill's clothes. All of it stays editable.
   */
  const { data: siteRecords } = useStageRecords(id, 'p1', {}, { enabled: stageKey === 'p20' });
  const planSeed = useMemo(() => {
    if (stageKey !== 'p20') return null;
    const sites = siteRecords?.data || siteRecords || [];
    const site = sites.find((r) => r.status === 'approved')
      || sites.find((r) => r.status === 'shortlisted')
      || sites[0];
    const seed = {};
    if (site?.values?.carpet_area != null) seed.confirmed_area = site.values.carpet_area;
    if (project?.targetEndDate) seed.target_opening = String(project.targetEndDate).slice(0, 10);
    if (project?.budget?.planned) seed.setup_cost = project.budget.planned;
    return Object.keys(seed).length ? seed : null;
  }, [stageKey, siteRecords, project]);

  const createRecord = useCreateRecord(id, stageKey);
  const updateRecord = useUpdateRecord(id, stageKey);
  const decide = useRecordDecision(id, stageKey);
  const user = useAppSelector(selectCurrentUser);
  const canDecide = can.decide(user?.role);
  /* A viewer was shown “Add” and learnt it was a lie only after filling the
     whole form and being refused by the server. */
  const canCapture = can.capture(user?.role) && !project?.isArchived;

  /**
   * "Who" is always a PERSON'S NAME, never a department code. A task's doer is
   * its assigned user, else its roster primary; the brief's role phrase and the
   * department are last-resort fallbacks for work nobody owns yet.
   */
  const { resolve } = useEmployees();
  const doerName = (t) => resolve(t.assignee?._id || t.assignee)?.name
    || resolve(t.primaryAssignee)?.name
    || t.brief?.who
    || 'Unassigned';


  const [editing, setEditing] = useState(null);  // 'new' | record — the form
  /* Which named list "Add" was pressed in, so the new entry can be seeded with
     what that list already knows and stamped with the task it belongs to. Null
     on a phase that has one undivided register. */
  const [filingInto, setFilingInto] = useState(null);
  const startNew = (group) => { setFilingInto(group || null); setEditing('new'); };
  const closeForm = () => { setEditing(null); setFilingInto(null); };
  const [viewing, setViewing] = useState(null);  // record — read-only review
  const [rectifying, setRectifying] = useState(null); // p16 Fail item being fixed
  const trackRectify = useUpdateRecordTracking(id, stageKey);

  /* markPhaseComplete IS GONE. A phase is complete when its tasks are —
     phaseProgress() computes that on every read, so there is nothing to
     press and nothing that can disagree with the task list. */

  /**
   * Approve, or send back with a reason.
   *
   * Sending back sets the record to `rejected`, which is what closes the loop:
   * the designer sees it in their own phase, reads the reason, and files a new
   * revision. Nothing is deleted — the rejected submission stays as history so
   * "what was asked for and when" is answerable later.
   */
  const review = async (decision) => {
    const record = viewing;
    if (!record) return;
    let reason;
    if (decision === 'reject') {
      // A rejection with no reason is unusable to whoever has to act on it.
      reason = window.prompt('What needs to change? The designer will see this.');
      if (!reason?.trim()) return;
    }
    await decide.mutateAsync({ id: record._id, decision, reason });
    setViewing(null);
  };

  const { planned, verdict } = phaseTiming(stage);

  const save = async ({ values, extraValues }, status) => {
    if (editing && editing !== 'new') {
      await updateRecord.mutateAsync({ id: editing._id, values, status });
    } else {
      /* Filed from a named list, so the entry records WHICH job it answers.
         Without this an entry filed from the phase page belongs to no task,
         and the task page can only ever show "everything filed on this
         phase" — see Record.task. */
      const task = taskFor(filingInto, tasks);
      await createRecord.mutateAsync({
        values, status, ...(task?._id ? { taskId: task._id } : {}),
      });
      /* Multi-add (the BOQ's Item + "Add more"): one record per extra value,
         filed here — before closeForm clears `filingInto` — so every line
         keeps the same task link as the first. */
      for (const extra of extraValues || []) {
        await createRecord.mutateAsync({
          values: extra, status, ...(task?._id ? { taskId: task._id } : {}),
        });
      }
    }
    closeForm();
  };

  // Phase 6 is the order tracker — a purpose-built page. Anyone landing on the
  // generic URL (an old link, the stepper before it learned the path) is sent
  // there rather than shown a phase with "no form". After the hooks, so the
  // hook order is identical on every render.
  if (stageKey === 'p15') return <Navigate to={`/projects/${id}/procurement`} replace />;

  if (isLoading) return (<><Topbar title="Phase" /><div className="content"><SkDetail /></div></>);

  if (!stage) {
    return (
      <>
        <Topbar title="Phase" />
        <div className="content">
          <EmptyState
            icon={ClipboardList}
            title="That phase isn’t part of this project"
            hint="It may belong to a different template. Go back to the project to see its phases."
          />
        </div>
      </>
    );
  }

  const noun = stage.recordNoun || 'Entry';
  const isCollection = stage.captureMode === 'collection';
  /* The template decides whether this phase's register is one list or several
     — a phase that says nothing keeps the single list it always had. */
  const groups = schema.length ? groupsFor(templateStage, rows) : null;

  /* Which list the doer arrived for, when they came from their own task. */
  const focusedGroupKey = (() => {
    if (!groups || !taskFocus.taskCode) return null;
    const task = tasks.find((t) => t.code === taskFocus.taskCode);
    if (!task?.templateTaskKey) return null;
    return groups.find(({ group }) => group.taskKey === task.templateTaskKey)?.group.key || null;
  })();

  /* Opening a row: a submission goes to review, anything else to the form.
     One rule, so both the grouped and ungrouped lists behave identically. */
  const openRow = (r) => (r.status === 'submitted' || r.status === 'approved'
    ? setViewing(r)
    : setEditing(r));

  /* Buttons only some phases have. Kept here rather than inside the list so
     the list stays a list and does not learn about Phase 6 or Phase 8. */
  const rowExtras = (r) => (
    <>
      {stageKey === 'p16' && r.values?.result === 'Fail' && r.values?.rectification_status !== 'Re-checked & Closed' && (
        <button
          type="button"
          className="btn btn-subtle btn-sm"
          onClick={() => setRectifying(r)}
          title="Update the fix: status, owner, closure photos"
        >
          <Wrench size={12} /> Rectify
        </button>
      )}
      {/* A BOQ line doubles as a purchase order, and a Phase 6 indent IS one —
          both open the page that prints the PO and sends it (WhatsApp/email),
          logging every send on the record. */}
      {['p13', 'p15'].includes(stageKey) && (
        <button
          type="button"
          className="btn btn-subtle btn-sm"
          onClick={() => navigate(`/projects/${id}/purchase-order/${r._id}`)}
        >
          Order
        </button>
      )}
    </>
  );
  const approvedCount = rows.filter((r) => r.status === 'approved').length;

  return (
    <>
      <Topbar
        title={(
          <span className="row gap-3" style={{ alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn-ghost btn-icon"
              onClick={goBack}
              aria-label="Back to project"
            >
              <ArrowLeft size={16} />
            </button>
            {stage.name}
            <span className="tiny muted" style={{ fontWeight: 500 }}>{project?.name}</span>
          </span>
        )}
      />

      <div className="content col gap-4">
        <TaskFocusBanner projectId={id} taskCode={taskFocus.taskCode} />
        {/* The checking phases read the other modules’ live numbers here
            instead of re-collecting them — see PhaseSignals.jsx. */}
        <PhaseSignals stageKey={stageKey} projectId={id} />
        <PhaseBoardLink stageKey={stageKey} projectId={id} />
        {/* The header shows for the NAV as well as the description — a phase
            with no description still needs a way on to the next one. */}
        {(stage.description || (project?.stages || []).length > 1) && (
          <div className={`stage-explain${stage.description ? '' : ' is-bare'}`}>
            <div className="stage-explain-main">
              {stage.description && <p className="stage-explain-text">{stage.description}</p>}
            </div>
            {stage.status === 'completed' && (
              <Badge color="var(--success)" soft="var(--success-soft)" dot>Complete</Badge>
            )}
          </div>
        )}

        {/* The four questions are reference, not the job. They open on request
            and stay shut otherwise: someone arriving here has been sent to DO
            something — upload a drawing, review one — and a four-column table
            above the fold pushes that work off the screen. */}
        <details className="ph-brief">
          <summary>What, who, when &amp; how for this phase</summary>
          <div style={{ marginTop: 10 }}><PhaseBrief stage={stage} /></div>
        </details>

        <div className="ph-grid">
          <div className="col gap-4">
            {/* THE WORK, first. Each task names the person, what they do and by
                when, and opens straight into it — so the designer sees "Create
                the drawings" and the reviewer sees "Review and approve" without
                either having to work out which part of the phase is theirs. */}
            <section className="card">
              <div className="card-head">
                <h2 className="card-title">Who does what here</h2>
                <span className="tiny muted">{tasks.length} assignment{tasks.length === 1 ? '' : 's'}</span>
              </div>
              {tasks.length === 0 ? (
                <EmptyState icon={ClipboardList} title="No one is assigned to this phase yet" />
              ) : (
                <div className="ph-jobs">
                  {tasks.map((t) => {
                    const meta = TASK_STATUS_META[t.status] || {};
                    return (
                      <button
                        type="button"
                        key={t._id}
                        className="ph-job"
                        onClick={() => navigate(`/projects/${id}/tasks/${t.code}`)}
                      >
                        <span className="ph-job-main">
                          <span className="ph-job-title">{t.title}</span>
                          {t.brief?.how && <span className="ph-job-how">{t.brief.how}</span>}
                        </span>
                        <span className="ph-job-who">
                          <span className="ph-job-who-name">{doerName(t)}</span>
                          {t.plannedEnd && <span className="ph-job-when">by {fmtDate(t.plannedEnd)}</span>}
                        </span>
                        <span className="ph-job-status">
                          <Badge color={meta.color} soft={meta.soft}>{meta.label || t.status}</Badge>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            {!schema.length ? (
              <section className="card">
                <div className="card-head"><h2 className="card-title">Details</h2></div>
                <EmptyState
                  icon={ClipboardList}
                  title="No form on this phase yet"
                  hint="Add fields to it in the template and they will appear here."
                />
              </section>
            ) : groups ? (
              /* Two jobs on one form, so two named lists — each with its own
                 heading, its own Add button and only its own entries. */
              groups.map(({ group, rows: groupRows }) => (
                <RegisterCard
                  key={group.key}
                  /* Arriving from a task highlights THAT task's list, not both
                     — the point of the split is knowing which one is yours. */
                  focused={Boolean(focusedGroupKey) && focusedGroupKey === group.key}
                  title={group.label}
                  hint={group.hint}
                  addLabel={group.addLabel || `Add ${noun}`}
                  emptyTitle={`Nothing in “${group.label}” yet`}
                  emptyHint={group.emptyHint || `Use “${group.addLabel || `Add ${noun}`}” to file the first one.`}
                  columns={columnsFor(group, schema)}
                  rows={groupRows}
                  whoName={(() => { const t = taskFor(group, tasks); return t ? doerName(t) : null; })()}
                  canAdd={canCapture}
                  onAdd={() => startNew(group)}
                  onOpen={openRow}
                  canDecide={canDecide}
                  rowExtras={rowExtras}
                  outsource={stageKey === OUTSOURCE_STAGE ? (
                    <OutsourcePanel
                      projectId={id}
                      projectName={project?.name}
                      stageKey={stageKey}
                      group={group}
                      task={taskFor(group, tasks)}
                      canInvite={canCapture}
                    />
                  ) : null}
                />
              ))
            ) : (
              <RegisterCard
                focused={Boolean(taskFocus.taskCode)}
                title={isCollection ? `${noun} Records` : 'Details'}
                addLabel={`Add ${noun}`}
                emptyTitle={`No ${noun.toLowerCase()} recorded yet`}
                emptyHint={`Use “Add ${noun}” to file the first one.`}
                columns={schema.slice(0, 3)}
                rows={rows}
                canAdd={canCapture}
                onAdd={() => startNew(null)}
                onOpen={openRow}
                canDecide={canDecide}
                rowExtras={rowExtras}
                outsource={stageKey === OUTSOURCE_STAGE ? (
                  <OutsourcePanel
                    projectId={id}
                    projectName={project?.name}
                    stageKey={stageKey}
                    group={null}
                    task={tasks[0] || null}
                    canInvite={canCapture}
                  />
                ) : null}
              />
            )}

          </div>

          <aside className="col gap-4">
            {/* Closing the phase is a decision, so it sits with the phase — not
                buried on a task. A doer submits their work; the phase is closed
                once the submissions are approved. */}
            <section className="card">
              <div className="card-head"><h2 className="card-title">Phase status</h2></div>
              <div className="ph-complete">
                {stage.status === 'completed' ? (
                  <>
                    <Badge color="var(--success)" soft="var(--success-soft)" dot>Completed</Badge>
                    {stage.completedAt && (
                      <span className="tiny muted">Closed {fmtDate(stage.completedAt)}</span>
                    )}
                  </>
                ) : (
                  <>
                    <p className="ph-complete-hint">
                      {approvedCount > 0
                        ? `${approvedCount} of ${rows.length} ${noun.toLowerCase()}${rows.length === 1 ? '' : 's'} approved.`
                        : `Nothing approved yet. Submissions are reviewed above, then this phase can be closed.`}
                    </p>
                    {stage.exitCriteria && (
                      <p className="ph-complete-hint muted"><strong>Done when:</strong> {stage.exitCriteria}</p>
                    )}
                    <p className="tiny muted">
                      This phase closes itself once every task above is Complete — there is
                      no button, and nothing to remember.
                    </p>
                  </>
                )}
              </div>
            </section>

            <section className="card">
              <div className="card-head"><h2 className="card-title">Timing</h2></div>
              <dl className="ph-facts">
                <div><dt><CalendarDays size={12} /> Allowed</dt><dd>{planned != null ? `${planned} days` : '—'}</dd></div>
                <div><dt>Planned</dt><dd>{stage.plannedStart ? `${fmtDate(stage.plannedStart)} → ${fmtDate(stage.plannedEnd)}` : '—'}</dd></div>
                <div><dt>Started</dt><dd>{stage.startedAt ? fmtDate(stage.startedAt) : 'Not started'}</dd></div>
                <div><dt>Completed</dt><dd>{stage.completedAt ? fmtDate(stage.completedAt) : '—'}</dd></div>
                {verdict && <div><dt>Against plan</dt><dd className={`ph-verdict is-${verdict.tone}`}>{verdict.text}</dd></div>}
              </dl>
            </section>

            {stage.gate?.label && (
              <section className="card">
                <div className="card-head"><h2 className="card-title">Approval gate</h2></div>
                <p className="sm" style={{ margin: 0 }}>
                  <strong>{stage.gate.label}</strong><br />
                  {stage.gate.approver && <>Approved by {stage.gate.approver}.<br /></>}
                  {stage.gate.unlocks && <span className="muted">Unlocks {stage.gate.unlocks}.</span>}
                </p>
              </section>
            )}

            <section className="card">
              <div className="card-head"><h2 className="card-title"><Users size={14} /> Who’s on it</h2></div>
              <dl className="ph-facts">
                {/* The people first — names are who "who" means. */}
                {(() => {
                  const names = [...new Set(tasks.map(doerName).filter((n) => n !== 'Unassigned'))];
                  return names.length > 0 && (
                    <div><dt>People</dt><dd>{names.slice(0, 3).join(', ')}{names.length > 3 ? ` +${names.length - 3}` : ''}</dd></div>
                  );
                })()}
                <div><dt>Department</dt><dd>{stage.ownerDepartment || '—'}</dd></div>
                <div><dt>Tasks assigned</dt><dd>{tasks.length}</dd></div>
              </dl>
            </section>
          </aside>
        </div>
      </div>

      {/* Read-only review: everything the designer submitted, its attachments,
          and the two decisions. Reuses RecordFormModal so the reviewer sees the
          submission in exactly the layout it was filled in. */}
      {viewing && schema.length > 0 && (
        <RecordFormModal
          open
          readOnly
          onClose={() => setViewing(null)}
          schema={schema}
          recordNoun={noun}
          initialValues={viewing.values}
          recordNo={viewing.recordNo || viewing.code}
          decidePending={decide.isPending}
          /* The phase's own "yes" — Shortlist on a property, Approve
             elsewhere. See recordDecisions. */
          approveLabel={positiveDecisionFor(stageKey).label}
          onApprove={canDecide && viewing.status === 'submitted'
            ? () => review(positiveDecisionFor(stageKey).decision)
            : null}
          onReject={canDecide && viewing.status === 'submitted' ? () => review('reject') : null}
          onEdit={!canDecide || viewing.status !== 'submitted' ? () => { setViewing(null); setEditing(viewing); } : null}
        />
      )}

      {editing && schema.length > 0 && (
        <RecordFormModal
          open
          onClose={closeForm}
          schema={schema}
          recordNoun={filingInto?.label || noun}
          initialValues={editing === 'new' ? null : editing.values}
          /* The list already answered “which kind is this?” — asking again is
             how an entry ends up in the wrong one. */
          seedValues={editing === 'new' ? { ...(planSeed || {}), ...(seedFor(filingInto) || {}) } : null}
          projectId={id}
          recordNo={editing !== 'new' ? (editing.recordNo || editing.code) : null}
          saving={createRecord.isPending || updateRecord.isPending}
          onSaveDraft={(payload) => save(payload, 'draft')}
          onSubmit={(payload) => save(payload, 'submitted')}
          /* Any form with an attachment can be filled from it — the reader
             works off this form's own field list, so no per-form setup. */
          documentRead={{ projectId: id, stageKey }}
        />
      )}

      {rectifying && (
        <RectifyModal
          record={rectifying}
          schema={schema}
          saving={trackRectify.isLoading || trackRectify.isPending}
          onClose={() => setRectifying(null)}
          onSave={async (values) => {
            try {
              await trackRectify.mutateAsync({ id: rectifying._id, values, note: 'Rectification updated' });
              setRectifying(null);
              flashSuccess(values.rectification_status === 'Re-checked & Closed' ? 'Fail closed — well done' : 'Fix recorded');
            } catch { /* the tracking hook surfaces errors via toast */ }
          }}
        />
      )}
    </>
  );
}

/**
 * One named list of entries: a heading that says what it is, a line saying who
 * files it, its own Add button, and its own rows.
 *
 * A phase either has one of these or several — the difference is data on the
 * template, not code here, so a phase that splits its register looks and
 * behaves exactly like a phase that does not.
 */
function RegisterCard({
  focused, title, hint, addLabel, emptyTitle, emptyHint,
  columns, rows, whoName, canAdd, onAdd, onOpen, canDecide, rowExtras, outsource,
}) {
  return (
    <section className={`card${focused ? ' is-task-focus' : ''}`}>
      <div className="card-head">
        <div className="col" style={{ gap: 2, minWidth: 0 }}>
          <h2 className="card-title">{title}</h2>
          {hint && <p className="rg-hint">{hint}</p>}
        </div>
        <div className="row gap-2" style={{ alignItems: 'center' }}>
          {/* Who is meant to file here, next to the button that files it. */}
          {whoName && <span className="rg-who">{whoName}</span>}
          {canAdd && (
            <button type="button" className="btn btn-primary btn-sm" onClick={onAdd}>
              <Plus size={14} /> {addLabel}
            </button>
          )}
        </div>
      </div>

      {/* Who outside the company is doing this, if anyone. Above the entries
          because the question "have we sent this out yet?" comes before
          "what has come back?". */}
      {outsource}

      {rows.length === 0 ? (
        <EmptyState icon={ClipboardList} title={emptyTitle} hint={emptyHint} />
      ) : (
        <div className="pi-table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 54 }}>No.</th>
                {columns.map((f) => <th key={f.key}>{f.label}</th>)}
                <th>Status</th>
                <th style={{ width: 90 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r._id}>
                  <td>{i + 1}</td>
                  {columns.map((f) => (
                    <td key={f.key}>{formatCell(r.values?.[f.key])}</td>
                  ))}
                  <td>
                    <Badge
                      color={RECORD_TONE[r.status]?.color}
                      soft={RECORD_TONE[r.status]?.soft || 'var(--surface-2)'}
                    >
                      {RECORD_TONE[r.status]?.label || r.status || 'Draft'}
                    </Badge>
                  </td>
                  <td>
                    <span className="row gap-1">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => onOpen(r)}>
                        {r.status === 'submitted' && canDecide ? 'Review' : 'Open'}
                      </button>
                      {rowExtras?.(r)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Render an unknown field value without assuming its type. */
function formatCell(v) {
  if (v === undefined || v === null || v === '') return '—';
  if (Array.isArray(v)) return v.length ? `${v.length} item${v.length === 1 ? '' : 's'}` : '—';
  if (typeof v === 'object') return v.name || v.url ? 'Attached' : '—';
  const s = String(v);
  return s.length > 60 ? `${s.slice(0, 60)}…` : s;
}
