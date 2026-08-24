/**
 * One role: the JD, the public apply link, and the candidate pipeline as
 * columns — Applied → Screening → Interview → Offer → Hired, with Rejected
 * folded away underneath. Moving someone forward is one click; rejecting
 * demands a reason, because "no" without a why teaches the next round nothing.
 */
import { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, Plus, Copy, Check, Star, XCircle, Link2, Pencil, Users,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { SectionCard, EmptyState, Badge, Avatar } from '../../components/ui/primitives.jsx';
import { SkDetail } from '../../components/ui/Skeletons.jsx';
import {
  useGetRequisitionQuery, useUpdateRequisitionMutation, useGetHrmsMetaQuery,
  useCreateCandidateMutation, useMoveCandidateMutation,
} from '../../app/api/hrmsApi.js';
import { fmtDate, fromNow } from '../../lib/format.js';
import { REQ_STATUS_META, STAGE_META, EMPLOYMENT_LABEL, SOURCE_LABEL, applyLinkFor } from './hrmsUi.js';
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

export function RequisitionDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: r, isLoading } = useGetRequisitionQuery(id);
  const { data: meta } = useGetHrmsMetaQuery();
  const [update] = useUpdateRequisitionMutation();
  const [move, moving] = useMoveCandidateMutation();

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [rejecting, setRejecting] = useState(null);
  const [copied, setCopied] = useState(false);

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
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(applyLinkFor(r._id)); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* clipboard blocked */ }
  };
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
          </div>
        )}
      />
      <div className="content">
        <div className="content-wide col gap-3 fade-in">
          <div className="row gap-3 wrap" style={{ alignItems: 'stretch' }}>
            <SectionCard title="The role" style={{ flex: '1.5 1 380px' }}>
              <div className="col gap-2">
                <div className="row gap-2 wrap tiny muted">
                  <span className="mono">{r.code}</span>
                  {r.project && <span>· {r.project.name}</span>}
                  {(r.city || r.project?.city) && <span>· {r.city || r.project.city}</span>}
                  <span>· {EMPLOYMENT_LABEL[r.employmentType] || r.employmentType}</span>
                  <span>· {r.headcount} opening{r.headcount === 1 ? '' : 's'}</span>
                  {r.targetDate && <span>· target {fmtDate(r.targetDate)}</span>}
                </div>
                {r.jd?.summary ? <p className="sm" style={{ margin: 0, lineHeight: 1.6 }}>{r.jd.summary}</p> : <span className="tiny muted">No JD yet — edit the requisition and draft one (AI can write the first version).</span>}
                {r.jd?.responsibilities?.length > 0 && (
                  <><span className="label" style={{ marginBottom: 0 }}>Responsibilities</span>
                    <ul className="hrms-jd-list">{r.jd.responsibilities.map((x) => <li key={x}>{x}</li>)}</ul></>
                )}
                {r.jd?.requirements?.length > 0 && (
                  <><span className="label" style={{ marginBottom: 0 }}>Requirements</span>
                    <ul className="hrms-jd-list">{r.jd.requirements.map((x) => <li key={x}>{x}</li>)}</ul></>
                )}
                {r.jd?.generatedBy === 'ai' && <span className="tiny muted">JD drafted by AI and not yet hand-edited.</span>}
              </div>
            </SectionCard>

            <SectionCard title="Share the job" subtitle="Anyone with the link can apply — no login" style={{ flex: '1 1 280px' }}>
              <div className="col gap-2">
                <div className="row gap-2" style={{ alignItems: 'center' }}>
                  <Link2 size={14} className="muted" />
                  <span className="tiny mono truncate" style={{ flex: 1 }}>{applyLinkFor(r._id)}</span>
                </div>
                <button type="button" className="btn btn-primary btn-sm" onClick={copyLink} disabled={r.status !== 'open'}>
                  {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy apply link</>}
                </button>
                {r.status !== 'open' && <span className="tiny muted">The page answers only while the requisition is Open.</span>}
                <span className="tiny muted">Paste it into WhatsApp, a job portal or a poster QR — applications land straight in the pipeline below.</span>
              </div>
            </SectionCard>
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
                            <div className="row gap-2" style={{ alignItems: 'center', minWidth: 0 }}>
                              <Avatar name={c.name} size={24} color={c.owner?.avatarColor} />
                              <span className="sm truncate" style={{ fontWeight: 650 }}>{c.name}</span>
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
    </>
  );
}

export default RequisitionDetailPage;
