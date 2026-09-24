/**
 * Canonical responsive breakpoints — the single source of truth for JS-side
 * layout decisions (e.g. AppShell swapping the sidebar for a bottom nav).
 * Mirrored as a comment in styles/tokens.css, since CSS custom properties
 * can't be read inside @media conditions — every @media rule in the
 * stylesheets hardcodes one of these same four pixel values.
 */
export const BREAKPOINTS = {
  mobile: 767, // 0–767px
  tablet: 1023, // 768–1023px
  laptop: 1439, // 1024–1439px
  // desktop is everything above `laptop`
};

/** `width` → 'mobile' | 'tablet' | 'laptop' | 'desktop'. */
export function breakpointOf(width) {
  if (width <= BREAKPOINTS.mobile) return 'mobile';
  if (width <= BREAKPOINTS.tablet) return 'tablet';
  if (width <= BREAKPOINTS.laptop) return 'laptop';
  return 'desktop';
}
