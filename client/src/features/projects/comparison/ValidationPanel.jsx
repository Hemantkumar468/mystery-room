import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';

/**
 * Live "can this phase be completed" checklist shown above the Shortlisted
 * Properties table — the same rules that gate the Mark Done button
 * (`canMarkDone` in SiteEvaluationPage.jsx), surfaced explicitly instead of
 * only as a disabled-button tooltip. `rules` is `[{ label, satisfied }]`;
 * the banner tone flips from warning to success once every rule passes.
 */
export function ValidationPanel({
  rules,
  allSatisfied,
  satisfiedHeadline = 'All requirements met — Phase 2 is ready to be marked done.',
  headline = 'All properties must have a final decision before Phase 2 can be completed.',
}) {
  return (
    <div className={`se-validation-panel ${allSatisfied ? 'se-validation-panel--ok' : 'se-validation-panel--warn'}`}>
      <div className="se-validation-headline">
        {allSatisfied ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
        <span>{allSatisfied ? satisfiedHeadline : headline}</span>
      </div>
      <ul className="se-validation-list">
        {rules.map((r) => (
          <li key={r.label} className={r.satisfied ? 'se-validation-item--ok' : 'se-validation-item--fail'}>
            {r.satisfied ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
            <span>{r.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default ValidationPanel;
