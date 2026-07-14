import { Target, Wallet, Wrench, Building2, ClipboardList } from 'lucide-react';

/**
 * Presentation map for record statuses — mirrors the server's RECORD_STATUS
 * enum, matching the label+colour convention in lib/ui.js.
 */
export const RECORD_STATUS_META = {
  draft: { label: 'Draft', color: '#7c7784' },
  submitted: { label: 'Submitted', color: '#38bdf8' },
  shortlisted: { label: 'Shortlisted', color: '#10b981' },
  rejected: { label: 'Rejected', color: '#f43f5e' },
  approved: { label: 'Approved', color: '#6366f1' },
  locked: { label: 'Locked', color: '#e0a13a' },
};

/** Stable display label for a record's number, e.g. "Property No. 1". */
export const propertyNo = (seq) => (seq ? `Property No. ${seq}` : '—');

/**
 * Presentation map for a Site Evaluation step's status — three-tier, both for
 * a single assessment step and (aggregated) for a whole property's evaluation.
 * `pending` isn't a real `Record.status` value — it's what a step shows before
 * any record for it exists yet.
 */
export const STEP_STATUS_META = {
  pending: { label: 'Pending', color: '#7c7784' },
  in_progress: { label: 'In Progress', color: '#38bdf8' },
  completed: { label: 'Completed', color: '#10b981' },
};

/** `record` is the assessment's Record if one exists yet, else null/undefined. */
export const stepStatusOf = (record) => {
  if (!record) return 'pending';
  if (record.status === 'draft') return 'in_progress';
  return 'completed'; // submitted (or any later terminal status) — the step is done
};

/**
 * Icon per Site Evaluation assessment type, keyed by `assessmentType.key` —
 * display-only, not business logic. A type the template designer adds later
 * (beyond the current four) falls back to a generic icon rather than
 * breaking the stepper.
 */
const ASSESSMENT_TYPE_ICONS = {
  feasibility: Target,
  financial: Wallet,
  technical: Wrench,
  operational: Building2,
};
export const assessmentTypeIcon = (key) => ASSESSMENT_TYPE_ICONS[key] || ClipboardList;

/** Filter tabs shown above the records table. */
export const RECORD_FILTER_TABS = [
  { key: 'all', label: 'All' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'shortlisted', label: 'Shortlisted' },
  { key: 'rejected', label: 'Rejected' },
];
