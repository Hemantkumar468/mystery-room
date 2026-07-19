/**
 * Presentation maps mirroring the server's domain enums — one place that turns
 * a raw status string into a label + color so badges read consistently.
 */

export const TASK_STATUS_META = {
  todo:        { label: 'To Do',      color: '#6B7280', soft: '#F3F4F6' },
  in_progress: { label: 'In Progress',color: '#4F46E5', soft: '#EEF2FF' },
  blocked:     { label: 'Blocked',    color: '#DC2626', soft: '#FEE2E2' },
  review:      { label: 'In Review',  color: '#D97706', soft: '#FEF3C7' },
  done:        { label: 'Done',       color: '#059669', soft: '#DCFCE7' },
};

export const PROJECT_STATUS_META = {
  planning:  { label: 'Planning',  color: '#2563EB', soft: '#DBEAFE' },
  active:    { label: 'Active',    color: '#D97706', soft: '#FEF3C7' },
  on_hold:   { label: 'On Hold',   color: '#EA580C', soft: '#FFEDD5' },
  completed: { label: 'Completed', color: '#059669', soft: '#DCFCE7' },
  cancelled: { label: 'Cancelled', color: '#6B7280', soft: '#F3F4F6' },
};

export const HEALTH_META = {
  on_track: { label: 'On Track', color: '#059669', soft: '#DCFCE7' },
  at_risk:  { label: 'At Risk',  color: '#D97706', soft: '#FEF3C7' },
  delayed:  { label: 'Delayed',  color: '#DC2626', soft: '#FEE2E2' },
};

export const STAGE_STATUS_META = {
  not_started: { label: 'Not Started', color: '#6B7280', soft: '#F3F4F6' },
  in_progress: { label: 'In Progress', color: '#4F46E5', soft: '#EEF2FF' },
  blocked:     { label: 'Blocked',     color: '#DC2626', soft: '#FEE2E2' },
  completed:   { label: 'Completed',   color: '#059669', soft: '#DCFCE7' },
};

export const PRIORITY_META = {
  low:      { label: 'Low',      color: '#6B7280', soft: '#F3F4F6' },
  medium:   { label: 'Medium',   color: '#2563EB', soft: '#DBEAFE' },
  high:     { label: 'High',     color: '#D97706', soft: '#FEF3C7' },
  critical: { label: 'Critical', color: '#DC2626', soft: '#FEE2E2' },
};

export const ROLE_META = {
  admin:    { label: 'Admin',    color: '#DC2626', hint: 'Full control — config, templates, employees' },
  manager:  { label: 'Manager',  color: '#D97706', hint: 'Owns projects, assigns work, approves stages' },
  executor: { label: 'Executor', color: '#059669', hint: 'Doer — completes assigned tasks' },
  viewer:   { label: 'Viewer',   color: '#6B7280', hint: 'Read-only dashboards and MIS' },
};

export const DEPT_META = {
  expansion:    'Expansion',
  legal:        'Legal',
  projects:     'Projects',
  hr:           'HR',
  marketing:    'Marketing',
  finance:      'Finance',
  operations:   'Operations',
  construction: 'Construction',
  interior:     'Interior',
  procurement:  'Procurement',
  automation:   'Automation',
  it:           'IT',
};

/** Categorical chart ramp — matches --chart-* tokens. */
export const CHART_COLORS = [
  '#e0a13a', '#16a79a', '#6366f1', '#f43f5e', '#38bdf8', '#10b981', '#8b5cf6', '#ec4899',
];

export const TASK_STATUS_ORDER = ['todo', 'in_progress', 'blocked', 'review', 'done'];
