/**
 * Presentation helpers for collection-mode records (e.g. Phase-1 properties).
 * Mirrors the status → {label,color} maps in `lib/ui.js` so record chips read
 * consistently with the rest of the app.
 */
import { fmtCurrency, fmtDate } from '../../../lib/format.js';
import { getEmployeeById } from '../../../lib/employees.js';

export const RECORD_STATUS_META = {
  draft: { label: 'Draft', color: '#7c7784', soft: 'rgba(124,119,132,0.14)' },
  submitted: { label: 'Submitted', color: '#e0a13a', soft: 'rgba(224,161,58,0.18)' },
  shortlisted: { label: 'Shortlisted', color: '#10b981', soft: 'rgba(16,185,129,0.16)' },
  rejected: { label: 'Rejected', color: '#f43f5e', soft: 'rgba(244,63,94,0.16)' },
  approved: { label: 'Approved', color: '#16a79a', soft: 'rgba(22,167,154,0.16)' },
  locked: { label: 'Locked', color: '#6366f1', soft: 'rgba(99,102,241,0.16)' },
};

/** Tabs shown above a records table — the Phase-1 funnel view. */
export const RECORD_FILTER_TABS = [
  { key: 'all', label: 'All' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'shortlisted', label: 'Shortlisted' },
  { key: 'rejected', label: 'Rejected' },
];

const EMPTY = '—';

export function isEmptyValue(value) {
  return value == null || value === '' || (Array.isArray(value) && value.length === 0);
}

/** Turn a raw stored value into a display string for its field type. */
export function formatFieldValue(field, value) {
  if (isEmptyValue(value)) return EMPTY;
  switch (field.type) {
    case 'boolean':
      return value === true || value === 'true' ? 'Yes' : 'No';
    case 'currency':
      return fmtCurrency(value);
    case 'date':
      return fmtDate(value);
    case 'multiselect':
      return Array.isArray(value) ? value.join(', ') : String(value);
    case 'user': {
      const employee = getEmployeeById(value);
      return employee?.name || String(value);
    }
    default:
      return String(value);
  }
}

/** The field whose value titles a row (property name), with a sensible fallback. */
export function titleFieldKey(schema = []) {
  const named = schema.find((f) => f.key === 'property_name' || f.key === 'name' || f.key === 'title');
  return named?.key || schema[0]?.key;
}

/** A few compact, tabular fields to summarise a row in the table. */
export function summaryFields(schema = [], titleKey, max = 3) {
  return schema
    .filter((f) => f.key !== titleKey && !['file', 'textarea', 'multiselect'].includes(f.type))
    .slice(0, max);
}
