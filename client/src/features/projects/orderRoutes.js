import { useLocation } from 'react-router-dom';

/**
 * Where an order's own pages live — which depends on where you came in.
 *
 * The same three screens (the order, its PO document, its invoice) are reached
 * from two places: a project's Phase 6 tracker, and the company-wide Purchase
 * module. They used to carry hardcoded `/projects/:id/...` links, so opening
 * an order from Purchase dropped you into PMS: the sidebar switched module,
 * the breadcrumb changed, and Back no longer led anywhere you had been.
 *
 * The pages ask this hook instead. It reads the CURRENT path, so a page mounted
 * under /purchase links to /purchase, and the same page mounted under /projects
 * links to /projects — one component, two homes, and neither one drags you out
 * of the module you were working in.
 */

const PURCHASE_ROOT = '/purchase';

/** The Purchase module's own address for one order. */
export const purchaseOrderPath = (projectId, recordId) => `${PURCHASE_ROOT}/orders/${projectId}/${recordId}`;

export function useOrderRoutes(projectId, recordId) {
  const inPurchase = useLocation().pathname.startsWith(`${PURCHASE_ROOT}/`);
  const base = purchaseOrderPath(projectId, recordId);
  return {
    inPurchase,
    /** The order itself — tracking, receipt, notes, history. */
    order: inPurchase ? base : `/projects/${projectId}/procurement/${recordId}`,
    /** The printable purchase order, with the send panel. */
    document: inPurchase ? `${base}/document` : `/projects/${projectId}/purchase-order/${recordId}`,
    /** The invoice raised against it. */
    invoice: inPurchase ? `${base}/invoice` : `/projects/${projectId}/invoice/${recordId}`,
    /** One level up: the list this order belongs to. */
    list: inPurchase ? `${PURCHASE_ROOT}/orders` : `/projects/${projectId}/procurement`,
    /**
     * The BOQ line behind the order. This is the ONE link with no Purchase
     * equivalent — Phase 5 is a project page and always will be — so from
     * Purchase it opens in a new tab rather than navigating away. The rule the
     * rest of this file exists to keep is that the module you are in stays the
     * module you are in.
     */
    boq: `/projects/${projectId}/phase/p13`,
    boqOpensAway: inPurchase,
  };
}

export default useOrderRoutes;
