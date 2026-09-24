import { useState, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ChevronLeft, AlertTriangle, CheckCircle2, FileText, ExternalLink,
  Clock, XCircle, Paperclip,
} from 'lucide-react';
import dayjs from '../../lib/dayjs.js';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Badge, CityChip, EmptyState } from '../../components/ui/primitives.jsx';
import { SkTable } from '../../components/ui/Skeletons.jsx';
import { Lightbox } from '../../components/ui/Lightbox.jsx';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { canApprove, canManagementApprove, isOwnTaskWork, deptMeta } from '../../lib/ui.js';
import { useTaskDecisionMutation } from '../../app/api/tasksApi.js';
import {
  useGetTaskSubmissionQuery, useGetTaskDecisionHistoryQuery, useGetTaskAnalysisQuery,
} from '../../app/api/approvalsApi.js';
import { AnalysisBlocks } from './AnalysisBlocks.jsx';

/**
 * Approval level 3 — the full report of what the doer submitted.
 *
 * Four regions in a fixed order, because they answer four questions in the
 * order an approver asks them: what was asked, what came back, what the numbers
 * say, and then — only then — the decision.
 *
 * The decision itself goes through the SAME mutation the flat queue and the
 * task page use. Two tiers, separation of duties and the activity log all live
 * in task.service.js#decide; a second implementation here would be a second
 * opinion about who may sign what, and the two would drift.
 */

const isImage = (a) => (a.mimetype || '').startsWith('image/')
  || a.resourceType === 'image'
  || a.kind === 'image';

const daysSince = (d) => {
  if (!d) return null;
  const n = Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** One labelled answer from a dynamic form. */
function AnswerField({ field }) {
  const { label, value, type, orphaned } = field;
  const text = Array.isArray(value) ? value.join(', ') : String(value);
  return (
    <div className="apr-answer">
      <dt>
        {label}
        {/* The template no longer has this field, but the doer filled it — so
            it stays visible and says why it looks different. */}
        {orphaned && <span className="apr-orphan" title="No longer on the form">removed from form</span>}
      </dt>
      <dd className={type === 'textarea' ? 'apr-answer-long' : undefined}>{text}</dd>
    </div>
  );
}

export default function ApprovalItemPage() {
  const { projectId, taskId } = useParams();
  const navigate = useNavigate();
  const user = useAppSelector(selectCurrentUser);

  const { data, isLoading, isError } = useGetTaskSubmissionQuery(taskId);
  const { data: history } = useGetTaskDecisionHistoryQuery(taskId);
  const { data: analysis } = useGetTaskAnalysisQuery(taskId);
  const [decide, decideState] = useTaskDecisionMutation();

  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [reasonError, setReasonError] = useState('');
  const [viewer, setViewer] = useState(-1);

  const back = () => navigate(`/approvals/project/${projectId}`);

  /* Every photo across the whole submission, in the order they are shown, so
     the lightbox arrows walk the evidence rather than one card of it. */
  const photos = useMemo(() => {
    if (!data) return [];
    const out = [];
    for (const u of data.submitted.updates) {
      for (const p of u.photos) out.push({ id: p.id, url: p.url, name: p.name });
    }
    for (const a of data.submitted.attachments) {
      if (isImage(a)) out.push({ id: a.id, url: a.url, name: a.name });
    }
    for (const r of data.submitted.records) {
      for (const a of r.attachments) {
        if (isImage(a)) out.push({ id: a.id, url: a.url, name: a.name });
      }
    }
    return out;
  }, [data]);

  const openPhoto = (id) => setViewer(photos.findIndex((p) => p.id === id));

  if (isLoading) {
    return (
      <>
        <Topbar title="Approval" />
        <div className="content"><SkTable rows={8} /></div>
      </>
    );
  }

  if (isError || !data) {
    return (
      <>
        <Topbar title="Approval" />
        <div className="content">
          <EmptyState
            icon={AlertTriangle}
            title="Couldn’t load this submission"
            hint="The task may have been decided or removed."
            action={<button type="button" className="btn btn-subtle" onClick={back}>Back to the queue</button>}
          />
        </div>
      </>
    );
  }

  const { task, asked, submitted } = data;
  // Sign-off axis, not work status — see approval.service.js.
  const tier2 = task.approvalState === 'waiting_management';
  const ownWork = isOwnTaskWork(user, task, tier2 ? 'management' : 'department');
  const mayDecide = tier2 ? canManagementApprove(user) : canApprove(user, task);
  const pending = ['waiting_department', 'waiting_management'].includes(task.approvalState);
  const age = daysSince(task.submittedForApprovalAt || task.actualEnd);
  const busy = decideState.isLoading;

  const files = submitted.attachments.filter((a) => !isImage(a));
  const imageAttachments = submitted.attachments.filter(isImage);

  const run = async (decision) => {
    if (decision === 'reject' && !reason.trim()) {
      setReasonError('A reason is required — it tells the doer what to change.');
      return;
    }
    try {
      await decide({
        taskId: task.id,
        projectId,
        decision,
        reason: decision === 'reject' ? reason.trim() : (comment.trim() || undefined),
      }).unwrap();
      back();
    } catch {
      // Surfaced by decideState.isError below; the typed reason is kept.
    }
  };

  return (
    <>
      <Topbar title={task.title} />

      <div className="content">
        <div className="content-wide col gap-3 fade-in apr-item">

          {/* ── Header ─────────────────────────────────────────────────── */}
          <div className="col gap-1">
            <button type="button" className="vend-back" onClick={back}>
              <ChevronLeft size={13} /> {task.project?.name || 'Back to the queue'}
            </button>
            <div className="row gap-2 wrap" style={{ alignItems: 'center' }}>
              <h2 className="vend-drill-title">{task.title}</h2>
              <span className="proj-code">{task.code}</span>
              {age !== null && age >= 7 && (
                <Badge color="var(--danger)" soft dot>Waiting {age} days</Badge>
              )}
            </div>
            <div className="row gap-2 wrap" style={{ alignItems: 'center' }}>
              {task.project?.city && <CityChip city={task.project.city} />}
              <span className="tiny muted">
                {task.stageName || task.stageKey}
                {task.department ? ` · ${deptMeta(task.department).label}` : ''}
                {' · submitted by '}
                {task.completedBy?.name || task.submittedForApprovalBy?.name || task.assignee?.name || '—'}
                {(task.completedBy?.role || task.assignee?.role) ? ` (${task.completedBy?.role || task.assignee?.role})` : ''}
                {task.submittedForApprovalAt ? ` · ${dayjs(task.submittedForApprovalAt).format('D MMM YYYY')}` : ''}
              </span>
            </div>
          </div>

          {/* ── What was asked ─────────────────────────────────────────── */}
          <section className="col gap-2">
            <h3 className="apr-section-title">What was asked</h3>
            <div className="apr-analysis-card">
              {asked.brief?.what && (
                <dl className="apr-brief">
                  <div><dt>What</dt><dd>{asked.brief.what}</dd></div>
                  {asked.brief.who && <div><dt>Who</dt><dd>{asked.brief.who}</dd></div>}
                  {asked.brief.when && <div><dt>When</dt><dd>{asked.brief.when}</dd></div>}
                  {asked.brief.how && <div><dt>How</dt><dd>{asked.brief.how}</dd></div>}
                </dl>
              )}
              {!asked.brief?.what && asked.description && (
                <p className="apr-analysis-note">{asked.description}</p>
              )}

              {asked.checklist.length > 0 && (
                <ul className="apr-checklist">
                  {asked.checklist.map((c) => (
                    <li key={c.id} className={c.done ? 'done' : undefined}>
                      {c.done
                        ? <CheckCircle2 size={14} style={{ color: 'var(--success)' }} />
                        : <XCircle size={14} style={{ color: c.required ? 'var(--danger)' : 'var(--text-subtle)' }} />}
                      <span>{c.label}</span>
                      {c.required && !c.done && <span className="apr-required">required</span>}
                    </li>
                  ))}
                </ul>
              )}

              {asked.requiredOutstanding.length > 0 && (
                <p className="apr-analysis-note">
                  <AlertTriangle size={13} style={{ color: 'var(--danger)' }} />
                  {' '}
                  {asked.requiredOutstanding.length} required item
                  {asked.requiredOutstanding.length === 1 ? '' : 's'} still unticked.
                </p>
              )}

              {!asked.brief?.what && !asked.description && asked.checklist.length === 0 && (
                <p className="apr-analysis-note muted">
                  This task carries no brief and no checklist, so there is no recorded
                  definition of done to check the submission against.
                </p>
              )}
            </div>
          </section>

          {/* ── What was submitted ─────────────────────────────────────── */}
          <section className="col gap-2">
            <h3 className="apr-section-title">What was submitted</h3>

            {submitted.records.length === 0 && submitted.updates.length === 0
              && submitted.attachments.length === 0 && submitted.links.length === 0 ? (
                <div className="apr-analysis-card">
                  <p className="apr-analysis-note muted">
                    Nothing was filed against this task — no form entries, no photos, no
                    files. The checklist above is the whole of the submission.
                  </p>
                </div>
              ) : null}

            {/* Form entries. `scope: 'phase'` means they could not be attributed
                to this task, so they are labelled as context rather than passed
                off as the submission. */}
            {submitted.records.map((r) => (
              <div key={r.id} className="apr-analysis-card">
                <div className="apr-analysis-head">
                  <FileText size={14} />
                  {r.title || `Entry ${r.seq ?? ''}`}
                  {r.scope === 'phase' && (
                    <span className="apr-scope-tag" title="Filed on this phase, not linked to this task">
                      phase context
                    </span>
                  )}
                  <span className="tiny muted" style={{ marginLeft: 'auto' }}>
                    {r.submittedBy?.name || '—'}
                    {r.submittedAt ? ` · ${dayjs(r.submittedAt).format('D MMM YYYY')}` : ''}
                  </span>
                </div>
                <dl className="apr-answers">
                  {r.fields.map((f) => <AnswerField key={f.key} field={f} />)}
                </dl>
                {r.attachments.length > 0 && (
                  <div className="row gap-2 wrap" style={{ marginTop: 10 }}>
                    {r.attachments.map((a) => (isImage(a) ? (
                      <button
                        key={a.id}
                        type="button"
                        className="apr-thumb"
                        onClick={() => openPhoto(a.id)}
                        aria-label={`View ${a.name}`}
                      >
                        <img src={a.url} alt={a.name} />
                      </button>
                    ) : (
                      <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="btn btn-subtle btn-sm">
                        <FileText size={13} /> {a.name}
                      </a>
                    )))}
                  </div>
                )}
              </div>
            ))}

            {submitted.records.length > 0 && !submitted.hasTaskScopedRecords && (
              <p className="apr-analysis-note muted">
                These entries are everything filed on this phase. They predate per-task
                linking, so they cannot be attributed to this task specifically.
              </p>
            )}

            {submitted.updates.map((u) => (
              <div key={u.id} className="apr-analysis-card">
                <div className="apr-analysis-head">
                  {u.author?.name || 'Update'}
                  <span className="tiny muted" style={{ marginLeft: 'auto' }}>
                    {dayjs(u.createdAt).format('D MMM YYYY')}
                  </span>
                </div>
                <p className="apr-update-body">{u.body}</p>
                {u.photos.length > 0 && (
                  <div className="row gap-2 wrap" style={{ marginTop: 8 }}>
                    {u.photos.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="apr-thumb"
                        onClick={() => openPhoto(p.id)}
                        aria-label={`View ${p.name}`}
                      >
                        <img src={p.url} alt={p.name} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {(imageAttachments.length > 0 || files.length > 0 || submitted.links.length > 0) && (
              <div className="apr-analysis-card">
                <div className="apr-analysis-head"><Paperclip size={14} /> Files and links</div>
                <div className="row gap-2 wrap">
                  {imageAttachments.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      className="apr-thumb"
                      onClick={() => openPhoto(a.id)}
                      aria-label={`View ${a.name}`}
                    >
                      <img src={a.url} alt={a.name} />
                    </button>
                  ))}
                  {files.map((a) => (
                    <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="btn btn-subtle btn-sm">
                      <FileText size={13} /> {a.name}
                    </a>
                  ))}
                  {submitted.links.map((l) => (
                    <a key={l.id} href={l.url} target="_blank" rel="noreferrer" className="btn btn-subtle btn-sm">
                      <ExternalLink size={13} /> {l.label}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* ── Analysis ───────────────────────────────────────────────── */}
          <AnalysisBlocks blocks={analysis || []} />

          {/* ── History, then the decision ─────────────────────────────── */}
          {(history || []).length > 0 && (
            <section className="col gap-2">
              <h3 className="apr-section-title">Earlier rounds</h3>
              <div className="apr-analysis-card col gap-2">
                {history.map((h) => (
                  <div key={h.id} className="apr-history-row">
                    <span className={`apr-history-dot ${h.action}`} />
                    <div className="col" style={{ gap: 2, minWidth: 0 }}>
                      <span className="sm" style={{ fontWeight: 620 }}>
                        {h.action === 'rejected' ? 'Rejected' : h.action === 'approved' ? 'Approved'
                          : h.action === 'submitted_for_approval' ? 'Submitted for approval' : 'Completed'}
                        {h.actor?.name ? ` by ${h.actor.name}` : ''}
                      </span>
                      {h.message && <span className="tiny muted">{h.message}</span>}
                    </div>
                    <span className="tiny muted" style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>
                      {dayjs(h.at).format('D MMM YYYY')}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {decideState.isError && (
            <div className="apr-result has-failures">
              <span>Could not record that decision. Nothing was changed.</span>
            </div>
          )}

          <div style={{ height: 8 }} />
        </div>
      </div>

      {/* ── Decision bar ─────────────────────────────────────────────── */}
      {pending && (
        <div className="apr-decisionbar">
          <div className="content-wide apr-decisionbar-inner">
            {!mayDecide ? (
              <span className="tiny muted">This needs a different signer — your role cannot decide it.</span>
            ) : ownWork ? (
              <span className="tiny muted">You submitted this — it needs a different signer.</span>
            ) : rejecting ? (
              <>
                <div className="col gap-1" style={{ flex: 1, minWidth: 0 }}>
                  <input
                    className="input"
                    autoFocus
                    placeholder="What needs to change before this can be approved?"
                    value={reason}
                    onChange={(e) => { setReason(e.target.value); if (reasonError) setReasonError(''); }}
                    aria-label="Rejection reason"
                    aria-invalid={Boolean(reasonError)}
                  />
                  {reasonError && <span className="apr-fielderror">{reasonError}</span>}
                </div>
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { setRejecting(false); setReasonError(''); }}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  style={{ background: 'var(--danger)', color: '#fff' }}
                  disabled={busy}
                  onClick={() => run('reject')}
                >
                  {busy ? <span className="spinner" /> : 'Confirm rejection'}
                </button>
              </>
            ) : (
              <>
                <input
                  className="input"
                  style={{ flex: 1, minWidth: 0 }}
                  placeholder="Optional comment on approval…"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  aria-label="Approval comment"
                />
                <button type="button" className="btn btn-subtle btn-sm" style={{ color: 'var(--danger)' }} disabled={busy} onClick={() => setRejecting(true)}>
                  Reject
                </button>
                <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => run('approve')}>
                  {busy ? <span className="spinner" /> : 'Approve'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {!pending && (
        <div className="apr-decisionbar">
          <div className="content-wide apr-decisionbar-inner">
            <Clock size={14} className="subtle" />
            <span className="tiny muted">
              {task.approvalState === 'approved' ? 'This task is approved — no decision is pending.'
                : task.approvalState === 'rejected' ? 'This task was rejected and sent back to the doer.'
                  : 'This task has not been submitted for approval yet.'}
            </span>
          </div>
        </div>
      )}

      <Lightbox items={photos} index={viewer} onClose={() => setViewer(-1)} onIndex={setViewer} />
    </>
  );
}
