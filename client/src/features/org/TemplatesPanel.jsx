import { useEffect, useState } from 'react';
import { Plus, LayoutTemplate, Pencil, Trash2, ListChecks, Camera, ShieldCheck, X, User } from 'lucide-react';
import { Badge, EmptyState, PriorityBadge } from '../../components/ui/primitives.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { SkBlock } from '../../components/ui/Skeletons.jsx';
import { toast } from '../../components/ops/toast.jsx';
import { useTemplates, useSaveTemplate, useDeleteTemplate, useCatalog } from '../../lib/opsQueries.js';
import { PRIORITY_OPTIONS, errMsg } from '../../lib/opsUi.js';
import { ConfirmModal, Toggle, tone } from './orgCommon.jsx';

const EVIDENCE = tone('var(--info)');
const VERIFY = tone('var(--success)');

/** Reusable delegation task templates. Everyone but viewers can create; author or admin edits. */
export function TemplatesPanel({ me }) {
  const { data: templates, isLoading, isError, error } = useTemplates();
  const { data: categories = [] } = useCatalog('categories');
  const del = useDeleteTemplate();
  const [editing, setEditing] = useState(null); // template | {} for new
  const [deleting, setDeleting] = useState(null);

  const canCreate = !!me.role && me.role !== 'viewer';
  const canModify = (t) => me.isAdmin || (t.createdBy?._id && t.createdBy._id === me.id);
  const catColor = (name) => categories.find((c) => c.name === name)?.color;

  const remove = async () => {
    try {
      await del.mutateAsync(deleting._id);
      toast.success(`Template “${deleting.title}” deleted`);
    } catch (e) {
      toast.error(errMsg(e));
      throw e;
    }
  };

  return (
    <div className="col gap-4">
      <div className="row between wrap gap-3">
        <div className="sm muted">Templates pre-fill new delegated tasks — title, checklist, priority and proof requirements.</div>
        {canCreate && (
          <button className="btn btn-primary" onClick={() => setEditing({})}>
            <Plus size={16} /> New template
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="tpl-grid">{Array.from({ length: 4 }).map((_, i) => <SkBlock key={i} h={180} />)}</div>
      ) : isError ? (
        <div className="card"><EmptyState icon={LayoutTemplate} title="Couldn't load templates" hint={errMsg(error)} /></div>
      ) : !templates?.length ? (
        <div className="card">
          <EmptyState
            icon={LayoutTemplate}
            title="No task templates yet"
            hint="Save the tasks you delegate again and again."
            action={canCreate && <button className="btn btn-primary" onClick={() => setEditing({})}><Plus size={16} /> New template</button>}
          />
        </div>
      ) : (
        <div className="tpl-grid">
          {templates.map((t) => (
            <div key={t._id} className="card tpl-card">
              <div className="card-body">
                <div className="row between gap-3" style={{ alignItems: 'flex-start' }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{t.title}</div>
                  {canModify(t) && (
                    <div className="row gap-1">
                      <button className="btn btn-ghost btn-icon btn-sm" title="Edit" onClick={() => setEditing(t)}><Pencil size={14} /></button>
                      <button className="btn btn-ghost btn-icon btn-sm danger-text" title="Delete" onClick={() => setDeleting(t)}><Trash2 size={14} /></button>
                    </div>
                  )}
                </div>
                {t.description && <p className="sm muted team-desc" style={{ minHeight: 0 }}>{t.description}</p>}
                <div className="row gap-2 wrap">
                  {t.category && <Badge color={catColor(t.category) || '#6b7280'} dot>{t.category}</Badge>}
                  {t.priority && <PriorityBadge value={t.priority} />}
                  {t.evidenceRequired && <Badge color={EVIDENCE.color} soft={EVIDENCE.soft}><Camera size={11} /> Evidence</Badge>}
                  {t.verificationRequired && <Badge color={VERIFY.color} soft={VERIFY.soft}><ShieldCheck size={11} /> Verification</Badge>}
                </div>
                <div className="row between team-foot tiny muted" style={{ marginTop: 'auto' }}>
                  <span className="row gap-1"><ListChecks size={13} /> {t.checklistItems?.length || 0} checklist items</span>
                  <span className="row gap-1"><User size={13} /> {t.createdBy?.name || '—'}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <TemplateEditor template={editing} categories={categories} onClose={() => setEditing(null)} />
      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete template?"
        message={`“${deleting?.title}” will no longer be offered when delegating. Tasks already created from it are not affected.`}
        onConfirm={remove}
      />
    </div>
  );
}

const initTemplate = (t) => ({
  title: t?.title || '',
  description: t?.description || '',
  category: t?.category || '',
  priority: t?.priority || 'medium',
  items: t?.checklistItems?.length ? t.checklistItems.map((c) => c.text) : [],
  evidenceRequired: !!t?.evidenceRequired,
  verificationRequired: !!t?.verificationRequired,
});

function TemplateEditor({ template, categories, onClose }) {
  const open = !!template;
  const isEdit = !!template?._id;
  const [form, setForm] = useState(() => initTemplate(template));
  const save = useSaveTemplate();
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (template) setForm(initTemplate(template));
  }, [template]);

  const setItem = (i, v) => setForm((f) => ({ ...f, items: f.items.map((x, j) => (j === i ? v : x)) }));
  const addItem = () => setForm((f) => ({ ...f, items: [...f.items, ''] }));
  const removeItem = (i) => setForm((f) => ({ ...f, items: f.items.filter((_, j) => j !== i) }));

  const valid = form.title.trim().length > 0;
  // Keep a category that was deleted from the catalog selectable, so editing doesn't silently drop it.
  const catOptions = categories.some((c) => c.name === form.category) || !form.category
    ? categories
    : [...categories, { _id: 'current', name: form.category }];

  const submit = async () => {
    if (!valid) return;
    const body = {
      title: form.title.trim(),
      description: form.description.trim(),
      category: form.category,
      priority: form.priority,
      checklistItems: form.items.map((t) => t.trim()).filter(Boolean).map((text) => ({ text })),
      evidenceRequired: form.evidenceRequired,
      verificationRequired: form.verificationRequired,
    };
    try {
      await save.mutateAsync(isEdit ? { _id: template._id, ...body } : body);
      toast.success(isEdit ? 'Template updated' : 'Template created');
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit template' : 'New task template'}
      subtitle={isEdit ? template.title : 'Pre-fill delegated tasks you assign often'}
      width={640}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={!valid || save.isPending}>
            {save.isPending ? <span className="spinner" /> : isEdit ? 'Save changes' : 'Create template'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <div className="field span-2">
          <label className="label">Title <span style={{ color: 'var(--danger)' }}>*</span></label>
          <input className="input" autoFocus value={form.title} maxLength={250} onChange={(e) => set('title')(e.target.value)} placeholder="e.g. Weekly room reset audit" />
        </div>
        <div className="field span-2">
          <label className="label">Description</label>
          <textarea className="textarea" value={form.description} maxLength={5000} onChange={(e) => set('description')(e.target.value)} />
        </div>
        <div className="field">
          <label className="label">Category</label>
          <select className="select" value={form.category} onChange={(e) => set('category')(e.target.value)}>
            <option value="">No category</option>
            {catOptions.map((c) => <option key={c._id} value={c.name}>{c.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="label">Priority</label>
          <select className="select" value={form.priority} onChange={(e) => set('priority')(e.target.value)}>
            {PRIORITY_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>
      </div>

      <div className="form-section">
        <div className="row between" style={{ marginBottom: 'var(--space-3)' }}>
          <span className="eyebrow">Checklist items</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={addItem} disabled={form.items.length >= 50}>
            <Plus size={14} /> Add item
          </button>
        </div>
        {form.items.length === 0 && <div className="sm muted">No checklist — the task is a single step.</div>}
        {form.items.map((text, i) => (
          <div className="check-edit" key={i}>
            <span className="tiny subtle mono" style={{ width: 18 }}>{i + 1}.</span>
            <input
              className="input"
              value={text}
              maxLength={300}
              onChange={(e) => setItem(i, e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addItem())}
              placeholder="Checklist step…"
            />
            <button type="button" className="btn btn-ghost btn-icon btn-sm" title="Remove" onClick={() => removeItem(i)}>
              <X size={14} />
            </button>
          </div>
        ))}
      </div>

      <div className="col gap-3">
        <Toggle checked={form.evidenceRequired} onChange={set('evidenceRequired')} label="Evidence required" hint="The doer must attach a photo or file to complete the task." />
        <Toggle checked={form.verificationRequired} onChange={set('verificationRequired')} label="Verification required" hint="The assigner approves the task before it counts as completed." />
      </div>
    </Modal>
  );
}

export default TemplatesPanel;
