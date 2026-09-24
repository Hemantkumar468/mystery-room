import { useState } from 'react';
import {
  AlertTriangle, Briefcase, Gamepad2, Check,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { useDecideProperty, ASSESSMENTS } from '../../app/api/propertyCaptureApi.js';
import { scoreGradeFor } from '../projects/records/scoring.js';

/**
 * Step 4's verdict: the property, what it scored, and where it goes next.
 *
 * WHY THIS IS NOT `PropertyVerdictModal`. That dialog opens on Step 3 with both
 * answers as a toggle and a reader can change their mind inside it. Here the
 * answer was already given by the button on the card, and approving carries a
 * second question with it — so a shared dialog would either ask "shortlist or
 * reject?" twice, or let somebody flip to shortlist and submit without ever
 * being asked the second question.
 *
 * IT SHOWS WHAT IS BEING DECIDED ON. It used not to: it asked for a verdict on
 * a nine-year commitment while naming only the property. The scores are two
 * screens away by then — the reader has scrolled past them to reach the button
 * — so the dialog restates them. Only the scores, and only the ones that came
 * back: a preview that repeated the whole capture form would be a second
 * report nobody reads inside a dialog they opened to press one button.
 */

/**
 * The two roads, and what each one actually changes.
 *
 * TICKED, NOT PICKED, and both can be ticked at once — the client's own words.
 * They are not alternatives: closure and planning run side by side, and the
 * common answer is "start both".
 *
 * COMMERCIAL IS NOT OPTIONAL. Ticking project creation ticks commercial too
 * and holds it there, because the paperwork happens whatever road is chosen —
 * a dialog that let somebody untick it would be promising an outlet that opens
 * without a lease. Said on the row rather than enforced silently.
 */
const ROUTES = [
  {
    key: 'commercial',
    to: '/property/commercial',
    icon: Briefcase,
    title: 'Commercial finalisation',
    blurb: 'LOI, lease, legal check, deposits. The six documents open as drafts and the site moves into closure.',
  },
  {
    key: 'project',
    to: '/property/planning',
    icon: Gamepad2,
    title: 'Project creation — games & opening date',
    blurb: 'Choose the games and fix the dates. Closure carries on alongside; finishing it is not required to start here.',
  },
];

/** The scores this property actually has, and their average. */
function scoreLines(row) {
  const each = (row.scores?.each || []).filter((s) => typeof s.pct === 'number');
  return {
    each,
    average: row.scores?.average ?? null,
    asked: (row.assessments || []).length || ASSESSMENTS.length,
  };
}

export function PropertyApproveModal({ row, mode = 'approve', onClose, onDone }) {
  const decide = useDecideProperty();
  /* Commercial starts ticked and cannot be the only thing unticked — see
     ROUTES. `project` is the one the reader is really choosing. */
  const [project, setProject] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);

  const rejecting = mode === 'reject';
  const { each, average, asked } = scoreLines(row);
  const pending = asked - (row.assessmentsFiled || 0);
  const grade = average != null ? scoreGradeFor(average) : null;

  const confirm = async () => {
    setError(null);
    if (rejecting && !reason.trim()) {
      setError('A rejected property needs a reason.');
      return;
    }
    try {
      await decide.mutateAsync({
        recordId: row.recordId,
        decision: rejecting ? 'reject' : 'shortlist',
        ...(rejecting ? { reason: reason.trim() } : {}),
      });
      /* Where to land is a NAVIGATION fact, not a server one — the write is
         the same either way, and ticking both means starting at closure
         because that is where the next thing to do is. */
      onDone?.(rejecting ? null : ROUTES.find((r) => (project ? r.key === 'project' : r.key === 'commercial')));
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not record that decision.');
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={rejecting ? `Reject ${row.title}?` : `Approve ${row.title}`}
      subtitle={[row.city, row.locality].filter(Boolean).join(' · ') || 'Step 4 — MD review & approval'}
      width={560}
      footer={(
        <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className={`btn ${rejecting ? 'btn-danger' : 'btn-primary'}`}
            disabled={decide.isPending}
            onClick={confirm}
          >
            {decide.isPending ? 'Saving…'
              : rejecting ? 'Reject property'
                : project ? 'Approve → closure + games' : 'Approve → closure'}
          </button>
        </div>
      )}
    >
      <div className="col gap-3">
        {error && <div className="pt-alert pt-alert--bad"><AlertTriangle size={14} /> {error}</div>}

        {/* THE PROPERTY, IN ONE LINE. Enough to be sure it is the right one —
            a verdict taken on the wrong row is the failure this guards. */}
        <div className="pav-facts">
          {[
            row.areaSqft && `${Number(row.areaSqft).toLocaleString('en-IN')} sq ft`,
            row.floor,
            row.details?.commercialType,
            Number(row.details?.monthlyRent) && `₹${Number(row.details.monthlyRent).toLocaleString('en-IN')}/mo`,
          ].filter(Boolean).map((t) => <span key={t}>{t}</span>)}
        </div>

        {/* WHAT IT SCORED. Only the assessments that came back — an empty row
            for one that was never asked for reads as a zero. */}
        <div className="pav-scores">
          {each.length ? each.map((s) => {
            const g = scoreGradeFor(s.pct);
            return (
              <span className="pav-score" key={s.key}>
                <b style={{ color: g.color }}>{s.pct}%</b>
                <span>{s.label}</span>
              </span>
            );
          }) : (
            <span className="pav-score-none">Nothing scored yet.</span>
          )}
          {average != null && (
            <span className="pav-score is-avg">
              <b style={{ color: grade.color }}>{average}%</b>
              <span>Average of {each.length}</span>
            </span>
          )}
        </div>

        {/* Said, never enforced: a site that clearly fails should not need the
            remaining forms filled in before it can be answered. */}
        {pending > 0 && (
          <div className="pt-alert">
            <AlertTriangle size={14} />
            {pending} of {asked} assessments are still unfiled. You can still decide —
            the scores above are what you are deciding on.
          </div>
        )}

        {rejecting ? (
          <>
            <p className="sm" style={{ margin: 0 }}>
              It comes off the table for this project. The others stay in the running.
            </p>
            <label className="pt-field">
              <span>Why are we saying no?</span>
              <textarea
                rows={3}
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Rent too high for the footfall, no three-phase power, landlord will not give a 9-year lock-in…"
              />
            </label>
          </>
        ) : (
          <>
            <p className="sm" style={{ margin: 0 }}>Where does the work start?</p>

            <div className="psel-routes">
              {ROUTES.map((r) => {
                const Icon = r.icon;
                const locked = r.key === 'commercial';
                const on = locked ? true : project;
                return (
                  <label
                    key={r.key}
                    className={`psel-route${on ? ' is-on' : ''}${locked ? ' is-locked' : ''}`}
                  >
                    <span className="psel-route-top">
                      <span className={`pav-box${on ? ' is-on' : ''}`} aria-hidden="true">
                        {on && <Check size={12} />}
                      </span>
                      <input
                        type="checkbox"
                        className="pav-check"
                        checked={on}
                        disabled={locked}
                        onChange={(e) => setProject(e.target.checked)}
                      />
                      <Icon size={17} />
                      <b>{r.title}</b>
                      {locked && <span className="pav-always">always</span>}
                    </span>
                    <span className="psel-route-blurb">{r.blurb}</span>
                  </label>
                );
              })}
            </div>

            <p className="psel-route-note">
              <AlertTriangle size={12} />
              Commercial closure is ticked whatever else you choose — the six documents open as
              drafts either way, and the outlet cannot open without them. Ticking games as well
              starts both at once.
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}

export default PropertyApproveModal;
