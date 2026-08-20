import { Outlet } from 'react-router-dom';
import { useIncomingCall } from './useIncomingCall.js';
import { IncomingCallCard } from './IncomingCallCard.jsx';
import './crm.css';

/**
 * The CRM module's shell.
 *
 * Thin on purpose — the sidebar, topbar and breadcrumbs already come from the
 * app shell, and a module that adds its own chrome is a module whose pages
 * look different from the rest of the app for no reason.
 *
 * It does own ONE thing: the screen-pop. Mounting the poll here rather than on
 * a page means it survives navigation between CRM screens — a call arriving
 * while an agent moves from the board to a lead must still pop, and a hook
 * living on a page would be torn down and restarted on every route change,
 * missing exactly the calls that land in between.
 */
export function CrmLayout() {
  const { call, dismiss } = useIncomingCall();

  return (
    <>
      <Outlet />
      <IncomingCallCard call={call} onDismiss={dismiss} />
    </>
  );
}

export default CrmLayout;
