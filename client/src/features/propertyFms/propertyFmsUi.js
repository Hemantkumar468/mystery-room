/**
 * Shared display metadata for the Property FMS prototype — the six-phase
 * ladder every page's stepper reads, and the status→label/color maps so a
 * "Not Feasible" badge looks the same wherever it appears. One table per
 * concept, same convention as lib/ui.js's *_META maps.
 */
import {
  Inbox, ClipboardCheck, Search, ShieldCheck, FileSignature, Rocket,
} from 'lucide-react';

export const FMS_PHASES = [
  { key: 'capture', order: 1, label: 'Property Capture', sub: 'Collect leads & properties.', path: '/property-fms/capture', icon: Inbox },
  { key: 'review', order: 2, label: 'Review & Decision', sub: 'MD reviews & assigns.', path: '/property-fms/review-decision', icon: ClipboardCheck },
  { key: 'research', order: 3, label: 'Property Research', sub: 'Find & evaluate locations.', path: '/property-fms/research', icon: Search },
  { key: 'assessment', order: 4, label: 'Assessment', sub: 'Feasibility & tech checks.', path: '/property-fms/assessment', icon: ShieldCheck },
  { key: 'loi', order: 5, label: 'LOI & Commercial', sub: 'Agreement signed.', path: '/property-fms/loi-commercial', icon: FileSignature },
  { key: 'creation', order: 6, label: 'Project Creation', sub: 'Launch project in PMS.', path: '/property-fms/project-creation', icon: Rocket },
];

export const phaseByKey = (key) => FMS_PHASES.find((p) => p.key === key) || null;

/** Submission type → label + tint, used by Property Capture and Review & Decision. */
export const SUBMISSION_TYPE_META = {
  'interested-lead': { label: 'Interested Lead', color: '#6366f1' },
  'interested-property': { label: 'Interested + Property', color: '#e0a13a' },
  'property-opportunity': { label: 'Property Opportunity', color: '#38bdf8' },
};

export const CAPTURE_STATUS_META = {
  'new-lead': { label: 'New Lead', color: '#38bdf8' },
  'in-research': { label: 'In Research', color: '#e0a13a' },
  pending: { label: 'Pending', color: '#6b7280' },
  'md-approved': { label: 'MD Approved', color: '#059669' },
};

export const MD_DECISION_META = {
  pending: { label: 'Pending', color: '#6b7280' },
  approved: { label: 'Approved', color: '#059669' },
  rejected: { label: 'Rejected', color: '#DC2626' },
  'need-info': { label: 'Need More Info', color: '#D97706' },
};

export const RESEARCH_STATUS_META = {
  searching: { label: 'Searching', color: '#6366f1' },
  shortlisted: { label: 'Shortlisted', color: '#059669' },
  'site-visits': { label: 'Site Visits', color: '#38bdf8' },
  'ready-for-review': { label: 'Ready for Review', color: '#e0a13a' },
  closed: { label: 'Closed', color: '#6b7280' },
};

export const ASSESSMENT_STATUS_META = {
  'in-progress': { label: 'In Progress', color: '#38bdf8' },
  completed: { label: 'Completed', color: '#059669' },
  'need-info': { label: 'Need Info', color: '#D97706' },
  'not-feasible': { label: 'Not Feasible', color: '#DC2626' },
};

export const DEAL_STAGE_META = {
  'loi-drafting': { label: 'LOI Drafting', color: '#38bdf8' },
  'legal-review': { label: 'Legal Review', color: '#D97706' },
  'lease-negotiation': { label: 'Lease Negotiation', color: '#6366f1' },
  'ready-for-finalization': { label: 'Ready for Finalization', color: '#059669' },
  closed: { label: 'Closed', color: '#6b7280' },
};

export const PROJECT_STATUS_META = {
  'in-progress': { label: 'In Progress', color: '#2563EB' },
  upcoming: { label: 'Upcoming', color: '#8b5cf6' },
  'on-hold': { label: 'On Hold', color: '#D97706' },
  completed: { label: 'Completed', color: '#059669' },
  closed: { label: 'Closed', color: '#6b7280' },
};

/** Palette used for the stat tiles across every phase page — one consistent
 * ramp rather than each page inventing its own colors. */
export const STAT_TONES = {
  indigo: '#6366f1',
  gold: '#e0a13a',
  blue: '#38bdf8',
  green: '#059669',
  purple: '#8b5cf6',
  red: '#DC2626',
  grey: '#6b7280',
  pink: '#ec4899',
};
