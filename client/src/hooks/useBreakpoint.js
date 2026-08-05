import { useEffect, useState } from "react";
import { BREAKPOINTS, breakpointOf } from "../lib/breakpoints.js";

/**
 * Live viewport breakpoint — 'mobile' | 'tablet' | 'laptop' | 'desktop'.
 * Backed by matchMedia (not a resize listener) so it only re-renders on an
 * actual breakpoint crossing, not on every pixel of a window resize/drag.
 */
export function useBreakpoint() {
  const [breakpoint, setBreakpoint] = useState(() =>
    typeof window === "undefined" ? "desktop" : breakpointOf(window.innerWidth),
  );

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const queries = [
      window.matchMedia(`(max-width: ${BREAKPOINTS.mobile}px)`),
      window.matchMedia(`(max-width: ${BREAKPOINTS.tablet}px)`),
      window.matchMedia(`(max-width: ${BREAKPOINTS.laptop}px)`),
    ];
    const update = () => setBreakpoint(breakpointOf(window.innerWidth));
    update();
    queries.forEach((mq) => mq.addEventListener("change", update));
    return () =>
      queries.forEach((mq) => mq.removeEventListener("change", update));
  }, []);

  return breakpoint;
}

export const useIsMobile = () => useBreakpoint() === "mobile";
export const useIsTablet = () => useBreakpoint() === "tablet";
