import { CreditCard } from 'lucide-react';
import { ModulePageShell } from '../../components/layout/ModulePageShell.jsx';
import { EmptyState } from '../../components/ui/primitives.jsx';
import { useCurrentRouteMeta, useBreadcrumbTrail } from '../../lib/moduleRoutes.jsx';
import { emsRoutesConfig } from './config/ems.routes.config.js';

export function PaymentsPage() {
  const route = useCurrentRouteMeta(emsRoutesConfig);
  const trail = useBreadcrumbTrail(emsRoutesConfig);
  return (
    <ModulePageShell title={route?.title} subtitle={route?.description} breadcrumbTrail={trail}>
      <EmptyState
        icon={CreditCard}
        title="Payments"
        hint="This screen ships in Step 5 — Payment module."
      />
    </ModulePageShell>
  );
}

export default PaymentsPage;
