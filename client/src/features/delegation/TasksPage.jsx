import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { BranchSwitcher } from '../../components/ops/BranchSwitcher.jsx';
import { useAuthStore } from '../../store/authStore.js';
import { TaskExplorer } from './TaskExplorer.jsx';
import { TaskFormModal } from './TaskFormModal.jsx';

const MODES = {
  delegated: {
    title: 'Delegated by me',
    subtitle: 'Work you handed out — approve submissions, chase what is late',
    params: { view: 'delegated' },
    hide: ['assigner'],
    show: { doer: true, assigner: false },
    empty: 'Nothing delegated yet. Use "Assign task" to hand work to someone.',
  },
  loop: {
    title: 'In the loop',
    subtitle: "Tasks you follow but don't own",
    params: { view: 'loop' },
    hide: [],
    show: { doer: true, assigner: true },
    empty: 'Nobody has looped you into a task yet.',
  },
  all: {
    title: 'All tasks',
    subtitle: 'Every delegation you can see — filter by branch, team or group',
    params: {},
    hide: [],
    show: { doer: true, assigner: true },
  },
};

export function TasksPage({ mode = 'all' }) {
  const cfg = MODES[mode];
  const [creating, setCreating] = useState(false);
  const role = useAuthStore((s) => s.user?.role);
  return (
    <>
      <Topbar
        title={cfg.title}
        subtitle={cfg.subtitle}
        actions={
          <div className="row gap-2">
            <BranchSwitcher />
            {role !== 'viewer' && (
              <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> Assign task</button>
            )}
          </div>
        }
      />
      <div className="content">
        <div className="content-narrow fade-in">
          <TaskExplorer
            key={mode}
            baseParams={cfg.params}
            hideFilters={cfg.hide}
            show={cfg.show}
            emptyHint={cfg.empty}
            showAssignedBy={mode !== 'delegated'}
          />
        </div>
      </div>
      <TaskFormModal open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

export default TasksPage;
