import { useState } from 'react';
import { Check, X, Sparkles, Loader2 } from 'lucide-react';
import { usePrefillAssessment } from '../../app/api/aiApi.js';
import {
  feasibilityPercent, financialPercent, technicalPercent, operationalPercent,
  scoreGradeFor,
} from '../projects/records/scoring.js';
import { fmtDate } from './propertyUi.jsx';

/**
 * One assessment, as the five things anybody asks about it: what it scored,
 * what it was for, its headline figure, who owns it, and when it was done.
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
const slotOf = (row, type) => (row.assessmentSlots || []).find((x) => x.type === type);
const dim = <span className="prop-dim">—</span>;

/**
 * Which assessments AI can draft. Mirrors PREFILLABLE on the server
 * (assessmentPrefill.service.js): Financial and Technical are somebody's
 * professional judgement and a number invented for either would be read as
 * one — so the button is not offered where the server would refuse it.
 */
const AI_DRAFTABLE = ['feasibility', 'operational'];

/**
 * The score cell — the filed score, or the way to get an idea of one.
 *
 * WHY AI SITS HERE. An empty cell says "nobody has done this yet" and stops.
 * For the two assessments AI can draft, a estimate answers the question the
 * empty cell raises — roughly how does this site look on feasibility? — in one
 * click, before anybody spends half a day on the form. It is drawn as an
 * ESTIMATE and never as a score: different colour, a "~", and the word AI on
 * it, because a guess that looks like a filed answer is how a property gets
 * shortlisted on a number nobody stands behind.
 *
 * NOTHING IS SAVED. `prefillAssessment` returns proposed values and writes
 * nothing; the expert's own submit on the form is still what creates the
 * record. So this costs an AI call and changes no data.
 */
function ScoreCell({ row, entry, type, onOpen }) {
  const state = cellState(entry);
  const values = entry?.values;
  const score = values ? SCORERS[type]?.(values) ?? null : null;

  const prefill = usePrefillAssessment();
  const [guess, setGuess] = useState(null);
  const [aiError, setAiError] = useState(null);

  const canAi = AI_DRAFTABLE.includes(type) && Boolean(row.recordId);

  const runAi = async (e) => {
    e.stopPropagation(); // the cell itself opens the form; the button does not
    setAiError(null);
    try {
      const draft = await prefill.mutateAsync({
        /* The PROPERTY's record id, not the assessment's — the draft is about
           the property being assessed. Same argument the form's own "Draft
           with AI" passes. */
        recordId: row.recordId,
        stageKey: 'p2',
        assessmentType: type,
      });
      const drafted = draft?.values || draft?.data?.values || {};
      const pct = SCORERS[type]?.(drafted) ?? null;
      setGuess({
        pct,
        values: drafted,
        count: Object.values(drafted).filter((v) => v !== null && v !== undefined && v !== '').length,
        notes: draft?.notes || draft?.data?.notes || '',
      });
    } catch (err) {
      setAiError(err?.response?.data?.message || err?.message || 'AI could not draft this one.');
    }
  };

  if (score == null) {
    /**
     * AI answered but could not reach a number.
     *
     * The scorers read particular fields, and a draft that fills the prose and
     * leaves those blank is a real outcome — the model had nothing solid to
     * say about the things the score is made of. Saying so is the point: a
     * silent cell after a click reads as a broken button, and inventing a
     * percentage from one drafted field would be worse than both.
     */
    if (guess && guess.pct == null) {
      return (
        <span className="as-empty">
          <button
            type="button"
            className="as-score is-ai"
            onClick={onOpen}
            title={`AI drafted ${guess.count} field(s), but none of the ones this score is calculated from.

${detailOf(guess.values)}${guess.notes ? `

${guess.notes}` : ''}

Open the form to see the draft and answer it.`}
          >
            <span className="as-score-pct"><Sparkles size={10} /> No score</span>
            <span className="as-score-cap">AI drafted {guess.count}</span>
          </button>
        </span>
      );
    }

    /* An AI estimate, once it has been asked for. */
    if (guess && guess.pct != null) {
      const grade = scoreGradeFor(guess.pct);
      return (
        <button
          type="button"
          className="as-score is-ai"
          onClick={onOpen}
          title={`AI ESTIMATE — not a filed assessment.\n${grade.label} (~${guess.pct}%)\n\n${detailOf(guess.values)}${guess.notes ? `\n\n${guess.notes}` : ''}\n\nOpen the form to answer it properly.`}
        >
          <span className="as-score-pct" style={{ color: grade.color }}>
            ~{guess.pct}% <Sparkles size={10} />
          </span>
          <span className="as-score-cap">AI estimate</span>
        </button>
      );
    }

    return (
      <span className="as-empty">
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
        {canAi && (
          <button
            type="button"
            className="as-ai"
            onClick={runAi}
            disabled={prefill.isPending}
            title={aiError || 'Ask AI for an estimate of this score — nothing is saved'}
          >
            {prefill.isPending ? <Loader2 size={10} className="spin" /> : <Sparkles size={10} />}
            {prefill.isPending ? 'Asking…' : 'AI'}
          </button>
        )}
        {aiError && <span className="as-ai-err" title={aiError}>AI unavailable</span>}
      </span>
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
      key: `${a.key}_score`, group, label: 'Score', width: 112,
      render: (r) => (
        <ScoreCell row={r} entry={entryOf(r, a.key)} type={a.key} onOpen={() => onOpen(r, a.key)} />
      ),
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
      /* WHOSE JOB THIS ONE IS — read off the assessment's own task, so each of
         the four names its own owner instead of the row carrying one aggregate
         "assigned to" that could not say which piece was whose. The person who
         FILED it is shown underneath when it is somebody else, because the two
         differing is worth seeing rather than smoothing over. */
      key: `${a.key}_by`, group, label: 'Assign person', width: 140,
      render: (r) => {
        const slot = slotOf(r, a.key);
        const assigned = slot?.assignedTo || null;
        const filedBy = slot?.filedBy || entryOf(r, a.key)?.by || null;
        if (!assigned && !filedBy) return dim;
        const differs = assigned && filedBy && assigned !== filedBy;
        return (
          <>
            <span className="prop-person" title={assigned || filedBy}>{assigned || filedBy}</span>
            {differs && <span className="prop-sub" title={`Filed by ${filedBy}`}>filed by {filedBy}</span>}
            {!assigned && filedBy && <span className="prop-sub">filed it</span>}
          </>
        );
      },
    },
    {
      key: `${a.key}_at`, group, label: 'Done by date', width: 112,
      render: (r) => {
        const slot = slotOf(r, a.key);
        const at = slot?.filedAt || entryOf(r, a.key)?.at;
        if (at) return <span className="as-when">{fmtDate(at)}</span>;
        /* Not done yet: the date it is DUE is the useful answer, and saying
           which of the two a date is keeps them from being read as the same
           thing. */
        return slot?.planDate
          ? <span className="as-due" title="Planned date — not filed yet">due {fmtDate(slot.planDate)}</span>
          : dim;
      },
    },
  ];
}

export default assessmentColumns;
