/**
 * WHAT EACH ASSESSMENT ASKS, and which of its answers earn a column.
 *
 * Mirrors the four `masterDataSchema` lists the template carries for stage
 * p2 (see storeLaunchTemplate.js). Kept as a plain table here because Step 3
 * needs three different things from the same schema and the template gives
 * none of them: which answers are worth a column of their own, which are
 * prose that belongs behind "See more", and how each value should read once
 * it is out of its form.
 *
 * THE SPLIT IS THE WHOLE POINT. A sheet compares properties, so a column is
 * only worth its width if the answer is short and comparable — a grade, a
 * percentage, a number of staff. "Competitor Analysis" is a paragraph: as a
 * column it shows eight words and hides the rest, and four of those per
 * assessment is how a step ends up 60 columns wide and still unreadable. So
 * the short answers become columns and the prose goes in one dialog, opened
 * from the cell that shows its opening line.
 *
 * `documents`, `audio` and `notes` are deliberately not columns: the first
 * two already have the Files column beside the score, and the third is the
 * doer's own working note, which belongs in the dialog with the rest of
 * their prose.
 */

/** Short, comparable answers — one column each, in form order. */
export const COLUMN_FIELDS = {
  feasibility: [
    'market_potential', 'footfall_assessment', 'accessibility', 'target_audience', 'expansion_potential',
  ],
  financial: [
    'estimated_investment', 'monthly_revenue', 'roi', 'payback_period', 'capex', 'opex',
    'profit_margin', 'financial_risk',
  ],
  technical: [
    'building_condition', 'civil_condition', 'electrical_capacity', 'hvac',
    'water_supply', 'internet_availability', 'fire_safety', 'parking',
  ],
  operational: [
    'staff_requirement', 'operating_hours', 'operations_readiness', 'security',
    'inventory', 'training', 'utility_availability', 'vendor_availability',
  ],
};

/** The prose. Shown as an opening line plus "See more". */
export const LONG_FIELDS = {
  feasibility: ['purpose', 'competitor_analysis', 'risk_factors', 'remarks', 'notes'],
  financial: ['purpose', 'financial_remarks', 'notes'],
  technical: ['purpose', 'maintenance', 'structural_assessment', 'technical_remarks', 'notes'],
  operational: ['purpose', 'customer_flow', 'operational_risks', 'operational_remarks', 'notes'],
};

/** How the dialog lays one assessment out — the form's own sections. */
export const FIELD_GROUPS = {
  feasibility: [
    { label: 'Why this assessment', keys: ['purpose'], long: ['purpose'] },
    { label: 'The market', keys: ['market_potential', 'footfall_assessment', 'accessibility', 'target_audience', 'expansion_potential'] },
    { label: 'What they found', keys: ['competitor_analysis', 'risk_factors', 'remarks', 'notes'], long: ['competitor_analysis', 'risk_factors', 'remarks', 'notes'] },
  ],
  financial: [
    { label: 'Why this assessment', keys: ['purpose'], long: ['purpose'] },
    { label: 'The numbers', keys: ['estimated_investment', 'monthly_revenue', 'capex', 'opex', 'roi', 'payback_period', 'profit_margin', 'financial_risk'] },
    { label: 'What they found', keys: ['financial_remarks', 'notes'], long: ['financial_remarks', 'notes'] },
  ],
  technical: [
    { label: 'Why this assessment', keys: ['purpose'], long: ['purpose'] },
    { label: 'The building', keys: ['building_condition', 'civil_condition', 'electrical_capacity', 'hvac', 'water_supply', 'internet_availability', 'fire_safety', 'parking'] },
    { label: 'What they found', keys: ['maintenance', 'structural_assessment', 'technical_remarks', 'notes'], long: ['maintenance', 'structural_assessment', 'technical_remarks', 'notes'] },
  ],
  operational: [
    { label: 'Why this assessment', keys: ['purpose'], long: ['purpose'] },
    { label: 'Running it', keys: ['staff_requirement', 'operating_hours', 'operations_readiness', 'security', 'inventory', 'training', 'utility_availability', 'vendor_availability'] },
    { label: 'What they found', keys: ['customer_flow', 'operational_risks', 'operational_remarks', 'notes'], long: ['customer_flow', 'operational_risks', 'operational_remarks', 'notes'] },
  ],
};

/** The form's own wording for every field, so a column and its dialog agree. */
const LABELS = {
  purpose: 'Purpose',
  notes: "Doer's notes",

  market_potential: 'Market potential',
  competitor_analysis: 'Competitor analysis',
  footfall_assessment: 'Footfall',
  accessibility: 'Accessibility',
  target_audience: 'Target audience',
  expansion_potential: 'Expansion potential',
  risk_factors: 'Risk factors',
  remarks: 'Remarks',

  estimated_investment: 'Estimated investment',
  monthly_revenue: 'Monthly revenue',
  roi: 'ROI',
  payback_period: 'Payback',
  capex: 'Setup cost',
  opex: 'Monthly running cost',
  profit_margin: 'Profit margin',
  financial_risk: 'Financial risk',
  financial_remarks: 'Financial remarks',

  building_condition: 'Building condition',
  civil_condition: 'Civil',
  electrical_capacity: 'Electrical capacity',
  hvac: 'HVAC',
  water_supply: 'Water supply',
  internet_availability: 'Internet',
  fire_safety: 'Fire safety',
  parking: 'Parking',
  maintenance: 'Maintenance',
  structural_assessment: 'Structural assessment',
  technical_remarks: 'Technical remarks',

  staff_requirement: 'Staff needed',
  operating_hours: 'Operating hours',
  operations_readiness: 'Operations readiness',
  security: 'Security',
  inventory: 'Inventory',
  training: 'Training',
  customer_flow: 'Customer flow',
  utility_availability: 'Utilities',
  vendor_availability: 'Vendors',
  operational_risks: 'Operational risks',
  operational_remarks: 'Operational remarks',
};

export const labelOfField = (_type, key) => LABELS[key] || key;

/** Money, percentages and months read as themselves, not as bare digits. */
const MONEY = new Set(['estimated_investment', 'monthly_revenue', 'capex', 'opex']);
const PERCENT = new Set(['roi', 'profit_margin']);

export function formatFieldValue(key, value) {
  if (value === undefined || value === null || value === '') return '—';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
  if (MONEY.has(key) && Number.isFinite(Number(value))) return `₹${Number(value).toLocaleString('en-IN')}`;
  if (PERCENT.has(key) && Number.isFinite(Number(value))) return `${value}%`;
  if (key === 'payback_period' && Number.isFinite(Number(value))) return `${value} months`;
  if (key === 'footfall_assessment' && Number.isFinite(Number(value))) return `${value}/10`;
  if (key === 'electrical_capacity' && Number.isFinite(Number(value))) return `${value} kW`;
  if (key === 'staff_requirement' && Number.isFinite(Number(value))) return `${value}`;
  return String(value);
}

/** The opening words of a long answer, for the cell that offers "See more". */
export function previewOf(text, max = 46) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}
