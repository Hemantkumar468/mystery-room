import { lazy } from 'react';
import { LayoutDashboard, ShoppingCart, PackageCheck, FileText, Receipt, Plus } from 'lucide-react';

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

  /**
   * Adding a line, on its own page.
   *
   * A BOQ line IS a purchase order, so this is where a new order is born —
   * the Phase 1 "Add New Property" flow at a Purchase address. `/new` cannot
   * collide with `/:id/:recordId` below: that one needs two segments after
   * `orders`, this has one.
   *
   * `sidebar: false` — reached from the Add BOQ button on the list, never a
   * nav entry.
   */
  {
    key: 'purchase-order-new', path: '/purchase/orders/new', parentKey: 'purchase-orders',
    element: lazy(() => import('../AddBoqPage.jsx')),
    title: 'Add BOQ', breadcrumb: 'Add BOQ', icon: Plus,
    sidebar: false, order: 2.5,
    description: 'File one BOQ line — it lands on the Purchase Orders sheet as an order.',
  },

  /**
   * One order, without leaving Purchase.
   *
   * These three render the SAME components the project pages render — the
   * order, its printable PO and its invoice — mounted at a Purchase address.
   * Opening an order from this module used to jump to /projects/..., which
   * switched the sidebar to PMS and left Back pointing at a module the user
   * had not been in. `sidebar: false` because they are detail pages: reachable
   * from a row, never a nav entry.
   *
   * They keep BOTH ids in the path. The project id is not decoration — the
   * pages read it for the project header and for cache invalidation, and
   * carrying it in the URL means the page renders from the address alone
   * rather than waiting for the record to load to find out where it belongs.
   */
  {
    key: 'purchase-order-one', path: '/purchase/orders/:id/:recordId', parentKey: 'purchase-orders',
    element: lazy(() => import('../../projects/OrderDetailPage.jsx')),
    title: 'Order', breadcrumb: 'Order', icon: ShoppingCart,
    sidebar: false, order: 3,
    description: 'One purchase order — tracking, receipt, notes and history.',
  },
  {
    key: 'purchase-order-document', path: '/purchase/orders/:id/:recordId/document', parentKey: 'purchase-order-one',
    element: lazy(() => import('../../projects/PurchaseOrderPage.jsx')),
    title: 'Purchase Order', breadcrumb: 'Document', icon: FileText,
    sidebar: false, order: 4,
    description: 'The printable purchase order, and the panel that sends it.',
  },
  {
    key: 'purchase-order-invoice', path: '/purchase/orders/:id/:recordId/invoice', parentKey: 'purchase-order-one',
    element: lazy(() => import('../../projects/InvoicePage.jsx')),
    title: 'Invoice', breadcrumb: 'Invoice', icon: Receipt,
    sidebar: false, order: 5,
    description: 'The invoice raised against this order.',
  },
];

/**
 * Where a Purchase page's back arrow goes: its parent in this same config.
 * Read from `parentKey` rather than typed at each page, so moving a screen
 * under a different parent moves its back arrow with it.
 */
export function purchaseParentPath(key) {
  const entry = purchaseRoutesConfig.find((e) => e.key === key);
  const parent = entry && purchaseRoutesConfig.find((e) => e.key === entry.parentKey);
  return parent ? parent.path : null;
}

export default purchaseRoutesConfig;
