import { createListenerMiddleware } from '@reduxjs/toolkit';
import { selectedProjectSet } from '../slices/projectContextSlice.js';
import {
  sidebarCollapsedSet,
  sidebarCollapsedToggled,
  activeModuleSet,
  themeSet,
  themeToggled,
} from '../slices/uiSlice.js';

/**
 * Persists the small pieces of UI state that need to survive a reload.
 * Reducers stay pure (see the note in authPersistence.js for why); this is
 * the one place that writes to localStorage and the DOM.
 */
export const uiListener = createListenerMiddleware();

uiListener.startListening({
  actionCreator: selectedProjectSet,
  effect: (action) => {
    try {
      localStorage.setItem('mr-erp-project-context-v2', JSON.stringify({ selectedProjectId: action.payload ?? null }));
    } catch { /* ignore */ }
  },
});

uiListener.startListening({
  matcher: (a) => a.type === sidebarCollapsedSet.type || a.type === sidebarCollapsedToggled.type,
  effect: (_action, api) => {
    try {
      localStorage.setItem('mr-sidebar-collapsed', api.getState().ui.sidebarCollapsed ? '1' : '0');
    } catch { /* ignore */ }
  },
});

uiListener.startListening({
  actionCreator: activeModuleSet,
  effect: (_action, api) => {
    try {
      localStorage.setItem('mr-sidebar-active-module', api.getState().ui.activeModuleKey || '');
    } catch { /* ignore */ }
  },
});

uiListener.startListening({
  matcher: (a) => a.type === themeSet.type || a.type === themeToggled.type,
  effect: (_action, api) => {
    const theme = api.getState().ui.theme;
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('mr-erp-theme', theme);
    } catch { /* ignore */ }
  },
});

export default uiListener;
