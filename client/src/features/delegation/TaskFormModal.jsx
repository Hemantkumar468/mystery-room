import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { Plus, Trash2, Repeat, Bell, ListChecks, Paperclip, LayoutTemplate } from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { PersonPicker } from '../../components/ops/PersonPicker.jsx';
import { SelectMenu } from '../../components/ops/SelectMenu.jsx';
import { FileUploader } from '../../components/ops/FileUploader.jsx';
import { toast } from '../../components/ops/toast.jsx';
import {
  useCreateDelegation,
  useCatalog,
  useGroups,
  useBranches,
  useTemplates,
  useCollaborators,
} from '../../lib/opsQueries.js';
import { useOpsStore } from '../../store/opsStore.js';
import { PRIORITY_OPTIONS, errMsg } from '../../lib/opsUi.js';
import { RepeatEditor, emptyRepeat, cleanRepeat } from './RepeatEditor.jsx';
import { RemindersEditor } from './RemindersEditor.jsx';

const blank = (defaults = {}) => ({
  title: '',
  description: '',
  doers: [],
  inLoop: [],
  category: '',
  priority: 'medium',
  dueDate: dayjs().add(1, 'day').format('YYYY-MM-DD'),
  dueTime: '',
  branch: '',
  group: '',
  tags: [],
  checklistItems: [],
  evidenceRequired: false,
  verificationRequired: false,
  voiceNoteUrl: [],
  referenceDocs: [],
  reminders: [],
  isRepeat: false,
  repeat: emptyRepeat(),
  ...defaults,
});

/**
 * Assign a task — to one or many people (one task each), optionally as a
 * sub-task of `parent`, inside a group, from a template, repeating on a rule.
 */
export function TaskFormModal({ open, onClose, parent, defaults, onCreated }) {
  const storeBranch = useOpsStore((s) => s.branch);
  const [f, setF] = useState(() => blank(defaults));
  const [newItem, setNewItem] = useState('');
  const create = useCreateDelegation();
  const { data: categories = [] } = useCatalog('categories');
  const { data: tags = [] } = useCatalog('tags');
  const { data: groups = [] } = useGroups();
  const { data: branchRes } = useBranches();
  const { data: templates = [] } = useTemplates();
  const { data: recent } = useCollaborators();

  useEffect(() => {
    if (open) {
      setF(blank({ branch: storeBranch && storeBranch !== 'all' ? storeBranch : '', ...defaults }));
      setNewItem('');
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch) => setF((s) => ({ ...s, ...patch }));
  const branches = branchRes?.data || [];

  const applyTemplate = (id) => {
    const t = templates.find((x) => x._id === id);
    if (!t) return;
    set({
      title: t.title,
      description: t.description || '',
      category: t.category || f.category,
      priority: t.priority || f.priority,
      checklistItems: (t.checklistItems || []).map((c) => c.text),
      evidenceRequired: Boolean(t.evidenceRequired),
      verificationRequired: Boolean(t.verificationRequired),
    });
    toast.info(`Template "${t.title}" applied`);
  };

  const addItem = () => {
    const text = newItem.trim();
    if (!text) return;
    set({ checklistItems: [...f.checklistItems, text] });
    setNewItem('');
  };

  const missing = useMemo(() => {
    const m = [];
    if (!f.title.trim()) m.push('title');
    if (!f.description.trim()) m.push('description');
    if (!f.doers.length) m.push('assignee');
    if (!f.category) m.push('category');
    if (!f.isRepeat && !f.dueDate) m.push('due date');
    return m;
  }, [f]);

  const submit = async () => {
    if (missing.length) {
      toast.error(`Please add: ${missing.join(', ')}`);
      return;
    }
    const due = f.dueTime ? dayjs(`${f.dueDate}T${f.dueTime}`).toISOString() : f.dueDate;
    const body = {
      title: f.title.trim(),
      description: f.description.trim(),
      doers: f.doers,
      inLoop: f.inLoop,
      category: f.category,
      priority: f.priority,
      dueDate: f.isRepeat ? f.repeat.startDate : due,
      tags: f.tags,
      checklistItems: f.checklistItems.map((text) => ({ text })),
      evidenceRequired: f.evidenceRequired,
      verificationRequired: f.verificationRequired,
      reminders: f.reminders,
      ...(f.voiceNoteUrl[0] ? { voiceNoteUrl: f.voiceNoteUrl[0] } : {}),
      ...(f.referenceDocs.length ? { referenceDocs: f.referenceDocs } : {}),
      ...(parent ? { parent: parent._id } : {}),
      ...(!parent && f.branch ? { branch: f.branch } : {}),
      ...(!parent && f.group ? { group: f.group } : {}),
      ...(f.isRepeat ? { repeat: cleanRepeat(f.repeat) } : {}),
    };
    try {
      const res = await create.mutateAsync(body);
      toast.success(f.doers.length > 1 ? `${f.doers.length} tasks assigned` : 'Task assigned');
      onCreated?.(res.data);
      onClose();
    } catch (e) {
      toast.error(errMsg(e, 'Could not create the task'));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={820}
      title={parent ? 'New sub-task' : 'Assign a task'}
      subtitle={parent ? `Under ${parent.code} · ${parent.title}` : 'Hand work to one or more people and track it to closure'}
      footer={
        <>
          <span className="tiny muted grow">{f.doers.length > 1 ? `Creates ${f.doers.length} separate tasks, one per person.` : ''}</span>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={create.isPending}>
            {create.isPending ? <span className="spinner" /> : f.isRepeat ? 'Create repeating task' : 'Assign task'}
          </button>
        </>
      }
    >
      {!parent && templates.length > 0 && (
        <div className="row gap-2" style={{ marginBottom: 'var(--space-4)' }}>
          <LayoutTemplate size={15} className="subtle" />
          <SelectMenu
            className="selectmenu--capped"
            value=""
            onChange={(v) => applyTemplate(v)}
            aria-label="Start from a template"
            placeholder="Start from a template…"
            options={templates.map((t) => ({ value: t._id, label: t.title }))}
          />
        </div>
      )}

      <div className="field">
        <label className="label">Title <span className="danger-text">*</span></label>
        <input className="input" autoFocus value={f.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Replace the broken maglock in Room 2" />
      </div>
      <div className="field">
        <label className="label">Description <span className="danger-text">*</span></label>
        <textarea className="textarea" value={f.description} onChange={(e) => set({ description: e.target.value })} placeholder="What does done look like?" />
      </div>

      <div className="form-grid">
        <div className="field">
          <label className="label">Assign to <span className="danger-text">*</span></label>
          <PersonPicker multiple value={f.doers} onChange={(doers) => set({ doers })} recentIds={recent?.doerIds} placeholder="Who should do this?" />
        </div>
        <div className="field">
          <label className="label">Keep in the loop</label>
          <PersonPicker multiple value={f.inLoop} onChange={(inLoop) => set({ inLoop })} recentIds={recent?.inLoopIds} exclude={f.doers} placeholder="Optional — they follow updates" />
        </div>
        <div className="field">
          <label className="label">Category <span className="danger-text">*</span></label>
          <SelectMenu
            value={f.category}
            onChange={(v) => set({ category: v })}
            aria-label="Category"
            placeholder="Select…"
            options={categories.map((c) => ({ value: c.name, label: c.name }))}
          />
        </div>
        <div className="field">
          <label className="label">Priority</label>
          <SelectMenu
            value={f.priority}
            onChange={(v) => set({ priority: v })}
            aria-label="Priority"
            options={PRIORITY_OPTIONS}
          />
        </div>
        {!f.isRepeat && (
          <div className="field">
            <label className="label">Due <span className="danger-text">*</span></label>
            {/* The width cap on the time box lives in CSS now, not here, so a
                phone can drop it — see `.dlg-due` in ops.css. Side by side on
                a 412px screen left the time input 130px wide with its right
                edge against the frame, and the browser anchors its own picker
                to the input: the spinner then opened off the screen. */}
            <div className="row gap-2 dlg-due">
              <input className="input" type="date" value={f.dueDate} onChange={(e) => set({ dueDate: e.target.value })} />
              <input className="input" type="time" value={f.dueTime} onChange={(e) => set({ dueTime: e.target.value })} title="Optional time — defaults to end of day" />
            </div>
          </div>
        )}
        {!parent && (
          <div className="field">
            <label className="label">Branch</label>
            <SelectMenu
              value={f.branch}
              onChange={(v) => set({ branch: v })}
              aria-label="Branch"
              placeholder="My branch"
              options={[{ value: '', label: 'My branch' },
                ...branches.map((b) => ({ value: b._id, label: `${b.name} (${b.code})` }))]}
            />
          </div>
        )}
        {!parent && (
          <div className="field">
            <label className="label">Group</label>
            <SelectMenu
              value={f.group}
              onChange={(v) => set({ group: v })}
              aria-label="Group"
              placeholder="No group"
              options={[{ value: '', label: 'No group' },
                ...groups.map((g) => ({ value: g._id, label: g.name }))]}
            />
          </div>
        )}
        {tags.length > 0 && (
          <div className="field span-2">
            <label className="label">Tags</label>
            <div className="row gap-2 wrap">
              {tags.map((t) => {
                const on = f.tags.includes(t.name);
                return (
                  <button
                    type="button"
                    key={t._id}
                    className={`chip ${on ? 'active' : ''}`}
                    onClick={() => set({ tags: on ? f.tags.filter((x) => x !== t.name) : [...f.tags, t.name] })}
                  >
                    <span className="badge-dot" style={{ background: t.color }} /> {t.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="form-section">
        <span className="eyebrow row gap-1"><ListChecks size={12} /> Checklist & proof</span>
        {f.checklistItems.map((text, i) => (
          // eslint-disable-next-line react/no-array-index-key
          <div key={i} className="check-item">
            <input type="checkbox" disabled />
            <span className="grow sm">{text}</span>
            <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => set({ checklistItems: f.checklistItems.filter((_, idx) => idx !== i) })} aria-label="Remove item">
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        <div className="row gap-2" style={{ marginTop: 8 }}>
          <input className="input" value={newItem} onChange={(e) => setNewItem(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addItem())} placeholder="Add a checklist step and press Enter" />
          <button type="button" className="btn btn-subtle btn-sm" onClick={addItem}><Plus size={14} /> Add</button>
        </div>
        <div className="row gap-5 wrap" style={{ marginTop: 'var(--space-4)' }}>
          <label className="toggle-row">
            <input type="checkbox" checked={f.evidenceRequired} onChange={(e) => set({ evidenceRequired: e.target.checked })} />
            Proof required to complete
          </label>
          <label className="toggle-row">
            <input type="checkbox" checked={f.verificationRequired} onChange={(e) => set({ verificationRequired: e.target.checked })} />
            I verify before it closes
          </label>
        </div>
      </div>

      <div className="form-section">
        <span className="eyebrow row gap-1"><Paperclip size={12} /> Attachments</span>
        <div className="form-grid">
          <div className="field" style={{ marginBottom: 0 }}>
            <label className="label">Voice note</label>
            <FileUploader multiple={false} value={f.voiceNoteUrl} onChange={(voiceNoteUrl) => set({ voiceNoteUrl })} label="Attach audio" accept="audio/*" />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label className="label">Reference documents</label>
            <FileUploader value={f.referenceDocs} onChange={(referenceDocs) => set({ referenceDocs })} label="Attach files" />
          </div>
        </div>
      </div>

      <div className="form-section">
        <label className="toggle-row" style={{ marginBottom: f.isRepeat ? 'var(--space-3)' : 0 }}>
          <input type="checkbox" checked={f.isRepeat} onChange={(e) => set({ isRepeat: e.target.checked })} />
          <Repeat size={14} /> Repeat this task
        </label>
        {f.isRepeat && <RepeatEditor value={f.repeat} onChange={(repeat) => set({ repeat })} />}
      </div>

      <div className="form-section" style={{ marginBottom: 0 }}>
        <span className="eyebrow row gap-1"><Bell size={12} /> Reminders</span>
        <RemindersEditor value={f.reminders} onChange={(reminders) => set({ reminders })} />
      </div>
    </Modal>
  );
}

export default TaskFormModal;
