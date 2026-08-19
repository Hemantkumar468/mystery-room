import { useEffect, useRef, useState } from 'react';
import { useAppSelector } from '../../app/hooks.js';
import { selectAccessToken } from '../../app/slices/authSlice.js';

/**
 * Watches for a call ringing for this agent.
 *
 * A LONG POLL, deliberately, and written by hand rather than through RTK Query:
 * the request is *meant* to hang for 25 seconds and then immediately be
 * reissued, which is the opposite of what a cache does. RTK would dedupe,
 * cache and refetch on focus — all wrong for an event that must be delivered
 * exactly once, the moment it happens.
 *
 * Not a socket, because the access token lives in memory/localStorage and
 * `EventSource` cannot send an Authorization header; a token in a query string
 * ends up in every access log between here and the server.
 *
 * The loop stops on unmount and while the tab is hidden — an agent who is not
 * looking at the CRM cannot see a pop, and holding a request open for every
 * background tab is pure waste.
 */
export function useIncomingCall({ enabled = true } = {}) {
  const token = useAppSelector(selectAccessToken);
  const [call, setCall] = useState(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    if (!enabled || !token) return undefined;

    // The same base the axios client uses (lib/api.js) — one definition, so a
    // deploy that changes it cannot leave this one poll pointing elsewhere.
    const base = import.meta.env.VITE_API_BASE_URL || '/api/v1';
    const controller = new AbortController();

    const poll = async () => {
      while (alive.current) {
        // Hidden tab: wait, do not hold a request open. Resumes on its own
        // when the agent comes back, because the ring is a row with a TTL
        // rather than an event that has already gone past.
        if (document.visibilityState === 'hidden') {
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }

        try {
          // eslint-disable-next-line no-await-in-loop
          const res = await fetch(`${base}/crm/telephony/ringing?wait=25000`, {
            headers: { Authorization: `Bearer ${token}` },
            credentials: 'include',
            signal: controller.signal,
          });

          if (res.status === 204) continue;       // quiet period — ask again
          if (!res.ok) {
            // A 401 means the session went; anything else is probably the
            // server restarting. Back off rather than hammering it.
            // eslint-disable-next-line no-await-in-loop
            await new Promise((r) => setTimeout(r, res.status === 401 ? 30000 : 5000));
            continue;
          }

          // eslint-disable-next-line no-await-in-loop
          const body = await res.json();
          if (body?.data && alive.current) setCall(body.data);
        } catch (err) {
          if (err.name === 'AbortError') return;
          // Network dropped, or the long poll was cut by a proxy. Both are
          // normal; wait a moment and reconnect.
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, 4000));
        }
      }
      return undefined;
    };

    poll();

    return () => {
      alive.current = false;
      controller.abort();
    };
  }, [enabled, token]);

  return { call, dismiss: () => setCall(null) };
}

export default useIncomingCall;
