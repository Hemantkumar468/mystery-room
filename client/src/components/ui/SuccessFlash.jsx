import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';

/**
 * A moment of acknowledgement.
 *
 * Submitting a form used to be silent: the modal closed and nothing on screen
 * said "that worked" — the site supervisor who files the daily report
 * literally could not tell whether it went through. The corner toast exists,
 * but it is easy to miss at the moment of the click.
 *
 * This is a centred, ~1.5 second flash — a green check that pops in, then
 * fades — fired via `flashSuccess('Daily Site Report submitted')` from
 * anywhere. Mounted ONCE by AppShell, so it survives the closing of whatever
 * modal triggered it. `pointer-events: none` throughout: it is feedback, and
 * must never get between the user and their next click.
 */

const EVENT = 'app:success-flash';
const VISIBLE_MS = 1500;

/** Show the flash. Safe to call from anywhere, even as a modal unmounts. */
export const flashSuccess = (message = 'Done') => {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { message } }));
};

export function SuccessFlash() {
  const [flash, setFlash] = useState(null); // { message, id }

  useEffect(() => {
    const onFlash = (e) => setFlash({ message: e.detail?.message || 'Done', id: Date.now() });
    window.addEventListener(EVENT, onFlash);
    return () => window.removeEventListener(EVENT, onFlash);
  }, []);

  useEffect(() => {
    if (!flash) return undefined;
    const t = setTimeout(() => setFlash(null), VISIBLE_MS);
    return () => clearTimeout(t);
  }, [flash]);

  if (!flash) return null;

  return (
    <div className="success-flash" role="status" aria-live="polite" key={flash.id}>
      <div className="success-flash-card">
        <span className="success-flash-badge"><Check size={30} strokeWidth={3} /></span>
        <span className="success-flash-text">{flash.message}</span>
      </div>
    </div>
  );
}

export default SuccessFlash;
