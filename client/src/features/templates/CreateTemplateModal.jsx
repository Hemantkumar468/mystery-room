import { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, ArrowUp, ArrowDown, Layers, ListChecks, Clock, ShieldCheck, ChevronDown, CheckSquare, Star } from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { NumberInput } from '../../components/ui/NumberInput.jsx';
import { useCreateTemplate, useUpdateTemplate } from '../../app/api/templatesApi.js';
import { EMPLOYEES_BY_DEPT, getEmployeeById } from '../../lib/employees.js';
import { DEPT_META, CHART_COLORS } from '../../lib/ui.js';
import { freshBlueprintPhases } from './pmsBlueprint.js';

/** Unique-enough local id for a newly added stage / task / checklist row. */
const localId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

/**
 * Convert a raw server stage array into the local UI shape the modal uses.
 *
 * `id` carries the server `key` verbatim so an edit round-trips without
 * renaming stages and tasks. Anything the builder can't edit (masterDataSchema,
 * dependencies) is carried through untouched rather than dropped on save.
 */
function serverStagesToLocal(serverStages = []) {
  return [...serverStages]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((s) => ({
      id: s.key || localId('stage'),
      name: s.name || '',
      description: s.description || '',
      ownerDepartment: s.ownerDepartment || 'expansion',
      slaDays: s.slaDays ?? 7,
      color: s.color || '#6E45FF',
      requiresApproval: s.requiresApproval || false,
      approverRoles: s.approverRoles || [],
      masterDataSchema: s.masterDataSchema || [],
      tasks: [...(s.tasks || [])]
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((t) => ({
          id: t.key || localId('task'),
          title: t.title || '',
          description: t.description || '',
          department: t.department || s.ownerDepartment || 'expansion',
          estimatedDays: t.estimatedDays ?? 1,
          priority: t.priority || 'medium',
          assignees: t.assignees || [],
          primaryAssignee: t.primaryAssignee || '',
          backupAssignee: t.backupAssignee || '',
          dependencies: t.dependencies || [],
          checklist: [...(t.checklist || [])]
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
            .map((c, i) => ({
              cid: `${t.key || 'task'}-c${i + 1}`,
              label: c.label || '',
              required: c.required || false,
            })),
        })),
    }));
}

/* ─── SingleAssigneeDropdown ───────────────────────────────────────────────
   A dropdown for selecting a single employee from a department.
   Displays availability status (available, busy, on_leave) with dots.
   Shows warnings if selected employee is busy or on leave.
──────────────────────────────────────────────────────────────────────────── */
function SingleAssigneeDropdown({ department, selectedId, onChange, placeholder, excludeId }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const rootRef = useRef(null);

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return;
    const handleKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const handleClick = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const pool = EMPLOYEES_BY_DEPT[department] || [];
  const filtered = pool.filter(e =>
    (e.name.toLowerCase().includes(search.toLowerCase()) ||
      e.role.toLowerCase().includes(search.toLowerCase())) &&
    e.id !== excludeId
  );

  const selectedEmp = selectedId ? getEmployeeById(selectedId) : null;

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        onClick={() => { setOpen(o => !o); setSearch(''); }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 10px',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          color: selectedEmp ? 'var(--text)' : 'var(--text-subtle)',
          cursor: 'pointer',
          fontSize: '12px',
          fontWeight: 550,
          height: 28,
          minWidth: 150,
          textAlign: 'left'
        }}
      >
        {selectedEmp ? (
          <>
            <span style={{
              width: 14, height: 14, borderRadius: '50%',
              background: selectedEmp.avatarColor, color: '#fff',
              display: 'grid', placeItems: 'center',
              fontSize: 8, fontWeight: 700, flexShrink: 0
            }}>
              {selectedEmp.initials.slice(0, 2)}
            </span>
            <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: 90 }}>
              {selectedEmp.name}
            </span>
            {selectedEmp.availability?.status !== 'available' && (
              <span title={`${selectedEmp.availability?.status}: ${selectedEmp.availability?.reason || ''}`} style={{ fontSize: 10 }}>⚠️</span>
            )}
          </>
        ) : (
          <span>{placeholder}</span>
        )}
        <ChevronDown size={10} style={{ marginLeft: 'auto', opacity: 0.6 }} />
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            zIndex: 300,
            background: 'var(--surface)',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius)',
            boxShadow: 'var(--shadow-3)',
            minWidth: 230,
            maxWidth: 280,
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* Search */}
          <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>
            <input
              autoFocus
              className="input"
              placeholder="Search name or role…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ fontSize: 11.5, padding: '4px 6px' }}
            />
          </div>

          {/* Employee list */}
          <div style={{ maxHeight: 180, overflowY: 'auto' }}>
            {selectedId && (
              <button
                type="button"
                onClick={() => { onChange(''); setOpen(false); }}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '6px 8px',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 11.5,
                  color: 'var(--text-subtle)',
                  borderBottom: '1px solid var(--border)',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-hover)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                Clear Selection
              </button>
            )}

            {filtered.length === 0 ? (
              <div className="sm muted center" style={{ padding: '10px' }}>
                {pool.length === 0 ? 'No employees found in this department' : 'No match found'}
              </div>
            ) : (
              filtered.map(emp => {
                const isAvail = emp.availability?.status === 'available';
                const isLeave = emp.availability?.status === 'on_leave';
                const statusDotColor = isAvail ? '#10b981' : (isLeave ? '#f43f5e' : '#f59e0b');

                return (
                  <button
                    key={emp.id}
                    type="button"
                    onClick={() => { onChange(emp.id); setOpen(false); }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      width: '100%',
                      textAlign: 'left',
                      padding: '6px 8px',
                      background: selectedId === emp.id ? 'var(--surface-2)' : 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      borderBottom: '1px solid var(--border)',
                      fontSize: 11.5
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-hover)'}
                    onMouseLeave={e => e.currentTarget.style.background = selectedId === emp.id ? 'var(--surface-2)' : 'transparent'}
                  >
                    {/* Avatar */}
                    <span style={{
                      width: 24, height: 24, borderRadius: '50%',
                      background: emp.avatarColor, color: '#fff',
                      display: 'grid', placeItems: 'center',
                      fontSize: 9, fontWeight: 700, flexShrink: 0
                    }}>
                      {emp.initials.slice(0, 2)}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        {emp.name}
                        <span
                          style={{
                            width: 6, height: 6, borderRadius: '50%',
                            background: statusDotColor, display: 'inline-block'
                          }}
                          title={emp.availability?.reason || emp.availability?.status}
                        />
                      </div>
                      <div style={{ fontSize: 10.5, color: 'var(--text-subtle)' }}>
                        {emp.role} {emp.availability?.reason ? `(${emp.availability.reason})` : ''}
                      </div>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function CreateTemplateModal({ open, onClose, onSuccess, initialData }) {
  const isEditMode = !!initialData?._id;
  const createTemplate = useCreateTemplate();
  const updateTemplate = useUpdateTemplate(initialData?._id);
  const mutation = isEditMode ? updateTemplate : createTemplate;
  const [fieldErrors, setFieldErrors] = useState({}); // { 'stageId:taskId:field': msg, 'stageId::field': msg }
  const [validationSummary, setValidationSummary] = useState([]); // [{ id, label, msg }]
  const firstErrorRef = useRef(null);

  const BLANK_META = { name: '', code: '', description: '', status: 'draft', isDefault: false };

  const [metadata, setMetadata] = useState(BLANK_META);

  // A new template starts from the client's official 10-phase workflow, which the
  // designer is free to rename, reorder or delete entirely.
  const [stages, setStages] = useState(freshBlueprintPhases);

  // When edit mode opens, pre-fill from initialData
  useEffect(() => {
    if (open && isEditMode && initialData) {
      setMetadata({
        name: initialData.name || '',
        code: initialData.code || '',
        description: initialData.description || '',
        status: initialData.status || 'draft',
        isDefault: initialData.isDefault || false,
      });
      setStages(serverStagesToLocal(initialData.stages));
      setFieldErrors({});
      setValidationSummary([]);
    } else if (open && !isEditMode) {
      setMetadata(BLANK_META);
      setStages(freshBlueprintPhases());
      setFieldErrors({});
      setValidationSummary([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleMetadataChange = (key, value) => {
    setMetadata(prev => {
      const next = {
        ...prev,
        [key]: key === 'code' ? value.toUpperCase().replace(/[^A-Z0-9-]/g, '') : value,
      };
      // The server only lets a published template hold the default flag.
      if (key === 'status' && value !== 'published') next.isDefault = false;
      return next;
    });
    // Clear any meta-level errors when the user corrects the field
    const errorKey = `meta:${key}`;
    if (fieldErrors[errorKey]) setFieldErrors(p => { const n = { ...p }; delete n[errorKey]; return n; });
  };

  const handleAddStage = () => {
    const nextColorIndex = stages.length % CHART_COLORS.length;
    setStages(prev => [
      ...prev,
      {
        id: localId('stage'),
        name: '',
        description: '',
        ownerDepartment: 'expansion',
        slaDays: 7,
        color: CHART_COLORS[nextColorIndex],
        requiresApproval: false,
        approverRoles: [],
        masterDataSchema: [],
        tasks: [
          {
            id: localId('task'),
            title: '',
            description: '',
            department: 'expansion',
            estimatedDays: 1,
            priority: 'medium',
            assignees: [],
            primaryAssignee: '',
            backupAssignee: '',
            checklist: [],
          }
        ]
      }
    ]);
  };

  const handleRemoveStage = (stageId) => {
    setStages(prev => prev.filter(s => s.id !== stageId));
  };

  const handleStageFieldChange = (stageId, field, value) => {
    setStages(prev => prev.map(s => {
      if (s.id !== stageId) return s;
      const updated = { ...s, [field]: value };
      // When the stage department changes, reset all task departments + clear assignees
      if (field === 'ownerDepartment') {
        updated.tasks = s.tasks.map(t => ({
          ...t,
          department: value,
          assignees: [],
          primaryAssignee: '',
          backupAssignee: '',
        }));
      }
      return updated;
    }));
  };

  const handleApproverRoleToggle = (stageId, role) => {
    setStages(prev => prev.map(s => {
      if (s.id !== stageId) return s;
      const currentRoles = s.approverRoles || [];
      const newRoles = currentRoles.includes(role)
        ? currentRoles.filter(r => r !== role)
        : [...currentRoles, role];
      return { ...s, approverRoles: newRoles };
    }));
  };

  const handleMoveStage = (index, direction) => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === stages.length - 1) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    const newStages = [...stages];
    const temp = newStages[index];
    newStages[index] = newStages[targetIndex];
    newStages[targetIndex] = temp;
    setStages(newStages);
  };

  const handleAddTask = (stageId) => {
    setStages(prev => prev.map(s => {
      if (s.id !== stageId) return s;
      return {
        ...s,
        tasks: [
          ...s.tasks,
          {
            id: localId('task'),
            title: '',
            description: '',
            department: s.ownerDepartment || 'expansion',
            estimatedDays: 1,
            priority: 'medium',
            assignees: [],
            primaryAssignee: '',
            backupAssignee: '',
            checklist: [],
          }
        ]
      };
    }));
  };

  const handlePrimaryAssigneeChange = (stageId, taskId, empId) => {
    setStages(prev => prev.map(s => {
      if (s.id !== stageId) return s;
      return {
        ...s,
        tasks: s.tasks.map(t => {
          if (t.id !== taskId) return t;
          const nextBackup = t.backupAssignee === empId ? '' : t.backupAssignee;
          return {
            ...t,
            primaryAssignee: empId,
            backupAssignee: nextBackup,
            assignees: [empId, nextBackup].filter(Boolean)
          };
        }),
      };
    }));
  };

  const handleBackupAssigneeChange = (stageId, taskId, empId) => {
    setStages(prev => prev.map(s => {
      if (s.id !== stageId) return s;
      return {
        ...s,
        tasks: s.tasks.map(t => {
          if (t.id !== taskId) return t;
          return {
            ...t,
            backupAssignee: empId,
            assignees: [t.primaryAssignee, empId].filter(Boolean)
          };
        }),
      };
    }));
  };

  const handleRemoveTask = (stageId, taskId) => {
    setStages(prev => prev.map(s => {
      if (s.id !== stageId) return s;
      return {
        ...s,
        tasks: s.tasks.filter(t => t.id !== taskId)
      };
    }));
  };

  /* ── Checklist rows (nested under a task) ─────────────────────────────── */

  /** Apply `fn` to one task's checklist array, leaving every other task alone. */
  const updateChecklist = (stageId, taskId, fn) => {
    setStages(prev => prev.map(s => {
      if (s.id !== stageId) return s;
      return {
        ...s,
        tasks: s.tasks.map(t =>
          t.id === taskId ? { ...t, checklist: fn(t.checklist || []) } : t
        ),
      };
    }));
  };

  const handleAddChecklistItem = (stageId, taskId) =>
    updateChecklist(stageId, taskId, (list) => [
      ...list,
      { cid: localId('chk'), label: '', required: false },
    ]);

  const handleRemoveChecklistItem = (stageId, taskId, cid) =>
    updateChecklist(stageId, taskId, (list) => list.filter(c => c.cid !== cid));

  const handleChecklistFieldChange = (stageId, taskId, cid, field, value) =>
    updateChecklist(stageId, taskId, (list) =>
      list.map(c => (c.cid === cid ? { ...c, [field]: value } : c))
    );

  const handleTaskFieldChange = (stageId, taskId, field, value) => {
    setStages(prev => prev.map(s => {
      if (s.id !== stageId) return s;
      return {
        ...s,
        tasks: s.tasks.map(t => {
          if (t.id !== taskId) return t;
          // Changing a task's department clears its assignees (they may not belong to new dept)
          if (field === 'department') {
            return {
              ...t,
              department: value,
              assignees: [],
              primaryAssignee: '',
              backupAssignee: '',
            };
          }
          return { ...t, [field]: value };
        })
      };
    }));
  };

  const handleMoveTask = (stageIndex, taskIndex, direction) => {
    const stage = stages[stageIndex];
    const tasks = stage.tasks;
    if (direction === 'up' && taskIndex === 0) return;
    if (direction === 'down' && taskIndex === tasks.length - 1) return;
    const targetIndex = direction === 'up' ? taskIndex - 1 : taskIndex + 1;
    const newTasks = [...tasks];
    const temp = newTasks[taskIndex];
    newTasks[taskIndex] = newTasks[targetIndex];
    newTasks[targetIndex] = temp;

    setStages(prev => prev.map((s, idx) => {
      if (idx !== stageIndex) return s;
      return { ...s, tasks: newTasks };
    }));
  };

  const generateCodeFromName = () => {
    if (!metadata.name) return;
    const generated = 'MR-' + metadata.name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    setMetadata(prev => ({ ...prev, code: generated }));
  };

  const validateAndSubmit = async (e) => {
    e.preventDefault();
    setFieldErrors({});
    setValidationSummary([]);
    firstErrorRef.current = null;

    const errors = {}; // { key: msg }
    const summary = [];

    const addError = (key, label, msg) => {
      errors[key] = msg;
      summary.push({ key, label, msg });
    };

    // ── Metadata checks ──────────────────────────────────────────────────────
    if (!metadata.name || metadata.name.trim().length < 2)
      addError('meta:name', 'Template Name', 'Required (min 2 characters).');
    if (!metadata.code || metadata.code.trim().length < 2)
      addError('meta:code', 'Template Code', 'Required (min 2 characters).');
    if (stages.length === 0)
      addError('meta:stages', 'Stages', 'At least 1 Stage is required.');

    // ── Per-stage / per-task checks ───────────────────────────────────────────
    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i];
      const stageLabel = stage.name?.trim() ? `Stage "${stage.name.trim()}"` : `Stage #${i + 1}`;

      if (!stage.name || !stage.name.trim())
        addError(`${stage.id}::name`, `${stageLabel}`, 'Stage title is required.');

      if (stage.tasks.length === 0)
        addError(`${stage.id}::tasks`, stageLabel, 'Requires at least 1 task.');

      for (let j = 0; j < stage.tasks.length; j++) {
        const task = stage.tasks[j];
        const taskLabel = task.title?.trim() ? `Task "${task.title.trim()}"` : `Task #${j + 1}`;
        const prefix = `${stage.id}:${task.id}`;

        if (!task.title || !task.title.trim())
          addError(`${prefix}:title`, `${stageLabel} → ${taskLabel}`, 'Task title is required.');

        if (task.primaryAssignee && task.backupAssignee && task.primaryAssignee === task.backupAssignee)
          addError(`${prefix}:backupAssignee`, `${stageLabel} → ${taskLabel}`, 'Primary and Backup assignee cannot be the same person.');

        // A blank checklist label would be rejected server-side with an opaque path.
        const blankRows = (task.checklist || []).filter(c => !c.label.trim()).length;
        if (blankRows > 0)
          addError(`${prefix}:checklist`, `${stageLabel} → ${taskLabel}`,
            `${blankRows} checklist item${blankRows > 1 ? 's have' : ' has'} no label — name or remove ${blankRows > 1 ? 'them' : 'it'}.`);
      }
    }

    if (summary.length > 0) {
      setFieldErrors(errors);
      setValidationSummary(summary);
      // Auto-scroll: find the first element with a data-error-key attr
      setTimeout(() => {
        const firstEl = document.querySelector(`[data-error-key="${summary[0].key}"]`);
        if (firstEl) firstEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 50);
      return;
    }

    // ── Format payload ────────────────────────────────────────────────────────
    // `stage.id` / `task.id` ARE the server keys: reusing them means an edit
    // renames nothing, so checklists and task dependencies survive the round-trip.
    const formattedStages = stages.map((stage, idx) => ({
      key: stage.id,
      name: stage.name.trim(),
      description: (stage.description || '').trim(),
      order: idx,
      color: stage.color,
      slaDays: Number(stage.slaDays) || 0,
      ownerDepartment: stage.ownerDepartment,
      requiresApproval: stage.requiresApproval || false,
      approverRoles: stage.requiresApproval ? stage.approverRoles || [] : [],
      tasks: stage.tasks.map((task, tIdx) => {
        const dept = task.department || stage.ownerDepartment;
        const primId = task.primaryAssignee || undefined;   // strip empty string → undefined (omitted from JSON)
        const backId = task.backupAssignee || undefined;
        const primEmp = primId ? getEmployeeById(primId) : null;
        // Flags the task for reassignment the moment the project is created.
        const primUnavailable = primEmp ? primEmp.availability?.status !== 'available' : false;
        return {
          key: task.id,
          title: task.title.trim(),
          description: (task.description || '').trim(),
          order: tIdx,
          department: dept,
          estimatedDays: Number(task.estimatedDays) || 0,
          priority: task.priority || 'medium',
          assignees: [primId, backId].filter(Boolean),
          ...(primId ? { primaryAssignee: primId } : {}),
          ...(backId ? { backupAssignee: backId } : {}),
          primaryAssigneeUnavailable: primUnavailable,
          dependencies: task.dependencies || [],
          checklist: (task.checklist || [])
            .filter(c => c.label.trim())
            .map((c, cIdx) => ({ label: c.label.trim(), required: !!c.required, order: cIdx })),
        };
      }),
      masterDataSchema: stage.masterDataSchema || [],
    }));

    const body = {
      name: metadata.name.trim(),
      code: metadata.code.trim(),
      description: metadata.description.trim(),
      status: metadata.status,
      isDefault: !!metadata.isDefault && metadata.status === 'published',
      category: 'Store Launch',
      icon: 'Rocket',
      color: stages[0]?.color || '#6E45FF',
      stages: formattedStages,
    };

    try {
      await mutation.mutateAsync(body);
      if (!isEditMode) {
        setMetadata(BLANK_META);
        setStages(freshBlueprintPhases());
      }
      setFieldErrors({});
      setValidationSummary([]);
      onSuccess?.(body.name, isEditMode);
      onClose();
    } catch (err) {
      // Decode server validation errors (Zod shape: { details: [{field, message}] })
      const serverData = err.response?.data;
      if (serverData?.details && Array.isArray(serverData.details) && serverData.details.length > 0) {
        const decoded = serverData.details.map((d, i) => ({
          key: `server-${i}`,
          label: d.field ? `Field: ${d.field}` : 'Validation',
          msg: d.message || String(d),
        }));
        setValidationSummary(decoded);
      } else {
        const msg = serverData?.message || err.message
          || (isEditMode ? 'Failed to update template.' : 'Failed to create template.');
        setValidationSummary([{ key: 'server-0', label: 'Server error', msg }]);
      }
    }
  };

  const handleClose = () => {
    setFieldErrors({});
    setValidationSummary([]);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={isEditMode ? 'Edit Template' : 'Create Template'}
      subtitle={isEditMode ? `Editing "${metadata.name || initialData?.name}"` : 'Define a reusable playbook — phases, tasks, checklists, doers and backup buddies'}
      width={780}
      footer={
        <>
          <button className="btn btn-ghost" onClick={handleClose} disabled={mutation.isPending}>Cancel</button>
          <button className="btn btn-primary" onClick={validateAndSubmit} disabled={mutation.isPending}>
            {mutation.isPending ? <span className="spinner" /> : (isEditMode ? 'Save Changes' : 'Save Template')}
          </button>
        </>
      }
    >
      <form onSubmit={validateAndSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>

        {/* Template Basic Info */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
          <div className="field">
            <label className="label">Template Name *</label>
            <input
              data-error-key="meta:name"
              className="input"
              value={metadata.name}
              onChange={(e) => handleMetadataChange('name', e.target.value)}
              placeholder="e.g. Franchise Outlet Launch"
              style={fieldErrors['meta:name'] ? { borderColor: 'var(--danger)' } : {}}
              required
            />
            {fieldErrors['meta:name'] && (
              <span style={{ fontSize: 11, color: 'var(--danger)', marginTop: 3, display: 'block' }}>
                {fieldErrors['meta:name']}
              </span>
            )}
          </div>
          <div className="field">
            <label className="label">
              Template Code *
              {metadata.name && !metadata.code && (
                <button
                  type="button"
                  onClick={generateCodeFromName}
                  className="sm"
                  style={{ color: 'var(--primary)', border: 'none', background: 'none', marginLeft: 'auto', cursor: 'pointer', float: 'right', fontWeight: 500 }}
                >
                  Auto-fill
                </button>
              )}
            </label>
            <input
              data-error-key="meta:code"
              className="input"
              value={metadata.code}
              onChange={(e) => handleMetadataChange('code', e.target.value)}
              placeholder="e.g. MR-FRANCHISE-LAUNCH"
              style={fieldErrors['meta:code'] ? { borderColor: 'var(--danger)' } : {}}
              required
            />
            {fieldErrors['meta:code'] && (
              <span style={{ fontSize: 11, color: 'var(--danger)', marginTop: 3, display: 'block' }}>
                {fieldErrors['meta:code']}
              </span>
            )}
          </div>
        </div>

        <div className="field">
          <label className="label">Description</label>
          <textarea
            className="textarea"
            value={metadata.description}
            onChange={(e) => handleMetadataChange('description', e.target.value)}
            placeholder="Describe the target audience, context, or triggers for this playbook..."
            rows={2}
          />
        </div>

        <div className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 'var(--space-3)' }}>
          <label className="label" style={{ margin: 0 }}>Template Status</label>
          <select
            className="select"
            value={metadata.status}
            onChange={(e) => handleMetadataChange('status', e.target.value)}
            style={{ width: 'auto', minWidth: 150 }}
          >
            <option value="draft">Draft</option>
            <option value="published">Published</option>
          </select>
          <span className="sm muted" style={{ marginLeft: 'var(--space-1)' }}>
            {metadata.status === 'published'
              ? 'Published playbooks can be selected to spin up live projects.'
              : 'Draft playbooks cannot be selected to create projects.'}
          </span>
        </div>

        {/* Default playbook — the one a new project starts from. */}
        <label
          htmlFor="template-default-toggle"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 12px',
            background: metadata.isDefault ? 'var(--warning-soft)' : 'var(--surface-2)',
            border: `1px solid ${metadata.isDefault ? 'var(--primary)' : 'var(--border)'}`,
            borderRadius: 'var(--radius-sm)',
            cursor: metadata.status === 'published' ? 'pointer' : 'not-allowed',
            opacity: metadata.status === 'published' ? 1 : 0.55,
            transition: 'var(--transition)',
          }}
        >
          <input
            id="template-default-toggle"
            type="checkbox"
            checked={metadata.isDefault}
            disabled={metadata.status !== 'published'}
            onChange={(e) => handleMetadataChange('isDefault', e.target.checked)}
            style={{ width: 15, height: 15, cursor: 'inherit' }}
          />
          <Star
            size={15}
            style={{ color: metadata.isDefault ? 'var(--primary)' : 'var(--text-subtle)' }}
            fill={metadata.isDefault ? 'var(--primary)' : 'none'}
          />
          <span className="col" style={{ gap: 1 }}>
            <span style={{ fontWeight: 650, fontSize: 12.5 }}>Use as the default template</span>
            <span className="tiny muted">
              {metadata.status !== 'published'
                ? 'Publish this template first — only a published playbook can be the default.'
                : 'New projects start from this playbook, and its tasks are assigned automatically. Any template currently marked default will be replaced.'}
            </span>
          </span>
        </label>

        <hr className="divider" style={{ margin: 'var(--space-2) 0' }} />

        {/* Stages Builder */}
        <div className="col gap-3">
          <div className="row between">
            <span className="eyebrow row gap-2" style={{ color: 'var(--text)' }}>
              <Layers size={14} className="subtle" /> Playbook Phases
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-sm row gap-1"
              onClick={handleAddStage}
            >
              <Plus size={14} /> Add Phase
            </button>
          </div>

          {stages.length === 0 ? (
            <div className="center subtle" style={{ padding: 'var(--space-6)', border: '1px dashed var(--border)', borderRadius: 'var(--radius)' }}>
              No phases added yet. Click 'Add Phase' above.
            </div>
          ) : (
            <div className="col gap-4">
              {stages.map((stage, sIdx) => (
                <div key={stage.id} className="card card-pad" style={{ background: 'var(--surface-2)', borderColor: 'var(--border-strong)' }}>

                  {/* Stage Header Line */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
                      <div className="row gap-2 grow">
                        <span style={{
                          width: 26,
                          height: 26,
                          borderRadius: '50%',
                          display: 'grid',
                          placeItems: 'center',
                          background: `${stage.color}22`,
                          color: stage.color,
                          fontWeight: 700,
                          fontSize: 12
                        }}>
                          {sIdx + 1}
                        </span>
                        <input
                          data-error-key={`${stage.id}::name`}
                          className="input"
                          value={stage.name}
                          onChange={(e) => handleStageFieldChange(stage.id, 'name', e.target.value)}
                          placeholder="Phase Title (e.g. Property Identification)"
                          style={{ fontWeight: 650, flexGrow: 1, ...(fieldErrors[`${stage.id}::name`] ? { borderColor: 'var(--danger)' } : {}) }}
                        />
                      </div>

                      {/* Reordering & deleting actions */}
                      <div className="row gap-1">
                        <button
                          type="button"
                          className="btn btn-ghost btn-icon btn-sm"
                          onClick={() => handleMoveStage(sIdx, 'up')}
                          disabled={sIdx === 0}
                          title="Move Up"
                        >
                          <ArrowUp size={13} />
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-icon btn-sm"
                          onClick={() => handleMoveStage(sIdx, 'down')}
                          disabled={sIdx === stages.length - 1}
                          title="Move Down"
                        >
                          <ArrowDown size={13} />
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-icon btn-sm"
                          onClick={() => handleRemoveStage(stage.id)}
                          style={{ color: 'var(--danger)' }}
                          title="Remove Stage"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>

                    <input
                      className="input"
                      value={stage.description || ''}
                      onChange={(e) => handleStageFieldChange(stage.id, 'description', e.target.value)}
                      placeholder="What happens in this phase? (optional)"
                      style={{ fontSize: 11.5, padding: '5px 10px', color: 'var(--text-muted)' }}
                    />

                    {/* Stage settings line */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr auto', gap: 'var(--space-4)', alignItems: 'center' }}>
                      <div className="field" style={{ margin: 0 }}>
                        <label className="label tiny">Owner Department *</label>
                        <select
                          className="select"
                          value={stage.ownerDepartment}
                          onChange={(e) => handleStageFieldChange(stage.id, 'ownerDepartment', e.target.value)}
                        >
                          {Object.entries(DEPT_META).map(([k, label]) => (
                            <option key={k} value={k}>{label}</option>
                          ))}
                        </select>
                      </div>

                      <div className="field" style={{ margin: 0 }}>
                        <label className="label tiny">SLA Days *</label>
                        <NumberInput
                          className="input"
                          min={0}
                          value={stage.slaDays}
                          onChange={(e) => handleStageFieldChange(stage.id, 'slaDays', e.target.value)}
                          placeholder="e.g. 7"
                        />
                      </div>

                      {/* Predefined Colors dot selection */}
                      <div className="col gap-1">
                        <label className="label tiny">Stage Accent Color</label>
                        <div className="row gap-1">
                          {CHART_COLORS.map((c) => (
                            <button
                              key={c}
                              type="button"
                              onClick={() => handleStageFieldChange(stage.id, 'color', c)}
                              style={{
                                width: 14,
                                height: 14,
                                borderRadius: '50%',
                                background: c,
                                border: stage.color === c ? '2px solid var(--text)' : '1px solid transparent',
                                cursor: 'pointer',
                                padding: 0,
                                boxSizing: 'content-box'
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Approval Workflow Gating Option */}
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 'var(--space-2)',
                        padding: '10px 12px',
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)',
                        marginTop: 'var(--space-1)'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                        <input
                          type="checkbox"
                          id={`approval-checkbox-${stage.id}`}
                          checked={stage.requiresApproval || false}
                          onChange={(e) => handleStageFieldChange(stage.id, 'requiresApproval', e.target.checked)}
                          style={{ cursor: 'pointer', width: 15, height: 15 }}
                        />
                        <label
                          htmlFor={`approval-checkbox-${stage.id}`}
                          style={{ fontWeight: 600, fontSize: '12.5px', color: 'var(--text)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
                        >
                          <ShieldCheck size={14} className="subtle" /> Requires approval for stage progression
                        </label>
                      </div>

                      {stage.requiresApproval && (
                        <div className="row gap-4" style={{ paddingLeft: 'var(--space-5)', paddingTop: 'var(--space-1)' }}>
                          <span className="tiny subtle" style={{ fontWeight: 650 }}>APPROVER ROLES:</span>

                          <label className="row gap-1.5 tiny pointer" style={{ cursor: 'pointer', userSelect: 'none' }}>
                            <input
                              type="checkbox"
                              checked={stage.approverRoles?.includes('Department Head') || false}
                              onChange={() => handleApproverRoleToggle(stage.id, 'Department Head')}
                              style={{ width: 13, height: 13 }}
                            />
                            Department Head
                          </label>

                          <label className="row gap-1.5 tiny pointer" style={{ cursor: 'pointer', userSelect: 'none' }}>
                            <input
                              type="checkbox"
                              checked={stage.approverRoles?.includes('Management') || false}
                              onChange={() => handleApproverRoleToggle(stage.id, 'Management')}
                              style={{ width: 13, height: 13 }}
                            />
                            Management
                          </label>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Tasks nested inside Stage */}
                  <div style={{ marginTop: 'var(--space-4)', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--border)' }}>
                    <div className="row between" style={{ marginBottom: 'var(--space-2)' }}>
                      <span className="eyebrow tiny row gap-1" style={{ color: 'var(--text-muted)' }}>
                        <ListChecks size={12} className="subtle" /> Phase Tasks ({stage.tasks.length})
                      </span>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ padding: '2px 8px', fontSize: 11 }}
                        onClick={() => handleAddTask(stage.id)}
                      >
                        <Plus size={11} /> Add Task
                      </button>
                    </div>

                    {stage.tasks.length === 0 ? (
                      <div className="sm muted center" style={{ padding: 'var(--space-3)', background: 'var(--surface-hover)', borderRadius: 'var(--radius)' }}>
                        No tasks in this stage yet. A template stage must have at least one task.
                      </div>
                    ) : (
                      <div className="col gap-2">
                        {stage.tasks.map((task, tIdx) => (
                          <div
                            key={task.id}
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 6,
                              background: 'var(--surface)',
                              padding: '8px 10px',
                              borderRadius: 'var(--radius-sm)',
                              border: '1px solid var(--border)'
                            }}
                          >
                            {/* Row 1: Title / Days / Priority / Actions */}
                            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <input
                                  data-error-key={`${stage.id}:${task.id}:title`}
                                  className={`input${fieldErrors[`${stage.id}:${task.id}:title`] ? ' input-error' : ''}`}
                                  value={task.title}
                                  onChange={(e) => {
                                    handleTaskFieldChange(stage.id, task.id, 'title', e.target.value);
                                    if (fieldErrors[`${stage.id}:${task.id}:title`]) setFieldErrors(p => { const n = { ...p }; delete n[`${stage.id}:${task.id}:title`]; return n; });
                                  }}
                                  placeholder={`Task #${tIdx + 1} Title (e.g. Draft agreement)`}
                                  style={{ fontSize: '12.5px', padding: '6px 10px', width: '100%', boxSizing: 'border-box', ...(fieldErrors[`${stage.id}:${task.id}:title`] ? { borderColor: 'var(--danger)' } : {}) }}
                                />
                                {fieldErrors[`${stage.id}:${task.id}:title`] && (
                                  <span style={{ fontSize: 10, color: 'var(--danger)', marginTop: 2, display: 'block' }}>
                                    {fieldErrors[`${stage.id}:${task.id}:title`]}
                                  </span>
                                )}
                              </div>

                              <NumberInput
                                className="input"
                                min={0}
                                value={task.estimatedDays}
                                onChange={(e) => handleTaskFieldChange(stage.id, task.id, 'estimatedDays', e.target.value)}
                                placeholder="Days"
                                style={{ width: 68, fontSize: '12.5px', padding: '6px 8px' }}
                                title="Estimated duration in days"
                              />

                              <select
                                className="select"
                                value={task.priority}
                                onChange={(e) => handleTaskFieldChange(stage.id, task.id, 'priority', e.target.value)}
                                style={{ width: 84, fontSize: '12.5px', padding: '6px 8px' }}
                              >
                                <option value="low">Low</option>
                                <option value="medium">Medium</option>
                                <option value="high">High</option>
                                <option value="critical">Critical</option>
                              </select>

                              {/* Task Actions */}
                              <div className="row gap-0.5" style={{ flexShrink: 0 }}>
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-icon"
                                  style={{ padding: 4 }}
                                  onClick={() => handleMoveTask(sIdx, tIdx, 'up')}
                                  disabled={tIdx === 0}
                                  title="Move Task Up"
                                >
                                  <ArrowUp size={11} />
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-icon"
                                  style={{ padding: 4 }}
                                  onClick={() => handleMoveTask(sIdx, tIdx, 'down')}
                                  disabled={tIdx === stage.tasks.length - 1}
                                  title="Move Task Down"
                                >
                                  <ArrowDown size={11} />
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-icon"
                                  style={{ padding: 4, color: 'var(--danger)' }}
                                  onClick={() => handleRemoveTask(stage.id, task.id)}
                                  title="Delete Task"
                                >
                                  <Trash2 size={11} />
                                </button>
                              </div>
                            </div>

                            {/* Row 2: Task Department + Assignees (fully dependent) */}
                            <div style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 12,
                              paddingTop: 6,
                              borderTop: '1px solid var(--border)',
                              flexWrap: 'wrap',
                            }}>
                              {/* Step 1 – per-task department selector */}
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ fontSize: 11, fontWeight: 650, color: 'var(--text-subtle)', textTransform: 'uppercase' }}>Dept</span>
                                <select
                                  className="select"
                                  value={task.department || stage.ownerDepartment}
                                  onChange={(e) => handleTaskFieldChange(stage.id, task.id, 'department', e.target.value)}
                                  style={{
                                    width: 120,
                                    fontSize: 11.5,
                                    padding: '4px 8px',
                                    height: 28,
                                    color: 'var(--text-subtle)',
                                    fontWeight: 600,
                                  }}
                                >
                                  {Object.entries(DEPT_META).map(([k, label]) => (
                                    <option key={k} value={k}>{label}</option>
                                  ))}
                                </select>
                              </div>

                              {/* Doer — the person who owns this task */}
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span title="Primary doer — owns this task" style={{ fontSize: 11, fontWeight: 650, color: 'var(--text-subtle)', textTransform: 'uppercase' }}>Doer</span>
                                <SingleAssigneeDropdown
                                  department={task.department || stage.ownerDepartment}
                                  selectedId={task.primaryAssignee}
                                  onChange={(empId) => handlePrimaryAssigneeChange(stage.id, task.id, empId)}
                                  placeholder="Select Doer"
                                />
                              </div>

                              {/* Buddy — the backup who picks the task up when the doer can't */}
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                <div
                                  data-error-key={`${stage.id}:${task.id}:backupAssignee`}
                                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                                >
                                  <span title="Backup buddy — takes over when the doer is unavailable" style={{ fontSize: 11, fontWeight: 650, color: fieldErrors[`${stage.id}:${task.id}:backupAssignee`] ? 'var(--danger)' : 'var(--text-subtle)', textTransform: 'uppercase' }}>Buddy</span>
                                  <SingleAssigneeDropdown
                                    department={task.department || stage.ownerDepartment}
                                    selectedId={task.backupAssignee}
                                    onChange={(empId) => {
                                      handleBackupAssigneeChange(stage.id, task.id, empId);
                                      if (fieldErrors[`${stage.id}:${task.id}:backupAssignee`]) setFieldErrors(p => { const n = { ...p }; delete n[`${stage.id}:${task.id}:backupAssignee`]; return n; });
                                    }}
                                    placeholder="Select Buddy"
                                    excludeId={task.primaryAssignee}
                                    hasError={!!fieldErrors[`${stage.id}:${task.id}:backupAssignee`]}
                                  />
                                </div>
                                {fieldErrors[`${stage.id}:${task.id}:backupAssignee`] && (
                                  <span style={{ fontSize: 10, color: 'var(--danger)', display: 'block', marginLeft: 42 }}>
                                    {fieldErrors[`${stage.id}:${task.id}:backupAssignee`]}
                                  </span>
                                )}
                              </div>

                              {/* Warnings & Alerts */}
                              {task.primaryAssignee && (() => {
                                const prim = getEmployeeById(task.primaryAssignee);
                                if (!prim || prim.availability?.status === 'available') return null;
                                const onLeave = prim.availability?.status === 'on_leave';
                                const buddy = task.backupAssignee ? getEmployeeById(task.backupAssignee) : null;
                                return (
                                  <span style={{
                                    fontSize: 10.5,
                                    color: onLeave ? 'var(--danger)' : 'var(--warning)',
                                    background: onLeave ? 'var(--danger-soft)' : 'var(--warning-soft)',
                                    padding: '2px 8px',
                                    borderRadius: 4,
                                    fontWeight: 600,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 4
                                  }}>
                                    ⚠️ {prim.name} is {onLeave ? 'On Leave' : 'Busy'} ({prim.availability?.reason}).{' '}
                                    {buddy
                                      ? `${buddy.name} will be flagged to take over.`
                                      : 'Assign a Buddy to cover this task.'}
                                  </span>
                                );
                              })()}
                            </div>

                            {/* Row 3: Checklist — the steps that must be ticked to finish this task */}
                            <div style={{ paddingTop: 6, borderTop: '1px solid var(--border)' }}>
                              <div className="row between" style={{ marginBottom: (task.checklist?.length || 0) ? 6 : 0 }}>
                                <span
                                  data-error-key={`${stage.id}:${task.id}:checklist`}
                                  className="row gap-1"
                                  style={{
                                    fontSize: 11,
                                    fontWeight: 650,
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.04em',
                                    color: fieldErrors[`${stage.id}:${task.id}:checklist`] ? 'var(--danger)' : 'var(--text-subtle)',
                                  }}
                                >
                                  <CheckSquare size={12} />
                                  Checklist
                                  {(task.checklist?.length || 0) > 0 && (
                                    <span className="subtle" style={{ fontWeight: 600 }}>({task.checklist.length})</span>
                                  )}
                                </span>
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-sm"
                                  style={{ padding: '2px 8px', fontSize: 10.5 }}
                                  onClick={() => handleAddChecklistItem(stage.id, task.id)}
                                >
                                  <Plus size={10} /> Add Item
                                </button>
                              </div>

                              {(task.checklist?.length || 0) === 0 ? (
                                <div className="tiny subtle" style={{ paddingBottom: 2 }}>
                                  No checklist yet — add the steps a doer must tick off to complete this task.
                                </div>
                              ) : (
                                <div className="col gap-1">
                                  {task.checklist.map((item, cIdx) => (
                                    <div key={item.cid} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                      <span className="tiny subtle" style={{ width: 14, flexShrink: 0, textAlign: 'right' }}>
                                        {cIdx + 1}.
                                      </span>
                                      <input
                                        className="input"
                                        value={item.label}
                                        onChange={(e) => {
                                          handleChecklistFieldChange(stage.id, task.id, item.cid, 'label', e.target.value);
                                          if (fieldErrors[`${stage.id}:${task.id}:checklist`]) setFieldErrors(p => { const n = { ...p }; delete n[`${stage.id}:${task.id}:checklist`]; return n; });
                                        }}
                                        placeholder="e.g. Fire NOC received"
                                        style={{
                                          flex: 1,
                                          fontSize: 11.5,
                                          padding: '4px 8px',
                                          height: 26,
                                          ...(fieldErrors[`${stage.id}:${task.id}:checklist`] && !item.label.trim()
                                            ? { borderColor: 'var(--danger)' }
                                            : {}),
                                        }}
                                      />
                                      <label
                                        title="Mandatory — the task cannot be completed until this item is ticked"
                                        style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', userSelect: 'none', flexShrink: 0 }}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={!!item.required}
                                          onChange={(e) => handleChecklistFieldChange(stage.id, task.id, item.cid, 'required', e.target.checked)}
                                          style={{ width: 12, height: 12, cursor: 'pointer' }}
                                        />
                                        <span style={{ fontSize: 10, fontWeight: 600, color: item.required ? 'var(--danger)' : 'var(--text-subtle)' }}>
                                          Mandatory
                                        </span>
                                      </label>
                                      <button
                                        type="button"
                                        className="btn btn-ghost btn-icon"
                                        style={{ padding: 3, color: 'var(--danger)', flexShrink: 0 }}
                                        onClick={() => handleRemoveChecklistItem(stage.id, task.id, item.cid)}
                                        title="Remove checklist item"
                                      >
                                        <Trash2 size={10} />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {fieldErrors[`${stage.id}:${task.id}:checklist`] && (
                                <span style={{ fontSize: 10, color: 'var(--danger)', display: 'block', marginTop: 3 }}>
                                  {fieldErrors[`${stage.id}:${task.id}:checklist`]}
                                </span>
                              )}
                            </div>
                          </div>

                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Dynamic Summary Panel */}
        <div style={{
          background: 'var(--surface-hover)',
          padding: 'var(--space-3)',
          borderRadius: 'var(--radius)',
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 'var(--space-3)',
          textAlign: 'center',
          border: '1px solid var(--border)'
        }}>
          <div className="col center">
            <span className="row gap-1 tiny subtle"><Layers size={12} /> Phases</span>
            <span style={{ fontWeight: 700 }}>{stages.length}</span>
          </div>
          <div className="col center">
            <span className="row gap-1 tiny subtle"><ListChecks size={12} /> Total Tasks</span>
            <span style={{ fontWeight: 700 }}>{stages.reduce((sum, s) => sum + s.tasks.length, 0)}</span>
          </div>
          <div className="col center">
            <span className="row gap-1 tiny subtle"><CheckSquare size={12} /> Checklist Items</span>
            <span style={{ fontWeight: 700 }}>
              {stages.reduce((sum, s) => sum + s.tasks.reduce((n, t) => n + (t.checklist?.length || 0), 0), 0)}
            </span>
          </div>
          <div className="col center">
            <span className="row gap-1 tiny subtle"><Clock size={12} /> Total SLA Duration</span>
            <span style={{ fontWeight: 700 }}>{stages.reduce((sum, s) => sum + (Number(s.slaDays) || 0), 0)} days</span>
          </div>
        </div>

        {/* Validation summary — shown when any errors exist */}
        {validationSummary.length > 0 && (
          <div
            role="alert"
            style={{
              background: 'var(--danger-soft)',
              border: '1px solid var(--danger)',
              borderRadius: 'var(--radius-sm)',
              padding: '10px 14px',
              lineHeight: 1.6,
            }}
          >
            <div style={{ fontWeight: 700, color: 'var(--danger)', marginBottom: 6, fontSize: 13 }}>
              {validationSummary.some(e => e.key.startsWith('server'))
                ? '⚠️ Server rejected the template:'
                : `⚠️ Please fix ${validationSummary.length} issue${validationSummary.length > 1 ? 's' : ''} before saving:`}
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--danger)', fontSize: 12 }}>
              {validationSummary.map(({ key, label, msg }) => (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() => {
                      const el = document.querySelector(`[data-error-key="${key}"]`);
                      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--danger)', fontSize: 12, padding: 0,
                      textAlign: 'left', textDecoration: 'underline dotted'
                    }}
                  >
                    {label}: {msg}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </form>
    </Modal>
  );
}

export default CreateTemplateModal;
