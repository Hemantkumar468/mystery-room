/**
 * Presentation maps mirroring the server's domain enums — one place that turns
 * a raw status string into a label + color so badges read consistently.
 */

export const TASK_STATUS_META = {
  todo: { label: 'To Do', color: '#7c7784', soft: 'rgba(124,119,132,0.14)' },
  in_progress: { label: 'In Progress', color: '#6366f1', soft: 'rgba(99,102,241,0.14)' },
  blocked: { label: 'Blocked', color: '#f43f5e', soft: 'rgba(244,63,94,0.14)' },
  review: { label: 'In Review', color: '#e0a13a', soft: 'rgba(224,161,58,0.18)' },
  done: { label: 'Done', color: '#10b981', soft: 'rgba(16,185,129,0.16)' },
};

export const PROJECT_STATUS_META = {
  planning: { label: 'Planning', color: '#38bdf8', soft: 'rgba(56,189,248,0.16)' },
  active: { label: 'Active', color: '#ce8c24', soft: 'rgba(224,161,58,0.18)' },
  on_hold: { label: 'On Hold', color: '#ea8a2b', soft: 'rgba(234,138,43,0.18)' },
  completed: { label: 'Completed', color: '#10b981', soft: 'rgba(16,185,129,0.16)' },
  cancelled: { label: 'Cancelled', color: '#7c7784', soft: 'rgba(124,119,132,0.14)' },
};

export const HEALTH_META = {
  on_track: { label: 'On Track', color: '#10b981', soft: 'rgba(16,185,129,0.16)' },
  at_risk: { label: 'At Risk', color: '#ea8a2b', soft: 'rgba(234,138,43,0.18)' },
  delayed: { label: 'Delayed', color: '#f43f5e', soft: 'rgba(244,63,94,0.16)' },
};

export const STAGE_STATUS_META = {
  not_started: { label: 'Not Started', color: '#7c7784' },
  in_progress: { label: 'In Progress', color: '#6366f1' },
  blocked: { label: 'Blocked', color: '#f43f5e' },
  completed: { label: 'Completed', color: '#10b981' },
};

export const PRIORITY_META = {
  low: { label: 'Low', color: '#7c7784' },
  medium: { label: 'Medium', color: '#38bdf8' },
  high: { label: 'High', color: '#ea8a2b' },
  critical: { label: 'Critical', color: '#f43f5e' },
};

export const DEPT_META = {
  expansion: 'Expansion',
  legal: 'Legal',
  projects: 'Projects',
  hr: 'HR',
  marketing: 'Marketing',
  finance: 'Finance',
  operations: 'Operations',
  construction: 'Construction',
  interior: 'Interior',
  procurement: 'Procurement',
  automation: 'Automation',
  it: 'IT',
};

/** Categorical chart ramp — matches --chart-* tokens (gold-led, cool support). */
export const CHART_COLORS = [
  '#e0a13a', '#16a79a', '#6366f1', '#f43f5e', '#38bdf8', '#10b981', '#8b5cf6', '#ec4899',
];

export const TASK_STATUS_ORDER = ['todo', 'in_progress', 'blocked', 'review', 'done'];
