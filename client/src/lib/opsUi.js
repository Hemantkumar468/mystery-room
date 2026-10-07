/**
 * Presentation maps for the Delegation & Checklist modules — the server's enum
 * values turned into labels and colours, so every badge reads the same.
 */

export const DLG_STATUS_META = {
  /* PENDING IS AMBER, NOT GREY. Grey is the colour of "nothing to report",
     and on a board where most rows are pending that is the one state that
     must read at a glance — it is somebody's unstarted work. Amber also
     separates it from Shifted, the only genuinely inert state here.
     In Progress moves to blue so the two are not both warm. */
  pending: { label: 'Pending', color: '#d97706', soft: 'rgba(217,119,6,0.15)' },
  accepted: { label: 'Accepted', color: '#0891b2', soft: 'rgba(8,145,178,0.15)' },
  in_progress: { label: 'In Progress', color: '#4f46e5', soft: 'rgba(79,70,229,0.15)' },
  dependent: { label: 'Dependent', color: '#7c3aed', soft: 'rgba(124,58,237,0.15)' },
  blocked: { label: 'Blocked', color: '#f43f5e', soft: 'rgba(244,63,94,0.15)' },
  awaiting_verification: { label: 'Awaiting Verification', color: '#6366f1', soft: 'rgba(99,102,241,0.15)' },
  completed: { label: 'Completed', color: '#10b981', soft: 'rgba(16,185,129,0.16)' },
  /* The one inert state — moved to another week and replaced. Grey is
     now free to mean exactly that. */
  shifted: { label: 'Shifted', color: '#64748b', soft: 'rgba(100,116,139,0.15)' },
  overdue: { label: 'Overdue', color: '#f43f5e', soft: 'rgba(244,63,94,0.15)' },
};

/** Tab order for task lists. */
export const DLG_STATUS_TABS = [
  'all',
  'overdue',
  'pending',
  'accepted',
  'in_progress',
  'dependent',
  'blocked',
  'awaiting_verification',
  'completed',
  'shifted',
];

export const DLG_OPEN = ['pending', 'accepted', 'in_progress', 'dependent', 'blocked'];

export const CHK_STATUS_META = {
  pending: { label: 'Pending', color: '#7c7784', soft: 'rgba(124,119,132,0.14)' },
  completed: { label: 'Completed', color: '#10b981', soft: 'rgba(16,185,129,0.16)' },
  non_functional: { label: 'Non-Functional', color: '#d97706', soft: 'rgba(217,119,6,0.16)' },
  overdue: { label: 'Overdue', color: '#f43f5e', soft: 'rgba(244,63,94,0.15)' },
  upcoming: { label: 'Upcoming', color: '#38bdf8', soft: 'rgba(56,189,248,0.16)' },
  late: { label: 'Done late', color: '#ea8a2b', soft: 'rgba(234,138,43,0.18)' },
};

export const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

export const DLG_FREQUENCIES = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
  { value: 'periodically', label: 'Every N days' },
  { value: 'custom', label: 'Custom' },
];

export const CHK_FREQUENCIES = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'fortnightly', label: 'Fortnightly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
];

export const FREQ_LABEL = Object.fromEntries(
  [...DLG_FREQUENCIES, ...CHK_FREQUENCIES].map((f) => [f.value, f.label]),
);

export const WEEKDAYS = [
  { value: 1, short: 'Mon', label: 'Monday' },
  { value: 2, short: 'Tue', label: 'Tuesday' },
  { value: 3, short: 'Wed', label: 'Wednesday' },
  { value: 4, short: 'Thu', label: 'Thursday' },
  { value: 5, short: 'Fri', label: 'Friday' },
  { value: 6, short: 'Sat', label: 'Saturday' },
  { value: 0, short: 'Sun', label: 'Sunday' },
];

export const BRANCH_TYPE_LABEL = {
  headquarters: 'Headquarters',
  regional_office: 'Regional office',
  outlet: 'Outlet',
  warehouse: 'Warehouse',
};

export const TEAM_ROLE_LABEL = { member: 'Member', manager: 'Manager', admin: 'Admin' };

export const REMINDER_UNITS = [
  { value: 'minutes', label: 'minutes' },
  { value: 'hours', label: 'hours' },
  { value: 'days', label: 'days' },
];

export const ESCALATION_LABEL = {
  1: 'Escalated to manager',
  2: 'Escalated to directors',
  3: 'Review meeting',
};

/** Parse "dd/MM/yyyy HH:mm - text" lines from an append-only remark channel. */
export function parseRemarkLines(value) {
  if (!value) return [];
  return String(value)
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^(\d{2}\/\d{2}\/\d{4} \d{2}:\d{2})\s*-\s*(.*)$/);
      return m ? { at: m[1], text: m[2] } : { at: null, text: line };
    })
    .reverse();
}

/** Display state of a checklist occurrence: pending / overdue / upcoming / completed / late / non_functional. */
export function chkState(t, today = new Date()) {
  if (!t) return 'pending';
  if (t.isNonFunctional) return 'non_functional';
  const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  if (t.actualDate) {
    const endOfPlanned = new Date(t.plannedDate).getTime() + 86_399_999;
    return new Date(t.actualDate).getTime() > endOfPlanned ? 'late' : 'completed';
  }
  if (t.plannedKey < key) return 'overdue';
  if (t.plannedKey > key) return 'upcoming';
  return 'pending';
}

/** Whole days an open item is past its date (0 when not late). */
export const lateDays = (date) => {
  if (!date) return 0;
  const diff = Date.now() - new Date(date).getTime();
  return diff > 0 ? Math.floor(diff / 86_400_000) : 0;
};

/** Is a delegation overdue right now? */
export const isDlgOverdue = (t) => DLG_OPEN.includes(t?.status) && t?.dueDate && new Date(t.dueDate) < new Date();

/** Best human error message from an axios error. */
export const errMsg = (e, fallback = 'Something went wrong') => {
  const d = e?.response?.data;
  if (d?.details?.length) return `${d.message}: ${d.details.map((x) => x.message).join(', ')}`;
  return d?.message || e?.message || fallback;
};
