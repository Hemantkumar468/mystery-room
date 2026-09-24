import { useEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

/**
 * Back lands exactly where you were.
 *
 * The browser restores scroll on Back only for the window — and this app
 * scrolls inside `.content`, so every Back landed at the top of the page. This
 * remembers `.content`'s scrollTop per history entry (`location.key`) and puts
 * it back on POP (Back/Forward); a PUSH (a click) starts at the top, as a new
 * page should.
 *
 * Restoring waits a few frames because the page that just mounted is usually
 * still fetching — scrolling before its rows exist is a no-op. It retries
 * until the saved offset is reachable or a short budget runs out.
 */
const positions = new Map();
const SCROLLER = '.content';

export function ScrollMemory() {
  const location = useLocation();
  const navType = useNavigationType();

  // Keep the current entry's position fresh as the user scrolls.
  useEffect(() => {
    const key = location.key;
    let el = null;
    const onScroll = () => { if (el) positions.set(key, el.scrollTop); };
    // The scroller belongs to the page just rendered — attach after paint.
    const raf = requestAnimationFrame(() => {
      el = document.querySelector(SCROLLER);
      el?.addEventListener('scroll', onScroll, { passive: true });
    });
    return () => {
      cancelAnimationFrame(raf);
      el?.removeEventListener('scroll', onScroll);
    };
  }, [location.key]);

  // On arrival: restore for Back/Forward, top for a fresh click.
  useEffect(() => {
    const target = navType === 'POP' ? (positions.get(location.key) ?? 0) : 0;
    let tries = 0;
    let raf;
    const attempt = () => {
      const el = document.querySelector(SCROLLER);
      if (el) {
        el.scrollTop = target;
        // Reached (or nothing to reach) → done; otherwise content is still
        // loading, try again next frame.
        if (Math.abs(el.scrollTop - target) < 2 || tries > 40) return;
      }
      tries += 1;
      raf = requestAnimationFrame(attempt);
    };
    raf = requestAnimationFrame(attempt);
    return () => cancelAnimationFrame(raf);
  }, [location.key, navType]);

  return null;
}

export default ScrollMemory;
