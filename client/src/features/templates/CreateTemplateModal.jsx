import { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, ArrowUp, ArrowDown, Layers, ListChecks, Clock, ShieldCheck, ChevronDown, X, User } from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { useCreateTemplate, useUpdateTemplate } from '../../lib/queries.js';
import { EMPLOYEES_BY_DEPT, getEmployeeById } from '../../lib/employees.js';
import { DEPT_META, CHART_COLORS } from '../../lib/ui.js';

const DEFAULT_PMS_STAGES = [
  {
    id: 'stage-1-default',
    name: 'Broker property search',
    ownerDepartment: 'expansion',
    slaDays: 10,
    color: '#e0a13a',
    requiresApproval: false,
    approverRoles: [],
    tasks: [
      { id: 'task-1-1', title: 'Search properties', estimatedDays: 3, priority: 'high' },
      { id: 'task-1-2', title: 'Capture property details', estimatedDays: 2, priority: 'medium' },
      { id: 'task-1-3', title: 'Upload documents/photos', estimatedDays: 2, priority: 'medium' },
      { id: 'task-1-4', title: 'Shortlist/Reject decision', estimatedDays: 3, priority: 'high' }
    ]
  },
  {
    id: 'stage-2-default',
    name: 'Site Inspection',
    ownerDepartment: 'expansion',
    slaDays: 7,
    color: '#16a79a',
    requiresApproval: false,
    approverRoles: [],
    tasks: [
      { id: 'task-2-1', title: 'Feasibility assessment', estimatedDays: 2, priority: 'medium' },
      { id: 'task-2-2', title: 'Financial assessment', estimatedDays: 2, priority: 'high' },
      { id: 'task-2-3', title: 'Technical assessment', estimatedDays: 2, priority: 'medium' },
      { id: 'task-2-4', title: 'Operational assessment', estimatedDays: 1, priority: 'medium' }
    ]
  },
  {
    id: 'stage-3-default',
    name: 'Negotiation',
    ownerDepartment: 'legal',
    slaDays: 10,
    color: '#6366f1',
    requiresApproval: false,
    approverRoles: [],
    tasks: [
      { id: 'task-3-1', title: 'LOI', estimatedDays: 2, priority: 'high' },
      { id: 'task-3-2', title: 'Lease agreement', estimatedDays: 3, priority: 'high' },
      { id: 'task-3-3', title: 'Legal verification', estimatedDays: 2, priority: 'high' },
      { id: 'task-3-4', title: 'Deposits', estimatedDays: 1, priority: 'medium' },
      { id: 'task-3-5', title: 'NOC & approvals', estimatedDays: 2, priority: 'high' }
    ]
  },
  {
    id: 'stage-4-default',
    name: 'Agreement',
    ownerDepartment: 'projects',
    slaDays: 5,
    color: '#f43f5e',
    requiresApproval: false,
    approverRoles: [],
    tasks: [
      { id: 'task-4-1', title: 'Set budget', estimatedDays: 2, priority: 'high' },
      { id: 'task-4-2', title: 'Set target opening date', estimatedDays: 1, priority: 'medium' },
      { id: 'task-4-3', title: 'Assign project manager', estimatedDays: 2, priority: 'medium' }
    ]
  },
  {
    id: 'stage-5-default',
    name: 'Construction',
    ownerDepartment: 'operations',
    slaDays: 7,
    color: '#38bdf8',
    requiresApproval: false,
    approverRoles: [],
    tasks: [
      { id: 'task-5-1', title: 'Allocate Construction tasks', estimatedDays: 1, priority: 'medium' },
      { id: 'task-5-2', title: 'Allocate Interior tasks', estimatedDays: 1, priority: 'medium' },
      { id: 'task-5-3', title: 'Allocate Procurement tasks', estimatedDays: 1, priority: 'medium' },
      { id: 'task-5-4', title: 'Allocate Automation tasks', estimatedDays: 1, priority: 'medium' },
      { id: 'task-5-5', title: 'Allocate IT tasks', estimatedDays: 1, priority: 'medium' },
      { id: 'task-5-6', title: 'Allocate Marketing tasks', estimatedDays: 1, priority: 'medium' },
      { id: 'task-5-7', title: 'Allocate HR tasks', estimatedDays: 1, priority: 'medium' },
      { id: 'task-5-8', title: 'Allocate Finance tasks', estimatedDays: 1, priority: 'medium' },
      { id: 'task-5-9', title: 'Allocate Operations tasks', estimatedDays: 1, priority: 'medium' },
      { id: 'task-5-10', title: 'Allocate Legal tasks', estimatedDays: 1, priority: 'medium' }
    ]
  },
  {
    id: 'stage-6-default',
    name: 'Procurement',
    ownerDepartment: 'projects',
    slaDays: 30,
    color: '#10b981',
    requiresApproval: false,
    approverRoles: [],
    tasks: [
      { id: 'task-6-1', title: 'Track task status', estimatedDays: 10, priority: 'medium' },
      { id: 'task-6-2', title: 'Track progress %', estimatedDays: 5, priority: 'medium' },
      { id: 'task-6-3', title: 'Manage attachments', estimatedDays: 5, priority: 'low' },
      { id: 'task-6-4', title: 'Manage dependencies', estimatedDays: 5, priority: 'medium' },
      { id: 'task-6-5', title: 'Flag delays', estimatedDays: 5, priority: 'high' }
    ]
  },
  {
    id: 'stage-7-default',
    name: 'HR Hiring',
    ownerDepartment: 'operations',
    slaDays: 5,
    color: '#8b5cf6',
    requiresApproval: true,
    approverRoles: ['Department Head', 'Management'],
    tasks: [
      { id: 'task-7-1', title: 'Department approval', estimatedDays: 2, priority: 'high' },
      { id: 'task-7-2', title: 'Management approval', estimatedDays: 2, priority: 'critical' },
      { id: 'task-7-3', title: 'Stage progression sign-off', estimatedDays: 1, priority: 'high' }
    ]
  },
  {
    id: 'stage-8-default',
    name: 'Training',
    ownerDepartment: 'operations',
    slaDays: 7,
    color: '#ec4899',
    requiresApproval: false,
    approverRoles: [],
    tasks: [
      { id: 'task-8-1', title: 'Construction readiness', estimatedDays: 1, priority: 'high' },
      { id: 'task-8-2', title: 'Utilities check', estimatedDays: 1, priority: 'high' },
      { id: 'task-8-3', title: 'IT setup check', estimatedDays: 1, priority: 'high' },
      { id: 'task-8-4', title: 'Hiring complete', estimatedDays: 1, priority: 'medium' },
      { id: 'task-8-5', title: 'Training complete', estimatedDays: 1, priority: 'medium' },
      { id: 'task-8-6', title: 'Marketing readiness', estimatedDays: 1, priority: 'medium' },
      { id: 'task-8-7', title: 'Testing complete', estimatedDays: 1, priority: 'high' },
      { id: 'task-8-8', title: 'Inventory check', estimatedDays: 1, priority: 'high' },
      { id: 'task-8-9', title: 'Compliance check', estimatedDays: 1, priority: 'high' }
    ]
  },
  {
    id: 'stage-9-default',
    name: 'Soft Launch',
    ownerDepartment: 'marketing',
    slaDays: 5,
    color: '#e0a13a',
    requiresApproval: false,
    approverRoles: [],
    tasks: [
      { id: 'task-9-1', title: 'Go-live approval', estimatedDays: 2, priority: 'critical' },
      { id: 'task-9-2', title: 'Store opening', estimatedDays: 3, priority: 'high' }
    ]
  },
  {
    id: 'stage-10-default',
    name: 'Grand Opening',
    ownerDepartment: 'finance',
    slaDays: 5,
    color: '#16a79a',
    requiresApproval: false,
    approverRoles: [],
    tasks: [
      { id: 'task-10-1', title: 'Budget analysis', estimatedDays: 2, priority: 'medium' },
      { id: 'task-10-2', title: 'Delay analysis', estimatedDays: 1, priority: 'medium' },
      { id: 'task-10-3', title: 'Vendor performance review', estimatedDays: 1, priority: 'medium' },
      { id: 'task-10-4', title: 'Lessons learned documentation', estimatedDays: 1, priority: 'medium' }
    ]
  }
];

/** Convert a raw server stage array into the local UI shape the modal uses. */
function serverStagesToLocal(serverStages = []) {
  return [...serverStages]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((s) => ({
      id: s.key || `stage-${Math.random().toString(36).substr(2, 6)}`,
      name: s.name || '',
      ownerDepartment: s.ownerDepartment || 'expansion',
      slaDays: s.slaDays ?? 7,
      color: s.color || '#6E45FF',
      requiresApproval: s.requiresApproval || false,
      approverRoles: s.approverRoles || [],
      tasks: [...(s.tasks || [])]
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((t) => ({
          id: t.key || `task-${Math.random().toString(36).substr(2, 6)}`,
          title: t.title || '',
          department: t.department || s.ownerDepartment || 'expansion',
          estimatedDays: t.estimatedDays ?? 1,
          priority: t.priority || 'medium',
          assignees: t.assignees || [],
          primaryAssignee: t.primaryAssignee || '',
          backupAssignee: t.backupAssignee || '',
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
  
  const [metadata, setMetadata] = useState({
    name: '',
    code: '',
    description: '',
    status: 'draft',
  });

  const [stages, setStages] = useState(DEFAULT_PMS_STAGES);

  // When edit mode opens, pre-fill from initialData
  useEffect(() => {
    if (open && isEditMode && initialData) {
      setMetadata({
        name: initialData.name || '',
        code: initialData.code || '',
        description: initialData.description || '',
        status: initialData.status || 'draft',
      });
      setStages(serverStagesToLocal(initialData.stages));
      setFieldErrors({});
      setValidationSummary([]);
    } else if (open && !isEditMode) {
      setMetadata({ name: '', code: '', description: '', status: 'draft' });
      setStages(DEFAULT_PMS_STAGES);
      setFieldErrors({});
      setValidationSummary([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleMetadataChange = (key, value) => {
    setMetadata(prev => ({
      ...prev,
      [key]: key === 'code' ? value.toUpperCase().replace(/[^A-Z0-9-]/g, '') : value
    }));
    // Clear any meta-level errors when the user corrects the field
    const errorKey = `meta:${key}`;
    if (fieldErrors[errorKey]) setFieldErrors(p => { const n = {...p}; delete n[errorKey]; return n; });
  };

  const handleAddStage = () => {
    const nextColorIndex = stages.length % CHART_COLORS.length;
    setStages(prev => [
      ...prev,
      {
        id: `stage-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        name: '',
        ownerDepartment: 'expansion',
        slaDays: 7,
        color: CHART_COLORS[nextColorIndex],
        requiresApproval: false,
        approverRoles: [],
        tasks: [
          {
            id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            title: '',
            department: 'expansion',
            estimatedDays: 1,
            priority: 'medium',
            assignees: [],
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
            id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            title: '',
            department: s.ownerDepartment || 'expansion',
            estimatedDays: 1,
            priority: 'medium',
            assignees: [],
            primaryAssignee: '',
            backupAssignee: '',
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

    // ── Format payload (fixes: strip empty strings so Zod enum accepts them) ──
    const formattedStages = stages.map((stage, idx) => {
      const stageKey = `stage_${idx}_${Math.random().toString(36).substr(2, 4)}`;
      return {
        key: stageKey,
        name: stage.name.trim(),
        description: '',
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
          const primUnavailable = primEmp ? primEmp.availability?.status !== 'available' : false;
          return {
            key: `task_${idx}_${tIdx}_${Math.random().toString(36).substr(2, 4)}`,
            title: task.title.trim(),
            order: tIdx,
            department: dept,
            estimatedDays: Number(task.estimatedDays) || 0,
            priority: task.priority || 'medium',
            assignees: [primId, backId].filter(Boolean),
            ...(primId ? { primaryAssignee: primId } : {}),
            ...(backId ? { backupAssignee: backId } : {}),
            primaryAssigneeUnavailable: primUnavailable,
          };
        }),
        masterDataSchema: [],
      };
    });

    const body = {
      name: metadata.name.trim(),
      code: metadata.code.trim(),
      description: metadata.description.trim(),
      status: metadata.status,
      category: 'Franchise Launch',
      icon: 'Rocket',
      color: stages[0]?.color || '#6E45FF',
      stages: formattedStages,
    };

    try {
      await mutation.mutateAsync(body);
      if (!isEditMode) {
        setMetadata({ name: '', code: '', description: '', status: 'draft' });
        setStages(DEFAULT_PMS_STAGES);
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
      subtitle={isEditMode ? `Editing "${metadata.name || initialData?.name}"` : 'Define a reusable playbook with stage sequence and task SLAs'}
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

        <hr className="divider" style={{ margin: 'var(--space-2) 0' }} />

        {/* Stages Builder */}
        <div className="col gap-3">
          <div className="row between">
            <span className="eyebrow row gap-2" style={{ color: 'var(--text)' }}>
              <Layers size={14} className="subtle" /> Playbook Stages
            </span>
            <button 
              type="button" 
              className="btn btn-ghost btn-sm row gap-1"
              onClick={handleAddStage}
            >
              <Plus size={14} /> Add Stage
            </button>
          </div>

          {stages.length === 0 ? (
            <div className="center subtle" style={{ padding: 'var(--space-6)', border: '1px dashed var(--border)', borderRadius: 'var(--radius)' }}>
              No stages added yet. Click 'Add Stage' above.
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
                          className="input" 
                          value={stage.name} 
                          onChange={(e) => handleStageFieldChange(stage.id, 'name', e.target.value)} 
                          placeholder="Stage Title (e.g. Site Sourcing)" 
                          style={{ fontWeight: 650, flexGrow: 1 }}
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
                        <input 
                          className="input" 
                          type="number"
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
                        <ListChecks size={12} className="subtle" /> Stage Tasks ({stage.tasks.length})
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
                                    if (fieldErrors[`${stage.id}:${task.id}:title`]) setFieldErrors(p => { const n = {...p}; delete n[`${stage.id}:${task.id}:title`]; return n; });
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

                              <input
                                className="input"
                                type="number"
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

                              {/* Primary Assignee Selector */}
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ fontSize: 11, fontWeight: 650, color: 'var(--text-subtle)', textTransform: 'uppercase' }}>Primary</span>
                                <SingleAssigneeDropdown
                                  department={task.department || stage.ownerDepartment}
                                  selectedId={task.primaryAssignee}
                                  onChange={(empId) => handlePrimaryAssigneeChange(stage.id, task.id, empId)}
                                  placeholder="Select Primary"
                                />
                              </div>

                              {/* Backup Assignee Selector */}
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                <div
                                  data-error-key={`${stage.id}:${task.id}:backupAssignee`}
                                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                                >
                                  <span style={{ fontSize: 11, fontWeight: 650, color: fieldErrors[`${stage.id}:${task.id}:backupAssignee`] ? 'var(--danger)' : 'var(--text-subtle)', textTransform: 'uppercase' }}>Backup</span>
                                  <SingleAssigneeDropdown
                                    department={task.department || stage.ownerDepartment}
                                    selectedId={task.backupAssignee}
                                    onChange={(empId) => {
                                      handleBackupAssigneeChange(stage.id, task.id, empId);
                                      if (fieldErrors[`${stage.id}:${task.id}:backupAssignee`]) setFieldErrors(p => { const n = {...p}; delete n[`${stage.id}:${task.id}:backupAssignee`]; return n; });
                                    }}
                                    placeholder="Select Backup"
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
                                if (prim && prim.availability?.status !== 'available') {
                                  return (
                                    <span style={{
                                      fontSize: 10.5,
                                      color: prim.availability?.status === 'on_leave' ? 'var(--danger)' : 'var(--warning)',
                                      background: prim.availability?.status === 'on_leave' ? 'var(--danger-soft)' : 'var(--warning-soft)',
                                      padding: '2px 8px',
                                      borderRadius: 4,
                                      fontWeight: 600,
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: 4
                                    }}>
                                      ⚠️ {prim.name} is {prim.availability?.status === 'on_leave' ? 'On Leave' : 'Busy'} ({prim.availability?.reason}). Make sure Backup is assigned.
                                    </span>
                                  );
                                }
                                return null;
                              })()}
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
          gridTemplateColumns: 'repeat(3, 1fr)', 
          gap: 'var(--space-3)', 
          textAlign: 'center',
          border: '1px solid var(--border)'
        }}>
          <div className="col center">
            <span className="row gap-1 tiny subtle"><Layers size={12} /> Stages</span>
            <span style={{ fontWeight: 700 }}>{stages.length}</span>
          </div>
          <div className="col center">
            <span className="row gap-1 tiny subtle"><ListChecks size={12} /> Total Tasks</span>
            <span style={{ fontWeight: 700 }}>{stages.reduce((sum, s) => sum + s.tasks.length, 0)}</span>
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
