import { useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';
import { baseApi } from '../../app/api/baseApi.js';
import '../../styles/activity-bar.css';

/**
 * "SOMETHING IS HAPPENING" — a thin bar across the top of the app.
 *
 * WHY IT EXISTS. Press a notification, or Approve on a document, and the only
 * feedback was the result arriving. On a fast connection that is instant and
 * nothing is needed; on a slow one — or a deployment where the API is a
 * region away — it is a second or two of a screen that looks broken, and the
 * honest reading from the person using it is "did my click register?". They
 * press again, which is worse than waiting.
 *
 * WHAT IT WATCHES. Every in-flight RTK Query request, reads and writes alike,
 * because the two failures people reported were one of each: a notification
 * opening a page that then fetches (a read), and an approval that updates a
 * list (a write). Route changes count too — a lazy chunk on a cold cache is
 * a download like any other.
 *
 * WHY IT IS NOT A SPINNER IN THE MIDDLE. A blocking overlay for a 200ms
 * refetch is worse than nothing: it flashes, it steals focus, and it stops
 * people reading the page they already have. A bar at the top is visible
 * without being in the way, which is the whole job.
 *
 * THE DELAY IS THE POINT. Nothing shows for the first 220ms, so an ordinary
 * fast request never flickers a bar on screen — a loader that appears and
 * vanishes reads as a glitch, not as progress. It is only the slow case,
 * which is the only case anybody was complaining about, that ever draws.
 */

const SHOW_AFTER_MS = 220;
/* A floor on how long it stays once shown. A bar that appears for 40ms on
   its way out is the same flicker in reverse. */
const MIN_VISIBLE_MS = 320;

/** How many requests this app currently has in the air. */
const selectPending = (state) => {
  const slice = state[baseApi.reducerPath];
  if (!slice) return 0;
  let n = 0;
  for (const q of Object.values(slice.queries || {})) if (q?.status === 'pending') n += 1;
  for (const m of Object.values(slice.mutations || {})) if (m?.status === 'pending') n += 1;
  return n;
};

export function ActivityBar() {
  const pending = useSelector(selectPending);
  const { key: routeKey } = useLocation();
  const [visible, setVisible] = useState(false);

  /* A route change counts as activity even before its first request goes
     out — the lazy chunk is already downloading by then. */
  const [routeBusy, setRouteBusy] = useState(false);
  useEffect(() => {
    setRouteBusy(true);
    const t = setTimeout(() => setRouteBusy(false), 600);
    return () => clearTimeout(t);
  }, [routeKey]);

  const busy = pending > 0 || routeBusy;
  const shownAt = useRef(0);

  useEffect(() => {
    let timer;
    if (busy) {
      if (visible) return undefined;
      timer = setTimeout(() => { shownAt.current = Date.now(); setVisible(true); }, SHOW_AFTER_MS);
    } else if (visible) {
      const held = Date.now() - shownAt.current;
      timer = setTimeout(() => setVisible(false), Math.max(0, MIN_VISIBLE_MS - held));
    }
    return () => clearTimeout(timer);
  }, [busy, visible]);

  if (!visible) return null;
  return (
    <div className="act-bar" role="status" aria-live="polite" aria-label="Loading">
      <span className="act-bar-fill" />
    </div>
  );
}

export default ActivityBar;
