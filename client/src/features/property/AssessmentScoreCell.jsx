import { Check, X } from 'lucide-react';
import {
  feasibilityPercent, financialPercent, technicalPercent, operationalPercent,
  scoreGradeFor,
} from '../projects/records/scoring.js';
import { fmtDate } from './propertyUi.jsx';

/**
 * One assessment, as the five things anybody asks about it: what it scored,
 * what it was for, its headline figure, who answered it, and when.
 *
 * THE COLUMN USED TO SAY "Filed". That answered "has this been done?" and
 * nothing else, so the question everybody actually had — "well, what did it
 * say, and who says so?" — meant opening the form. Four forms per property,
 * twenty-five properties a page.
 *
 * SCORED BY THE REAL SCORERS, imported from the scoring module the Site
 * Evaluation dashboard and the comparison page already use — not a second
 * formula that would eventually disagree with them. The server sends only the
 * handful of fields those functions read (ASSESSMENT_VALUE_FIELDS in
 * propertyCapture.service.js), so this is the same maths on the same inputs,
 * rendered smaller.
 *
 * A SCORE ONLY APPEARS ONCE THERE IS ONE. An assessment still in draft shows
 * its state; one that is filed but whose scorable fields were all left blank
 * shows its state too — a score of zero and an unanswered form are not the
 * same thing and must not look alike.
 */
const SCORERS = {
  feasibility: feasibilityPercent,
  financial: financialPercent,
  technical: technicalPercent,
  operational: operationalPercent,
};

/** A rejected assessment is the answer to "which one is weak" — not "filed". */
export const cellState = (a) => {
  if (!a) return 'none';
  if (a.status === 'approved' || a.status === 'locked') return 'done';
  if (a.status === 'rejected') return 'failed';
  if (a.status === 'draft') return 'open';
  return 'filed';
};

export const STATE_LABEL = {
  none: 'Not asked', open: 'Open form', filed: 'Filed',
  done: 'Passed', failed: 'Failed',
};

/**
 * The headline figure, per assessment — what somebody asks next after seeing
 * the score. Falls through its list, so a form that skipped the first field
 * still says something rather than nothing.
 */
const HEADLINE = {
  feasibility: (v) => (typeof v.footfall_assessment === 'number' ? `Footfall ${v.footfall_assessment}/10`
    : v.market_potential && `Market ${v.market_potential.toLowerCase()}`),
  financial: (v) => (typeof v.roi === 'number' ? `ROI ${v.roi}%`
    : typeof v.payback_period === 'number' ? `${v.payback_period}mo payback`
      : v.estimated_investment ? `₹${Number(v.estimated_investment).toLocaleString('en-IN')}` : null),
  technical: (v) => v.building_condition
    || (typeof v.electrical_capacity === 'number' ? `${v.electrical_capacity} kW` : null),
  operational: (v) => v.operations_readiness || v.utility_availability
    || (typeof v.staff_requirement === 'number' ? `${v.staff_requirement} staff` : null),
};

/** Every answered field, for the tooltip behind the score. */
const FIELD_LABELS = {
  purpose: 'Purpose',
  market_potential: 'Market potential', accessibility: 'Accessibility',
  expansion_potential: 'Expansion potential', footfall_assessment: 'Footfall (/10)',
  roi: 'ROI (%)', payback_period: 'Payback (months)', estimated_investment: 'Investment',
  building_condition: 'Building', water_supply: 'Water', internet_availability: 'Internet',
  fire_safety: 'Fire safety', parking: 'Parking', electrical_capacity: 'Power (kW)',
  utility_availability: 'Utilities', vendor_availability: 'Vendors',
  operations_readiness: 'Readiness', staff_requirement: 'Staff needed',
};

const detailOf = (values) => Object.entries(values || {})
  .map(([k, v]) => `${FIELD_LABELS[k] || k}: ${v}`)
  .join('\n');

const entryOf = (row, type) => row.assessments.find((x) => x.type === type);
const dim = <span className="prop-dim">—</span>;

/** The score cell — or the plain state button when there is nothing to score. */
function ScoreCell({ entry, type, onOpen }) {
  const state = cellState(entry);
  const values = entry?.values;
  const score = values ? SCORERS[type]?.(values) ?? null : null;

  if (score == null) {
    return (
      <button
        type="button"
        className={`prop-doc is-${state}`}
        disabled={state === 'none'}
        onClick={onOpen}
        title={state === 'none'
          ? 'This assessment was not asked for'
          : `${STATE_LABEL[state]}${values ? `\n\n${detailOf(values)}` : ''}`}
      >
        {state === 'done' && <Check size={11} />}
        {STATE_LABEL[state]}
      </button>
    );
  }

  const grade = scoreGradeFor(score);
  return (
    <button
      type="button"
      className={`as-score is-${state}`}
      onClick={onOpen}
      title={`${STATE_LABEL[state]} — ${grade.label} (${score}%)\n\n${detailOf(values)}`}
    >
      <span className="as-score-pct" style={{ color: grade.color }}>
        {score}%
        {state === 'done' && <Check size={10} />}
        {state === 'failed' && <X size={10} />}
      </span>
      <span className="as-score-cap">{grade.label}</span>
    </button>
  );
}

/**
 * The five columns for one assessment, banded under its name.
 *
 * Returned as a set rather than written out four times, so adding a fifth
 * assessment to the template adds five correct columns here for free — and so
 * the four can never drift into showing different things about themselves.
 */
export function assessmentColumns(a, onOpen) {
  const group = a.label;
  return [
    {
      key: `${a.key}_score`, group, label: 'Score', width: 96,
      render: (r) => <ScoreCell entry={entryOf(r, a.key)} type={a.key} onOpen={() => onOpen(r, a.key)} />,
    },
    {
      key: `${a.key}_purpose`, group, label: 'Purpose', width: 160,
      /* A textarea in a column, so it is clamped and carries the whole of
         itself in the tooltip — truncated text that cannot be read in full is
         worse than no column. */
      render: (r) => {
        const p = entryOf(r, a.key)?.values?.purpose;
        return p ? <span className="as-purpose" title={p}>{p}</span> : dim;
      },
    },
    {
      key: `${a.key}_headline`, group, label: 'Finding', width: 128,
      render: (r) => {
        const v = entryOf(r, a.key)?.values;
        const text = v ? HEADLINE[a.key]?.(v) : null;
        return text ? <span className="as-headline">{text}</span> : dim;
      },
    },
    {
      key: `${a.key}_by`, group, label: 'Filled by', width: 132,
      render: (r) => {
        const by = entryOf(r, a.key)?.by;
        return by ? <span className="prop-person" title={by}>{by}</span> : dim;
      },
    },
    {
      key: `${a.key}_at`, group, label: 'Filled on', width: 104,
      render: (r) => {
        const at = entryOf(r, a.key)?.at;
        return at ? <span className="as-when">{fmtDate(at)}</span> : dim;
      },
    },
  ];
}

export default assessmentColumns;
