/** Presentation maps for HRMS — mirrors the server's hrms.constants.js. */

export const REQ_STATUS_META = {
  draft: { label: 'Draft', color: '#6B7280', soft: '#F3F4F6' },
  open: { label: 'Open', color: '#059669', soft: '#DCFCE7' },
  on_hold: { label: 'On Hold', color: '#D97706', soft: '#FEF3C7' },
  filled: { label: 'Filled', color: '#2563EB', soft: '#DBEAFE' },
  closed: { label: 'Closed', color: '#6B7280', soft: '#F3F4F6' },
};

export const STAGE_META = {
  applied: { label: 'Applied', color: '#6B7280', soft: '#F3F4F6' },
  screening: { label: 'Screening', color: '#2563EB', soft: '#DBEAFE' },
  interview: { label: 'Interview', color: '#7C3AED', soft: '#EDE9FE' },
  offer: { label: 'Offer', color: '#D97706', soft: '#FEF3C7' },
  hired: { label: 'Hired', color: '#059669', soft: '#DCFCE7' },
  rejected: { label: 'Rejected', color: '#DC2626', soft: '#FEE2E2' },
};

export const EMPLOYMENT_LABEL = {
  full_time: 'Full-time',
  part_time: 'Part-time',
  contract: 'Contract',
  intern: 'Intern',
};

export const SOURCE_LABEL = {
  website: 'Job page',
  referral: 'Referral',
  job_portal: 'Job portal',
  walk_in: 'Walk-in',
  agency: 'Agency',
  other: 'Other',
};

/** The public apply link for a requisition — what HR shares on WhatsApp. */
export const applyLinkFor = (id) => `${window.location.origin}/apply/${id}`;
