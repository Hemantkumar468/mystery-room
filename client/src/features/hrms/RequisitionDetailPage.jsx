/**
 * One role: the JD, the public apply link, and the candidate pipeline as
 * columns — Applied → Screening → Interview → Offer → Hired, with Rejected
 * folded away underneath. Moving someone forward is one click; rejecting
 * demands a reason, because "no" without a why teaches the next round nothing.
 */
import { useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, Plus, Copy, Check, Star, XCircle, Pencil, Users, UserPlus, Trash2, KeyRound,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { SectionCard, EmptyState, Badge, Avatar } from '../../components/ui/primitives.jsx';
import { SkDetail } from '../../components/ui/Skeletons.jsx';
import {
  useGetRequisitionQuery, useUpdateRequisitionMutation, useGetHrmsMetaQuery,
  useCreateCandidateMutation, useMoveCandidateMutation, useCreateCandidateAccountMutation,
  useDeleteRequisitionMutation,
} from '../../app/api/hrmsApi.js';
import { fmtDate, fromNow } from '../../lib/format.js';
import { REQ_STATUS_META, STAGE_META, EMPLOYMENT_LABEL, SOURCE_LABEL } from './hrmsUi.js';
import { ApplyLinkCard } from './ApplyLinkCard.jsx';
import { RemoveDialog } from './RemoveDialog.jsx';
import { RequisitionFormModal } from './RequisitionListPage.jsx';

const PIPELINE = ['applied', 'screening', 'interview', 'offer', 'hired'];
const NEXT = { applied: 'screening', screening: 'interview', interview: 'offer', offer: 'hired' };

function AddCandidateModal({ open, onClose, requisitionId }) {
  const [form, setForm] = useState({ name: '', phone: '', email: '', city: '', resumeUrl: '', source: 'walk_in', expectedSalary: '', notes: '' });
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const [create, { isLoading }] = useCreateCandidateMutation();

  const save = async () => {
    setError(null);
    try {
      await create({
        requisition: requisitionId,
        name: form.name.trim(),
        phone: form.phone || undefined,
        email: form.email || undefined,
        city: form.city || undefined,
        resumeUrl: form.resumeUrl || undefined,
        source: form.source,
        expectedSalary: form.expectedSalary === '' ? undefined : Number(form.expectedSalary),
        notes: form.notes || undefined,
      }).unwrap();
      onClose();
    } catch (err) { setError(err?.data?.message || 'Could not save.'); }
  };

  return (
    <Modal
      open={open} onClose={onClose} title="Add Candidate" width={520}
      footer={(
        <div className="row gap-2">
          <button type="button" className="btn btn-subtle" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={isLoading || form.name.trim().length < 2} onClick={save}>
            {isLoading ? 'Adding…' : 'Add to pipeline'}
          </button>
        </div>
      )}
    >
      <div className="col gap-3">
        {error && <div className="info-panel info-panel--danger"><div className="info-panel-body">{error}</div></div>}
        <div className="form-grid">
          <div className="field"><label className="label">Name *</label><input className="input" value={form.name} onChange={set('name')} /></div>
          <div className="field"><label className="label">Phone</label><input className="input" value={form.phone} onChange={set('phone')} /></div>
          <div className="field"><label className="label">Email</label><input className="input" value={form.email} onChange={set('email')} /></div>
          <div className="field"><label className="label">City</label><input className="input" value={form.city} onChange={set('city')} /></div>
          <div className="field">
            <label className="label">Source</label>
            <select className="select" value={form.source} onChange={set('source')}>
              {Object.entries(SOURCE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          <div className="field"><label className="label">Expected salary (₹/mo)</label><input className="input" type="number" min={0} value={form.expectedSalary} onChange={set('expectedSalary')} /></div>
        </div>
        <div className="field"><label className="label">Resume link</label><input className="input" placeholder="Drive / portal link" value={form.resumeUrl} onChange={set('resumeUrl')} /></div>
        <div className="field"><label className="label">Notes</label><textarea className="textarea" rows={2} value={form.notes} onChange={set('notes')} /></div>
      </div>
    </Modal>
  );
}

/**
 * Hired → login account, in two beats: pick the role, then the ONE moment
 * the temporary password is ever visible. It is stored only as a hash, so
 * this dialog says so and offers copy — after Done, only a reset can help.
 */
function CreateAccountModal({ candidate, requisitionId, onClose }) {
  const [role, setRole] = useState('employee');
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null); // { account, tempPassword }
  const [copied, setCopied] = useState(false);
  const [create, creating] = useCreateCandidateAccountMutation();
  const go = async () => {
    setError(null);
    try {
      setResult(await create({ id: candidate._id, requisition: requisitionId, role }).unwrap());
    } catch (e) {
      setError(e?.data?.message || 'Could not create the account.');
    }
  };
  const copyCreds = async () => {
    try {
      await navigator.clipboard.writeText(`Login: ${result.account.email}
Password: ${result.tempPassword}`);
      setCopied(true); setTimeout(() => setCopied(false), 1500);
    } catch { /* stays visible to copy by hand */ }
  };
  return (
    <Modal
      open onClose={onClose} title={result ? `${candidate.name} can now log in` : `Create login for ${candidate.name}`} width={480}
      footer={result ? (
        <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>Done</button>
      ) : (
        <>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary btn-sm" disabled={creating.isLoading} onClick={go}>
            {creating.isLoading ? 'Creating…' : 'Create account'}
          </button>
        </>
      )}
    >
      {result ? (
        <div className="col gap-2">
          <p className="sm" style={{ margin: 0 }}>Share these with {candidate.name} — the password is shown <b>only this once</b> (it is stored encrypted). They can change it after logging in; you can reset it any time from the Employees page.</p>
          <div className="hrms-creds">
            <span className="tiny muted">Login</span><b>{result.account.email}</b>
            <span className="tiny muted">Temporary password</span><b className="hrms-creds-pass"><KeyRound size={13} /> {result.tempPassword}</b>
          </div>
          <button type="button" className="btn btn-subtle btn-sm" onClick={copyCreds}>
            {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy login + password</>}
          </button>
        </div>
      ) : (
        <div className="col gap-2">
          <p className="sm" style={{ margin: 0 }}>Creates a real account on the Employees page using the application’s details — <b>{candidate.email || 'no email on file'}</b>{candidate.phone ? ` · ${candidate.phone}` : ''}. Almost everyone should be an <b>Employee</b>: they see their own tasks and nothing they don’t need.</p>
          <label className="pt-field"><span>Role</span>
            <select className="pt-select" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="employee">Employee — does their assigned work</option>
              <option value="manager">Manager — runs projects, approves work</option>
              <option value="viewer">Viewer — read-only reports</option>
            </select>
          </label>
          {!candidate.email && <div className="pt-alert pt-alert--bad">This candidate has no email — add one first (edit the candidate), the account needs it to log in.</div>}
          {error && <div className="pt-alert pt-alert--bad">{error}</div>}
        </div>
      )}
    </Modal>
  );
}

function RejectModal({ candidate, requisitionId, onClose }) {
  const [reason, setReason] = useState('');
  const [move, { isLoading }] = useMoveCandidateMutation();
  const doReject = async () => {
    await move({ id: candidate._id, requisition: requisitionId, stage: 'rejected', rejectionReason: reason.trim() }).unwrap().catch(() => {});
    onClose();
  };
  return (
    <Modal
      open onClose={onClose} title={`Reject ${candidate.name}`} width={460}
      footer={(
        <div className="row gap-2">
          <button type="button" className="btn btn-subtle" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-danger" disabled={isLoading || reason.trim().length < 3} onClick={doReject}>
            {isLoading ? 'Rejecting…' : 'Reject'}
          </button>
        </div>
      )}
    >
      <div className="field">
        <label className="label">Reason *</label>
        <textarea className="textarea" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Kept with the record — it is what the next hiring round learns from." />
      </div>
    </Modal>
  );
}


/**
 * One editable bullet list of a job description.
 *
 * The JD used to be all-or-nothing: the only way to add a single
 * responsibility was to reopen the whole requisition form. Adding one line is
 * the commonest edit there is, so it happens here — add, change the wording,
 * remove, reorder is not offered because a JD list is read as a set, not a
 * ranking.
 *
 * Nothing saves until Save is pressed, and Cancel restores what was there, so a
 * half-typed bullet never reaches the shared record.
 */
function JdList({ label, items, canEdit, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState([]);
  const [busy, setBusy] = useState(false);

  const start = () => { setDraft([...(items || [])]); setEditing(true); };
  const change = (i, v) => setDraft((d) => d.map((x, k) => (k === i ? v : x)));
  const remove = (i) => setDraft((d) => d.filter((_, k) => k !== i));
  const add = () => setDraft((d) => [...d, '']);

  const save = async () => {
    // Blank rows are how a half-finished thought looks; drop them rather than
    // storing an empty bullet nobody can see but everybody scrolls past.
    const cleaned = draft.map((x) => x.trim()).filter(Boolean);
    setBusy(true);
    try {
      await onSave(cleaned);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    const has = (items || []).length > 0;
    if (!has && !canEdit) return null;
    return (
      <div className="hrms-jd-block">
        <div className="hrms-jd-head">
          <span className="label" style={{ marginBottom: 0 }}>{label}</span>
          {canEdit && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={start}>
              <Plus size={13} /> {has ? 'Add / edit' : `Add ${label.toLowerCase()}`}
            </button>
          )}
        </div>
        {has
          ? <ul className="hrms-jd-list">{(items || []).map((x, i) => <li key={`${x}-${i}`}>{x}</li>)}</ul>
          : <span className="tiny muted">Nothing listed yet.</span>}
      </div>
    );
  }

  return (
    <div className="hrms-jd-block">
      <div className="hrms-jd-head">
        <span className="label" style={{ marginBottom: 0 }}>{label}</span>
      </div>
      <div className="col gap-2">
        {draft.map((value, i) => (
          // eslint-disable-next-line react/no-array-index-key
          <div key={i} className="hrms-jd-row">
            <input
              className="input"
              value={value}
              autoFocus={i === draft.length - 1 && value === ''}
              placeholder={`${label.replace(/s$/, '')} ${i + 1}`}
              onChange={(e) => change(i, e.target.value)}
            />
            <button type="button" className="btn btn-ghost btn-icon" onClick={() => remove(i)} aria-label="Remove this line">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <div className="row gap-2 wrap">
          <button type="button" className="btn btn-subtle btn-sm" onClick={add}>
            <Plus size={13} /> Add a line
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}


export function RequisitionDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: r, isLoading } = useGetRequisitionQuery(id);
  const { data: meta } = useGetHrmsMetaQuery();
  const [update, { isLoading: updating }] = useUpdateRequisitionMutation();
  const [removeReq, { isLoading: removingReq }] = useDeleteRequisitionMutation();
  const [move, moving] = useMoveCandidateMutation();

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [rejecting, setRejecting] = useState(null);
  const [accountFor, setAccountFor] = useState(null); // hired candidate getting a login

  const byStage = useMemo(() => {
    const map = Object.fromEntries([...PIPELINE, 'rejected'].map((s) => [s, []]));
    for (const c of r?.candidates || []) (map[c.stage] || map.applied).push(c);
    return map;
  }, [r]);

  if (isLoading || !r) {
    return (<><Topbar title="Requisition" /><div className="content"><SkDetail /></div></>);
  }

  const m = REQ_STATUS_META[r.status] || {};
  const canEdit = Boolean(meta?.canEdit);
  const canAccounts = Boolean(meta?.canCreateAccounts);
  const setStatus = (status) => update({ id: r._id, status });
  const advance = (c) => move({ id: c._id, requisition: r._id, stage: NEXT[c.stage] });

  return (
    <>
      <Topbar
        title={(
          <span className="row gap-2" style={{ alignItems: 'center', minWidth: 0 }}>
            <button className="btn btn-ghost btn-icon" onClick={() => navigate('/hrms/requisitions')} aria-label="Back"><ArrowLeft size={16} /></button>
            <span className="page-title-text">{r.title}</span>
            <Badge color={m.color} soft={m.soft} dot>{m.label}</Badge>
          </span>
        )}
        actions={canEdit && (
          <div className="row gap-2">
            {r.status === 'open'
              ? <button type="button" className="btn btn-subtle btn-sm" onClick={() => setStatus('on_hold')}>Put on hold</button>
              : r.status !== 'closed' && <button type="button" className="btn btn-subtle btn-sm" onClick={() => setStatus('open')}>Open for applications</button>}
            <button type="button" className="btn btn-subtle btn-sm" onClick={() => setEditing(true)}><Pencil size={13} /> Edit</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRemoving(true)}>
              <Trash2 size={13} /> Remove
            </button>
          </div>
        )}
      />
      <div className="content">
        <div className="content-wide col gap-3 fade-in">
          <div className="row gap-3 wrap" style={{ alignItems: 'stretch' }}>
            <SectionCard title="The role" style={{ flex: '1.5 1 380px' }}>
              <div className="col gap-2">
                {/* Who this hire is FOR, not a strip of metadata. A hiring manager
                    opening this page asks "which centre, which city, how many"
                    before they read a word of the JD — and the centre is a link,
                    because the next question is always "how is that launch
                    going". */}
                <div className="hrms-facts">
                  <div>
                    <span className="hrms-fact-k">Requisition</span>
                    <span className="hrms-fact-v mono">{r.code}</span>
                  </div>
                  <div>
                    <span className="hrms-fact-k">Hiring for</span>
                    <span className="hrms-fact-v">
                      {r.project
                        ? <Link to={`/projects/${r.project._id || r.project}`}>{r.project.name || 'the project'}</Link>
                        : 'Head office'}
                    </span>
                  </div>
                  <div>
                    <span className="hrms-fact-k">Location</span>
                    <span className="hrms-fact-v">{r.city || r.project?.city || '—'}</span>
                  </div>
                  <div>
                    <span className="hrms-fact-k">Openings</span>
                    <span className="hrms-fact-v">{r.headcount}</span>
                  </div>
                  <div>
                    <span className="hrms-fact-k">Type</span>
                    <span className="hrms-fact-v">{EMPLOYMENT_LABEL[r.employmentType] || r.employmentType}</span>
                  </div>
                  <div>
                    <span className="hrms-fact-k">Target</span>
                    <span className="hrms-fact-v">{r.targetDate ? fmtDate(r.targetDate) : 'Not set'}</span>
                  </div>
                </div>
                {r.jd?.summary ? <p className="sm" style={{ margin: 0, lineHeight: 1.6 }}>{r.jd.summary}</p> : <span className="tiny muted">No JD yet — edit the requisition and draft one (AI can write the first version).</span>}
                <JdList
                  label="Responsibilities"
                  items={r.jd?.responsibilities}
                  canEdit={canEdit}
                  onSave={(items) => update({ id: r._id, jd: { ...(r.jd || {}), responsibilities: items } })}
                />
                <JdList
                  label="Requirements"
                  items={r.jd?.requirements}
                  canEdit={canEdit}
                  onSave={(items) => update({ id: r._id, jd: { ...(r.jd || {}), requirements: items } })}
                />
                {r.jd?.generatedBy === 'ai' && <span className="tiny muted">JD drafted by AI and not yet hand-edited.</span>}
              </div>
            </SectionCard>

            <ApplyLinkCard
              r={r}
              canEdit={canEdit}
              saving={updating}
              onChange={(patch) => update({ id: r._id, ...patch })}
            />
          </div>

          <SectionCard
            title={`Pipeline (${(r.candidates || []).filter((c) => c.stage !== 'rejected').length})`}
            subtitle="Move a candidate forward one click at a time; rejecting always records a reason"
            action={canEdit && (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setAdding(true)}><Plus size={14} /> Add candidate</button>
            )}
          >
            {(r.candidates || []).length === 0 ? (
              <EmptyState icon={Users} title="Nobody in the pipeline yet" hint="Share the apply link, or add walk-ins and referrals by hand." />
            ) : (
              <div className="hrms-board">
                {PIPELINE.map((stage) => {
                  const sm = STAGE_META[stage];
                  const list = byStage[stage];
                  return (
                    <div key={stage} className="hrms-col">
                      <div className="hrms-col-head" style={{ '--stage': sm.color }}>
                        {sm.label} <span className="hrms-col-count">{list.length}</span>
                      </div>
                      <div className="col gap-2">
                        {list.map((c) => (
                          <div key={c._id} className="hrms-card">
                            {/* The name opens the person. The card itself is not
                                clickable — it carries its own move/reject buttons,
                                and a card that navigates under them turns every
                                mis-tap into a page change. */}
                            <div className="row gap-2" style={{ alignItems: 'center', minWidth: 0 }}>
                              <Avatar name={c.name} size={24} color={c.owner?.avatarColor} />
                              <Link to={`/hrms/candidates/${c._id}`} className="sm truncate hrms-card-name" style={{ fontWeight: 650 }}>{c.name}</Link>
                              {c.rating && <span className="hrms-rating"><Star size={11} /> {c.rating}</span>}
                            </div>
                            <span className="tiny muted truncate">{[c.phone, c.city].filter(Boolean).join(' · ') || SOURCE_LABEL[c.source]}</span>
                            {c.resumeUrl && <a className="tbrief-link tiny" href={c.resumeUrl} target="_blank" rel="noopener noreferrer">Resume</a>}
                            <span className="tiny muted">{fromNow((c.stageHistory || []).at(-1)?.at || c.createdAt)}</span>
                            {canEdit && (
                              <div className="row gap-1" style={{ marginTop: 4 }}>
                                {NEXT[c.stage] && (
                                  <button type="button" className="btn btn-subtle btn-sm" disabled={moving.isLoading} onClick={() => advance(c)} title={`Move to ${STAGE_META[NEXT[c.stage]].label}`}>
                                    {STAGE_META[NEXT[c.stage]].label} <ArrowRight size={12} />
                                  </button>
                                )}
                                {c.stage === 'hired' && (c.user ? (
                                  <span className="tiny" style={{ color: 'var(--success)', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Check size={12} /> Has login</span>
                                ) : canAccounts && (
                                  <button type="button" className="btn btn-subtle btn-sm" onClick={() => setAccountFor(c)} title="Create their employee login account">
                                    <UserPlus size={12} /> Create login
                                  </button>
                                ))}
                                {c.stage !== 'hired' && (
                                  <button type="button" className="btn btn-ghost btn-icon btn-sm" title="Reject (needs a reason)" onClick={() => setRejecting(c)}>
                                    <XCircle size={14} style={{ color: 'var(--danger)' }} />
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                        {list.length === 0 && <div className="hrms-col-empty">—</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {byStage.rejected.length > 0 && (
              <details className="hrms-rejected">
                <summary>{byStage.rejected.length} rejected</summary>
                <div className="col gap-1" style={{ marginTop: 8 }}>
                  {byStage.rejected.map((c) => (
                    <div key={c._id} className="row gap-2 tiny" style={{ alignItems: 'baseline' }}>
                      <span style={{ fontWeight: 600 }}>{c.name}</span>
                      <span className="muted">— {c.rejectionReason || 'no reason recorded'}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </SectionCard>
        </div>
      </div>

      {adding && <AddCandidateModal open onClose={() => setAdding(false)} requisitionId={r._id} />}
      {editing && <RequisitionFormModal open initial={r} onClose={() => setEditing(false)} />}
      {rejecting && <RejectModal candidate={rejecting} requisitionId={r._id} onClose={() => setRejecting(null)} />}
      {accountFor && <CreateAccountModal candidate={accountFor} requisitionId={r._id} onClose={() => setAccountFor(null)} />}
      {removing && (
        <RemoveDialog
          open
          onClose={() => setRemoving(false)}
          title={`Remove ${r.title}`}
          confirmLabel="Remove this requisition"
          /* The count is not decoration. Removing a role that 23 people
             applied to is a different decision from removing an empty
             one, and the number is what tells them which they are in. */
          consequence={`The public apply link stops working immediately. ${(r.candidates || []).length} application${(r.candidates || []).length === 1 ? '' : 's'} stay on the Candidates list — this does not remove the people who applied.`}
          busy={removingReq}
          onConfirm={async (reason) => {
            await removeReq({ id: r._id, reason }).unwrap();
            navigate('/hrms/requisitions');
          }}
        />
      )}
    </>
  );
}

export default RequisitionDetailPage;
