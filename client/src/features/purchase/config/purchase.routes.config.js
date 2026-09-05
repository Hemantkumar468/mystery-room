import { lazy } from 'react';
import { LayoutDashboard, ShoppingCart, PackageCheck } from 'lucide-react';

/**
 * Single source of truth for the Purchase module — routing, sidebar,
 * breadcrumbs, titles and icons all read this one array via
 * lib/moduleRoutes.jsx, exactly as HRMS does. Adding a screen is one entry.
 *
 * Purchase is the company-wide view of what every project's Phase 5/6 already
 * captures: a BOQ line (stage p13) IS a purchase order, and its tracking
 * fields carry it from "not sent" through dispatch to the GRN. The project
 * pages remain the place to act on one order; these screens answer the
 * procurement team's cross-project questions — what is late anywhere, what
 * has a vendor got open with us, what arrived this week — without opening
 * projects one at a time.
 */
export const purchaseRoutesConfig = [
  {
    key: 'purchase-overview', path: '/purchase/overview', parentKey: null,
    element: lazy(() => import('../PurchaseOverviewPage.jsx')),
    title: 'Purchase Overview', breadcrumb: 'Overview', icon: LayoutDashboard,
    sidebar: true, order: 0,
    description: 'Every purchase order across every centre — what is open, late and received.',
  },
  {
    key: 'purchase-orders', path: '/purchase/orders', parentKey: 'purchase-overview',
    element: lazy(() => import('../PurchaseOrdersPage.jsx')),
    title: 'Purchase Orders', breadcrumb: 'Purchase Orders', icon: ShoppingCart,
    sidebar: true, order: 1,
    description: 'All orders, across projects — filter by centre, vendor or status.',
  },
  {
    key: 'purchase-receipts', path: '/purchase/receipts', parentKey: 'purchase-overview',
    element: lazy(() => import('../GoodsReceiptsPage.jsx')),
    title: 'Goods Received', breadcrumb: 'Goods Received', icon: PackageCheck,
    sidebar: true, order: 2,
    description: 'Deliveries and GRNs — what arrived against what was ordered, and what is invoiced.',
  },
];

export default purchaseRoutesConfig;
