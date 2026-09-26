import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * UI state shared by the Delegation / Checklist / Performance screens.
 *
 * `branch` is the "headquarters-wise" partition every list is filtered by:
 *   ''     → my home branch (the server resolves it)
 *   'all'  → every branch (admins and managers)
 *   <id>   → one specific branch
 */
export const useOpsStore = create(
  persist(
    (set) => ({
      branch: '',
      setBranch: (branch) => set({ branch }),
      taskView: 'list', // list | board | calendar
      setTaskView: (taskView) => set({ taskView }),
    }),
    { name: 'mr-erp-ops' },
  ),
);

export default useOpsStore;
