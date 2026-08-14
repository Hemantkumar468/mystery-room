import { CheckCircle2, ShieldCheck, Clock } from 'lucide-react';
import { fmtDate } from '../../lib/format.js';

/**
 * The four management questions for one phase — What, Who, When, How — plus
 * how long it was meant to take against how long it actually took.
 *
 * This is the client's core requirement, and the reason it is a component
 * rather than page-by-page markup: the functional flow document prints a
 * What/Who/When/How table for every single phase, and the brief has to read
 * IDENTICALLY on the phase page, in the MD's master flow view and on a doer's
 * task. Written three times it would drift three ways within a month.
 *
 * Everything here comes from the project's own stage snapshot, so it can never
 * contradict the template the project was created from.
 */

/** Whole days between two dates, or null when either is missing. */
function daysBetween(from, to) {
  if (!from || !to) return null;
  const ms = new Date(to) - new Date(from);
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.round(ms / 864e5));
}

/**
 * Planned vs actual in the plainest words available.
 *
 * Deliberately says "on time" / "2 days late" rather than showing a signed
 * variance number — the audience is a non-technical MD scanning seventeen
 * phases, and "−2" reads as a puzzle where "2 days early" reads as an answer.
 */
export function phaseTiming(stage) {
  const planned = stage?.slaDays ?? daysBetween(stage?.plannedStart, stage?.plannedEnd);
  const actual = daysBetween(stage?.startedAt, stage?.completedAt);
  const started = Boolean(stage?.startedAt);

  let verdict = null;
  if (actual !== null && planned != null) {
    const diff = actual - planned;
    if (diff === 0) verdict = { tone: 'ok', text: 'Finished on time' };
    else if (diff < 0) verdict = { tone: 'ok', text: `Finished ${-diff} day${-diff === 1 ? '' : 's'} early` };
    else verdict = { tone: 'late', text: `Took ${diff} day${diff === 1 ? '' : 's'} longer than planned` };
  } else if (started) {
    verdict = { tone: 'running', text: 'In progress — not finished yet' };
  }

  return { planned, actual, started, verdict };
}

/**
 * @param stage  A project stage (the snapshot, not the template) — carries
 *               whatWhoWhenHow, gate, exitCriteria and the planned/actual dates.
 * @param compact  Drop the timing footer and exit criteria; used where the brief
 *                 sits inside an already-dense card, e.g. the master flow map.
 */
export function PhaseBrief({ stage, compact = false }) {
  const rows = stage?.whatWhoWhenHow || [];
  const { planned, actual, verdict } = phaseTiming(stage);

  // No invented content: a phase with no rows renders nothing rather than an
  // empty four-column table, which would read as missing data.
  if (!rows.length) return null;

  return (
    <div className="pbrief">
      <div className="pbrief-table" role="table" aria-label="What, who, when and how for this phase">
        <div className="pbrief-head" role="row">
          <span role="columnheader">What</span>
          <span role="columnheader">Who</span>
          <span role="columnheader">When</span>
          <span role="columnheader">How</span>
        </div>
        {rows.map((r, i) => (
          <div className="pbrief-row" role="row" key={`${r.what}-${i}`}>
            {/* Each cell repeats its label on narrow screens (CSS ::before), so
                the table degrades to readable stacked pairs on a phone rather
                than four unlabelled lines. */}
            <span className="pbrief-what" role="cell" data-label="What">{r.what}</span>
            <span className="pbrief-who" role="cell" data-label="Who">{r.who}</span>
            <span className="pbrief-when" role="cell" data-label="When">{r.when}</span>
            <span className="pbrief-how" role="cell" data-label="How">{r.how}</span>
          </div>
        ))}
      </div>

      {!compact && (
        <div className="pbrief-foot">
          <span className="pbrief-timing">
            <Clock size={13} aria-hidden />
            <strong>Planned:</strong>{' '}
            {planned != null ? `${planned} day${planned === 1 ? '' : 's'}` : 'not set'}
            {stage?.plannedStart && stage?.plannedEnd && (
              <span className="muted"> ({fmtDate(stage.plannedStart)} – {fmtDate(stage.plannedEnd)})</span>
            )}
            {actual !== null && (
              <>
                {' · '}
                <strong>Actual:</strong> {actual} day{actual === 1 ? '' : 's'}
              </>
            )}
          </span>
          {verdict && <span className={`pbrief-verdict is-${verdict.tone}`}>{verdict.text}</span>}
        </div>
      )}

      {!compact && stage?.gate?.label && (
        <div className="pbrief-gate">
          <ShieldCheck size={14} aria-hidden />
          <span>
            <strong>{stage.gate.label}</strong>
            {stage.gate.approver && <> — approved by {stage.gate.approver}</>}
            {stage.gate.unlocks && <span className="muted"> · unlocks {stage.gate.unlocks}</span>}
          </span>
        </div>
      )}

      {!compact && stage?.exitCriteria && (
        <div className="pbrief-exit">
          <CheckCircle2 size={14} aria-hidden />
          <span><strong>Done when:</strong> {stage.exitCriteria}</span>
        </div>
      )}
    </div>
  );
}

export default PhaseBrief;
