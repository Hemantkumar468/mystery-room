import { LayoutDashboard } from 'lucide-react';
import { ModulePageShell } from '../../components/layout/ModulePageShell.jsx';
import { EmptyState } from '../../components/ui/primitives.jsx';
import { useCurrentRouteMeta, useBreadcrumbTrail } from '../../lib/moduleRoutes.jsx';
import { emsRoutesConfig } from './config/ems.routes.config.js';

export function EmsDashboardPage() {
  const route = useCurrentRouteMeta(emsRoutesConfig);
  const trail = useBreadcrumbTrail(emsRoutesConfig);
  return (
    <ModulePageShell title={route?.title} subtitle={route?.description} breadcrumbTrail={trail}>
      <EmptyState
        icon={LayoutDashboard}
        title="EMS Dashboard"
        hint="KPIs and analytics come together in Step 8 — Reports & Analytics, once Steps 2-7 have real data to summarize."
      />
    </ModulePageShell>
  );
}

export default EmsDashboardPage;
