import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * The sidebar's "which project am I in" state. The URL (`/projects/:id/...`)
 * is still the source of truth whenever it's present — this store is what
 * lets the selection survive navigating to a route with no `:id` (e.g.
 * Dashboard) and survive a refresh.
 */
export const useProjectContextStore = create(
  persist(
    (set) => ({
      selectedProjectId: null,
      sidebarExpanded: false,
      setSelectedProject: (id) => set({ selectedProjectId: id }),
      setSidebarExpanded: (v) => set({ sidebarExpanded: v }),
    }),
    {
      name: 'mr-erp-project-context',
      partialize: (s) => ({ selectedProjectId: s.selectedProjectId, sidebarExpanded: s.sidebarExpanded }),
    },
  ),
);

export default useProjectContextStore;
