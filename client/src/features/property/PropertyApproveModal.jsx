import { useState } from 'react';
import {
  AlertTriangle, Briefcase, Gamepad2, ThumbsDown, Check,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { useDecideProperty } from '../../app/api/propertyCaptureApi.js';

/**
 * Step 4's verdict: approve the site and say where the work carries on, or
 * reject it with a reason.
 *
 * WHY THIS IS NOT `PropertyVerdictModal`. That dialog opens on Step 3 with
 * both answers as a toggle, and a reader can change their mind inside it.
 * Here the answer was already given by the button on the card, and approving
 * carries a second question with it — so a shared dialog would either ask
 * "shortlist or reject?" twice, or let somebody flip to shortlist and submit
 * without ever being asked the second question. Step 3 keeps its dialog
 * untouched; this one belongs to Step 4.
 *
 * WHAT THE ROUTE CHOICE ACTUALLY CHANGES — and what it does not. Approving
 * shortlists the property, which opens the six commercial documents as drafts
 * and puts the site into commercial closure. From that instant BOTH Step 5
 * (the documents) and Step 6 (games and dates) list it and both are workable:
 * Step 6 has never required the documents to be finished, or even started.
 * So the route below is not a gate and is not sold as one — it is which of
 * the two open desks you are taken to. Saying otherwise on screen would be a
 * promise the pipeline does not keep.
 */
const ROUTES = [
  {
    key: 'commercial',
    to: '/property/commercial',
    icon: Briefcase,
    title: 'Commercial finalisation',
    blurb: 'Close the paperwork first — LOI, lease, legal check, deposits. The six documents open as drafts and the site moves into closure.',
  },
  {
    key: 'project',
    to: '/property/planning',
    icon: Gamepad2,
    title: 'Project creation — games & opening date',
    blurb: 'Go straight to choosing the games and fixing the dates. The commercial documents still open in the background; finishing them is not required to start here.',
  },
];

export function PropertyApproveModal({ row, mode = 'approve', onClose, onDone }) {
  const decide = useDecideProperty();
  const [route, setRoute] = useState('commercial');
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);

  const rejecting = mode === 'reject';
  const pending = (row.assessments?.length || 0) - (row.assessmentsFiled || 0);

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
      /* The chosen road is a NAVIGATION fact, not a server one — the caller
         decides where to land, because the write was identical either way. */
      onDone?.(rejecting ? null : ROUTES.find((r) => r.key === route));
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
                : route === 'project' ? 'Approve → games & dates'
                  : 'Approve → commercial'}
          </button>
        </div>
      )}
    >
      <div className="col gap-3">
        {error && <div className="pt-alert pt-alert--bad"><AlertTriangle size={14} /> {error}</div>}

        {/* Said, never enforced: a site that clearly fails should not need the
            remaining forms filled in before it can be answered. */}
        {pending > 0 && (
          <div className="pt-alert">
            <AlertTriangle size={14} />
            {pending} of {row.assessments.length} assessments are still unfiled. You can still
            decide — the scores you have are the ones you are deciding on.
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
            <p className="sm" style={{ margin: 0 }}>
              This site goes forward. Where do you want to carry on?
            </p>

            <div className="psel-routes">
              {ROUTES.map((r) => {
                const Icon = r.icon;
                const on = route === r.key;
                return (
                  <button
                    key={r.key}
                    type="button"
                    className={`psel-route${on ? ' is-on' : ''}`}
                    onClick={() => setRoute(r.key)}
                    aria-pressed={on}
                  >
                    <span className="psel-route-top">
                      <Icon size={17} />
                      <b>{r.title}</b>
                      {on && <Check size={15} className="psel-route-tick" />}
                    </span>
                    <span className="psel-route-blurb">{r.blurb}</span>
                  </button>
                );
              })}
            </div>

            {/* The honest footnote. Both desks open on approval whichever card
                is picked, so the choice must not be read as a gate — somebody
                who picks games and then discovers closure was skipped for
                them would have been misled by this dialog. */}
            <p className="psel-route-note">
              <AlertTriangle size={12} />
              Either way the six commercial documents open as drafts and both steps
              list this site. The choice is where you go next, not what is skipped —
              closure still has to happen before the outlet opens.
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}

export default PropertyApproveModal;
