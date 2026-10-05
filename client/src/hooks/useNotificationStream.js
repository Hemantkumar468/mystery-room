import { useEffect, useRef } from 'react';
import { useDispatch } from 'react-redux';
import { baseApi } from '../app/api/baseApi.js';
import { api } from '../lib/api.js';

/**
 * THE BELL, LIVE.
 *
 * Holds one request open against `/pms/notifications/stream` until something
 * actually lands for this person, then invalidates the notification cache so
 * the bell and its badge redraw, then immediately asks again. The round trip
 * after a write is a few hundred milliseconds rather than the up-to-thirty
 * seconds the old polling interval allowed.
 *
 * WHY NOT A SOCKET. The access token lives in localStorage; `EventSource`
 * cannot send an Authorization header and a token in a query string is
 * written into every access log. A long poll is an ordinary authenticated GET
 * — no new auth path, no protocol upgrade, and nothing a reverse proxy has to
 * be taught. That is what makes it behave the same on a laptop as behind
 * whatever fronts production. The same reasoning, and the same shape, as the
 * CRM screen-pop in useIncomingCall.js.
 *
 * THE 30s POLL STAYS, as a floor rather than as the mechanism. If a proxy
 * refuses to hold the request, or the browser suspends a background tab, the
 * stream degrades to silence — and silence from a notification system looks
 * exactly like having no notifications. The interval underneath means the
 * worst case is the old behaviour, never worse.
 *
 * FAILURE IS BACKED OFF, NOT RETRIED HARD. A server restart or a dropped
 * network would otherwise turn this into a request loop against a box that is
 * already struggling, so each consecutive failure waits longer, to a ceiling.
 */

const MAX_BACKOFF_MS = 30_000;

export function useNotificationStream(enabled = true) {
  const dispatch = useDispatch();
  /* Read in the loop but never a reason to restart it — a ref, so changing
     the cursor does not tear down the in-flight request. */
  const since = useRef(new Date().toISOString());

  useEffect(() => {
    if (!enabled) return undefined;

    let stopped = false;
    let timer = null;
    let failures = 0;

    const run = async () => {
      while (!stopped) {
        try {
          /* `wait` is the server's cap too; it answers 204 when the window
             closes quietly, which is the common case and not an error. */
          // eslint-disable-next-line no-await-in-loop
          const res = await api.get('/pms/notifications/stream', {
            params: { since: since.current, wait: 25000 },
            timeout: 35000,
          });
          failures = 0;
          if (stopped) return;

          if (res.status === 200) {
            /* Move the cursor PAST what we were told about, so the next poll
               does not return the same row forever. The server sends the
               row's own timestamp rather than "now" for exactly this. */
            const at = res.data?.data?.at;
            if (at) since.current = new Date(at).toISOString();
            dispatch(baseApi.util.invalidateTags([
              { type: 'Notification', id: 'LIST' },
              { type: 'Notification', id: 'UNREAD_COUNT' },
            ]));
          }
        } catch {
          if (stopped) return;
          failures += 1;
          const backoff = Math.min(MAX_BACKOFF_MS, 1000 * (2 ** Math.min(failures, 5)));
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => { timer = setTimeout(r, backoff); });
        }
      }
    };

    run();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [dispatch, enabled]);
}

export default useNotificationStream;
