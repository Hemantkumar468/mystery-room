import { ClipboardCheck, FileSignature, Rocket } from 'lucide-react';
import { ASSESSMENTS } from '../../app/api/propertyCaptureApi.js';

/**
 * "Does this property need assessing, and if so which?"
 *
 * ONE COMPONENT, BOTH DOORS. This question is asked in two places — of a
 * property already captured on a project (PropertyRouteModal) and of one that
 * has just arrived through the franchise or referral link
 * (EnquiryDecisionModal) — and it is the SAME question either time. Two copies
 * is two chances for the wording, the defaults or the four options to drift,
 * and the whole point is that a property gets asked the same thing whichever
 * door it came in through.
 *
 * WHY THE CHOICE IS NOT A DROPDOWN. Picking which assessments is a
 * multi-select, and the honest default is all four — most properties get the
 * full set and the exceptions are the point of asking. Two large targets with
 * their consequence written underneath beat a select whose options nobody
 * reads, and this is a decision that opens real forms for real people.
 */

/**
 * The roads, as the buttons that choose them.
 *
 * `allowProject` adds the third — straight to Project & Games. It is opt-in
 * because only the routing step offers it: a property arriving through the
 * franchise link is being approved at the same moment, and "approve this lead
 * and also skip the entire closure" is two decisions wearing one button.
 *
 * Kept as three large targets rather than a dropdown for the same reason as
 * before: this opens real forms for real people, and a select whose options
 * nobody reads is the wrong control for a decision with consequences.
 */
export function RoadChoice({
  mode, onChange, assessHint, skipHint, allowProject = false, projectHint,
}) {
  return (
    <div className={`prop-choice${allowProject ? ' is-three' : ''}`}>
      <button
        type="button"
        className={`prop-choice-btn${mode === 'assess' ? ' active' : ''}`}
        onClick={() => onChange('assess')}
      >
        <ClipboardCheck size={18} />
        <b>Send for assessment</b>
        <span className="tiny muted">{assessHint || 'Opens the Site Evaluation forms you pick below.'}</span>
      </button>
      <button
        type="button"
        className={`prop-choice-btn${mode === 'skip' ? ' active' : ''}`}
        onClick={() => onChange('skip')}
      >
        <FileSignature size={18} />
        <b>Straight to commercial</b>
        <span className="tiny muted">{skipHint || 'No assessment — opens the LOI, lease, legal, deposit, NOCs and approvals.'}</span>
      </button>
      {allowProject && (
        <button
          type="button"
          className={`prop-choice-btn${mode === 'project' ? ' active' : ''}`}
          onClick={() => onChange('project')}
        >
          <Rocket size={18} />
          <b>Straight to project</b>
          <span className="tiny muted">
            {projectHint || 'No assessment and no closure first — plan the games and the opening date now. The six documents still have to be filed.'}
          </span>
        </button>
      )}
    </div>
  );
}

/**
 * The four tick boxes, shown once "assess" is chosen.
 *
 * `already` names assessments this property has open from a previous routing —
 * they stay ticked and are left alone by the server, and saying so on the
 * option is what stops somebody unticking one expecting it to be withdrawn.
 */
export function AssessmentPicker({ picked, onToggle, onToggleAll, already }) {
  const allPicked = picked.size === ASSESSMENTS.length;
  return (
    <div className="col gap-2">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="tiny muted" style={{ fontWeight: 700, textTransform: 'uppercase' }}>Which assessments?</span>
        <button type="button" className="prop-link" onClick={onToggleAll}>
          {allPicked ? 'Clear all' : 'Select all four'}
        </button>
      </div>
      <div className="prop-assess-grid">
        {ASSESSMENTS.map((a) => {
          const on = picked.has(a.key);
          const exists = already?.has(a.key);
          return (
            <label key={a.key} className={`prop-assess-opt${on ? ' active' : ''}`}>
              <input type="checkbox" checked={on} onChange={() => onToggle(a.key)} />
              <span className="col" style={{ gap: 2, minWidth: 0 }}>
                <b className="sm">{a.label}</b>
                <span className="tiny muted">{exists ? 'Already open — will be left as it is' : a.hint}</span>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

/** The set-toggling both callers need, so neither hand-rolls it. */
export const toggleIn = (set, key) => {
  const next = new Set(set);
  if (next.has(key)) next.delete(key); else next.add(key);
  return next;
};

export const allAssessmentKeys = () => new Set(ASSESSMENTS.map((a) => a.key));

export default AssessmentPicker;
