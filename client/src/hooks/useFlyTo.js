import { useEffect, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '../app/hooks.js';
import { selectFlyTarget, selectTourMode, flyConsumed } from '../app/slices/mapSlice.js';
import { CITY_VIEW } from '../features/network/mapStyles.js';

/**
 * Does the browser want us to stop moving things?
 *
 * Checked live rather than cached: the OS setting can change while the tab is
 * open, and a user who turns motion off mid-session means it now.
 */
export function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Camera intent → camera movement, plus the idle orbit.
 *
 * Redux holds the *request* to move (`flyTarget`); this consumes it and clears
 * it, so the same request cannot fire twice on an unrelated re-render. See
 * mapSlice's note on `flySeq` for why a repeat request to the same coordinates
 * still counts as a new one.
 *
 * ACCESSIBILITY. `prefers-reduced-motion: reduce` turns a flight into an
 * instant `jumpTo` and disables the orbit entirely. A slow camera glide across
 * a country is exactly the kind of motion that setting exists to stop, and the
 * user still gets where they asked to go — just without the ride.
 *
 * @param {?object} map the maplibre-gl Map instance
 */
export function useFlyTo(map) {
  const dispatch = useAppDispatch();
  const target = useAppSelector(selectFlyTarget);
  const tourMode = useAppSelector(selectTourMode);
  const orbitRef = useRef(null);

  /* ── Consume a fly request ─────────────────────────────────────────── */
  useEffect(() => {
    if (!map || !target) return;

    /*
     * A `bounds` target means "fit this whole thing on screen", and it is
     * handed to MapLibre's own fitBounds rather than converted to a zoom here.
     *
     * The previous version computed a zoom from the bounds' width with a bit
     * of arithmetic, which cannot work: the right zoom depends on the
     * viewport's aspect ratio, and a country that fits a wide monitor has its
     * top and bottom cut off on a tall one. fitBounds knows the viewport;
     * a formula in this file does not.
     *
     * Pitch is forced to 0 for a fit. A tilted camera brings the near edge
     * closer while the far edge runs to the horizon, so the southern tip goes
     * off the bottom of a view that "fits" on paper. Fitting is a promise that
     * the whole thing is visible, and tilt breaks that promise — the tilt
     * button is right there once you have arrived.
     */
    if (target.bounds) {
      const options = {
        padding: target.padding ?? 48,
        pitch: 0,
        bearing: 0,
        duration: prefersReducedMotion() ? 0 : (target.duration ?? 1800),
        essential: true,
      };
      map.fitBounds(target.bounds, options);
      dispatch(flyConsumed());
      return;
    }

    const camera = {
      center: [target.lng, target.lat],
      zoom: target.zoom ?? CITY_VIEW.zoom,
      pitch: target.pitch ?? CITY_VIEW.pitch,
      bearing: target.bearing ?? CITY_VIEW.bearing,
    };

    if (prefersReducedMotion()) {
      map.jumpTo(camera);
    } else {
      map.flyTo({ ...camera, duration: target.duration ?? 2200, essential: true });
    }

    dispatch(flyConsumed());
  }, [map, target, dispatch]);

  /* ── Idle orbit ────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!map || !tourMode || prefersReducedMotion()) return undefined;

    let raf = null;
    let last = null;
    // Degrees per second. Slow enough to read as "alive" rather than "spinning".
    const RATE = 3;

    const step = (now) => {
      if (last !== null) {
        const dt = (now - last) / 1000;
        // Guard against the huge dt a backgrounded tab produces on return,
        // which would otherwise whip the camera round several times at once.
        if (dt < 0.5) map.setBearing(map.getBearing() + RATE * dt);
      }
      last = now;
      raf = requestAnimationFrame(step);
    };

    // Any interaction stops the tour: the user taking the wheel always wins.
    const stop = () => { if (raf) cancelAnimationFrame(raf); raf = null; };
    map.on('mousedown', stop);
    map.on('touchstart', stop);
    map.on('wheel', stop);

    raf = requestAnimationFrame(step);

    return () => {
      stop();
      map.off('mousedown', stop);
      map.off('touchstart', stop);
      map.off('wheel', stop);
    };
  }, [map, tourMode]);

  useEffect(() => () => {
    if (orbitRef.current) cancelAnimationFrame(orbitRef.current);
  }, []);
}

export default useFlyTo;
