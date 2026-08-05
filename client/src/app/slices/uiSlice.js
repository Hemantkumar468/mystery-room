import { createSlice } from '@reduxjs/toolkit';

/**
 * Cross-cutting UI chrome: sidebar, theme, and a registry for genuinely
 * global modals.
 *
 * Scope note — this slice is deliberately NOT a home for the ~240 `useState`
 * calls in the app. Form drafts, dropdown open/closed, and page-local filters
 * are correct as local state and stay there. Only state that is shared across
 * routes, needed by middleware, or currently duplicated belongs here.
 *
 * The two things below qualify on the "currently duplicated" ground:
 *
 *   sidebar — today `AppShell.jsx` keeps `collapsed` in `useState` and
 *   hand-writes localStorage['mr-sidebar-collapsed'], while
 *   `store/projectContextStore.js` separately persists `sidebarExpanded`.
 *   One concept, two mechanisms, no single source of truth.
 *
 *   theme — `hooks/useTheme.js` holds it in a per-instance `useState`. It
 *   only works because there is exactly one consumer; a second would desync
 *   immediately, since the real shared channel is the DOM attribute plus
 *   localStorage.
 *
 * PHASE 1: created and wired into the store, but NOT yet consumed by
 * AppShell/Sidebar/ThemeToggle. Switching those components over is a
 * separate, reviewable change so this phase cannot alter what renders.
 */
function loadPersisted() {
  let sidebarCollapsed = false;
  let theme = 'light';
  let activeModuleKey = null;
  try {
    sidebarCollapsed = localStorage.getItem('mr-sidebar-collapsed') === '1';
    theme = localStorage.getItem('mr-erp-theme') === 'dark' ? 'dark' : 'light';
    activeModuleKey = localStorage.getItem('mr-sidebar-active-module') || null;
  } catch {
    // Private-mode/quota failures — fall back to defaults.
  }
  return { sidebarCollapsed, theme, activeModuleKey };
}

const initialState = {
  ...loadPersisted(),
  /** Whether the sidebar's phase submenu is expanded. */
  sidebarExpanded: false,
  /**
   * Global modal registry: { key, props } or null. Only for modals that must
   * be openable from outside the component that renders them. Page-local
   * modals (confirm dialogs, record forms) keep their own useState.
   */
  activeModal: null,
};

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    sidebarCollapsedSet: (state, action) => {
      state.sidebarCollapsed = Boolean(action.payload);
    },
    sidebarCollapsedToggled: (state) => {
      state.sidebarCollapsed = !state.sidebarCollapsed;
    },
    sidebarExpandedSet: (state, action) => {
      state.sidebarExpanded = Boolean(action.payload);
    },
    /**
     * Which sidebar ModuleNavGroup (EMS today, more later) is open. A single
     * key rather than a set — setting one implicitly closes any other, which
     * is the accordion behavior itself; no separate "close others" step
     * needed. Not the same state as `sidebarExpanded` (PMS's Projects phase
     * submenu), which stays its own concern.
     */
    activeModuleSet: (state, action) => {
      state.activeModuleKey = action.payload || null;
    },
    themeSet: (state, action) => {
      state.theme = action.payload === 'dark' ? 'dark' : 'light';
    },
    themeToggled: (state) => {
      state.theme = state.theme === 'light' ? 'dark' : 'light';
    },
    modalOpened: (state, action) => {
      state.activeModal = { key: action.payload.key, props: action.payload.props ?? null };
    },
    modalClosed: (state) => {
      state.activeModal = null;
    },
  },
});

export const {
  sidebarCollapsedSet,
  sidebarCollapsedToggled,
  sidebarExpandedSet,
  activeModuleSet,
  themeSet,
  themeToggled,
  modalOpened,
  modalClosed,
} = uiSlice.actions;

export const selectSidebarCollapsed = (state) => state.ui.sidebarCollapsed;
export const selectSidebarExpanded = (state) => state.ui.sidebarExpanded;
export const selectActiveModuleKey = (state) => state.ui.activeModuleKey;
export const selectTheme = (state) => state.ui.theme;
export const selectActiveModal = (state) => state.ui.activeModal;

export default uiSlice.reducer;
