import { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, CalendarDays, Users, ClipboardList } from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Badge, EmptyState } from '../../components/ui/primitives.jsx';
import { SkDetail } from '../../components/ui/Skeletons.jsx';
import { PhaseBrief, phaseTiming } from '../../components/ui/PhaseBrief.jsx';
import { RecordFormModal } from './records/RecordFormModal.jsx';
import { useProject } from '../../app/api/projectsApi.js';
import { useTemplate } from '../../app/api/templatesApi.js';
import {
  useStageRecords, useCreateRecord, useUpdateRecord, useRecordDecision,
} from '../../app/api/recordsApi.js';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { can } from '../../lib/roles.js';
import { useTasks } from '../../app/api/tasksApi.js';
import { fmtDate } from '../../lib/format.js';
import { TASK_STATUS_META } from '../../lib/ui.js';

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
export default function PhasePage() {
  const { id, stageKey } = useParams();
  const navigate = useNavigate();

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

  const createRecord = useCreateRecord(id, stageKey);
  const updateRecord = useUpdateRecord(id, stageKey);
  const decide = useRecordDecision(id, stageKey);
  const user = useAppSelector(selectCurrentUser);
  const canDecide = can.decide(user?.role);

  const [editing, setEditing] = useState(null);  // 'new' | record — the form
  const [viewing, setViewing] = useState(null);  // record — read-only review

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

  const save = async ({ values }, status) => {
    if (editing && editing !== 'new') {
      await updateRecord.mutateAsync({ id: editing._id, values, status });
    } else {
      await createRecord.mutateAsync({ values, status });
    }
    setEditing(null);
  };

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

  return (
    <>
      <Topbar
        title={(
          <span className="row gap-3" style={{ alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn-ghost btn-icon"
              onClick={() => navigate(`/projects/${id}`)}
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
        {stage.description && (
          <div className="stage-explain">
            <div className="stage-explain-main">
              <p className="stage-explain-text">{stage.description}</p>
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
                          <span className="ph-job-who-name">{t.brief?.who || t.department || '—'}</span>
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

            <section className="card">
              <div className="card-head">
                <h2 className="card-title">{isCollection ? `${noun} Records` : 'Details'}</h2>
                {schema.length > 0 && (
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing('new')}>
                    <Plus size={14} /> Add {noun}
                  </button>
                )}
              </div>

              {!schema.length ? (
                <EmptyState
                  icon={ClipboardList}
                  title="No form on this phase yet"
                  hint="Add fields to it in the template and they will appear here."
                />
              ) : rows.length === 0 ? (
                <EmptyState
                  icon={ClipboardList}
                  title={`No ${noun.toLowerCase()} recorded yet`}
                  hint={`Use “Add ${noun}” to file the first one.`}
                />
              ) : (
                <div className="pi-table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th style={{ width: 54 }}>No.</th>
                        {/* First three fields make the columns — enough to
                            identify a row without guessing at a layout for a
                            schema this page has never seen. */}
                        {schema.slice(0, 3).map((f) => <th key={f.key}>{f.label}</th>)}
                        <th>Status</th>
                        <th style={{ width: 90 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={r._id}>
                          <td>{i + 1}</td>
                          {schema.slice(0, 3).map((f) => (
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
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => (r.status === 'submitted' || r.status === 'approved'
                                ? setViewing(r)
                                : setEditing(r))}
                            >
                              {r.status === 'submitted' && canDecide ? 'Review' : 'Open'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

          </div>

          <aside className="col gap-4">
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
          onApprove={canDecide && viewing.status === 'submitted' ? () => review('approve') : null}
          onReject={canDecide && viewing.status === 'submitted' ? () => review('reject') : null}
          onEdit={!canDecide || viewing.status !== 'submitted' ? () => { setViewing(null); setEditing(viewing); } : null}
        />
      )}

      {editing && schema.length > 0 && (
        <RecordFormModal
          open
          onClose={() => setEditing(null)}
          schema={schema}
          recordNoun={noun}
          initialValues={editing === 'new' ? null : editing.values}
          recordNo={editing !== 'new' ? (editing.recordNo || editing.code) : null}
          saving={createRecord.isPending || updateRecord.isPending}
          onSaveDraft={(payload) => save(payload, 'draft')}
          onSubmit={(payload) => save(payload, 'submitted')}
        />
      )}
    </>
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
