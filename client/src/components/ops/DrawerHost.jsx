import { lazy, Suspense, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useDrawerStore } from '../../store/drawerStore.js';

// Loaded on first use so the PMS screens don't carry the ops drawers.
const DrilldownDrawer = lazy(() => import('../../features/delegation/DrilldownDrawer.jsx'));
const TaskDetailDrawer = lazy(() => import('../../features/delegation/TaskDetailDrawer.jsx'));
const RecurrenceDrawer = lazy(() => import('../../features/delegation/RecurrenceDrawer.jsx'));
const ChecklistTaskDrawer = lazy(() => import('../../features/checklist/ChecklistTaskDrawer.jsx'));
const RoutineDrawer = lazy(() => import('../../features/checklist/RoutineDrawer.jsx'));

/** Renders the drawer stack; later entries sit on top. */
export function DrawerHost() {
  const { stack, close, replaceTop, closeAll } = useDrawerStore();
  const { pathname } = useLocation();

  // Navigating to another page clears any open drill-downs.
  useEffect(() => {
    closeAll();
  }, [pathname, closeAll]);

  return (
    <Suspense fallback={null}>
      {stack.map((e) => {
        const onClose = () => close(e.key);
        switch (e.type) {
          case 'drill':
            return <DrilldownDrawer key={e.key} drill={e.drill} onClose={onClose} />;
          case 'task':
            return (
              <TaskDetailDrawer
                key={e.key}
                taskId={e.id}
                onClose={onClose}
                onOpenTask={(id) => replaceTop({ type: 'task', id })}
              />
            );
          case 'recurrence':
            return <RecurrenceDrawer key={e.key} id={e.id} onClose={onClose} />;
          case 'checklistTask':
            return <ChecklistTaskDrawer key={e.key} id={e.id} onClose={onClose} />;
          case 'routine':
            return <RoutineDrawer key={e.key} id={e.id} onClose={onClose} />;
          default:
            return null;
        }
      })}
    </Suspense>
  );
}

export default DrawerHost;
