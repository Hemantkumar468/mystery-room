import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { TaskDetailDrawer } from './TaskDetailDrawer.jsx';
import { TaskFormModal } from './TaskFormModal.jsx';
import { TaskExplorer } from './TaskExplorer.jsx';

/* Frozen at module scope, NOT inlined in the JSX. TaskExplorer memoises its
   query on `baseParams`, so a new object literal every render would change
   the dependency every render and refetch in a loop. */
const MINE = Object.freeze({ view: 'mine' });

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};


/* Three components lived here — `MyTasks` (a bespoke list of your open
   delegations), `ChecklistToday` and `SimpleList` — plus the five-tab
   switcher that chose between them. The list is now TaskExplorer, the same
   workspace every other delegation view uses, and its one-tap Start / Done
   moved into the shared TaskList (see QuickActions in TaskViews.jsx) so no
   doer lost them. The other four tabs were second roads to pages the
   sidebar already reaches. */

export function MyWorkPage() {
  const user = useAppSelector(selectCurrentUser);
  const { taskId } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const openId = params.get('task') || taskId;

  const openTask = (id) => {
    const next = new URLSearchParams(params);
    next.set('task', id);
    setParams(next);
  };

  const closeTask = () => {
    if (taskId) navigate('/delegation/my-work', { replace: true });
    else {
      const next = new URLSearchParams(params);
      next.delete('task');
      setParams(next);
    }
  };

  return (
    <>
      {/**
        * NO VIEW SWITCHER AT ALL, in the bar or above the cards.
        *
        * It held five tabs: My tasks, Checklist, Approvals, In the loop,
        * Groups. Four of those five already exist as their own sidebar
        * entries — In the loop, Groups and the whole Checklist module are
        * one click away on the left, and a second road to the same page
        * earns its keep only if it is quicker, which a tab beside a title
        * is not. The fifth, Awaiting my approval, is Delegated by me
        * filtered to Awaiting Verification, and that filter is one of the
        * status tabs on that page.
        *
        * So the page is one thing now: your own tasks, in the workspace
        * every other delegation view uses.
        */}
      <Topbar
        title="My Work"
        subtitle={`${greeting()}, ${user?.name?.split(' ')[0] || ''} — here's what needs you today`}
        /* NO BRANCH SWITCHER. Removed by request: every delegation view
           still reads whatever branch is stored (useOpsStore), so nothing
           changes about WHAT is listed — this only takes away a control
           nobody was using from a bar that had five things in it. The
           Checklist and Performance pages keep theirs. */
        actions={
          user?.role !== 'viewer'
            ? <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> Assign task</button>
            : null
        }
      />
      <div className="content">
        <div className="content-narrow col gap-5 fade-in">
          {/* Nothing above the cards: the page opens on the figures. */}
          <TaskExplorer
            baseParams={MINE}
            /* The doer is always you on this view, so filtering by doer
               would be a control with one answer. */
            hideFilters={['doer']}
            show={{ doer: false, assigner: true }}
            emptyHint="Nothing assigned to you right now. Tasks people hand you appear here."
          />
        </div>
      </div>

      <TaskDetailDrawer taskId={openId} onClose={closeTask} onOpenTask={openTask} />
      <TaskFormModal open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

export default MyWorkPage;
