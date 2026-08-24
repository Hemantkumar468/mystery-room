/**
 * Requisitions — every role being hired.
 *
 * Creating one is where the AI earns its keep: pick a preset (Game Master,
 * Centre Manager…) or type a title, optionally tie it to a store-opening
 * project, click "Draft JD with AI" — the summary, responsibilities and
 * requirements land in ordinary editable fields. Nothing is published until
 * the person saves, and a hand edit marks the JD as theirs.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Sparkles, BriefcaseBusiness, X } from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { SectionCard, EmptyState, Badge, Avatar } from '../../components/ui/primitives.jsx';
import { SkTable } from '../../components/ui/Skeletons.jsx';
import {
  useGetRequisitionsQuery, useCreateRequisitionMutation, useUpdateRequisitionMutation,
  useGetHrmsMetaQuery, useDraftJdMutation,
} from '../../app/api/hrmsApi.js';
import { useProjects } from '../../app/api/projectsApi.js';
import { useEmployees } from '../../hooks/useEmployees.js';
import { DEPT_META } from '../../lib/ui.js';
import { fmtDate } from '../../lib/format.js';
import { REQ_STATUS_META, EMPLOYMENT_LABEL } from './hrmsUi.js';

const BLANK = {
  title: '', department: 'operations', project: '', city: '', headcount: 1,
  employmentType: 'full_time', experienceMinYears: '', experienceMaxYears: '',
  salaryMin: '', salaryMax: '', showSalary: false, hiringManager: '',
  jd: { summary: '', responsibilities: [], requirements: [], niceToHave: [] },
  notes: '',
};

/** One list-of-lines editor: a textarea the user edits as plain lines. */
function LinesField({ label, value = [], onChange, placeholder }) {
  return (
    <div className="field">
      <label className="label">{label}</label>
      <textarea
        className="textarea"
        rows={4}
        placeholder={placeholder}
        value={(value || []).join('\n')}
        onChange={(e) => onChange(e.target.value.split('\n'))}
      />
      <span className="tiny muted">One point per line.</span>
    </div>
  );
}

export function RequisitionFormModal({ open, onClose, initial, onSaved }) {
  const [form, setForm] = useState(() => ({ ...BLANK, ...(initial || {}), jd: { ...BLANK.jd, ...(initial?.jd || {}) } }));
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target?.type === 'checkbox' ? e.target.checked : e.target.value }));
  const setJd = (k, v) => setForm((f) => ({ ...f, jd: { ...f.jd, [k]: v } }));

  const { data: meta } = useGetHrmsMetaQuery();
  const { data: projResp } = useProjects({ limit: 100 });
  const projects = projResp?.data?.items || projResp?.data || [];
  const { employees } = useEmployees();

  const [create, creating] = useCreateRequisitionMutation();
  const [update, updating] = useUpdateRequisitionMutation();
  const [draftJd, drafting] = useDraftJdMutation();

  const applyPreset = (e) => {
    const p = (meta?.presets || []).find((x) => x.title === e.target.value);
    if (p) setForm((f) => ({ ...f, title: p.title, department: p.department, headcount: p.headcount }));
  };

  const generate = async () => {
    setError(null);
    if (!form.title.trim()) { setError('Give the role a title first — the AI drafts from it.'); return; }
    try {
      const project = projects.find((p) => p._id === form.project);
      const jd = await draftJd({
        title: form.title,
        department: form.department || undefined,
        city: form.city || project?.city || undefined,
        employmentType: form.employmentType || undefined,
        experienceMinYears: form.experienceMinYears === '' ? undefined : Number(form.experienceMinYears),
        experienceMaxYears: form.experienceMaxYears === '' ? undefined : Number(form.experienceMaxYears),
        headcount: Number(form.headcount) || 1,
        projectName: project?.name,
        notes: form.notes || undefined,
      }).unwrap();
      setForm((f) => ({ ...f, jd: { summary: jd.summary, responsibilities: jd.responsibilities, requirements: jd.requirements, niceToHave: jd.niceToHave } }));
    } catch (err) {
      setError(err?.data?.message || err?.message || 'Could not draft the JD right now.');
    }
  };

  const save = async (status) => {
    setError(null);
    try {
      const clean = (a) => (a || []).map((s) => s.trim()).filter(Boolean);
      const payload = {
        title: form.title.trim(),
        department: form.department || undefined,
        project: form.project || null,
        city: form.city || undefined,
        headcount: Number(form.headcount) || 1,
        employmentType: form.employmentType,
        experienceMinYears: form.experienceMinYears === '' ? undefined : Number(form.experienceMinYears),
        experienceMaxYears: form.experienceMaxYears === '' ? undefined : Number(form.experienceMaxYears),
        salaryMin: form.salaryMin === '' ? undefined : Number(form.salaryMin),
        salaryMax: form.salaryMax === '' ? undefined : Number(form.salaryMax),
        showSalary: Boolean(form.showSalary),
        hiringManager: form.hiringManager || null,
        jd: {
          summary: form.jd.summary,
          responsibilities: clean(form.jd.responsibilities),
          requirements: clean(form.jd.requirements),
          niceToHave: clean(form.jd.niceToHave),
        },
        ...(status ? { status } : {}),
      };
      const saved = initial?._id
        ? await update({ id: initial._id, ...payload }).unwrap()
        : await create(payload).unwrap();
      onSaved?.(saved);
      onClose();
    } catch (err) {
      setError(err?.data?.message || 'Could not save.');
    }
  };

  const busy = creating.isLoading || updating.isLoading;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial?._id ? 'Edit Requisition' : 'New Requisition'}
      subtitle="A role to hire — its JD becomes the public job page"
      width={720}
      footer={(
        <div className="row gap-2">
          <button type="button" className="btn btn-subtle" onClick={onClose}>Cancel</button>
          {!initial?._id && (
            <button type="button" className="btn btn-subtle" disabled={busy || !form.title.trim()} onClick={() => save('draft')}>Save Draft</button>
          )}
          <button type="button" className="btn btn-primary" disabled={busy || !form.title.trim()} onClick={() => save(initial?._id ? undefined : 'open')}>
            {busy ? 'Saving…' : initial?._id ? 'Save Changes' : 'Open for Applications'}
          </button>
        </div>
      )}
    >
      <div className="col gap-3">
        {error && <div className="info-panel info-panel--danger"><div className="info-panel-body">{error}</div></div>}

        <div className="form-grid">
          <div className="field">
            <label className="label">Quick pick</label>
            <select className="select" defaultValue="" onChange={applyPreset}>
              <option value="">Start from a typical centre role…</option>
              {(meta?.presets || []).map((p) => <option key={p.title} value={p.title}>{p.title} ({p.headcount})</option>)}
            </select>
          </div>
          <div className="field">
            <label className="label">Role title *</label>
            <input className="input" value={form.title} onChange={set('title')} placeholder="e.g. Game Master" />
          </div>
          <div className="field">
            <label className="label">Department</label>
            <select className="select" value={form.department} onChange={set('department')}>
              {Object.entries(DEPT_META).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="label">For centre (project)</label>
            <select className="select" value={form.project} onChange={set('project')}>
              <option value="">Head office / not centre-specific</option>
              {projects.map((p) => <option key={p._id} value={p._id}>{p.name}{p.city ? ` · ${p.city}` : ''}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="label">City</label>
            <input className="input" value={form.city} onChange={set('city')} placeholder="Inherited from the centre if left blank" />
          </div>
          <div className="field">
            <label className="label">Openings</label>
            <input className="input" type="number" min={1} value={form.headcount} onChange={set('headcount')} />
          </div>
          <div className="field">
            <label className="label">Employment type</label>
            <select className="select" value={form.employmentType} onChange={set('employmentType')}>
              {Object.entries(EMPLOYMENT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="label">Hiring manager</label>
            <select className="select" value={form.hiringManager} onChange={set('hiringManager')}>
              <option value="">Unassigned</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="label">Experience (years)</label>
            <div className="row gap-2">
              <input className="input" type="number" min={0} placeholder="min" value={form.experienceMinYears} onChange={set('experienceMinYears')} />
              <input className="input" type="number" min={0} placeholder="max" value={form.experienceMaxYears} onChange={set('experienceMaxYears')} />
            </div>
          </div>
          <div className="field">
            <label className="label">Monthly salary (₹)</label>
            <div className="row gap-2">
              <input className="input" type="number" min={0} placeholder="min" value={form.salaryMin} onChange={set('salaryMin')} />
              <input className="input" type="number" min={0} placeholder="max" value={form.salaryMax} onChange={set('salaryMax')} />
            </div>
            <label className="row gap-2 tiny muted" style={{ marginTop: 4 }}>
              <input type="checkbox" checked={form.showSalary} onChange={set('showSalary')} /> Show salary on the public job page
            </label>
          </div>
        </div>

        <div className="hrms-jd-head">
          <span className="section-title" style={{ fontSize: 14 }}>Job description</span>
          <button type="button" className="btn btn-subtle btn-sm" onClick={generate} disabled={drafting.isLoading}>
            <Sparkles size={13} /> {drafting.isLoading ? 'Drafting…' : 'Draft JD with AI'}
          </button>
        </div>
        <span className="tiny muted" style={{ marginTop: -8 }}>
          The draft lands here for you to edit — nothing goes out until you save. Add notes below to steer it.
        </span>
        <div className="field">
          <label className="label">Notes for the AI (optional)</label>
          <input className="input" value={form.notes} onChange={set('notes')} placeholder="e.g. weekend availability essential, Hindi + English" />
        </div>
        <div className="field">
          <label className="label">Summary</label>
          <textarea className="textarea" rows={3} value={form.jd.summary} onChange={(e) => setJd('summary', e.target.value)} />
        </div>
        <div className="form-grid">
          <LinesField label="Responsibilities" value={form.jd.responsibilities} onChange={(v) => setJd('responsibilities', v)} placeholder="Run game sessions end to end…" />
          <LinesField label="Requirements" value={form.jd.requirements} onChange={(v) => setJd('requirements', v)} placeholder="Comfortable with evening & weekend shifts…" />
        </div>
        <LinesField label="Nice to have" value={form.jd.niceToHave} onChange={(v) => setJd('niceToHave', v)} placeholder="Theatre / anchoring experience…" />
      </div>
    </Modal>
  );
}

export function RequisitionListPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [modal, setModal] = useState(null); // null | {} | requisition

  const { data, isLoading } = useGetRequisitionsQuery({ status: status || undefined, search: search || undefined });
  const { data: meta } = useGetHrmsMetaQuery();
  const rows = useMemo(() => data || [], [data]);

  return (
    <>
      <Topbar
        title="Requisitions"
        actions={meta?.canEdit && (
          <button type="button" className="btn btn-primary" onClick={() => setModal({})}>
            <Plus size={15} /> New Requisition
          </button>
        )}
      />
      <div className="content">
        <div className="content-narrow col gap-3 fade-in">
          <div className="row gap-2 wrap">
            <div className="input-icon-wrap grow" style={{ minWidth: 220, maxWidth: 380 }}>
              <Search size={15} className="input-icon" />
              <input className="input" placeholder="Search role, code, city…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <select className="select" style={{ width: 170 }} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {Object.entries(REQ_STATUS_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
            </select>
          </div>

          <SectionCard title={`Roles (${rows.length})`}>
            {isLoading ? <SkTable rows={5} /> : rows.length === 0 ? (
              <EmptyState icon={BriefcaseBusiness} title="No requisitions yet" hint='Click "New Requisition" — pick a preset role, let AI draft the JD, and open it for applications.' />
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="table table-clickable">
                  <thead>
                    <tr><th>Role</th><th>Centre</th><th>Openings</th><th>Pipeline</th><th>Status</th><th>Hiring manager</th><th>Target</th></tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const m = REQ_STATUS_META[r.status] || {};
                      return (
                        <tr key={r._id} onClick={() => navigate(`/hrms/requisitions/${r._id}`)}>
                          <td>
                            <div className="col">
                              <span className="sm" style={{ fontWeight: 650 }}>{r.title}</span>
                              <span className="tiny muted mono">{r.code}</span>
                            </div>
                          </td>
                          <td>
                            {r.project ? (
                              <span className="sm">{r.project.name} <span className="tiny muted">{r.city || r.project.city || ''}</span></span>
                            ) : <span className="tiny muted">{r.city || 'Head office'}</span>}
                          </td>
                          <td>{r.headcount}</td>
                          <td>
                            <span className="sm" style={{ fontWeight: 650 }}>{r.pipeline?.total || 0}</span>
                            {r.pipeline?.hired ? <span className="tiny muted"> · {r.pipeline.hired} hired</span> : null}
                          </td>
                          <td><Badge color={m.color} soft={m.soft} dot>{m.label || r.status}</Badge></td>
                          <td>
                            {r.hiringManager ? (
                              <span className="row gap-2" style={{ alignItems: 'center' }}>
                                <Avatar name={r.hiringManager.name} color={r.hiringManager.avatarColor} size={24} />
                                <span className="tiny">{r.hiringManager.name}</span>
                              </span>
                            ) : <span className="tiny muted">—</span>}
                          </td>
                          <td className="tiny muted">{r.targetDate ? fmtDate(r.targetDate) : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </div>
      </div>

      {modal && (
        <RequisitionFormModal
          open
          initial={modal._id ? modal : null}
          onClose={() => setModal(null)}
          onSaved={(r) => r?._id && navigate(`/hrms/requisitions/${r._id}`)}
        />
      )}
    </>
  );
}

export default RequisitionListPage;
