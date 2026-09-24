import { isValidElement } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { landingPathFor } from '../../lib/navPolicy.js';

/**
 * "Go back" that cannot strand the user.
 *
 * `navigate(-1)` alone is wrong for the two cases that actually happen here:
 * a deep link opened in a fresh tab (a notification, a shared filtered list)
 * and a post-login redirect. In both there is no previous in-app entry, so -1
 * either does nothing or walks the user out of the app entirely.
 *
 * React Router stamps an index on every history entry it creates
 * (`window.history.state.idx`), so idx > 0 is a reliable "there is somewhere
 * of ours to go back to". When there isn't, we fall back to the user's own
 * landing page rather than a hardcoded "/" — an Employee's home is My Tasks,
 * not the portfolio dashboard. See lib/navPolicy.js#landingPathFor.
 */
export function useGoBack(fallback) {
  const navigate = useNavigate();
  // Subscribed to deliberately: history.state is not reactive, and this is
  // what re-reads it after each navigation.
  const { pathname } = useLocation();
  const user = useAppSelector(selectCurrentUser);
  const home = fallback || landingPathFor(user);

  const historyIdx = typeof window !== 'undefined' ? window.history.state?.idx : undefined;
  const hasHistory = typeof historyIdx === 'number' && historyIdx > 0;

  const goBack = () => {
    if (hasHistory) navigate(-1);
    else navigate(home, { replace: true });
  };

  // The one case with genuinely nowhere to go: the session's first page, and
  // it is already home. Everywhere else, back means something.
  return { goBack, hasHistory, home, atHome: pathname === home };
}

/**
 * The back affordance itself. `to` pins it to a specific destination (a detail
 * page that should always return to its list, however you arrived); without it
 * the button walks browser history, which is what most pages want.
 */
export function BackButton({ to, fallback, label = 'Back', className = '' }) {
  const navigate = useNavigate();
  const { goBack } = useGoBack(fallback);

  return (
    <button
      type="button"
      className={`btn btn-ghost btn-icon back-btn ${className}`.trim()}
      onClick={() => (to ? navigate(to) : goBack())}
      aria-label={label}
      title={label}
    >
      <ArrowLeft size={16} />
    </button>
  );
}

/**
 * Does this title node already carry its own back control?
 *
 * ~30 pages (project detail, task detail, every report) render a back arrow
 * inside the title they hand to Topbar, each with a destination of its own
 * ("back to project", "back to the list"). Topbar now provides one for every
 * page, so it has to recognise those and stand down rather than paint a second
 * arrow beside theirs. Matching on ArrowLeft's component identity works
 * because those pages import it from the same lucide-react module instance we
 * do; the aria-label check catches the few that wrap it in something else.
 */
export function containsBackControl(node, depth = 0) {
  if (node == null || depth > 8) return false;
  if (Array.isArray(node)) return node.some((child) => containsBackControl(child, depth + 1));
  if (!isValidElement(node)) return false;
  if (node.type === ArrowLeft) return true;
  const aria = node.props?.['aria-label'];
  if (typeof aria === 'string' && /^back\b/i.test(aria)) return true;
  return containsBackControl(node.props?.children, depth + 1);
}

export default BackButton;
