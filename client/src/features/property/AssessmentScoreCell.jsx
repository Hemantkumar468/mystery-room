import { useState } from 'react';
import { Check, X } from 'lucide-react';
import {
  feasibilityPercent, financialPercent, technicalPercent, operationalPercent,
  scoreGradeFor,
} from '../projects/records/scoring.js';
import { fmtDate, FilesCell, whoWhenColumns } from './propertyUi.jsx';
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

/**
 * HAS SOMEBODY ACTUALLY FILLED THIS IN?
 *
 * One definition, used by both the score cell and the form cell - they were
 * answering the same question separately and could disagree, which is how a
 * row came to read "Form: Filled" beside a score cell that still offered to
 * guess one.
 *
 * A status past draft counts, and so does a draft with anything typed into it:
 * a form somebody is halfway through IS filled in, whatever its status says.
 */
export const isFilledEntry = (entry) => Boolean(
  entry && (
    ['filed', 'approved', 'locked', 'completed', 'rejected'].includes(entry.status)
    || (entry.values && Object.values(entry.values).some((v) => v !== null && v !== undefined && v !== ''))
  ),
);

const entryOf = (row, type) => row.assessments.find((x) => x.type === type);
const slotOf = (row, type) => (row.assessmentSlots || []).find((x) => x.type === type);
const dim = <span className="prop-dim">—</span>;

/**
 * The score cell — the score this assessment actually earned, or nothing.
 *
 * A SCORE IS AN OUTPUT OF THE FORM. It is worked out from the answers
 * somebody wrote down, by the same scorers the Site Evaluation dashboard uses.
 * With no answers there is no score, and there is no honest way to produce
 * one.
 *
 * WHAT THIS USED TO DO, and why it had to stop. The cell offered an "AI Score"
 * button on every row, filled or not. Pressed on an untouched property it
 * asked the model to draft the form and then scored the DRAFT, printing
 * something like "~66% AI estimate" into the score column of a property whose
 * assessment count still read 0/4. It was drawn as an estimate - a tilde, a
 * sparkle, its own colour, the word AI under it - and none of that survives
 * the glance it actually gets: a percentage in a column headed SCORE, on a
 * queue whose whole job is deciding which sites go forward. The one number on
 * that row was the one number nobody had stood behind, and the row above it
 * carried a real score drawn almost the same way.
 *
 * So the button now says what is missing instead of filling the gap with a
 * guess. The AI has not been taken away from anybody - it still drafts the
 * form from inside the form (RecordFormModal), where a person reads what it
 * proposed, changes what is wrong and signs it by submitting. That is the
 * difference: there, AI helps somebody answer; here, it was answering for
 * them.
 */
function ScoreCell({ row, entry, type }) {
  const state = cellState(entry);
  const values = entry?.values;
  const filled = isFilledEntry(entry);
  const score = filled && values ? SCORERS[type]?.(values) ?? null : null;

  /* Only for the empty case: the button has one thing left to say, and this
     is whether it has said it yet. */
  const [asked, setAsked] = useState(false);

  /* ── FILLED, AND IT SCORES ───────────────────────────────────────────── */
  if (score != null) {
    const grade = scoreGradeFor(score);
    return (
      <span className="as-empty">
        <span
          className={`as-score is-${state}`}
          title={`${STATE_LABEL[state]} — ${grade.label} (${score}%)

${detailOf(values)}`}
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

  /* ── FILLED, BUT NOT IN THE FIELDS THE SCORE IS MADE OF ──────────────── */
  if (filled) {
    return (
      <span className="as-empty">
        <span
          className="as-score is-none"
          title="This form has been filled in, but none of the fields the score is calculated from were answered."
        >
          <span className="as-score-pct">No score</span>
          <span className="as-score-cap">Unscored</span>
        </span>
      </span>
    );
  }

  /* ── NOT FILLED ──────────────────────────────────────────────────────── */
  if (asked) {
    return (
      <span className="as-empty">
        <span
          className="as-score-ask"
          onClick={(e) => { e.stopPropagation(); setAsked(false); }}
          title="A score is worked out from the answers on this form. Open it from the Form column and fill it in."
          style={{ cursor: 'pointer' }}
        >
          Fill the form first
        </span>
      </span>
    );
  }

  return (
    <span className="as-empty">
      <button
        type="button"
        className="as-ai-score-btn"
        onClick={(e) => { e.stopPropagation(); setAsked(true); }}
        title="Why is there no score?"
      >
        <span>No score yet</span>
      </button>
    </span>
  );
}

/**
 * Form cell — shows "Filled" if the assessment form is completed/filed,
 * or a highlighted "Form" button if it is pending/unfilled.
 */
function FormCell({ row, entry, type, onOpen }) {
  const isFilled = isFilledEntry(entry);

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
  market_potential: 165,
  footfall_assessment: 135,
  accessibility: 145,
  target_audience: 165,
  expansion_potential: 195,

  estimated_investment: 215,
  monthly_revenue: 175,
  roi: 125,
  payback_period: 135,
  capex: 145,
  opex: 195,
  profit_margin: 155,
  financial_risk: 155,

  building_condition: 185,
  civil_condition: 155,
  electrical_capacity: 190,
  hvac: 125,
  water_supply: 145,
  internet_availability: 200,
  fire_safety: 145,
  parking: 125,

  staff_requirement: 175,
  operating_hours: 165,
  operations_readiness: 205,
  security: 125,
  inventory: 125,
  training: 125,
  utility_availability: 195,
  vendor_availability: 190,
};

/**
 * The columns for one assessment, banded under its name.
 */
export function assessmentColumns(a, onOpen, onFiles, onDetail) {
  const group = a.label;
  return [
    {
      key: `${a.key}_score`, group, label: 'Score', width: 130,
      render: (r) => (
        <ScoreCell row={r} entry={entryOf(r, a.key)} type={a.key} />
      ),
    },
    {
      key: `${a.key}_form`, group, label: 'Form', width: 105,
      render: (r) => (
        <FormCell row={r} entry={entryOf(r, a.key)} type={a.key} onOpen={onOpen} />
      ),
    },

    /**
     * WHO AND WHEN, PER ASSESSMENT — right after its form.
     *
     * The step carried ONE set of these four columns for the whole property,
     * which is the wrong grain for this step: four assessments are four
     * different people working to four different dates, and an aggregate
     * reading "Ananya Das +3" against one plan date answers none of the
     * questions actually asked here — who is doing Technical, and when is it
     * due. It also sat before the bands, so the name you could see was never
     * the name for the assessment you were reading.
     *
     * The same four columns, in the same order as every other step, repeated
     * inside each band and fed from that assessment's OWN slot
     * (`assessmentSlots`: its task's assignee and plan date, its record's
     * filer and filing date).
     */
    /* These four REPLACED two condensed columns that said the same thing
       from the same `slotOf()` data — "Assign person" (assignee, falling
       back to whoever filed it) and "Done by date" (filed date, falling
       back to "due <plan>"). Keeping both would have put sixteen duplicate
       columns on a sheet that is already 2,000px wide, and the condensed
       pair hid a real distinction: who it is FOR versus who did it, and
       when it was DUE versus when it landed. */
    ...whoWhenColumns(a.key, {
      getPlan: (r) => {
        const s = slotOf(r, a.key);
        /* AssignedCell speaks `assignedNames`; a slot names one person, so
           it is wrapped rather than the cell being taught a second shape. */
        return s && { assignedNames: s.assignedTo ? [s.assignedTo] : [], planDate: s.planDate };
      },
      getDoneBy: (r) => slotOf(r, a.key)?.filedBy,
      getDoneAt: (r) => slotOf(r, a.key)?.filedAt,
    }).map((c) => ({ ...c, group })),
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
      width: FIELD_WIDTHS[key] || Math.max(145, labelOfField(a.key, key).length * 10 + 40),
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
      key: `${a.key}_files`, group, label: 'Documents', width: 196,
      render: (r) => {
        const entry = entryOf(r, a.key);
        /* A row-shaped stand-in, because the viewer is built to open a
           property's media and this is one assessment's. The title says which
           of the four, or the dialog opens with no way to tell. Built even when
           there is nothing, so the empty state is the SAME sentence as every
           other documents cell rather than a second wording of it. */
        const scoped = { ...r, title: `${r.title} — ${a.label}`, media: entry?.media || { files: [] }, onlyMedia: true };
        return (
          <FilesCell
            row={scoped}
            onOpen={(_row, at) => onFiles?.(scoped, at)}
            emptyTitle={entry ? undefined : `The ${a.label.toLowerCase()} assessment has not been filed yet`}
          />
        );
      },
    },
  ];
}

export default assessmentColumns;
