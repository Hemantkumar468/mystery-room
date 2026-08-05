import { FileBarChart } from 'lucide-react';
import { ModulePageShell } from '../../components/layout/ModulePageShell.jsx';
import { EmptyState } from '../../components/ui/primitives.jsx';
import { useCurrentRouteMeta, useBreadcrumbTrail } from '../../lib/moduleRoutes.jsx';
import { emsRoutesConfig } from './config/ems.routes.config.js';

export function ReportsPage() {
  const route = useCurrentRouteMeta(emsRoutesConfig);
  const trail = useBreadcrumbTrail(emsRoutesConfig);
  return (
    <ModulePageShell title={route?.title} subtitle={route?.description} breadcrumbTrail={trail}>
      <EmptyState
        icon={FileBarChart}
        title="Reports & Analytics"
        hint="This screen ships in Step 8 — Reports & Analytics."
      />
    </ModulePageShell>
  );
}

export default ReportsPage;
