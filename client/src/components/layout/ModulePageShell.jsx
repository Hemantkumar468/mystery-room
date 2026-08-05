import { Topbar } from './Topbar.jsx';
import { Breadcrumbs } from './Breadcrumbs.jsx';
import { KpiStrip } from '../ui/KpiStrip.jsx';

/**
 * Generic, module-agnostic page shell:
 * PageHeader → Breadcrumb → KPI → Filters → Action Toolbar → Content → Drawer → Modal
 * in that fixed order. Every slot but `children` (Content Area) is optional
 * and renders nothing when omitted, so a placeholder page can use just
 * title+breadcrumb+content today while a fully-built page later fills in
 * every slot without restructuring.
 *
 * Reuses existing shared components rather than inventing new ones:
 * PageHeader = the existing Topbar (unmodified), KPI Section = the existing
 * KpiStrip, Drawer/Modal = whatever Modal.jsx element the page passes in
 * (this shell owns no modal state of its own).
 *
 * Takes only plain data — no import of anything module-specific — so PMS,
 * CRM, HRMS, Inventory, and Finance can all render through this exact same
 * component unchanged; only EMS's own pages (and their route config) know
 * they're EMS.
 */
export function ModulePageShell({
  title,
  subtitle,
  breadcrumbTrail,
  kpis,
  filters,
  actions,
  actionToolbar,
  drawer,
  modal,
  children,
}) {
  return (
    <div className="col gap-4">
      <Topbar title={title} subtitle={subtitle} actions={actions} />
      {breadcrumbTrail && <Breadcrumbs trail={breadcrumbTrail} />}
      {kpis && <KpiStrip cards={kpis} />}
      {filters && <div className="row gap-2">{filters}</div>}
      {actionToolbar && <div className="row gap-2">{actionToolbar}</div>}
      <div className="col gap-3">{children}</div>
      {drawer}
      {modal}
    </div>
  );
}

export default ModulePageShell;
