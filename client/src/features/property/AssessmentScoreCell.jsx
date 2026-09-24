import { useState } from 'react';
import { Check, X, Sparkles, Loader2 } from 'lucide-react';
import { usePrefillAssessment } from '../../app/api/aiApi.js';
import {
  feasibilityPercent, financialPercent, technicalPercent, operationalPercent,
  scoreGradeFor,
} from '../projects/records/scoring.js';
import { fmtDate, FilesCell } from './propertyUi.jsx';
import {
  COLUMN_FIELDS, LONG_FIELDS, labelOfField, formatFieldValue, previewOf,
} from './assessmentFields.js';

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
function ScoreCell({ row, entry, type }) {
  const state = cellState(entry);
  const values = entry?.values;
  const score = values ? SCORERS[type]?.(values) ?? null : null;

  const prefill = usePrefillAssessment();
  const [guess, setGuess] = useState(null);
  const [aiError, setAiError] = useState(null);
  const [showScore, setShowScore] = useState(false);

  const canAi = AI_DRAFTABLE.includes(type) && Boolean(row.recordId);

  const runAi = async (e) => {
    e?.stopPropagation?.();
    setAiError(null);
    try {
      const draft = await prefill.mutateAsync({
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

  /* Initially: show ONLY the AI button */
  if (!showScore) {
    return (
      <span className="as-empty">
        <button
          type="button"
          className="as-ai-score-btn"
          onClick={(e) => {
            e.stopPropagation();
            setShowScore(true);
            if (canAi && !guess && score == null) {
              runAi(e);
            }
          }}
          disabled={prefill.isPending}
          title={aiError || 'Click to reveal / compute score with AI'}
        >
          {prefill.isPending ? <Loader2 size={11} className="spin" /> : <Sparkles size={11} />}
          <span>{prefill.isPending ? 'Asking…' : 'AI Score'}</span>
        </button>
        {aiError && <span className="as-ai-err" title={aiError}>AI unavailable</span>}
      </span>
    );
  }

  /* Score revealed */
  if (guess && guess.pct != null) {
    const grade = scoreGradeFor(guess.pct);
    return (
      <span
        className="as-score is-ai"
        onClick={() => setShowScore(false)}
        title={`AI ESTIMATE — not a filed assessment.\n${grade.label} (~${guess.pct}%)\n\n${detailOf(guess.values)}${guess.notes ? `\n\n${guess.notes}` : ''}\n\nClick to hide`}
        style={{ cursor: 'pointer' }}
      >
        <span className="as-score-pct" style={{ color: grade.color }}>
          ~{guess.pct}% <Sparkles size={10} />
        </span>
        <span className="as-score-cap">AI estimate</span>
      </span>
    );
  }

  if (guess && guess.pct == null) {
    return (
      <span
        className="as-score is-ai"
        onClick={() => setShowScore(false)}
        title={`AI drafted ${guess.count} field(s), but none of the ones this score is calculated from.\n\n${detailOf(guess.values)}${guess.notes ? `\n\n${guess.notes}` : ''}\n\nClick to hide`}
        style={{ cursor: 'pointer' }}
      >
        <span className="as-score-pct"><Sparkles size={10} /> No score</span>
        <span className="as-score-cap">AI drafted {guess.count}</span>
      </span>
    );
  }

  if (score != null) {
    const grade = scoreGradeFor(score);
    return (
      <span className="as-empty">
        <span
          className={`as-score is-${state}`}
          onClick={() => setShowScore(false)}
          title={`${STATE_LABEL[state]} — ${grade.label} (${score}%)\n\n${detailOf(values)}\n\nClick to hide`}
          style={{ cursor: 'pointer' }}
        >
          <span className="as-score-pct" style={{ color: grade.color }}>
            {score}%
            {state === 'done' && <Check size={10} />}
            {state === 'failed' && <X size={10} />}
          </span>
          <span className="as-score-cap">{grade.label}</span>
        </span>
      </span>
    );
  }

  return (
    <span className="as-empty">
      <span className="as-score is-none" onClick={() => setShowScore(false)} style={{ cursor: 'pointer' }}>
        <span className="as-score-pct">No score</span>
        <span className="as-score-cap">Unscored</span>
      </span>
    </span>
  );
}

/**
 * Form cell — shows "Filled" if the assessment form is completed/filed,
 * or a highlighted "Form" button if it is pending/unfilled.
 */
function FormCell({ row, entry, type, onOpen }) {
  const isFilled = Boolean(
    entry && (
      entry.status === 'filed' ||
      entry.status === 'approved' ||
      entry.status === 'locked' ||
      entry.status === 'completed' ||
      entry.status === 'rejected' ||
      (entry.values && Object.values(entry.values).some((v) => v !== null && v !== undefined && v !== ''))
    )
  );

  if (isFilled) {
    return (
      <button
        type="button"
        className="as-form-filled"
        onClick={(e) => {
          e.stopPropagation();
          onOpen?.(row, type);
        }}
        title="Form has been filled. Click to view or edit."
      >
        <Check size={11} />
        <span>Filled</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      className="as-form-btn-highlight"
      onClick={(e) => {
        e.stopPropagation();
        onOpen?.(row, type);
      }}
      title="Form not filled yet. Click to open and fill form."
    >
      Form
    </button>
  );
}

const FIELD_WIDTHS = {
  market_potential: 145,
  footfall_assessment: 135,
  accessibility: 135,
  target_audience: 145,
  expansion_potential: 165,

  estimated_investment: 175,
  monthly_revenue: 155,
  roi: 125,
  payback_period: 135,
  capex: 135,
  opex: 155,
  profit_margin: 135,
  financial_risk: 135,

  building_condition: 160,
  civil_condition: 135,
  electrical_capacity: 165,
  hvac: 125,
  water_supply: 135,
  internet_availability: 155,
  fire_safety: 135,
  parking: 125,

  staff_requirement: 140,
  operating_hours: 155,
  operations_readiness: 175,
  security: 125,
  inventory: 125,
  training: 125,
  utility_availability: 145,
  vendor_availability: 145,
};

/**
 * The columns for one assessment, banded under its name.
 */
export function assessmentColumns(a, onOpen, onFiles, onDetail) {
  const group = a.label;
  return [
    {
      key: `${a.key}_score`, group, label: 'Score', width: 112,
      render: (r) => (
        <ScoreCell row={r} entry={entryOf(r, a.key)} type={a.key} />
      ),
    },
    {
      key: `${a.key}_form`, group, label: 'Form', width: 100,
      render: (r) => (
        <FormCell row={r} entry={entryOf(r, a.key)} type={a.key} onOpen={onOpen} />
      ),
    },
    {
      /**
       * THE PROSE, AS AN OPENING LINE AND A WAY IN.
       *
       * These forms are half paragraphs — Purpose, Competitor Analysis, Risk
       * Factors, Structural Assessment, Remarks, the doer's own Notes. This
       * column used to hold Purpose alone, clamped, with the rest of the
       * sentence in a browser tooltip: unscrollable, unselectable, gone the
       * moment the mouse moved. The other four paragraphs had nowhere at all.
       *
       * So the cell shows the first line and how many written answers there
       * are, and "See more" opens the whole assessment (AssessmentDetailModal)
       * where all of it can be read, selected and copied.
       */
      key: `${a.key}_notes`, group, label: 'Notes & purpose', width: 190,
      render: (r) => {
        const entry = entryOf(r, a.key);
        const values = entry?.values || {};
        const written = (LONG_FIELDS[a.key] || []).filter((k) => String(values[k] ?? '').trim());
        if (!written.length) return dim;
        const first = values[written[0]];
        return (
          <span className="as-notes">
            <span className="as-notes-text" title={labelOfField(a.key, written[0])}>{previewOf(first)}</span>
            <button
              type="button"
              className="as-more"
              onClick={(e) => { e.stopPropagation(); onDetail?.(r, a.key, entry); }}
              title={`Read all ${written.length} written answer(s) on the ${a.label.toLowerCase()} assessment`}
            >
              See more{written.length > 1 ? ` (${written.length})` : ''}
            </button>
          </span>
        );
      },
    },

    /**
     * EVERY SHORT ANSWER THE FORM TAKES, one column each.
     *
     * The band used to carry the score, one line of purpose and a single
     * derived "Finding" — so a filed assessment showed three cells out of a
     * dozen answers, and comparing two properties on, say, fire safety or
     * payback meant opening both forms. These are the answers that are short
     * enough to compare down a column, in the order the form asks them.
     */
    ...(COLUMN_FIELDS[a.key] || []).map((key) => ({
      key: `${a.key}_${key}`,
      group,
      label: labelOfField(a.key, key),
      width: FIELD_WIDTHS[key] || Math.max(135, labelOfField(a.key, key).length * 9 + 16),
      render: (r) => {
        const v = entryOf(r, a.key)?.values?.[key];
        if (v === undefined || v === null || v === '') return dim;
        const text = formatFieldValue(key, v);
        return <span className="as-field" title={text}>{text}</span>;
      },
    })),
    {
      key: `${a.key}_headline`, group, label: 'Finding', width: 132,
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
      key: `${a.key}_by`, group, label: 'Assign person', width: 145,
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
      /**
       * WHAT THIS ASSESSOR ATTACHED - inside their own band, beside their own
       * score.
       *
       * The sheet had one Files column at the far end holding the PROPERTY's
       * media, which is the capture photos. The survey the feasibility expert
       * shot, the quotes behind the financial number, the meter readings on
       * the technical form: each sits on its own assessment and each is the
       * evidence for the score two cells to its left. Reading a 42% without
       * being able to open what it was based on is the thing this column
       * fixes, and it has to be in that assessment's band or it says nothing
       * about which of the four it belongs to.
       *
       * ADDING files is still done in the form itself - that is where the
       * Documents and Audio fields live, and the Score cell opens it. This
       * column shows and previews what is there.
       */
      key: `${a.key}_files`, group, label: 'Files', width: 170,
      render: (r) => {
        const entry = entryOf(r, a.key);
        const files = entry?.media?.files || [];
        if (!files.length) {
          return (
            <span className="prop-files is-empty" title={`No files on the ${a.label.toLowerCase()} assessment${entry ? '' : ' - it has not been filed yet'}`}>
              None
            </span>
          );
        }
        /* A row-shaped stand-in, because the viewer is built to open a
           property's media and this is one assessment's. The title says which
           of the four, or the dialog opens with no way to tell. */
        const scoped = { ...r, title: `${r.title} \u2014 ${a.label}`, media: entry.media };
        return <FilesCell row={scoped} onOpen={(_row, at) => onFiles?.(scoped, at)} />;
      },
    },
    {
      key: `${a.key}_at`, group, label: 'Done by date', width: 138,
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
