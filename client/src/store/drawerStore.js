import { create } from 'zustand';

/**
 * A stack of detail drawers for the Delegation & Checklist modules. Any KPI
 * card or row can push a drawer — a drill-down list, a task, a checklist
 * occurrence, a routine, a repeat rule — on top of whatever is showing, and
 * closing one reveals the one beneath (the NIA drill-down pattern).
 *
 * Entries:
 *   { type: 'drill', drill: { kind: 'delegation'|'checklist', label, description, params, onShowInList? } }
 *   { type: 'task', id }
 *   { type: 'checklistTask', id }
 *   { type: 'routine', id }
 *   { type: 'recurrence', id }
 */
export const useDrawerStore = create((set) => ({
  stack: [],
  open: (entry) => set((s) => ({ stack: [...s.stack, { key: Math.random().toString(36).slice(2), ...entry }] })),
  /** Swap the top drawer's content (e.g. jump from a task to its sub-task). */
  replaceTop: (entry) =>
    set((s) => ({ stack: [...s.stack.slice(0, -1), { key: Math.random().toString(36).slice(2), ...entry }] })),
  close: (key) => set((s) => ({ stack: s.stack.filter((e) => e.key !== key) })),
  closeAll: () => set({ stack: [] }),
}));

/** Shorthands usable from any component (no hook needed). */
export const drawers = {
  drill: (drill) => useDrawerStore.getState().open({ type: 'drill', drill }),
  task: (id) => useDrawerStore.getState().open({ type: 'task', id }),
  checklistTask: (id) => useDrawerStore.getState().open({ type: 'checklistTask', id }),
  routine: (id) => useDrawerStore.getState().open({ type: 'routine', id }),
  recurrence: (id) => useDrawerStore.getState().open({ type: 'recurrence', id }),
};

export default useDrawerStore;
