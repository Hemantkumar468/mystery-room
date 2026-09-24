import { createSlice } from '@reduxjs/toolkit';

/**
 * "Which project is the sidebar in context of" — replaces
 * `store/projectContextStore.js` (Zustand), which is deleted in this phase.
 *
 * The URL (`/projects/:id/...`) is still the source of truth whenever it's
 * present; this is what lets the selection survive navigating to a route
 * with no `:id` (Dashboard) and survive a reload. `sidebarExpanded` used to
 * live here too — it has moved into `uiSlice`, alongside the sidebar's other
 * half (`sidebarCollapsed`), which used to live in `AppShell`'s own
 * `useState` + a hand-written `localStorage` key. One concept, one slice now.
 */
const STORAGE_KEY = 'mr-erp-project-context-v2';
const LEGACY_KEY = 'mr-erp-project-context';

function loadPersisted() {
  try {
    const current = localStorage.getItem(STORAGE_KEY);
    if (current) return JSON.parse(current);

    // Carry over an existing Zustand-persisted selection so a reload doesn't
    // drop the user's place mid-migration.
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy)?.state;
      localStorage.removeItem(LEGACY_KEY);
      if (parsed) return { selectedProjectId: parsed.selectedProjectId ?? null };
    }
  } catch {
    // Corrupt storage — start with nothing selected rather than crashing.
  }
  return { selectedProjectId: null };
}

const initialState = loadPersisted();

const projectContextSlice = createSlice({
  name: 'projectContext',
  initialState,
  reducers: {
    selectedProjectSet: (state, action) => {
      state.selectedProjectId = action.payload ?? null;
    },
  },
});

export const { selectedProjectSet } = projectContextSlice.actions;

export const selectSelectedProjectId = (state) => state.projectContext.selectedProjectId;

export default projectContextSlice.reducer;
