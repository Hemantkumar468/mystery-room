import { useNavigate } from 'react-router-dom';
import { PhoneIncoming, X, UserPlus, ArrowRight } from 'lucide-react';
import { Avatar, Badge } from '../../components/ui/primitives.jsx';

/**
 * The screen-pop.
 *
 * THE FEATURE THAT KEEPS THE CRM OPEN. Everything else in the module saves an
 * agent a few seconds; this one tells them who is calling *before* they say
 * hello, and that is the thing people notice and remember.
 *
 * It is therefore allowed to be the loudest element on screen — fixed, above
 * everything, and animated in. It is also allowed to be dismissed instantly,
 * because a pop you cannot get rid of during a call is worse than none.
 *
 * An UNKNOWN caller still pops, with a "create a lead" action. That is the
 * case where knowing nothing hurts most, and the one most likely to be new
 * business.
 */

const fmtPhone = (p) => {
  if (!p?.startsWith('+91')) return p || '';
  const n = p.slice(3);
  return n.length === 10 ? `+91 ${n.slice(0, 5)} ${n.slice(5)}` : p;
};

export function IncomingCallCard({ call, onDismiss }) {
  const navigate = useNavigate();
  if (!call) return null;

  const known = call.matchType !== 'unknown' && call.matchName;

  const open = () => {
    onDismiss();
    if (call.matchType === 'lead') navigate(`/crm/leads?open=${call.matchId}`);
    else if (call.matchType === 'contact') navigate(`/crm/contacts?open=${call.matchId}`);
  };

  return (
    <div className="crm-pop" role="alert" aria-live="assertive">
      <div className="crm-pop__ring"><PhoneIncoming size={18} aria-hidden /></div>

      <div className="crm-pop__body">
        <span className="crm-pop__label">Incoming call</span>

        {known ? (
          <>
            <strong className="crm-pop__name">
              <Avatar name={call.matchName} size={22} />
              {call.matchName}
            </strong>
            {call.matchSummary && <span className="crm-muted">{call.matchSummary}</span>}
          </>
        ) : (
          <>
            <strong className="crm-pop__name">{fmtPhone(call.from)}</strong>
            <span className="crm-muted">Not in the CRM yet</span>
          </>
        )}

        <span className="crm-pop__meta">
          <Badge color="var(--text-subtle)" soft="var(--surface-2)">{fmtPhone(call.from)}</Badge>
          {known && (
            <Badge color="var(--primary)" soft="var(--surface-2)">{call.matchType}</Badge>
          )}
        </span>
      </div>

      <div className="crm-pop__actions">
        {known ? (
          <button type="button" className="btn btn-primary btn-sm" onClick={open}>
            Open <ArrowRight size={14} />
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            // Carries the number through, so the agent is not retyping it
            // from a screen while the caller waits.
            onClick={() => { onDismiss(); navigate(`/crm/leads?new=${encodeURIComponent(call.from)}`); }}
          >
            <UserPlus size={14} /> Add as lead
          </button>
        )}
        <button
          type="button" className="btn btn-ghost btn-icon btn-sm"
          onClick={onDismiss} aria-label="Dismiss"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

export default IncomingCallCard;
