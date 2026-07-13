import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Star } from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { NumberInput } from '../../components/ui/NumberInput.jsx';
import { useTemplates, useUsers, useCreateProject } from '../../lib/queries.js';
import dayjs from 'dayjs';

const CITIES = [
  'Delhi', 'Mumbai', 'Noida', 'Gurgaon', 'Pune', 'Bangalore', 'Chennai', 'Hyderabad',
  'Kolkata', 'Ahmedabad', 'Jaipur', 'Ludhiana', 'Chandigarh', 'Lucknow', 'Visakhapatnam',
];

export function NewProjectModal({ open, onClose }) {
  const templates = useTemplates({ status: 'published' });
  const users = useUsers({ role: 'manager' });
  const create = useCreateProject();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: '',
    templateId: '',
    city: 'Pune',
    plannedStartDate: dayjs().format('YYYY-MM-DD'),
    owner: '',
    areaSqft: '',
    budgetPlanned: '',
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const templateList = templates.data?.data || [];
  const defaultTemplate = templateList.find((t) => t.isDefault);

  // Preselect the default playbook once templates load, without overriding a
  // choice the user has already made.
  useEffect(() => {
    if (!open || !defaultTemplate) return;
    setForm((f) => (f.templateId ? f : { ...f, templateId: defaultTemplate._id }));
  }, [open, defaultTemplate]);

  const submit = async (e) => {
    e.preventDefault();
    const body = {
      name: form.name,
      templateId: form.templateId,
      city: form.city,
      plannedStartDate: form.plannedStartDate,
      ...(form.owner ? { owner: form.owner } : {}),
      ...(form.areaSqft ? { areaSqft: Number(form.areaSqft) } : {}),
      ...(form.budgetPlanned ? { budget: { planned: Number(form.budgetPlanned) } } : {}),
    };
    const project = await create.mutateAsync(body);
    onClose();
    navigate(`/projects/${project._id}`);
  };

  const err = create.error?.response?.data?.message;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New Franchise Project"
      subtitle="Spin up a launch from a published template"
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={create.isPending || !form.name || !form.templateId}>
            {create.isPending ? <span className="spinner" /> : 'Create project'}
          </button>
        </>
      }
    >
      <form onSubmit={submit}>
        <div className="field">
          <label className="label">Project name</label>
          <input className="input" value={form.name} onChange={set('name')} placeholder="Mystery Rooms — Indiranagar" required />
        </div>

        <div className="field">
          <label className="label">Template</label>
          <select className="select" value={form.templateId} onChange={set('templateId')} required>
            <option value="">Select a template…</option>
            {templateList.map((t) => (
              <option key={t._id} value={t._id}>
                {t.name} · {t.totalStages} phases{t.isDefault ? ' · default' : ''}
              </option>
            ))}
          </select>
          {defaultTemplate && form.templateId === defaultTemplate._id && (
            <span className="row gap-1 tiny muted" style={{ marginTop: 4 }}>
              <Star size={11} fill="currentColor" style={{ color: 'var(--primary)' }} />
              Using the default playbook — its tasks, checklists, doers and buddies are assigned automatically.
            </span>
          )}
        </div>

        <div className="row gap-4">
          <div className="field grow">
            <label className="label">City</label>
            <select className="select" value={form.city} onChange={set('city')}>
              {CITIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="field grow">
            <label className="label">Planned start</label>
            <input className="input" type="date" value={form.plannedStartDate} onChange={set('plannedStartDate')} />
          </div>
        </div>

        <div className="row gap-4">
          <div className="field grow">
            <label className="label">Owner (manager)</label>
            <select className="select" value={form.owner} onChange={set('owner')}>
              <option value="">Unassigned</option>
              {(users.data || []).map((u) => <option key={u._id} value={u._id}>{u.name}</option>)}
            </select>
          </div>
          <div className="field grow">
            <label className="label">Area (sq.ft)</label>
            <NumberInput className="input" value={form.areaSqft} onChange={set('areaSqft')} placeholder="3000" />
          </div>
        </div>

        <div className="field">
          <label className="label">Planned budget (₹)</label>
          <NumberInput className="input" value={form.budgetPlanned} onChange={set('budgetPlanned')} placeholder="4500000" />
        </div>

        {err && <div className="badge" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>{err}</div>}
      </form>
    </Modal>
  );
}

export default NewProjectModal;
