import { Tag } from 'lucide-react';
import { ModulePageShell } from '../../components/layout/ModulePageShell.jsx';
import { EmptyState } from '../../components/ui/primitives.jsx';
import { useCurrentRouteMeta, useBreadcrumbTrail } from '../../lib/moduleRoutes.jsx';
import { emsRoutesConfig } from './config/ems.routes.config.js';

export function ExpenseCategoriesPage() {
  const route = useCurrentRouteMeta(emsRoutesConfig);
  const trail = useBreadcrumbTrail(emsRoutesConfig);
  return (
    <ModulePageShell title={route?.title} subtitle={route?.description} breadcrumbTrail={trail}>
      <EmptyState
        icon={Tag}
        title="Expense Categories"
        hint="This screen ships alongside Step 2 — Expense Request module."
      />
    </ModulePageShell>
  );
}

export default ExpenseCategoriesPage;
