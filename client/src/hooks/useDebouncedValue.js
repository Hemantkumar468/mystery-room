import { useEffect, useState } from 'react';

/**
 * A value that stops changing while somebody is still typing.
 *
 * WHY THIS EXISTS AS A HOOK. The capture form asks "which city?" with a free
 * text combobox, and the city it settles on is a query argument — the queue
 * of everything already filed there. Wired straight through, typing "Bhopal"
 * is six keystrokes and six requests for a hundred rows each, five of which
 * are answers to a question nobody asked ("B", "Bh", "Bho"…). On a local
 * server that is invisible. On a deployment with the API a region away it is
 * six round trips stacked behind each other, and the form reads as though it
 * is loading continuously while you type.
 *
 * ONE TIMER, RESET ON EVERY KEYSTROKE, so the request is made once the typing
 * stops rather than once per character.
 *
 * THE DELAY IS SHARED ON PURPOSE. Two components on the capture form ask the
 * same question — the panel under the field renders the answer, and the form
 * reads the same rows for its Location suggestions. They debounce with the
 * same input and the same delay, so they settle on the same value in the same
 * commit and RTK Query serves both from ONE request. Different delays would
 * quietly double the traffic.
 */
export function useDebouncedValue(value, ms = 300) {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    /* An empty value settles immediately. Clearing the field should blank the
       panel at once — waiting 300ms to show nothing is just a stutter, and
       there is no request to save. */
    if (!value) { setSettled(value); return undefined; }
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);

  return settled;
}

export default useDebouncedValue;
